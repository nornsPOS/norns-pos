/**
 * Migration 0046 — warehouse14_security SELECT on the cumulative customer columns.
 *
 * Real bug (surfaced by the now-runnable db suites): the accumulation triggers
 * are SECURITY DEFINER owned by warehouse14_security and do `col = col + NEW.x`
 * (a READ of col), but 0009/0016 granted security only UPDATE on those columns.
 * So finalizing a transaction for a KNOWN customer — or landing a DEBT payment —
 * aborts with "permission denied for table customers" in production. Only
 * anonymous (customer_id NULL) transactions work.
 *
 * This boots 0001..0016 (the broken state) and applies ONLY 0046 on top:
 *   RED  (without 0046): a VERKAUF for a customer throws /permission denied/.
 *   GREEN (with 0046)  : it succeeds and cumulative_spend_eur / cumulative_debt_eur
 *                         accumulate as designed.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
const FIX_SQL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
  '0046_security_cumulative_select_grant.sql',
);

describe('migration 0046_security_cumulative_select_grant', () => {
  let testDb: TestDb;
  let sql: Sql;
  let customerId: string;
  let deviceId: string;
  let cashierUserId: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    sql = testDb.migratorSql;
    await applyMigrations(sql, 16); // the broken state: triggers exist, SELECT grant missing
    // Apply ONLY the forward fix on top. If absent (red-state proof), leave the
    // broken grant so the assertions fail with the real permission error.
    try {
      const fixSql = await readFile(FIX_SQL, 'utf8');
      await sql.unsafe('SET check_function_bodies = off');
      await sql.unsafe(fixSql);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await sql`SELECT set_config('warehouse14.pii_key', ${PII_KEY}, false)`;

    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${crypto.randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = u?.id ?? '';
    const [d] = await sql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
              now() - interval '1 day', now() + interval '365 days', ${cashierUserId})
      RETURNING id`;
    deviceId = d?.id ?? '';
    const [c] = await sql<{ id: string }[]>`
      INSERT INTO customers (full_name_encrypted, retention_until)
      VALUES (encrypt_pii('Cumulative Tester'), (now() + interval '5 years')::date)
      RETURNING id`;
    customerId = c?.id ?? '';
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  // Deterministic proof: the grant lands exactly on the columns the SECURITY
  // DEFINER accumulation triggers read.
  it.each(['cumulative_spend_eur', 'cumulative_ankauf_eur', 'cumulative_debt_eur'])(
    'warehouse14_security can SELECT customers.%s (so its triggers can read col = col + delta)',
    async (column) => {
      const [row] = await sql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_security', 'customers', ${column}, 'SELECT') AS has`;
      expect(row?.has).toBe(true);
    },
  );

  // Functional proof: finalizing a VERKAUF for a KNOWN customer fires
  // on_transaction_finalized() (security, SECURITY DEFINER), which reads
  // cumulative_spend_eur. We roll the row back after the trigger has run so we
  // never reach payment/balance (independent of the separate payment_method
  // 'DEBT' enum bug). RED (no grant): "permission denied for table customers".
  it('a VERKAUF for a known customer no longer trips a permission error in the spend trigger', async () => {
    const SENTINEL = 'ROLLBACK_AFTER_TRIGGER';
    const err = await sql
      .begin(async (tx) => {
        await tx`
          INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                    subtotal_eur, vat_eur, total_eur, tax_treatment_code, finalized_at)
          VALUES ('VERKAUF'::transaction_direction, ${customerId}, ${deviceId}, ${cashierUserId},
                  '84.03', '15.97', '100.00', 'STANDARD_19', now())`;
        throw new Error(SENTINEL); // roll back — the spend trigger already ran above
      })
      .then(() => null)
      .catch((e: Error) => e.message);
    expect(err).not.toMatch(/permission denied/i);
    expect(err).toContain(SENTINEL);
  });
});
