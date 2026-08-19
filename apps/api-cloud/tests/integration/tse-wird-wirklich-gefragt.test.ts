/**
 * POST /api/tse/einrichten. Beweist, dass die TSE-Pruefung wirklich greift.
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * Die Route nahm eine getippte TSE-Kennung entgegen, speicherte sie und
 * meldete „fiskalisch scharf", OHNE fiskaly je zu fragen. Am selben Tag lag
 * bei fiskaly eine TSE im Zustand CREATED, deren Inbetriebnahme reproduzierbar
 * scheiterte. Diese TSE kann NICHTS signieren. Waere genau diese Kennung
 * eingetippt worden, haette die Kasse sich scharf genannt, und jeder Beleg
 * waere ohne Signatur gelaufen, aufgefallen erst bei der Kassennachschau.
 *
 * Heute (siehe `src/lib/fiskaly-tse-pruefung.ts` und `src/routes/tse-einrichtung.ts`)
 * fragt die Route ERST fiskaly und speichert NUR bei einer eindeutig positiven
 * Antwort. Dieser Test beweist, dass der Riegel wirklich steht: keine Attrappe,
 * die immer „ja" sagt, sondern eine, die je Fall anders antwortet, und eine
 * Kontrolle der Einstellungen NACH jedem Versuch.
 *
 * Der eigentliche Beweis im Kernfall ist NICHT der Antwortcode, sondern dass
 * `system_settings` nach einer Absage KEINE Zeile fuer die TSE-Kennung enthaelt.
 * Ein Riegel, der nur einen anderen Code zurueckgibt, aber trotzdem speichert,
 * waere kein Riegel.
 *
 * VORLAGE: `tests/integration/metal-prices-margin.test.ts`. Testcontainer,
 * Wanderungen und Sitzungserzeugung sind eins zu eins uebernommen, ebenso die
 * dort am selben Tag berichtigte Aufraeumreihenfolge (Tagebuch und Zeiger vor
 * den Menschen, sonst schlaegt der Fremdschluessel zu).
 *
 * NAHT: `buildApp({ tsePruefer })`, siehe `src/app.ts`. Ohne diese Naht
 * koennte kein Test beweisen, dass die Route eine TSE im Zustand CREATED
 * wirklich abweist, man muesste fiskaly anrufen. Die Attrappe steht hier in
 * einer veraenderbaren Variablen, weil jeder Fall etwas anderes antworten muss.
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
import type { TsePruefung, TseZugang } from '../../src/lib/fiskaly-tse-pruefung.js';
import { testUmgebung } from '../helfer/test-umgebung.js';
import {
  SCHLUESSEL_CLIENT_ID,
  SCHLUESSEL_EINGERICHTET_AM,
  SCHLUESSEL_TSS_ID,
} from '../../src/routes/tse-einrichtung.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

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

describe('POST /api/tse/einrichten', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let deviceFingerprint: string;
  let cashierToken: string;
  let ownerNoStepUpToken: string;
  let ownerStepUpToken: string;

  // Die Attrappe der fiskaly-Pruefung. Steht in einer veraenderbaren Variablen,
  // weil jeder Testfall etwas anderes antworten muss; `buildApp` liest sie
  // ueber eine Schliessung, nicht ueber ein neu gebautes `app` je Fall.
  let antwort: TsePruefung = {
    art: 'bereit',
    tssZustand: 'INITIALIZED',
    clientZustand: 'REGISTERED',
    seriennummer: 'S-1',
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
      // Die Naht: eine feste Funktion, die bei jedem Aufruf die AKTUELLE
      // `antwort` liest. So kann jeder Testfall die Attrappe umstellen, ohne
      // die App neu zu bauen.
      tsePruefer: async (_tssId: string, _clientId: string, _zugang: TseZugang) => antwort,
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
    // ⚠️ ERST das Tagebuch, DANN die Menschen. Seit die Marge ohne Geraetecode
    // durchgeht (05.08.2026), hinterlaesst der Test davor eine audit_log-Zeile
    // mit actor_user_id, und `DELETE FROM users` liefe in
    // audit_log_actor_user_id_fkey. Der Fremdschluessel ist richtig so; die
    // Aufraeumung war es nicht.
    await migratorSql`DELETE FROM audit_log`;
    // Und die Einstellung merkt sich, WER sie zuletzt geaendert hat
    // (system_settings_updated_by_user_id_fkey). Auch dieser Zeiger muss
    // fallen, bevor der Mensch faellt.
    await migratorSql`UPDATE system_settings SET updated_by_user_id = NULL
                       WHERE updated_by_user_id IS NOT NULL`;
    // Die TSE-Kennung selbst hat keine Wanderungs-Vorbelegung (anders als die
    // Marge in der Vorlage), also muss jeder Testfall mit einer LEEREN
    // Einstellung starten, sonst beweist Fall 2 nichts.
    await migratorSql`DELETE FROM system_settings
                       WHERE key IN (${SCHLUESSEL_TSS_ID}, ${SCHLUESSEL_CLIENT_ID}, ${SCHLUESSEL_EINGERICHTET_AM})`;
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE`;

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

    // Jeder Fall stellt seine eigene Antwort ein; das hier ist nur ein
    // unschaedlicher Ausgangswert.
    antwort = {
      art: 'bereit',
      tssZustand: 'INITIALIZED',
      clientZustand: 'REGISTERED',
      seriennummer: 'S-1',
    };
  });

  function postEinrichten(body: { tssId: string; clientId: string }, token?: string) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.cookie = `warehouse14.session=${token}`;
    headers['x-dev-device-fingerprint'] = deviceFingerprint;
    return app.inject({
      method: 'POST',
      url: '/api/tse/einrichten',
      headers,
      payload: body,
    });
  }

  async function tssIdZeile(): Promise<string | null> {
    const zeilen = await migratorSql<{ wert: string | null }[]>`
      SELECT value #>> '{}' AS wert FROM system_settings WHERE key = ${SCHLUESSEL_TSS_ID}`;
    return zeilen[0]?.wert ?? null;
  }

  it('eine scharfe TSE wird angenommen: 200, geprueft ist wahr, die Seriennummer kommt mit, und die Kennung steht in den Einstellungen', async () => {
    antwort = {
      art: 'bereit',
      tssZustand: 'INITIALIZED',
      clientZustand: 'REGISTERED',
      seriennummer: 'S-1',
    };
    const res = await postEinrichten({ tssId: 'TSS-00000001', clientId: 'CLIENT-1' }, ownerStepUpToken);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.geprueft).toBe(true);
    expect(body.seriennummer).toBe('S-1');

    expect(await tssIdZeile()).toBe('TSS-00000001');
  });

  it('DER KERNFALL: eine TSE im Zustand CREATED wird abgewiesen, und die Kennung wird NICHT gespeichert', async () => {
    // Genau der Fall vom 05.08.2026: die TSE existiert, ist aber noch nicht
    // in Betrieb genommen. Die Kasse darf sich davon nicht scharf nennen.
    //
    // ⚠️ Zum Antwortcode 422: beim Schreiben dieses Tests lieferte die Route
    // noch 400. Ursache war, dass `src/plugins/error-handler.ts` das Feld
    // `httpStatus` der Fehlerklassen NIRGENDS las — 187 Klassen erklaerten
    // eine Zahl, und der Behandler nahm allein `codeToHttp[err.code]`. Bei
    // 182 stimmte es zufaellig ueberein, bei fuenf log das Feld. Seit dem
    // 05.08.2026 regiert `httpStatus`, und diese Route liefert die 422, die
    // sie immer behauptet hat.
    //
    // Der eigentliche Beweis bleibt aber der unten: es wurde NICHTS
    // gespeichert. Die Ziffer allein wuerde nichts belegen.
    antwort = { art: 'tss_nicht_scharf', zustand: 'CREATED' };
    const res = await postEinrichten({ tssId: 'TSS-00000002', clientId: 'CLIENT-1' }, ownerStepUpToken);
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.message).toContain('CREATED');

    // Der eigentliche Beweis: keine Zeile, nicht nur ein anderer Code.
    expect(await tssIdZeile()).toBeNull();
  });

  it('fiskaly ist nicht erreichbar: auch das wird abgewiesen, nichts wird gespeichert', async () => {
    // Eine Stoerung darf nie wie ein Erfolg aussehen.
    antwort = { art: 'nicht_erreichbar', grund: 'HTTP 502' };
    const res = await postEinrichten({ tssId: 'TSS-00000003', clientId: 'CLIENT-1' }, ownerStepUpToken);
    expect(res.statusCode).toBe(422);

    expect(await tssIdZeile()).toBeNull();
  });

  it('eine unbekannte TSE-Kennung wird abgewiesen, nichts wird gespeichert', async () => {
    antwort = { art: 'tss_unbekannt' };
    const res = await postEinrichten({ tssId: 'TSS-unbekannt', clientId: 'CLIENT-1' }, ownerStepUpToken);
    expect(res.statusCode).toBe(422);

    expect(await tssIdZeile()).toBeNull();
  });

  it('ohne hinterlegte fiskaly-Zugangsdaten wird die Kennung dennoch gespeichert, aber als ungeprueft gemeldet (Hardware-TSE)', async () => {
    // Der Weg fuer eine Hardware-TSE ohne fiskaly-Cloud-Zugang: die Kasse kann
    // die Kennung nicht pruefen, darf sie aber trotzdem entgegennehmen, nur
    // eben ehrlich als ungeprueft.
    antwort = { art: 'kein_zugang' };
    const res = await postEinrichten({ tssId: 'TSS-00000005', clientId: 'CLIENT-1' }, ownerStepUpToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().geprueft).toBe(false);

    expect(await tssIdZeile()).toBe('TSS-00000005');
  });

  it('ohne frische Bestaetigung bleibt der Riegel stehen (403)', async () => {
    // Das Eintragen einer TSE hebt einen fiskalischen Riegel auf und gehoert
    // zu den sechzehn unwiderruflichen Handlungen, die eine zweite
    // Bestaetigung verlangen.
    const res = await postEinrichten(
      { tssId: 'TSS-00000006', clientId: 'CLIENT-1' },
      ownerNoStepUpToken,
    );
    expect(res.statusCode).toBe(403);

    expect(await tssIdZeile()).toBeNull();
  });

  it('ein Kassierer darf die TSE nicht einrichten (403)', async () => {
    const res = await postEinrichten({ tssId: 'TSS-00000007', clientId: 'CLIENT-1' }, cashierToken);
    expect(res.statusCode).toBe(403);

    expect(await tssIdZeile()).toBeNull();
  });
});
