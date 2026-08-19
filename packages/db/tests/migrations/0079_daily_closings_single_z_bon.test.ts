/**
 * Migration 0079 — one Z-Bon per business day in the V1 single-shop model.
 *
 * The 0011 constraint `daily_closings_business_day_shop_uq UNIQUE (business_day,
 * shop_id)` does NOT stop duplicates while shop_id is NULL: PostgreSQL treats two
 * (business_day, NULL) rows as distinct (NULLS DISTINCT), so two concurrent or
 * outbox-replayed finalizes could both write a FINALIZED closing for the same day
 * and every DSFinV-K / DATEV / Kassenbericht export would double-count it. 0079
 * adds a PARTIAL unique index over business_day WHERE shop_id IS NULL.
 *
 * RED (at 0078): a second (business_day, NULL) closing inserts cleanly.
 * GREEN (at 0079): the second insert is rejected (daily_closings_business_day_null_shop_uq);
 *   a different day still inserts.
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

describe('migration 0079 — one Z-Bon per business day (NULL-shop gap)', () => {
  describe('RED — at 0078 two NULL-shop closings on the same day both insert', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 78);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('the plain UNIQUE is defeated by NULL shop_id (the defect 0079 closes)', async () => {
      await sql`INSERT INTO daily_closings (business_day) VALUES ('2026-06-03'::date)`;
      // Second closing for the SAME day slips through — exactly the double-Z gap.
      await sql`INSERT INTO daily_closings (business_day) VALUES ('2026-06-03'::date)`;
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM daily_closings WHERE business_day = '2026-06-03'::date`;
      expect(row?.n).toBe(2);
    });
  });

  describe('GREEN — at 0079 a second NULL-shop closing is rejected', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 79);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('the partial unique index exists and is scoped to NULL shop_id', async () => {
      const [idx] = await sql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes
         WHERE tablename = 'daily_closings'
           AND indexname = 'daily_closings_business_day_null_shop_uq'`;
      expect(idx?.indexdef).toMatch(/shop_id IS NULL/);
    });

    it('a second closing for the same day (NULL shop) is rejected', async () => {
      await sql`INSERT INTO daily_closings (business_day) VALUES ('2026-06-04'::date)`;
      await expect(
        sql`INSERT INTO daily_closings (business_day) VALUES ('2026-06-04'::date)`,
      ).rejects.toThrow(/daily_closings_business_day_null_shop_uq/);
    });

    it('a closing for a different day still inserts', async () => {
      await sql`INSERT INTO daily_closings (business_day) VALUES ('2026-06-05'::date)`;
      const [row] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM daily_closings WHERE business_day = '2026-06-05'::date`;
      expect(row?.n).toBe(1);
    });
  });
});
