/**
 * Migration 0070 — UNIQUE(google_event_id) on appointments.
 *
 * The inbound Google calendar-pull imports an event with `ON CONFLICT
 * (google_event_id) DO NOTHING`. Before 0070 there was NO unique index on
 * `google_event_id`, so that conflict clause could only arbiter on the PK
 * (which never conflicts for a fresh row) → duplicate imports were possible.
 *
 * RED  (at 0069): two appointments may share the same non-null google_event_id.
 * GREEN (at 0070): the second insert raises 23505 (unique_violation); the
 *        migration first de-duplicates any pre-existing dupes (keep the oldest,
 *        NULL the rest — never DELETE) so it succeeds on a dirty live DB; NULLs
 *        remain distinct so unsynced rows are unaffected.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  splitSqlStatements,
  startTestDb,
} from '../helpers/testDb.js';

function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('query returned no rows');
  return row;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Apply ONE migration file by name (psql -f semantics — one statement at a time). */
async function applyOneMigration(sql: Sql, file: string): Promise<void> {
  const text = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
  for (const statement of splitSqlStatements(text)) {
    await sql.unsafe(statement);
  }
}

/** Insert a minimal appointment; returns its id. */
async function insertAppt(
  sql: Sql,
  staffId: string,
  startIso: string,
  googleEventId: string | null,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO appointments
      (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via, google_event_id)
    VALUES ('CONSULTATION'::appointment_type, ${startIso}::timestamptz, 30,
            ${staffId}::uuid, 'google_calendar', ${googleEventId})
    RETURNING id::text AS id`;
  return must(row).id;
}

async function seedStaff(sql: Sql): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, name, role)
    VALUES (${`gcal-${crypto.randomUUID()}@x.test`}, 'Cal', 'ADMIN'::user_role)
    RETURNING id::text AS id`;
  return must(row).id;
}

describe('migration 0070 — appointments UNIQUE(google_event_id)', () => {
  let db: TestDb;
  let sql: Sql;

  beforeAll(async () => {
    db = await startTestDb();
    sql = db.migratorSql;
    await applyMigrations(sql, 69); // stop ONE before the migration under test
  }, 120_000);

  afterAll(async () => {
    await db?.cleanup();
  });

  it('RED at 0069: a duplicate google_event_id is allowed (no unique index)', async () => {
    const staff = await seedStaff(sql);
    await insertAppt(sql, staff, '2026-07-01T10:00:00+02:00', 'evt-dup-pre');
    // Pre-index this is permitted — the very bug.
    await expect(
      insertAppt(sql, staff, '2026-07-01T11:00:00+02:00', 'evt-dup-pre'),
    ).resolves.toBeDefined();
  });

  it('GREEN at 0070: de-dups existing rows (keep oldest) then enforces uniqueness', async () => {
    // Two rows share `evt-dup-pre` from the previous step → the migration's CTE
    // must keep exactly one (the oldest) and NULL the other.
    await applyOneMigration(sql, '0070_appointment_google_event_unique.sql');

    const dupes = await sql<{ id: string }[]>`
      SELECT id::text AS id FROM appointments WHERE google_event_id = 'evt-dup-pre'`;
    expect(dupes).toHaveLength(1); // oldest kept, newer detached to NULL

    // The unique index now exists and is unique.
    const idx = await sql<{ indisunique: boolean }[]>`
      SELECT i.indisunique FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
      WHERE c.relname = 'appointments_google_event_id_uq'`;
    expect(must(idx[0]).indisunique).toBe(true);

    // A fresh duplicate is now rejected.
    const staff = await seedStaff(sql);
    await insertAppt(sql, staff, '2026-07-02T10:00:00+02:00', 'evt-unique');
    await expect(
      insertAppt(sql, staff, '2026-07-02T11:00:00+02:00', 'evt-unique'),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('allows many NULL google_event_id rows (NULLs are distinct)', async () => {
    const staff = await seedStaff(sql);
    await insertAppt(sql, staff, '2026-07-03T10:00:00+02:00', null);
    await expect(insertAppt(sql, staff, '2026-07-03T12:00:00+02:00', null)).resolves.toBeDefined();
  });
});
