/**
 * Phase-2 P1.2 — the inbound Google calendar-pull is idempotent + race-safe.
 *
 * Before this fix the import used a bare `ON CONFLICT DO NOTHING` with NO unique
 * index on `google_event_id`, so the conflict clause only ever arbiter'd on the
 * PK (which never conflicts for a fresh row). Two overlapping 15s poll ticks — or
 * a poll racing the outbound mirror — could import the SAME Google event twice.
 *
 * Migration 0070 adds UNIQUE(google_event_id); the import is now `ON CONFLICT
 * (google_event_id) DO NOTHING` inside a transaction. This proves, against real
 * Postgres, that a repeated pull of the same event creates exactly ONE row, and
 * that a Google event landing on a slot held by another staff appointment is
 * skipped cleanly (23P01 from the no-overlap EXCLUDE, not a thrown pass).
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyAllMigrations } from './_migrate.js';

// Control the Google API responses without touching the network.
const h = vi.hoisted(() => ({
  result: {
    events: [] as Array<{
      id: string;
      status: string;
      startIso: string | null;
      endIso: string | null;
      summary: string | null;
      description: string | null;
      created: string | null;
    }>,
    nextSyncToken: null as string | null,
    fullResyncNeeded: false,
  },
}));

vi.mock('../../src/lib/google-calendar.js', () => ({
  calendarConfigured: () => true,
  syncEvents: async () => h.result,
}));

// Imported AFTER the mock is declared so the mock is in effect.
const { runCalendarPull } = await import('../../src/lib/calendar-pull.js');

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

const noopLog = { info() {}, error() {} };

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a row');
  return v;
}

describe('calendar-pull idempotency (migration 0070)', () => {
  let container: StartedPostgreSqlContainer;
  let sql: Sql;
  let db: AppDb;
  let staffId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();
    sql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
      connection: { options: '-c check_function_bodies=off' },
    });
    await applyAllMigrations(sql);
    db = drizzle(sql, { schema }) as unknown as AppDb;

    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, name, role, is_owner)
      VALUES (${`cal-${randomUUID()}@x.test`}, 'Cal Staff', 'ADMIN'::user_role, true)
      RETURNING id::text AS id`;
    staffId = must(u).id;
  }, 120_000);

  afterAll(async () => {
    await sql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  beforeEach(async () => {
    await sql`DELETE FROM appointments`;
    h.result = { events: [], nextSyncToken: null, fullResyncNeeded: false };
  });

  function googleEvent(id: string, startIso: string, durationMin = 30) {
    const endIso = new Date(new Date(startIso).getTime() + durationMin * 60_000).toISOString();
    return {
      id,
      status: 'confirmed',
      startIso,
      endIso,
      summary: 'Beratung (Google)',
      description: null,
      created: null,
    };
  }

  it('imports a new Google event exactly once across repeated pulls', async () => {
    h.result.events = [googleEvent('evt-aaa', '2026-08-01T08:00:00.000Z')];

    await runCalendarPull(db, noopLog);
    await runCalendarPull(db, noopLog); // second tick — must NOT duplicate

    const rows = await sql<{ id: string; source: string; bookedVia: string }[]>`
      SELECT id::text AS id, source::text AS source, booked_via AS "bookedVia"
      FROM appointments WHERE google_event_id = 'evt-aaa'`;
    expect(rows).toHaveLength(1);
    expect(must(rows[0]).source).toBe('GOOGLE');
    expect(must(rows[0]).bookedVia).toBe('google_calendar');
  });

  it('is a clean no-op when the same event id already exists (cross-poller race)', async () => {
    // Simulate the outbound mirror having linked this event id onto an existing
    // appointment between the pull's batched read and its import.
    await sql`
      INSERT INTO appointments
        (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via, source, google_event_id)
      VALUES ('CONSULTATION'::appointment_type, '2026-08-02T09:00:00.000Z'::timestamptz, 30,
              ${staffId}::uuid, 'pos', 'POS', 'evt-bbb')`;

    h.result.events = [googleEvent('evt-bbb', '2026-08-02T09:00:00.000Z')];
    await runCalendarPull(db, noopLog);

    const rows = await sql`SELECT id FROM appointments WHERE google_event_id = 'evt-bbb'`;
    expect(rows).toHaveLength(1); // still exactly one — the import no-op'd
  });

  it('skips an import cleanly when the slot is held by another staff appointment (23P01)', async () => {
    // A non-Google appointment already occupies the fallback staff's 10:00 slot.
    await sql`
      INSERT INTO appointments
        (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
      VALUES ('CONSULTATION'::appointment_type, '2026-08-03T10:00:00.000Z'::timestamptz, 30,
              ${staffId}::uuid, 'pos')`;

    // Google sends an event at the same instant → import would hit the no-overlap
    // EXCLUDE (0069) → 23P01 → the pull must skip it, not throw.
    h.result.events = [googleEvent('evt-ccc', '2026-08-03T10:00:00.000Z')];
    await expect(runCalendarPull(db, noopLog)).resolves.toBeUndefined();

    const rows = await sql`SELECT id FROM appointments WHERE google_event_id = 'evt-ccc'`;
    expect(rows).toHaveLength(0); // not imported (slot taken), but no crash
  });
});
