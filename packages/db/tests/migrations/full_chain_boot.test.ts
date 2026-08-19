/**
 * Full-chain boot — applies EVERY migration (0001..N) the way prod does and
 * asserts the schema comes up clean. This is the suite that exercises the
 * psql -f fidelity fix in applyMigrations(): before it, migration 0039 threw
 * "unsafe use of new value REVERSE_CHARGE_13B of enum type belegtext_kind" at
 * beforeAll, because the whole file ran as one implicit transaction. Prod
 * (migrate.sh, psql -f, no -1) autocommits the ALTER TYPE … ADD VALUE first.
 *
 * No per-migration test reaches 0039 (they pin upTo ≤ 34), so this is the only
 * guard that the LATER migrations + the full chain actually apply — and the
 * thing the api-cloud inlined harnesses and a CI gate depend on.
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

describe('full migration chain boots (psql -f fidelity)', () => {
  let testDb: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    sql = testDb.migratorSql;
    // 999 = apply every migration file on disk, in order — the live-prod state.
    await applyMigrations(sql, 999);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it('0039 enum addition committed: REVERSE_CHARGE_13B is a usable belegtext_kind value', async () => {
    const [row] = await sql<{ v: string }[]>`SELECT 'REVERSE_CHARGE_13B'::belegtext_kind AS v`;
    expect(row?.v).toBe('REVERSE_CHARGE_13B');
  });

  it('0039 column addition applied: customers.vat_id exists', async () => {
    const [row] = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'customers' AND column_name = 'vat_id'
      ) AS exists
    `;
    expect(row?.exists).toBe(true);
  });

  it('a late migration applied: 0044 seeded the shop.name setting', async () => {
    const [row] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM system_settings WHERE key = 'shop.name'
    `;
    expect(row?.count).toBe(1);
  });
});
