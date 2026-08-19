/**
 * operating_expenses — one-off operating expenses (Betriebsausgaben) booked
 * against a business day (migration 0075).
 *
 * Distinct from `fixed_costs` (recurring) — these are individual spends:
 * a postage batch, a repair invoice, a marketing buy. The finance profit
 * endpoint sums these for the requested period by `business_day`.
 *
 * Money is stored as INTEGER CENTS. `business_day` is a DATE in Berlin local
 * terms (matches `berlin_business_day()` semantics used by transactions) so an
 * expense booked late at night lands on the correct trading day.
 *
 * NEVER hard-delete — corrections are a new row / an UPDATE; the audit_log
 * captures the actor. (GoBD: Aufzeichnungen are unveränderbar nachvollziehbar.)
 */

import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { ausgabeZahlweg, expenseCategory } from './enums.js';

export const operatingExpenses = pgTable(
  'operating_expenses',
  {
    id: primaryKey(),

    /** Trading day the spend is booked against (Berlin local). */
    businessDay: date('business_day').notNull(),

    category: expenseCategory('category').notNull(),

    /** Amount in integer cents (> 0). */
    amountCents: integer('amount_cents').notNull(),

    /**
     * Womit die Ausgabe bezahlt wurde (migration 0133). NUR `BAR` bewegt den
     * Kassenbestand und erscheint in der Kassenbericht-Rechnung. `UNBEKANNT`
     * sind Zeilen aus der Zeit vor dem 06.08.2026, in der die Frage nicht
     * gestellt wurde; sie werden ausdruecklich NICHT als bar geraten.
     */
    zahlweg: ausgabeZahlweg('zahlweg').notNull().default('UNBEKANNT'),

    note: text('note'),

    /** Actor who booked the expense — set by the route from req.actor.id. */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    ...timestamps(),
  },
  (table) => ({
    businessDayIdx: index('operating_expenses_business_day_idx').on(
      table.businessDay,
      table.category,
    ),

    /** Der Kassenbericht liest je Geschäftstag und Zahlweg (migration 0133). */
    tagZahlwegIdx: index('operating_expenses_tag_zahlweg_idx').on(
      table.businessDay,
      table.zahlweg,
    ),

    amountPositive: check('operating_expenses_amount_positive', sql`${table.amountCents} > 0`),
    noteLength: check(
      'operating_expenses_note_length',
      sql`${table.note} IS NULL OR length(${table.note}) <= 500`,
    ),
  }),
);

export type OperatingExpense = typeof operatingExpenses.$inferSelect;
export type NewOperatingExpense = typeof operatingExpenses.$inferInsert;
