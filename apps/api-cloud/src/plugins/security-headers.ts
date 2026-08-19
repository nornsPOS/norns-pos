/**
 * Security headers + CORS (Day 16 audit fixes A-3 + A-4).
 *
 * Two responsibilities in one plugin:
 *
 *   1. `@fastify/helmet` — sets the OWASP-recommended response headers.
 *      Even though Cloudflare can set these at the edge, defense-in-depth
 *      means the origin sets them too. Belt-and-braces.
 *
 *   2. `@fastify/cors` — reads `TRUSTED_ORIGINS` env (comma-separated) and
 *      restricts cross-origin requests to that allow-list. credentials=true
 *      so cookies (better-auth session) are sent.
 *
 * Why one plugin: both are static configuration applied early in the
 * pipeline. Splitting into two plugins would just be ceremony.
 *
 * Order: register BEFORE auth / mtls / routes — every response must carry
 * these headers, including 4xx/5xx errors.
 *
 * SSE awareness: `/api/sse/ledger` returns `text/event-stream`. Helmet's
 * default `Content-Security-Policy` directives don't break that path, but
 * we explicitly disable CSP because it would otherwise prevent Swagger UI
 * from loading its inline scripts. Phase 1.5 can split CSP per-route.
 */

import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { type Env, parseOrigins } from '../config/env.js';

export interface SecurityHeadersPluginOpts {
  env: Env;
}

const securityHeadersPlugin: FastifyPluginAsync<SecurityHeadersPluginOpts> = async (app, opts) => {
  // ──────────────────────────────────────────────────────────────────────
  // 1. helmet — OWASP recommended headers.
  // ──────────────────────────────────────────────────────────────────────
  await app.register(fastifyHelmet, {
    // CSP off for now — Swagger UI uses inline scripts. Phase 1.5 splits CSP
    // per-route so /docs gets a loose policy and /api/* gets a strict one.
    contentSecurityPolicy: false,

    // HSTS: only meaningful when served over HTTPS, but harmless on HTTP.
    // 6 months + includeSubDomains.
    strictTransportSecurity: {
      maxAge: 60 * 60 * 24 * 180,
      includeSubDomains: true,
      preload: false,
    },

    // X-Content-Type-Options: nosniff
    noSniff: true,

    // X-Frame-Options: DENY  — we have no embeddable surfaces.
    frameguard: { action: 'deny' },

    // Referrer-Policy: no-referrer  — never leak our URLs.
    referrerPolicy: { policy: 'no-referrer' },

    // X-DNS-Prefetch-Control: off
    dnsPrefetchControl: { allow: false },

    // Cross-Origin-Resource-Policy: same-origin
    crossOriginResourcePolicy: { policy: 'same-origin' },

    // Cross-Origin-Opener-Policy: same-origin
    crossOriginOpenerPolicy: { policy: 'same-origin' },

    // Cross-Origin-Embedder-Policy: off — would block legitimate iframes
    // in /docs and Tauri's webview content loading.
    crossOriginEmbedderPolicy: false,
  });

  // ──────────────────────────────────────────────────────────────────────
  // 2. CORS — allow-list from TRUSTED_ORIGINS env.
  //    If the list is empty (dev with no admin origins yet), refuse all
  //    cross-origin requests (same-origin still works).
  // ──────────────────────────────────────────────────────────────────────
  const origins = parseOrigins(opts.env);
  await app.register(fastifyCors, {
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'content-type',
      'authorization',
      'cookie',
      'last-event-id', // SSE reconnect
      'x-dev-device-fingerprint', // dev mTLS bypass
      'x-request-id', // correlation
      'idempotency-key', // offline-queue mutation key (ADR-0044) — sent on every POST/PATCH/PUT/DELETE
      'x-step-up-token', // PIN step-up token (auth-policy)
      'x-client-trace-id', // telemetry middleware — attached to EVERY request (the login blocker)
    ],
    exposedHeaders: ['x-request-id', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset'],
    maxAge: 600,
  });
};

export default fastifyPlugin(securityHeadersPlugin, {
  name: 'warehouse14-security-headers',
  fastify: '4.x',
});
