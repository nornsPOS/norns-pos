/**
 * vouchers/ — Gutscheine (Day 21, migration 0019).
 *
 * § 3 Abs. 14 UStG:
 *   SINGLE_PURPOSE = VAT at issuance (definite product + tax)
 *   MULTI_PURPOSE  = VAT at redemption (generic value)
 */

import { sql } from 'drizzle-orm';
import { check, index, numeric, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { customers } from '../customers/customers.js';
import { taxTreatmentCodes } from '../reference/taxTreatmentCodes.js';
import { transactions } from '../transactions/transactions.js';

export const voucherType = pgEnum('voucher_type', ['SINGLE_PURPOSE', 'MULTI_PURPOSE']);
export const voucherStatus = pgEnum('voucher_status', ['ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED']);

export const vouchers = pgTable(
  'vouchers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    code: text('code').notNull().unique(),
    voucherType: voucherType('voucher_type').notNull(),
    issuedValueEur: numeric('issued_value_eur', { precision: 18, scale: 2 }).notNull(),
    currentBalanceEur: numeric('current_balance_eur', { precision: 18, scale: 2 }).notNull(),
    issuanceTaxTreatmentCode: text('issuance_tax_treatment_code').references(
      () => taxTreatmentCodes.code,
    ),
    issuedToCustomerId: uuid('issued_to_customer_id').references(() => customers.id),
    issuedByTransactionId: uuid('issued_by_transaction_id').references(() => transactions.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: voucherStatus('status').notNull().default('ACTIVE'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    statusIdx: index('vouchers_status_idx').on(table.status, table.expiresAt),
    customerIdx: index('vouchers_customer_idx')
      .on(table.issuedToCustomerId)
      .where(sql`${table.issuedToCustomerId} IS NOT NULL`),
    balanceLeIssued: check(
      'vouchers_balance_le_issued',
      sql`${table.currentBalanceEur} <= ${table.issuedValueEur}`,
    ),
    singlePurposeHasTax: check(
      'vouchers_single_purpose_has_tax',
      sql`${table.voucherType} <> 'SINGLE_PURPOSE' OR ${table.issuanceTaxTreatmentCode} IS NOT NULL`,
    ),
    codeFormat: check('vouchers_code_format', sql`${table.code} ~ '^[A-Z0-9]{8,32}$'`),
  }),
);

export type Voucher = typeof vouchers.$inferSelect;
export type NewVoucher = typeof vouchers.$inferInsert;

export const voucherRedemptions = pgTable(
  'voucher_redemptions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => vouchers.id),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    amountEur: numeric('amount_eur', { precision: 18, scale: 2 }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    voucherIdx: index('voucher_redemptions_voucher_idx').on(table.voucherId, table.redeemedAt),
    txIdx: index('voucher_redemptions_tx_idx').on(table.transactionId),
  }),
);

export type VoucherRedemption = typeof voucherRedemptions.$inferSelect;
export type NewVoucherRedemption = typeof voucherRedemptions.$inferInsert;
