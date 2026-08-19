/**
 * GET /api/sse/ledger — Day 14 E2E test.
 *
 * SSE cannot be tested via `app.inject` because the request lifetime is
 * indefinite by design — `inject` resolves on response end. We start the
 * Fastify server on `localhost:<random>` and drive it through Node's `http`
 * module, parsing the chunked `text/event-stream` body manually.
 *
 * Coverage matrix:
 *   ✓ ADMIN session + dev mTLS header → 200 + text/event-stream
 *   ✓ heartbeat `:hb …` arrives within 250 ms (immediate on connect)
 *   ✓ event arrives within 1 s of an INSERT INTO ledger_events
 *   ✓ Last-Event-ID replay returns missed rows on reconnect
 *   ✓ requireAuth gate: no cookie → 401
 *   ✓ requireRole gate: CASHIER cookie → 403
 *   ✓ client close → LISTEN connection released (pg_stat_activity check)
 */

import { randomUUID } from 'node:crypto';
import { type IncomingMessage, request as httpRequest } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
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

// ────────────────────────────────────────────────────────────────────
// SSE chunk parser — converts a stream of bytes into discrete events.
// Each SSE event ends with a blank line (\n\n).
// ────────────────────────────────────────────────────────────────────
interface ParsedEvent {
  id?: string;
  event?: string;
  data?: string;
  /** A `:`-prefixed comment frame (e.g. heartbeat). */
  comment?: string;
}

class SseStream {
  private buffer = '';
  public events: ParsedEvent[] = [];

  public feed(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const ev: ParsedEvent = {};
      for (const line of frame.split('\n')) {
        if (line.startsWith(':')) {
          ev.comment = (ev.comment ?? '') + line.slice(1).trim() + ' ';
          continue;
        }
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const field = line.slice(0, colon);
        const value = line.slice(colon + 1).trimStart();
        if (field === 'id') ev.id = value;
        else if (field === 'event') ev.event = value;
        else if (field === 'data') ev.data = value;
      }
      this.events.push(ev);
    }
  }
}

describe('GET /api/sse/ledger — Day 14 live stream', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let app: FastifyInstance;
  let serverPort: number;
  let dbHost: string;
  let dbPort: number;

  // Fixtures
  let adminUserId: string;
  let cashierUserId: string;
  let deviceFingerprint: string;
  let adminSessionToken: string;
  let cashierSessionToken: string;

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

    dbHost = container.getHost();
    dbPort = container.getPort();

    migratorSql = postgres({
      host: dbHost,
      port: dbPort,
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });
    await applyAll(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    appSql = postgres({
      host: dbHost,
      port: dbPort,
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
      DATABASE_URL: `postgres://warehouse14_app:warehouse14_app_test_pw@${dbHost}:${dbPort}/warehouse14_test`,
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

    // Dedicated-connection factory points at the testcontainer.
    const dedicatedConnectionFactory = (): Sql =>
      postgres({
        host: dbHost,
        port: dbPort,
        database: 'warehouse14_test',
        username: 'warehouse14_app',
        password: 'warehouse14_app_test_pw',
        max: 1,
        idle_timeout: 0,
        connection: { application_name: 'warehouse14_test_sse' },
        onnotice: () => {},
      });

    app = await buildApp({
      env,
      dbOverride: { db: appDb, sql: appSql, dedicatedConnectionFactory },
      fastifyOpts: { disableRequestLogging: true },
    });

    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (!addr || typeof addr === 'string') throw new Error('failed to get server address');
    serverPort = addr.port;
  }, 90_000);

  afterAll(async () => {
    await app.close().catch(() => {});
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  beforeEach(async () => {
    /**
     * ⚠️ Erst die Sitzungen, dann die Geraete, dann die Nutzer.
     *
     * Bis zum 04.08.2026 stand hier NUR das Loeschen der Inhaber. Der erste
     * Durchgang ging durch, jeder weitere brach ab:
     *   „update or delete on table users violates foreign key constraint
     *    devices_paired_by_user_id_fkey on table devices"
     * Das Geraet des vorigen Durchgangs zeigt auf den Nutzer, der geloescht
     * werden soll. Fuenf der sechs Pruefungen dieser Datei starben daran, und
     * zwar SCHON in der Vorbereitung, also ohne dass die Leitung selbst je
     * gemessen wurde.
     *
     * Bewusst KEIN `TRUNCATE devices CASCADE`: `ledger_events.device_id` zeigt
     * auf `devices`, ein CASCADE risse also die Beweiskette mit, und genau die
     * ist der Gegenstand dieser Datei.
     */
    await migratorSql`DELETE FROM sessions`;
    await migratorSql`DELETE FROM devices`;
    await migratorSql`DELETE FROM users WHERE is_owner = TRUE OR role <> 'ADMIN'`;
    const [admin] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`a-${randomUUID()}@x.test`}, 'Admin', 'ADMIN'::user_role, TRUE)
      RETURNING id`;
    adminUserId = admin!.id;
    const [cashier] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = cashier!.id;

    deviceFingerprint = randomUUID().replace(/-/g, '');
    const [dev] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${deviceFingerprint},
              now() - interval '1 day', now() + interval '365 days', ${adminUserId})
      RETURNING id`;
    const deviceId = dev!.id;

    adminSessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${adminUserId}, ${adminSessionToken}, now() + interval '30 days', ${deviceId}, now())`;
    cashierSessionToken = randomUUID().replace(/-/g, '');
    await migratorSql`
      INSERT INTO sessions (user_id, token, expires_at, device_id, last_pin_step_up_at)
      VALUES (${cashierUserId}, ${cashierSessionToken}, now() + interval '8 hours', ${deviceId}, NULL)`;
  });

  // ────────────────────────────────────────────────────────────────────
  // Helper: open an SSE connection. Returns the IncomingMessage + a parser.
  // Caller MUST call `.req.destroy()` to close.
  // ────────────────────────────────────────────────────────────────────

  function openSse(opts: {
    cookie?: string;
    fingerprint?: string;
    lastEventId?: string;
  }): Promise<{ res: IncomingMessage; stream: SseStream; close: () => void }> {
    return new Promise((resolveOpen, rejectOpen) => {
      const headers: Record<string, string> = { accept: 'text/event-stream' };
      if (opts.cookie) headers.cookie = opts.cookie;
      if (opts.fingerprint !== undefined && opts.fingerprint !== null) {
        headers['x-dev-device-fingerprint'] = opts.fingerprint;
      }
      if (opts.lastEventId) headers['last-event-id'] = opts.lastEventId;

      const r = httpRequest({
        host: '127.0.0.1',
        port: serverPort,
        path: '/api/sse/ledger',
        method: 'GET',
        headers,
      });
      const stream = new SseStream();
      r.on('response', (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => stream.feed(chunk));
        res.on('error', () => {}); // swallow — closing is the contract
        resolveOpen({ res, stream, close: () => r.destroy() });
      });
      r.on('error', rejectOpen);
      r.end();
    });
  }

  async function waitFor(
    predicate: () => boolean | Promise<boolean>,
    timeoutMs: number,
  ): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await predicate()) return true;
      await wait(20);
    }
    return await predicate();
  }

  // ────────────────────────────────────────────────────────────────────
  // 1. Auth gates
  // ────────────────────────────────────────────────────────────────────

  it('GET /api/sse/ledger without cookie → 401 UNAUTHORIZED', async () => {
    const { res, close } = await openSse({});
    expect(res.statusCode).toBe(401);
    close();
  });

  it('GET /api/sse/ledger as CASHIER → 403 FORBIDDEN', async () => {
    const { res, close } = await openSse({
      cookie: `warehouse14.session=${cashierSessionToken}`,
      fingerprint: deviceFingerprint,
    });
    expect(res.statusCode).toBe(403);
    close();
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. Happy path — connect, heartbeat, live event
  // ────────────────────────────────────────────────────────────────────

  it('ADMIN session → 200 + text/event-stream + immediate heartbeat', async () => {
    const { res, stream, close } = await openSse({
      cookie: `warehouse14.session=${adminSessionToken}`,
      fingerprint: deviceFingerprint,
    });
    try {
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toMatch(/text\/event-stream/);
      // The immediate hello-heartbeat lands inside ~100ms.
      const heartbeatArrived = await waitFor(
        () => stream.events.some((e) => e.comment?.startsWith('hb ') ?? false),
        500,
      );
      expect(heartbeatArrived).toBe(true);
    } finally {
      close();
      await wait(50);
    }
  });

  it('INSERT INTO ledger_events → SSE event arrives <1s with event=ledger + id', async () => {
    const { res, stream, close } = await openSse({
      cookie: `warehouse14.session=${adminSessionToken}`,
      fingerprint: deviceFingerprint,
    });
    try {
      expect(res.statusCode).toBe(200);
      // Wait for connection + heartbeat to confirm we are LISTENing.
      await waitFor(() => stream.events.some((e) => e.comment?.startsWith('hb ') ?? false), 500);

      /**
       * ⚠️ `sql.json(...)` und NICHT `${JSON.stringify(…)}::jsonb`.
       *
       * Gemessen am 04.08.2026 in diesem Behaelter:
       *   jsonb_typeof(${JSON.stringify({marker:'x'})}::jsonb) → 'string'
       *   jsonb_typeof(${sql.json({marker:'x'})})              → 'object'
       * und der Rohwert der ersten Form lautet "{\"marker\":\"x\"}" — der
       * Treiber verpackt die schon fertige Zeichenkette EIN ZWEITES MAL.
       *
       * Der Riegel `ledger_events_payload_object` (Wanderung 0008) verlangt ein
       * Objekt und wies die Zeile deshalb zu Recht ab. Ein Beweiseintrag, dessen
       * Rumpf eine Zeichenkette ist, waere fuer jeden Leser unbrauchbar.
       */
      // Now insert a ledger row — the AFTER INSERT trigger fires pg_notify.
      const [row] = await migratorSql<{ id: string }[]>`
        INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
        VALUES ('test.sse', 'test', gen_random_uuid(),
                ${migratorSql.json({ marker: 'sse-arrived' })})
        RETURNING id`;
      const insertedId = String(row!.id);

      const eventArrived = await waitFor(
        () => stream.events.some((e) => e.event === 'ledger' && e.id === insertedId),
        2_000,
      );
      expect(eventArrived).toBe(true);

      const evt = stream.events.find((e) => e.event === 'ledger' && e.id === insertedId)!;
      const data = JSON.parse(evt.data!);
      expect(data.event_type).toBe('test.sse');
      expect(data.payload.marker).toBe('sse-arrived');
    } finally {
      close();
      await wait(50);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. Last-Event-ID replay
  // ────────────────────────────────────────────────────────────────────

  it('reconnect with Last-Event-ID replays missed events', async () => {
    // Insert 3 events while no consumer is listening.
    const insertedIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await migratorSql<{ id: string }[]>`
        INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
        VALUES (${`test.replay.${i}`}, 'test', gen_random_uuid(), '{}'::jsonb)
        RETURNING id`;
      insertedIds.push(String(row!.id));
    }
    // Reconnect with Last-Event-ID one BEFORE the first inserted id.
    const sinceId = String(Number.parseInt(insertedIds[0]!, 10) - 1);

    const { res, stream, close } = await openSse({
      cookie: `warehouse14.session=${adminSessionToken}`,
      fingerprint: deviceFingerprint,
      lastEventId: sinceId,
    });
    try {
      expect(res.statusCode).toBe(200);
      const allReplayed = await waitFor(
        () =>
          insertedIds.every((id) => stream.events.some((e) => e.id === id && e.event === 'ledger')),
        2_000,
      );
      expect(allReplayed).toBe(true);
    } finally {
      close();
      await wait(50);
    }
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Leak prevention — connection released on client close
  // ────────────────────────────────────────────────────────────────────

  it('client close → dedicated LISTEN connection is released (no leak)', async () => {
    const baselineRow = await migratorSql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM pg_stat_activity
       WHERE application_name = 'warehouse14_test_sse'`;
    const baseline = Number.parseInt(baselineRow[0]!.count, 10);

    const { res, close } = await openSse({
      cookie: `warehouse14.session=${adminSessionToken}`,
      fingerprint: deviceFingerprint,
    });
    expect(res.statusCode).toBe(200);
    // Wait for the LISTEN connection to actually establish.
    await waitFor(async () => {
      const r = await migratorSql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM pg_stat_activity
         WHERE application_name = 'warehouse14_test_sse'`;
      return Number.parseInt(r[0]!.count, 10) > baseline;
    }, 1_000);

    close();

    // The route registered req.raw.on('close') → cleanup. The listener
    // connection MUST be terminated within a generous window.
    const cleanedUp = await waitFor(async () => {
      const r = await migratorSql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM pg_stat_activity
         WHERE application_name = 'warehouse14_test_sse'`;
      return Number.parseInt(r[0]!.count, 10) <= baseline;
    }, 5_000);
    expect(cleanedUp).toBe(true);
  });
});
