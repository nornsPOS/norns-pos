/**
 * fixed_costs — recurring monthly fixed costs (Fixkosten), e.g. Miete, Strom,
 * Versicherung, Software-Abos (migration 0075).
 *
 * One row per cost line. `active_from` / `active_to` model the period a cost
 * line is live; `active_to` NULL means "still running". The finance profit
 * endpoint allocates the monthly_amount_cents to any month overlapped by the
 * [active_from, active_to] window (a day-level period gets the per-day share).
 *
 * Money is stored as INTEGER CENTS (not NUMERIC EUR) — this is an Owner-facing
 * planning table, distinct from the fiscal `transactions` ledger. The finance
 * API contract speaks cents end-to-end.
 *
 * NEVER hard-delete a historical cost line — close it with `active_to` so past
 * months keep their allocation. (The route deactivates instead of deleting.)
 */

import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';

export const fixedCosts = pgTable(
  'fixed_costs',
  {
    id: primaryKey(),

    /** Human label — "Miete Ladenlokal", "Stromabschlag", … */
    label: text('label').notNull(),

    /** Recurring monthly amount in integer cents (> 0). */
    monthlyAmountCents: integer('monthly_amount_cents').notNull(),

    /** First day this cost line is active (inclusive). */
    activeFrom: date('active_from').notNull(),
    /** Last day this cost line is active (inclusive). NULL = still running. */
    activeTo: date('active_to'),

    ...timestamps(),
  },
  (table) => ({
    activeIdx: index('fixed_costs_active_idx')
      .on(table.activeFrom)
      .where(sql`${table.activeTo} IS NULL`),
    rangeIdx: index('fixed_costs_range_idx').on(table.activeFrom, table.activeTo),

    labelLength: check('fixed_costs_label_length', sql`length(${table.label}) BETWEEN 1 AND 200`),
    amountPositive: check('fixed_costs_amount_positive', sql`${table.monthlyAmountCents} > 0`),
    rangeOrdered: check(
      'fixed_costs_range_ordered',
      sql`${table.activeTo} IS NULL OR ${table.activeTo} >= ${table.activeFrom}`,
    ),
  }),
);

export type FixedCost = typeof fixedCosts.$inferSelect;
export type NewFixedCost = typeof fixedCosts.$inferInsert;
