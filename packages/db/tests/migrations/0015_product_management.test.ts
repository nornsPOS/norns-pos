/**
 * Migration 0015 — Product Management.
 *
 * Focused tests for the schema-level invariants from ADR-0023:
 *   • product_condition enum (6 values present)
 *   • is_commission default FALSE; intake-locked (app role cannot UPDATE)
 *   • acquired_from_customer_id intake-locked (app role cannot UPDATE)
 *   • archived_at CHECK: archived ⇒ status=SOLD
 *   • archived_at CHECK: archived_at ≥ sold_at
 *   • App role grants — condition + archived_at writable; intake-locked refused
 *   • Indexes exist (smoke check)
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

describe('migration 0015_product_management', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;

  /** Seed a product via the migrator (bypasses app grants). */
  async function makeProduct(
    opts: {
      isCommission?: boolean;
      acquiredFrom?: string | null;
      condition?:
        | 'NEW'
        | 'USED_EXCELLENT'
        | 'USED_GOOD'
        | 'USED_FAIR'
        | 'ANTIQUE_RESTORED'
        | 'ANTIQUE_AS_FOUND';
      status?: 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';
      soldAt?: Date | null;
    } = {},
  ): Promise<string> {
    const status = opts.status ?? 'DRAFT';
    const publishedAt = status !== 'DRAFT' ? new Date() : null;
    const soldAt = opts.soldAt ?? (status === 'SOLD' ? new Date() : null);
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name,
                            condition, is_commission, acquired_from_customer_id,
                            published_at, sold_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, ${status}::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '50.00', '150.00', 'Day-15 test ring',
              ${(opts.condition ?? 'USED_GOOD') as string}::product_condition,
              ${opts.isCommission ?? false},
              ${opts.acquiredFrom ?? null},
              ${publishedAt}, ${soldAt})
      RETURNING id`;
    return p!.id;
  }

  async function makeCustomer(): Promise<string> {
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Day-15 seller'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    return c!.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 15);
    await setAppPasswordForTest(migratorSql);
    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 3,
      onnotice: () => {},
    });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. product_condition enum
  // ────────────────────────────────────────────────────────────────────

  describe('product_condition enum', () => {
    it('exposes 6 expected labels', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'product_condition'
         ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'NEW',
        'USED_EXCELLENT',
        'USED_GOOD',
        'USED_FAIR',
        'ANTIQUE_RESTORED',
        'ANTIQUE_AS_FOUND',
      ]);
    });

    it('rejects an unknown enum value', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name, condition)
          VALUES ('BAD-1', 'DRAFT'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  '50.00', '150.00', 'x', 'PRISTINE_MINT'::product_condition)`,
      ).rejects.toThrow(/invalid input value for enum product_condition/);
    });

    it('defaults to USED_GOOD when not supplied', async () => {
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name)
        VALUES (${`SKU-default-${crypto.randomUUID()}`}, 'DRAFT'::product_status,
                'MARGIN_25A', 'gold_jewelry'::item_type, '10.00', '20.00', 'x')
        RETURNING id`;
      const [row] = await migratorSql<{ condition: string }[]>`
        SELECT condition FROM products WHERE id = ${p!.id}`;
      expect(row!.condition).toBe('USED_GOOD');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. is_commission flag
  // ────────────────────────────────────────────────────────────────────

  describe('is_commission flag', () => {
    it('defaults to FALSE', async () => {
      const id = await makeProduct();
      const [row] = await migratorSql<{ is_commission: boolean }[]>`
        SELECT is_commission FROM products WHERE id = ${id}`;
      expect(row!.is_commission).toBe(false);
    });

    it('persists TRUE when supplied', async () => {
      const id = await makeProduct({ isCommission: true });
      const [row] = await migratorSql<{ is_commission: boolean }[]>`
        SELECT is_commission FROM products WHERE id = ${id}`;
      expect(row!.is_commission).toBe(true);
    });

    it('is intake-locked: app role CANNOT UPDATE is_commission', async () => {
      const id = await makeProduct({ isCommission: false });
      await expect(
        appSql`UPDATE products SET is_commission = TRUE WHERE id = ${id}`,
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. acquired_from_customer_id
  // ────────────────────────────────────────────────────────────────────

  describe('acquired_from_customer_id', () => {
    it('persists FK + retrievable per customer', async () => {
      const sellerId = await makeCustomer();
      const id = await makeProduct({ acquiredFrom: sellerId });
      const rows = await migratorSql<{ id: string }[]>`
        SELECT id FROM products WHERE acquired_from_customer_id = ${sellerId}`;
      expect(rows.map((r) => r.id)).toContain(id);
    });

    it('refuses unknown customer (FK violation)', async () => {
      await expect(
        makeProduct({ acquiredFrom: '00000000-0000-0000-0000-000000000000' }),
      ).rejects.toThrow(/foreign key constraint/i);
    });

    it('is intake-locked: app role CANNOT UPDATE acquired_from_customer_id', async () => {
      const id = await makeProduct();
      const sellerId = await makeCustomer();
      await expect(
        appSql`UPDATE products SET acquired_from_customer_id = ${sellerId} WHERE id = ${id}`,
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. archived_at CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('archived_at CHECKs', () => {
    it('rejects archiving a DRAFT product', async () => {
      const id = await makeProduct({ status: 'DRAFT' });
      await expect(
        migratorSql`UPDATE products SET archived_at = now() WHERE id = ${id}`,
      ).rejects.toThrow(/products_archived_only_when_sold/);
    });

    it('rejects archiving an AVAILABLE product', async () => {
      const id = await makeProduct({ status: 'AVAILABLE' });
      await expect(
        migratorSql`UPDATE products SET archived_at = now() WHERE id = ${id}`,
      ).rejects.toThrow(/products_archived_only_when_sold/);
    });

    it('accepts archiving a SOLD product', async () => {
      const id = await makeProduct({ status: 'SOLD' });
      await migratorSql`UPDATE products SET archived_at = now() WHERE id = ${id}`;
      const [row] = await migratorSql<{ archived_at: Date }[]>`
        SELECT archived_at FROM products WHERE id = ${id}`;
      expect(row!.archived_at).toBeInstanceOf(Date);
    });

    it('refuses archived_at < sold_at (time travel)', async () => {
      const soldAt = new Date('2026-05-25T12:00:00Z');
      const id = await makeProduct({ status: 'SOLD', soldAt });
      // Try to archive BEFORE sold_at.
      await expect(
        migratorSql`UPDATE products SET archived_at = '2026-05-25 11:00:00+00'::timestamptz WHERE id = ${id}`,
      ).rejects.toThrow(/products_archived_after_sold_at/);
    });

    it('app role CAN UPDATE archived_at (Owner archives manually)', async () => {
      const id = await makeProduct({ status: 'SOLD' });
      await expect(
        appSql`UPDATE products SET archived_at = now() WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. condition is app-mutable (Owner re-grades after restoration)
  // ────────────────────────────────────────────────────────────────────

  describe('app role grants for new columns', () => {
    it('app CAN UPDATE condition', async () => {
      const id = await makeProduct({ condition: 'USED_FAIR' });
      await expect(
        appSql`UPDATE products SET condition = 'USED_GOOD'::product_condition WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Indexes exist
  // ────────────────────────────────────────────────────────────────────

  describe('indexes', () => {
    it.each([
      'products_acquired_from_customer_idx',
      'products_active_idx',
      'products_archived_idx',
      'products_commission_active_idx',
      'products_condition_available_idx',
    ])('index %s exists', async (idxName) => {
      const rows = await migratorSql<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
         WHERE tablename = 'products' AND indexname = ${idxName}`;
      expect(rows.length).toBe(1);
    });
  });
});
