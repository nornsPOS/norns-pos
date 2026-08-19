/**
 * Prometheus metrics — added to Day 11 per Basel's directive.
 *
 * `fastify-metrics` (community-maintained, official-blessed) wraps
 * `prom-client`. Out of the box we get:
 *   • HTTP request duration histogram (`http_request_duration_seconds`)
 *   • HTTP request counter (`http_request_summary_seconds`)
 *   • Node.js process metrics (event-loop lag, heap, GC pauses)
 *
 * Exposed at `/metrics` as `text/plain; version=0.0.4` (Prom default scrape
 * format). The endpoint is intentionally NOT under `/api` — Prometheus scrape
 * paths conventionally live at the root.
 *
 * ACCESS: `/metrics` stays in `PUBLIC_PREFIXES` on purpose — a Prometheus
 * scraper carries a bearer token, never a staff session cookie, so it must skip
 * the session preHandler. The gate is the token check below instead. In
 * production an unauthenticated scrape was returning the full metric set to the
 * open internet: route inventory, traffic volume, error rates and event-loop
 * health — a free health-and-timing oracle for anyone probing the shop. It now
 * answers 404 unless the caller proves it is the scraper. Development scrapes
 * freely; there is nothing to protect there and the metrics are the point.
 *
 * The response is 404, not 401, so an unauthorised prober cannot even confirm
 * the endpoint exists.
 *
 * Future custom counters (ledger events emitted, sanctions blocks fired, etc.)
 * will live here as `app.metrics.client.Counter` registrations.
 */

import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyMetrics from 'fastify-metrics';
import fastifyPlugin from 'fastify-plugin';

import type { Env } from '../config/env.js';

interface MetricsPluginOpts {
  env: Env;
}

/**
 * Constant-time token compare. Length is compared first because
 * `timingSafeEqual` throws on a length mismatch; that leaks only the length of
 * a token the caller already supplied, never a byte of the real one.
 */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const metricsPlugin: FastifyPluginAsync<MetricsPluginOpts> = async (app, opts) => {
  const isProd = opts.env.NODE_ENV === 'production';
  const token = opts.env.METRICS_TOKEN;

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    // Querystring stripped: `/metrics?foo` must not slip past the match.
    if ((req.url.split('?')[0] ?? '') !== '/metrics') return;
    if (!isProd) return;
    const header = req.headers.authorization ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    // No token configured in prod ⇒ closed. Fail shut, never open.
    if (token.length === 0 || !tokenMatches(provided, token)) {
      await reply.code(404).send({ error: 'Not Found' });
    }
  });

  await app.register(fastifyMetrics, {
    endpoint: '/metrics',
    routeMetrics: {
      enabled: true,
      registeredRoutesOnly: true, // do not blow cardinality on 404s
      groupStatusCodes: false, // keep 200/201/204 distinct from 4xx/5xx
    },
    defaultMetrics: { enabled: true },
    // 14.08.2026: `prom-client` haelt seine Zaehler in einem PROZESSWEITEN
    // Register. Ein zweites `buildApp` im selben Prozess (die geteilte
    // Integrationsmappe nach der pnpm-Neuverteilung der Trennung) starb mit
    // „process_cpu_user_seconds_total has already been registered" und riss
    // 39 von 46 Dateien mit. Im Betrieb baut ein Prozess genau EINE Kasse,
    // das Leeren beim Start kostet dort nichts und macht buildApp ueberall
    // wiederholbar.
    clearRegisterOnInit: true,
  });
};

export default fastifyPlugin(metricsPlugin, {
  name: 'warehouse14-metrics',
  fastify: '4.x',
});
