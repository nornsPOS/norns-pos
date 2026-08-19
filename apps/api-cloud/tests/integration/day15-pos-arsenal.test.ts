/**
 * Day 15 E2E — POS arsenal completion.
 *
 *   POST /api/inventory/reserve     — race-safe AVAILABLE → RESERVED
 *   POST /api/inventory/release     — session-guarded RESERVED → AVAILABLE
 *   POST /api/transactions/storno   — mandatory PIN step-up; one-per-original
 *
 * Coverage matrix:
 *
 *   reserve  ✓ happy path → 200 + reservation snapshot
 *            ✓ already reserved → 409 PRODUCT_NOT_RESERVABLE
 *            ✓ no cookie → 401 UNAUTHORIZED
 *            ✓ READONLY role → 403 FORBIDDEN
 *
 *   release  ✓ happy path → product back to AVAILABLE
 *            ✓ wrong sessionId → 409 PRODUCT_NOT_RESERVABLE
 *            ✓ no cookie → 401 UNAUTHORIZED
 *
 *   storno   ✓ happy path → 200 + cumulative_spend reversed + ledger emitted
 *            ✓ NO step-up → 403 STEP_UP_REQUIRED (Basel directive: mandatory)
 *            ✓ double storno of same original → 409 CONFLICT
 *            ✓ storno of a storno → 422 STORNO_OF_STORNO
 *            ✓ unknown original → 404 NOT_FOUND
 *            ✓ no cookie → 401 UNAUTHORIZED
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

describe('Day 15 — POS arsenal (reserve / release / storno)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  // Fixtures
  let cashierUserId: string;
  let readonlyUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let cashierTokenWithStepUp: string;
  let cashierTokenNoStepUp: string;
  let readonlyToken: string;
  let productId: string;
  let customerId: string;

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
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    const [ro] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`r-${randomUUID()}@x.test`}, 'Reader', 'READONLY'::user_role)
      RETURNING id`;
    readonlyUserId = ro!.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days',
              ${cashierUserId})
      RETURNING id`;
    deviceId = dev!.id;

    cashierTokenWithStepUp = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierTokenWithStepUp}, now() + interval '8 hours',
              ${deviceId}, now())`;

    cashierTokenNoStepUp = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierTokenNoStepUp}, now() + interval '8 hours',
              ${deviceId}, NULL)`;

    readonlyToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${readonlyUserId}, ${readonlyToken}, now() + interval '8 hours',
              ${deviceId}, NULL)`;

    const [product] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '50.00', '150.00', 'Day-15 ring', now())
      RETURNING id`;
    productId = product!.id;

    const [cust] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Day-15 Customer'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    customerId = cust!.id;
  });

  // ────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────

  function headers(token: string | null): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (token) h.cookie = `warehouse14.session=${token}`;
    h['x-dev-device-fingerprint'] = deviceFingerprint;
    return h;
  }

  /**
   * Seed an original VERKAUF transaction (with one item + one payment) so we
   * have something to storno. Inserts via migrator SQL (bypassing the API)
   * so this test isolates storno-route behavior.
   *
   * ⚠️ EIN BELEG IST EINE DATENBANKTRANSAKTION (Wanderung 0016).
   *
   * Kopf, Positionen und Zahlungen tragen einen DEFERRABLE INITIALLY DEFERRED
   * Waechter, der beim COMMIT nachrechnet: Summe der Positionen und Summe der
   * Zahlungen muessen den Kopf ausgleichen. Standen die drei INSERTs wie
   * frueher jeder fuer sich, so lief der Kopf-INSERT in seinen eigenen COMMIT,
   * fand dort weder Position noch Zahlung und wurde zurueckgerollt.
   *
   * Gemessen am 04.08.2026: `RETURNING id` lieferte trotzdem eine Kennung, denn
   * RETURNING antwortet VOR dem COMMIT. Danach stand die Zeile nicht mehr da,
   * und der naechste INSERT scheiterte am Fremdschluessel. Die Meldung zeigte
   * damit auf die Positionen, obwohl der Kopf verschwunden war.
   *
   * Der Waechter ist richtig und bleibt scharf: eine Kasse darf keinen Kopf
   * fuehren, den weder Ware noch Geld deckt. Deshalb schreibt die Buehne alles
   * in EINEM `begin()`, genau wie es der Abschlussweg der Anwendung tut.
   */
  async function seedOriginalTransaction(opts: { totalEur?: string } = {}): Promise<{
    id: string;
    totalEur: string;
  }> {
    const total = opts.totalEur ?? '150.00';
    const totalNum = Number.parseFloat(total);
    const margin = totalNum - 50;
    const vat = Math.round(((margin * 19) / 119) * 100) / 100;
    const subtotal = Math.round((totalNum - vat) * 100) / 100;

    // First reserve + flip the product to RESERVED so finalize would have worked.
    // We don't actually call finalize — we just need a transaction row to storno.
    // Mark the product SOLD directly (mirrors what finalize would do).
    await migratorSql`
      UPDATE products SET status = 'SOLD'::product_status, sold_at = now()
       WHERE id = ${productId}`;

    const id = await migratorSql.begin(async (tx) => {
      const [kopf] = await tx<{ id: string }[]>`
        INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                  subtotal_eur, vat_eur, total_eur, tax_treatment_code)
        VALUES ('VERKAUF'::transaction_direction, ${customerId}, ${deviceId}, ${cashierUserId},
                ${subtotal.toFixed(2)}, ${vat.toFixed(2)}, ${totalNum.toFixed(2)}, 'MARGIN_25A')
        RETURNING id`;
      await tx`
        INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                       line_vat_eur, line_total_eur,
                                       applied_tax_treatment_code, applied_vat_rate,
                                       acquisition_cost_eur_snapshot, margin_eur)
        VALUES (${kopf!.id}, ${productId}, ${subtotal.toFixed(2)}, ${vat.toFixed(2)},
                ${totalNum.toFixed(2)}, 'MARGIN_25A', NULL, '50.00', ${margin.toFixed(2)})`;
      await tx`
        INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
        VALUES (${kopf!.id}, 'CASH'::payment_method, ${totalNum.toFixed(2)})`;
      return kopf!.id;
    });

    return { id, totalEur: totalNum.toFixed(2) };
  }

  // ════════════════════════════════════════════════════════════════════
  // /api/inventory/reserve
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/inventory/reserve', () => {
    it('happy path → 200 + product becomes RESERVED', async () => {
      const sessionId = randomUUID();
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/reserve',
        headers: headers(cashierTokenWithStepUp),
        payload: { productId, channel: 'POS', sessionId },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as { productId: string; channel: string; sessionId: string };
      expect(out.productId).toBe(productId);
      expect(out.channel).toBe('POS');
      expect(out.sessionId).toBe(sessionId);

      const [row] = await migratorSql<{ status: string; reserved_by_session_id: string | null }[]>`
        SELECT status, reserved_by_session_id FROM products WHERE id = ${productId}`;
      expect(row!.status).toBe('RESERVED');
      expect(row!.reserved_by_session_id).toBe(sessionId);
    });

    it('product already reserved → 409 PRODUCT_NOT_RESERVABLE', async () => {
      // First reserve.
      await app.inject({
        method: 'POST',
        url: '/api/inventory/reserve',
        headers: headers(cashierTokenWithStepUp),
        payload: { productId, channel: 'POS', sessionId: randomUUID() },
      });
      // Second reserve attempt (different session).
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/reserve',
        headers: headers(cashierTokenWithStepUp),
        payload: { productId, channel: 'POS', sessionId: randomUUID() },
      });
      expect(res.statusCode).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_RESERVABLE');
    });

    it('no cookie → 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/reserve',
        headers: headers(null),
        payload: { productId, channel: 'POS', sessionId: randomUUID() },
      });
      expect(res.statusCode).toBe(401);
    });

    it('READONLY role → 403 FORBIDDEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/inventory/reserve',
        headers: headers(readonlyToken),
        payload: { productId, channel: 'POS', sessionId: randomUUID() },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // /api/inventory/release
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/inventory/release', () => {
    it('happy path → product back to AVAILABLE', async () => {
      const sessionId = randomUUID();
      const r1 = await app.inject({
        method: 'POST',
        url: '/api/inventory/reserve',
        headers: headers(cashierTokenWithStepUp),
        payload: { productId, channel: 'POS', sessionId },
      });
      expect(r1.statusCode).toBe(200);

      const r2 = await app.inject({
        method: 'POST',
        url: '/api/inventory/release',
        headers: headers(cashierTokenWithStepUp),
        payload: { productId, sessionId, reason: 'pos_cart_cleared' },
      });
      expect(r2.statusCode).toBe(200);

      const [row] = await migratorSql<{ status: string }[]>`
        SELECT status FROM products WHERE id = ${productId}`;
      expect(row!.status).toBe('AVAILABLE');
    });

    it('wrong sessionId → 409 PRODUCT_NOT_RESERVABLE', async () => {
      const sessionId = randomUUID();
      await app.inject({
        method: 'POST',
        url: '/api/inventory/reserve',
        headers: headers(cashierTokenWithStepUp),
        payload: { productId, channel: 'POS', sessionId },
      });
      const r = await app.inject({
        method: 'POST',
        url: '/api/inventory/release',
        headers: headers(cashierTokenWithStepUp),
        payload: { productId, sessionId: randomUUID(), reason: 'pos_cart_cleared' },
      });
      expect(r.statusCode).toBe(409);
      expect((r.json() as { error: { code: string } }).error.code).toBe('PRODUCT_NOT_RESERVABLE');
    });

    it('no cookie → 401 UNAUTHORIZED', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/inventory/release',
        headers: headers(null),
        payload: { productId, sessionId: randomUUID(), reason: 'pos_cart_cleared' },
      });
      expect(r.statusCode).toBe(401);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // /api/transactions/storno
  // ════════════════════════════════════════════════════════════════════

  describe('POST /api/transactions/storno', () => {
    /*
     * ── 11.08.2026: DIE LADE MUSS OFFEN SEIN ────────────────────────────
     *
     * Der Storno weist seit heute eine BARRUECKGABE ohne offene Schicht ab
     * (`StornoBargeldOhneSchichtError`) — dieselbe Regel, die der Verkauf
     * seit dem 08.08. kennt. Grund: was in keiner Schicht steht, liegt in
     * keinem Kassensturz, und der Tagesabschluss schreibt eine erfundene
     * Differenz fest.
     *
     * Diese Datei legt ihre Belege per SQL an und umgeht damit den Riegel
     * der Verkaufsroute. Sie mass also einen Zustand, den die Kasse gar
     * nicht herstellen kann. Die Schicht hier stellt den echten her; ein
     * Tagesabschluss laeuft in dieser Datei nicht, sie darf offen bleiben.
     */
    beforeEach(async () => {
      await migratorSql`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status)
        VALUES (${deviceId}::uuid, ${cashierUserId}::uuid, '0.00', 'OPEN')`;
    });

    it('happy path: step-up cashier → 200 + cumulative_spend reversed + ledger event emitted', async () => {
      const original = await seedOriginalTransaction({ totalEur: '150.00' });

      // Snapshot the customer's cumulative_spend BEFORE storno.
      // (The original was inserted via migrator SQL so the trigger DID fire
      // for the INSERT — cumulative is already +150.00.)
      const [before] = await migratorSql<{ cumulative_spend_eur: string }[]>`
        SELECT cumulative_spend_eur FROM customers WHERE id = ${customerId}`;
      expect(before!.cumulative_spend_eur).toBe('150.00');

      const res = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(cashierTokenWithStepUp),
        payload: {
          originalTransactionId: original.id,
          reason: 'Customer changed mind right after sale',
        },
      });
      expect(res.statusCode).toBe(200);
      const out = res.json() as {
        id: string;
        stornoOfTransactionId: string;
        totalEur: string;
        direction: string;
        ledgerEventId: number;
      };
      expect(out.stornoOfTransactionId).toBe(original.id);
      expect(out.totalEur).toBe('-150.00');
      expect(out.direction).toBe('VERKAUF');
      expect(out.ledgerEventId).toBeGreaterThan(0);

      // cumulative_spend reversed.
      const [after] = await migratorSql<{ cumulative_spend_eur: string }[]>`
        SELECT cumulative_spend_eur FROM customers WHERE id = ${customerId}`;
      expect(after!.cumulative_spend_eur).toBe('0.00');

      // Two ledger events for this transaction lineage:
      //   transaction.finalized   (original)
      //   transaction.stornoed    (storno)
      const ledgerRows = await migratorSql<{ event_type: string }[]>`
        SELECT event_type FROM ledger_events
         WHERE entity_table = 'transactions'
           AND entity_id IN (${original.id}, ${out.id})
         ORDER BY id`;
      expect(ledgerRows.map((r) => r.event_type)).toEqual([
        'transaction.finalized',
        'transaction.stornoed',
      ]);

      // audit_log carries the reason.
      const [audit] = await migratorSql<
        { event_type: string; payload: { reason: string; stornoId: string } }[]
      >`
        SELECT event_type, payload FROM audit_log
         WHERE event_type = 'transaction.stornoed_with_reason'
           AND (payload->>'stornoId')::text = ${out.id}`;
      expect(audit).toBeDefined();
      expect(audit!.payload.reason).toBe('Customer changed mind right after sale');
    });

    it('NO step-up on cashier session → 403 STEP_UP_REQUIRED (Basel mandatory rule)', async () => {
      const original = await seedOriginalTransaction();
      const res = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(cashierTokenNoStepUp),
        payload: { originalTransactionId: original.id, reason: 'No step-up means rejected' },
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
    });

    it('double storno of the same original → 409 CONFLICT', async () => {
      const original = await seedOriginalTransaction();
      const ok = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(cashierTokenWithStepUp),
        payload: { originalTransactionId: original.id, reason: 'First storno is fine' },
      });
      expect(ok.statusCode).toBe(200);

      const dup = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(cashierTokenWithStepUp),
        payload: { originalTransactionId: original.id, reason: 'This should be rejected outright' },
      });
      expect(dup.statusCode).toBe(409);
      expect((dup.json() as { error: { code: string } }).error.code).toBe('CONFLICT');
    });

    it('storno of a storno → 422 STORNO_OF_STORNO', async () => {
      const original = await seedOriginalTransaction();
      const first = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(cashierTokenWithStepUp),
        payload: { originalTransactionId: original.id, reason: 'First storno legitimate' },
      });
      expect(first.statusCode).toBe(200);
      const firstId = (first.json() as { id: string }).id;

      const res = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(cashierTokenWithStepUp),
        payload: { originalTransactionId: firstId, reason: 'Trying to storno a storno' },
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe('STORNO_OF_STORNO');
    });

    it('unknown originalTransactionId → 404 NOT_FOUND', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(cashierTokenWithStepUp),
        payload: {
          originalTransactionId: '00000000-0000-0000-0000-000000000000',
          reason: 'Nonexistent original',
        },
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });

    it('no cookie → 401 UNAUTHORIZED', async () => {
      const original = await seedOriginalTransaction();
      const res = await app.inject({
        method: 'POST',
        url: '/api/transactions/storno',
        headers: headers(null),
        payload: { originalTransactionId: original.id, reason: 'No auth at all' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
