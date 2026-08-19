/**
 * GET /health — combined liveness + readiness probe.
 *
 * TWO AUDIENCES, TWO ANSWERS
 * ──────────────────────────
 * • ANONYMOUS (the public internet): `{ ok: true }`. Nothing else.
 * • AUTHORISED (Bearer METRICS_TOKEN, or any non-production env): the full
 *   readiness detail — `db`, `version`, `timestamp`.
 *
 * Why: this endpoint must stay public (it is the container's own liveness
 * probe, and it is in PUBLIC_PREFIXES), but it was volunteering two gifts to
 * anyone who asked. `version: "0.1.0"` is a free CVE-matching key — an attacker
 * reads the exact build and goes shopping for known bugs against it. `db: "up"`
 * reports the health of our database to strangers, which also tells them when it
 * is NOT up, i.e. exactly when to push. Neither is anyone's business but ours.
 *
 * The DB probe now runs ONLY for an authorised caller. Before, every anonymous
 * GET /health spent a real Postgres round-trip: a free amplifier: cheap request
 * in, database work out. The public answer is now a constant.
 *
 * The HTTP status is unchanged and still ALWAYS 200 when the process is alive —
 * `ok: true` is liveness, the body is readiness. The container healthcheck only
 * reads `r.ok` (Dockerfile HEALTHCHECK: `fetch(...).then(r => exit(r.ok?0:1))`),
 * so it never sees the body and is unaffected by this split. Verified before
 * shipping: a failed DB still returns 200, so the healthcheck's behaviour does
 * not change either way.
 *
 * Operators keep the readiness detail — they just have to say who they are:
 *   curl -H "Authorization: Bearer $METRICS_TOKEN" https://api.warehouse14.de/health
 */

import { Type } from '@sinclair/typebox';
import { timingSafeEqual } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';

interface HealthPluginOpts {
  env: Env;
}

/** Liveness only — what the world gets. */
const PublicHealthResponse = Type.Object({
  ok: Type.Boolean(),
});

/** Liveness + readiness — what an authorised operator gets. */
const DetailedHealthResponse = Type.Object({
  ok: Type.Boolean(),
  db: Type.Optional(Type.Union([Type.Literal('up'), Type.Literal('down')])),
  version: Type.Optional(Type.String()),
  timestamp: Type.Optional(Type.String({ format: 'date-time' })),
});

const VERSION = '0.1.0'; // align with package.json — kept static, no env lookup

/** Constant-time compare; length first because timingSafeEqual throws on mismatch. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const healthRoute: FastifyPluginAsync<HealthPluginOpts> = async (app, opts) => {
  const isProd = opts.env.NODE_ENV === 'production';
  const token = opts.env.METRICS_TOKEN;

  /** Outside production everything is visible; in production, prove it. */
  function isAuthorised(req: FastifyRequest): boolean {
    if (!isProd) return true;
    if (token.length === 0) return false; // no token configured ⇒ closed
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    return tokenMatches(provided, token);
  }

  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'Liveness + readiness probe',
        description:
          'Always 200 while the process is alive. Anonymous callers get `{ ok: true }`. ' +
          'With a valid Bearer METRICS_TOKEN the body also reports db readiness and version.',
        response: { 200: DetailedHealthResponse },
        security: [],
      },
    },
    async (req, _reply) => {
      // The public answer is a constant: no DB round-trip, no build number.
      if (!isAuthorised(req)) return { ok: true };

      let dbStatus: 'up' | 'down' = 'down';
      try {
        // 1-second budget — long enough for transient hiccups, short enough that
        // a hung Postgres does not block the readiness probe.
        await Promise.race([
          app.db.execute(drizzleSql`SELECT 1`),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('db readiness timeout')), 1_000),
          ),
        ]);
        dbStatus = 'up';
      } catch (err) {
        app.log.warn({ err }, 'db readiness check failed');
      }
      return {
        ok: true,
        db: dbStatus,
        version: VERSION,
        timestamp: new Date().toISOString(),
      };
    },
  );
};

export { PublicHealthResponse };
export default healthRoute;
