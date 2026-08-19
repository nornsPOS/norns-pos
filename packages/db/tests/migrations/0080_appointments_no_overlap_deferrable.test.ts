/**
 * Migration 0080 — DEFERRABLE appointment no-overlap constraint.
 *
 * The reschedule flow must insert the clone BEFORE it can flip the original to
 * RESCHEDULED (the has-link CHECK needs the clone id). With the IMMEDIATE EXCLUDE
 * from 0069 the clone INSERT collides with the still-active original whenever the
 * new time overlaps the old one, so a near-time reschedule (the common case)
 * always failed. 0080 recreates the constraint DEFERRABLE INITIALLY IMMEDIATE so
 * the reschedule transaction can `SET CONSTRAINTS ... DEFERRED` and let the check
 * run at COMMIT, after the original is out of the constraint's set.
 *
 * RED (at 0069..0079): the reschedule sequence (clone overlapping the still-active
 *   original) raises 23P01, and the constraint is not deferrable.
 * GREEN (at 0080): the deferred reschedule sequence commits; a genuine overlap
 *   with a DIFFERENT active appointment still fails at COMMIT; a normal booking
 *   overlap still fails immediately (default unchanged).
 */

import crypto from 'node:crypto';
import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('query returned no rows');
  return row;
}

async function makeStaff(sql: Sql): Promise<string> {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (email, name, role)
    VALUES (${`staff-${crypto.randomUUID()}@x.test`}, 'Staff', 'CASHIER'::user_role)
    RETURNING id`;
  return must(u).id;
}

/** Insert an ACTIVE appointment at a fixed instant; returns its id. */
async function insertAppt(sql: Sql, staffId: string, startsAt: string, mins = 60): Promise<string> {
  const [a] = await sql<{ id: string }[]>`
    INSERT INTO appointments (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
    VALUES ('CONSULTATION'::appointment_type, ${startsAt}::timestamptz, ${mins}, ${staffId}, 'pos')
    RETURNING id`;
  return must(a).id;
}

describe('migration 0080 — DEFERRABLE appointment no-overlap', () => {
  describe('RED — at 0079 the reschedule clone self-collides with the active original', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 79);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('a second active appointment overlapping the original (same staff) is rejected', async () => {
      const staff = await makeStaff(sql);
      await insertAppt(sql, staff, '2026-06-10T10:00:00Z', 60);
      // The reschedule clone would sit at an overlapping time while the original
      // is still ACTIVE — exactly what fails today.
      await expect(insertAppt(sql, staff, '2026-06-10T10:30:00Z', 60)).rejects.toThrow(
        /appointments_no_staff_overlap|exclusion/i,
      );
    });

    it('the constraint is NOT yet deferrable', async () => {
      await expect(
        sql`SET CONSTRAINTS appointments_no_staff_overlap DEFERRED`,
      ).rejects.toThrow(/is not deferrable/i);
    });
  });

  describe('GREEN — at 0080 the deferred reschedule sequence commits', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 80);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('reschedule to an overlapping time (vacating the original) succeeds', async () => {
      const staff = await makeStaff(sql);
      const origId = await insertAppt(sql, staff, '2026-06-11T10:00:00Z', 60);

      await sql.begin(async (tx) => {
        await tx`SET CONSTRAINTS appointments_no_staff_overlap DEFERRED`;
        const [clone] = await tx<{ id: string }[]>`
          INSERT INTO appointments (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via, rescheduled_from_appointment_id)
          VALUES ('CONSULTATION'::appointment_type, '2026-06-11T10:30:00Z'::timestamptz, 60, ${staff}, 'pos', ${origId}::uuid)
          RETURNING id`;
        const cloneId = must(clone).id;
        await tx`UPDATE appointments SET rescheduled_to_appointment_id = ${cloneId}::uuid WHERE id = ${origId}::uuid`;
        await tx`UPDATE appointments SET status = 'RESCHEDULED', cancellation_reason = 'rescheduled' WHERE id = ${origId}::uuid`;
      });

      const [orig] = await sql<{ status: string }[]>`
        SELECT status::text AS status FROM appointments WHERE id = ${origId}::uuid`;
      expect(orig?.status).toBe('RESCHEDULED');
      const [active] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM appointments
         WHERE staff_user_id = ${staff}::uuid AND status NOT IN ('CANCELLED','NO_SHOW','RESCHEDULED')`;
      expect(active?.n).toBe(1); // only the clone remains active
    });

    it('reschedule that overlaps a DIFFERENT active appointment still fails at COMMIT', async () => {
      const staff = await makeStaff(sql);
      const aId = await insertAppt(sql, staff, '2026-06-12T10:00:00Z', 60);
      await insertAppt(sql, staff, '2026-06-12T12:00:00Z', 60); // B, stays active

      await expect(
        sql.begin(async (tx) => {
          await tx`SET CONSTRAINTS appointments_no_staff_overlap DEFERRED`;
          const [clone] = await tx<{ id: string }[]>`
            INSERT INTO appointments (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via, rescheduled_from_appointment_id)
            VALUES ('CONSULTATION'::appointment_type, '2026-06-12T12:30:00Z'::timestamptz, 60, ${staff}, 'pos', ${aId}::uuid)
            RETURNING id`;
          const cloneId = must(clone).id;
          await tx`UPDATE appointments SET rescheduled_to_appointment_id = ${cloneId}::uuid WHERE id = ${aId}::uuid`;
          await tx`UPDATE appointments SET status = 'RESCHEDULED', cancellation_reason = 'rescheduled' WHERE id = ${aId}::uuid`;
          // COMMIT here: the clone (12:30-13:30) overlaps B (12:00-13:00), both active.
        }),
      ).rejects.toThrow(/appointments_no_staff_overlap|exclusion/i);
    });

    it('a normal booking overlap still fails immediately (default IMMEDIATE unchanged)', async () => {
      const staff = await makeStaff(sql);
      await insertAppt(sql, staff, '2026-06-13T09:00:00Z', 60);
      await expect(insertAppt(sql, staff, '2026-06-13T09:30:00Z', 60)).rejects.toThrow(
        /appointments_no_staff_overlap|exclusion/i,
      );
    });
  });
});
