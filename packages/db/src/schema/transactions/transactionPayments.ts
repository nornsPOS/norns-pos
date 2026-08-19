/**
 * transaction_payments — each payment leg.
 *
 * Supports split payment (cash + card). INSERT-only.
 * Never stores raw PAN — only masked last-4 (ADR-0013 PCI minimization).
 */

import { sql } from 'drizzle-orm';
import { check, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { paymentMethod } from './enums.js';
import { transactions } from './transactions.js';

export const transactionPayments = pgTable(
  'transaction_payments',
  {
    id: primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    paymentMethod: paymentMethod('payment_method').notNull(),
    amountEur: numeric('amount_eur', { precision: 18, scale: 2 }).notNull(),

    externalRef: text('external_ref'),
    zvtTerminalId: text('zvt_terminal_id'),
    zvtReceiptNumber: text('zvt_receipt_number'),
    zvtCardBrand: text('zvt_card_brand'),
    zvtCardPanMasked: text('zvt_card_pan_masked'),
    molliePaymentId: text('mollie_payment_id'),

    // ── Day 21 (migration 0019): trade-in link ───────────────────────
    tradeInAnkaufTransactionId: uuid('trade_in_ankauf_transaction_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    transactionIdx: index('transaction_payments_transaction_id_idx').on(table.transactionId),
    methodDayIdx: index('transaction_payments_method_day_idx').on(
      table.paymentMethod,
      sql`berlin_business_day(${table.createdAt})`,
    ),
    panMaskedShape: check(
      'transaction_payments_zvt_masked_pan_shape',
      sql`${table.zvtCardPanMasked} IS NULL OR ${table.zvtCardPanMasked} ~ '^\\*+\\d{4}$'`,
    ),
  }),
);

export type TransactionPayment = typeof transactionPayments.$inferSelect;
export type NewTransactionPayment = typeof transactionPayments.$inferInsert;
