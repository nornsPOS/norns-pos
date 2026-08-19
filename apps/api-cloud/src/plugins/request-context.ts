/**
 * Request-context plugin.
 *
 * Hooks Fastify's `preHandler` so every route runs INSIDE an
 * AsyncLocalStorage scope carrying the request id + PII key + actor/device
 * ids (the latter two are populated by the auth + mTLS plugins which run
 * earlier in the pipeline).
 *
 * `als.run(...)` is the safe form — leaving the scope is automatic when the
 * callback completes. There is no manual `enterWith` or `disable` here.
 *
 * The PII key teardown is NOT this plugin's job — the key is bound by
 * `withPii(...)` inside a database transaction via `SET LOCAL`. This plugin
 * only makes the key REACHABLE; the DB layer enforces transaction-scoping.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { Env } from '../config/env.js';
import { type RequestContext, runInRequestScope } from '../lib/request-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** mTLS-paired device id, if the mTLS plugin recognized the request. */
    deviceId: string | null;
  }
}

export interface RequestContextPluginOpts {
  env: Env;
}

const requestContextPlugin: FastifyPluginAsync<RequestContextPluginOpts> = async (app, opts) => {
  // Default the request decoration so TS types are consistent on every route.
  app.decorateRequest('actor', null);
  app.decorateRequest('session', null);
  app.decorateRequest('deviceId', null);

  // onRequest is the earliest hook with the request id assigned — perfect spot
  // to build the context object. We wrap the whole route handler in the ALS
  // scope via preHandler so all downstream awaits inherit it.
  app.addHook('preHandler', (req: FastifyRequest, _reply, done) => {
    const ctx: RequestContext = {
      actorId: req.actor?.id ?? null,
      deviceId: req.deviceId,
      requestId: req.id,
      piiKey: opts.env.NORNS_PII_KEY,
    };
    // Enter the scope; the callback `done` is what continues the request.
    // Anything that `await`s inside the route handler will see ctx via
    // currentContext() / currentPiiKey().
    runInRequestScope(ctx, () => done());
  });
};

export default fastifyPlugin(requestContextPlugin, {
  name: 'warehouse14-request-context',
  fastify: '4.x',
});
