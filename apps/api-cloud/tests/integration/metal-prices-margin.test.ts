/**
 * PATCH /api/metal-prices/margin — Owner-editable Ankauf safety margin (A3).
 *
 * Coverage:
 *   ✓ no session            → 401
 *   ✓ cashier (not owner)   → 403
 *   ✓ owner without step-up → 403
 *   ✓ owner + step-up       → 200, system_settings updated, GET /rates reflects it
 *   ✓ out-of-range marginPct → 400 (schema validation)
 *
 * NOTE: requires a Postgres testcontainer (Docker) + extension privileges, same
 * as every api-cloud integration test. Mirrors the transactions-finalize harness.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { testUmgebung } from '../helfer/test-umgebung.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
const MARGIN_KEY = 'pricing.ankauf_safety_margin_pct';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

function firstId(rows: { id: string }[]): string {
  const r = rows[0];
  if (!r) throw new Error('INSERT … RETURNING id produced no row');
  return r.id;
}

describe('PATCH /api/metal-prices/margin', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let deviceFingerprint: string;
  let cashierToken: string;
  let ownerNoStepUpToken: string;
  let ownerStepUpToken: string;

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
    await applyAll(migratorSql);
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

    const env: Env = testUmgebung({
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
    });
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
    await migratorSql`DELETE FROM sessions`;
    // ⚠️ ERST das Tagebuch, DANN die Menschen. Seit die Marge ohne Gerätecode
    // durchgeht (05.08.2026), hinterlaesst der Test davor eine audit_log-Zeile
    // mit actor_user_id — und `DELETE FROM users` lief in
    // audit_log_actor_user_id_fkey. Der Fremdschluessel ist richtig so; die
    // Aufraeumung war es nicht.
    await migratorSql`DELETE FROM audit_log`;
    // Und die Einstellung merkt sich, WER sie zuletzt geändert hat
    // (system_settings_updated_by_user_id_fkey). Auch dieser Zeiger muss
    // fallen, bevor der Mensch fällt.
    await migratorSql`UPDATE system_settings SET updated_by_user_id = NULL
                       WHERE updated_by_user_id IS NOT NULL`;
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;
    await migratorSql`UPDATE system_settings SET value = '0.10'::jsonb WHERE key = ${MARGIN_KEY}`;

    const cashierId = firstId(
      await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role) RETURNING id`,
    );
    const ownerId = firstId(
      await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role, is_owner)
        VALUES (${`o-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE) RETURNING id`,
    );

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const deviceId = firstId(
      await migratorSql<{ id: string }[]>`
        INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
        VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
                now() - interval '1 day', now() + interval '365 days', ${cashierId})
        RETURNING id`,
    );

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierId}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, NULL)`;

    ownerNoStepUpToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerId}, ${ownerNoStepUpToken}, now() + interval '30 days', ${deviceId}, NULL)`;

    ownerStepUpToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerId}, ${ownerStepUpToken}, now() + interval '30 days', ${deviceId}, now())`;
  });

  function patchMargin(marginPct: number, token?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.cookie = `warehouse14.session=${token}`;
    headers['x-dev-device-fingerprint'] = deviceFingerprint;
    return app.inject({
      method: 'PATCH',
      url: '/api/metal-prices/margin',
      headers,
      payload: { marginPct },
    });
  }

  it('rejects an unauthenticated request (401)', async () => {
    const res = await patchMargin(0.12);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a cashier — Owner-only (403)', async () => {
    const res = await patchMargin(0.12, cashierToken);
    expect(res.statusCode).toBe(403);
  });

  it('ein Inhaber setzt die Marge ohne Gerätecode', async () => {
    // Basel, 05.08.2026: eine Marge ist eine Einstellung und jederzeit wieder
    // änderbar. Der Code steht nur vor Unwiderruflichem. Die Inhaberprüfung
    // bleibt — der Test darüber zeigt, dass ein Kassierer 403 bekommt.
    const res = await patchMargin(0.12, ownerNoStepUpToken);
    expect(res.statusCode).toBe(200);
  });

  it('rejects an out-of-range margin (400)', async () => {
    const res = await patchMargin(0.7, ownerStepUpToken);
    expect(res.statusCode).toBe(400);
  });

  it('accepts Owner + step-up, persists to system_settings, and GET /rates reflects it', async () => {
    const res = await patchMargin(0.12, ownerStepUpToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ marginPct: 0.12 });

    const rows = await migratorSql<{ value: unknown }[]>`
      SELECT value FROM system_settings WHERE key = ${MARGIN_KEY}`;
    expect(rows[0]?.value).toBe(0.12);

    const ratesRes = await app.inject({
      method: 'GET',
      url: '/api/metal-prices/rates',
      headers: {
        cookie: `warehouse14.session=${ownerStepUpToken}`,
        'x-dev-device-fingerprint': deviceFingerprint,
      },
    });
    expect(ratesRes.statusCode).toBe(200);
    expect(ratesRes.json().safetyMarginPct).toBe(0.12);
  });
});
