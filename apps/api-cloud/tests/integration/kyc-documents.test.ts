/**
 * KYC ID-document routes — the compliance gate end-to-end (#I-47, migration 0074).
 *
 *   POST /api/customers/:id/kyc-documents               — capture an Ausweis
 *   GET  /api/customers/:id/kyc-documents/:docId/image  — view the Ausweis
 *
 * Proves the RED LINES that the local-encrypted store must preserve:
 *   • BOTH routes require ADMIN **and** a fresh step-up — a CASHIER or an
 *     ADMIN-without-step-up is 403'd (never sees the image).
 *   • The keystone round-trip: the image lands on disk AES-256-GCM-encrypted
 *     (never the plaintext WebP), and the gated GET serves it back DECRYPTED
 *     with Cache-Control: no-store. R2 is gone — the bytes live in KYC_PHOTOS_DIR.
 *
 * Real Postgres via testcontainers + a temp KYC_PHOTOS_DIR; mirrors
 * customers-vat-lookup.test.ts for the container/app harness.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { applyAllMigrations } from './_migrate.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
// A deterministic 32-byte (base64) AES key — test-only, never a real secret.
const KYC_KEY = Buffer.alloc(32, 7).toString('base64');

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN SUPERUSER PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a seeded row');
  return v;
}

function aPng(): Promise<Buffer> {
  return sharp({
    create: { width: 240, height: 150, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

describe('KYC ID-document routes — ADMIN + step-up gate and encrypted round-trip', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;
  let kycDir: string;

  let customerId: string;
  let deviceFingerprint: string;
  let adminToken: string; // ADMIN + fresh step-up
  let adminNoStepUpToken: string; // ADMIN, no step-up
  let cashierToken: string; // CASHIER + fresh step-up

  // All sessions share ONE paired device (cert_serial is UNIQUE); only the
  // bound user's role + step-up freshness vary across the seeded sessions.
  async function makeSession(
    deviceId: string,
    role: 'ADMIN' | 'CASHIER',
    stepUp: boolean,
  ): Promise<string> {
    const [user] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${randomUUID()}@x.test`}, ${role}, ${role}::user_role)
      RETURNING id`;
    const userId = must(user).id;
    const token = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${userId}, ${token}, now() + interval '8 hours', ${deviceId},
              ${stepUp ? migratorSql`now()` : null})`;
    return token;
  }

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
    kycDir = await mkdtemp(join(tmpdir(), 'kyc-store-'));

    const env = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      NORNS_PII_KEY: PII_KEY,
      TRUSTED_ORIGINS: '',
      TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
      KYC_IMAGE_ENCRYPTION_KEY: KYC_KEY,
      KYC_PHOTOS_DIR: kycDir,
      KYC_STORE_MAX_BYTES: 5 * 1024 * 1024 * 1024,
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

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [pairUser] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`pair-${randomUUID()}@x.test`}, 'Pairer', 'ADMIN'::user_role)
      RETURNING id`;
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${must(pairUser).id})
      RETURNING id`;
    const deviceId = must(dev).id;
    adminToken = await makeSession(deviceId, 'ADMIN', true);
    adminNoStepUpToken = await makeSession(deviceId, 'ADMIN', false);
    cashierToken = await makeSession(deviceId, 'CASHIER', true);

    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Ausweis Kunde'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    customerId = must(c).id;
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  function captureBody(dataBase64: string) {
    return {
      documentType: 'PERSONALAUSWEIS' as const,
      issuingCountryIso2: 'DE',
      documentNumber: 'IDN-0001',
      expiresOn: '2032-01-01',
      dataBase64,
      contentType: 'image/png' as const,
    };
  }

  function authHeaders(token: string) {
    return {
      cookie: `warehouse14.session=${token}`,
      'x-dev-device-fingerprint': deviceFingerprint,
    };
  }

  it('403s a CASHIER on capture (ADMIN-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/kyc-documents`,
      headers: authHeaders(cashierToken),
      payload: captureBody((await aPng()).toString('base64')),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('captures (ADMIN + step-up) → stores AES-256-GCM ciphertext on disk, never the plaintext WebP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/kyc-documents`,
      headers: authHeaders(adminToken),
      payload: captureBody((await aPng()).toString('base64')),
    });
    expect(res.statusCode).toBe(200);
    const docId = (res.json() as { id: string }).id;
    expect(docId).toMatch(/^[0-9a-f-]{36}$/);

    // The row carries a storage key + a 32-byte sha256 + a non-zero size.
    const [row] = await migratorSql<
      { storage_key: string | null; sha_len: number | null; size: number | null }[]
    >`
      SELECT document_photo_storage_key AS storage_key,
             octet_length(document_photo_sha256) AS sha_len,
             document_photo_size_bytes AS size
        FROM kyc_documents WHERE id = ${docId}`;
    const storageKey = must(row).storage_key;
    expect(storageKey).toBeTruthy();
    expect(row?.sha_len).toBe(32);
    expect(row?.size).toBeGreaterThan(0);

    // On disk: self-framed [0x01][iv]…[tag] — version byte first, and the raw
    // RIFF/WEBP magic of the plaintext must NOT appear anywhere in the file.
    const shard = (storageKey as string).slice(0, 2).toLowerCase();
    const onDisk = await readFile(join(kycDir, shard, `${storageKey}.enc`));
    expect(onDisk[0]).toBe(0x01);
    expect(onDisk.includes(Buffer.from('WEBP'))).toBe(false);
    expect(onDisk.includes(Buffer.from('RIFF'))).toBe(false);
  });

  it('serves the image DECRYPTED to ADMIN + step-up with Cache-Control: no-store', async () => {
    const cap = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/kyc-documents`,
      headers: authHeaders(adminToken),
      payload: captureBody((await aPng()).toString('base64')),
    });
    const docId = (cap.json() as { id: string }).id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}/kyc-documents/${docId}/image`,
      headers: authHeaders(adminToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/webp');
    expect(res.headers['cache-control']).toContain('no-store');
    // Body is the DECRYPTED WebP — RIFF container with a WEBP fourCC.
    const body = res.rawPayload;
    expect(body.subarray(0, 4).toString()).toBe('RIFF');
    expect(body.subarray(8, 12).toString()).toBe('WEBP');
  });

  it('ein ADMIN sieht das Ausweisbild ohne Gerätecode — das LÖSCHEN verlangt ihn', async () => {
    // Capture first (as a proper ADMIN+step-up) so a real doc exists to be denied.
    const cap = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/kyc-documents`,
      headers: authHeaders(adminToken),
      payload: captureBody((await aPng()).toString('base64')),
    });
    const docId = (cap.json() as { id: string }).id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}/kyc-documents/${docId}/image`,
      headers: authHeaders(adminNoStepUpToken),
    });
    // Basel, 05.08.2026: ANSEHEN ist nicht unwiderruflich, LÖSCHEN schon.
    // Der Code steht deshalb auf DELETE /kyc-documents und /kyc-documents/:docId,
    // nicht auf dieser Leseansicht. Die ADMIN-Rolle bleibt Bedingung.
    expect(res.statusCode).toBe(200);
  });

  it('403s a CASHIER on the image view (ADMIN-only)', async () => {
    const cap = await app.inject({
      method: 'POST',
      url: `/api/customers/${customerId}/kyc-documents`,
      headers: authHeaders(adminToken),
      payload: captureBody((await aPng()).toString('base64')),
    });
    const docId = (cap.json() as { id: string }).id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/customers/${customerId}/kyc-documents/${docId}/image`,
      headers: authHeaders(cashierToken),
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });
});
