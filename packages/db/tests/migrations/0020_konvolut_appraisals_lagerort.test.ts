/**
 * Migration 0020 — Konvolut + Appraisals + Lagerort.
 *
 * Focused tests:
 *   • products.parent_product_id 1-level depth enforced by trigger
 *   • parent_product_id ≠ id (no self-loop)
 *   • a row with children cannot also become a child
 *   • Lagerort columns persisted; index exists
 *   • appraisal_status enum + appraisals CHECKs (ACCEPTED requires evidence)
 *   • appraisal_items insert / sequence persisted
 *   • app role grants — narrow column UPDATEs
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

describe('migration 0020_konvolut_appraisals_lagerort', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;

  async function makeUser(role: 'ADMIN' | 'CASHIER' = 'ADMIN'): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', ${role}::user_role)
      RETURNING id`;
    return u!.id;
  }

  async function makeCustomer(): Promise<string> {
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii(${`Customer-${crypto.randomUUID()}`}),
             (now() + interval '5 years')::date FROM s
      RETURNING id`;
    return c!.id;
  }

  async function makeProduct(opts: { parentId?: string | null } = {}): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name,
                            parent_product_id)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
              'gold_coin'::item_type, '100.00', '150.00', 'Test piece',
              ${opts.parentId ?? null})
      RETURNING id`;
    return p!.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 20);
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
  // 1. Konvolut (parent_product_id)
  // ────────────────────────────────────────────────────────────────────

  describe('parent_product_id 1-level depth', () => {
    it('top-level (NULL parent) is fine', async () => {
      await expect(makeProduct()).resolves.toBeDefined();
    });

    it('1 level deep (parent → child) is fine', async () => {
      const parent = await makeProduct();
      await expect(makeProduct({ parentId: parent })).resolves.toBeDefined();
    });

    it('refuses parent_product_id = self', async () => {
      const id = await makeProduct();
      await expect(
        migratorSql`UPDATE products SET parent_product_id = ${id} WHERE id = ${id}`,
      ).rejects.toThrow(/cannot point to self|check_violation/);
    });

    it('refuses 3-level nesting (grandparent rule)', async () => {
      const lvl1 = await makeProduct();
      const lvl2 = await makeProduct({ parentId: lvl1 });
      // Try to make lvl3 with lvl2 as parent — lvl2 already has a parent → refuse.
      await expect(makeProduct({ parentId: lvl2 })).rejects.toThrow(/depth limit exceeded/);
    });

    it('refuses re-parenting: a row with children cannot also be a child', async () => {
      const parent = await makeProduct();
      await makeProduct({ parentId: parent }); // parent now has 1 child
      const newGrandparent = await makeProduct();
      // Trying to set parent.parent_product_id = newGrandparent → would create depth.
      await expect(
        migratorSql`UPDATE products SET parent_product_id = ${newGrandparent} WHERE id = ${parent}`,
      ).rejects.toThrow(/already has children|depth limit exceeded/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Lagerort columns
  // ────────────────────────────────────────────────────────────────────

  describe('Lagerort columns', () => {
    it('persists 3-column location + timestamp', async () => {
      const id = await makeProduct();
      await migratorSql`
        UPDATE products
           SET location_storage_unit = 'Tresor-1',
               location_drawer = 'Fach-3',
               location_position = 'Position-12',
               location_assigned_at = now()
         WHERE id = ${id}`;
      const [row] = await migratorSql<
        {
          location_storage_unit: string;
          location_drawer: string;
          location_position: string;
          location_assigned_at: Date;
        }[]
      >`SELECT location_storage_unit, location_drawer, location_position, location_assigned_at
             FROM products WHERE id = ${id}`;
      expect(row!.location_storage_unit).toBe('Tresor-1');
      expect(row!.location_drawer).toBe('Fach-3');
      expect(row!.location_position).toBe('Position-12');
      expect(row!.location_assigned_at).toBeInstanceOf(Date);
    });

    it('partial index products_location_idx exists', async () => {
      const rows = await migratorSql<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
         WHERE tablename = 'products' AND indexname = 'products_location_idx'`;
      expect(rows.length).toBe(1);
    });

    it('app role can UPDATE location columns', async () => {
      const id = await makeProduct();
      await expect(
        appSql`UPDATE products SET location_storage_unit = 'Lager-A' WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. appraisals — enum + CHECKs
  // ────────────────────────────────────────────────────────────────────

  describe('appraisals', () => {
    it('enum has 5 expected labels', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'appraisal_status' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'DRAFT',
        'COMPLETED',
        'ACCEPTED',
        'REJECTED',
        'EXPIRED',
      ]);
    });

    it('accepts a DRAFT appraisal', async () => {
      const userId = await makeUser();
      const customerId = await makeCustomer();
      const [a] = await migratorSql<{ id: string }[]>`
        INSERT INTO appraisals (customer_id, appraised_by_user_id)
        VALUES (${customerId}, ${userId})
        RETURNING id`;
      expect(a!.id).toBeDefined();
    });

    it('refuses ACCEPTED without ankauf_transaction_id', async () => {
      const userId = await makeUser();
      const customerId = await makeCustomer();
      const [a] = await migratorSql<{ id: string }[]>`
        INSERT INTO appraisals (customer_id, appraised_by_user_id, total_offered_eur)
        VALUES (${customerId}, ${userId}, '5000.00')
        RETURNING id`;
      await expect(
        migratorSql`
          UPDATE appraisals
             SET status = 'ACCEPTED'::appraisal_status,
                 accepted_at = now(),
                 completed_at = now()
           WHERE id = ${a!.id}`,
      ).rejects.toThrow(/appraisals_accepted_has_evidence/);
    });

    it('refuses REJECTED without rejection_reason', async () => {
      const userId = await makeUser();
      const customerId = await makeCustomer();
      const [a] = await migratorSql<{ id: string }[]>`
        INSERT INTO appraisals (customer_id, appraised_by_user_id)
        VALUES (${customerId}, ${userId})
        RETURNING id`;
      await expect(
        migratorSql`
          UPDATE appraisals
             SET status = 'REJECTED'::appraisal_status,
                 rejected_at = now(),
                 completed_at = now()
           WHERE id = ${a!.id}`,
      ).rejects.toThrow(/appraisals_rejected_has_reason/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. appraisal_items
  // ────────────────────────────────────────────────────────────────────

  describe('appraisal_items', () => {
    it('persists basic line with appraised value', async () => {
      const userId = await makeUser();
      const customerId = await makeCustomer();
      const [a] = await migratorSql<{ id: string }[]>`
        INSERT INTO appraisals (customer_id, appraised_by_user_id)
        VALUES (${customerId}, ${userId})
        RETURNING id`;
      const [item] = await migratorSql<{ id: string; sequence_in_lot: number }[]>`
        INSERT INTO appraisal_items (
          appraisal_id, sequence_in_lot, name, item_type,
          metal, fineness_decimal, weight_grams, individual_appraised_eur)
        VALUES (${a!.id}, 0, '1oz Krugerrand', 'gold_coin'::item_type,
                'gold', 0.9170, 33.93, '1850.00')
        RETURNING id, sequence_in_lot`;
      expect(item!.id).toBeDefined();
      expect(item!.sequence_in_lot).toBe(0);
    });

    it('refuses negative individual_appraised_eur', async () => {
      const userId = await makeUser();
      const customerId = await makeCustomer();
      const [a] = await migratorSql<{ id: string }[]>`
        INSERT INTO appraisals (customer_id, appraised_by_user_id)
        VALUES (${customerId}, ${userId})
        RETURNING id`;
      await expect(
        migratorSql`
          INSERT INTO appraisal_items (appraisal_id, name, item_type, individual_appraised_eur)
          VALUES (${a!.id}, 'bad', 'gold_coin'::item_type, '-1.00')`,
      ).rejects.toThrow(/individual_appraised_eur_check|individual_appraised_eur >=/);
    });
  });
});
