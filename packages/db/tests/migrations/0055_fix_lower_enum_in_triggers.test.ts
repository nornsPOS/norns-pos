/**
 * Migration 0055 — fix `lower(<enum>)` in three SECURITY DEFINER ledger-event triggers.
 *
 * Latent runtime bug (found by read-only DB verification, reproduced on pg16 + pg17):
 * three trigger functions call `lower(NEW.state)` / `lower(NEW.status)` directly on an
 * ENUM column. PostgreSQL has NO implicit enum→text cast, so the call resolves to
 * `function lower(<enum>) does not exist` THE FIRST TIME the trigger fires at runtime.
 * The plpgsql bodies were created fine at migration time (bodies aren't type-checked
 * until executed — and prod ran migrate with check_function_bodies=off), so prod at
 * 0050 installed cleanly but would throw on:
 *   • the first real TSE state event          → on_tse_state_event()       (0010)
 *   • the first real Kassenabschluss insert    → on_daily_closing_event()   (0011)
 *   • the first real appointment status event  → on_appointment_state_event() (0012)
 *
 * Each of the three trigger functions fires on AFTER INSERT, so a single valid INSERT
 * into the respective table exercises the real trigger path and hits the bug.
 *
 * RED: with migrations applied only up to 0054, each INSERT throws
 *      `function lower(<enum>) does not exist`.
 * GREEN: with 0055 applied (lower(NEW.<col>::text)), each INSERT succeeds and the
 *        ledger_event row is emitted.
 *
 * The fix is append-only (0055) — the immutable 0010/0011/0012 files are NOT edited.
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

async function makeDevice(sql: Sql, pairedByUserId: string): Promise<string> {
  const [d] = await sql<{ id: string }[]>`
    INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
    VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
            now() - interval '1 day', now() + interval '365 days', ${pairedByUserId})
    RETURNING id`;
  return must(d).id;
}

/**
 * Insert a COMPLETE, KYC-clean transaction (header + item + payment) atomically so
 * the deferred balance constraint (0016) and the BEFORE-INSERT KYC gate (0050) pass.
 * VERKAUF below €2.000 with no customer is allowed. Returns the transactions.id —
 * needed as the FK parent for tse_transactions.
 */
async function insertVerkauf(sql: Sql, cashierId: string, deviceId: string): Promise<string> {
  const total = '100.00';
  const [product] = await sql<{ id: string }[]>`
    INSERT INTO products (sku, status, tax_treatment_code, item_type,
                          acquisition_cost_eur, list_price_eur, name, published_at)
    VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
            'gold_jewelry'::item_type, '50.00', ${total}, 'Test item', now())
    RETURNING id`;
  const productId = must(product).id;

  return await sql.begin(async (tx) => {
    const [txRow] = await tx<
      { id: string; subtotal_eur: string; vat_eur: string; total_eur: string }[]
    >`
      INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                subtotal_eur, vat_eur, total_eur, tax_treatment_code,
                                finalized_at)
      VALUES ('VERKAUF'::transaction_direction, NULL, ${deviceId}, ${cashierId},
              ROUND(${total}::numeric / 1.19, 2),
              ${total}::numeric - ROUND(${total}::numeric / 1.19, 2),
              ${total}::numeric, 'STANDARD_19', ${new Date()})
      RETURNING id, subtotal_eur, vat_eur, total_eur`;
    const t = must(txRow);
    await tx`
      INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                     line_vat_eur, line_total_eur, applied_tax_treatment_code,
                                     applied_vat_rate)
      VALUES (${t.id}, ${productId}, ${t.subtotal_eur}, ${t.vat_eur}, ${t.total_eur},
              'STANDARD_19', 0.1900)`;
    await tx`
      INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
      VALUES (${t.id}, 'CASH'::payment_method, ${t.total_eur})`;
    return t.id;
  });
}

/** INSERT a QUEUED_OFFLINE tse_transactions row → fires on_tse_state_event() (AFTER INSERT). */
async function insertTse(sql: Sql, transactionId: string): Promise<void> {
  await sql`
    INSERT INTO tse_transactions (transaction_id, fiskaly_tss_id, fiskaly_client_id)
    VALUES (${transactionId}, ${crypto.randomUUID()}, ${crypto.randomUUID()})`;
}

/** INSERT a COUNTING daily_closing → fires on_daily_closing_event() (AFTER INSERT). */
async function insertClosing(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO daily_closings (business_day)
    VALUES (${`2026-06-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`})`;
}

/** INSERT a SCHEDULED appointment → fires on_appointment_state_event() (AFTER INSERT). */
async function insertAppointment(sql: Sql, staffUserId: string): Promise<void> {
  await sql`
    INSERT INTO appointments (appointment_type, starts_at, duration_minutes, staff_user_id, booked_via)
    VALUES ('CONSULTATION'::appointment_type, date_trunc('minute', now() + interval '1 day'),
            30, ${staffUserId}, 'pos')`;
}

const LOWER_ENUM_THROW = /function lower\([^)]*\) does not exist/;

describe('migration 0055 — lower(<enum>) cast fix in ledger-event triggers', () => {
  describe('RED — at 0054 the three AFTER-INSERT triggers throw at runtime', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 54);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('on_tse_state_event() throws `function lower(... ) does not exist`', async () => {
      const cashier = await makeUser(sql);
      const device = await makeDevice(sql, cashier);
      const txId = await insertVerkauf(sql, cashier, device);
      await expect(insertTse(sql, txId)).rejects.toThrow(LOWER_ENUM_THROW);
    });

    it('on_daily_closing_event() throws `function lower(... ) does not exist`', async () => {
      await expect(insertClosing(sql)).rejects.toThrow(LOWER_ENUM_THROW);
    });

    it('on_appointment_state_event() throws `function lower(... ) does not exist`', async () => {
      const staff = await makeUser(sql);
      await expect(insertAppointment(sql, staff)).rejects.toThrow(LOWER_ENUM_THROW);
    });
  });

  describe('GREEN — at 0055 the same inserts succeed and emit ledger_events', () => {
    let testDb: TestDb;
    let sql: Sql;

    beforeAll(async () => {
      testDb = await startTestDb();
      sql = testDb.migratorSql;
      await applyMigrations(sql, 55);
    }, 180_000);

    afterAll(async () => {
      await testDb.cleanup();
    });

    it('on_tse_state_event() succeeds and emits a `tse.queued_offline` ledger_event', async () => {
      const cashier = await makeUser(sql);
      const device = await makeDevice(sql, cashier);
      const txId = await insertVerkauf(sql, cashier, device);
      // SECOND latent bug (out of scope for 0055, flagged to Basel): the SECURITY
      // DEFINER trigger runs as warehouse14_security and SELECTs cashier_user_id +
      // device_id FROM transactions, but those two columns were never GRANTed to the
      // security role (0016 grants only id/customer_id and id/subtotal/vat/total). Once
      // the lower(enum) bug is fixed the trigger reaches that SELECT and hits
      // `permission denied for table transactions`. Grant the columns HERE so this test
      // isolates the enum-cast fix; the grant gap needs its own follow-up migration.
      await sql`GRANT SELECT (cashier_user_id, device_id) ON transactions TO warehouse14_security`;
      await insertTse(sql, txId); // must NOT throw
      const [evt] = await sql<{ event_type: string }[]>`
        SELECT event_type FROM ledger_events
         WHERE entity_table = 'tse_transactions' ORDER BY id DESC LIMIT 1`;
      expect(must(evt).event_type).toBe('tse.queued_offline');
    });

    it('on_daily_closing_event() succeeds and emits a `daily_closing.counting` ledger_event', async () => {
      await insertClosing(sql); // must NOT throw
      const [evt] = await sql<{ event_type: string }[]>`
        SELECT event_type FROM ledger_events
         WHERE entity_table = 'daily_closings' ORDER BY id DESC LIMIT 1`;
      expect(must(evt).event_type).toBe('daily_closing.counting');
    });

    it('on_appointment_state_event() succeeds and emits an `appointment.scheduled` ledger_event', async () => {
      const staff = await makeUser(sql);
      await insertAppointment(sql, staff); // must NOT throw
      const [evt] = await sql<{ event_type: string }[]>`
        SELECT event_type FROM ledger_events
         WHERE entity_table = 'appointments' ORDER BY id DESC LIMIT 1`;
      expect(must(evt).event_type).toBe('appointment.scheduled');
    });
  });
});
