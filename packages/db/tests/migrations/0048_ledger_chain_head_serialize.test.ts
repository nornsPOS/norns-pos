/**
 * Migration 0048 — ledger hash-chain serialization fix (GoBD).
 *
 * 0008's trigger did pg_advisory_xact_lock + a snapshot-bound tail SELECT, which
 * forks the chain under concurrency (proven ground truth: duplicate prev_hash
 * committed, verify_ledger_chain() breaks). 0048 serializes + freshly reads the
 * tail via a head-row FOR UPDATE and assigns id in-lock.
 *
 * Boots 0001..0008 (the forking trigger) and applies ONLY 0048 on top, then runs
 * 100 concurrent emits and checks the ACTUAL table:
 *   RED  (without 0048): < 100 distinct prev_hash (forks) and/or chain invalid.
 *   GREEN (with 0048)  : exactly 100 distinct prev_hash AND verifyChain() = true,
 *                        deterministically across repeated runs.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emit, verifyChain } from '@norns/audit';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  splitSqlStatements,
  startTestDb,
} from '../helpers/testDb.js';

const FIX_SQL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
  '0048_ledger_chain_head_serialize.sql',
);

describe('migration 0048_ledger_chain_head_serialize', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 8); // the forking trigger
    // Apply ONLY 0048 on top (psql -f fidelity). If absent (red-state proof),
    // leave the 0008 trigger so the chain forks under load.
    try {
      const fixSql = await readFile(FIX_SQL, 'utf8');
      for (const stmt of splitSqlStatements(fixSql)) {
        await migratorSql.unsafe(stmt);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await setAppPasswordForTest(migratorSql);
    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 20,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  it('100 concurrent emits produce a fork-free, valid chain', async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        emit(appDb, {
          eventType: 'concurrent',
          entityTable: 'products',
          entityId: crypto.randomUUID(),
          payload: { i },
        }),
      ),
    );
    expect(results).toHaveLength(100);

    // GROUND TRUTH from the actual table — not the RETURNING values.
    const [counts] = await migratorSql<
      { total: string; distinct_prev: string; distinct_row: string }[]
    >`
      SELECT count(*)::text AS total,
             count(DISTINCT prev_hash)::text AS distinct_prev,
             count(DISTINCT row_hash)::text  AS distinct_row
        FROM ledger_events`;
    expect(counts?.total).toBe('100');
    expect(counts?.distinct_row).toBe('100');
    expect(counts?.distinct_prev).toBe('100'); // no two rows share a parent → no fork

    const chain = await verifyChain(appDb);
    expect(chain.valid).toBe(true);
  });
});
