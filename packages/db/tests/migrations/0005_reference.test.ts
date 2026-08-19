/**
 * Migration 0005 — Reference data integration test.
 *
 * Sections:
 *   1. Structure       — tables, columns, triggers, indexes
 *   2. CHECK constraints — rate range, decimal/per-mille consistency, code format
 *   3. Seed data       — exact row count + key values per Basel's Day-3 accuracy directive
 *   4. App role grants — CRITICAL: SELECT-ONLY, NEVER INSERT/UPDATE/DELETE
 *   5. End-to-end app  — real connection: SELECT works, mutation fails
 *   6. Idempotency     — re-applying 0005 + re-inserting seed = no-op
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0005_reference', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 5);
    await setAppPasswordForTest(migratorSql);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Structure
  // ────────────────────────────────────────────────────────────────────

  describe('structure', () => {
    it.each(['tax_treatment_codes', 'karat_grades', 'hallmarks'])(
      'table %s exists',
      async (name) => {
        const [row] = await migratorSql<{ exists: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = ${name}
          ) AS exists
        `;
        expect(row.exists).toBe(true);
      },
    );

    it.each([
      ['trg_tax_treatment_codes_updated_at', 'tax_treatment_codes'],
      ['trg_karat_grades_updated_at', 'karat_grades'],
      ['trg_hallmarks_updated_at', 'hallmarks'],
    ])('updated_at trigger %s installed on %s', async (trg, tbl) => {
      const [row] = await migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger
           WHERE tgname = ${trg} AND tgrelid = ${tbl}::regclass
        ) AS exists
      `;
      expect(row.exists).toBe(true);
    });

    it('hallmarks (metal, stamp) is unique', async () => {
      const [row] = await migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'hallmarks_metal_stamp_uq' AND contype = 'u'
        ) AS exists
      `;
      expect(row.exists).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. CHECK constraints
  // ────────────────────────────────────────────────────────────────────

  describe('CHECK constraints', () => {
    it('tax_treatment_codes — rate outside [0, 1] rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO tax_treatment_codes (code, description_de, description_en, effective_vat_rate, legal_reference)
          VALUES ('BAD_RATE', 'x', 'x', 1.5, '§dummy')
        `,
      ).rejects.toThrow(/tax_treatment_codes_rate_range/);
    });

    it('tax_treatment_codes — code not matching format rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO tax_treatment_codes (code, description_de, description_en, legal_reference)
          VALUES ('lowercase_bad', 'x', 'x', '§dummy')
        `,
      ).rejects.toThrow(/tax_treatment_codes_code_format/);
    });

    it('karat_grades — decimal inconsistent with per_mille rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO karat_grades (code, karat_value, fineness_per_1000, fineness_decimal, hallmark_stamp, display_label_de)
          VALUES ('TEST', 12, 500, 0.7500, '500-TEST', 'inconsistent')
        `,
      ).rejects.toThrow(/karat_grades_decimal_matches_per_mille/);
    });

    it('karat_grades — code format must be NNK', async () => {
      await expect(
        migratorSql`
          INSERT INTO karat_grades (code, karat_value, fineness_per_1000, fineness_decimal, hallmark_stamp, display_label_de)
          VALUES ('K14', 14, 585, 0.5850, '585-T', 'bad-code')
        `,
      ).rejects.toThrow(/karat_grades_code_format/);
    });

    it('hallmarks — decimal inconsistent with per_mille rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO hallmarks (stamp, metal, fineness_per_1000, fineness_decimal, description_de, description_en)
          VALUES ('TEST_BAD', 'gold', 585, 0.7000, 'bad', 'bad')
        `,
      ).rejects.toThrow(/hallmarks_decimal_matches_per_mille/);
    });

    it('hallmarks — metal outside whitelist rejected', async () => {
      await expect(
        migratorSql`
          INSERT INTO hallmarks (stamp, metal, fineness_per_1000, fineness_decimal, description_de, description_en)
          VALUES ('999', 'copper', 999, 0.9990, 'x', 'x')
        `,
      ).rejects.toThrow(/hallmarks_metal_check/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Seed data — exact accuracy per Basel's Day-3 directive
  // ────────────────────────────────────────────────────────────────────

  describe('seed data — Basel Day-3 accuracy directive', () => {
    it('tax_treatment_codes seeded with exactly 4 baseline codes', async () => {
      const [row] = await migratorSql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM tax_treatment_codes
      `;
      expect(row.n).toBe(4);
    });

    it.each([
      ['MARGIN_25A', null, '§25a UStG'],
      ['INVESTMENT_GOLD_25C', '0.0000', '§25c UStG'],
      ['STANDARD_19', '0.1900', '§12 Abs. 1 UStG'],
      ['REDUCED_7', '0.0700', '§12 Abs. 2 UStG'],
    ])(
      'tax code %s has correct rate (%s) and legal_reference (%s)',
      async (code, expectedRate, expectedRef) => {
        const [row] = await migratorSql<
          {
            effective_vat_rate: string | null;
            legal_reference: string;
          }[]
        >`
          SELECT effective_vat_rate, legal_reference
            FROM tax_treatment_codes
           WHERE code = ${code}
        `;
        expect(row.effective_vat_rate).toBe(expectedRate);
        expect(row.legal_reference).toBe(expectedRef);
      },
    );

    it('karat_grades seeded with exactly 5 gold grades', async () => {
      const [row] = await migratorSql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM karat_grades
      `;
      expect(row.n).toBe(5);
    });

    it.each([
      ['8K', 8, 333, '0.3330'],
      ['14K', 14, 585, '0.5850'],
      ['18K', 18, 750, '0.7500'],
      ['22K', 22, 916, '0.9160'],
      ['24K', 24, 999, '0.9990'],
    ])(
      '%s → karat=%i, fineness_per_1000=%i, fineness_decimal=%s',
      async (code, expKarat, expPerMille, expDecimal) => {
        const [row] = await migratorSql<
          {
            karat_value: number;
            fineness_per_1000: number;
            fineness_decimal: string;
          }[]
        >`
          SELECT karat_value, fineness_per_1000, fineness_decimal
            FROM karat_grades
           WHERE code = ${code}
        `;
        expect(row.karat_value).toBe(expKarat);
        expect(row.fineness_per_1000).toBe(expPerMille);
        expect(row.fineness_decimal).toBe(expDecimal);
      },
    );

    it('decimal precision survives a price-style multiplication', async () => {
      // Sanity: 14K gold × 10g weight × €58.42/g spot ≈ €341.7257 raw.
      // The test asserts NUMERIC arithmetic keeps the precision we expect.
      const [row] = await migratorSql<{ raw: string }[]>`
        SELECT (kg.fineness_decimal * 10::numeric * 58.42::numeric)::text AS raw
          FROM karat_grades kg
         WHERE kg.code = '14K'
      `;
      // 0.5850 × 10 × 58.42 = 341.7570
      expect(row.raw).toBe('341.75700000');
    });

    it('hallmarks seeded with at least 17 entries across 4 metals', async () => {
      const [row] = await migratorSql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM hallmarks
      `;
      // Gold 5 + Silver 5 + Platinum 4 + Palladium 3 = 17
      expect(row.n).toBe(17);
    });

    it.each([
      ['gold', 5],
      ['silver', 5],
      ['platinum', 4],
      ['palladium', 3],
    ])('hallmarks: %s has %i entries', async (metal, expected) => {
      const [row] = await migratorSql<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM hallmarks WHERE metal = ${metal}
      `;
      expect(row.n).toBe(expected);
    });

    it("stamp '999' exists for gold, silver, AND platinum (disambiguated by metal)", async () => {
      const rows = await migratorSql<{ metal: string; fineness_decimal: string }[]>`
        SELECT metal, fineness_decimal FROM hallmarks WHERE stamp = '999' ORDER BY metal
      `;
      expect(rows.map((r) => r.metal)).toEqual(['gold', 'palladium', 'platinum', 'silver']);
      for (const r of rows) expect(r.fineness_decimal).toBe('0.9990');
    });

    it('Sterling silver (stamp 925) maps to metal=silver, fineness=0.9250', async () => {
      const [row] = await migratorSql<
        {
          metal: string;
          fineness_per_1000: number;
          fineness_decimal: string;
        }[]
      >`
        SELECT metal, fineness_per_1000, fineness_decimal
          FROM hallmarks
         WHERE stamp = '925' AND metal = 'silver'
      `;
      expect(row.metal).toBe('silver');
      expect(row.fineness_per_1000).toBe(925);
      expect(row.fineness_decimal).toBe('0.9250');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. App role grants — Basel Day-3 directive: SELECT ONLY
  // ────────────────────────────────────────────────────────────────────

  describe('app-role grants — Day-3 READ-ONLY directive', () => {
    it.each(['tax_treatment_codes', 'karat_grades', 'hallmarks'])(
      '%s — app has SELECT',
      async (tbl) => {
        const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', ${tbl}, 'SELECT') AS has`;
        expect(row.has).toBe(true);
      },
    );

    it.each([
      ['tax_treatment_codes', 'INSERT'],
      ['tax_treatment_codes', 'UPDATE'],
      ['tax_treatment_codes', 'DELETE'],
      ['karat_grades', 'INSERT'],
      ['karat_grades', 'UPDATE'],
      ['karat_grades', 'DELETE'],
      ['hallmarks', 'INSERT'],
      ['hallmarks', 'UPDATE'],
      ['hallmarks', 'DELETE'],
    ])('%s — app DOES NOT have %s (Day-3 directive)', async (tbl, priv) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', ${tbl}, ${priv}) AS has`;
      expect(row.has).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. End-to-end app-role behavior
  // ────────────────────────────────────────────────────────────────────

  describe('end-to-end app-role behavior', () => {
    it('app role can SELECT tax treatment codes by primary key', async () => {
      const appSql = testDb.appSql();
      try {
        const rows = await appSql<
          {
            code: string;
            effective_vat_rate: string | null;
          }[]
        >`
          SELECT code, effective_vat_rate FROM tax_treatment_codes WHERE code = 'STANDARD_19'
        `;
        expect(rows[0].code).toBe('STANDARD_19');
        expect(rows[0].effective_vat_rate).toBe('0.1900');
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CANNOT INSERT into tax_treatment_codes', async () => {
      const appSql = testDb.appSql();
      try {
        await expect(
          appSql`
            INSERT INTO tax_treatment_codes (code, description_de, description_en, effective_vat_rate, legal_reference)
            VALUES ('NEW_CODE', 'x', 'x', 0.1900, '§dummy')
          `,
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CANNOT UPDATE karat_grades', async () => {
      const appSql = testDb.appSql();
      try {
        await expect(
          appSql`UPDATE karat_grades SET active = FALSE WHERE code = '8K'`,
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role CANNOT DELETE from hallmarks', async () => {
      const appSql = testDb.appSql();
      try {
        await expect(
          appSql`DELETE FROM hallmarks WHERE stamp = '999' AND metal = 'gold'`,
        ).rejects.toThrow(/permission denied/i);
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role can SELECT karat → fineness for a typical pricing query', async () => {
      const appSql = testDb.appSql();
      try {
        const rows = await appSql<{ fineness_decimal: string }[]>`
          SELECT fineness_decimal FROM karat_grades WHERE code = '18K'
        `;
        expect(rows[0].fineness_decimal).toBe('0.7500');
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });

    it('app role can SELECT (metal, stamp) → fineness for Vision-OCR lookup', async () => {
      const appSql = testDb.appSql();
      try {
        const rows = await appSql<{ fineness_decimal: string; description_de: string }[]>`
          SELECT fineness_decimal, description_de
            FROM hallmarks
           WHERE metal = 'silver' AND stamp = '925'
        `;
        expect(rows[0].fineness_decimal).toBe('0.9250');
        expect(rows[0].description_de).toContain('Sterling');
      } finally {
        await appSql.end({ timeout: 5 });
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. Idempotency
  // ────────────────────────────────────────────────────────────────────

  describe('idempotency', () => {
    it('re-applying migration 0005 does not throw and does not duplicate seed rows', async () => {
      await expect(applyMigrations(migratorSql, 5)).resolves.not.toThrow();

      const [tax] = await migratorSql<
        { n: number }[]
      >`SELECT COUNT(*)::int AS n FROM tax_treatment_codes`;
      const [kar] = await migratorSql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM karat_grades`;
      const [hm] = await migratorSql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM hallmarks`;
      expect(tax.n).toBe(4);
      expect(kar.n).toBe(5);
      expect(hm.n).toBe(17);
    });
  });
});
