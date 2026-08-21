/**
 * ⛔ Der Rettungsstick — am echten Motor, an echtem Postgres
 *
 * Der Notfallschlüssel als DING. Diese Probe fährt den ganzen Weg über einen
 * echten Ordner, den `NORNS_RETTUNG_WURZELN` als „Laufwerk" ausgibt:
 * beschreiben → einlösen → Nachladen → derselbe Stick zum zweiten Mal.
 * Und die Riegel: der Klartext liegt NIE in der Datenbank, ein fremder Stick
 * ist ein Fehlversuch, zehn davon sperren den Stick-Weg (nicht den Verkauf).
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { hashPin } from '@norns/auth-pin';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { FastifyInstance } from 'fastify';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAllMigrations } from './_migrate.js';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';
const ALT_CODE = '481902';
const NEU_CODE = '735164';
const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

describe('⛔ Der Rettungsstick', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;
  let inhaberId: string;
  let fingerabdruck: string;
  let geraetId: string;
  let sitzung: string;
  let stickOrdner: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCopyContentToContainer([{ content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' }])
      .start();

    migratorSql = postgres({
      host: container.getHost(), port: container.getPort(), database: 'warehouse14_test',
      username: 'warehouse14_migrator', password: 'warehouse14_migrator_test_pw', max: 1, onnotice: () => {},
    });
    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: container.getHost(), port: container.getPort(), database: 'warehouse14_test',
      username: 'warehouse14_app', password: 'warehouse14_app_test_pw', max: 5, onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });

    // ⚠️ Vor buildApp: die Wege existieren nur mit dieser Flagge, und das
    // „Laufwerk" ist ein echter Ordner, den der Test kontrolliert.
    stickOrdner = mkdtempSync(join(tmpdir(), 'norns-stick-'));
    process.env.NORNS_LOKALE_KASSE = '1';
    process.env.NORNS_RETTUNG_WURZELN = stickOrdner;

    app = await buildApp({
      env: {
        NODE_ENV: 'test', PORT: 0, LOG_LEVEL: 'error', DATABASE_URL: 'unused',
        DB_POOL_MAX: 5, NORNS_PII_KEY: PII_KEY, TRUSTED_ORIGINS: '',
        TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00', DURESS_ALARM_WEBHOOK_URL: '',
      } as unknown as Env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });
  }, 90_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
    rmSync(stickOrdner, { recursive: true, force: true });
    delete process.env.NORNS_LOKALE_KASSE;
    delete process.env.NORNS_RETTUNG_WURZELN;
  });

  beforeEach(async () => {
    await migratorSql`DELETE FROM audit_log`;
    await migratorSql`DELETE FROM ledger_events`;
    await migratorSql`DELETE FROM sessions`;
    await migratorSql`DELETE FROM devices`;
    await migratorSql`DELETE FROM users`;
    rmSync(join(stickOrdner, 'NORNS-RETTUNG'), { recursive: true, force: true });

    const [inh] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner, pos_pin_hash, pos_pin_set_at)
      VALUES (${`i-${randomUUID()}@x.test`}, 'Inhaber', 'ADMIN'::user_role, true, ${await hashPin(ALT_CODE)}, now())
      RETURNING id`;
    inhaberId = inh!.id;

    fingerabdruck = randomUUID().replace(/-/g, '');
    const [g] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${fingerabdruck}, now() - interval '1 day', now() + interval '365 days', ${inhaberId})
      RETURNING id`;
    geraetId = g!.id;

    sitzung = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${inhaberId}, ${sitzung}, now() + interval '8 hours', ${geraetId}, now())`;
  });

  function kopf(token: string | null, mitGeraet = true): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (token) h.cookie = `warehouse14.session=${token}`;
    if (mitGeraet) h['x-dev-device-fingerprint'] = fingerabdruck;
    return h;
  }

  async function beschreibe(): Promise<void> {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/rettungsstick/schreiben',
      headers: kopf(sitzung), payload: { laufwerk: stickOrdner },
    });
    expect(res.statusCode, res.body).toBe(200);
  }

  it('das Laufwerk erscheint, erst ohne, dann mit Schlüssel', async () => {
    const vor = await app.inject({ method: 'GET', url: '/api/auth/rettungsstick/laufwerke', headers: kopf(sitzung) });
    expect(vor.statusCode).toBe(200);
    expect((vor.json() as any).laufwerke[0].traegtSchluessel).toBe(false);
    await beschreibe();
    const nach = await app.inject({ method: 'GET', url: '/api/auth/rettungsstick/laufwerke', headers: kopf(sitzung) });
    expect((nach.json() as any).laufwerke[0].traegtSchluessel).toBe(true);
  });

  it('⛔ der Klartext liegt auf dem Stick, in der Datenbank NUR sein Abdruck', async () => {
    await beschreibe();
    const datei = readFileSync(join(stickOrdner, 'NORNS-RETTUNG', 'rettungsschluessel.norns'), 'utf8');
    const geheimnis = JSON.parse(datei).geheimnis as string;
    const rows = await migratorSql<{ h: string | null }[]>`SELECT rettungsstick_hash AS h FROM users WHERE id = ${inhaberId}`;
    expect(rows[0]?.h).toMatch(/^\$argon2/);
    expect(rows[0]?.h).not.toContain(geheimnis);
  });

  it('einlösen setzt den Code neu, der neue Code meldet an, und der Stick lädt nach', async () => {
    await beschreibe();
    const altesGeheimnis = JSON.parse(
      readFileSync(join(stickOrdner, 'NORNS-RETTUNG', 'rettungsschluessel.norns'), 'utf8'),
    ).geheimnis;

    const res = await app.inject({
      method: 'POST', url: '/api/auth/rettungsstick/einloesen',
      headers: kopf(null), payload: { laufwerk: stickOrdner, neuerCode: NEU_CODE },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as any).stickNachgeladen).toBe(true);

    // Der neue Code meldet an.
    const anmeldung = await app.inject({
      method: 'POST', url: '/api/auth/pin-login', headers: kopf(null), payload: { pin: NEU_CODE, userId: inhaberId },
    });
    expect(anmeldung.statusCode).toBe(200);

    // Der Stick trägt jetzt ein ANDERES Geheimnis (nachgeladen).
    const neuesGeheimnis = JSON.parse(
      readFileSync(join(stickOrdner, 'NORNS-RETTUNG', 'rettungsschluessel.norns'), 'utf8'),
    ).geheimnis;
    expect(neuesGeheimnis).not.toBe(altesGeheimnis);
  });

  it('⛔ das eingelöste Geheimnis gilt kein zweites Mal', async () => {
    await beschreibe();
    const g1 = readFileSync(join(stickOrdner, 'NORNS-RETTUNG', 'rettungsschluessel.norns'), 'utf8');
    const erst = await app.inject({
      method: 'POST', url: '/api/auth/rettungsstick/einloesen',
      headers: kopf(null), payload: { laufwerk: stickOrdner, neuerCode: NEU_CODE },
    });
    expect(erst.statusCode).toBe(200);
    // Das ALTE Geheimnis zurückschreiben und noch einmal versuchen.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(stickOrdner, 'NORNS-RETTUNG', 'rettungsschluessel.norns'), g1, 'utf8');
    const zweit = await app.inject({
      method: 'POST', url: '/api/auth/rettungsstick/einloesen',
      headers: kopf(null), payload: { laufwerk: stickOrdner, neuerCode: '246813' },
    });
    expect(zweit.statusCode).toBe(401);
  });

  it('⛔ ein fremder Stick ist ein Fehlversuch, kein Einlass', async () => {
    await beschreibe();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(join(stickOrdner, 'NORNS-RETTUNG'), { recursive: true });
    writeFileSync(
      join(stickOrdner, 'NORNS-RETTUNG', 'rettungsschluessel.norns'),
      JSON.stringify({ fassung: 1, zweck: 'x', geheimnis: 'A'.repeat(43), geschrieben: 'x' }),
      'utf8',
    );
    const res = await app.inject({
      method: 'POST', url: '/api/auth/rettungsstick/einloesen',
      headers: kopf(null), payload: { laufwerk: stickOrdner, neuerCode: NEU_CODE },
    });
    expect(res.statusCode).toBe(401);
  });

  it('⛔ ein Pfad, der NICHT in der Laufwerksliste steht, wird abgewiesen', async () => {
    await beschreibe();
    const res = await app.inject({
      method: 'POST', url: '/api/auth/rettungsstick/einloesen',
      headers: kopf(null), payload: { laufwerk: '/etc', neuerCode: NEU_CODE },
    });
    expect(res.statusCode).toBe(401);
  });
});
