/**
 * PII plugin — decorates the Fastify instance with `withPii(...)`.
 *
 * Routes call `req.server.withPii(async (tx) => { ... })`. Inside that block:
 *   1. A database transaction is open.
 *   2. `warehouse14.pii_key` is set with `set_config(..., true)` — LOCAL to
 *      the transaction. `encrypt_pii()` / `decrypt_pii()` / `blind_index()`
 *      can now read it from the session config.
 *   3. When the block returns (success → COMMIT, error → ROLLBACK), the
 *      setting is cleared. The connection returns to the pool with no
 *      residue. Zero cross-request leakage.
 *
 * This plugin must be registered AFTER the db plugin (which gives us
 * `app.db`) and AFTER the request-context plugin (which gives us the key
 * via `currentPiiKey()`).
 */

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { type PiiTx, withPii } from '../lib/pii.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Run `fn` inside a database transaction with the request's PII key bound
     * for the duration of the transaction. The key is cleared at COMMIT or
     * ROLLBACK; the connection returns to the pool with no setting.
     */
    withPii: <T>(fn: (tx: PiiTx) => Promise<T>) => Promise<T>;
  }
}

const piiPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('withPii', async <T>(fn: (tx: PiiTx) => Promise<T>): Promise<T> => {
    return withPii(app.db, fn);
  });
};

export default fastifyPlugin(piiPlugin, {
  name: 'warehouse14-pii',
  fastify: '4.x',
  dependencies: ['warehouse14-db', 'warehouse14-request-context'],
});
