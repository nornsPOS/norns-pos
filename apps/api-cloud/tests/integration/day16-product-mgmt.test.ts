/**
 * Day 16 E2E — Product Management + Audit fix smoke checks.
 *
 * Coverage matrix:
 *
 *   POST /api/products
 *     ✓ ADMIN happy path → 200 + audit_log row
 *     ✓ CASHIER → 403 FORBIDDEN
 *     ✓ no cookie → 401 UNAUTHORIZED
 *     ✓ extra intake-locked field (additionalProperties false) refused by TypeBox? on PUT
 *     ✓ ein teures Stueck anlegen verlangt KEINEN Gerätecode (05.08.2026)
 *
 *   PUT /api/products/:id
 *     ✓ Owner happy update → 200 + changedFields
 *     ✓ unknown field rejected by TypeBox additionalProperties:false → 400
 *     ✓ unknown product → 404 NOT_FOUND
 *     ✓ DRAFT → AVAILABLE transition lands publishedAt
 *
 *   POST /api/products/:id/archive
 *     ✓ AVAILABLE product → 409 CONFLICT (not SOLD)
 *     ✓ SOLD product → 200 + archived_at set
 *     ✓ double archive → 409 CONFLICT
 *
 *   POST /api/products/:id/photos
 *     ✓ unknown product → 404
 *     ✓ R2 not configured (test env) → 503 SERVICE_UNAVAILABLE (clean message)
 *
 *   Audit fixes
 *     ✓ A-3 helmet: X-Content-Type-Options + Referrer-Policy present
 *     ✓ A-3 helmet: Strict-Transport-Security present
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { testUmgebung } from '../helfer/test-umgebung.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

describe('Day 16 — Product Management + audit fixes', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let ownerUserId: string;
  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let ownerTokenStepUp: string;
  let ownerTokenNoStepUp: string;
  let cashierToken: string;
  let sellerCustomerId: string;

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
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  beforeEach(async () => {
    // Demote (don't DELETE) the previous owner: devices/sessions/products from
    // earlier tests still reference it via FK (devices_paired_by_user_id_fkey),
    // and 0014's partial unique index only allows ONE is_owner = TRUE row.
    await migratorSql`UPDATE users SET is_owner = FALSE WHERE is_owner = TRUE`;

    const [owner] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`o-${randomUUID()}@x.test`}, 'Owner', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    ownerUserId = owner!.id;

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${ownerUserId})
      RETURNING id`;
    deviceId = dev!.id;

    ownerTokenStepUp = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerUserId}, ${ownerTokenStepUp}, now() + interval '30 days', ${deviceId}, now())`;

    ownerTokenNoStepUp = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${ownerUserId}, ${ownerTokenNoStepUp}, now() + interval '30 days', ${deviceId}, NULL)`;

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierToken}, now() + interval '8 hours', ${deviceId}, NULL)`;

    const [seller] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Ankauf Seller'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    sellerCustomerId = seller!.id;
  });

  function headers(token: string | null): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (token) h.cookie = `warehouse14.session=${token}`;
    h['x-dev-device-fingerprint'] = deviceFingerprint;
    return h;
  }

  /** Minimal valid create body — caller can override fields. */
  function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      sku: `SKU-${randomUUID()}`,
      itemType: 'gold_jewelry',
      metal: 'gold',
      finenessDecimal: '0.5850',
      weightGrams: '5.42',
      hallmarkStamps: ['585'],
      acquisitionCostEur: '50.00',
      listPriceEur: '150.00',
      taxTreatmentCode: 'MARGIN_25A',
      condition: 'USED_GOOD',
      isCommission: false,
      name: 'Day-16 gold ring',
      listedOnStorefront: false,
      listedOnEbay: false,
      ...overrides,
    };
  }

  // ════════════════════════════════════════════════════════════════════
  // POST /api/products
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/products', () => {
    it('Owner happy path → 200 + audit_log entry', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody({ acquiredFromCustomerId: sellerCustomerId, isCommission: true }),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { id: string; sku: string; status: string };
      expect(out.status).toBe('DRAFT');

      // audit_log row written.
      const [audit] = await migratorSql<{ payload: Record<string, unknown> }[]>`
        SELECT payload FROM audit_log
         WHERE event_type = 'product.created'
           AND (payload->>'productId')::text = ${out.id}`;
      expect(audit).toBeDefined();
      expect((audit!.payload as { isCommission: boolean }).isCommission).toBe(true);

      // is_commission + acquired_from_customer_id persisted.
      const [row] = await migratorSql<
        { is_commission: boolean; acquired_from_customer_id: string | null }[]
      >`
        SELECT is_commission, acquired_from_customer_id FROM products WHERE id = ${out.id}`;
      expect(row!.is_commission).toBe(true);
      expect(row!.acquired_from_customer_id).toBe(sellerCustomerId);
    });

    it('CASHIER role → 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(cashierToken),
        payload: createBody(),
      });
      expect(res.statusCode).toBe(403);
    });

    it('no cookie → 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(null),
        payload: createBody(),
      });
      expect(res.statusCode).toBe(401);
    });

    it('ein teures Stueck anlegen verlangt KEINEN Gerätecode mehr', async () => {
      // Basel, 05.08.2026: „مرة عند الفتح، وثانية فقط عند الأفعال التي لا
      // تُلغى" — der Gerätecode kommt beim Öffnen und danach nur noch vor
      // Unwiderruflichem. Diese Handlung gehört nicht dazu.
      // Ein angelegtes Stück lässt sich bearbeiten, archivieren und löschen;
      // erst das LÖSCHEN ist endgültig, und nur dort steht der Code.
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenNoStepUp),
        payload: createBody({ acquisitionCostEur: '5000.00' }),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // PUT /api/products/:id
  // ════════════════════════════════════════════════════════════════════

  describe('PUT /api/products/:id', () => {
    async function createOne(): Promise<string> {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      return (res.json() as { id: string }).id;
    }

    it('Owner update list price → 200 + changedFields includes listPriceEur', async () => {
      const id = await createOne();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { listPriceEur: '199.99' },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { id: string; changedFields: string[] };
      expect(out.changedFields).toContain('listPriceEur');
    });

    it('intake-locked field is stripped, never applied (additionalProperties: false)', async () => {
      // Fastify's DEFAULT AJV config has `removeAdditional: true`, so
      // `additionalProperties: false` STRIPS unknown fields instead of
      // 400-ing. The invariant that matters: acquisitionCostEur (intake-
      // locked, not in the PUT schema) can NEVER be changed via PUT.
      const id = await createOne();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { acquisitionCostEur: '999.99' }, // intake-locked, not in PUT schema
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { changedFields: string[] }).changedFields).toEqual([]);

      const detail = await app.inject({
        method: 'GET',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
      });
      expect(detail.statusCode).toBe(200);
      expect((detail.json() as { acquisitionCostEur: string }).acquisitionCostEur).toBe('50.00');
    });

    it('unknown product id → 404 NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/00000000-0000-0000-0000-000000000000`,
        headers: headers(ownerTokenStepUp),
        payload: { listPriceEur: '199.99' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('DRAFT → AVAILABLE transition lands publishedAt', async () => {
      const id = await createOne();
      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { status: 'AVAILABLE' },
      });
      expect(res.statusCode).toBe(200);
      const [row] = await migratorSql<{ status: string; published_at: Date | null }[]>`
        SELECT status, published_at FROM products WHERE id = ${id}`;
      expect(row!.status).toBe('AVAILABLE');
      expect(row!.published_at).toBeInstanceOf(Date);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // New product → sellable visibility flow (regression for the
  // "added a product but can't sell it" fix — POS publishes on create).
  // ════════════════════════════════════════════════════════════════════

  describe('new product → sellable visibility', () => {
    async function availableIds(): Promise<string[]> {
      const res = await app.inject({
        method: 'GET',
        url: '/api/products?status=AVAILABLE&limit=200',
        headers: headers(ownerTokenStepUp),
      });
      expect(res.statusCode).toBe(200);
      return (res.json() as { items: Array<{ id: string }> }).items.map((i) => i.id);
    }

    it('is DRAFT and hidden from the AVAILABLE feed until published, then visible', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      expect(created.statusCode).toBe(200);
      const out = created.json() as { id: string; status: string };
      expect(out.status).toBe('DRAFT');

      // Not yet sellable — absent from the cashier feed.
      expect(await availableIds()).not.toContain(out.id);

      // Publish (DRAFT → AVAILABLE) as ADMIN.
      const pub = await app.inject({
        method: 'PUT',
        url: `/api/products/${out.id}`,
        headers: headers(ownerTokenStepUp),
        payload: { status: 'AVAILABLE' },
      });
      expect(pub.statusCode).toBe(200);

      const [row] = await migratorSql<{ status: string; published_at: Date | null }[]>`
        SELECT status, published_at FROM products WHERE id = ${out.id}`;
      expect(row?.status).toBe('AVAILABLE');
      expect(row?.published_at).toBeInstanceOf(Date);

      // Now sellable — present in the cashier feed.
      expect(await availableIds()).toContain(out.id);
    });

    it('a CASHIER may not publish (DRAFT → AVAILABLE) → 403', async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      const id = (created.json() as { id: string }).id;

      const res = await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(cashierToken),
        payload: { status: 'AVAILABLE' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/archive
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/products/:id/archive', () => {
    it('AVAILABLE product → 409 CONFLICT', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      const id = (create.json() as { id: string }).id;
      await app.inject({
        method: 'PUT',
        url: `/api/products/${id}`,
        headers: headers(ownerTokenStepUp),
        payload: { status: 'AVAILABLE' },
      });
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${id}/archive`,
        headers: headers(ownerTokenStepUp),
        payload: {},
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
    });

    it('SOLD product → 200 + archived_at set', async () => {
      // Insert a SOLD product directly (bypass finalize for fixture brevity).
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name, published_at, sold_at)
        VALUES (${`SKU-sold-${randomUUID()}`}, 'SOLD'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '150.00', 'sold ring', now(), now())
        RETURNING id`;

      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${p!.id}/archive`,
        headers: headers(ownerTokenStepUp),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const [row] = await migratorSql<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM products WHERE id = ${p!.id}`;
      expect(row!.archived_at).toBeInstanceOf(Date);
    });

    it('ein SOLD-Stueck archivieren verlangt KEINEN Gerätecode', async () => {
      // Basel, 05.08.2026: Archivieren nimmt das Stück aus der Ansicht, es
      // bleibt in der Datenbank und im Beleg. Der Code steht auf DELETE.
      const [p] = await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type,
                              acquisition_cost_eur, list_price_eur, name, published_at, sold_at)
        VALUES (${`SKU-sold-${randomUUID()}`}, 'SOLD'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '150.00', 'x', now(), now())
        RETURNING id`;
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${p!.id}/archive`,
        headers: headers(ownerTokenNoStepUp),
        payload: {},
      });
      expect(res.statusCode).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/photos
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/products/:id/photos', () => {
    it('unknown product → 404', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/00000000-0000-0000-0000-000000000000/photos`,
        headers: headers(ownerTokenStepUp),
        payload: { contentType: 'image/jpeg', contentLength: 1024 },
      });
      expect(res.statusCode).toBe(404);
    });

    /**
     * Der Bildspeicher ist in dieser Umgebung bewusst nicht eingerichtet.
     *
     * ⚠️ Frueher stand hier 500. Das war die falsche Antwort und der Test hat
     * sie festgeschrieben: 500 behauptet einen Programmfehler im Server. Es ist
     * aber keiner. Der Ablagedienst ist schlicht nicht verfuegbar, und genau
     * das sagt 503. Der Unterschied ist fuer den Anrufer entscheidend: bei 503
     * darf er es spaeter wieder versuchen, bei 500 nicht. `products.ts` wirft
     * dafuer eigens `R2NotConfiguredError` mit `SERVICE_UNAVAILABLE`.
     *
     * Deshalb pruefen wir hier nicht nur die Zahl, sondern auch den Schluessel:
     * eine Zahl allein liesse sich jederzeit wieder still verdrehen.
     */
    it('Bildspeicher nicht eingerichtet → 503 SERVICE_UNAVAILABLE', async () => {
      const create = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody(),
      });
      const id = (create.json() as { id: string }).id;
      const res = await app.inject({
        method: 'POST',
        url: `/api/products/${id}/photos`,
        headers: headers(ownerTokenStepUp),
        payload: { contentType: 'image/jpeg', contentLength: 1024 },
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('SERVICE_UNAVAILABLE');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // Audit fix A-3 (helmet) — smoke check on response headers
  // ════════════════════════════════════════════════════════════════════

  describe('Audit fix A-3 — helmet security headers', () => {
    it('GET /health carries X-Content-Type-Options + Referrer-Policy + HSTS', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(String(res.headers['strict-transport-security'])).toMatch(/max-age=/);
      expect(res.headers['x-frame-options']).toBe('DENY');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  Stueckzahl (19.08.2026): N identische Stuecke, eine Transaktion
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/products mit stueckzahl', () => {
    it('⛔ 3 Stuecke: drei Zeilen, Laufnummern-SKUs, created-Liste, je ein Audit', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody({ sku: 'MUENZE-999', stueckzahl: 3 }),
      });
      expect(res.statusCode, res.body).toBe(200);
      const out = res.json() as {
        sku: string;
        created?: Array<{ id: string; sku: string }>;
      };
      // Wurzel = erstes Stueck (Altvertrag), Liste = alle drei.
      expect(out.sku).toBe('MUENZE-999-01');
      expect(out.created?.map((c) => c.sku)).toEqual([
        'MUENZE-999-01',
        'MUENZE-999-02',
        'MUENZE-999-03',
      ]);

      // Drei ECHTE Zeilen, jede ihr eigenes Stueck (Modellwahrheit).
      const zeilen = await migratorSql<{ sku: string; barcode: string }[]>`
        SELECT sku, barcode FROM products WHERE sku LIKE 'MUENZE-999-%' ORDER BY sku`;
      expect(zeilen.map((z) => z.sku)).toEqual(['MUENZE-999-01', 'MUENZE-999-02', 'MUENZE-999-03']);
      // Der Strichcode ist je Stueck die eigene SKU: drei Etiketten, drei Scans.
      expect(zeilen.map((z) => z.barcode)).toEqual(zeilen.map((z) => z.sku));

      // Je Stueck ein eigener Tagebucheintrag.
      const [n] = await migratorSql<{ c: string }[]>`
        SELECT count(*)::text AS c FROM audit_log
         WHERE event_type = 'product.created' AND payload->>'sku' LIKE 'MUENZE-999-%'`;
      expect(Number(n!.c)).toBe(3);
    });

    it('stueckzahl 1 (oder weggelassen) aendert am Altvertrag NICHTS', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody({ sku: 'EINZEL-1', stueckzahl: 1 }),
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { sku: string; created?: unknown };
      expect(out.sku).toBe('EINZEL-1'); // KEIN Suffix
      expect(out.created).toBeUndefined();
    });

    it('201 Stueck weist das Schema ab (Schutzkappe gegen den Tippfehler)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/products',
        headers: headers(ownerTokenStepUp),
        payload: createBody({ sku: 'ZUVIEL-1', stueckzahl: 201 }),
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
