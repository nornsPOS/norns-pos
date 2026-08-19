/**
 * Migration 0050 — GwG direction-aware KYC enforcement (Roman Grützner sign-off, binding).
 *
 * Exercises the un-bypassable BEFORE INSERT trigger `transactions_validate_kyc()`
 * against a REAL Postgres (testcontainers) — the one runtime verification the static
 * review could not run (memory §29.3):
 *   • ANKAUF  — the seller MUST be KYC-verified for EVERY buy from €0,01 (§259 StGB).
 *   • VERKAUF — the buyer MUST be KYC-verified at/above €2.000 (§10 GwG).
 *   • Storno  — a reversal of an already-validated transaction is never re-blocked.
 *
 * Mirrors `0013_security_hardening.test.ts` (the sanctions trigger this one is patterned
 * on). Inserts go through the migrator; the trigger is SECURITY DEFINER, so it fires
 * regardless of the inserting role.
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

/** Narrow `rows[0]` without a non-null assertion (biome noNonNullAssertion). */
function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('query returned no rows');
  return row;
}

describe('migration 0050_gwg_kyc_enforcement — direction-aware KYC trigger', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

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

  /** A customer with NO KYC stamp (kyc_verified_at NULL) — call verifyKyc to stamp it. */
  async function makeCustomer(): Promise<string> {
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until, sanctions_match)
      SELECT encrypt_pii('Test'), (now() + interval '5 years')::date, false FROM s
      RETURNING id`;
    return must(c).id;
  }

  /** Stamp the physical ID check (kyc_verified_at + verifier — both-or-none CHECK, 0024). */
  async function verifyKyc(customerId: string, verifierId: string): Promise<void> {
    await migratorSql`
      UPDATE customers SET kyc_verified_at = now(), kyc_verified_by_user_id = ${verifierId}
       WHERE id = ${customerId}`;
  }

  /** count(*) of a transaction id — proves the row PERSISTED past COMMIT. */
  async function countTx(id: string): Promise<number> {
    const [r] = await migratorSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM transactions WHERE id = ${id}`;
    return must(r).n;
  }

  /**
   * Insert a COMPLETE transaction (header + one item + one payment) in ONE DB
   * transaction. This is required because migration 0016 attaches a DEFERRABLE
   * INITIALLY DEFERRED constraint trigger (`verify_transaction_balance`) that
   * fires at COMMIT and RAISEs unless the row has matching items + payments — so
   * a header-only insert RESOLVES the statement but then ROLLS BACK at commit
   * (the real routes always insert header+items+payments atomically). The money
   * split is done in SQL NUMERIC (no JS float / parseFloat). On a storno, the
   * amounts negate exactly (same ROUND formula × −1), satisfying 0009's
   * `transactions_validate_storno`. The BEFORE-INSERT KYC trigger still fires on
   * the header insert; a RAISE there aborts the whole begin() block.
   */
  async function insertTx(opts: {
    direction: 'VERKAUF' | 'ANKAUF';
    customerId?: string | null;
    cashierId: string;
    deviceId: string;
    totalEur?: string;
    stornoOfId?: string | null;
  }): Promise<string> {
    const total = opts.totalEur ?? '100.00';
    const sign = opts.stornoOfId != null ? '-1' : '1';

    // A product to satisfy transaction_items.product_id (FK).
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
                                  storno_of_transaction_id, finalized_at)
        VALUES (${opts.direction}::transaction_direction, ${opts.customerId ?? null},
                ${opts.deviceId}, ${opts.cashierId},
                ROUND(${total}::numeric / 1.19, 2) * ${sign}::numeric,
                (${total}::numeric - ROUND(${total}::numeric / 1.19, 2)) * ${sign}::numeric,
                ${total}::numeric * ${sign}::numeric,
                'STANDARD_19', ${opts.stornoOfId ?? null}, ${new Date()})
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

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 50);
    await setAppPasswordForTest(migratorSql);
  }, 180_000);

  afterAll(async () => {
    await testDb.cleanup();
  });

  // ════════════════════════════════════════════════════════════════════
  // ANKAUF — identification required for EVERY buy (§259 StGB Hehlerei)
  // ════════════════════════════════════════════════════════════════════
  describe('ANKAUF — ID required for every buy from €0,01 (§259 StGB)', () => {
    it('ANKAUF with an UN-verified customer is REJECTED — even at €0,01', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const customer = await makeCustomer(); // never KYC-stamped
      await expect(
        insertTx({
          direction: 'ANKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: customer,
          totalEur: '0.01',
        }),
      ).rejects.toThrow(/KYC hard-block \(Ankauf\)/);
    });

    it('ANKAUF with a KYC-verified customer is allowed AND persists', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const customer = await makeCustomer();
      await verifyKyc(customer, cashier);
      const id = await insertTx({
        direction: 'ANKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: customer,
        totalEur: '0.01',
      });
      expect(await countTx(id)).toBe(1); // proves it survived COMMIT, not just the BEFORE-gate
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // VERKAUF — identification required at/above €2.000 (§10 GwG)
  // ════════════════════════════════════════════════════════════════════
  describe('VERKAUF — ID required at/above €2.000 (§10 GwG)', () => {
    it('VERKAUF below €2.000 with NO customer is allowed AND persists (anonymous Tafelgeschäft)', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const id = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
        totalEur: '1999.99',
      });
      expect(await countTx(id)).toBe(1);
    });

    it('VERKAUF at exactly €2.000 with NO customer is REJECTED', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      await expect(
        insertTx({
          direction: 'VERKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: null,
          totalEur: '2000.00',
        }),
      ).rejects.toThrow(/KYC hard-block \(Verkauf\)/);
    });

    it('VERKAUF ≥ €2.000 with an UN-verified customer is REJECTED', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const customer = await makeCustomer();
      await expect(
        insertTx({
          direction: 'VERKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: customer,
          totalEur: '5000.00',
        }),
      ).rejects.toThrow(/KYC hard-block \(Verkauf\)/);
    });

    it('VERKAUF ≥ €2.000 with a KYC-verified customer is allowed AND persists', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const customer = await makeCustomer();
      await verifyKyc(customer, cashier);
      const id = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: customer,
        totalEur: '2000.00',
      });
      expect(await countTx(id)).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Storno bypass — a reversal is NEVER re-blocked, even if the customer was
  // later un-verified (the trigger's first branch: storno IS NOT NULL → RETURN NEW)
  // ════════════════════════════════════════════════════════════════════
  describe('Storno — never re-blocked even after the customer is un-verified', () => {
    it('an ANKAUF storno INSERTS OK although the seller is now kyc_verified_at NULL', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const customer = await makeCustomer();
      await verifyKyc(customer, cashier);

      // 1. Original ANKAUF with a verified seller — persists.
      const originalId = await insertTx({
        direction: 'ANKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: customer,
        totalEur: '100.00',
      });
      expect(await countTx(originalId)).toBe(1);

      // 2. The seller's ID verification later lapses (both-or-none, 0024).
      await migratorSql`
        UPDATE customers SET kyc_verified_at = NULL, kyc_verified_by_user_id = NULL
         WHERE id = ${customer}`;

      // 3. The reversal must still go through (the KYC gate skips stornos). Amounts
      //    negate the original exactly (same ROUND × −1) to satisfy validate_storno.
      const stornoId = await insertTx({
        direction: 'ANKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: customer,
        totalEur: '100.00',
        stornoOfId: originalId,
      });
      expect(await countTx(stornoId)).toBe(1);
    });
  });
});
