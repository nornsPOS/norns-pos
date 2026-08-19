/**
 * Phase-2 P1.3 — GET /api/customers/by-vat-id resolves at most ONE customer.
 *
 * Proves the bounded single-match VAT lookup that replaced the POS B2B checkout
 * N+1: normalisation (separators/lowercase collapse to the stored value), the
 * no-match → null contract, soft-delete exclusion, and that a CASHIER (not just
 * ADMIN) may call it — the old loop hit the ADMIN-only by-id route and 403'd at
 * the till. Real Postgres via testcontainers; mirrors b2b-checkout.test.ts.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
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

describe('GET /api/customers/by-vat-id', () => {
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
    await migratorSql`DELETE FROM customers`;
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

  async function seedCustomer(vatId: string | null, softDeleted = false): Promise<string> {
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, vat_id, retention_until, soft_deleted_at)
      SELECT encrypt_pii('ACME Handels GmbH'), ${vatId}, (now() + interval '5 years')::date,
             ${softDeleted ? migratorSql`now()` : null}
      FROM s RETURNING id`;
    return must(c).id;
  }

  function lookup(vatId: string, token = cashierSessionToken) {
    return app.inject({
      method: 'GET',
      url: `/api/customers/by-vat-id?vatId=${encodeURIComponent(vatId)}`,
      headers: {
        cookie: `warehouse14.session=${token}`,
        'x-dev-device-fingerprint': deviceFingerprint,
      },
    });
  }

  it('matches by normalised VAT id (separators + case collapse) as a CASHIER', async () => {
    const id = await seedCustomer('DE123456789');
    const res = await lookup('de 123-456.789');
    expect(res.statusCode).toBe(200);
    const body = res.json() as { customer: { id: string; fullName: string; vatId: string } | null };
    expect(body.customer?.id).toBe(id);
    expect(body.customer?.fullName).toBe('ACME Handels GmbH'); // decrypted
    expect(body.customer?.vatId).toBe('DE123456789');
  });

  it('returns customer: null when nothing matches', async () => {
    await seedCustomer('DE123456789');
    const res = await lookup('DE999999999');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { customer: unknown }).customer).toBeNull();
  });

  it('excludes soft-deleted customers', async () => {
    await seedCustomer('DE555555555', true);
    const res = await lookup('DE555555555');
    expect((res.json() as { customer: unknown }).customer).toBeNull();
  });

  it('rejects an unauthenticated caller (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/customers/by-vat-id?vatId=DE123456789',
    });
    expect(res.statusCode).toBe(401);
  });
});
