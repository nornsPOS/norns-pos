/**
 * transaction_items — per-line snapshot at sale time.
 *
 * INSERT-only. Each line carries a frozen copy of the applied tax treatment +
 * the §25a margin context. Even if the underlying product's tax_treatment_code
 * later changes, this line is locked.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { products } from '../products/products.js';
import { taxTreatmentCodes } from '../reference/taxTreatmentCodes.js';
import { transactions } from './transactions.js';

export const transactionItems = pgTable(
  'transaction_items',
  {
    id: primaryKey(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),

    lineSubtotalEur: numeric('line_subtotal_eur', { precision: 18, scale: 2 }).notNull(),
    lineVatEur: numeric('line_vat_eur', { precision: 18, scale: 2 }).notNull(),
    lineTotalEur: numeric('line_total_eur', { precision: 18, scale: 2 }).notNull(),

    appliedTaxTreatmentCode: text('applied_tax_treatment_code')
      .notNull()
      .references(() => taxTreatmentCodes.code),
    appliedVatRate: numeric('applied_vat_rate', { precision: 5, scale: 4 }),

    acquisitionCostEurSnapshot: numeric('acquisition_cost_eur_snapshot', {
      precision: 18,
      scale: 2,
    }),
    marginEur: numeric('margin_eur', { precision: 18, scale: 2 }),

    displayOrder: smallint('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

    // ── Day 21 (migration 0019): Rabatte ─────────────────────────────
    lineDiscountEur: numeric('line_discount_eur', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    lineDiscountReason: text('line_discount_reason'),
  },
  (table) => ({
    transactionIdx: index('transaction_items_transaction_id_idx').on(
      table.transactionId,
      table.displayOrder,
    ),
    productIdx: index('transaction_items_product_id_idx').on(table.productId),
    appliedTaxIdx: index('transaction_items_applied_tax_treatment_idx').on(
      table.appliedTaxTreatmentCode,
    ),

    balanceEquation: check(
      'transaction_items_balance_equation',
      sql`${table.lineSubtotalEur} + ${table.lineVatEur} = ${table.lineTotalEur}`,
    ),
    marginImpliesAcquisition: check(
      'transaction_items_margin_implies_acquisition',
      sql`(${table.marginEur} IS NULL) = (${table.acquisitionCostEurSnapshot} IS NULL)`,
    ),
    vatRateRange: check(
      'transaction_items_vat_rate_range',
      sql`${table.appliedVatRate} IS NULL OR (${table.appliedVatRate} >= 0 AND ${table.appliedVatRate} <= 1.0000)`,
    ),
  }),
);

export type TransactionItem = typeof transactionItems.$inferSelect;
export type NewTransactionItem = typeof transactionItems.$inferInsert;
