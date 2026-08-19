/**
 * Duress PIN & Silent Alarm — integration E2E (Decision #37).
 *
 * Coverage:
 *   ✓ duress PIN login → 200 (identical shape) + background silent alarm
 *     (security.duress_login_alert audit row + alert.duress ledger event)
 *   ✓ duress login does NOT tick the lockout counter
 *   ✓ normal POS PIN login → 200, NO duress alarm
 *   ✓ wrong PIN → 401, failed_attempts increments
 *   ✓ POST /api/auth/duress-pin/set happy path → pin.set_duress audit
 *   ✓ duress-pin/set rejects a PIN equal to the POS PIN (route distinctness)
 *   ✓ DB CHECK users_duress_pin_distinct rejects a literal pos==duress hash
 *
 * Runs under `pnpm test:integration` (testcontainer Postgres) — excluded from
 * the default unit `test` run.
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
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import { buildApp } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

/**
 * ⚠️ MINDESTENS SECHS STELLEN. Vier sind seit dem 30.07.2026 vorbei.
 *
 * Basels Entscheidung zur Anmeldung ohne Netz: der Haendler waehlt beim
 * ersten Start selbst, mindestens sechs Ziffern, nie voreingestellt. Die
 * Route prueft das im Rumpfschema, also endet eine vierstellige Zahl in
 * 400 VALIDATION_ERROR, bevor irgendein Ueberfall-Alarm ueberhaupt zur
 * Sprache kommt.
 *
 * Diese Buehne stammt aus der Zeit der vierstelligen Zahl. Der Riegel hatte
 * recht, die Buehne nicht. Alle Zahlen hier stehen ausserdem NICHT auf der
 * Sperrliste der schwachen Zahlen, damit die Pruefung auch dann traegt, wenn
 * die Sperrliste eines Tages nicht nur im Echtbetrieb greift.
 */
const POS_PIN = '481902';
const DURESS_PIN = '735164';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

describe('Duress PIN & Silent Alarm (Decision #37)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;

  let cashierUserId: string;
  let deviceFingerprint: string;
  let deviceId: string;
  let sessionToken: string;
  let posHash: string;
  let duressHash: string;

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

    const env = {
      NODE_ENV: 'test',
      PORT: 0,
      LOG_LEVEL: 'error',
      DATABASE_URL: 'unused-because-override',
      DB_POOL_MAX: 5,
      NORNS_PII_KEY: PII_KEY,
      TRUSTED_ORIGINS: '',
      TRANSACTION_STEP_UP_THRESHOLD_EUR: '1000.00',
      DURESS_ALARM_WEBHOOK_URL: '',
    } as unknown as Env;

    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql },
      fastifyOpts: { disableRequestLogging: true },
    });

    posHash = await hashPin(POS_PIN);
    duressHash = await hashPin(DURESS_PIN);
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

    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, pos_pin_hash, pos_pin_set_at,
                         duress_pin_hash, duress_pin_set_at)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role,
              ${posHash}, now(), ${duressHash}, now())
      RETURNING id`;
    if (!cashier) throw new Error('seed: cashier insert returned no row');
    cashierUserId = cashier.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${cashierUserId})
      RETURNING id`;
    if (!dev) throw new Error('seed: device insert returned no row');
    deviceId = dev.id;

    sessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${sessionToken}, now() + interval '8 hours', ${deviceId}, now())`;
  });

  function headers(token: string | null): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (token) h.cookie = `warehouse14.session=${token}`;
    h['x-dev-device-fingerprint'] = deviceFingerprint;
    return h;
  }

  async function countEvents(
    table: 'audit_log' | 'ledger_events',
    eventType: string,
  ): Promise<number> {
    const rows = await migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM ${migratorSql(table)} WHERE event_type = ${eventType}`;
    return Number(rows[0]?.n ?? '0');
  }

  /** The alarm fires on a detached promise — poll briefly for the rows. */
  async function waitForCount(
    table: 'audit_log' | 'ledger_events',
    eventType: string,
    timeoutMs = 3000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const n = await countEvents(table, eventType);
      if (n > 0 || Date.now() > deadline) return n;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function failedAttempts(): Promise<number> {
    const rows = await migratorSql<{ n: number }[]>`
      SELECT pos_pin_failed_attempts AS n FROM users WHERE id = ${cashierUserId}`;
    return rows[0]?.n ?? 0;
  }

  it('duress PIN login → 200 + silent alarm (audit + alert.duress ledger)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      headers: headers(null),
      payload: { pin: DURESS_PIN },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // Background alarm legs land shortly after the (already-sent) response.
    expect(await waitForCount('audit_log', 'security.duress_login_alert')).toBe(1);
    expect(await waitForCount('ledger_events', 'alert.duress')).toBe(1);
    // The duress attempt must NOT tick the lockout counter.
    expect(await failedAttempts()).toBe(0);
  });

  it('normal POS PIN login → 200 with NO duress alarm', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      headers: headers(null),
      payload: { pin: POS_PIN },
    });
    expect(res.statusCode).toBe(200);
    // Give any (incorrect) detached work a beat, then assert no alarm fired.
    await new Promise((r) => setTimeout(r, 150));
    expect(await countEvents('audit_log', 'security.duress_login_alert')).toBe(0);
    expect(await countEvents('ledger_events', 'alert.duress')).toBe(0);
  });

  it('wrong PIN → 401 and increments the lockout counter', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/pin-login',
      headers: headers(null),
      // Formal in Ordnung, inhaltlich falsch: nur so kommt die Anfrage bis zur
      // Pruefung der Zahl und der Zaehler kann ueberhaupt steigen.
      payload: { pin: '900117' },
    });
    expect(res.statusCode).toBe(401);
    expect(await failedAttempts()).toBe(1);
    expect(await countEvents('audit_log', 'security.duress_login_alert')).toBe(0);
  });

  it('⛔ vier GLEICHZEITIGE Fehlversuche zaehlen vier, nicht einen (19.08.2026)', async () => {
    /*
     * ── DER FUND DER BOESWILLIGEN PRUEFUNG ────────────────────────────────
     *
     * Die Entscheidung ueber Zaehler und Sperre fiel aus einem Lesevorgang
     * VOR der Transaktion. Vier gleichzeitige Fehlversuche lasen alle
     * denselben Stand, rechneten alle „eins" und schrieben alle „eins" —
     * nach vier falschen Eingaben stand der Zaehler auf EINS. Wer parallel
     * raet, lief damit an der Sperre vorbei: der Schutz gegen das
     * Durchprobieren versagte genau unter der Last, unter der er zaehlt.
     *
     * Dieser Satz feuert vier Anfragen OHNE await dazwischen. Vor der
     * Abhilfe blieb der Zaehler bei 1; jetzt reihen sie sich unter
     * `FOR UPDATE` hintereinander.
     */
    await migratorSql`
      UPDATE users SET pos_pin_failed_attempts = 0, pos_pin_locked_until = NULL
       WHERE id = ${cashierUserId}`;

    const parallel = await Promise.all(
      /*
       * ⚠️ JE ANFRAGE EINE EIGENE HERKUNFT. Die Ratenbremse zaehlt fuer
       * unangemeldete Rufer je IP (5 je Minute, `plugins/rate-limit.ts`) und
       * bleibt in JEDER Umgebung scharf — sie ist die erste Verteidigung
       * gegen das Durchprobieren. Ohne verschiedene Herkuenfte wiesen schon
       * ihre 429 die vier Versuche ab (gemessen), und dieser Satz pruefte die
       * Bremse statt den Zaehler dahinter.
       */
      ['900111', '900222', '900333', '900444'].map((pin, i) =>
        app.inject({
          method: 'POST',
          url: '/api/auth/pin-login',
          headers: { ...headers(null), 'x-forwarded-for': `203.0.113.${10 + i}` },
          remoteAddress: `203.0.113.${10 + i}`,
          payload: { pin },
        }),
      ),
    );
    // Alle vier sind formal gueltig und inhaltlich falsch. Keine darf durch.
    for (const r of parallel) {
      expect([401, 423], `unerwartet ${r.statusCode}: ${r.body.slice(0, 90)}`).toContain(
        r.statusCode,
      );
    }
    expect(await failedAttempts(), 'der Zaehler hat Fehlversuche verschluckt').toBe(4);

    await migratorSql`
      UPDATE users SET pos_pin_failed_attempts = 0, pos_pin_locked_until = NULL
       WHERE id = ${cashierUserId}`;
  });

  it('POST /api/auth/duress-pin/set → 200 + pin.set_duress audit', async () => {
    // Clear the seeded duress PIN first so we set a fresh one.
    await migratorSql`UPDATE users SET duress_pin_hash = NULL, duress_pin_set_at = NULL WHERE id = ${cashierUserId}`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/duress-pin/set',
      headers: headers(sessionToken),
      payload: { newPin: '629483' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(await countEvents('audit_log', 'pin.set_duress')).toBe(1);
    const rows = await migratorSql<{ h: string | null }[]>`
      SELECT duress_pin_hash AS h FROM users WHERE id = ${cashierUserId}`;
    expect(rows[0]?.h ?? null).not.toBeNull();
  });

  it('duress-pin/set rejects a PIN equal to the POS PIN (route distinctness)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/duress-pin/set',
      headers: headers(sessionToken),
      payload: { newPin: POS_PIN },
    });
    expect(res.statusCode).toBe(401);
  });

  it('DB CHECK users_duress_pin_distinct rejects a literal pos==duress hash', async () => {
    await expect(
      migratorSql`UPDATE users SET duress_pin_hash = pos_pin_hash WHERE id = ${cashierUserId}`,
    ).rejects.toThrow(/users_duress_pin_distinct/);
  });
});
