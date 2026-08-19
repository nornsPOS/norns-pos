/**
 * Phase-0 A — the appointments no-overlap EXCLUDE guard (migration 0069).
 *
 * Proves the DB-level invariant that fixes double-booking across ALL booking
 * paths (POS route, WhatsApp bot, storefront): a staff member cannot hold two
 * ACTIVE appointments whose [starts_at, ends_at) ranges overlap. The headline
 * test is a genuine RACE — two concurrent overlapping inserts on two separate
 * connections — asserting exactly one commits and the other raises SQLSTATE
 * 23P01 (exclusion_violation). Real Postgres via testcontainers.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyAllMigrations } from './_migrate.js';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

const DAY = '2026-07-01';
const at = (hhmm: string): string => `${DAY}T${hhmm}:00+02:00`;

/** Guard a RETURNING row that the INSERT guarantees — no bare `!`. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a seeded row');
  return v;
}

describe('appointments no-overlap EXCLUDE (migration 0069)', () => {
  let container: StartedPostgreSqlContainer;
  let sqlA: Sql;
  let sqlB: Sql;
  let staff1: string;
  let staff2: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();

    const conn = {
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      onnotice: () => {},
    };
    sqlA = postgres({ ...conn, max: 1 });
    await applyAllMigrations(sqlA);
    // A second, independent connection — required for a TRUE concurrent race.
    sqlB = postgres({ ...conn, max: 1 });
  }, 120_000);

  afterAll(async () => {
    await sqlA?.end({ timeout: 5 }).catch(() => {});
    await sqlB?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  beforeEach(async () => {
    // Clear appointments; users accumulate harmlessly (append-only ledger_events
    // reference them, so they can't be deleted — fresh unique emails each run).
    await sqlA`DELETE FROM appointments`;
    const [a] = await sqlA<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`s1-${randomUUID()}@x.test`}, 'Staff 1', 'ADMIN'::user_role) RETURNING id::text AS id`;
    const [b] = await sqlA<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`s2-${randomUUID()}@x.test`}, 'Staff 2', 'ADMIN'::user_role) RETURNING id::text AS id`;
    staff1 = must(a).id;
    staff2 = must(b).id;
  });

  function insert(sql: Sql, staffId: string, startHhmm: string, durationMin: number) {
    return sql`
      INSERT INTO appointments (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
      VALUES ('CONSULTATION'::appointment_type, ${at(startHhmm)}::timestamptz, ${durationMin},
              ${staffId}::uuid, 'pos')
      RETURNING id::text AS id`;
  }

  it('rejects an overlapping active appointment for the same staff (23P01)', async () => {
    await insert(sqlA, staff1, '10:00', 30); // 10:00–10:30
    await expect(insert(sqlA, staff1, '10:15', 30)).rejects.toMatchObject({ code: '23P01' });
  });

  it('allows an ADJACENT slot (half-open ranges do not overlap)', async () => {
    await insert(sqlA, staff1, '10:00', 30); // 10:00–10:30
    await expect(insert(sqlA, staff1, '10:30', 30)).resolves.toBeDefined(); // 10:30–11:00
  });

  it('allows the same instant for a DIFFERENT staff member', async () => {
    await insert(sqlA, staff1, '10:00', 30);
    await expect(insert(sqlA, staff2, '10:00', 30)).resolves.toBeDefined();
  });

  it('a CANCELLED appointment frees the slot', async () => {
    const [a] = (await insert(sqlA, staff1, '10:00', 30)) as unknown as Array<{ id: string }>;
    await sqlA`UPDATE appointments SET status='CANCELLED'::appointment_status, cancelled_at=now()
              WHERE id = ${must(a).id}::uuid`;
    await expect(insert(sqlA, staff1, '10:00', 30)).resolves.toBeDefined();
  });

  it('RACE: two concurrent overlapping inserts → exactly one wins, the other 23P01', async () => {
    const outcome = (p: Promise<unknown>) =>
      p.then(() => 'ok').catch((e: { code?: string }) => e.code ?? 'err');
    // Two SEPARATE connections fire overlapping inserts at the same instant.
    const [rA, rB] = await Promise.all([
      outcome(insert(sqlA, staff1, '11:00', 30)),
      outcome(insert(sqlB, staff1, '11:15', 30)),
    ]);
    const results = [rA, rB];
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === '23P01')).toHaveLength(1);
  });
});
