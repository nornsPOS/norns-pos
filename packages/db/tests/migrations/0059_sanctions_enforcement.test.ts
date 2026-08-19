/**
 * Migration 0059 — AML enforcement: BANNED-customer transaction block + the
 * regression guard for the sanctions-persistence route fix.
 *
 * Two things this Track-A security pass ships, both verified here against a REAL
 * Postgres (testcontainers), patterned on 0050_gwg_kyc_enforcement.test.ts:
 *
 *  (A) BANNED block (the new 0059 trigger):
 *        RED  — at 0058, a VERKAUF for a trust_level='BANNED' customer INSERTS
 *               fine (the 'refused service' rule was never DB-enforced).
 *        GREEN— at 0059, the same insert is REFUSED with the trust-level message,
 *               and an anonymous / non-BANNED sale still goes through.
 *
 *  (B) Sanctions-persistence regression (the customers-check-sanctions.ts fix):
 *        • warehouse14_app already holds UPDATE(sanctions_match,
 *          sanctions_screened_at) on customers (granted 0007 §7) — proven by
 *          has_column_privilege so the route's UPDATE can never silently fail.
 *        • After the app flips sanctions_match=TRUE, the 0013 C-2 sanctions
 *          trigger actually fires and blocks the next transaction — i.e. the
 *          wall that was dead (column never written) is now armed end-to-end.
 *
 * Inserts go through the migrator; the triggers are SECURITY DEFINER so they
 * fire regardless of the inserting role. The app-role UPDATE is exercised via a
 * real warehouse14_app connection.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const FIX_SQL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
  '0059_sanctions_enforcement.sql',
);

/** Narrow `rows[0]` without a non-null assertion (biome noNonNullAssertion). */
function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('query returned no rows');
  return row;
}

/**
 * Shared fixture/insert helpers, bound to a given migrator connection. Mirrors
 * the full header+item+payment insert from 0050 so the DEFERRED balance trigger
 * at COMMIT is satisfied and the row truly persists.
 */
function helpers(migratorSql: Sql) {
  async function makeUser(): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
      RETURNING id`;
    return must(u).id;
  }

  async function makeDevice(pairedByUserId: string): Promise<string> {
    const [d] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
              now() - interval '1 day', now() + interval '365 days', ${pairedByUserId})
      RETURNING id`;
    return must(d).id;
  }

  /** A KYC-verified customer (so the KYC gate passes) at a given trust_level. */
  async function makeCustomer(trustLevel: string, verifierId: string): Promise<string> {
    // BANNED/SUSPICIOUS need a rationale ≥ 8 chars (0024 CHECK). Always supply it
    // (harmless for other levels). kyc_verified_* are both-or-none (0024 CHECK).
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until, sanctions_match,
                             trust_level, price_expectation_notes,
                             kyc_verified_at, kyc_verified_by_user_id)
      SELECT encrypt_pii('Test'), (now() + interval '5 years')::date, false,
             ${trustLevel}::customer_trust_level, 'banned: refused service rationale',
             now(), ${verifierId}
        FROM s
      RETURNING id`;
    return must(c).id;
  }

  async function countTx(id: string): Promise<number> {
    const [r] = await migratorSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM transactions WHERE id = ${id}`;
    return must(r).n;
  }

  /** Insert a COMPLETE VERKAUF (header + item + payment) in ONE tx (see 0050). */
  async function insertVerkauf(opts: {
    customerId: string | null;
    cashierId: string;
    deviceId: string;
    totalEur?: string;
  }): Promise<string> {
    const total = opts.totalEur ?? '100.00';
    const [product] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'gold_jewelry'::item_type, '50.00', ${total}, 'Test item', now())
      RETURNING id`;
    const productId = must(product).id;

    return await migratorSql.begin(async (tx) => {
      const [txRow] = await tx<
        { id: string; subtotal_eur: string; vat_eur: string; total_eur: string }[]
      >`
        INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                  subtotal_eur, vat_eur, total_eur, tax_treatment_code,
                                  finalized_at)
        VALUES ('VERKAUF'::transaction_direction, ${opts.customerId},
                ${opts.deviceId}, ${opts.cashierId},
                ROUND(${total}::numeric / 1.19, 2),
                (${total}::numeric - ROUND(${total}::numeric / 1.19, 2)),
                ${total}::numeric,
                'STANDARD_19', ${new Date()})
        RETURNING id, subtotal_eur, vat_eur, total_eur`;
      const t = must(txRow);
      await tx`
        INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                       line_vat_eur, line_total_eur, applied_tax_treatment_code,
                                       applied_vat_rate)
        VALUES (${t.id}, ${productId}, ${t.subtotal_eur}, ${t.vat_eur}, ${t.total_eur},
                'STANDARD_19', 0.1900)`;
      await tx`
        INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
        VALUES (${t.id}, 'CASH'::payment_method, ${t.total_eur})`;
      return t.id;
    });
  }

  return { makeUser, makeDevice, makeCustomer, countTx, insertVerkauf };
}

// ════════════════════════════════════════════════════════════════════════
// (A) BANNED block — RED at 0058, GREEN at 0059
// ════════════════════════════════════════════════════════════════════════

describe('migration 0059 — BANNED customer transaction block', () => {
  describe('RED — at 0058 a BANNED customer can still transact', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 58); // 0059 NOT applied → no BANNED gate
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('a VERKAUF for a trust_level=BANNED customer INSERTS (the dead gate)', async () => {
      const h = helpers(sql);
      const cashier = await h.makeUser();
      const device = await h.makeDevice(cashier);
      const banned = await h.makeCustomer('BANNED', cashier);
      const id = await h.insertVerkauf({
        customerId: banned,
        cashierId: cashier,
        deviceId: device,
        totalEur: '100.00',
      });
      expect(await h.countTx(id)).toBe(1); // persists — proving the gap
    });
  });

  describe('GREEN — at 0059 a BANNED customer is refused; others still pass', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 59);
      await setAppPasswordForTest(sql);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('a VERKAUF for a BANNED customer is REFUSED (trust-level hard-block)', async () => {
      const h = helpers(sql);
      const cashier = await h.makeUser();
      const device = await h.makeDevice(cashier);
      const banned = await h.makeCustomer('BANNED', cashier);
      await expect(
        h.insertVerkauf({
          customerId: banned,
          cashierId: cashier,
          deviceId: device,
          totalEur: '100.00',
        }),
      ).rejects.toThrow(/Trust-level hard-block/);
    });

    it('an anonymous walk-in VERKAUF still inserts (no customer → no check)', async () => {
      const h = helpers(sql);
      const cashier = await h.makeUser();
      const device = await h.makeDevice(cashier);
      const id = await h.insertVerkauf({
        customerId: null,
        cashierId: cashier,
        deviceId: device,
        totalEur: '100.00',
      });
      expect(await h.countTx(id)).toBe(1);
    });

    it('a VERIFIED (non-BANNED) customer still inserts', async () => {
      const h = helpers(sql);
      const cashier = await h.makeUser();
      const device = await h.makeDevice(cashier);
      const ok = await h.makeCustomer('VERIFIED', cashier);
      const id = await h.insertVerkauf({
        customerId: ok,
        cashierId: cashier,
        deviceId: device,
        totalEur: '100.00',
      });
      expect(await h.countTx(id)).toBe(1);
    });

    it('the BANNED trigger function is owned by warehouse14_security (app cannot DROP it)', async () => {
      const [row] = await sql<{ owner: string }[]>`
        SELECT pg_get_userbyid(p.proowner) AS owner
          FROM pg_proc p
         WHERE p.proname = 'transactions_validate_trust_level'`;
      expect(must(row).owner).toBe('warehouse14_security');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// (B) Sanctions-persistence regression guard (route fix in
//     customers-check-sanctions.ts). Verified at 0059.
// ════════════════════════════════════════════════════════════════════════

describe('sanctions persistence — app can write sanctions_match, then the 0013 wall fires', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 59);
    // Make the 0059 file applied even if applyMigrations' upper bound changes.
    try {
      const fix = await readFile(FIX_SQL, 'utf8');
      await migratorSql.unsafe('SET check_function_bodies = off');
      await migratorSql.unsafe(fix);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await setAppPasswordForTest(migratorSql);
  }, 180_000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  // The route runs UPDATE customers SET sanctions_match=TRUE as warehouse14_app.
  // That can only work if the app role holds column-level UPDATE — granted in
  // 0007 §7. Prove it deterministically (no grant migration needed for this).
  it.each(['sanctions_match', 'sanctions_screened_at'])(
    'warehouse14_app can UPDATE customers.%s (the sanctions-route write)',
    async (column) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'customers', ${column}, 'UPDATE') AS has`;
      expect(must(row).has).toBe(true);
    },
  );

  it('after the app flips sanctions_match=TRUE, a transaction for that customer is BLOCKED', async () => {
    const h = helpers(migratorSql);
    const cashier = await h.makeUser();
    const device = await h.makeDevice(cashier);
    // VERIFIED so the KYC gate passes; BANNED gate untouched (VERIFIED ≠ BANNED).
    const customer = await h.makeCustomer('VERIFIED', cashier);

    // Sanity: clean customer can transact.
    const okId = await h.insertVerkauf({
      customerId: customer,
      cashierId: cashier,
      deviceId: device,
      totalEur: '100.00',
    });
    expect(await h.countTx(okId)).toBe(1);

    // The route's persistence step, run as the REAL app role.
    const appSql = testDb.appSql();
    try {
      await appSql`
        UPDATE customers
           SET sanctions_match = TRUE, sanctions_screened_at = now()
         WHERE id = ${customer} AND soft_deleted_at IS NULL`;
    } finally {
      await appSql.end({ timeout: 5 }).catch(() => {});
    }

    // Now the 0013 C-2 sanctions trigger must refuse the next sale.
    await expect(
      h.insertVerkauf({
        customerId: customer,
        cashierId: cashier,
        deviceId: device,
        totalEur: '100.00',
      }),
    ).rejects.toThrow(/Sanctions hard-block/);
  });
});
