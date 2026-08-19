/**
 * Migration 0047 — 'DEBT' added to the payment_method enum.
 *
 * 0016's guard triggers do `IF NEW.payment_method <> 'DEBT'` on every
 * transaction_payments INSERT. With no 'DEBT' label in the enum (0009), that
 * literal cannot be coerced and the FIRST payment of ANY kind — even CASH —
 * throws "invalid input value for enum payment_method: DEBT". 0047 adds the
 * label so the guard can evaluate and a normal CASH payment lands.
 *
 * Boots 0001..0016 (broken state) and applies ONLY 0047 on top (mirrors the
 * prod forward-migrate path; 0047 is a bare ALTER TYPE ADD VALUE — autocommit).
 *   RED  (without 0047): inserting a CASH payment throws /invalid input value.*DEBT/.
 *   GREEN (with 0047)  : the CASH payment lands.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type TestDb, applyMigrations, startTestDb } from '../helpers/testDb.js';

const FIX_SQL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'migrations',
  '0047_payment_method_add_debt.sql',
);

describe('migration 0047_payment_method_add_debt', () => {
  let testDb: TestDb;
  let sql: Sql;
  let deviceId: string;
  let cashierUserId: string;

  beforeAll(async () => {
    testDb = await startTestDb();
    sql = testDb.migratorSql;
    await applyMigrations(sql, 16); // broken state: guard triggers exist, enum lacks DEBT
    try {
      const fixSql = await readFile(FIX_SQL, 'utf8');
      await sql.unsafe('SET check_function_bodies = off');
      await sql.unsafe(fixSql);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    const [u] = await sql<{ id: string }[]>`
      INSERT INTO users (email, name, role)
      VALUES (${`c-${crypto.randomUUID()}@x.test`}, 'Cashier', 'CASHIER'::user_role)
      RETURNING id`;
    cashierUserId = u?.id ?? '';
    const [d] = await sql<{ id: string }[]>`
      INSERT INTO devices (device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id)
      VALUES ('POS_TERMINAL'::device_class, ${`CERT-${crypto.randomUUID()}`},
              now() - interval '1 day', now() + interval '365 days', ${cashierUserId})
      RETURNING id`;
    deviceId = d?.id ?? '';
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("'DEBT' is a valid payment_method label", async () => {
    const [row] = await sql<{ ok: boolean }[]>`
      SELECT 'DEBT' = ANY (enum_range(NULL::payment_method)::text[]) AS ok`;
    expect(row?.ok).toBe(true);
  });

  it('a CASH payment can be inserted (the guard trigger no longer throws on the DEBT literal)', async () => {
    // Anonymous sale (customer_id NULL) so the spend-accumulation trigger does
    // not touch customers — isolates the payment_method/guard-trigger path.
    // One transaction so the deferred balance trigger sees txn + item + payment.
    const [prod] = await sql<{ id: string }[]>`
      INSERT INTO products (sku, status, tax_treatment_code, item_type,
                            acquisition_cost_eur, list_price_eur, name, published_at)
      VALUES (${`SKU-${crypto.randomUUID()}`}, 'AVAILABLE'::product_status, 'STANDARD_19',
              'gold_jewelry'::item_type, '50.00', '100.00', 'ring', now())
      RETURNING id`;
    const payId = await sql.begin(async (tx) => {
      const [t] = await tx<{ id: string }[]>`
        INSERT INTO transactions (direction, customer_id, device_id, cashier_user_id,
                                  subtotal_eur, vat_eur, total_eur, tax_treatment_code)
        VALUES ('VERKAUF'::transaction_direction, NULL, ${deviceId}, ${cashierUserId},
                '84.03', '15.97', '100.00', 'STANDARD_19')
        RETURNING id`;
      await tx`
        INSERT INTO transaction_items (transaction_id, product_id, line_subtotal_eur,
                                       line_vat_eur, line_total_eur, applied_tax_treatment_code, applied_vat_rate)
        VALUES (${t?.id ?? ''}, ${prod?.id ?? ''}, '84.03', '15.97', '100.00', 'STANDARD_19', '0.1900')`;
      const [pay] = await tx<{ id: string }[]>`
        INSERT INTO transaction_payments (transaction_id, payment_method, amount_eur)
        VALUES (${t?.id ?? ''}, 'CASH'::payment_method, '100.00')
        RETURNING id`;
      await tx`UPDATE products SET status = 'SOLD'::product_status, sold_at = now() WHERE id = ${prod?.id ?? ''}`;
      return pay?.id;
    });
    expect(payId).toBeTruthy();
  });
});
