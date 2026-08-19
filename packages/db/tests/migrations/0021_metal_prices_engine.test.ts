/**
 * Migration 0021 — Edelmetall-Kursmodul.
 *
 * Focused tests:
 *   • metal_price_source enum labels (4 expected)
 *   • metal_prices CHECK constraints (metal whitelist, positive price,
 *     valid_to > valid_from, MANUAL requires evidence, JSON object payload)
 *   • partial UNIQUE: exactly one CURRENT row per metal
 *   • close-out + insert pattern (UPDATE valid_to → INSERT new)
 *   • products.feingewicht_grams GENERATED ALWAYS (weight × fineness),
 *     NULL when either operand missing, refuses direct UPDATE, re-computes
 *     when underlying weight changes
 *   • products.collector_premium_eur CHECK ≥ 0
 *   • current_metal_price_eur_per_gram(metal) — current price / NULL when no row
 *   • product_schmelzwert_eur(product_id) — math + NULL cascades
 *   • role grants — app may UPDATE only valid_to + collector_premium_eur,
 *     worker may INSERT + UPDATE(valid_to)
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0021_metal_prices_engine', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  let workerSql: Sql;

  async function makeUser(role: 'ADMIN' | 'CASHIER' = 'ADMIN'): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', ${role}::user_role)
      RETURNING id`;
    return u!.id;
  }

  async function makeProduct(
    opts: {
      metal?: string | null;
      weight?: string | null;
      fineness?: string | null;
    } = {},
  ): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type, name,
                            acquisition_cost_eur, list_price_eur,
                            metal, weight_grams, fineness_decimal)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
              'gold_coin'::item_type, 'Test piece', '100.00', '150.00',
              ${opts.metal ?? null},
              ${opts.weight ?? null},
              ${opts.fineness ?? null})
      RETURNING id`;
    return p!.id;
  }

  /** Helper: insert the CURRENT price row for a metal. */
  async function setCurrentPrice(metal: string, pricePerGram: string): Promise<bigint> {
    const [r] = await migratorSql<{ id: string }[]>`
      INSERT INTO metal_prices (metal, price_per_gram_eur, source)
      VALUES (${metal}, ${pricePerGram}, 'LBMA'::metal_price_source)
      RETURNING id`;
    return BigInt(r!.id);
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 21);
    await setAppPasswordForTest(migratorSql);

    // Worker role exists since migration 0017 — set its password for tests.
    await migratorSql.unsafe(`ALTER ROLE warehouse14_worker PASSWORD 'warehouse14_worker_test_pw'`);

    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 3,
      onnotice: () => {},
    });
    workerSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_worker',
      password: 'warehouse14_worker_test_pw',
      max: 3,
      onnotice: () => {},
    });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await workerSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. metal_price_source enum
  // ────────────────────────────────────────────────────────────────────

  describe('metal_price_source enum', () => {
    it('has 4 expected labels', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'metal_price_source' ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([
        'LBMA',
        'XAUEUR_VENDOR',
        'MANUAL',
        'INTERNAL_ESTIMATE',
      ]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. metal_prices CHECK constraints
  // ────────────────────────────────────────────────────────────────────

  describe('metal_prices CHECK constraints', () => {
    it('accepts a basic LBMA row', async () => {
      const [r] = await migratorSql<{ id: string; metal: string }[]>`
        INSERT INTO metal_prices (metal, price_per_gram_eur, source)
        VALUES ('gold', '62.50', 'LBMA'::metal_price_source)
        RETURNING id, metal`;
      expect(r!.metal).toBe('gold');
      // Cleanup so it does not interfere with one-current tests below.
      await migratorSql`DELETE FROM metal_prices WHERE id = ${r!.id}`;
    });

    it('refuses unknown metal', async () => {
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source)
          VALUES ('rhodium', '500.00', 'LBMA'::metal_price_source)`,
      ).rejects.toThrow(/metal_prices_metal_check|check constraint/);
    });

    it('refuses zero or negative price', async () => {
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source)
          VALUES ('silver', '0', 'LBMA'::metal_price_source)`,
      ).rejects.toThrow(/price_per_gram_eur|check constraint/);
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source)
          VALUES ('silver', '-1', 'LBMA'::metal_price_source)`,
      ).rejects.toThrow(/price_per_gram_eur|check constraint/);
    });

    it('refuses valid_to <= valid_from', async () => {
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source, valid_from, valid_to)
          VALUES ('platinum', '30.00', 'LBMA'::metal_price_source,
                  '2026-01-01 12:00:00+00', '2026-01-01 11:00:00+00')`,
      ).rejects.toThrow(/metal_prices_valid_range/);
    });

    it('refuses MANUAL without user_id + reason', async () => {
      // No user, no reason
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source)
          VALUES ('palladium', '40.00', 'MANUAL'::metal_price_source)`,
      ).rejects.toThrow(/metal_prices_manual_evidence/);
      // Only reason
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source, manual_override_reason)
          VALUES ('palladium', '40.00', 'MANUAL'::metal_price_source, 'oops')`,
      ).rejects.toThrow(/metal_prices_manual_evidence/);
      // Only user_id
      const userId = await makeUser();
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source, manual_override_by_user_id)
          VALUES ('palladium', '40.00', 'MANUAL'::metal_price_source, ${userId})`,
      ).rejects.toThrow(/metal_prices_manual_evidence/);
    });

    it('accepts MANUAL with both user_id + reason', async () => {
      const userId = await makeUser();
      const [r] = await migratorSql<{ id: string }[]>`
        INSERT INTO metal_prices (metal, price_per_gram_eur, source,
                                  manual_override_by_user_id, manual_override_reason)
        VALUES ('palladium', '40.00', 'MANUAL'::metal_price_source,
                ${userId}, 'LBMA outage — owner override')
        RETURNING id`;
      expect(r!.id).toBeDefined();
      await migratorSql`DELETE FROM metal_prices WHERE id = ${r!.id}`;
    });

    it('refuses non-object source_payload', async () => {
      await expect(
        migratorSql`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source, source_payload)
          VALUES ('silver', '0.80', 'LBMA'::metal_price_source, '"not an object"'::jsonb)`,
      ).rejects.toThrow(/metal_prices_payload_object/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. One-current-per-metal (partial UNIQUE)
  // ────────────────────────────────────────────────────────────────────

  describe('one-current-per-metal partial UNIQUE', () => {
    it('refuses a second CURRENT row for the same metal', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
      await setCurrentPrice('gold', '62.00');
      await expect(setCurrentPrice('gold', '63.00')).rejects.toThrow(
        /metal_prices_one_current_per_metal_uq|duplicate key/,
      );
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
    });

    it('allows two CURRENTs for DIFFERENT metals', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal IN ('gold','silver')`;
      await expect(setCurrentPrice('gold', '62.00')).resolves.toBeDefined();
      await expect(setCurrentPrice('silver', '0.80')).resolves.toBeDefined();
      await migratorSql`DELETE FROM metal_prices WHERE metal IN ('gold','silver')`;
    });

    it('close-out + insert pattern: UPDATE valid_to first, then INSERT new', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
      const firstId = await setCurrentPrice('gold', '62.00');

      // Single transaction: close out → insert new
      await migratorSql.begin(async (tx) => {
        await tx`UPDATE metal_prices SET valid_to = now() WHERE id = ${firstId.toString()}`;
        await tx`
          INSERT INTO metal_prices (metal, price_per_gram_eur, source)
          VALUES ('gold', '63.50', 'LBMA'::metal_price_source)`;
      });

      const rows = await migratorSql<{ price_per_gram_eur: string; valid_to: Date | null }[]>`
        SELECT price_per_gram_eur, valid_to FROM metal_prices
         WHERE metal = 'gold' ORDER BY valid_from`;
      expect(rows.length).toBe(2);
      expect(rows[0]!.valid_to).not.toBeNull();
      expect(rows[1]!.valid_to).toBeNull();
      expect(rows[1]!.price_per_gram_eur).toBe('63.5000');
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. products.feingewicht_grams (GENERATED STORED)
  // ────────────────────────────────────────────────────────────────────

  describe('products.feingewicht_grams (GENERATED)', () => {
    it('auto-computes when both weight + fineness are set', async () => {
      const id = await makeProduct({ metal: 'gold', weight: '31.1035', fineness: '0.9999' });
      const [row] = await migratorSql<{ feingewicht_grams: string }[]>`
        SELECT feingewicht_grams FROM products WHERE id = ${id}`;
      // 31.1035 × 0.9999 = 31.10038965 → NUMERIC(10,4) keeps 4 decimals.
      expect(row!.feingewicht_grams).toBe('31.1004');
    });

    it('is NULL when fineness is missing', async () => {
      const id = await makeProduct({ metal: 'gold', weight: '10.0000', fineness: null });
      const [row] = await migratorSql<{ feingewicht_grams: string | null }[]>`
        SELECT feingewicht_grams FROM products WHERE id = ${id}`;
      expect(row!.feingewicht_grams).toBeNull();
    });

    it('is NULL when weight is missing', async () => {
      const id = await makeProduct({ metal: 'gold', weight: null, fineness: '0.9170' });
      const [row] = await migratorSql<{ feingewicht_grams: string | null }[]>`
        SELECT feingewicht_grams FROM products WHERE id = ${id}`;
      expect(row!.feingewicht_grams).toBeNull();
    });

    it('refuses direct UPDATE of feingewicht_grams (GENERATED is read-only)', async () => {
      const id = await makeProduct({ metal: 'gold', weight: '10.0000', fineness: '0.9170' });
      await expect(
        migratorSql`UPDATE products SET feingewicht_grams = '99.9999' WHERE id = ${id}`,
      ).rejects.toThrow(/generated column|cannot be assigned|generation expression/);
    });

    it('re-computes when underlying weight changes', async () => {
      const id = await makeProduct({ metal: 'gold', weight: '10.0000', fineness: '0.9170' });
      const [before] = await migratorSql<{ feingewicht_grams: string }[]>`
        SELECT feingewicht_grams FROM products WHERE id = ${id}`;
      expect(before!.feingewicht_grams).toBe('9.1700');

      await migratorSql`UPDATE products SET weight_grams = '20.0000' WHERE id = ${id}`;
      const [after] = await migratorSql<{ feingewicht_grams: string }[]>`
        SELECT feingewicht_grams FROM products WHERE id = ${id}`;
      expect(after!.feingewicht_grams).toBe('18.3400');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. products.collector_premium_eur
  // ────────────────────────────────────────────────────────────────────

  describe('products.collector_premium_eur', () => {
    it('accepts NULL (default)', async () => {
      const id = await makeProduct();
      const [row] = await migratorSql<{ collector_premium_eur: string | null }[]>`
        SELECT collector_premium_eur FROM products WHERE id = ${id}`;
      expect(row!.collector_premium_eur).toBeNull();
    });

    it('accepts zero and positive values', async () => {
      const id = await makeProduct();
      await expect(
        migratorSql`UPDATE products SET collector_premium_eur = '0.00' WHERE id = ${id}`,
      ).resolves.toBeDefined();
      await expect(
        migratorSql`UPDATE products SET collector_premium_eur = '350.00' WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('refuses negative collector_premium_eur', async () => {
      const id = await makeProduct();
      await expect(
        migratorSql`UPDATE products SET collector_premium_eur = '-1.00' WHERE id = ${id}`,
      ).rejects.toThrow(/products_collector_premium_nonneg/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. current_metal_price_eur_per_gram(metal)
  // ────────────────────────────────────────────────────────────────────

  describe('current_metal_price_eur_per_gram', () => {
    it('returns NULL when no row exists for the metal', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'platinum'`;
      const [row] = await migratorSql<{ price: string | null }[]>`
        SELECT current_metal_price_eur_per_gram('platinum') AS price`;
      expect(row!.price).toBeNull();
    });

    it('returns the current price when one is set', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'platinum'`;
      await setCurrentPrice('platinum', '29.4500');
      const [row] = await migratorSql<{ price: string }[]>`
        SELECT current_metal_price_eur_per_gram('platinum') AS price`;
      expect(row!.price).toBe('29.4500');
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'platinum'`;
    });

    it('ignores CLOSED (valid_to IS NOT NULL) rows', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
      // Closed row in the past — no current row.
      await migratorSql`
        INSERT INTO metal_prices (metal, price_per_gram_eur, source, valid_from, valid_to)
        VALUES ('silver', '0.75', 'LBMA'::metal_price_source,
                '2025-01-01 00:00:00+00', '2025-12-31 23:59:59+00')`;
      const [row] = await migratorSql<{ price: string | null }[]>`
        SELECT current_metal_price_eur_per_gram('silver') AS price`;
      expect(row!.price).toBeNull();
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. product_schmelzwert_eur(product_id)
  // ────────────────────────────────────────────────────────────────────

  describe('product_schmelzwert_eur', () => {
    it('returns feingewicht × current price, rounded to 2dp', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
      await setCurrentPrice('gold', '62.5000');
      // 1oz Krugerrand: 33.93 g × 0.9170 = 31.11381 g fine.
      // Schmelzwert = 31.11381 × 62.50 = 1944.61 (rounded).
      // But feingewicht is NUMERIC(10,4) → 31.1138, then × 62.5 = 1944.6125 → 1944.61.
      const id = await makeProduct({ metal: 'gold', weight: '33.9300', fineness: '0.9170' });
      const [row] = await migratorSql<{ schmelz: string }[]>`
        SELECT product_schmelzwert_eur(${id}) AS schmelz`;
      expect(row!.schmelz).toBe('1944.61');
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
    });

    it('returns NULL when product has no weight', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
      await setCurrentPrice('gold', '62.50');
      const id = await makeProduct({ metal: 'gold', weight: null, fineness: '0.9999' });
      const [row] = await migratorSql<{ schmelz: string | null }[]>`
        SELECT product_schmelzwert_eur(${id}) AS schmelz`;
      expect(row!.schmelz).toBeNull();
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
    });

    it('returns NULL when product has no fineness', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
      await setCurrentPrice('gold', '62.50');
      const id = await makeProduct({ metal: 'gold', weight: '31.1035', fineness: null });
      const [row] = await migratorSql<{ schmelz: string | null }[]>`
        SELECT product_schmelzwert_eur(${id}) AS schmelz`;
      expect(row!.schmelz).toBeNull();
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
    });

    it('returns NULL when no current price exists for the metal', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'palladium'`;
      const id = await makeProduct({ metal: 'palladium', weight: '10.0000', fineness: '0.9995' });
      const [row] = await migratorSql<{ schmelz: string | null }[]>`
        SELECT product_schmelzwert_eur(${id}) AS schmelz`;
      expect(row!.schmelz).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. Role grants
  // ────────────────────────────────────────────────────────────────────

  describe('role grants', () => {
    it('app role can INSERT into metal_prices (default privilege from 0003)', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
      const [r] = await appSql<{ id: string }[]>`
        INSERT INTO metal_prices (metal, price_per_gram_eur, source)
        VALUES ('silver', '0.80', 'LBMA'::metal_price_source)
        RETURNING id`;
      expect(r!.id).toBeDefined();
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
    });

    it('app role can UPDATE valid_to (close-out path)', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
      const id = await setCurrentPrice('silver', '0.80');
      await expect(
        appSql`UPDATE metal_prices SET valid_to = now() WHERE id = ${id.toString()}`,
      ).resolves.toBeDefined();
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
    });

    it('app role CANNOT UPDATE price_per_gram_eur (no grant)', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
      const id = await setCurrentPrice('silver', '0.80');
      await expect(
        appSql`UPDATE metal_prices SET price_per_gram_eur = '99.99' WHERE id = ${id.toString()}`,
      ).rejects.toThrow(/permission denied|insufficient privilege/i);
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'silver'`;
    });

    it('app role can UPDATE products.collector_premium_eur', async () => {
      const id = await makeProduct();
      await expect(
        appSql`UPDATE products SET collector_premium_eur = '200.00' WHERE id = ${id}`,
      ).resolves.toBeDefined();
    });

    it('worker role can INSERT into metal_prices', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'platinum'`;
      const [r] = await workerSql<{ id: string }[]>`
        INSERT INTO metal_prices (metal, price_per_gram_eur, source)
        VALUES ('platinum', '29.50', 'LBMA'::metal_price_source)
        RETURNING id`;
      expect(r!.id).toBeDefined();
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'platinum'`;
    });

    it('worker role can EXECUTE current_metal_price_eur_per_gram', async () => {
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
      await setCurrentPrice('gold', '62.50');
      const [row] = await workerSql<{ price: string }[]>`
        SELECT current_metal_price_eur_per_gram('gold') AS price`;
      expect(row!.price).toBe('62.5000');
      await migratorSql`DELETE FROM metal_prices WHERE metal = 'gold'`;
    });
  });
});
