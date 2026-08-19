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
    SUPERUSER
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

describe('B2B checkout integration test', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let cashierSessionToken: string;
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
    /**
     * ⚠️ DIE FISKALISCHEN VORAUSSETZUNGEN EINES ARBEITENDEN LADENS.
     *
     * Seit dem 02.08.2026 verweigert die Kasse ohne Sicherungseinrichtung nach
     * § 146a AO JEDEN Verkauf (409 CONFLICT), und ohne hinterlegten
     * Umsatzsteuer-Status jeden ebenso (403 VAT_CHECK_REQUIRED). Beides ist
     * richtig, nur sät diese Bühne es nicht, seit die Riegel dazukamen.
     *
     * ⚠️ Der Umsatzsteuer-Status braucht BEIDE Schlüssel: ohne das Datum, ab
     * dem er gilt, zählt er als nicht hinterlegt.
     *
     * Alles Testwerte, kein echtes Gerät und kein echter Betrieb.
     */
    await migratorSql`
      INSERT INTO system_settings (key, value, description) VALUES
        ('tse.tss_id',           '"11111111-2222-3333-4444-555555555555"'::jsonb, 'Testwert'),
        ('tse.client_id',        '"66666666-7777-8888-9999-000000000000"'::jsonb, 'Testwert'),
        ('steuer.modus',         '"REGELBESTEUERUNG"'::jsonb,                     'Testwert'),
        ('steuer.modus_gilt_ab', '"2020-01-01"'::jsonb,                           'Testwert')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

    // Fresh seed data
    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days',
              ${cashierUserId})
      RETURNING id`;
    deviceId = dev!.id;

    // ⛔ 08.08.2026: ohne offene Schicht ist ein BARER Verkauf jetzt ein 409 —
    // dieses Geld erschiene sonst in keinem Kassensturz. Siehe
    // `BargeldOhneSchichtError` in transactions-finalize.ts.
    await migratorSql`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status)
      VALUES (${deviceId}, ${cashierUserId}, '100.00', 'OPEN'::shift_status)`;

    cashierSessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierSessionToken}, now() + interval '8 hours',
              ${deviceId}, NULL)`;

    // A standard 19% product
    const [product] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'watch'::item_type, '50.00', '119.00', 'B2B eligible watch', now())
      RETURNING id`;
    productId = product!.id;

    // ⚠️ Bis zum 26.07.2026 stand hier `DE123456789` — die ERFUNDENE Nummer
    // aus der Vorlage, ohne jede Pruefung. Der Test war gruen, weil die Route
    // gar nichts pruefte: `taxTreatmentCode` kam aus dem Rumpf und ging bis in
    // den Hauptbuch-Eintrag durch.
    //
    // Er verlangt jetzt genau das, was § 6a Abs. 4 UStG verlangt: eine
    // dokumentierte, gueltige und frische Abfrage nach § 18e UStG. Die Nummer
    // unten ist eine echte, oeffentlich pruefbare deutsche USt-IdNr.
    const [cust] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, vat_id, retention_until,
                             vat_id_checked_value, vat_id_checked_at, vat_id_check_result)
      SELECT encrypt_pii('B2B Tech AG'), 'DE811907980', (now() + interval '5 years')::date,
             'DE811907980', now() - interval '2 days', 'GUELTIG'::vat_check_result
        FROM s
      RETURNING id`;
    customerId = cust!.id;
  });

  /**
   * ⚠️ Der Vorgang, der bis zum 26.07.2026 DURCHGING.
   *
   * Derselbe Rumpf, nur ohne dokumentierte Pruefung beim Kunden. Vorher wurde
   * er angenommen und ohne Umsatzsteuer verbucht — an 19 Prozent des Verkaufs.
   */
  it('lehnt § 13b ab, wenn die USt-IdNr. nie geprueft wurde', async () => {
    const [roh] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, vat_id, retention_until)
      SELECT encrypt_pii('Ungeprueft GmbH'), 'DE811907980', (now() + interval '5 years')::date FROM s
      RETURNING id`;

    const sessionId = randomUUID();
    // ⚠️ Die Spalten heissen `name`, `description_de` und `reserved_by_channel`.
    // Die Bühne schrieb `title`, `description` und `reserved_channel`; keine
    // dieser drei Spalten gibt es. Ausserdem ist `tax_treatment_code` nicht
    // wegzulassen, es ist ein Pflichtfeld mit Fremdschlüssel auf die Tabelle
    // der Steuerbehandlungen.
    const [p2] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, name, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, description_de,
                            published_at, created_at)
      VALUES (${`B2B-UNGEPRUEFT-${randomUUID()}`}, 'AVAILABLE'::product_status, 'Ungeprueft',
              'STANDARD_19', 'watch'::item_type, '50.00', '119.00', 'x', now(), now())
      RETURNING id`;
    await migratorSql`
      UPDATE products SET status = 'RESERVED'::product_status, reserved_at = now(),
             reserved_by_session_id = ${sessionId},
             reserved_by_channel = 'POS'::reservation_channel,
             reserved_by_user_id = ${cashierUserId}
       WHERE id = ${p2!.id}`;

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/finalize',
      headers: {
        'content-type': 'application/json',
        cookie: `warehouse14.session=${cashierSessionToken}`,
        'x-dev-device-fingerprint': deviceFingerprint,
      },
      payload: {
        // Der Vorgangsschlüssel ist seit Wanderung 0028 Pflicht: derselbe
        // Schlüssel bei jedem Wiederholversuch desselben Verkaufs, damit ein
        // abgerissenes Netz keinen zweiten Beleg erzeugt.
        idempotencyKey: randomUUID(),
        direction: 'VERKAUF',
        customerId: roh!.id,
        subtotalEur: '100.00',
        vatEur: '0.00',
        totalEur: '100.00',
        taxTreatmentCode: 'REVERSE_CHARGE_13B',
        items: [
          {
            productId: p2!.id,
            reservationSessionId: sessionId,
            lineSubtotalEur: '100.00',
            lineVatEur: '0.00',
            lineTotalEur: '100.00',
            appliedTaxTreatmentCode: 'REVERSE_CHARGE_13B',
            appliedVatRate: '0.0000',
            // ⚠️ BEIDE leer, und das ist keine Bequemlichkeit. Einkaufspreis
            // und Marge gehören zur Differenzbesteuerung nach § 25a; eine
            // Zeile nach § 13b hat keine. Schema und Datenbank verlangen
            // deshalb beide zusammen oder beide leer
            // (CHECK `(margin_eur IS NULL) = (acquisition_cost_eur_snapshot IS NULL)`).
            // Die Bühne schickte den Einkaufspreis ohne Marge und lief in
            // genau diesen Riegel.
            acquisitionCostEurSnapshot: null,
            marginEur: null,
            displayOrder: 1,
          },
        ],
        payments: [{ paymentMethod: 'CASH', amountEur: '100.00' }],
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('VAT_CHECK_REQUIRED');
    expect(res.json().error.message).toContain('nie geprüft');
  });

  it('finalizes a B2B reverse charge checkout successfully with correct net totals and ledger', async () => {
    // 1. Reserve the product
    const sessionId = randomUUID();
    await migratorSql`
      UPDATE products
         SET status = 'RESERVED'::product_status,
             reserved_at = now(),
             reserved_by_session_id = ${sessionId},
             reserved_by_channel = 'POS'::reservation_channel,
             reserved_by_user_id = ${cashierUserId}
       WHERE id = ${productId}`;

    // 2. Build B2B Reverse Charge payload. List price is €119.00 gross, net is €100.00.
    // 13b overrides standard 19% to REVERSE_CHARGE_13B (0% VAT, net pricing).
    const body = {
      idempotencyKey: randomUUID(),
      direction: 'VERKAUF',
      customerId,
      subtotalEur: '100.00',
      vatEur: '0.00',
      totalEur: '100.00',
      taxTreatmentCode: 'REVERSE_CHARGE_13B',
      items: [
        {
          productId,
          reservationSessionId: sessionId,
          lineSubtotalEur: '100.00',
          lineVatEur: '0.00',
          lineTotalEur: '100.00',
          appliedTaxTreatmentCode: 'REVERSE_CHARGE_13B',
          appliedVatRate: '0.0000',
          // Siehe oben: § 13b kennt keine Marge nach § 25a, also beide leer.
          acquisitionCostEurSnapshot: null,
          marginEur: null,
          displayOrder: 1,
        },
      ],
      payments: [
        {
          paymentMethod: 'CASH',
          amountEur: '100.00',
        },
      ],
    };

    const res = await app.inject({
      method: 'POST',
      url: '/api/transactions/finalize',
      headers: {
        'content-type': 'application/json',
        cookie: `warehouse14.session=${cashierSessionToken}`,
        'x-dev-device-fingerprint': deviceFingerprint,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const out = res.json() as {
      id: string;
      receiptLocator: string;
      ledgerEventId: number;
      direction: string;
      totalEur: string;
    };
    expect(out.direction).toBe('VERKAUF');
    expect(out.totalEur).toBe('100.00');
    /**
     * ⚠️ Die Steuerbehandlung steht NICHT in der Antwort, und das ist Absicht.
     *
     * `FinalizeResponse` kennt sie nicht, also entfernt Fastify sie beim
     * Verpacken still aus jeder Antwort. Die Bühne prüfte bisher
     * `out.taxTreatmentCode` und mass damit `undefined` gegen eine Erwartung.
     *
     * Verlangt wird die Behandlung ohnehin dort, wo sie zählt: in der
     * aufgezeichneten Zeile und im Hauptbuch. Genau das steht unten.
     */

    // Assert database values
    const [txRow] = await migratorSql<{ tax_treatment_code: string; total_eur: string }[]>`
      SELECT tax_treatment_code, total_eur::text FROM transactions WHERE id = ${out.id}`;
    expect(txRow!.tax_treatment_code).toBe('REVERSE_CHARGE_13B');
    expect(txRow!.total_eur).toBe('100.00');

    // Assert customer cumulative spend increased by 100.00
    const [custRow] = await migratorSql<{ cumulative_spend_eur: string }[]>`
      SELECT cumulative_spend_eur::text FROM customers WHERE id = ${customerId}`;
    expect(custRow!.cumulative_spend_eur).toBe('100.00');

    // Ledger has the correct event
    const [ledgRow] = await migratorSql<{ payload: any }[]>`
      SELECT payload FROM ledger_events WHERE id = ${out.ledgerEventId}`;
    expect(ledgRow!.payload.tax_treatment_code).toBe('REVERSE_CHARGE_13B');
    expect(ledgRow!.payload.total_eur).toBe('100.00');
  });
});
