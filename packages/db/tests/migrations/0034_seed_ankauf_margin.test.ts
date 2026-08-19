/**
 * Migration 0034 — seed the Owner-editable Ankauf safety margin.
 *
 * Focused tests:
 *   • Key `pricing.ankauf_safety_margin_pct` seeded with bare jsonb number 0.10
 *   • The app role can UPDATE the value (the PATCH /margin write path) and the
 *     new value round-trips as a number — the contract readAnkaufMarginPct relies on
 *   • Idempotent re-apply does NOT clobber an Owner-set value (ON CONFLICT DO NOTHING)
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const KEY = 'pricing.ankauf_safety_margin_pct';

describe('migration 0034_seed_ankauf_margin', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 34);
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

  it('seeds the margin key as a bare jsonb number 0.10', async () => {
    const rows = await migratorSql<{ value: unknown }[]>`
      SELECT value FROM system_settings WHERE key = ${KEY}`;
    expect(rows[0]?.value).toBe(0.1);
  });

  it('lets the app role update the value (PATCH /margin write path) and reads it back as a number', async () => {
    await appSql`
      UPDATE system_settings SET value = to_jsonb(${0.12}::numeric) WHERE key = ${KEY}`;
    const rows = await appSql<{ value: unknown }[]>`
      SELECT value FROM system_settings WHERE key = ${KEY}`;
    const v = rows[0]?.value;
    expect(typeof v === 'number' && v >= 0 && v <= 0.5).toBe(true);
    expect(v).toBe(0.12);
  });

  it('re-applying the seed does not clobber an Owner-set value', async () => {
    // value is 0.12 from the previous test; re-running the seed must be a no-op.
    await migratorSql.unsafe(
      `INSERT INTO system_settings (key, value, description) VALUES
        ('${KEY}', '0.10'::jsonb, 'seed') ON CONFLICT (key) DO NOTHING`,
    );
    const rows = await migratorSql<{ value: unknown }[]>`
      SELECT value FROM system_settings WHERE key = ${KEY}`;
    expect(rows[0]?.value).toBe(0.12);
  });
});
