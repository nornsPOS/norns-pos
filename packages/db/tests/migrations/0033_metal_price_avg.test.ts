/**
 * Migration 0033 — time-weighted N-day metal-price average.
 *
 * Focused tests:
 *   • Two-segment window → weighted by seconds active, not row count
 *     (100€ for 2d + 200€ for 8d over a 10d window = 180.0000)
 *   • A single row older than the window is CLIPPED to the window bounds
 *   • No in-window coverage → NULL
 *   • p_days parameter narrows the window
 *   • app + worker roles may EXECUTE the function
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0033_metal_price_avg', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  let workerSql: Sql;

  /** Insert a history row with explicit validity bounds (ms offsets from now). */
  async function insertRow(
    metal: string,
    pricePerGram: string,
    validFromDaysAgo: number,
    validToDaysAgo: number | null,
  ): Promise<void> {
    await migratorSql`
      INSERT INTO metal_prices (metal, price_per_gram_eur, source, valid_from, valid_to)
      VALUES (
        ${metal}, ${pricePerGram}, 'LBMA'::metal_price_source,
        now() - make_interval(days => ${validFromDaysAgo}),
        ${validToDaysAgo === null ? null : migratorSql`now() - make_interval(days => ${validToDaysAgo})`}
      )`;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 33);
    await setAppPasswordForTest(migratorSql);
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

  async function avg(metal: string, days?: number): Promise<string | null> {
    const rows =
      days === undefined
        ? await migratorSql<
            { v: string | null }[]
          >`SELECT metal_price_avg_eur_per_gram(${metal}) AS v`
        : await migratorSql<
            { v: string | null }[]
          >`SELECT metal_price_avg_eur_per_gram(${metal}, ${days}) AS v`;
    return rows[0]?.v ?? null;
  }

  it('weights each price by seconds active within the window', async () => {
    // gold: 100€ active days [-10, -8) (2 days), then 200€ active [-8, now] (8 days).
    await insertRow('gold', '100.0000', 10, 8);
    await insertRow('gold', '200.0000', 8, null);
    // (100*2 + 200*8) / 10 = 180.
    expect(Number(await avg('gold'))).toBeCloseTo(180, 1);
  });

  it('clips a row that started before the window to the window bounds', async () => {
    // silver: single row valid since 30 days ago, still current → whole 10d window at 50.
    await insertRow('silver', '50.0000', 30, null);
    expect(Number(await avg('silver'))).toBeCloseTo(50, 4);
  });

  it('returns NULL when the metal has no in-window coverage', async () => {
    // platinum: a row that ended 12 days ago — entirely before the 10d window.
    await insertRow('platinum', '900.0000', 20, 12);
    expect(await avg('platinum')).toBeNull();
  });

  it('honors the p_days parameter (narrower window changes the weighting)', async () => {
    // palladium: 300€ for [-10,-2) then 600€ for [-2, now].
    await insertRow('palladium', '300.0000', 10, 2);
    await insertRow('palladium', '600.0000', 2, null);
    // 2-day window sees only the 600€ segment.
    expect(Number(await avg('palladium', 2))).toBeCloseTo(600, 1);
    // 10-day window: (300*8 + 600*2)/10 = 360.
    expect(Number(await avg('palladium', 10))).toBeCloseTo(360, 1);
  });

  it('is EXECUTE-able by both app and worker roles', async () => {
    await expect(appSql`SELECT metal_price_avg_eur_per_gram('gold') AS v`).resolves.toBeDefined();
    await expect(
      workerSql`SELECT metal_price_avg_eur_per_gram('gold') AS v`,
    ).resolves.toBeDefined();
  });

  it('backs the GET /rates query: current + 10d avg + Ankauf = ROUND(avg × 0.9, 4)', async () => {
    // Reuses the gold rows from the first test (100€×2d + 200€×8d → avg 180,
    // current 200). This is the exact SQL the /api/metal-prices/rates route runs.
    const rows = await migratorSql<
      {
        metal: string;
        current_price: string | null;
        avg10d: string | null;
        ankauf: string | null;
      }[]
    >`
      SELECT
        m.metal AS metal,
        current_metal_price_eur_per_gram(m.metal) AS current_price,
        metal_price_avg_eur_per_gram(m.metal, ${10}::int) AS avg10d,
        ROUND(metal_price_avg_eur_per_gram(m.metal, ${10}::int) * (1 - ${'0.1'}::numeric), 4) AS ankauf
      FROM (VALUES ('gold'), ('rhodium_absent')) AS m(metal)`;
    const gold = rows.find((r) => r.metal === 'gold');
    const absent = rows.find((r) => r.metal === 'rhodium_absent');

    expect(Number(gold?.current_price)).toBeCloseTo(200, 4);
    expect(Number(gold?.avg10d)).toBeCloseTo(180, 1);
    expect(Number(gold?.ankauf)).toBeCloseTo(162, 1); // 180 × 0.9
    // A metal with no rows → every field NULL (not zero).
    expect(absent?.current_price).toBeNull();
    expect(absent?.avg10d).toBeNull();
    expect(absent?.ankauf).toBeNull();
  });
});
