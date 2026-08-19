/**
 * Migration 0061 — auto-generate a URL-safe, UNIQUE product slug on publish.
 *
 * The public storefront PDP link is `products.slug`. Before 0061, publishing a
 * product to the web with no slug (slug = NULL) left a broken PDP link — the
 * real symptom seen in prod (Basel's product "Basel", slug = NULL).
 *
 * RED  (at 0060): inserting/publishing a product with slug = NULL keeps it NULL.
 * GREEN (at 0061): the BEFORE trigger fills a slugify_de(name) slug, is German-
 *        aware (ä→ae, ß→ss), collision-safe (suffixes a 2nd identical name), and
 *        idempotent (a manual slug is never overwritten; re-publish is a no-op).
 *
 * Append-only fix — the immutable 0006/0029 files are NOT edited.
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('query returned no rows');
  return row;
}

/**
 * Insert a product. `published` controls is_published_to_web; `status` controls
 * the lifecycle gate. slug is left to the caller (default NULL). Returns the row.
 */
async function insertProduct(
  sql: Sql,
  opts: {
    name?: string | null;
    sku?: string;
    slug?: string | null;
    status?: 'DRAFT' | 'AVAILABLE';
    published?: boolean;
  } = {},
): Promise<{ id: string; slug: string | null }> {
  const sku = opts.sku ?? `SKU-${crypto.randomUUID()}`;
  const status = opts.status ?? 'DRAFT';
  const published = opts.published ?? false;
  // products_draft_unpublished CHECK: status='DRAFT' ⇒ published_at IS NULL;
  // products_non_draft_is_published CHECK: status<>'DRAFT' ⇒ published_at NOT NULL.
  // So published_at is bound to `status`, NOT to is_published_to_web (the two are
  // independent gates — a DRAFT row may carry is_published_to_web=TRUE).
  const [p] = await sql<{ id: string; slug: string | null }[]>`
    INSERT INTO products (sku, status, tax_treatment_code, item_type,
                          acquisition_cost_eur, list_price_eur, name,
                          slug, is_published_to_web,
                          published_at)
    VALUES (${sku}, ${status}::product_status, 'MARGIN_25A', 'gold_jewelry'::item_type,
            '50.00', '150.00', ${opts.name ?? 'Test Artikel'},
            ${opts.slug ?? null}, ${published},
            ${status === 'AVAILABLE' ? sql`now()` : null})
    RETURNING id, slug`;
  return must(p);
}

async function slugOf(sql: Sql, id: string): Promise<string | null> {
  const [r] = await sql<{ slug: string | null }[]>`SELECT slug FROM products WHERE id = ${id}`;
  return must(r).slug;
}

describe('migration 0061 — product slug autogen on publish', () => {
  describe('RED — at 0060 a published product keeps a NULL slug', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 60);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('publishing with slug=NULL leaves slug NULL (broken PDP link)', async () => {
      const p = await insertProduct(sql, {
        name: 'Basel',
        status: 'AVAILABLE',
        published: true,
        slug: null,
      });
      expect(await slugOf(sql, p.id)).toBeNull();
    });
  });

  describe('GREEN — at 0061 publish auto-fills a slug', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 61);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('slugify_de transliterates German umlauts + eszett', async () => {
      const [r] = await sql<{ s: string }[]>`SELECT slugify_de('Schöne Münze Größe') AS s`;
      expect(must(r).s).toBe('schoene-muenze-groesse');
    });

    it('slugify_de strips punctuation and collapses separators', async () => {
      const [r] = await sql<{ s: string }[]>`SELECT slugify_de('  20€ Gold-Dukat (1915)!!  ') AS s`;
      expect(must(r).s).toBe('20-gold-dukat-1915');
    });

    it('INSERT born AVAILABLE auto-fills the slug from name', async () => {
      const p = await insertProduct(sql, { name: 'Basel', status: 'AVAILABLE' });
      expect(await slugOf(sql, p.id)).toBe('basel');
    });

    it('INSERT with is_published_to_web=TRUE (status DRAFT) still fills the slug', async () => {
      const p = await insertProduct(sql, { name: 'Wiener Philharmoniker', published: true });
      expect(await slugOf(sql, p.id)).toBe('wiener-philharmoniker');
    });

    it('flipping a DRAFT (no slug) to AVAILABLE backfills the slug', async () => {
      const p = await insertProduct(sql, { name: 'Krügerrand 1oz', status: 'DRAFT' });
      expect(await slugOf(sql, p.id)).toBeNull();
      await sql`UPDATE products SET status = 'AVAILABLE'::product_status, published_at = now()
                 WHERE id = ${p.id}`;
      expect(await slugOf(sql, p.id)).toBe('kruegerrand-1oz');
    });

    it('a DRAFT, unpublished product is NOT given a slug', async () => {
      const p = await insertProduct(sql, { name: 'Entwurf', status: 'DRAFT' });
      expect(await slugOf(sql, p.id)).toBeNull();
    });

    it('a caller-supplied slug is never overwritten', async () => {
      const p = await insertProduct(sql, {
        name: 'Hat Schon Slug',
        status: 'AVAILABLE',
        slug: 'mein-eigener-slug',
      });
      expect(await slugOf(sql, p.id)).toBe('mein-eigener-slug');
    });

    it('a second identical name gets a unique, suffixed slug', async () => {
      const a = await insertProduct(sql, { name: 'Doppelter Name', status: 'AVAILABLE' });
      const b = await insertProduct(sql, { name: 'Doppelter Name', status: 'AVAILABLE' });
      const slugA = await slugOf(sql, a.id);
      const slugB = await slugOf(sql, b.id);
      expect(slugA).toBe('doppelter-name');
      expect(slugB).not.toBe(slugA);
      expect(slugB).toMatch(/^doppelter-name-[0-9a-f]{6}$/);
    });

    it('re-publishing the same row is a no-op (slug stable, never re-suffixed)', async () => {
      const p = await insertProduct(sql, { name: 'Stabil', status: 'AVAILABLE' });
      const first = await slugOf(sql, p.id);
      expect(first).toBe('stabil');
      // unpublish then re-publish — slug must NOT churn or gain a suffix.
      await sql`UPDATE products SET is_published_to_web = FALSE WHERE id = ${p.id}`;
      await sql`UPDATE products SET is_published_to_web = TRUE WHERE id = ${p.id}`;
      expect(await slugOf(sql, p.id)).toBe(first);
    });

    it('an empty name falls back to the sku-derived slug', async () => {
      const p = await insertProduct(sql, { name: '', sku: 'GOLD-0042', status: 'AVAILABLE' });
      expect(await slugOf(sql, p.id)).toBe('gold-0042');
    });

    it('warehouse14_app can publish (collision SELECT + NEW.slug write) without a grant error', async () => {
      // The trigger runs as the invoker; warehouse14_app must be able to read
      // products (collision check) and have NEW.slug assigned. No 0056/0057-class
      // missing-grant gap. We assert via the app role end-to-end.
      const { setAppPasswordForTest } = await import('../helpers/testDb.js');
      await setAppPasswordForTest(sql);
      const appSql = testDb.appSql();
      try {
        const [p] = await appSql<{ id: string; slug: string | null }[]>`
          INSERT INTO products (sku, status, tax_treatment_code, item_type,
                                acquisition_cost_eur, list_price_eur, name,
                                is_published_to_web, published_at)
          VALUES (${`APP-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
                  'gold_jewelry'::item_type, '50.00', '150.00', 'App Rolle Test',
                  TRUE, now())
          RETURNING id, slug`;
        expect(must(p).slug).toBe('app-rolle-test');
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });
  });
});
