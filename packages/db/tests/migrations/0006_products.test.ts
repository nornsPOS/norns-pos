/**
 * Migration 0006 — Products + product_photos + pgvector + HNSW.
 *
 * Focused tests on what matters:
 *   • Structure: tables, enums, indexes (incl. HNSW), triggers
 *   • State-machine CHECK invariants
 *   • App-role grants (products no DELETE, photos has DELETE, intake-locked
 *     columns refuse UPDATE)
 *   • One-primary-photo-per-product partial unique
 *   • pgvector column accepts vector(1536) and cosine-similarity sorts
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0006_products', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  /** Insert a baseline product in DRAFT state. */
  async function makeProduct(overrides: Record<string, unknown> = {}): Promise<string> {
    const sku = (overrides.sku as string | undefined) ?? `SKU-${crypto.randomUUID()}`;
    const status = (overrides.status as string | undefined) ?? 'DRAFT';
    const publishedAt = status === 'DRAFT' ? null : 'now()';
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (
        sku, status, tax_treatment_code, item_type, metal,
        acquisition_cost_eur, list_price_eur, name, published_at
      ) VALUES (
        ${sku}, ${status}::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type, 'gold',
        100.00, 250.00, 'Test Ring', ${publishedAt === null ? null : migratorSql`now()`}
      )
      RETURNING id
    `;
    return row.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 6);
    await setAppPasswordForTest(migratorSql);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // Structure
  // ────────────────────────────────────────────────────────────────────

  describe('structure', () => {
    it.each(['products', 'product_photos'])('table %s exists', async (name) => {
      const [row] = await migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ${name}
        ) AS exists
      `;
      expect(row.exists).toBe(true);
    });

    it.each([
      ['product_status', ['DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD']],
      ['reservation_channel', ['POS', 'STOREFRONT', 'EBAY']],
      ['photo_source', ['intake', 'admin_upload', 'storefront_user']],
    ] as const)('enum %s has the right values', async (typeName, expected) => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_type t
          JOIN pg_enum e ON t.oid = e.enumtypid
         WHERE t.typname = ${typeName}
         ORDER BY e.enumsortorder
      `;
      expect(rows.map((r) => r.enumlabel)).toEqual([...expected]);
    });

    it('HNSW index on products.embedding exists (partial on AVAILABLE)', async () => {
      const [row] = await migratorSql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'products' AND indexname = 'products_embedding_hnsw_idx'
      `;
      expect(row.indexdef).toMatch(/USING hnsw/i);
      expect(row.indexdef).toMatch(/vector_cosine_ops/i);
      expect(row.indexdef).toMatch(/WHERE.*status.*AVAILABLE/i);
    });

    it('updated_at triggers on products + product_photos', async () => {
      for (const [trg, tbl] of [
        ['trg_products_updated_at', 'products'],
        ['trg_product_photos_updated_at', 'product_photos'],
      ] as const) {
        const [row] = await migratorSql<{ exists: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_trigger
             WHERE tgname = ${trg} AND tgrelid = ${tbl}::regclass
          ) AS exists
        `;
        expect(row.exists, `${trg} on ${tbl}`).toBe(true);
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // State-machine CHECK invariants
  // ────────────────────────────────────────────────────────────────────

  describe('state-machine CHECK invariants', () => {
    it('AVAILABLE row with a reservation envelope is rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name, published_at,
                                reserved_by_channel, reserved_at)
          VALUES ('X-AVL-1', 'AVAILABLE'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  100, 200, 'X', now(), 'POS'::reservation_channel, now())
        `,
      ).rejects.toThrow(/products_available_no_reservation/);
    });

    it('RESERVED row without channel + reserved_at is rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name, published_at)
          VALUES ('X-RES-1', 'RESERVED'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  100, 200, 'X', now())
        `,
      ).rejects.toThrow(/products_reserved_has_envelope/);
    });

    it('RESERVED POS with reservation_expires_at IS rejected (POS holds indefinitely)', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name, published_at,
                                reserved_by_channel, reserved_at, reservation_expires_at)
          VALUES ('X-RES-POS-BAD', 'RESERVED'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  100, 200, 'X', now(),
                  'POS'::reservation_channel, now(), now() + interval '15 minutes')
        `,
      ).rejects.toThrow(/products_reservation_ttl_per_channel/);
    });

    it('RESERVED STOREFRONT without reservation_expires_at is rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name, published_at,
                                reserved_by_channel, reserved_at)
          VALUES ('X-RES-SF-BAD', 'RESERVED'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  100, 200, 'X', now(),
                  'STOREFRONT'::reservation_channel, now())
        `,
      ).rejects.toThrow(/products_reservation_ttl_per_channel/);
    });

    it('SOLD row without sold_at is rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name, published_at)
          VALUES ('X-SOLD-BAD', 'SOLD'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  100, 200, 'X', now())
        `,
      ).rejects.toThrow(/products_sold_has_sold_at/);
    });

    it('DRAFT row with published_at IS rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name, published_at)
          VALUES ('X-DRAFT-BAD', 'DRAFT'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  100, 200, 'X', now())
        `,
      ).rejects.toThrow(/products_draft_unpublished/);
    });

    it('non-DRAFT row WITHOUT published_at is rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name)
          VALUES ('X-AVL-NP', 'AVAILABLE'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
                  100, 200, 'X')
        `,
      ).rejects.toThrow(/products_non_draft_is_published/);
    });

    it('fineness_decimal > 1.0000 rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO products (sku, status, tax_treatment_code, item_type, fineness_decimal,
                                acquisition_cost_eur, list_price_eur, name)
          VALUES ('X-FIN-BAD', 'DRAFT'::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type, 1.5000,
                  100, 200, 'X')
        `,
      ).rejects.toThrow(/products_fineness_range/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // App-role grants
  // ────────────────────────────────────────────────────────────────────

  describe('app-role grants', () => {
    it.each(['products', 'product_photos'])('%s — app has SELECT + INSERT', async (tbl) => {
      const [s] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', ${tbl}, 'SELECT') AS has`;
      const [i] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', ${tbl}, 'INSERT') AS has`;
      expect(s.has).toBe(true);
      expect(i.has).toBe(true);
    });

    it('products — app DOES NOT have DELETE (audit trail)', async () => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'products', 'DELETE') AS has`;
      expect(row.has).toBe(false);
    });

    it('product_photos — app HAS DELETE (media, not fiscal)', async () => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'product_photos', 'DELETE') AS has`;
      expect(row.has).toBe(true);
    });

    it.each([
      // App CAN update these:
      ['status', true],
      ['reserved_by_channel', true],
      ['reserved_at', true],
      ['reservation_expires_at', true],
      ['sold_at', true],
      ['published_at', true],
      ['list_price_eur', true],
      ['name', true],
      ['description_de', true],
      ['embedding', true],
      // App CANNOT update these (intake-locked / fiscal integrity):
      ['acquisition_cost_eur', false],
      ['tax_treatment_code', false],
      ['item_type', false],
      ['metal', false],
      ['karat_code', false],
      ['fineness_decimal', false],
      ['weight_grams', false],
      ['hallmark_stamps', false],
      ['sku', false],
      ['barcode', false],
      ['created_at', false],
    ])('products.%s app UPDATE permission → %s', async (column, expected) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'products', ${column}, 'UPDATE') AS has`;
      expect(row.has).toBe(expected);
    });

    it('app role CANNOT DELETE a product even when row exists', async () => {
      const id = await makeProduct();
      const appSql = testDb.appSql();
      try {
        await expect(appSql`DELETE FROM products WHERE id = ${id}`).rejects.toThrow(
          /permission denied/i,
        );
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CANNOT UPDATE acquisition_cost_eur (§25a immutability)', async () => {
      const id = await makeProduct();
      const appSql = testDb.appSql();
      try {
        await expect(
          appSql`UPDATE products SET acquisition_cost_eur = 999.99 WHERE id = ${id}`,
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // product_photos: one-primary-per-product
  // ────────────────────────────────────────────────────────────────────

  describe('product_photos — exactly-one-primary partial unique', () => {
    it('two is_primary=TRUE rows on the same product → reject', async () => {
      const productId = await makeProduct();
      await migratorSql`
        INSERT INTO product_photos (product_id, r2_key, is_primary)
        VALUES (${productId}, 'p-1.webp', TRUE)
      `;
      await expect(
        migratorSql`
          INSERT INTO product_photos (product_id, r2_key, is_primary)
          VALUES (${productId}, 'p-2.webp', TRUE)
        `,
      ).rejects.toThrow(/product_photos_one_primary_per_product_uq/);
    });

    it('two is_primary=FALSE rows on the same product → allowed', async () => {
      const productId = await makeProduct();
      const a = await migratorSql`
        INSERT INTO product_photos (product_id, r2_key, is_primary)
        VALUES (${productId}, 'p-1.webp', FALSE)
      `;
      const b = await migratorSql`
        INSERT INTO product_photos (product_id, r2_key, is_primary)
        VALUES (${productId}, 'p-2.webp', FALSE)
      `;
      expect(a.count).toBe(1);
      expect(b.count).toBe(1);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // pgvector + HNSW
  // ────────────────────────────────────────────────────────────────────

  describe('pgvector embedding column', () => {
    it('accepts a 1536-dim vector and rejects a wrong-dimension vector', async () => {
      const goodVec = `[${Array.from({ length: 1536 }, (_, i) => (i % 10) / 10).join(',')}]`;
      const badVec = '[1,2,3]';

      const id = await makeProduct({ status: 'AVAILABLE', sku: 'VEC-OK' });
      await migratorSql.unsafe(
        `UPDATE products SET embedding = '${goodVec}'::vector WHERE id = '${id}'`,
      );
      // Sanity: the stored vector roundtrips with the right dimension.
      const [row] = await migratorSql<{ dim: number }[]>`
        SELECT vector_dims(embedding) AS dim FROM products WHERE id = ${id}
      `;
      expect(row.dim).toBe(1536);

      await expect(
        migratorSql.unsafe(
          `UPDATE products SET embedding = '${badVec}'::vector WHERE id = '${id}'`,
        ),
      ).rejects.toThrow(/expected 1536 dimensions/i);
    });

    it('cosine similarity ranks closer vectors first', async () => {
      // Two AVAILABLE products with deliberate embeddings.
      const aId = await makeProduct({ status: 'AVAILABLE', sku: 'SIM-A' });
      const bId = await makeProduct({ status: 'AVAILABLE', sku: 'SIM-B' });

      const onehot0 = `[${[1, ...Array.from({ length: 1535 }, () => 0)].join(',')}]`;
      const onehot1 = `[${[0, 1, ...Array.from({ length: 1534 }, () => 0)].join(',')}]`;
      await migratorSql.unsafe(
        `UPDATE products SET embedding = '${onehot0}'::vector WHERE id = '${aId}'`,
      );
      await migratorSql.unsafe(
        `UPDATE products SET embedding = '${onehot1}'::vector WHERE id = '${bId}'`,
      );

      const probe = onehot0; // identical to A's embedding
      const rows = await migratorSql.unsafe<{ id: string; dist: number }[]>(
        `SELECT id, (embedding <=> '${probe}'::vector)::float AS dist
           FROM products
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> '${probe}'::vector
          LIMIT 2`,
      );
      expect(rows[0].id).toBe(aId); // exact match first
      expect(rows[0].dist).toBeCloseTo(0, 6);
      expect(rows[1].id).toBe(bId);
      expect(rows[1].dist).toBeCloseTo(1, 6);
    });
  });
});
