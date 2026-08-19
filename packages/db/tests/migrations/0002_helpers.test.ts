/**
 * Migration 0002 — Helper functions integration test.
 *
 * Asserts:
 *   • berlin_business_day() returns the right Berlin-local DATE for assorted
 *     timestamps, including DST transitions.
 *   • berlin_business_day() is marked IMMUTABLE so it can be used in
 *     functional indexes.
 *   • berlin_business_day() is PARALLEL SAFE.
 *   • set_updated_at() trigger fn actually stamps updated_at on UPDATE.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

describe('migration 0002_helpers', () => {
  let testDb: TestDb;

  beforeAll(async () => {
    testDb = await startTestDb();
    await applyMigrations(testDb.migratorSql, 2);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  describe('berlin_business_day()', () => {
    it('returns the Berlin-local date for a CEST (summer) timestamp', async () => {
      // 14:00 +02 (CEST) on 2026-05-23 → 2026-05-23 in Berlin
      const [row] = await testDb.migratorSql<{ d: string }[]>`
        SELECT berlin_business_day('2026-05-23 14:00:00+02'::timestamptz)::text AS d
      `;
      expect(row.d).toBe('2026-05-23');
    });

    it('crosses the day boundary correctly just after midnight Berlin time (DST on)', async () => {
      // 22:30 UTC on 2026-05-22 == 00:30 CEST on 2026-05-23
      const [row] = await testDb.migratorSql<{ d: string }[]>`
        SELECT berlin_business_day('2026-05-22 22:30:00Z'::timestamptz)::text AS d
      `;
      expect(row.d).toBe('2026-05-23');
    });

    it('crosses the day boundary correctly just after midnight Berlin time (DST off)', async () => {
      // 23:30 UTC on 2026-01-22 == 00:30 CET on 2026-01-23 (no DST in January)
      const [row] = await testDb.migratorSql<{ d: string }[]>`
        SELECT berlin_business_day('2026-01-22 23:30:00Z'::timestamptz)::text AS d
      `;
      expect(row.d).toBe('2026-01-23');
    });

    it('handles spring-forward DST transition (last Sunday of March)', async () => {
      // 2026 spring forward: 2026-03-29 02:00 → 03:00 CET→CEST.
      // 00:30 UTC on 2026-03-29 is 01:30 CET (before jump) → still 2026-03-29.
      const [row] = await testDb.migratorSql<{ d: string }[]>`
        SELECT berlin_business_day('2026-03-29 00:30:00Z'::timestamptz)::text AS d
      `;
      expect(row.d).toBe('2026-03-29');
    });

    it('handles fall-back DST transition (last Sunday of October)', async () => {
      // 2026 fall back: 2026-10-25 03:00 → 02:00 CEST→CET.
      // 00:30 UTC on 2026-10-25 is 02:30 CEST → 2026-10-25.
      const [row] = await testDb.migratorSql<{ d: string }[]>`
        SELECT berlin_business_day('2026-10-25 00:30:00Z'::timestamptz)::text AS d
      `;
      expect(row.d).toBe('2026-10-25');
    });

    it('is marked IMMUTABLE so it can be used in functional indexes', async () => {
      // provolatile: 'i' = IMMUTABLE, 's' = STABLE, 'v' = VOLATILE.
      const [row] = await testDb.migratorSql<{ vol: string }[]>`
        SELECT provolatile AS vol
          FROM pg_proc
         WHERE proname = 'berlin_business_day'
      `;
      expect(row.vol).toBe('i');
    });

    it('is marked PARALLEL SAFE', async () => {
      // proparallel: 's' = SAFE, 'r' = RESTRICTED, 'u' = UNSAFE.
      const [row] = await testDb.migratorSql<{ par: string }[]>`
        SELECT proparallel AS par
          FROM pg_proc
         WHERE proname = 'berlin_business_day'
      `;
      expect(row.par).toBe('s');
    });

    it('actually works inside a functional index (proves IMMUTABLE is honored)', async () => {
      await testDb.migratorSql`
        CREATE TEMP TABLE tmp_tx (id int PRIMARY KEY, ts timestamptz NOT NULL)
      `;
      await testDb.migratorSql`
        CREATE INDEX tmp_tx_business_day_idx ON tmp_tx (berlin_business_day(ts))
      `;
      // Insert and verify the index is usable.
      await testDb.migratorSql`
        INSERT INTO tmp_tx (id, ts) VALUES (1, '2026-05-23 10:00:00Z'::timestamptz)
      `;
      const [row] = await testDb.migratorSql<{ d: string }[]>`
        SELECT berlin_business_day(ts)::text AS d FROM tmp_tx WHERE id = 1
      `;
      expect(row.d).toBe('2026-05-23');
    });
  });

  describe('set_updated_at()', () => {
    it('exists and is callable as a trigger function', async () => {
      const [row] = await testDb.migratorSql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
        ) AS exists
      `;
      expect(row.exists).toBe(true);
    });

    it('stamps updated_at on UPDATE when wired as a trigger', async () => {
      await testDb.migratorSql`
        CREATE TEMP TABLE tmp_wired (
          id int PRIMARY KEY,
          payload text,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await testDb.migratorSql`
        CREATE TRIGGER trg_tmp_wired_updated_at
          BEFORE UPDATE ON tmp_wired
          FOR EACH ROW EXECUTE FUNCTION set_updated_at()
      `;
      await testDb.migratorSql`INSERT INTO tmp_wired (id, payload) VALUES (1, 'a')`;
      const [before] = await testDb.migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM tmp_wired WHERE id = 1
      `;
      await new Promise((resolveFn) => setTimeout(resolveFn, 50));
      await testDb.migratorSql`UPDATE tmp_wired SET payload = 'b' WHERE id = 1`;
      const [after] = await testDb.migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM tmp_wired WHERE id = 1
      `;
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    });

    it('stamps updated_at even when the row is "logically unchanged" (no short-circuit)', async () => {
      // Discipline note in migration 0002: an UPDATE that touches only audit cols
      // still stamps updated_at, so downstream SSE projections see the event.
      await testDb.migratorSql`
        CREATE TEMP TABLE tmp_noop (
          id int PRIMARY KEY,
          payload text,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `;
      await testDb.migratorSql`
        CREATE TRIGGER trg_tmp_noop_updated_at
          BEFORE UPDATE ON tmp_noop
          FOR EACH ROW EXECUTE FUNCTION set_updated_at()
      `;
      await testDb.migratorSql`INSERT INTO tmp_noop (id, payload) VALUES (1, 'x')`;
      const [before] = await testDb.migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM tmp_noop WHERE id = 1
      `;
      await new Promise((resolveFn) => setTimeout(resolveFn, 50));
      // Update payload to the same value — should still trigger.
      await testDb.migratorSql`UPDATE tmp_noop SET payload = 'x' WHERE id = 1`;
      const [after] = await testDb.migratorSql<{ updated_at: Date }[]>`
        SELECT updated_at FROM tmp_noop WHERE id = 1
      `;
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
    });
  });
});
