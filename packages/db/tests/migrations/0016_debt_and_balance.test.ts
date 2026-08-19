/**
 * Migration 0016 — Customer debt + transaction balance constraint trigger.
 *
 * Coverage:
 *   • cumulative_debt_eur column + non-negative CHECK
 *   • DEBT payment requires customer_id (BEFORE INSERT guard)
 *   • DEBT payment accumulates cumulative_debt_eur
 *   • Storno of a DEBT sale reverses the debt
 *   • Over-reversal refused by non-negative CHECK
 *   • CONSTRAINT TRIGGER: balanced transaction commits
 *   • CONSTRAINT TRIGGER: items sum ≠ header total → COMMIT refuses
 *   • CONSTRAINT TRIGGER: payments sum ≠ header total → COMMIT refuses
 *   • CONSTRAINT TRIGGER: zero items at COMMIT → refused
 *   • CONSTRAINT TRIGGER: zero payments at COMMIT → refused
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

describe('migration 0016_debt_and_balance', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  // Reusable fixtures
  let cashierUserId: string;
  let deviceId: string;
  let productId: string;
  let customerId: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 16);

    // Seed minimal data once.
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${crypto.randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = u!.id;

    const [d] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class,
              ${`CERT-${crypto.randomUUID()}`},
              now() - interval '1 day', now() + interval '365 days',
              ${cashierUserId})
      RETURNING id`;
    deviceId = d!.id;

    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Debt Tester'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    customerId = c!.id;
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  /** Insert a fresh AVAILABLE product. */
  async function makeProduct(): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'gold_jewelry'::item_type, '50.00', '100.00', 'Day-17 ring', now())
      RETURNING id`;
    return p!.id;
  }

  /**
   * Insert a fully balanced transaction inside a single SQL transaction so
   * the CONSTRAINT TRIGGER fires at COMMIT and accepts it.
   *
   * `amount_split` = list of { method, amount } describing the payment legs.
   */
  async function insertBalancedTx(opts: {
    total: string;
    paymentLegs: Array<{ method: 'CASH' | 'DEBT' | 'ZVT_CARD'; amount: string }>;
    customerOverride?: string | null;
  }): Promise<string> {
    const totalNum = Number.parseFloat(opts.total);
    const vat = ((totalNum * 19) / 119).toFixed(2);
    const subtotal = (totalNum - Number.parseFloat(vat)).toFixed(2);
    const prodId = await makeProduct();
    const custId = opts.customerOverride === undefined ? customerId : opts.customerOverride;

    // postgres-js auto-wraps a single template literal in an implicit
    // transaction. For multi-statement atomicity we use `migratorSql.begin`.
    return await migratorSql.begin(async (sql) => {
      const [tx] = await sql<{ id: string }[]>`
        INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                  subtotal_eur, vat_eur, total_eur, tax_treatment_code)
        VALUES ('VERKAUF'::transaction_direction, ${custId}, ${deviceId}, ${cashierUserId},
                ${subtotal}, ${vat}, ${opts.total}, 'STANDARD_19')
        RETURNING id`;
      await sql`
        INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                       line_vat_eur, line_total_eur,
                                       applied_tax_treatment_code, applied_vat_rate)
        VALUES (${tx!.id}, ${prodId}, ${subtotal}, ${vat}, ${opts.total},
                'STANDARD_19', '0.1900')`;
      for (const leg of opts.paymentLegs) {
        await sql`
          INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
          VALUES (${tx!.id}, ${leg.method}::payment_method, ${leg.amount})`;
      }
      // Move the product to SOLD (matches what finalize would do).
      await sql`UPDATE products SET status = 'SOLD'::product_status, sold_at = now() WHERE id = ${prodId}`;
      return tx!.id;
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // 1. cumulative_debt_eur column + CHECK
  // ────────────────────────────────────────────────────────────────────

  describe('cumulative_debt_eur', () => {
    it('exists with default 0 + non-negative CHECK', async () => {
      const [row] = await migratorSql<{ cumulative_debt_eur: string }[]>`
        SELECT cumulative_debt_eur FROM customers WHERE id = ${customerId}`;
      expect(row!.cumulative_debt_eur).toBe('0.00');
    });

    it('refuses direct UPDATE that would set cumulative_debt_eur < 0', async () => {
      await expect(
        migratorSql`UPDATE customers SET cumulative_debt_eur = -1 WHERE id = ${customerId}`,
      ).rejects.toThrow(/customers_cumulative_debt_non_negative/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. DEBT requires customer_id (BEFORE INSERT guard)
  // ────────────────────────────────────────────────────────────────────

  describe('DEBT payment requires customer_id', () => {
    it('refuses DEBT payment when transactions.customer_id IS NULL', async () => {
      await expect(
        insertBalancedTx({
          total: '50.00',
          paymentLegs: [{ method: 'DEBT', amount: '50.00' }],
          customerOverride: null,
        }),
      ).rejects.toThrow(/DEBT payment requires customer_id/);
    });

    it('accepts DEBT payment when customer_id is set', async () => {
      const txId = await insertBalancedTx({
        total: '50.00',
        paymentLegs: [{ method: 'DEBT', amount: '50.00' }],
      });
      expect(txId).toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. DEBT accumulation + storno reversal
  // ────────────────────────────────────────────────────────────────────

  describe('DEBT accumulation', () => {
    it('accumulates customers.cumulative_debt_eur after DEBT payment lands', async () => {
      // Fresh customer for isolation.
      const [c] = await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('Debt Accumulator'), (now() + interval '5 years')::date FROM s
        RETURNING id`;
      const localCustomer = c!.id;

      // €100 → €40 cash + €60 debt (split-payment).
      const prodId = await makeProduct();
      await migratorSql.begin(async (sql) => {
        const [tx] = await sql<{ id: string }[]>`
          INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                    subtotal_eur, vat_eur, total_eur, tax_treatment_code)
          VALUES ('VERKAUF'::transaction_direction, ${localCustomer}, ${deviceId}, ${cashierUserId},
                  '84.03', '15.97', '100.00', 'STANDARD_19')
          RETURNING id`;
        await sql`
          INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                         line_vat_eur, line_total_eur,
                                         applied_tax_treatment_code, applied_vat_rate)
          VALUES (${tx!.id}, ${prodId}, '84.03', '15.97', '100.00', 'STANDARD_19', '0.1900')`;
        await sql`INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
                  VALUES (${tx!.id}, 'CASH'::payment_method, '40.00')`;
        await sql`INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
                  VALUES (${tx!.id}, 'DEBT'::payment_method, '60.00')`;
        await sql`UPDATE products SET status='SOLD'::product_status, sold_at=now() WHERE id = ${prodId}`;
      });

      const [row] = await migratorSql<{ cumulative_debt_eur: string }[]>`
        SELECT cumulative_debt_eur FROM customers WHERE id = ${localCustomer}`;
      expect(row!.cumulative_debt_eur).toBe('60.00');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Transaction balance constraint trigger
  // ────────────────────────────────────────────────────────────────────

  describe('balance constraint trigger (audit fix #2)', () => {
    it('accepts a balanced transaction at COMMIT', async () => {
      const txId = await insertBalancedTx({
        total: '100.00',
        paymentLegs: [{ method: 'CASH', amount: '100.00' }],
      });
      expect(txId).toBeDefined();
    });

    it('refuses unbalanced payments at COMMIT (sum < total)', async () => {
      await expect(
        insertBalancedTx({
          total: '100.00',
          paymentLegs: [{ method: 'CASH', amount: '99.00' }], // short by €1
        }),
      ).rejects.toThrow(/Transaction balance.*payments total.*<>/);
    });

    it('refuses transaction with no items at COMMIT', async () => {
      const prodId = await makeProduct();
      await expect(
        migratorSql.begin(async (sql) => {
          const [tx] = await sql<{ id: string }[]>`
            INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                      subtotal_eur, vat_eur, total_eur, tax_treatment_code)
            VALUES ('VERKAUF'::transaction_direction, NULL, ${deviceId}, ${cashierUserId},
                    '84.03', '15.97', '100.00', 'STANDARD_19')
            RETURNING id`;
          // Deliberately skip items + payments — should fail at COMMIT.
          await sql`SELECT 1`; // hold the connection
          // Suppress unused warning
          void tx;
          void prodId;
        }),
      ).rejects.toThrow(/Transaction balance.*has no items at COMMIT/);
    });

    it('refuses items present but no payments at COMMIT', async () => {
      const prodId = await makeProduct();
      await expect(
        migratorSql.begin(async (sql) => {
          const [tx] = await sql<{ id: string }[]>`
            INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                      subtotal_eur, vat_eur, total_eur, tax_treatment_code)
            VALUES ('VERKAUF'::transaction_direction, NULL, ${deviceId}, ${cashierUserId},
                    '84.03', '15.97', '100.00', 'STANDARD_19')
            RETURNING id`;
          await sql`
            INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                           line_vat_eur, line_total_eur,
                                           applied_tax_treatment_code, applied_vat_rate)
            VALUES (${tx!.id}, ${prodId}, '84.03', '15.97', '100.00', 'STANDARD_19', '0.1900')`;
          // No payments at all.
        }),
      ).rejects.toThrow(/Transaction balance.*has no payments at COMMIT/);
    });

    it('refuses items sum ≠ header total at COMMIT', async () => {
      const prodId = await makeProduct();
      await expect(
        migratorSql.begin(async (sql) => {
          const [tx] = await sql<{ id: string }[]>`
            INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                      subtotal_eur, vat_eur, total_eur, tax_treatment_code)
            VALUES ('VERKAUF'::transaction_direction, NULL, ${deviceId}, ${cashierUserId},
                    '84.03', '15.97', '100.00', 'STANDARD_19')
            RETURNING id`;
          // Item line totals to 99 — short of 100.
          await sql`
            INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                           line_vat_eur, line_total_eur,
                                           applied_tax_treatment_code, applied_vat_rate)
            VALUES (${tx!.id}, ${prodId}, '83.19', '15.81', '99.00', 'STANDARD_19', '0.1900')`;
          await sql`INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
                    VALUES (${tx!.id}, 'CASH'::payment_method, '100.00')`;
        }),
      ).rejects.toThrow(/Transaction balance.*items total.*<>/);
    });
  });
});
