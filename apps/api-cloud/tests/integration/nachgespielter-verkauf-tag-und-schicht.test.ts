/**
 * Der nachgespielte Verkauf gehoert in SEINEN Tag und SEINE Schicht (0118).
 *
 * ── DER BEFUND, den diese Datei festschreibt (26.07.2026) ─────────────────
 *
 * Die Werteliste des INSERT in `transactions-finalize.ts` enthielt kein
 * `finalized_at`. Die Spalte fiel auf `DEFAULT now()`
 * (`0009_transactions.sql:105`). Der Anfragerumpf trug ueberhaupt keinen
 * Zeitstempel. Die Vorgangszeit war damit die Zeit, zu der der SERVER den
 * Vorgang entgegennahm — nicht die, zu der kassiert wurde.
 *
 * Der Tagesabschluss aggregiert auf `berlin_business_day(t.finalized_at)`
 * (`closings-finalize.ts:246`). Ein Verkauf um 17:50 Uhr ohne Netz, der am
 * naechsten Morgen abfloss, erschien deshalb im Z-Bon des NAECHSTEN Tages.
 * Fuer ein Geraet, das die Nacht ueber in der Theke steht, ist das der
 * Normalfall, nicht der Sonderfall.
 *
 * Und der Waechter aus `0013_security_hardening.sql:141` schwieg dazu: er
 * verglich `dc.business_day = berlin_business_day(NEW.finalized_at)`, also
 * den Nachspieltag mit sich selbst.
 *
 * Dieselbe Route suchte die Schicht ZUM ZEITPUNKT DES NACHSPIELENS
 * („irgendeine offene Schicht dieses Geraets"). War die Schicht beim
 * Abfliessen geschlossen, hing der Verkauf an der NEUEN Schicht oder an gar
 * keiner.
 *
 * ── WAS HIER GEPRUEFT WIRD ────────────────────────────────────────────────
 *
 *   a) Erfassungszeit gestern 17:50, eingereicht heute → Z-Bon von GESTERN
 *   b) derselbe Fall bei ABGESCHLOSSENEM Tag → Nachtrag, sichtbar + gemeldet
 *   c) der Waechter wird ROT, wenn man in einen abgeschlossenen Tag schreibt
 *      (beide Arme: der Buchungstag UND der rueckdatierte Erfassungstag)
 *   d) eine FREMDE Schicht wird abgewiesen
 *   e) die Grenzen der Erfassungszeit: Zukunft und Uralt werden abgewiesen
 */

import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAllMigrations } from './_migrate.js';

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

describe('0118 — der nachgespielte Verkauf: Tag, Schicht und der Waechter', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let cashierUserId: string;
  let ownerUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let cashierSessionToken: string;
  let productId: string;
  let schichtId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
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
  }, 120_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  beforeEach(async () => {
    await migratorSql.unsafe(
      'TRUNCATE tse_signatures, transaction_payments, transaction_items, ' +
        'transactions, daily_closings, shifts, sessions, devices, customers, products CASCADE',
    );
    /**
     * ⚠️ DIE FISKALISCHEN VORAUSSETZUNGEN EINES ARBEITENDEN LADENS.
     *
     * Seit dem 02.08.2026 verweigert die Kasse ohne eingerichtete
     * Sicherungseinrichtung nach § 146a AO jeden Verkauf, und ohne
     * hinterlegten Umsatzsteuer-Status ebenso. Beides ist richtig: eine Kasse,
     * die nicht weiss, wie sie besteuert, darf nicht kassieren.
     *
     * Diese Buehne saete es nie, und deshalb antwortete hier JEDE der zehn
     * Pruefungen mit 409 statt mit dem, was sie eigentlich misst. Aufgefallen
     * ist es nicht, weil `pnpm test` die Integrationsmappe ausschliesst.
     *
     * Der Umsatzsteuer-Status braucht BEIDE Schluessel: ohne das Datum gilt er
     * als nicht hinterlegt, und jeder Verkauf endet in 403 VAT_CHECK_REQUIRED.
     *
     * Testwerte, kein echtes Geraet und kein echter Betrieb.
     */
    await migratorSql`
      INSERT INTO system_settings (key, value, description) VALUES
        ('tse.tss_id',           '"11111111-2222-3333-4444-555555555555"'::jsonb, 'Testwert'),
        ('tse.client_id',        '"66666666-7777-8888-9999-000000000000"'::jsonb, 'Testwert'),
        ('steuer.modus',         '"REGELBESTEUERUNG"'::jsonb,                     'Testwert'),
        ('steuer.modus_gilt_ab', '"2020-01-01"'::jsonb,                           'Testwert')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;

    await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Kassierer', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    const [owner] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`o-${randomUUID()}@x.test`}, 'Inhaber', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    ownerUserId = owner!.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days',
              ${cashierUserId})
      RETURNING id`;
    deviceId = dev!.id;

    cashierSessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierSessionToken}, now() + interval '8 hours',
              ${deviceId}, NULL)`;

    const [product] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '50.00', '150.00', 'Prüfring', now())
      RETURNING id`;
    productId = product!.id;

    // Die Schicht, auf der WIRKLICH kassiert wird — auf DIESEM Geraet.
    const [schicht] = await migratorSql<{ id: string }[]>`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status)
      VALUES (${deviceId}, ${cashierUserId}, '100.00', 'OPEN'::shift_status)
      RETURNING id`;
    schichtId = schicht!.id;
  });

  // ── Helfer ─────────────────────────────────────────────────────────────

  /** Der Kassentag von heute und von gestern, aus der Datenbank, nicht geraten. */
  async function tage(): Promise<{ heute: string; gestern: string }> {
    const [row] = await migratorSql<{ heute: string; gestern: string }[]>`
      SELECT berlin_business_day(now())::text AS heute,
             (berlin_business_day(now()) - 1)::text AS gestern`;
    return row!;
  }

  /** 17:50 Berliner Zeit an einem bestimmten Kassentag, als ISO-Zeitpunkt. */
  async function berlinerUhrzeit(tag: string, uhrzeit: string): Promise<string> {
    const [row] = await migratorSql<{ ts: string }[]>`
      SELECT to_char((${tag} || ' ' || ${uhrzeit})::timestamp AT TIME ZONE 'Europe/Berlin'
             AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ts`;
    return row!.ts;
  }

  /** Schliesst einen Kassentag ab — echt FINALIZED, mit allen Nachweisen. */
  async function tagAbschliessen(tag: string): Promise<void> {
    // Ein Abschluss braucht einen Hauptbuch-Anker (NOT NULL). Ist die Kette in
    // diesem Lauf noch leer, setzen wir einen — der Ketten-Ausloeser aus 0008
    // rechnet `row_hash` selbst.
    await migratorSql`
      INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
      SELECT 'test.anker', 'shifts', ${schichtId}::uuid, '{}'::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM ledger_events)`;
    const [kopf] = await migratorSql<{ id: string; row_hash: Buffer }[]>`
      SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;
    // Seit Wanderung 0124 traegt ein festgeschriebener Abschluss eine Z-Nummer
    // (eine luecklose FOLGE, kein Datum), und seit 0125 muss er sagen, WOHER
    // der Kassenbestand kommt. Beides ist Nachweis, nicht Formsache, deshalb
    // saet die Buehne es und schwaecht die Riegel nicht ab. Hier wird wirklich
    // gezaehlt, also 'EIGENER_STURZ' mit beiden Zahlen.
    await migratorSql`
      INSERT INTO daily_closings (
        business_day, state, z_nr,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        kassensturz_quelle,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at
      ) VALUES (
        ${tag}::date, 'FINALIZED'::closing_state,
        (SELECT coalesce(max(z_nr), 0) + 1 FROM daily_closings),
        '0.00', '0.00', '0.00',
        'EIGENER_STURZ'::kassensturz_quelle,
        ${kopf!.id}, ${kopf!.row_hash},
        ${ownerUserId}, now(), ${ownerUserId}, now()
      )`;
  }

  async function reservieren(): Promise<string> {
    const sessionId = randomUUID();
    await migratorSql`
      UPDATE products
         SET status = 'RESERVED'::product_status,
             reserved_at = now(),
             reserved_by_session_id = ${sessionId},
             reserved_by_channel = 'POS'::reservation_channel,
             reserved_by_user_id = ${cashierUserId}
       WHERE id = ${productId}`;
    return sessionId;
  }

  function rumpf(opts: {
    reservationSessionId: string;
    erfasstAm?: string;
    shiftId?: string;
  }): Record<string, unknown> {
    // Differenzbesteuerung: 150,00 gesamt, 50,00 Einkauf → Marge 100,00,
    // Steuer 100 * 19/119 = 15,97, Netto 134,03.
    return {
      direction: 'VERKAUF',
      customerId: null,
      subtotalEur: '134.03',
      vatEur: '15.97',
      totalEur: '150.00',
      taxTreatmentCode: 'MARGIN_25A',
      items: [
        {
          productId,
          reservationSessionId: opts.reservationSessionId,
          lineSubtotalEur: '134.03',
          lineVatEur: '15.97',
          lineTotalEur: '150.00',
          appliedTaxTreatmentCode: 'MARGIN_25A',
          appliedVatRate: null,
          acquisitionCostEurSnapshot: '50.00',
          marginEur: '100.00',
        },
      ],
      payments: [{ paymentMethod: 'CASH', amountEur: '150.00' }],
      idempotencyKey: randomUUID(),
      ...(opts.erfasstAm ? { erfasstAm: opts.erfasstAm } : {}),
      ...(opts.shiftId ? { shiftId: opts.shiftId } : {}),
    };
  }

  async function einreichen(body: Record<string, unknown>) {
    return await app.inject({
      method: 'POST',
      url: '/api/transactions/finalize',
      headers: {
        'content-type': 'application/json',
        cookie: `warehouse14.session=${cashierSessionToken}`,
        'x-dev-device-fingerprint': deviceFingerprint,
      },
      payload: body,
    });
  }

  // ── a) Der Verkauf landet im Z-Bon von GESTERN ─────────────────────────

  it('a) Erfassungszeit gestern 17:50, eingereicht heute: der Verkauf zaehlt zu GESTERN', async () => {
    const { heute, gestern } = await tage();
    const erfasstAm = await berlinerUhrzeit(gestern, '17:50:00');
    const sessionId = await reservieren();

    const res = await einreichen(rumpf({ reservationSessionId: sessionId, erfasstAm }));
    expect(res.statusCode).toBe(200);

    const [zeile] = await migratorSql<
      {
        buchungstag: string;
        erfassungstag: string;
        erfasst_am: Date;
        eingegangen_am: Date;
        nachtrag_bezugstag: string | null;
      }[]
    >`
      SELECT berlin_business_day(finalized_at)::text AS buchungstag,
             berlin_business_day(erfasst_am)::text   AS erfassungstag,
             erfasst_am, eingegangen_am,
             nachtrag_bezugstag::text AS nachtrag_bezugstag
        FROM transactions ORDER BY created_at DESC LIMIT 1`;

    // DAS ist der Kern: der Buchungstag ist GESTERN, nicht heute.
    expect(zeile!.buchungstag).toBe(gestern);
    expect(zeile!.buchungstag).not.toBe(heute);
    expect(zeile!.erfassungstag).toBe(gestern);
    expect(zeile!.erfasst_am.toISOString()).toBe(new Date(erfasstAm).toISOString());
    // Kein Nachtrag: der Tag war offen.
    expect(zeile!.nachtrag_bezugstag).toBeNull();
    // Die Eingangszeit des Servers steht GETRENNT daneben und ist HEUTE —
    // ohne sie waere die Verschiebung nach dem Schreiben nicht mehr
    // feststellbar (§ 146 Abs. 4 AO).
    const [eingang] = await migratorSql<{ tag: string }[]>`
      SELECT berlin_business_day(eingegangen_am)::text AS tag
        FROM transactions ORDER BY created_at DESC LIMIT 1`;
    expect(eingang!.tag).toBe(heute);

    // Und die Schicht ist die mitgesandte, nicht „irgendeine offene".
    const [gebucht] = await migratorSql<{ shift_id: string | null }[]>`
      SELECT shift_id::text AS shift_id FROM transactions ORDER BY created_at DESC LIMIT 1`;
    // Ohne `shiftId` im Rumpf greift der Rueckfallweg: die offene Schicht des
    // Geraets. Das ist der ALTE Weg und genau der, der beim Nachspielen die
    // falsche Schicht trifft — Test a2 und d zeigen, warum der Rumpf sie
    // mitsenden muss.
    expect(gebucht!.shift_id).toBe(schichtId);
  });

  it('a2) die Schicht des KASSIERENS gewinnt, auch wenn sie beim Eingang schon geschlossen ist', async () => {
    const { gestern } = await tage();
    const erfasstAm = await berlinerUhrzeit(gestern, '17:50:00');
    const sessionId = await reservieren();

    // Genau der gemeldete Ablauf: gestern Abend auf `schichtId` kassiert, das
    // Geraet lag ueber Nacht ohne Netz. Am Morgen ist jene Schicht GESCHLOSSEN
    // und eine NEUE offen — der alte Weg haette an der neuen gebucht.
    await migratorSql`
      UPDATE shifts
         SET status = 'CLOSED'::shift_status, closed_by_user_id = ${cashierUserId},
             closed_at = now(), blind_count_eur = '100.00', system_expected_eur = '100.00'
       WHERE id = ${schichtId}`;
    const [neueSchicht] = await migratorSql<{ id: string }[]>`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status)
      VALUES (${deviceId}, ${cashierUserId}, '100.00', 'OPEN'::shift_status)
      RETURNING id`;

    const res = await einreichen(
      rumpf({ reservationSessionId: sessionId, erfasstAm, shiftId: schichtId }),
    );
    expect(res.statusCode).toBe(200);

    const [zeile] = await migratorSql<{ shift_id: string }[]>`
      SELECT shift_id::text AS shift_id FROM transactions ORDER BY created_at DESC LIMIT 1`;
    expect(zeile!.shift_id).toBe(schichtId);
    expect(zeile!.shift_id).not.toBe(neueSchicht!.id);
  });

  // ── b) Der Tag ist schon abgeschlossen: Nachtrag, sichtbar und gemeldet ─

  it('b) bei ABGESCHLOSSENEM Tag wird der Vorgang als Nachtrag gefuehrt — sichtbar, nicht still', async () => {
    const { heute, gestern } = await tage();
    await tagAbschliessen(gestern);

    const erfasstAm = await berlinerUhrzeit(gestern, '17:50:00');
    const sessionId = await reservieren();

    const res = await einreichen(rumpf({ reservationSessionId: sessionId, erfasstAm }));
    expect(res.statusCode).toBe(200);

    // 1. Die Antwort an die Kasse SAGT es.
    const antwort = res.json() as { nachtragBezugstag: string | null; erfasstAm: string | null };
    expect(antwort.nachtragBezugstag).toBe(gestern);
    expect(antwort.erfasstAm).not.toBeNull();

    // 2. Der abgeschlossene Tag bleibt UNBERUEHRT; gebucht wird auf dem
    //    laufenden Tag (§ 146 Abs. 4 AO trifft § 146 Abs. 1 Satz 2 AO).
    const [zeile] = await migratorSql<
      { buchungstag: string; nachtrag_bezugstag: string | null }[]
    >`
      SELECT berlin_business_day(finalized_at)::text AS buchungstag,
             nachtrag_bezugstag::text AS nachtrag_bezugstag
        FROM transactions ORDER BY created_at DESC LIMIT 1`;
    expect(zeile!.buchungstag).toBe(heute);
    expect(zeile!.nachtrag_bezugstag).toBe(gestern);

    // 3. Der Tag von GESTERN hat dadurch keinen Vorgang bekommen.
    const [zaehler] = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM transactions
       WHERE berlin_business_day(finalized_at) = ${gestern}::date`;
    expect(zaehler!.n).toBe('0');

    // 4. Der Inhaber wird GEMELDET — nicht still.
    const meldungen = await migratorSql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM ledger_events
       WHERE event_type = 'alert.nachtrag_eingang' ORDER BY id DESC`;
    expect(meldungen.length).toBe(1);
    expect(meldungen[0]!.payload.nachtragBezugstag).toBe(gestern);

    // 5. Und der Vorgang selbst traegt es in seiner Hauptbuch-Nutzlast.
    const [vorgang] = await migratorSql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM ledger_events
       WHERE event_type = 'transaction.finalized' ORDER BY id DESC LIMIT 1`;
    expect(vorgang!.payload.nachtrag_bezugstag).toBe(gestern);
    expect(vorgang!.payload.erfasst_am).not.toBeNull();
  });

  // ── c) Der Waechter wird ROT ───────────────────────────────────────────

  it('c1) der Waechter blockt einen Vorgang, dessen BUCHUNGSTAG abgeschlossen ist', async () => {
    const { gestern } = await tage();
    await tagAbschliessen(gestern);
    const gesternMittag = await berlinerUhrzeit(gestern, '12:00:00');

    await expect(
      appSql`
        INSERT INTO transactions
          (direction, device_id, cashier_user_id, subtotal_eur, vat_eur, total_eur,
           tax_treatment_code, finalized_at)
        VALUES ('VERKAUF'::transaction_direction, ${deviceId}, ${cashierUserId},
                '134.03', '15.97', '150.00', 'MARGIN_25A', ${gesternMittag}::timestamptz)`,
    ).rejects.toThrow(/business day .* is FINALIZED/);
  });

  it('c2) der Waechter blockt eine RUECKDATIERTE Erfassungszeit ohne ausgewiesenen Nachtrag', async () => {
    const { gestern } = await tage();
    await tagAbschliessen(gestern);
    const gesternAbend = await berlinerUhrzeit(gestern, '17:50:00');

    // Gebucht auf HEUTE (erlaubt), aber mit einer Erfassungszeit auf dem
    // abgeschlossenen Tag und OHNE `nachtrag_bezugstag`. Ohne diesen Arm waere
    // die Rueckdatierung der bequeme Weg an der Sichtbarkeit vorbei.
    await expect(
      appSql`
        INSERT INTO transactions
          (direction, device_id, cashier_user_id, subtotal_eur, vat_eur, total_eur,
           tax_treatment_code, erfasst_am)
        VALUES ('VERKAUF'::transaction_direction, ${deviceId}, ${cashierUserId},
                '134.03', '15.97', '150.00', 'MARGIN_25A', ${gesternAbend}::timestamptz)`,
    ).rejects.toThrow(/Nachtrag/);

    // Der POSITIVE Weg — ein ausgewiesener Nachtrag geht durch — steht in
    // Test b), und zwar ueber die echte Route mit Positionen und Zahlungen.
    // Hier ginge er NICHT zu pruefen: `trg_verify_transaction_balance_tx`
    // (0016:253) ist DEFERRABLE INITIALLY DEFERRED und verlangt Positionen und
    // Zahlungen; eine blosse Kopfzeile faellt beim COMMIT zurueck.
  });

  // ── d) Eine fremde Schicht wird abgewiesen ─────────────────────────────

  it('d) eine Schicht eines ANDEREN Geraets wird abgewiesen', async () => {
    // Ein zweites Geraet mit eigener offener Schicht.
    const [fremdesGeraet] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${randomUUID().replace(/-/g, '')},
              now() - interval '1 day', now() + interval '365 days', ${cashierUserId})
      RETURNING id`;
    const [fremdeSchicht] = await migratorSql<{ id: string }[]>`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status)
      VALUES (${fremdesGeraet!.id}, ${cashierUserId}, '100.00', 'OPEN'::shift_status)
      RETURNING id`;

    const sessionId = await reservieren();
    const res = await einreichen(
      rumpf({ reservationSessionId: sessionId, shiftId: fremdeSchicht!.id }),
    );

    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(
      /gehört nicht zu diesem Gerät/,
    );

    // Und es wurde NICHTS geschrieben.
    const [n] = await migratorSql<{ n: string }[]>`SELECT count(*)::text AS n FROM transactions`;
    expect(n!.n).toBe('0');
  });

  it('d2) eine Schicht, die es gar nicht gibt, wird ebenso abgewiesen', async () => {
    const sessionId = await reservieren();
    const res = await einreichen(
      rumpf({ reservationSessionId: sessionId, shiftId: randomUUID() }),
    );
    expect(res.statusCode).toBe(403);
  });

  // ── e) Die Grenzen der Erfassungszeit ──────────────────────────────────

  it('e1) eine Erfassungszeit in der Zukunft wird abgewiesen', async () => {
    const sessionId = await reservieren();
    const zukunft = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await einreichen(rumpf({ reservationSessionId: sessionId, erfasstAm: zukunft }));
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(/Zukunft/);
  });

  it('e2) eine Erfassungszeit aelter als sieben Tage wird abgewiesen', async () => {
    const sessionId = await reservieren();
    const uralt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await einreichen(rumpf({ reservationSessionId: sessionId, erfasstAm: uralt }));
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { message: string } }).error.message).toMatch(/sieben Tage/);
  });

  it('e3) eine Uhr, die zwei Sekunden vorgeht, wird NICHT abgewiesen', async () => {
    const sessionId = await reservieren();
    const knapp = new Date(Date.now() + 2000).toISOString();
    const res = await einreichen(rumpf({ reservationSessionId: sessionId, erfasstAm: knapp }));
    expect(res.statusCode).toBe(200);
  });
});
