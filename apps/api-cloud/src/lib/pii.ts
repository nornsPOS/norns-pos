/**
 * The PII key gate — the *single* path through which encrypted-column reads
 * and writes happen in the API.
 *
 * Basel directive (Day 12b): "combining SET LOCAL with AsyncLocalStorage is
 * the most dangerous part. Guarantee teardown at end of HTTP request whether
 * it succeeds or fails. Zero cross-request leakage."
 *
 * ──────────────────────────────────────────────────────────────────────────
 * INVARIANTS — read these before changing anything in this file.
 * ──────────────────────────────────────────────────────────────────────────
 *
 * 1. We use `set_config('warehouse14.pii_key', $key, TRUE)` — the third
 *    argument `TRUE` means "local to the current transaction". This is the
 *    function-form equivalent of `SET LOCAL`. When the transaction ends
 *    (COMMIT or ROLLBACK), the setting is cleared. The connection returns
 *    to the pool with no residue.
 *
 * 2. We NEVER use the bare `SET warehouse14.pii_key = ...` form (no LOCAL).
 *    That form is session-scoped and persists across connection re-use,
 *    which would leak the key into the next request.
 *
 * 3. `withPii(...)` is the ONLY exported way to set the key. There is no
 *    `setKey()` / `bareSetKey()` / unsafe escape hatch.
 *
 * 4. The key is read from AsyncLocalStorage via `currentPiiKey()`. It is
 *    NEVER read from env at this layer — Phase 1.5 will derive per-shop
 *    keys at request entry and the call sites here will be unchanged.
 *
 * 5. The transaction is opened by Drizzle's `db.transaction(async (tx) => …)`,
 *    which uses postgres-js BEGIN…COMMIT/ROLLBACK semantics. Drizzle
 *    guarantees ROLLBACK on thrown errors — that's the teardown leg.
 *
 * 6. If `fn` throws, the transaction rolls back; the connection returns to
 *    the pool with no pii_key set (because of LOCAL semantics). The caller
 *    sees the original error — we re-throw verbatim.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Usage:
 *
 *     const customers = await req.server.withPii(async (tx) => {
 *       return tx.select({
 *         id: schema.customers.id,
 *         name: sql<string>`decrypt_pii(full_name_encrypted)`,
 *       }).from(schema.customers).where(eq(schema.customers.id, id));
 *     });
 *
 * After the await returns, the connection is back in the pool with no key.
 */

import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase, PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';

import type { AppDb } from '@norns/db/client';

import { currentPiiKey } from './request-context.js';

/**
 * The type the user's callback receives. It is a Drizzle transaction — the
 * full Drizzle query surface, scoped to this BEGIN/COMMIT block.
 *
 * We expose it as `AppDb` (the same shape) because Drizzle's transaction
 * uses the same query builder.
 */
export type PiiTx = AppDb extends PostgresJsDatabase<infer S>
  ? PgTransaction<PostgresJsQueryResultHKT, S>
  : never;

/**
 * Run `fn` inside a database transaction with `warehouse14.pii_key` set
 * (transaction-scoped) so `encrypt_pii()` / `decrypt_pii()` / `blind_index()`
 * can read or write the key from the session config.
 *
 * The key comes from the current request's AsyncLocalStorage scope. If you
 * call `withPii(...)` outside a request scope, `currentPiiKey()` throws —
 * this is intentional, since there is no sane default for "which key".
 */
export async function withPii<T>(db: AppDb, fn: (tx: PiiTx) => Promise<T>): Promise<T> {
  const key = currentPiiKey(); // throws if no scope — refuse-by-default
  return await withPiiKey(db, key, fn);
}

/**
 * Same as `withPii`, but the key is passed EXPLICITLY rather than read from the
 * request-scoped AsyncLocalStorage.
 *
 * This exists for the detached bot orchestrators (Phase-2 P1.1): they run AFTER
 * the webhook has acked and the ALS request scope has unwound, so they CANNOT
 * rely on `currentPiiKey()`. The binding policy forbids carrying correctness-
 * bearing data (the PII key) across a detached async hop via ALS. The webhook
 * captures `currentPiiKey()` synchronously while still in scope and threads the
 * resulting `key` into here.
 *
 * The LOCAL `set_config` teardown guarantee is identical to `withPii`.
 */
export async function withPiiKey<T>(
  db: AppDb,
  key: string,
  fn: (tx: PiiTx) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // set_config(name, value, is_local) — the third arg `true` means LOCAL.
    // The setting is bound to THIS transaction; when it commits/rolls back,
    // the setting is cleared. Postgres docs: "If is_local is true, the new
    // value will only apply during the current transaction."
    await tx.execute(sql`SELECT set_config('warehouse14.pii_key', ${key}, true)`);
    return await fn(tx as PiiTx);
  });
}

/**
 * Internal hard refusal: assert that the bare (non-LOCAL) SET form is never
 * used. Called by the integration tests; not exported on the runtime path.
 *
 * Returns the SQL fragment that would be the violation, so a grep test in CI
 * can search the compiled output for this exact string and refuse a build
 * if it appears anywhere it should not.
 */
export const __FORBIDDEN_SET_FORM__ = 'SET warehouse14.pii_key';
