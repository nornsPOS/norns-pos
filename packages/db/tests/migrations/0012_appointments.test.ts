/**
 * Migration 0012 — Smart Appointment System (final keystone).
 *
 * Focused tests on the Day-10 directives:
 *   1. available_slots() basic correctness (returns slots within working hours)
 *   2. available_slots() DST correctness (slots respect Europe/Berlin local hours
 *      across the spring-forward and fall-back transitions)
 *   3. available_slots() excludes existing appointments + buffer
 *   4. available_slots() excludes shop_holidays + staff_time_off
 *   5. Auto-soft-hold trigger fires for VIEWING but NOT for other types
 *   6. State machine: valid + invalid transitions; terminal states are terminal
 *   7. Scheduling-field immutability after CHECKED_IN
 *   8. App role grants: no DELETE; narrow UPDATE
 *   9. Ledger event emission on every state change
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyChain } from '@norns/audit';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

describe('migration 0012_appointments — Smart Appointment System', () => {
  let testDb: TestDb;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;

  async function makeStaff(): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`s-${crypto.randomUUID()}@x.test`}, 'Staff', 'CASHIER'::user_role)
      RETURNING id`;
    return u.id;
  }

  async function makeCustomer(): Promise<string> {
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', 'test-pii-key-32b', true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Test'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    return c.id;
  }

  async function makeProduct(): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status,
              'INVESTMENT_GOLD_25C', 'gold_coin'::item_type, '100.00', '150.00', 'X', now())
      RETURNING id`;
    return p.id;
  }

  /** Standard Mon-Fri 09:00–17:00 working hours for a staff member. */
  async function seedWorkingHours(userId: string): Promise<void> {
    for (const weekday of [0, 1, 2, 3, 4]) {
      await migratorSql`
        INSERT INTO staff_working_hours (user_id, weekday, starts_at_local, ends_at_local, effective_from)
        VALUES (${userId}, ${weekday}, '09:00:00', '17:00:00', '2026-01-01'::date)`;
    }
  }

  /** Insert a SCHEDULED appointment via the migrator. */
  async function makeAppointment(opts: {
    staffId: string;
    customerId?: string;
    startsAt: Date;
    type?: 'VIEWING' | 'BUYBACK_EVAL' | 'CONSULTATION' | 'PICKUP';
    durationMinutes?: number;
    status?: 'SCHEDULED' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED';
  }): Promise<string> {
    const type = opts.type ?? 'VIEWING';
    const status = opts.status ?? 'SCHEDULED';
    const dur = opts.durationMinutes ?? 45;
    // For statuses past SCHEDULED we need to provide the markers.
    const checkedInAt =
      status === 'CHECKED_IN' || status === 'IN_PROGRESS' || status === 'COMPLETED'
        ? new Date()
        : null;
    const inProgressStartedAt =
      status === 'IN_PROGRESS' || status === 'COMPLETED' ? new Date() : null;
    const completedAt = status === 'COMPLETED' ? new Date() : null;
    const [a] = await migratorSql<{ id: string }[]>`
      INSERT INTO appointments (appointment_type, status, starts_at, duration_minutes,
                                customer_id, staff_user_id, booked_via,
                                checked_in_at, in_progress_started_at, completed_at)
      VALUES (${type}::appointment_type, ${status}::appointment_status,
              ${opts.startsAt}, ${dur},
              ${opts.customerId ?? null}, ${opts.staffId}, 'control_desktop',
              ${checkedInAt}, ${inProgressStartedAt}, ${completedAt})
      RETURNING id`;
    return a.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 12);
    await setAppPasswordForTest(migratorSql);

    appSql = postgres({
      host: testDb.container.getHost(),
      port: testDb.container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 5,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
  });

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. available_slots() basic correctness
  // ────────────────────────────────────────────────────────────────────

  describe('available_slots() — basic correctness', () => {
    it('produces slots within working hours, none outside', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // Monday 2026-06-01, search the whole day.
      const slots = await migratorSql<
        { staff_user_id: string; slot_starts_at: Date; slot_ends_at: Date }[]
      >`
        SELECT * FROM available_slots(
          'VIEWING'::appointment_type, 45,
          '2026-06-01 00:00:00+00'::timestamptz,
          '2026-06-02 00:00:00+00'::timestamptz,
          ${staffId}::uuid
        )`;
      expect(slots.length).toBeGreaterThan(0);

      // Every slot starts at 09:00 Berlin or later, ends by 17:00 Berlin.
      // 09:00 CEST in June = 07:00 UTC; 17:00 CEST = 15:00 UTC.
      for (const s of slots) {
        const startHourUtc = s.slot_starts_at.getUTCHours();
        const endHourUtc = s.slot_ends_at.getUTCHours();
        // In CEST (DST on), 09:00–17:00 local = 07:00–15:00 UTC.
        expect(startHourUtc).toBeGreaterThanOrEqual(7);
        expect(endHourUtc).toBeLessThanOrEqual(15);
        expect(s.staff_user_id).toBe(staffId);
      }
    });

    it('respects duration: longer duration → fewer slots fit', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      const short = await migratorSql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM available_slots(
          'VIEWING'::appointment_type, 30,
          '2026-06-01 00:00:00+00'::timestamptz,
          '2026-06-02 00:00:00+00'::timestamptz,
          ${staffId}::uuid)`;
      const long = await migratorSql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM available_slots(
          'VIEWING'::appointment_type, 180,
          '2026-06-01 00:00:00+00'::timestamptz,
          '2026-06-02 00:00:00+00'::timestamptz,
          ${staffId}::uuid)`;
      expect(Number.parseInt(long[0]!.count)).toBeLessThan(Number.parseInt(short[0]!.count));
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. DST correctness — spring-forward + fall-back
  // ────────────────────────────────────────────────────────────────────

  describe('available_slots() — DST correctness', () => {
    it('on a CEST day, 09:00 local = 07:00 UTC', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // 2026-06-15 is a Monday, CEST (UTC+2). 09:00 CEST = 07:00 UTC.
      const slots = await migratorSql<{ slot_starts_at: Date }[]>`
        SELECT slot_starts_at FROM available_slots(
          'VIEWING'::appointment_type, 45,
          '2026-06-15 00:00:00+00'::timestamptz,
          '2026-06-15 23:59:00+00'::timestamptz,
          ${staffId}::uuid)
        ORDER BY slot_starts_at LIMIT 1`;
      expect(slots.length).toBe(1);
      expect(slots[0]!.slot_starts_at.toISOString()).toBe('2026-06-15T07:00:00.000Z');
    });

    it('on a CET day, 09:00 local = 08:00 UTC', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // 2026-01-12 is a Monday, CET (UTC+1). 09:00 CET = 08:00 UTC.
      const slots = await migratorSql<{ slot_starts_at: Date }[]>`
        SELECT slot_starts_at FROM available_slots(
          'VIEWING'::appointment_type, 45,
          '2026-01-12 00:00:00+00'::timestamptz,
          '2026-01-12 23:59:00+00'::timestamptz,
          ${staffId}::uuid)
        ORDER BY slot_starts_at LIMIT 1`;
      expect(slots.length).toBe(1);
      expect(slots[0]!.slot_starts_at.toISOString()).toBe('2026-01-12T08:00:00.000Z');
    });

    it('spring-forward day (2026-03-30 Mon) — 09:00 local = 07:00 UTC (DST already on)', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // 2026-03-29 (Sun) is the DST switch. Monday 2026-03-30 is fully in CEST.
      const slots = await migratorSql<{ slot_starts_at: Date }[]>`
        SELECT slot_starts_at FROM available_slots(
          'VIEWING'::appointment_type, 45,
          '2026-03-30 00:00:00+00'::timestamptz,
          '2026-03-30 23:59:00+00'::timestamptz,
          ${staffId}::uuid)
        ORDER BY slot_starts_at LIMIT 1`;
      expect(slots[0]!.slot_starts_at.toISOString()).toBe('2026-03-30T07:00:00.000Z');
    });

    it('fall-back day (2026-10-26 Mon) — 09:00 local = 08:00 UTC (back in CET)', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // 2026-10-25 (Sun) is the DST switch back. Monday 2026-10-26 is fully in CET.
      const slots = await migratorSql<{ slot_starts_at: Date }[]>`
        SELECT slot_starts_at FROM available_slots(
          'VIEWING'::appointment_type, 45,
          '2026-10-26 00:00:00+00'::timestamptz,
          '2026-10-26 23:59:00+00'::timestamptz,
          ${staffId}::uuid)
        ORDER BY slot_starts_at LIMIT 1`;
      expect(slots[0]!.slot_starts_at.toISOString()).toBe('2026-10-26T08:00:00.000Z');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. available_slots() excludes existing appointments
  // ────────────────────────────────────────────────────────────────────

  describe('available_slots() — exclusions', () => {
    it('excludes time slots overlapping live appointments', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // Book an appointment Monday 2026-06-08 from 10:00–11:00 CEST (08:00 UTC).
      await makeAppointment({
        staffId,
        startsAt: new Date('2026-06-08T08:00:00Z'),
        durationMinutes: 60,
      });

      const slots = await migratorSql<{ slot_starts_at: Date }[]>`
        SELECT slot_starts_at FROM available_slots(
          'VIEWING'::appointment_type, 30,
          '2026-06-08 00:00:00+00'::timestamptz,
          '2026-06-08 23:59:00+00'::timestamptz,
          ${staffId}::uuid)`;

      // No slot should overlap [10:00, 11:00] Berlin (08:00–09:00 UTC).
      // With 5-minute buffer (for VIEWING), the exclusion is [09:55, 11:05] Berlin = [07:55, 09:05] UTC.
      for (const s of slots) {
        const ms = s.slot_starts_at.getTime();
        const endMs = ms + 30 * 60_000;
        const bufStart = new Date('2026-06-08T07:55:00Z').getTime();
        const bufEnd = new Date('2026-06-08T09:05:00Z').getTime();
        const overlap = ms < bufEnd && endMs > bufStart;
        expect(overlap, `slot ${s.slot_starts_at.toISOString()} overlaps buffer`).toBe(false);
      }
    });

    it('excludes shop_holidays', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // Mark 2026-06-15 as a holiday.
      await migratorSql`
        INSERT INTO shop_holidays (closed_date, reason) VALUES ('2026-06-15'::date, 'Test holiday')`;

      const slots = await migratorSql<{ slot_starts_at: Date }[]>`
        SELECT slot_starts_at FROM available_slots(
          'VIEWING'::appointment_type, 45,
          '2026-06-15 00:00:00+00'::timestamptz,
          '2026-06-15 23:59:00+00'::timestamptz,
          ${staffId}::uuid)`;
      expect(slots.length).toBe(0);
    });

    it('excludes staff_time_off windows', async () => {
      const staffId = await makeStaff();
      await seedWorkingHours(staffId);

      // Staff is off 2026-07-06 09:00–17:00 UTC (covers full Berlin workday).
      await migratorSql`
        INSERT INTO staff_time_off (user_id, starts_at, ends_at, reason)
        VALUES (${staffId}, '2026-07-06 00:00:00+00'::timestamptz, '2026-07-06 23:59:00+00'::timestamptz, 'Vacation')`;

      const slots = await migratorSql<{ slot_starts_at: Date }[]>`
        SELECT slot_starts_at FROM available_slots(
          'VIEWING'::appointment_type, 45,
          '2026-07-06 00:00:00+00'::timestamptz,
          '2026-07-06 23:59:00+00'::timestamptz,
          ${staffId}::uuid)`;
      expect(slots.length).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Auto-soft-hold trigger
  // ────────────────────────────────────────────────────────────────────

  describe('auto-soft-hold trigger', () => {
    it('linking a product to a VIEWING appointment auto-creates a SOFT hold', async () => {
      const staffId = await makeStaff();
      const customerId = await makeCustomer();
      const productId = await makeProduct();
      const apptId = await makeAppointment({
        staffId,
        customerId,
        type: 'VIEWING',
        startsAt: new Date(Date.now() + 24 * 60 * 60_000),
      });

      // Link the product.
      await appSql`
        INSERT INTO appointment_linked_products (appointment_id, product_id)
        VALUES (${apptId}, ${productId})`;

      // Hold must exist.
      const holds = await migratorSql<
        {
          hold_strength: string;
          hold_starts_at: Date;
          hold_expires_at: Date;
        }[]
      >`
        SELECT hold_strength, hold_starts_at, hold_expires_at
          FROM product_viewing_holds
         WHERE product_id = ${productId} AND appointment_id = ${apptId}`;
      expect(holds).toHaveLength(1);
      expect(holds[0]!.hold_strength).toBe('SOFT');
      // Expiry = appt_start + 30min.
      const [{ ends }] = await migratorSql<{ ends: Date }[]>`
        SELECT (starts_at + interval '30 minutes') AS ends FROM appointments WHERE id = ${apptId}`;
      expect(holds[0]!.hold_expires_at.getTime()).toBe(ends.getTime());
    });

    it('linking a product to a non-VIEWING appointment does NOT create a hold', async () => {
      const staffId = await makeStaff();
      const productId = await makeProduct();
      const apptId = await makeAppointment({
        staffId,
        type: 'CONSULTATION',
        startsAt: new Date(Date.now() + 24 * 60 * 60_000),
      });

      await appSql`
        INSERT INTO appointment_linked_products (appointment_id, product_id)
        VALUES (${apptId}, ${productId})`;

      const holds = await migratorSql<{ count: string }[]>`
        SELECT COUNT(*)::text AS count FROM product_viewing_holds
         WHERE appointment_id = ${apptId}`;
      expect(holds[0]!.count).toBe('0');
    });

    it('hold starts at least 1 hour before appointment (when appt is far in future)', async () => {
      const staffId = await makeStaff();
      const productId = await makeProduct();
      const farFuture = new Date(Date.now() + 7 * 24 * 60 * 60_000); // 1 week ahead
      const apptId = await makeAppointment({
        staffId,
        type: 'VIEWING',
        startsAt: farFuture,
      });
      await appSql`
        INSERT INTO appointment_linked_products (appointment_id, product_id)
        VALUES (${apptId}, ${productId})`;

      const [hold] = await migratorSql<{ hold_starts_at: Date }[]>`
        SELECT hold_starts_at FROM product_viewing_holds WHERE appointment_id = ${apptId}`;
      // hold_starts_at = appt_start - 1h (since appt is far in future, "now" never wins)
      const expected = new Date(farFuture.getTime() - 60 * 60_000);
      // Allow 5-second wiggle for trigger timing.
      expect(Math.abs(hold.hold_starts_at.getTime() - expected.getTime())).toBeLessThan(5000);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. State machine
  // ────────────────────────────────────────────────────────────────────

  describe('state machine', () => {
    it('valid transitions: SCHEDULED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED', async () => {
      const staffId = await makeStaff();
      const apptId = await makeAppointment({
        staffId,
        startsAt: new Date(Date.now() + 24 * 60 * 60_000),
      });

      await appSql`UPDATE appointments SET status='CONFIRMED'::appointment_status, confirmed_at=now() WHERE id=${apptId}`;
      await appSql`UPDATE appointments SET status='CHECKED_IN'::appointment_status, checked_in_at=now() WHERE id=${apptId}`;
      await appSql`UPDATE appointments SET status='IN_PROGRESS'::appointment_status, in_progress_started_at=now() WHERE id=${apptId}`;
      await appSql`UPDATE appointments SET status='COMPLETED'::appointment_status, completed_at=now() WHERE id=${apptId}`;

      const [final] = await migratorSql<
        { status: string }[]
      >`SELECT status FROM appointments WHERE id=${apptId}`;
      expect(final.status).toBe('COMPLETED');
    });

    it('terminal state cannot transition out (COMPLETED → SCHEDULED rejected)', async () => {
      const staffId = await makeStaff();
      const apptId = await makeAppointment({
        staffId,
        status: 'COMPLETED',
        startsAt: new Date(Date.now() - 60 * 60_000),
      });
      await expect(
        appSql`UPDATE appointments SET status='SCHEDULED'::appointment_status WHERE id=${apptId}`,
      ).rejects.toThrow(/Cannot transition out of terminal/i);
    });

    it('SCHEDULED → IN_PROGRESS is rejected (must go via CHECKED_IN)', async () => {
      const staffId = await makeStaff();
      const apptId = await makeAppointment({
        staffId,
        startsAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
      await expect(
        appSql`UPDATE appointments SET status='IN_PROGRESS'::appointment_status, in_progress_started_at=now() WHERE id=${apptId}`,
      ).rejects.toThrow(/Invalid appointment status transition/);
    });

    it('scheduling fields are LOCKED after CHECKED_IN', async () => {
      const staffId = await makeStaff();
      const apptId = await makeAppointment({
        staffId,
        status: 'CHECKED_IN',
        startsAt: new Date(Date.now() - 60 * 60_000),
      });
      await expect(
        appSql`UPDATE appointments SET starts_at=now() + interval '1 day' WHERE id=${apptId}`,
      ).rejects.toThrow(/Cannot modify scheduling fields after check-in/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. App grants
  // ────────────────────────────────────────────────────────────────────

  describe('app grants', () => {
    it.each([
      'appointments',
      'appointment_linked_products',
      'product_viewing_holds',
      'staff_working_hours',
      'staff_time_off',
      'shop_holidays',
    ])('%s — app cannot DELETE', async (tbl) => {
      const [row] = await migratorSql<{ has: boolean }[]>`
          SELECT has_table_privilege('warehouse14_app', ${tbl}, 'DELETE') AS has`;
      expect(row.has).toBe(false);
    });

    it('app cannot UPDATE appointment_linked_products (INSERT only)', async () => {
      const [row] = await migratorSql<{ has: boolean }[]>`
        SELECT has_table_privilege('warehouse14_app', 'appointment_linked_products', 'UPDATE') AS has`;
      expect(row.has).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. Ledger emission + chain integrity
  // ────────────────────────────────────────────────────────────────────

  describe('ledger emission', () => {
    it('emits appointment.scheduled on INSERT and appointment.<status> on each transition', async () => {
      const staffId = await makeStaff();
      const apptId = await makeAppointment({
        staffId,
        startsAt: new Date(Date.now() + 24 * 60 * 60_000),
      });

      await appSql`UPDATE appointments SET status='CONFIRMED'::appointment_status, confirmed_at=now() WHERE id=${apptId}`;
      await appSql`UPDATE appointments SET status='CHECKED_IN'::appointment_status, checked_in_at=now() WHERE id=${apptId}`;

      const events = await migratorSql<{ event_type: string }[]>`
        SELECT event_type FROM ledger_events
         WHERE entity_table = 'appointments' AND entity_id = ${apptId}
         ORDER BY id`;
      expect(events.map((e) => e.event_type)).toEqual([
        'appointment.scheduled',
        'appointment.confirmed',
        'appointment.checked_in',
      ]);

      const chain = await verifyChain(appDb);
      expect(chain.valid).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. Trigger ownership
  // ────────────────────────────────────────────────────────────────────

  describe('trigger ownership', () => {
    it.each(['create_viewing_hold_on_link', 'on_appointment_state_event'])(
      '%s is SECURITY DEFINER owned by warehouse14_security',
      async (fn) => {
        const [row] = await migratorSql<{ owner: string; sec_def: boolean }[]>`
          SELECT pg_get_userbyid(proowner) AS owner, prosecdef AS sec_def
            FROM pg_proc WHERE proname = ${fn}`;
        expect(row.owner).toBe('warehouse14_security');
        expect(row.sec_def).toBe(true);
      },
    );
  });
});
