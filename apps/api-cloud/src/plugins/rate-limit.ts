/**
 * Rate limiting (Day 16 audit fix A-1).
 *
 * Defends against brute-force at the HTTP layer. The PIN lockout (5
 * attempts → 30 min lock at the DB level) protects PIN-login, but every
 * other endpoint — email/password, step-up, even reads — was previously
 * unbounded. An attacker could hammer `/api/auth/sign-in` from rotating
 * IPs to brute-force passwords.
 *
 * Strategy:
 *   • Global default: 300 requests / minute / key.
 *   • Per-route override: routes set `config: { rateLimit: { max, timeWindow } }`.
 *     - /api/auth/* gets 10/minute/IP (very strict — brute-force surface).
 *     - sensitive writes (storno, finalize) get 30/minute/actor.
 *   • Key: `req.actor.id` when authenticated, else `req.ip`.
 *
 * V1 storage is in-memory. Phase 1.5 swaps to Redis once the Oracle Cloud
 * Redis container lands (ADR-0012 §6). The plugin's API surface is
 * unchanged on that swap.
 *
 * Order: this plugin MUST be registered AFTER `auth` so `req.actor` is
 * populated by the time the key generator runs. For public auth routes
 * (`/api/auth/*`), `req.actor` is null and the key falls back to IP — which
 * is the correct behavior for brute-force defense.
 */

import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { Env } from '../config/env.js';

export interface RateLimitPluginOpts {
  env: Env;
}

/** Strip the querystring → bare path. */
function pathOf(req: FastifyRequest): string {
  return req.url.split('?')[0] ?? '';
}

/**
 * Per-path-prefix limits enforced ON TOP of the global default. Because no
 * route in this codebase declares `config.rateLimit`, the documented strict
 * limits (10/min on auth, 30/min on the sensitive writes) were never applied.
 * We enforce them centrally here, keyed by path prefix, so adding a new auth
 * or transaction route picks up the limit automatically — no per-route wiring.
 *
 * The list is ordered: the FIRST matching prefix wins. Most specific first.
 */
interface PrefixLimit {
  /** Path prefix this rule matches (exact-prefix on the bare path). */
  prefix: string;
  /** Max requests per `timeWindow` for this prefix. */
  max: number;
}

const PREFIX_LIMITS: readonly PrefixLimit[] = [
  // Sensitive transaction writes — 30/min/actor. Finalize commits a sale;
  // storno reverses one. Both are forensically heavy and must not be flooded.
  { prefix: '/api/transactions/finalize', max: 30 },
  { prefix: '/api/transactions/storno', max: 30 },
  // PIN login — 5/min/IP. MUST stay ABOVE the '/api/auth/' rule below:
  // matchPrefixLimit returns the FIRST match, not the strictest one, so a
  // general rule listed first would shadow this one.
  //
  // Why this needs its own, much tighter rule: this route's secret is FOUR
  // DIGITS, a 10,000 keyspace, and the body is just {"pin":"NNNN"} — no email.
  // The device selects the user, so an anonymous request is measured straight
  // against the owner's hash. Verified from the open internet on 2026-07-16:
  // POST /api/auth/pin-login {"pin":"9137"} answered 401 "Invalid PIN", i.e.
  // the device resolved and only the four digits stood in the way. At the old
  // 20/min the whole keyspace is ~8 hours per IP; at 5/min it is ~33 hours,
  // and every attempt is now loud. An owner re-typing a PIN never exceeds two
  // or three tries a minute, so this cannot lock a real person out.
  //
  // This bounds ONE IP. It does not stop a distributed attempt — the per-user
  // lockout is what does that, and it is untouched here by explicit request.
  { prefix: '/api/auth/pin-login', max: 5 },
  // Auth surface — 20/min/IP. Email/password sign-in + PIN step-up are the
  // brute-force surface; the DB-side PIN lockout (10 tries → 1 min) is the real
  // backstop. This HTTP cap is generous enough that an owner re-typing his PIN
  // is never 429'd before the lockout logic even runs, yet still bounds abuse.
  { prefix: '/api/auth/', max: 20 },
  // Reserve-and-pickup (security review 2026-07-21) — 12/min/IP. Reserving is a
  // deliberate commit that locks real stock for 3 days; a genuine customer does
  // it a handful of times, never in a tight loop. Tighter than the 300 default.
  { prefix: '/api/storefront/cart/reserve', max: 12 },
  // Guest minting — 20/min/IP. Each call creates a brand-new shopper identity;
  // this is the main amplifier for a reservation-hoarding script, so throttle it
  // hard while leaving normal first-visit browsing (one mint per visitor) free.
  // NOTE: storefront routes key on req.ip (no req.actor), so this bounds ONE IP;
  // rotating IPs multiplies it. The per-shopper reservation caps in
  // storefront-reservation-policy.ts are the identity-independent backstop.
  { prefix: '/api/storefront/session/guest', max: 20 },
];

/** The strictest limit that applies to this path, or `null` for the default. */
function matchPrefixLimit(path: string): PrefixLimit | null {
  for (const rule of PREFIX_LIMITS) {
    if (path === rule.prefix || path.startsWith(rule.prefix)) return rule;
  }
  return null;
}

const rateLimitPlugin: FastifyPluginAsync<RateLimitPluginOpts> = async (app, opts) => {
  const isProd = opts.env.NODE_ENV === 'production';

  await app.register(fastifyRateLimit, {
    // Global default: tolerant for normal usage, hard cap on abuse.
    // Per-prefix overrides below TIGHTEN this via `max` as a function.
    max: (req: FastifyRequest): number => {
      const path = pathOf(req);
      const rule = matchPrefixLimit(path);
      const base = rule ? rule.max : 300;
      // In dev/test we relax the GLOBAL default so the bootstrap script +
      // repeated curl tests don't trip it — but the auth/transaction limits
      // are exactly what tests assert, so they stay enforced everywhere.
      return !isProd && rule == null ? 10_000 : base;
    },
    timeWindow: '1 minute',

    // Skip /health, /metrics, /docs — they're internal/monitoring.
    skipOnError: false,
    allowList: (req): boolean => {
      const path = pathOf(req);
      // Day 19: Stripe webhook delivery must NEVER be rate-limited — Stripe
      // retries, but we want the FIRST delivery to land so the idempotency
      // table records it. Stripe imposes its own retry policy. This exemption
      // is NARROW: only the Stripe endpoint is unlimited. Every other public
      // webhook (WhatsApp, Meta socials, Chatwoot) gets the finite default IP
      // cap below so a forged-signature flood can't be unbounded.
      if (path === '/api/webhooks/stripe') return true;
      return (
        path === '/health' ||
        path === '/metrics' ||
        path === '/' ||
        path === '' ||
        path.startsWith('/docs') ||
        path === '/openapi.json'
      );
    },

    // Key: per-actor when authenticated, per-IP otherwise. For /api/auth/* and
    // public webhooks `req.actor` is null, so the key correctly falls back to
    // IP — which is what brute-force / flood defense needs.
    //
    // The key ALSO carries the matched prefix. @fastify/rate-limit keeps ONE
    // counter per key across ALL routes; without the prefix in the key, a
    // shopper's ordinary browsing (catalog, images, cart reads — easily more
    // than 12 requests in a minute) fills the shared counter, and the moment
    // they tap "reserve" the 12/min reserve rule reads that full counter and
    // 429s an innocent first attempt. Live-hit 2026-07-24: a brand-new account
    // was told "too many attempts" on its first reservation. With the prefix in
    // the key, each strict rule gets its own bucket (only reserve calls count
    // against the reserve limit), and everything else shares the default one.
    keyGenerator: (req: FastifyRequest): string => {
      const actor = (
        req as FastifyRequest & { actor?: { id: string; apiKeyId?: string } | null }
      ).actor;
      // Per-API-key bucket when a key is presented, else per-actor, else per-IP.
      const who = actor?.apiKeyId ?? actor?.id ?? req.ip ?? 'unknown';
      const bucket = matchPrefixLimit(pathOf(req))?.prefix ?? 'default';
      return `${bucket}|${who}`;
    },

    // Error message is replaced by our error-handler's RATE_LIMITED code;
    // we just need to throw with the right shape.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded: ${ctx.max} per ${ctx.after}. Retry after ${ctx.ttl}ms.`,
    }),

    enableDraftSpec: true, // emit `RateLimit-*` headers (RFC IETF draft)
  });
};

export default fastifyPlugin(rateLimitPlugin, {
  name: 'warehouse14-rate-limit',
  fastify: '4.x',
});
