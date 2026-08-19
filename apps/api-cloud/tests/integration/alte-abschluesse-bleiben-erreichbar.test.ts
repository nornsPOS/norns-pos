/**
 * GET /api/closings — alte Abschlüsse bleiben erreichbar (Wanderung 05.08.2026).
 *
 * DER BEFUND: `GET /api/closings` lieferte bis zum 06.08.2026 fest die 90
 * NEUESTEN Abschlüsse, ohne Zeitraum und ohne Blätterung. Es ist die EINZIGE
 * Stelle im Haus, die eine Abschluss-`id` herausgibt, und alle drei
 * Steuer-Exporte (DATEV, DSFinV-K, Kassenbericht) brauchen genau die. Ein
 * Laden mit täglichem Geschäft hatte damit nach rund 90 Kassentagen den 91.
 * und jeden älteren Tag über die ganze HTTP-Fläche verloren.
 *
 * Lage: der Prüfer steht im August im Laden und verlangt nach § 146b AO das
 * DSFinV-K-Paket für den März. Der Tag war nicht auffindbar, und die Kasse
 * meldete ihn als nicht vorhanden.
 *
 * Heute nimmt die Route `?from=&to=&limit=&offset=` entgegen und liefert
 * zusätzlich `gesamt` und `weitere` (siehe `closing-export.ts`).
 *
 * NOTE: benötigt einen Postgres-Testcontainer (Docker) + Extension-Rechte,
 * wie jede Integrationsprobe hier. Aufbau nach dem Vorbild von
 * `metal-prices-margin.test.ts`.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import { testUmgebung } from '../helfer/test-umgebung.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

/** Gesamtzahl der angelegten Abschlüsse — bewusst > 90, damit die alte feste
 * Grenze sichtbar würde, wäre sie noch da. */
const GESAMT_ABSCHLUESSE = 95;
/** Erster (ältester) Geschäftstag der Reihe. Weit vor „heute", damit er klar
 * ausserhalb der 90 neuesten liegt. */
const AELTESTER_TAG = '2025-01-01';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

function firstRow<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error('INSERT … RETURNING produzierte keine Zeile');
  return r;
}

/** `businessDay + tage` als `YYYY-MM-DD`, kalendarisch, ohne Zeitzonenfalle. */
function tagPlus(businessDay: string, tage: number): string {
  const d = new Date(`${businessDay}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
}

describe('GET /api/closings — der Zeitraumfilter hält alte Abschlüsse erreichbar', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let deviceFingerprint: string;
  let adminToken: string;
  let cashierToken: string;

  /** Alle 95 Geschäftstage, aufsteigend (index 0 = ältester Tag). */
  let geschaeftstage: string[];

  /**
   * Ein Geschaeftstag aus der Liste, mit Nachweis statt Ausrufezeichen.
   *
   * Unter `noUncheckedIndexedAccess` ist `geschaeftstage[i]` `string | undefined`.
   * Ein `!` waere die schnellere Zeile und die schlechtere: fehlt der Tag
   * wirklich, faellt der Test irgendwo weiter unten mit einer Meldung um, die
   * nichts mit der Ursache zu tun hat.
   */
  const tagAn = (i: number): string => {
    const tag = geschaeftstage[i];
    if (tag === undefined) {
      throw new Error(
        `Geschaeftstag ${i} fehlt in der Vorbereitung (es sind ${geschaeftstage.length}). ` +
          'Das ist ein Fehler DIESER Pruefung, keine Aussage ueber den Pruefling.',
      );
    }
    return tag;
  };

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

    // ── Die Akteure: ein Inhaber (ADMIN) und ein Kassierer (weder ADMIN
    // noch READONLY), plus ein gepaartes Gerät für beide Sitzungen. ──
    const admin = firstRow(
      await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role, is_owner)
        VALUES (${`admin-${randomUUID()}@x.test`}, 'Inhaberin', 'ADMIN'::user_role, TRUE)
        RETURNING id`,
    );
    const cashier = firstRow(
      await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`kassierer-${randomUUID()}@x.test`}, 'Kassierer', 'CASHIER'::user_role)
        RETURNING id`,
    );

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const device = firstRow(
      await migratorSql<{ id: string }[]>`
        INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
        VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
                now() - interval '1 day', now() + interval '365 days', ${admin.id})
        RETURNING id`,
    );

    adminToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${admin.id}, ${adminToken}, now() + interval '8 hours', ${device.id}, NULL)`;

    cashierToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashier.id}, ${cashierToken}, now() + interval '8 hours', ${device.id}, NULL)`;

    // ── Der Anker: EIN Eintrag im fälschungssicheren Journal genügt. Es
    // gibt keine Eindeutigkeitsregel auf `ledger_anchor_id`, jeder
    // Abschluss darf denselben Kopf tragen. Die Kette selbst (Vorwert →
    // Hashwert) errechnet der BEFORE-INSERT-Trigger `ledger_compute_hash`
    // — hier wird bewusst NICHTS davon nachgebaut. ──
    const anker = firstRow(
      await migratorSql<{ id: string; row_hash: Buffer }[]>`
        INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
        VALUES ('TEST_ANCHOR', 'daily_closings', ${randomUUID()}, '{}'::jsonb)
        RETURNING id, row_hash`,
    );

    // ── Die Bühne: 95 festgeschriebene Abschlüsse, aufeinanderfolgende
    // Geschäftstage, direkt per SQL — es geht hier NICHT um den
    // Abschlussweg selbst, sondern um die Liste, die ihn wiederfindet. ──
    geschaeftstage = Array.from({ length: GESAMT_ABSCHLUESSE }, (_unused, i) =>
      tagPlus(AELTESTER_TAG, i),
    );

    for (let i = 0; i < geschaeftstage.length; i++) {
      await migratorSql`
        INSERT INTO daily_closings (
          business_day, state,
          cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
          ledger_anchor_id, ledger_anchor_hash,
          counted_by_user_id, counted_at, finalized_by_user_id, finalized_at,
          z_nr, kassensturz_quelle
        ) VALUES (
          ${tagAn(i)}::date, 'FINALIZED'::closing_state,
          '0.00', '0.00', '0.00',
          ${anker.id}, ${anker.row_hash},
          ${admin.id}, now(), ${admin.id}, now(),
          ${i + 1}, 'EIGENER_STURZ'::kassensturz_quelle
        )`;
    }
  }, 90_000);

  afterAll(async () => {
    await app?.close().catch(() => {});
    await appSql?.end({ timeout: 5 }).catch(() => {});
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  function listClosings(query: string, token?: string) {
    const headers: Record<string, string> = {};
    if (token) {
      headers.cookie = `warehouse14.session=${token}`;
      headers['x-dev-device-fingerprint'] = deviceFingerprint;
    }
    return app.inject({
      method: 'GET',
      url: `/api/closings${query}`,
      headers,
    });
  }

  it('ohne Zeitraum kommen die 90 neuesten, gesamt bleibt 95 — und der älteste Tag fehlt', async () => {
    const res = await listClosings('', adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.items).toHaveLength(90);
    expect(body.gesamt).toBe(95);
    expect(body.weitere).toBe(true);

    // Der BEFUND, festgehalten: der älteste Tag ist NICHT unter den 90
    // neuesten. Genau diese Lücke traf am 05.08.2026 den Prüfer.
    const aeltesterTag = tagAn(0);
    const tageInAntwort = body.items.map((it: { businessDay: string }) => it.businessDay);
    expect(tageInAntwort).not.toContain(aeltesterTag);
  });

  it('⚠️ DER KERNFALL: mit from/to auf den ältesten Tag kommt genau dieser eine Abschluss, mit seiner id', async () => {
    const aeltesterTag = tagAn(0);
    const res = await listClosings(`?from=${aeltesterTag}&to=${aeltesterTag}`, adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Ohne die Änderung vom 06.08.2026 wäre das unmöglich gewesen: die
    // feste 90er-Grenze kannte gar keinen Zeitraum.
    expect(body.gesamt).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].businessDay).toBe(aeltesterTag);
    expect(typeof body.items[0].id).toBe('string');
    expect(body.items[0].id.length).toBeGreaterThan(0);
  });

  it('ein Zeitraum ohne Treffer (ein Jahr davor) sagt ehrlich: gibt es nicht', async () => {
    const vonVorJahr = tagPlus(tagAn(0), -365);
    const bisVorJahr = tagPlus(tagAn(0), -300);
    const res = await listClosings(`?from=${vonVorJahr}&to=${bisVorJahr}`, adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Das ist der EINZIGE Fall, in dem die Fläche ehrlich „gibt es nicht"
    // sagen darf — weil hier wirklich nichts liegt, nicht weil eine feste
    // Grenze es abgeschnitten hat.
    expect(body.items).toEqual([]);
    expect(body.gesamt).toBe(0);
    expect(body.weitere).toBe(false);
  });

  it('Blätterung: limit=10&offset=90 liefert die letzten 5, gesamt bleibt 95, weitere ist falsch', async () => {
    const res = await listClosings('?limit=10&offset=90', adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.items).toHaveLength(5);
    expect(body.gesamt).toBe(95);
    expect(body.weitere).toBe(false);

    // Die letzten 5 sind die 5 ältesten Tage der Reihe (DESC sortiert).
    const erwarteteTage = [
      geschaeftstage[4],
      geschaeftstage[3],
      geschaeftstage[2],
      geschaeftstage[1],
      geschaeftstage[0],
    ];
    expect(body.items.map((it: { businessDay: string }) => it.businessDay)).toEqual(
      erwarteteTage,
    );
  });

  it('from und to schliessen ihre Ränder ein: drei aufeinanderfolgende Tage liefern genau drei', async () => {
    const von = geschaeftstage[10];
    const bis = geschaeftstage[12];
    const res = await listClosings(`?from=${von}&to=${bis}`, adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.items).toHaveLength(3);
    expect(body.gesamt).toBe(3);
    expect(body.items.map((it: { businessDay: string }) => it.businessDay).sort()).toEqual(
      [geschaeftstage[10], geschaeftstage[11], geschaeftstage[12]].sort(),
    );
  });

  it('ein Kassierer (weder ADMIN noch READONLY) bekommt 403', async () => {
    const res = await listClosings('', cashierToken);
    expect(res.statusCode).toBe(403);
  });
});
