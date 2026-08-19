/**
 * Appointments — booking transaction + status-transition integration (ADR-0020).
 *
 * Exercises the REAL database objects from migration 0012 + 0038:
 *   ✓ available_slots() returns a slot inside seeded working hours,
 *   ✓ booking inserts an appointment (ends_at computed by trigger) + emits a
 *     ledger event (AFTER INSERT trigger),
 *   ✓ linking a VIEWING product auto-creates a product_viewing_holds row,
 *   ✓ the reminder cadence lands in appointment_notifications,
 *   ✓ SCHEDULED → CONFIRMED → CHECKED_IN transitions succeed (trigger-validated),
 *   ✓ an illegal transition (SCHEDULED → COMPLETED) is rejected by the trigger.
 *
 * NOTE: requires a Postgres testcontainer (Docker) + extensions — CI only, same
 * as every api-cloud integration test.
 */

import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import { computeReminderSchedule } from '@norns/appointments';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT SUPERUSER CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAll(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

function one<T>(rows: T[]): T {
  const r = rows[0];
  if (!r) throw new Error('query produced no row');
  return r;
}

describe('appointments — booking + transition (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let staffId: string;
  let customerId: string;
  let productId: string;

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

    staffId = one(
      await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`staff-${randomUUID()}@x.test`}, 'Staff', 'CASHIER'::user_role)
        RETURNING id`,
    ).id;

    // Working hours for every weekday, wide window so any future date works.
    for (let weekday = 0; weekday <= 6; weekday++) {
      await migratorSql`
        INSERT INTO staff_working_hours (user_id, weekday, starts_at_local, ends_at_local, effective_from)
        VALUES (${staffId}::uuid, ${weekday}, '08:00', '20:00', (now() - interval '1 day')::date)`;
    }

    productId = one(
      await migratorSql<{ id: string }[]>`
        INSERT INTO products (sku, status, tax_treatment_code, item_type, acquisition_cost_eur, list_price_eur, name)
        VALUES (${`SKU-${randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
                'gold_jewelry'::item_type, '50.00', '150.00', 'Test ring')
        RETURNING id`,
    ).id;

    customerId = one(
      await migratorSql<{ id: string }[]>`
        WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
        INSERT INTO customers (full_name_encrypted, retention_until)
        SELECT encrypt_pii('Termin Kunde'), (now() + interval '5 years')::date FROM s
        RETURNING id`,
    ).id;
  }, 120_000);

  afterAll(async () => {
    await migratorSql?.end({ timeout: 5 }).catch(() => {});
    await container?.stop().catch(() => {});
  });

  // A slot ~3 days out at 10:00 UTC (inside the 08-20 Berlin window).
  const startsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  startsAt.setUTCHours(10, 0, 0, 0);

  /**
   * ⚠️ EIN MITARBEITER, EINE ZEIT. Jede Pruefung braucht ihren eigenen Platz.
   *
   * Wanderung 0069 haengt einen Ausschluss an `appointments`: derselbe
   * Mitarbeiter darf keine zwei aktiven Termine haben, deren Zeitspannen sich
   * beruehren. Wanderung 0080 macht ihn aufschiebbar, aber die Vorgabe prueft
   * weiterhin sofort.
   *
   * Der Riegel ist richtig, ein Mensch kann nicht an zwei Orten sein. Nur
   * legte diese Buehne ALLE vier Termine auf denselben Zeitpunkt und
   * denselben Mitarbeiter, weil sie aus der Zeit vor dem Ausschluss stammt.
   * Also bekommt jede Pruefung ihre eigene volle Stunde. Der laengste Termin
   * hier dauert 45 Minuten, eine Stunde Abstand traegt ihn.
   *
   * Alle Zeiten bleiben im Arbeitsfenster 08 bis 20 Uhr, das oben gesaet wird.
   */
  function eigenerPlatz(stundenVersatz: number): string {
    return new Date(startsAt.getTime() + stundenVersatz * 60 * 60 * 1000).toISOString();
  }

  it('available_slots() returns the requested slot', async () => {
    const to = new Date(startsAt.getTime() + 60 * 60 * 1000);
    const rows = await migratorSql<{ slot_starts_at: string }[]>`
      SELECT slot_starts_at::text AS slot_starts_at
      FROM available_slots('VIEWING'::appointment_type, 30,
        ${startsAt.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz,
        ${staffId}::uuid, NULL::uuid)
      WHERE staff_user_id = ${staffId}::uuid`;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('books an appointment: ends_at computed, ledger emitted, hold + reminders created', async () => {
    const appt = one(
      await migratorSql<{ id: string; ends_at: string; status: string }[]>`
        INSERT INTO appointments
          (appointment_type, starts_at, duration_minutes, customer_id, staff_user_id, booked_via)
        VALUES ('VIEWING'::appointment_type, ${startsAt.toISOString()}::timestamptz, 30,
                ${customerId}::uuid, ${staffId}::uuid, 'pos')
        RETURNING id, ends_at::text AS ends_at, status::text AS status`,
    );
    const apptId = appt.id;
    expect(appt.status).toBe('SCHEDULED');
    expect(new Date(appt.ends_at).getTime()).toBe(startsAt.getTime() + 30 * 60 * 1000);

    const ledger = await migratorSql<{ event_type: string }[]>`
      SELECT event_type FROM ledger_events WHERE entity_id = ${apptId}::uuid`;
    expect(ledger.some((l) => l.event_type === 'appointment.scheduled')).toBe(true);

    await migratorSql`
      INSERT INTO appointment_linked_products (appointment_id, product_id)
      VALUES (${apptId}::uuid, ${productId}::uuid)`;
    const holds = await migratorSql<{ id: string }[]>`
      SELECT id FROM product_viewing_holds WHERE appointment_id = ${apptId}::uuid AND released_at IS NULL`;
    expect(holds.length).toBe(1);

    const reminders = computeReminderSchedule({
      startsAt,
      recipientEmail: 'kunde@example.de',
      recipientPhone: '+491700000000',
    });
    for (const r of reminders) {
      await migratorSql`
        INSERT INTO appointment_notifications
          (appointment_id, notification_type, channel, recipient, template_id, scheduled_for)
        VALUES (${apptId}::uuid, ${r.notificationType}, ${r.channel}, ${r.recipient},
                ${r.templateId ?? null}, ${r.scheduledFor.toISOString()}::timestamptz)`;
    }
    const notif = await migratorSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM appointment_notifications WHERE appointment_id = ${apptId}::uuid`;
    expect(one(notif).n).toBe(reminders.length);
  });

  it('SCHEDULED → CONFIRMED → CHECKED_IN succeeds', async () => {
    const id = one(
      await migratorSql<{ id: string }[]>`
        INSERT INTO appointments
          (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
        VALUES ('CONSULTATION'::appointment_type, ${eigenerPlatz(1)}::timestamptz, 30,
                ${staffId}::uuid, 'pos')
        RETURNING id`,
    ).id;

    await migratorSql`UPDATE appointments SET status = 'CONFIRMED', confirmed_at = now() WHERE id = ${id}::uuid`;
    await migratorSql`UPDATE appointments SET status = 'CHECKED_IN', checked_in_at = now() WHERE id = ${id}::uuid`;
    const row = one(
      await migratorSql<{ status: string }[]>`
        SELECT status::text AS status FROM appointments WHERE id = ${id}::uuid`,
    );
    expect(row.status).toBe('CHECKED_IN');
  });

  it('notes-only edit (PATCH without status): same-status UPDATE of staff_notes passes the trigger and the app role holds the grant', async () => {
    const id = one(
      await migratorSql<{ id: string }[]>`
        INSERT INTO appointments
          (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
        VALUES ('BUYBACK_EVAL'::appointment_type, ${eigenerPlatz(2)}::timestamptz, 45,
                ${staffId}::uuid, 'pos')
        RETURNING id`,
    ).id;

    // The Termine drawer's note edit is a status-less PATCH → an UPDATE that
    // keeps status unchanged. The 0012 §9 trigger must let it through without
    // re-stamping any marker column.
    await migratorSql`UPDATE appointments SET staff_notes = 'Kunde bringt Konvolut mit' WHERE id = ${id}::uuid`;
    const row = one(
      await migratorSql<{ status: string; staff_notes: string; confirmed_at: string | null }[]>`
        SELECT status::text AS status, staff_notes, confirmed_at::text AS confirmed_at
        FROM appointments WHERE id = ${id}::uuid`,
    );
    expect(row.status).toBe('SCHEDULED');
    expect(row.staff_notes).toBe('Kunde bringt Konvolut mit');
    expect(row.confirmed_at).toBeNull();

    // The api runs as warehouse14_app — the column-level UPDATE grant from
    // 0012 must cover staff_notes or the route 42501s in prod.
    const grant = one(
      await migratorSql<{ ok: boolean }[]>`
        SELECT has_column_privilege('warehouse14_app', 'appointments', 'staff_notes', 'UPDATE') AS ok`,
    );
    expect(grant.ok).toBe(true);
  });

  it('rejects an illegal transition SCHEDULED → COMPLETED', async () => {
    const id = one(
      await migratorSql<{ id: string }[]>`
        INSERT INTO appointments
          (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
        VALUES ('PICKUP'::appointment_type, ${eigenerPlatz(3)}::timestamptz, 15,
                ${staffId}::uuid, 'pos')
        RETURNING id`,
    ).id;
    await expect(
      migratorSql`UPDATE appointments SET status = 'COMPLETED', completed_at = now() WHERE id = ${id}::uuid`,
    ).rejects.toThrow();
  });
});
