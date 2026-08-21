/**
 * ⛔ Der Herstellercode — am echten Motor, an echtem Postgres
 *
 * Die letzte Tür: Aufgabe an der Kasse, Unterschrift beim Hersteller,
 * Antwort zurück. Die Probe besitzt ein EIGENES Schlüsselpaar (nie das des
 * Hauses) und reicht dessen öffentliche Hälfte über `NORNS_MEISTER_SPKI`
 * herein — exakt der Hebel, den auch der echte Motor kennt.
 */

import { createPrivateKey, generateKeyPairSync, randomUUID, sign } from 'node:crypto';

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

const paar = generateKeyPairSync('ed25519');
const PRIV = paar.privateKey;
const PUB_B64 = paar.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

/** Basels Werkzeug, in klein: die Aufgabe zerlegen und unterschreiben. */
function unterschreibe(aufgabeText: string): string {
  const m = /^NORNS-M1-([A-Z2-9]{8})-([A-Z2-9]{8})-(\d{10,16})$/.exec(aufgabeText);
  if (!m) throw new Error(`keine Aufgabe: ${aufgabeText}`);
  const nachricht = `norns-meister-v1|${m[1]}|${m[2]}|${m[3]}`;
  return sign(null, Buffer.from(nachricht, 'utf8'), PRIV).toString('base64');
}

describe('⛔ Der Herstellercode', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;
  let inhaberId: string;
  let fingerabdruck: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test').withUsername('postgres').withPassword('postgres_test_pw')
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

    process.env.NORNS_MEISTER_SPKI = PUB_B64;
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
    delete process.env.NORNS_MEISTER_SPKI;
  });

  beforeEach(async () => {
    await migratorSql`DELETE FROM audit_log`;
    await migratorSql`DELETE FROM ledger_events`;
    await migratorSql`DELETE FROM sessions`;
    await migratorSql`DELETE FROM devices`;
    await migratorSql`DELETE FROM users`;
    const [inh] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner, pos_pin_hash, pos_pin_set_at)
      VALUES (${`i-${randomUUID()}@x.test`}, 'Inhaber', 'ADMIN'::user_role, true, ${await hashPin(ALT_CODE)}, now())
      RETURNING id`;
    inhaberId = inh!.id;
    fingerabdruck = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${fingerabdruck}, now() - interval '1 day', now() + interval '365 days', ${inhaberId})`;
  });

  function kopf(mitGeraet = true): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (mitGeraet) h['x-dev-device-fingerprint'] = fingerabdruck;
    return h;
  }

  async function aufgabe(): Promise<string> {
    const res = await app.inject({ method: 'GET', url: '/api/auth/meister/aufgabe', headers: kopf() });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { aufgabe: string }).aufgabe;
  }

  it('der ganze Weg: Aufgabe → Unterschrift → neuer Code meldet an', async () => {
    const a = await aufgabe();
    expect(a).toMatch(/^NORNS-M1-/);
    const res = await app.inject({
      method: 'POST', url: '/api/auth/meister/einloesen',
      headers: kopf(), payload: { antwort: unterschreibe(a), neuerCode: NEU_CODE },
    });
    expect(res.statusCode, res.body).toBe(200);
    const anmeldung = await app.inject({
      method: 'POST', url: '/api/auth/pin-login', headers: kopf(), payload: { pin: NEU_CODE, userId: inhaberId },
    });
    expect(anmeldung.statusCode).toBe(200);
    const laut = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM ledger_events WHERE event_type = 'alert.meistercode'`;
    // Der Alarm fliegt abgekoppelt — kurz darauf warten.
    const frist = Date.now() + 3000;
    let n = Number(laut[0]?.n ?? '0');
    while (n === 0 && Date.now() < frist) {
      await new Promise((r) => setTimeout(r, 50));
      const z = await migratorSql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM ledger_events WHERE event_type = 'alert.meistercode'`;
      n = Number(z[0]?.n ?? '0');
    }
    expect(n).toBe(1);
  });

  it('⛔ dieselbe Antwort gilt kein zweites Mal (Aufgabe verbraucht)', async () => {
    const a = await aufgabe();
    const antwort = unterschreibe(a);
    const erst = await app.inject({
      method: 'POST', url: '/api/auth/meister/einloesen',
      headers: kopf(), payload: { antwort, neuerCode: NEU_CODE },
    });
    expect(erst.statusCode).toBe(200);
    const zweit = await app.inject({
      method: 'POST', url: '/api/auth/meister/einloesen',
      headers: kopf(), payload: { antwort, neuerCode: '246813' },
    });
    expect(zweit.statusCode).toBe(401);
  });

  it('⛔ eine falsche Unterschrift öffnet nichts und steht im Tagebuch', async () => {
    await aufgabe();
    const res = await app.inject({
      method: 'POST', url: '/api/auth/meister/einloesen',
      headers: kopf(), payload: { antwort: Buffer.alloc(64).toString('base64'), neuerCode: NEU_CODE },
    });
    expect(res.statusCode).toBe(401);
    const rows = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM audit_log WHERE event_type = 'meister.fehlversuch'`;
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('⛔ ohne gepaartes Gerät gibt es nicht einmal eine Aufgabe', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/meister/aufgabe', headers: kopf(false) });
    expect(res.statusCode).not.toBe(200);
  });
});
