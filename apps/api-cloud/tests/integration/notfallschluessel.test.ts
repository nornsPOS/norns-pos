/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Notfallschlüssel — am echten Motor, an echtem Postgres
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Weg zurück in eine Kasse, deren Inhaber seinen Kassencode vergessen
 * hat. Weil er ein ZWEITES Geheimnis ist, das die Kasse öffnet, prüft diese
 * Probe nicht nur, dass er funktioniert, sondern vor allem, wo er NICHT
 * funktioniert:
 *
 *   ✓ erzeugen verlangt Inhaber MIT frischer Zwischenprüfung
 *   ⛔ ein Kassierer bekommt keinen Schlüssel
 *   ✓ einlösen setzt den Kassencode neu — und der neue Code meldet an
 *   ⛔ einlösen gibt KEINE Sitzung zurück
 *   ⛔ derselbe Schlüssel gilt kein zweites Mal
 *   ⛔ ohne gepaartes Gerät geht gar nichts (nicht aus dem Netz)
 *   ⛔ zehn Fehlversuche sperren den SCHLÜSSEL, nicht den Verkauf
 *   ⛔ ein schwacher neuer Code kommt hier nicht hinein
 *   ✓ das Tagebuch trägt jeden Vorgang, und der Klartext steht NIE darin
 */

import { randomUUID } from 'node:crypto';
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
  CREATE ROLE warehouse14_migrator
    LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

describe('⛔ Der Notfallschlüssel', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let inhaberId: string;
  let kassiererId: string;
  let fingerabdruck: string;
  let geraetId: string;
  let sitzung: string;
  let altHash: string;

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

    app = await buildApp({
      env: {
        NODE_ENV: 'test',
        PORT: 0,
        LOG_LEVEL: 'error',
        DATABASE_URL: 'unused-because-override',
        DB_POOL_MAX: 5,
        NORNS_PII_KEY: PII_KEY,
        TRUSTED_ORIGINS: '',
        TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
        DURESS_ALARM_WEBHOOK_URL: '',
      } as unknown as Env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });

    altHash = await hashPin(ALT_CODE);
  }, 90_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  beforeEach(async () => {
    await migratorSql`DELETE FROM audit_log`;
    await migratorSql`DELETE FROM ledger_events`;
    await migratorSql`DELETE FROM sessions`;
    await migratorSql`DELETE FROM devices`;
    await migratorSql`DELETE FROM users`;

    const [inhaber] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner, pos_pin_hash, pos_pin_set_at)
      VALUES (${`i-${randomUUID()}@x.test`}, 'Inhaber', 'ADMIN'::user_role, true,
              ${altHash}, now())
      RETURNING id`;
    if (!inhaber) throw new Error('Saat: Inhaber fehlt');
    inhaberId = inhaber.id;

    const [kassierer] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, pos_pin_hash, pos_pin_set_at)
      VALUES (${`k-${randomUUID()}@x.test`}, 'Kassierer', 'CASHIER'::user_role, ${altHash}, now())
      RETURNING id`;
    if (!kassierer) throw new Error('Saat: Kassierer fehlt');
    kassiererId = kassierer.id;

    fingerabdruck = randomUUID().replace(/-/g, '');
    const [g] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${fingerabdruck},
              now() - interval '1 day', now() + interval '365 days', ${inhaberId})
      RETURNING id`;
    if (!g) throw new Error('Saat: Gerät fehlt');
    geraetId = g.id;

    probenNr += 1;
    probenIp = `10.0.${Math.floor(probenNr / 256)}.${probenNr % 256}`;

    sitzung = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${inhaberId}, ${sitzung}, now() + interval '8 hours', ${geraetId}, now())`;
  });

  /*
   * ⚠️ JEDE PROBE RUFT AUS EINER EIGENEN ADRESSE.
   *
   * Der Bremsklotz vor `/api/auth/` lässt zwanzig Anfragen je Minute je
   * Adresse durch — richtig so, das ist der Schutz gegen das Durchprobieren.
   * Zwölf Proben mit je zwei bis drei Anfragen sprengen ihn aber gemeinsam,
   * und dann misst man den Bremsklotz statt den Notausgang. Eine Adresse JE
   * PROBE löst das, ohne die Bremse abzuschalten: INNERHALB einer Probe gilt
   * sie weiter — die Sperrprobe unten fährt elf Anfragen unter zwanzig.
   *
   * ⚠️ Und das ist keine Bequemlichkeit: die Sperre zählt am MENSCHEN in der
   * Datenbank, nicht an der Adresse. Wer die Adresse wechselt, entkommt ihr
   * nicht — genau das prüft die Sperrprobe damit gleich mit.
   */
  let probenNr = 0;
  let probenIp = '10.0.0.1';

  function kopf(token: string | null, mitGeraet = true): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (token) h.cookie = `warehouse14.session=${token}`;
    if (mitGeraet) h['x-dev-device-fingerprint'] = fingerabdruck;
    return h;
  }

  /** Einen Schlüssel ausgeben lassen und den Klartext zurückgeben. */
  async function holeSchluessel(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/erzeugen',
      headers: kopf(sitzung),
      remoteAddress: probenIp,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { schluessel: string }).schluessel;
  }

  /**
   * ⚠️ Der Alarm fliegt auf einem ABGEKOPPELTEN Versprechen: die Antwort ist
   * längst beim Aufrufer, wenn die Zeile im Hauptbuch landet. Ohne dieses
   * Warten löschte die nächste Probe ihr Gerät, während der Alarm noch
   * schrieb — gemessen als „violates foreign key ledger_events_device_id_fkey".
   * Das Warten ist kein Kunstgriff um eine Schwäche herum, sondern genau die
   * Zusicherung, die der Notausgang gibt: es schlägt auf der Aufsicht auf.
   */
  async function warteAufAlarm(erwartet = 1, frist = 3000): Promise<number> {
    const schluss = Date.now() + frist;
    for (;;) {
      const rows = await migratorSql<{ n: string }[]>`
        SELECT count(*)::text AS n FROM ledger_events
         WHERE event_type = 'alert.notfallschluessel'`;
      const n = Number(rows[0]?.n ?? '0');
      if (n >= erwartet || Date.now() > schluss) return n;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function tagebuch(art: string): Promise<number> {
    const rows = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM audit_log WHERE event_type = ${art}`;
    return Number(rows[0]?.n ?? '0');
  }

  // ── Ausgeben ──────────────────────────────────────────────────────────

  it('der Inhaber bekommt einen Schlüssel in der abtippbaren Form', async () => {
    const s = await holeSchluessel();
    expect(s).toMatch(/^NORNS-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Ohne die Zeichen, die man auf Papier verwechselt.
    expect(s.replace(/^NORNS-/, '')).not.toMatch(/[IO01]/);
    expect(await tagebuch('notfallschluessel.erzeugt')).toBe(1);
  });

  it('⛔ der Klartext steht NIRGENDS in der Datenbank', async () => {
    const s = await holeSchluessel();
    const kern = s.replace(/^NORNS-/, '').replace(/-/g, '');
    const rows = await migratorSql<{ h: string | null }[]>`
      SELECT notfallschluessel_hash AS h FROM users WHERE id = ${inhaberId}`;
    expect(rows[0]?.h).toMatch(/^\$argon2/);
    expect(rows[0]?.h).not.toContain(kern);
    const spuren = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM audit_log WHERE payload::text LIKE ${`%${kern}%`}`;
    expect(Number(spuren[0]?.n)).toBe(0);
  });

  it('⛔ ein Kassierer bekommt keinen Schlüssel', async () => {
    const k = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${kassiererId}, ${k}, now() + interval '8 hours', ${geraetId}, now())`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/erzeugen',
      headers: kopf(k),
      remoteAddress: probenIp,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('⛔ ohne frische Zwischenprüfung kein Schlüssel', async () => {
    // Ein unbeaufsichtigter Bildschirm darf sich keinen Zweitschlüssel
    // ausstellen: die Anmeldung liegt Stunden zurück.
    await migratorSql`
      UPDATE sessions SET last_pin_step_up_at = now() - interval '3 hours' WHERE token = ${sitzung}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/erzeugen',
      headers: kopf(sitzung),
      remoteAddress: probenIp,
      payload: {},
    });
    expect((res.json() as { error?: { code?: string } }).error?.code).toBe('STEP_UP_REQUIRED');
  });

  it('der Stand nennt das Datum, aber NIE den Schlüssel', async () => {
    await holeSchluessel();
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/notfallschluessel/stand',
      headers: kopf(sitzung),
      remoteAddress: probenIp,
    });
    expect(res.statusCode).toBe(200);
    const b = res.json() as Record<string, unknown>;
    expect(b.vorhanden).toBe(true);
    expect(typeof b.gesetztAm).toBe('string');
    expect(JSON.stringify(b)).not.toContain('NORNS-');
  });

  // ── Einlösen ──────────────────────────────────────────────────────────

  it('einlösen setzt den Kassencode neu, und der neue Code meldet an', async () => {
    const s = await holeSchluessel();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: NEU_CODE },
    });
    expect(res.statusCode).toBe(200);

    const anmeldung = await app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { pin: NEU_CODE, userId: inhaberId },
    });
    expect(anmeldung.statusCode).toBe(200);
    expect(await tagebuch('notfallschluessel.eingeloest')).toBe(1);
    // ✓ und die Aufsicht sieht es sofort.
    expect(await warteAufAlarm()).toBe(1);
  });

  it('⛔ einlösen gibt KEINE Sitzung zurück — es meldet nicht an', async () => {
    const s = await holeSchluessel();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: NEU_CODE },
    });
    expect(res.statusCode).toBe(200);
    // Weder ein Keks noch ein Merkmal im Rumpf.
    const kekse = res.headers['set-cookie'];
    expect(kekse === undefined || !String(kekse).includes('warehouse14.session')).toBe(true);
    expect(JSON.stringify(res.json())).not.toMatch(/token|session/i);
    const offen = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM sessions WHERE user_id = ${inhaberId}`;
    expect(Number(offen[0]?.n)).toBe(1); // nur die aus der Saat
    await warteAufAlarm();
  });

  it('⛔ derselbe Schlüssel gilt kein zweites Mal', async () => {
    const s = await holeSchluessel();
    const erst = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: NEU_CODE },
    });
    expect(erst.statusCode).toBe(200);
    const zweit = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: '246813' },
    });
    expect(zweit.statusCode).toBe(401);
    await warteAufAlarm();
  });

  it('der Nachfolger aus der Antwort gilt sofort', async () => {
    const s = await holeSchluessel();
    const erst = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: NEU_CODE },
    });
    const nachfolger = (erst.json() as { neuerSchluessel: string }).neuerSchluessel;
    expect(nachfolger).not.toBe(s);
    const zweit = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: nachfolger, neuerCode: '246813' },
    });
    expect(zweit.statusCode).toBe(200);
    await warteAufAlarm(2);
  });

  it('⛔ ohne gepaartes Gerät geht gar nichts — nicht aus dem Netz', async () => {
    const s = await holeSchluessel();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null, false),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: NEU_CODE },
    });
    expect(res.statusCode).not.toBe(200);
  });

  it('⛔ ein schwacher neuer Code kommt hier nicht hinein', async () => {
    const s = await holeSchluessel();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: '12345' },
    });
    expect(res.statusCode).not.toBe(200);
    // Der Schlüssel darf durch einen abgelehnten Code NICHT verbraucht sein.
    const noch = await app.inject({
      method: 'POST',
      url: '/api/auth/notfallschluessel/einloesen',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { schluessel: s, neuerCode: NEU_CODE },
    });
    expect(noch.statusCode).toBe(200);
    await warteAufAlarm();
  });

  it('⛔ Fehlversuche sperren den SCHLÜSSEL, nicht den Verkauf', async () => {
    await holeSchluessel();
    for (let i = 0; i < 10; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/notfallschluessel/einloesen',
        headers: kopf(null),
        remoteAddress: probenIp,
        payload: { schluessel: 'NORNS-ZZZZ-ZZZZ-ZZZZ-ZZZZ', neuerCode: NEU_CODE },
      });
    }
    const gesperrt = await migratorSql<{ b: Date | null; p: Date | null }[]>`
      SELECT notfallschluessel_gesperrt_bis AS b, pos_pin_locked_until AS p
        FROM users WHERE id = ${inhaberId}`;
    expect(gesperrt[0]?.b).not.toBeNull();
    // ⚠️ DER KERN: der Tresen läuft weiter. Wäre es ein Zähler, hätte ein
    // Angreifer aus dem Notausgang eine Waffe gegen den Verkauf gemacht.
    expect(gesperrt[0]?.p).toBeNull();

    const anmeldung = await app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      headers: kopf(null),
      remoteAddress: probenIp,
      payload: { pin: ALT_CODE, userId: inhaberId },
    });
    expect(anmeldung.statusCode).toBe(200);
  });
});
