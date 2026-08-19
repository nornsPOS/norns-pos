/**
 * Migration 0057 — grant the soft-hold trigger SELECT on `appointments`.
 *
 * Latent runtime bug (same class as 0056, found by the api-cloud integration
 * suite + read-only DB verification):
 *
 *   `create_viewing_hold_on_link()` (0012_appointments.sql) is an AFTER INSERT
 *   trigger on `appointment_linked_products`, SECURITY DEFINER, OWNED BY
 *   `warehouse14_security`. Its first statement is:
 *       SELECT * INTO appt_row FROM appointments WHERE id = NEW.appointment_id;
 *   0012 granted the security role INSERT on `product_viewing_holds` but never
 *   SELECT on `appointments`, and 0003's ALTER DEFAULT PRIVILEGES grants
 *   SELECT/INSERT to `warehouse14_app` only — NOT to `warehouse14_security`.
 *
 *   So the FIRST real VIEWING booking that links a product (the primary VIEWING
 *   path — routes/appointments.ts INSERTs into appointment_linked_products)
 *   fires the trigger, which throws `permission denied for table appointments`
 *   (42501) inside the SECURITY DEFINER body, regardless of the caller's rights.
 *   The whole booking transaction rolls back — a go-live booking bug.
 *
 * RED: at 0056, linking a product to a VIEWING appointment throws
 *      `permission denied for table appointments`.
 * GREEN: at 0057 (GRANT SELECT ON appointments TO warehouse14_security), the
 *        same link succeeds and the trigger auto-creates exactly one SOFT
 *        product_viewing_holds row.
 *
 * The fix is append-only (0057) — the immutable 0012 file is NOT edited.
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

/** Narrow `rows[0]` without a non-null assertion (biome noNonNullAssertion). */
function must<T>(row: T | undefined): T {
  if (row === undefined) throw new Error('query returned no rows');
  return row;
}

async function makeUser(sql: Sql): Promise<string> {
  const [u] = await sql<{ id: string }[]>`
    INSERT INTO users (email, name, role)
    VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
    RETURNING id`;
  return must(u).id;
}

async function makeProduct(sql: Sql): Promise<string> {
  const [p] = await sql<{ id: string }[]>`
    INSERT INTO products (sku, status, tax_treatment_code, item_type,
                          acquisition_cost_eur, list_price_eur, name)
    VALUES (${`SKU-${crypto.randomUUID()}`}, 'DRAFT'::product_status, 'MARGIN_25A',
            'gold_jewelry'::item_type, '50.00', '150.00', 'Test ring')
    RETURNING id`;
  return must(p).id;
}

/**
 * INSERT a SCHEDULED VIEWING appointment (customer_id NULL — the trigger reads
 * it but the hold table allows NULL). Returns the appointment id.
 */
async function makeViewingAppointment(sql: Sql, staffUserId: string): Promise<string> {
  const [a] = await sql<{ id: string }[]>`
    INSERT INTO appointments (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
    VALUES ('VIEWING'::appointment_type, date_trunc('minute', now() + interval '2 days'),
            30, ${staffUserId}, 'pos')
    RETURNING id`;
  return must(a).id;
}

/**
 * Link a product to a VIEWING appointment → fires the AFTER-INSERT
 * `trg_create_viewing_hold` trigger (`create_viewing_hold_on_link()`), which
 * SELECTs from `appointments` as warehouse14_security.
 */
async function linkProduct(sql: Sql, appointmentId: string, productId: string): Promise<void> {
  await sql`
    INSERT INTO appointment_linked_products (appointment_id, product_id)
    VALUES (${appointmentId}, ${productId})`;
}

const PERMISSION_DENIED_APPOINTMENTS = /permission denied for table appointments/;

describe('migration 0057 — soft-hold trigger SELECT grant on appointments', () => {
  describe('RED — at 0056 linking a VIEWING product throws permission denied', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 56);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('create_viewing_hold_on_link() throws `permission denied for table appointments`', async () => {
      const staff = await makeUser(sql);
      const productId = await makeProduct(sql);
      const apptId = await makeViewingAppointment(sql, staff);
      await expect(linkProduct(sql, apptId, productId)).rejects.toThrow(
        PERMISSION_DENIED_APPOINTMENTS,
      );
    });
  });

  describe('GREEN — at 0057 the link succeeds and one SOFT hold is created', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 57);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('linking a VIEWING product auto-creates exactly one active SOFT hold', async () => {
      const staff = await makeUser(sql);
      const productId = await makeProduct(sql);
      const apptId = await makeViewingAppointment(sql, staff);

      await linkProduct(sql, apptId, productId); // must NOT throw

      const holds = await sql<{ hold_strength: string }[]>`
        SELECT hold_strength FROM product_viewing_holds
         WHERE appointment_id = ${apptId} AND released_at IS NULL`;
      expect(holds.length).toBe(1);
      expect(must(holds[0]).hold_strength).toBe('SOFT');
    });
  });
});
