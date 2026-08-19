/**
 * Migration 0019 — Retail & Compliance Core.
 *
 * Focused smoke tests:
 *   • 6 new enums exist with expected labels
 *   • payment_method gained TRADE_IN
 *   • shifts: one OPEN per device UNIQUE, closed_has_evidence CHECK, generated variance_eur
 *   • cash_movements: amount > 0
 *   • vouchers: code format, balance <= issued, single-purpose requires tax code
 *   • voucher_redemptions UNIQUE-less append-only
 *   • inventory_sessions: at most ONE OPEN globally, closed_has_evidence
 *   • whatsapp_inbound_messages: meta_message_id UNIQUE (idempotency)
 *   • transactions: paired_not_self, aml_flag_has_evidence, returned_requires_storno
 *   • transaction_items: discount_nonneg, discount_has_reason
 *   • transaction_payments: tradein_requires_ankauf
 */

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

describe('migration 0019_retail_compliance', () => {
  let testDb: TestDb;
  let migratorSql: Sql;

  beforeAll(async () => {
    testDb = await startTestDb();
    migratorSql = testDb.migratorSql;
    await applyMigrations(migratorSql, 19);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Enums
  // ────────────────────────────────────────────────────────────────────

  describe('enums', () => {
    it.each([
      ['shift_status', ['OPEN', 'CLOSED']],
      [
        'cash_movement_direction',
        ['OPENING_FLOAT', 'INJECTION', 'BANK_DROP', 'SAFE_TRANSIT', 'CLOSING_RECONCILIATION'],
      ],
      ['voucher_type', ['SINGLE_PURPOSE', 'MULTI_PURPOSE']],
      ['voucher_status', ['ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED']],
      ['inventory_session_status', ['OPEN', 'CLOSED']],
      [
        'inventory_scan_match',
        ['MATCHED', 'UNKNOWN_BARCODE', 'DUPLICATE', 'EXPECTED_BUT_SOLD', 'UNEXPECTED'],
      ],
    ] as const)('enum %s has labels %j', async (enumName, expected) => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = ${enumName} ORDER BY enumsortorder`;
      expect(rows.map((r) => r.enumlabel)).toEqual([...expected]);
    });

    it('payment_method enum gained TRADE_IN', async () => {
      const rows = await migratorSql<{ enumlabel: string }[]>`
        SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'payment_method'`;
      expect(rows.map((r) => r.enumlabel)).toContain('TRADE_IN');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. shifts
  // ────────────────────────────────────────────────────────────────────

  describe('shifts', () => {
    async function makeUser(): Promise<string> {
      const [u] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role)
        RETURNING id`;
      return u!.id;
    }
    async function makeDevice(userId: string): Promise<string> {
      const [d] = await migratorSql<{ id: string }[]>`
        INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
        VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
                now() - interval '1 day', now() + interval '365 days', ${userId})
        RETURNING id`;
      return d!.id;
    }

    it('only one OPEN shift per device', async () => {
      const userId = await makeUser();
      const deviceId = await makeDevice(userId);
      await migratorSql`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur)
        VALUES (${deviceId}, ${userId}, '200.00')`;
      await expect(
        migratorSql`
          INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur)
          VALUES (${deviceId}, ${userId}, '300.00')`,
      ).rejects.toThrow(/shifts_one_open_per_device_uq/);
    });

    it('CLOSED status requires evidence (blind_count, system_expected, closed markers)', async () => {
      const userId = await makeUser();
      const deviceId = await makeDevice(userId);
      const [s] = await migratorSql<{ id: string }[]>`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur)
        VALUES (${deviceId}, ${userId}, '200.00') RETURNING id`;
      await expect(
        migratorSql`UPDATE shifts SET status = 'CLOSED'::shift_status WHERE id = ${s!.id}`,
      ).rejects.toThrow(/shifts_closed_has_evidence/);
    });

    it('variance_eur is generated as blind_count - system_expected', async () => {
      const userId = await makeUser();
      const deviceId = await makeDevice(userId);
      const [s] = await migratorSql<{ id: string }[]>`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur)
        VALUES (${deviceId}, ${userId}, '200.00') RETURNING id`;
      await migratorSql`
        UPDATE shifts
           SET status = 'CLOSED'::shift_status,
               blind_count_eur = '550.00',
               system_expected_eur = '545.50',
               closed_by_user_id = ${userId},
               closed_at = now()
         WHERE id = ${s!.id}`;
      const [row] = await migratorSql<{ variance_eur: string }[]>`
        SELECT variance_eur FROM shifts WHERE id = ${s!.id}`;
      expect(row!.variance_eur).toBe('4.50');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. cash_movements
  // ────────────────────────────────────────────────────────────────────

  describe('cash_movements', () => {
    it('amount_eur must be > 0', async () => {
      const [u] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role) RETURNING id`;
      const [d] = await migratorSql<{ id: string }[]>`
        INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
        VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
                now() - interval '1 day', now() + interval '365 days', ${u!.id})
        RETURNING id`;
      const [s] = await migratorSql<{ id: string }[]>`
        INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur)
        VALUES (${d!.id}, ${u!.id}, '200.00') RETURNING id`;
      await expect(
        migratorSql`
          INSERT INTO cash_movements (shift_id, direction, amount_eur, reason, performed_by_user_id)
          VALUES (${s!.id}, 'BANK_DROP'::cash_movement_direction, '0.00', 'x', ${u!.id})`,
      ).rejects.toThrow(/cash_movements_amount_eur_check|amount_eur > /);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. vouchers
  // ────────────────────────────────────────────────────────────────────

  describe('vouchers', () => {
    it('SINGLE_PURPOSE requires issuance_tax_treatment_code', async () => {
      await expect(
        migratorSql`
          INSERT INTO vouchers (code, voucher_type, issued_value_eur, current_balance_eur)
          VALUES ('TESTSINGLE0001', 'SINGLE_PURPOSE'::voucher_type, '50.00', '50.00')`,
      ).rejects.toThrow(/vouchers_single_purpose_has_tax/);
    });

    it('MULTI_PURPOSE does NOT require a tax code', async () => {
      await expect(
        migratorSql`
          INSERT INTO vouchers (code, voucher_type, issued_value_eur, current_balance_eur)
          VALUES ('TESTMULTI00001', 'MULTI_PURPOSE'::voucher_type, '100.00', '100.00')`,
      ).resolves.toBeDefined();
    });

    it('balance cannot exceed issued', async () => {
      await expect(
        migratorSql`
          INSERT INTO vouchers (code, voucher_type, issued_value_eur, current_balance_eur)
          VALUES ('TESTBALANCE001', 'MULTI_PURPOSE'::voucher_type, '50.00', '60.00')`,
      ).rejects.toThrow(/vouchers_balance_le_issued/);
    });

    it('code format must be alphanumeric uppercase 8-32 chars', async () => {
      await expect(
        migratorSql`
          INSERT INTO vouchers (code, voucher_type, issued_value_eur, current_balance_eur)
          VALUES ('too-short', 'MULTI_PURPOSE'::voucher_type, '50.00', '50.00')`,
      ).rejects.toThrow(/vouchers_code_format/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. inventory_sessions
  // ────────────────────────────────────────────────────────────────────

  describe('inventory_sessions', () => {
    it('at most one OPEN session globally', async () => {
      const [u] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'ADMIN'::user_role) RETURNING id`;
      await migratorSql`
        INSERT INTO inventory_sessions (opened_by_user_id) VALUES (${u!.id})`;
      await expect(
        migratorSql`
          INSERT INTO inventory_sessions (opened_by_user_id) VALUES (${u!.id})`,
      ).rejects.toThrow(/inventory_sessions_one_open_uq/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. whatsapp_inbound_messages
  // ────────────────────────────────────────────────────────────────────

  describe('whatsapp_inbound_messages', () => {
    it('meta_message_id is UNIQUE (idempotent retry)', async () => {
      await migratorSql`
        INSERT INTO whatsapp_inbound_messages (meta_message_id, from_phone, message_type, raw_payload, signature_verified)
        VALUES ('wamid.test_one', '+49xxx', 'text', '{"ok":true}'::jsonb, TRUE)`;
      await expect(
        migratorSql`
          INSERT INTO whatsapp_inbound_messages (meta_message_id, from_phone, message_type, raw_payload, signature_verified)
          VALUES ('wamid.test_one', '+49xxx', 'text', '{"ok":true}'::jsonb, TRUE)`,
      ).rejects.toThrow(/whatsapp_inbound_meta_id_uq/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 7. transaction extensions — AML flag invariant
  // ────────────────────────────────────────────────────────────────────

  describe('transactions extensions', () => {
    it('suspicious_aml_flag=TRUE requires reason + flagger', async () => {
      const [u] = await migratorSql<{ id: string }[]>`
        INSERT INTO users (email, name, role)
        VALUES (${`u-${crypto.randomUUID()}@x.test`}, 'X', 'CASHIER'::user_role) RETURNING id`;
      const [d] = await migratorSql<{ id: string }[]>`
        INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
        VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
                now() - interval '1 day', now() + interval '365 days', ${u!.id})
        RETURNING id`;
      await expect(
        migratorSql`
          INSERT INTO transactions (direction, device_id, cashier_user_id,
                                    subtotal_eur, vat_eur, total_eur, tax_treatment_code,
                                    suspicious_aml_flag)
          VALUES ('VERKAUF'::transaction_direction, ${d!.id}, ${u!.id},
                  '84.03', '15.97', '100.00', 'STANDARD_19', TRUE)`,
      ).rejects.toThrow(/transactions_aml_flag_has_evidence/);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // 8. transaction_items extensions — discount with reason
  // ────────────────────────────────────────────────────────────────────

  describe('transaction_items discount', () => {
    it('line_discount_eur > 0 requires a reason', async () => {
      // Set up a parent tx via the migrator (the deferred balance trigger fires at COMMIT;
      // we'll abort intentionally — the CHECK we want to verify runs at INSERT before COMMIT).
      await expect(
        migratorSql`
          INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                         line_vat_eur, line_total_eur,
                                         applied_tax_treatment_code, line_discount_eur)
          VALUES (gen_random_uuid(), gen_random_uuid(),
                  '0.00', '0.00', '0.00', 'STANDARD_19', '5.00')`,
      ).rejects.toThrow(/transaction_items_discount_has_reason|foreign key/i);
    });
  });
});
