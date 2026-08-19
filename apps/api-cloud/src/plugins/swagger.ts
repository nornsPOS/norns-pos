/**
 * OpenAPI 3.1 generation + Swagger UI.
 *
 * `@fastify/swagger` introspects every route's TypeBox `schema` and emits an
 * OpenAPI document. `@fastify/swagger-ui` serves a browsable UI at `/docs`.
 *
 * The OpenAPI JSON is the contract that Tauri (Rust), the storefront
 * (Next.js), and any external integration will consume — keep field names +
 * semantics stable.
 */

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { Env } from '../config/env.js';

export interface SwaggerPluginOpts {
  env: Env;
}

const swaggerPlugin: FastifyPluginAsync<SwaggerPluginOpts> = async (app, opts) => {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Warehouse14 Cloud API',
        version: '0.1.0',
        description:
          'Hybrid Cloud/Desktop ERP & POS for German gold, rare coins, and antiques retail. ' +
          'Implements GoBD + KassenSichV + DSFinV-K + GwG + §25a UStG compliance.',
        contact: { name: 'Warehouse14', url: 'https://warehouse14.de' },
      },
      servers:
        opts.env.NODE_ENV === 'production'
          ? [{ url: 'https://api.warehouse14.de', description: 'Production' }]
          : [{ url: `http://localhost:${opts.env.PORT}`, description: 'Local dev' }],
      tags: [
        { name: 'system', description: 'Liveness, readiness, metrics' },
        { name: 'auth', description: 'Authentication & sessions (Day 12)' },
        { name: 'transactions', description: 'Fiscal transactions (Day 13)' },
        { name: 'sse', description: 'Real-time event streams (Day 14)' },
      ],
      components: {
        securitySchemes: {
          sessionCookie: { type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' },
          mtlsClientCert: {
            type: 'apiKey',
            in: 'header',
            name: 'Cf-Client-Cert-Sha256',
            description: 'mTLS client cert SHA-256 (Cloudflare Access in prod, step-ca dev)',
          },
        },
      },
      // The contract must state what the server actually does. The schemes above
      // were declared but never APPLIED, so the document said `security: null` —
      // "this whole API is open". It is not: plugins/auth.ts installs a global
      // default-deny preHandler and lib/public-routes.ts holds the only allowlist.
      // A passive audit read that null, graded the API "D — fully unauthenticated",
      // and raised four CRITICAL findings that were all false. A contract that lies
      // about its own security costs a review cycle at best and a real miss at
      // worst. Declaring the default here makes the document tell the truth; the
      // genuinely public routes override it with `security: []` on their own
      // schema. The enforcement remains the preHandler, never this line.
      security: [{ sessionCookie: [] }],
    },
  });

  // The Swagger UI hands a visitor the complete 162-route map of an ERP that
  // holds gold, cash, KYC ID scans and tax records: every path, parameter, and
  // shape an attacker would otherwise have to guess. Reconnaissance is the step
  // this closes. It stays fully open in development, where that map is the point.
  if (opts.env.NODE_ENV !== 'production') {
    await app.register(fastifySwaggerUi, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
      staticCSP: true,
    });
  }
};

export default fastifyPlugin(swaggerPlugin, {
  name: 'warehouse14-swagger',
  fastify: '4.x',
});
