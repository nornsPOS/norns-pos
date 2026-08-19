/**
 * PII session-key management.
 *
 * The key for `encrypt_pii()` / `decrypt_pii()` / `blind_index()` lives in
 * the connection's `warehouse14.pii_key` setting (migration 0007). The app
 * must set it via `SET LOCAL` at the start of any transaction that touches
 * encrypted PII.
 *
 * Usage:
 *
 *   import { withPiiKey } from '@norns/db';
 *
 *   await withPiiKey(db, piiKeyFromVault, async tx => {
 *     await tx.insert(customers).values({
 *       fullNameEncrypted: sql`encrypt_pii(${fullName})`,
 *       emailEncrypted:    sql`encrypt_pii(${email})`,
 *       emailBlindIndex:   sql`blind_index(lower(${email}))`,
 *       ...
 *     });
 *   });
 *
 * The key never appears in logs (set_config with LOCAL=true is connection-
 * scoped and not visible to other sessions; pg_stat_statements does not
 * record the parameter content).
 */

import { sql } from 'drizzle-orm';

import type { DrizzleTransaction, RootDb } from './client.js';

/**
 * Backward-compat alias — kept for callers that historically imported
 * `DbTransaction` from `@norns/db/pii`. Identical to `DrizzleTransaction`
 * from `./client.js`.
 */
export type DbTransaction = DrizzleTransaction;

/**
 * Open a transaction with the PII key set for its duration.
 *
 * The key is bound via `set_config('warehouse14.pii_key', key, true)` where
 * `true` is the LOCAL flag — gone at COMMIT/ROLLBACK.
 *
 * @param db        Root Drizzle client (app / worker / migrator) that owns a
 *                  real BEGIN/COMMIT. A `DrizzleTransaction` is refused at the
 *                  type level: passing a tx would nest a SAVEPOINT, and the
 *                  `SET LOCAL pii_key` would then be scoped to that
 *                  subtransaction instead of the whole encrypted-PII unit.
 * @param piiKey    The 32-byte symmetric key (typically base64 from secrets
 *                  storage). Passed as a parameter — never embedded in the
 *                  SQL text — so it does not appear in query logs.
 * @param fn        Body. Receives a transaction scoped to the key.
 */
export async function withPiiKey<T>(
  db: RootDb,
  piiKey: string,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('warehouse14.pii_key', ${piiKey}, true)`);
    return await fn(tx);
  });
}
