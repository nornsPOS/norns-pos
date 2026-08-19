/**
 * Phase-2 P1.4 — teardown-survivable batch release + the stale-POS-hold sweep.
 *
 * The POS `beforeunload` handler used to loop `productsApi.release` (a normal
 * fetch the browser CANCELS on teardown) → POS holds leaked. The fix is a single
 * navigator.sendBeacon to POST /api/inventory/release/batch, whose token rides
 * in the body (a beacon can't set headers) and whose CASHIER device gate is
 * relaxed (a beacon can't send the mTLS fingerprint). The durable backstop for a
 * beacon that never arrives (SIGKILL) is autoReleaseStalePos, run by a worker.
 *
 * Real Postgres via testcontainers; mirrors b2b-checkout / customers-vat-lookup.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { autoReleaseStalePos } from '@norns/inventory-lock';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { applyAllMigrations } from './_migrate.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN SUPERUSER PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a seeded row');
  return v;
}

describe('inventory release/batch + stale-POS sweep (P1.4)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let cashierUserId: string;
  let deviceFingerprint: string;
  let cashierSessionToken: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();

    migratorSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 5,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });

    const env = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      NORNS_PII_KEY: PII_KEY,
      TRUSTED_ORIGINS: '',
      TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
      R2_ACCOUNT_ID: '',
      R2_BUCKET: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_PUBLIC_URL_BASE: '',
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      STRIPE_API_VERSION: '2024-12-18.acacia',
    } as unknown as Env;
    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  beforeEach(async () => {
    await migratorSql`DELETE FROM products`;
    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = must(cashier).id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${cashierUserId})
      RETURNING id`;
    const deviceId = must(dev).id;

    cashierSessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierSessionToken}, now() + interval '8 hours', ${deviceId}, NULL)`;
  });

  /** Seed a product RESERVED on the POS channel; returns { id, sessionId }. */
  async function seedPosHold(reservedAtSql = migratorSql`now()`): Promise<{
    id: string;
    sessionId: string;
  }> {
    const sessionId = randomUUID();
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at,
                            reserved_by_channel, reserved_by_session_id, reserved_by_user_id, reserved_at)
      VALUES (${`SKU-${randomUUID()}`}, 'RESERVED'::product_status, 'STANDARD_19',
              'watch'::item_type, '50.00', '119.00', 'Held watch', now(),
              'POS'::reservation_channel, ${sessionId}, ${cashierUserId}, ${reservedAtSql})
      RETURNING id`;
    return { id: must(p).id, sessionId };
  }

  it('releases every item; a stale-session item lands in failedProductIds (no rollback)', async () => {
    const a = await seedPosHold();
    const b = await seedPosHold();

    const res = await app.inject({
      method: 'POST',
      url: '/api/inventory/release/batch',
      headers: {
        'content-type': 'application/json',
        cookie: `warehouse14.session=${cashierSessionToken}`,
        'x-dev-device-fingerprint': deviceFingerprint,
      },
      payload: {
        reason: 'pos_cart_cleared',
        items: [
          { productId: a.id, sessionId: a.sessionId },
          { productId: b.id, sessionId: randomUUID() }, // wrong session → ownership mismatch
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { releasedProductIds: string[]; failedProductIds: string[] };
    expect(body.releasedProductIds).toEqual([a.id]);
    expect(body.failedProductIds).toEqual([b.id]);

    // The valid release COMMITTED despite the sibling failure (no rollback).
    const [rowA] = await migratorSql<{ status: string }[]>`
      SELECT status::text AS status FROM products WHERE id = ${a.id}`;
    expect(must(rowA).status).toBe('AVAILABLE');
    const [rowB] = await migratorSql<{ status: string }[]>`
      SELECT status::text AS status FROM products WHERE id = ${b.id}`;
    expect(must(rowB).status).toBe('RESERVED'); // untouched
  });

  it('authenticates a beacon: token in body + NO cookie/device header → 200', async () => {
    const a = await seedPosHold();
    const res = await app.inject({
      method: 'POST',
      url: '/api/inventory/release/batch',
      headers: { 'content-type': 'application/json' }, // no cookie, no device fingerprint
      payload: {
        reason: 'pos_cart_cleared',
        accessToken: cashierSessionToken,
        items: [{ productId: a.id, sessionId: a.sessionId }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { releasedProductIds: string[] }).releasedProductIds).toEqual([a.id]);
  });

  it('rejects a beacon with a bad/empty accessToken and no cookie (401)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/inventory/release/batch',
      headers: { 'content-type': 'application/json' },
      payload: {
        reason: 'pos_cart_cleared',
        accessToken: 'not-a-real-token',
        items: [{ productId: randomUUID(), sessionId: randomUUID() }],
      },
    });
    expect(res.statusCode).toBe(401);
  });

  it('autoReleaseStalePos reclaims an abandoned POS hold but spares a fresh one', async () => {
    const stale = await seedPosHold(migratorSql`now() - interval '13 hours'`);
    const fresh = await seedPosHold(migratorSql`now()`);

    const released = await autoReleaseStalePos(appDb, { staleAfterMinutes: 720 });
    expect(released).toEqual([stale.id]);

    const [staleRow] = await migratorSql<{ status: string }[]>`
      SELECT status::text AS status FROM products WHERE id = ${stale.id}`;
    expect(must(staleRow).status).toBe('AVAILABLE');
    const [freshRow] = await migratorSql<{ status: string }[]>`
      SELECT status::text AS status FROM products WHERE id = ${fresh.id}`;
    expect(must(freshRow).status).toBe('RESERVED'); // within the window — untouched
  });
});
