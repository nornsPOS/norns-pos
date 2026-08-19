/**
 * Auth plugin — better-auth wiring + session/actor population.
 *
 * Two responsibilities:
 *   1. Mount better-auth's HTTP handler at `/api/auth/*`. better-auth ships
 *      a framework-agnostic `auth.handler(Request) → Response` function;
 *      we translate Fastify req/reply ↔ Fetch Request/Response.
 *   2. Run a `preHandler` hook that — for every non-public route — reads the
 *      session cookie, fetches the actor+session from the DB, and populates
 *      `req.actor` + `req.session` for the policy helpers to consume.
 *
 * What this plugin does NOT do:
 *   • PIN auth — that lives in `routes/auth-pin.ts` and calls into our own
 *     `@norns/auth-pin` package + emits a session row directly.
 *   • mTLS — separate plugin, runs earlier in the pipeline.
 *   • PII key injection — separate plugin.
 *
 * Public route list:
 *   `/health`, `/metrics`, `/docs`, `/docs/*`, `/openapi.json`, `/api/auth/*`
 *   are public. Everything else demands an actor.
 */

import { betterAuth } from 'better-auth';

import { darfMitKarteRein, loeseKarteEin } from '../lib/sse-eintrittskarte.js';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

import { apiKeys, sessions } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { loadActorByApiKey, loadActorBySession } from '../lib/actor.js';
import { hashApiKey, isApiKeyToken } from '../lib/api-key.js';
import { ForbiddenError } from '../lib/auth-policy.js';
import { sessionTtlMs, shouldSlide } from '../lib/session-ttl.js';
import { isPublicRoute } from '../lib/public-routes.js';

declare module 'fastify' {
  interface FastifyInstance {
    auth: ReturnType<typeof betterAuth>;
  }
}

export interface AuthPluginOpts {
  env: Env;
}

const authPlugin: FastifyPluginAsync<AuthPluginOpts> = async (app, opts) => {
  // Geräte-Bindung (0106): standardmäßig NUR protokollieren, bei „true" abweisen.
  // Scharf schalten erst bei mTLS-Go-live, wenn der Fingerprint-Bypass fällt.
  const enforceDeviceBinding = opts.env.ENFORCE_DEVICE_BINDING?.trim().toLowerCase() === 'true';
  // ──────────────────────────────────────────────────────────────────────
  // 1. Construct the better-auth instance.
  //
  // We use better-auth's framework-agnostic core. The Kysely-driven default
  // adapter speaks postgres directly using `DATABASE_URL` — no Drizzle
  // adapter wiring needed here. Migration 0004 already defined the schema
  // better-auth expects (users / sessions / accounts / verifications +
  // two_factors via plugin).
  // ──────────────────────────────────────────────────────────────────────

  // better-auth 1.3.x removed the string-based dialect shorthand and now
  // requires either a Kysely Dialect instance, a Drizzle adapter, or a node-pg
  // Pool. The pg Pool is the smallest dependency add and is what better-auth's
  // current docs recommend.
  const auth = betterAuth({
    // Explicit signing/encryption secret. Without this, better-auth 1.3.x falls
    // back to the PUBLIC default "better-auth-secret-123456789" (its docs say so)
    // → forgeable staff session tokens. env.AUTH_SECRET has no default, so boot
    // already failed if it was unset (see config/env.ts).
    secret: opts.env.AUTH_SECRET,
    database: new Pool({ connectionString: opts.env.DATABASE_URL }),
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    session: {
      // Default 8h fixed — Owner extension is applied by our PIN-login route,
      // not by better-auth (which doesn't know about `is_owner`).
      expiresIn: 60 * 60 * 8,
      updateAge: 60 * 60 * 24, // refresh updatedAt at most daily
    },
    trustedOrigins: opts.env.TRUSTED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    advanced: {
      cookies: {
        session_token: { name: 'warehouse14.session' },
      },
    },
  });

  app.decorate('auth', auth);

  // ──────────────────────────────────────────────────────────────────────
  // 2. Mount better-auth's handler at /api/auth/*.
  //
  // better-auth speaks the Fetch API (Request → Response). We translate the
  // Fastify req → Request and pipe the Response → Fastify reply.
  // ──────────────────────────────────────────────────────────────────────
  app.all('/api/auth/*', async (req, reply) => {
    const host = req.headers.host ?? 'localhost';
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
    const url = new URL(req.url, `${proto}://${host}`);

    // Fastify already parsed JSON body; re-serialize for Fetch Request.
    const init: RequestInit = {
      method: req.method,
      headers: req.headers as Record<string, string>,
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    const fetchReq = new Request(url, init);
    const fetchRes = await auth.handler(fetchReq);

    reply.status(fetchRes.status);
    fetchRes.headers.forEach((v, k) => {
      // Avoid `host` / `content-length` — Fastify computes its own.
      if (k === 'host' || k === 'content-length') return;
      reply.header(k, v);
    });
    return reply.send(await fetchRes.text());
  });

  // ──────────────────────────────────────────────────────────────────────
  // 3. preHandler — populate req.actor + req.session from the cookie.
  //    Public routes skip this; the cookie may be absent and that's fine.
  // ──────────────────────────────────────────────────────────────────────
  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (isPublicRoute(req.url)) {
      return;
    }

    // Resolve the session token from (1) the cookie, (2) an `Authorization:
    // Bearer` header, or (3) an `access_token` query param on SSE routes only
    // (EventSource cannot set headers). The Bearer + query paths exist because
    // the cross-site `SameSite=None; Secure` cookie is dropped by Windows
    // WebView2 — see apps/tauri-pos/src/lib/session-token.ts.
    let sessionToken: string | null = null;
    const cookie = req.headers.cookie;
    if (cookie) sessionToken = parseSessionCookie(cookie, 'warehouse14.session');
    if (!sessionToken) {
      const authz = req.headers.authorization;
      if (authz?.startsWith('Bearer ')) sessionToken = authz.slice(7).trim() || null;
    }
    // (3b) Der Live-Strom. `EventSource` kann keine Kopfzeilen setzen, und auf
    // Windows verwirft WebView2 den seitenuebergreifenden Keks — deshalb muss
    // hier etwas in der Adresse stehen.
    //
    // ⚠️ ABER NICHT DER SITZUNGSSCHLUESSEL. Bis zum 26.07.2026 stand genau der
    // dort, und er landete im Tunnelprotokoll UND in den Zugriffsprotokollen
    // von Cloudflare, also ausserhalb jeder eigenen Kontrolle. Gemessen: einer
    // war zu diesem Zeitpunkt noch 4,7 Stunden gueltig — ein benutzbarer
    // Hauptschluessel, offen herumliegend.
    //
    // Jetzt eine Eintrittskarte: 30 Sekunden, EINMALIG, und aus ihr laesst sich
    // die Sitzung nicht ableiten. Siehe lib/sse-eintrittskarte.ts.
    if (!sessionToken && darfMitKarteRein(req.method, req.url)) {
      const q = req.query as Record<string, unknown> | undefined;
      const karte = q?.ticket;
      if (typeof karte === 'string' && karte.length > 0) {
        // Die Karte TRAEGT die bereits aufgeloeste Sitzung. Es wird also nichts
        // nachgeschlagen und nichts entschluesselt — und es liegt nirgends ein
        // zweiter Sitzungsschluessel herum.
        const ausKarte = loeseKarteEin<NonNullable<FastifyRequest['session']>>(karte);
        if (ausKarte) {
          req.actor = ausKarte.actor;
          req.session = ausKarte;
          return;
        }
      }

      // ⚠️ UEBERGANG, und er ist eine bewusste Schuld: eine bereits
      // ausgelieferte Kasse kennt die Karte noch nicht. Wuerde `access_token`
      // hier sofort wegfallen, verloere jedes laufende Geraet seinen
      // Live-Strom, bis die Aktualisierung durch ist.
      //
      // Solange dieser Zweig steht, LECKT der Schluessel bei alten Clients
      // weiter. Er gehoert entfernt, sobald die Geraete auf dem neuen Stand
      // sind — die Warnung unten macht sichtbar, wann das der Fall ist:
      // sobald sie nicht mehr auftaucht, ist der Zweig tot.
      if (!sessionToken) {
        const at = q?.access_token;
        if (typeof at === 'string' && at.length > 0) {
          sessionToken = at;
          req.log.warn(
            { pfad: req.url.split('?')[0] },
            'sse.veralteter_zugang: Sitzungsschluessel in der Adresse — Geraet aktualisieren',
          );
        }
      }
    }
    // (4) The teardown batch-release beacon (P1.4): navigator.sendBeacon cannot
    // set an Authorization header, so the token rides in the JSON body for THIS
    // route only. Body in the request body (not the query string) so it never
    // leaks into access/proxy logs. The body is already parsed by preHandler.
    if (!sessionToken && req.url === '/api/inventory/release/batch') {
      const body = req.body as { accessToken?: unknown } | undefined;
      if (typeof body?.accessToken === 'string' && body.accessToken.length > 0) {
        sessionToken = body.accessToken;
      }
    }
    if (!sessionToken) return; // unauthenticated; route helpers throw.

    // ── API-key principals (Track E) ──────────────────────────────────────
    // A Bearer value carrying the `w14k_` marker is a programmatic API key, not
    // a session token. Resolve it against `api_keys` → a non-interactive actor.
    if (isApiKeyToken(sessionToken)) {
      const principal = await loadActorByApiKey(app.db, hashApiKey(sessionToken));
      if (!principal) return; // unknown / revoked / expired → unauthenticated
      // A read-only key can NEVER mutate — fail closed at the gate.
      if (principal.readOnly && req.method !== 'GET' && req.method !== 'HEAD') {
        throw new ForbiddenError('Dieser API-Schlüssel ist schreibgeschützt.');
      }
      req.actor = principal.actor;
      // A synthetic session so `requireAuth` passes. `lastPinStepUpAt` is null,
      // so every step-up-gated (most sensitive) operation is refused for a key.
      req.session = {
        actor: principal.actor,
        sessionId: principal.actor.apiKeyId ?? 'api-key',
        lastPinStepUpAt: null,
        sessionExpiresAt: principal.sessionExpiresAt,
        sessionDeviceId: null,
      };
      // Throttled last-used stamp (at most once a minute), fire-and-forget.
      const keyId = principal.actor.apiKeyId;
      if (
        keyId &&
        (!principal.lastUsedAt || Date.now() - principal.lastUsedAt.getTime() > 60_000)
      ) {
        void app.db
          .update(apiKeys)
          .set({ lastUsedAt: new Date(), lastUsedIp: req.ip ?? null })
          .where(eq(apiKeys.id, keyId))
          .catch(() => undefined);
      }
      return;
    }

    // The cookie carries the session token. Look up the session by token,
    // then load the actor+session bundle.
    const result = await app.db.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.token, sessionToken),
      columns: { id: true, expiresAt: true },
    });
    if (!result) return;
    if (result.expiresAt.getTime() < Date.now()) return;

    const bundle = await loadActorBySession(app.db, result.id);
    if (!bundle) return;

    // ── Geräte-zu-Token-Bindung (0106) ──────────────────────────────────────
    // Der Token wurde bei der Anmeldung an ein Gerät gebunden
    // (`sessions.device_id`). Wird er von einem ANDEREN Gerät vorgezeigt, ist es
    // ein Wiedereinspielen und wird abgewiesen. Nur wenn BEIDE Seiten ein echtes
    // Gerät tragen: unter dem Vor-mTLS-Bypass fehlt entweder die Bindung oder
    // beide tragen dieselbe Seed-Kennung, also bleibt es dann durchlässig —
    // scharf wird es automatisch, sobald echte Client-Zertifikate da sind.
    if (
      bundle.sessionDeviceId &&
      req.deviceId &&
      bundle.sessionDeviceId !== req.deviceId
    ) {
      // Auf einem LIVE-Fiskalsystem wird nicht blind scharf geschaltet. Solange
      // der Vor-mTLS-Bypass läuft, würde ein echtes Abweisen niemandem helfen
      // (alle tragen dieselbe Seed-Kennung) und könnte im Randfall aussperren.
      // Das Flag ENFORCE_DEVICE_BINDING entscheidet: standardmäßig wird der
      // Fund NUR protokolliert; bei mTLS-Go-live (Flag „true") weist er ab.
      req.log.warn(
        { sessionDevice: bundle.sessionDeviceId, presentedDevice: req.deviceId },
        enforceDeviceBinding
          ? 'Sitzungstoken von fremdem Gerät — abgewiesen (0106)'
          : 'Sitzungstoken von fremdem Gerät — protokolliert (0106, Bindung noch nicht scharf)',
      );
      if (enforceDeviceBinding) return; // unauthenticated; route helpers throw 401.
    }

    req.actor = bundle.actor;
    req.session = bundle;

    // ── Gleitende Erneuerung (0106) ─────────────────────────────────────────
    // Bei Nutzung das Ablaufdatum nachführen, aber gedrosselt: erst wenn die
    // Sitzung mindestens einen Takt (SESSION_SLIDE_GAP_MS) ihrer Lebenszeit
    // verbraucht hat. So bleibt eine kurze Grund-TTL bequem, ohne bei jedem
    // Request zu schreiben. Fire-and-forget — ein Schreibfehler darf den
    // Request nie aufhalten.
    const now = Date.now();
    const ttl = sessionTtlMs(bundle.actor.isOwner);
    if (shouldSlide(bundle.sessionExpiresAt, ttl, now)) {
      void app.db
        .update(sessions)
        .set({ expiresAt: new Date(now + ttl) })
        .where(eq(sessions.id, bundle.sessionId))
        .catch(() => undefined);
    }
  });
};

/** Cookie parser scoped to our session cookie name only. */
function parseSessionCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export default fastifyPlugin(authPlugin, {
  name: 'warehouse14-auth',
  fastify: '4.x',
  dependencies: ['warehouse14-db'],
});
