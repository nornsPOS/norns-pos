/**
 * Migration 0013 — Security hardening (Red Team Audit fixes).
 *
 * Focused tests, one describe block per finding:
 *
 *   C-1  ANKAUF without customer_id is rejected by CHECK constraint.
 *   C-2  Sanctions hard-block — sale to a sanctions-flagged customer refused.
 *   C-3  FINALIZED closing day guard — transactions for closed days refused.
 *   C-4  Terminal appointment releases its viewing-holds with the right reason.
 *   C-5  Partial UNIQUE: one storno per original; one transaction per appointment.
 *   C-6  pg_notify('warehouse14_ledger', NEW.id::text) fires on every INSERT.
 *
 * All assertions go through the migrator connection (the audit perspective)
 * because the trigger functions are SECURITY DEFINER and bypass the app role's
 * column-level grants on read.
 *
 * See docs/architecture/RED_TEAM_AUDIT_2026-05-25.md.
 */

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type TestDb,
  applyMigrations,
  setAppPasswordForTest,
  startTestDb,
} from '../helpers/testDb.js';

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

describe('migration 0013_security_hardening — Red Team Audit fixes', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  // ────────────────────────────────────────────────────────────────────
  // Common seed helpers (lightweight; one row at a time).
  // ────────────────────────────────────────────────────────────────────

  async function makeUser(role: 'ADMIN' | 'CASHIER' = 'CASHIER'): Promise<string> {
    const [u] = await migratorSql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', ${role}::user_role)
      RETURNING id`;
    return u!.id;
  }

  async function makeDevice(pairedByUserId: string): Promise<string> {
    const [d] = await migratorSql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class,
              ${`CERT-${crypto.randomUUID()}`},
              now() - interval '1 day',
              now() + interval '365 days',
              ${pairedByUserId})
      RETURNING id`;
    return d!.id;
  }

  async function makeCustomer(opts: { sanctionsMatch?: boolean } = {}): Promise<string> {
    const [c] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until, sanctions_match)
      SELECT encrypt_pii('Test'), (now() + interval '5 years')::date, ${opts.sanctionsMatch ?? false}
        FROM s
      RETURNING id`;
    return c!.id;
  }

  async function makeProduct(): Promise<string> {
    const [p] = await migratorSql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'MARGIN_25A',
              'gold_jewelry'::item_type, '50.00', '100.00', 'Test', now())
      RETURNING id`;
    return p!.id;
  }

  /** Seed a ledger event we can anchor a closing to. */
  async function seedLedgerEvent(): Promise<bigint> {
    const [row] = await migratorSql<{ id: string }[]>`
      INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
      VALUES ('test.seed', 'test', gen_random_uuid(), '{}'::jsonb)
      RETURNING id`;
    return BigInt(row!.id);
  }

  /** Insert a transaction directly via the migrator. Returns the id. */
  async function insertTx(opts: {
    direction: 'VERKAUF' | 'ANKAUF';
    customerId?: string | null;
    cashierId: string;
    deviceId: string;
    totalEur?: string;
    finalizedAt?: Date;
    stornoOfId?: string | null;
  }): Promise<string> {
    const total = opts.totalEur ?? '100.00';
    const subtotal = '84.03';
    const vat = '15.97';
    // For storno, negate.
    const isStorno = opts.stornoOfId != null;
    const sign = isStorno ? -1 : 1;
    const subtotalSigned = (Number.parseFloat(subtotal) * sign).toFixed(2);
    const vatSigned = (Number.parseFloat(vat) * sign).toFixed(2);
    const totalSigned = (Number.parseFloat(total) * sign).toFixed(2);
    const [tx] = await migratorSql<{ id: string }[]>`
      INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                subtotal_eur, vat_eur, total_eur,
                                tax_treatment_code, storno_of_transaction_id,
                                finalized_at)
      VALUES (${opts.direction}::transaction_direction,
              ${opts.customerId ?? null},
              ${opts.deviceId}, ${opts.cashierId},
              ${subtotalSigned}, ${vatSigned}, ${totalSigned},
              'STANDARD_19',
              ${opts.stornoOfId ?? null},
              ${opts.finalizedAt ?? new Date()})
      RETURNING id`;
    return tx!.id;
  }

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 13);
    await setAppPasswordForTest(migratorSql);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  // ════════════════════════════════════════════════════════════════════
  // C-1 — ANKAUF requires customer_id
  // ════════════════════════════════════════════════════════════════════

  describe('C-1 — Ankauf requires customer_id (CHECK constraint)', () => {
    it('VERKAUF without customer_id is still allowed (walk-in cash sale)', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      await expect(
        insertTx({ direction: 'VERKAUF', cashierId: cashier, deviceId: device, customerId: null }),
      ).resolves.toBeDefined();
    });

    it('ANKAUF without customer_id is REJECTED', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      await expect(
        insertTx({ direction: 'ANKAUF', cashierId: cashier, deviceId: device, customerId: null }),
      ).rejects.toThrow(/transactions_ankauf_requires_customer/);
    });

    it('ANKAUF WITH customer_id is allowed', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const customer = await makeCustomer();
      await expect(
        insertTx({
          direction: 'ANKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: customer,
        }),
      ).resolves.toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // C-2 — Sanctions hard-block
  // ════════════════════════════════════════════════════════════════════

  describe('C-2 — Sanctions hard-block', () => {
    it('transaction for a sanctioned customer is REJECTED', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const sanctioned = await makeCustomer({ sanctionsMatch: true });
      await expect(
        insertTx({
          direction: 'VERKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: sanctioned,
        }),
      ).rejects.toThrow(/Sanctions hard-block/);
    });

    it('transaction for a non-sanctioned customer is allowed', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const clean = await makeCustomer({ sanctionsMatch: false });
      await expect(
        insertTx({ direction: 'VERKAUF', cashierId: cashier, deviceId: device, customerId: clean }),
      ).resolves.toBeDefined();
    });

    it('flagging an existing customer blocks NEW transactions (existing ones intact)', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const customer = await makeCustomer({ sanctionsMatch: false });

      // First sale is fine.
      const ok = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: customer,
      });
      expect(ok).toBeDefined();

      // Flag the customer.
      await migratorSql`UPDATE customers SET sanctions_match = TRUE WHERE id = ${customer}`;

      // Second sale is rejected.
      await expect(
        insertTx({
          direction: 'VERKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: customer,
        }),
      ).rejects.toThrow(/Sanctions hard-block/);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // C-3 — FINALIZED closing-day guard
  // ════════════════════════════════════════════════════════════════════

  describe('C-3 — Transactions refused for FINALIZED business day', () => {
    /** Build a FINALIZED daily_closings row for the given Berlin date (shop_id NULL). */
    async function finalizeBusinessDay(businessDay: string, userId: string): Promise<void> {
      const anchorId = await seedLedgerEvent();
      // Insert COUNTING first.
      const [cl] = await migratorSql<{ id: string }[]>`
        INSERT INTO daily_closings (business_day, state)
        VALUES (${businessDay}::date, 'COUNTING'::closing_state)
        RETURNING id`;
      // Then transition to FINALIZED via UPDATE (fills evidence; trigger emits ledger).
      await migratorSql`
        UPDATE daily_closings
           SET state = 'FINALIZED'::closing_state,
               cash_drawer_expected_eur = '500.00',
               cash_drawer_counted_eur = '500.00',
               cash_drawer_variance_eur = '0.00',
               counted_by_user_id = ${userId},
               counted_at = now(),
               finalized_by_user_id = ${userId},
               finalized_at = now(),
               ledger_anchor_id = ${anchorId.toString()},
               ledger_anchor_hash = decode(repeat('ab', 32), 'hex')
         WHERE id = ${cl!.id}`;
    }

    it('inserting a transaction with finalized_at on a FINALIZED day is REJECTED', async () => {
      const admin = await makeUser('ADMIN');
      const cashier = await makeUser();
      const device = await makeDevice(cashier);

      // Pick a fixed past Berlin day and close it.
      const closedDay = '2026-05-20';
      await finalizeBusinessDay(closedDay, admin);

      // 12:00 Berlin local on the closed day, in UTC.
      const txTime = new Date('2026-05-20T10:00:00Z');
      await expect(
        insertTx({
          direction: 'VERKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: null,
          finalizedAt: txTime,
        }),
      ).rejects.toThrow(/Closing-day guard.*FINALIZED/);
    });

    it('a transaction on an OPEN day (no closing or COUNTING) is allowed', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const openDayTx = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
        finalizedAt: new Date('2026-05-21T10:00:00Z'),
      });
      expect(openDayTx).toBeDefined();
    });

    it('a COUNTING (not yet FINALIZED) closing does NOT block transactions', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      // Insert COUNTING closing only (no UPDATE to FINALIZED).
      await migratorSql`
        INSERT INTO daily_closings (business_day, state)
        VALUES ('2026-05-22'::date, 'COUNTING'::closing_state)`;
      const tx = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
        finalizedAt: new Date('2026-05-22T10:00:00Z'),
      });
      expect(tx).toBeDefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // C-4 — Release viewing-holds when appointment hits terminal state
  // ════════════════════════════════════════════════════════════════════

  describe('C-4 — terminal appointment releases its viewing-holds', () => {
    /** Make a VIEWING appointment + link one product → trigger creates a SOFT hold. */
    async function scenario(): Promise<{ apptId: string; productId: string; holdId: string }> {
      const staff = await makeUser();
      const customer = await makeCustomer();
      const product = await makeProduct();

      // 1h in the future (so hold trigger picks it up — needs SCHEDULED/CONFIRMED).
      const startsAt = new Date(Date.now() + 60 * 60 * 1000);
      const [appt] = await migratorSql<{ id: string }[]>`
        INSERT INTO appointments (appointment_type, status, starts_at, duration_minutes,
                                  customer_id, staff_user_id, booked_via)
        VALUES ('VIEWING'::appointment_type, 'SCHEDULED'::appointment_status,
                ${startsAt}, 45, ${customer}, ${staff}, 'control_desktop')
        RETURNING id`;

      await migratorSql`
        INSERT INTO appointment_linked_products (appointment_id, product_id)
        VALUES (${appt!.id}, ${product})`;

      const [hold] = await migratorSql<{ id: string; released_at: Date | null }[]>`
        SELECT id, released_at FROM product_viewing_holds
         WHERE appointment_id = ${appt!.id}`;
      expect(hold).toBeDefined();
      expect(hold!.released_at).toBeNull();

      return { apptId: appt!.id, productId: product, holdId: hold!.id };
    }

    it('SCHEDULED → CANCELLED releases the hold (reason=appointment_cancelled)', async () => {
      const { apptId, holdId } = await scenario();
      await migratorSql`
        UPDATE appointments
           SET status = 'CANCELLED'::appointment_status, cancelled_at = now()
         WHERE id = ${apptId}`;
      const [after] = await migratorSql<
        { released_at: Date | null; released_reason: string | null }[]
      >`
        SELECT released_at, released_reason FROM product_viewing_holds WHERE id = ${holdId}`;
      expect(after!.released_at).toBeInstanceOf(Date);
      expect(after!.released_reason).toBe('appointment_cancelled');
    });

    it('SCHEDULED → NO_SHOW releases the hold (reason=appointment_no_show)', async () => {
      const { apptId, holdId } = await scenario();
      await migratorSql`
        UPDATE appointments
           SET status = 'NO_SHOW'::appointment_status, no_show_marked_at = now()
         WHERE id = ${apptId}`;
      const [after] = await migratorSql<
        { released_at: Date | null; released_reason: string | null }[]
      >`
        SELECT released_at, released_reason FROM product_viewing_holds WHERE id = ${holdId}`;
      expect(after!.released_at).toBeInstanceOf(Date);
      expect(after!.released_reason).toBe('appointment_no_show');
    });

    it('SCHEDULED → RESCHEDULED releases the hold (reason=appointment_rescheduled)', async () => {
      const { apptId, holdId } = await scenario();
      // RESCHEDULED requires rescheduled_to_appointment_id — create the successor first.
      const staff = await makeUser();
      const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const [newAppt] = await migratorSql<{ id: string }[]>`
        INSERT INTO appointments (appointment_type, status, starts_at, duration_minutes, staff_user_id, booked_via)
        VALUES ('VIEWING'::appointment_type, 'SCHEDULED'::appointment_status,
                ${startsAt}, 45, ${staff}, 'control_desktop')
        RETURNING id`;

      await migratorSql`
        UPDATE appointments
           SET status = 'RESCHEDULED'::appointment_status,
               rescheduled_to_appointment_id = ${newAppt!.id}
         WHERE id = ${apptId}`;
      const [after] = await migratorSql<
        { released_at: Date | null; released_reason: string | null }[]
      >`
        SELECT released_at, released_reason FROM product_viewing_holds WHERE id = ${holdId}`;
      expect(after!.released_at).toBeInstanceOf(Date);
      expect(after!.released_reason).toBe('appointment_rescheduled');
    });

    it('walking the appointment through CHECKED_IN → IN_PROGRESS → COMPLETED also releases the hold', async () => {
      const { apptId, holdId } = await scenario();

      await migratorSql`UPDATE appointments SET status='CHECKED_IN', checked_in_at = now() WHERE id = ${apptId}`;
      await migratorSql`UPDATE appointments SET status='IN_PROGRESS', in_progress_started_at = now() WHERE id = ${apptId}`;
      await migratorSql`UPDATE appointments SET status='COMPLETED', completed_at = now() WHERE id = ${apptId}`;

      const [after] = await migratorSql<
        { released_at: Date | null; released_reason: string | null }[]
      >`
        SELECT released_at, released_reason FROM product_viewing_holds WHERE id = ${holdId}`;
      expect(after!.released_at).toBeInstanceOf(Date);
      expect(after!.released_reason).toBe('appointment_completed');
    });

    it('non-terminal transitions (SCHEDULED → CONFIRMED) do NOT release the hold', async () => {
      const { apptId, holdId } = await scenario();

      await migratorSql`UPDATE appointments SET status='CONFIRMED', confirmed_at = now() WHERE id = ${apptId}`;

      const [after] = await migratorSql<{ released_at: Date | null }[]>`
        SELECT released_at FROM product_viewing_holds WHERE id = ${holdId}`;
      expect(after!.released_at).toBeNull();
    });

    it('an already-released hold is NOT re-released (idempotency)', async () => {
      const { apptId, holdId } = await scenario();

      // Manually release first.
      const releasedAtFirst = new Date('2026-01-01T00:00:00Z');
      await migratorSql`
        UPDATE product_viewing_holds
           SET released_at = ${releasedAtFirst}, released_reason = 'manual_test'
         WHERE id = ${holdId}`;

      // Now cancel the appointment — trigger should skip this hold (WHERE released_at IS NULL).
      await migratorSql`
        UPDATE appointments
           SET status='CANCELLED'::appointment_status, cancelled_at = now()
         WHERE id = ${apptId}`;

      const [after] = await migratorSql<{ released_at: Date; released_reason: string }[]>`
        SELECT released_at, released_reason FROM product_viewing_holds WHERE id = ${holdId}`;
      expect(after!.released_at.toISOString()).toBe(releasedAtFirst.toISOString());
      expect(after!.released_reason).toBe('manual_test');
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // C-5 — Partial UNIQUE indexes
  // ════════════════════════════════════════════════════════════════════

  describe('C-5 — one storno per original, one transaction per appointment', () => {
    it('a second storno of the same original is REJECTED at INSERT', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      const orig = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
      });

      // First storno: fine.
      const storno1 = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
        stornoOfId: orig,
      });
      expect(storno1).toBeDefined();

      // Second storno of the same original: rejected by partial UNIQUE.
      await expect(
        insertTx({
          direction: 'VERKAUF',
          cashierId: cashier,
          deviceId: device,
          customerId: null,
          stornoOfId: orig,
        }),
      ).rejects.toThrow(/transactions_one_storno_per_original_uq/);
    });

    it('two appointments cannot link to the same transaction', async () => {
      const cashier = await makeUser();
      const staff = await makeUser();
      const device = await makeDevice(cashier);
      const tx = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
      });

      const startsAt = new Date(Date.now() + 60 * 60 * 1000);
      const [a1] = await migratorSql<{ id: string }[]>`
        INSERT INTO appointments (appointment_type, status, starts_at, duration_minutes, staff_user_id, booked_via)
        VALUES ('PICKUP'::appointment_type, 'SCHEDULED'::appointment_status,
                ${startsAt}, 15, ${staff}, 'control_desktop')
        RETURNING id`;
      const [a2] = await migratorSql<{ id: string }[]>`
        INSERT INTO appointments (appointment_type, status, starts_at, duration_minutes, staff_user_id, booked_via)
        VALUES ('PICKUP'::appointment_type, 'SCHEDULED'::appointment_status,
                ${new Date(startsAt.getTime() + 60 * 60 * 1000)}, 15, ${staff}, 'control_desktop')
        RETURNING id`;

      await migratorSql`UPDATE appointments SET linked_transaction_id = ${tx} WHERE id = ${a1!.id}`;
      await expect(
        migratorSql`UPDATE appointments SET linked_transaction_id = ${tx} WHERE id = ${a2!.id}`,
      ).rejects.toThrow(/appointments_one_transaction_link_uq/);
    });

    it('multiple NULL storno_of_transaction_id values are allowed (partial WHERE NOT NULL)', async () => {
      const cashier = await makeUser();
      const device = await makeDevice(cashier);
      // Two originals — both have storno_of_transaction_id = NULL — must coexist.
      const a = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
      });
      const b = await insertTx({
        direction: 'VERKAUF',
        cashierId: cashier,
        deviceId: device,
        customerId: null,
      });
      expect(a).not.toBe(b);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // C-6 — pg_notify substrate for SSE
  // ════════════════════════════════════════════════════════════════════

  describe('C-6 — every ledger_events INSERT emits pg_notify', () => {
    it('NOTIFY on channel warehouse14_ledger carries the row id', async () => {
      // Dedicated listener connection — `LISTEN` ties to a session.
      const listenerSql = postgres({
        host: testDb.container.getHost(),
        port: testDb.container.getPort(),
        database: 'warehouse14_test',
        username: 'warehouse14_migrator',
        password: 'warehouse14_migrator_test_pw',
        max: 1,
        onnotice: () => {},
      });

      const received: string[] = [];
      const subscription = await listenerSql.listen('warehouse14_ledger', (payload) => {
        received.push(payload);
      });

      try {
        const [row] = await migratorSql<{ id: string }[]>`
          INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
          VALUES ('test.notify', 'test', gen_random_uuid(), '{}'::jsonb)
          RETURNING id`;

        // Allow up to 1s for NOTIFY delivery (background socket; usually <10ms).
        const insertedId = row!.id;
        for (let attempt = 0; attempt < 50 && !received.includes(insertedId); attempt++) {
          await new Promise((r) => setTimeout(r, 20));
        }

        expect(received).toContain(insertedId);
      } finally {
        await subscription.unlisten();
        await listenerSql.end({ timeout: 5 }).catch(() => {});
      }
    });
  });
});
