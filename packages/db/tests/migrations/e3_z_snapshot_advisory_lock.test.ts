/**
 * E3 — Z-snapshot advisory lock (business-day serialization).
 *
 * A sale-finalize takes `pg_advisory_xact_lock_shared(1146, dayInt)`; the Z-Bon
 * finalize takes `pg_advisory_xact_lock(1146, dayInt)` (EXCLUSIVE). This asserts
 * the two properties the fix depends on:
 *   1. The day key is days-since-epoch (the exact expression both routes use).
 *   2. The EXCLUSIVE closing lock conflicts with a HELD SHARED sale lock (the
 *      closing waits for in-flight sales), while SHARED+SHARED do NOT conflict
 *      (concurrent sales never block each other), and the key frees on commit.
 *
 * Non-blocking `pg_try_*` is used so the test is deterministic (no timeouts).
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

describe('E3 — Z-snapshot advisory lock', () => {
  let testDb: TestDb;
  let sql: Sql; // connection A — holds the shared (sale) lock
  let other: Sql; // connection B — probes as the closing / a second sale

  beforeAll(async () => {
    testDb = await startTestDb();
    sql = testDb.migratorSql;
    await applyMigrations(sql, 80);
    other = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });
  }, 180_000);

  afterAll(async () => {
    await other.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  it('the day key is days-since-epoch (the expression both routes share)', async () => {
    const jsDays = Math.floor(Date.UTC(2026, 6, 9) / 86_400_000); // 2026-07-09
    const [row] = await sql<{ k: number }[]>`
      SELECT ('2026-07-09'::date - DATE '1970-01-01')::int AS k`;
    expect(row?.k).toBe(jsDays);
  });

  it('EXCLUSIVE closing lock conflicts with a held SHARED sale lock; SHARED+SHARED do not', async () => {
    await sql.begin(async (tx) => {
      // A: a sale holds the SHARED lock for day 20000.
      await tx`SELECT pg_advisory_xact_lock_shared(1146, 20000)`;

      // B: the closing tries the EXCLUSIVE lock (non-blocking) → DENIED.
      const [ex] = await other<{ got: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(1146, 20000) AS got`;
      expect(ex?.got).toBe(false);

      // B: a second sale tries the SHARED lock → ALLOWED (sales never block).
      const [sh] = await other<{ got: boolean }[]>`
        SELECT pg_try_advisory_xact_lock_shared(1146, 20000) AS got`;
      expect(sh?.got).toBe(true);
    });
  });

  it('once the sale tx commits, the closing can take the EXCLUSIVE lock', async () => {
    // A's tx above has committed, releasing its shared lock on 20000.
    const [ex] = await other<{ got: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(1146, 20000) AS got`;
    expect(ex?.got).toBe(true);
  });
});
