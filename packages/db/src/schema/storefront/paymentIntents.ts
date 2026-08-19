/**
 * payment_intents — provider-agnostic payment intent rows (Day 19).
 *
 * One per cart. UNIQUE on (provider, provider_intent_id) so a duplicate
 * provider intent ID (network retry) collides at the DB.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { carts } from './carts.js';
import { paymentIntentStatus, paymentProvider } from './enums.js';

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    cartId: uuid('cart_id')
      .notNull()
      .unique()
      .references(() => carts.id),
    provider: paymentProvider('provider').notNull(),
    providerIntentId: text('provider_intent_id').notNull(),
    status: paymentIntentStatus('status').notNull().default('CREATED'),
    amountEur: numeric('amount_eur', { precision: 18, scale: 2 }).notNull(),
    clientSecret: text('client_secret'),
    redirectUrl: text('redirect_url'),
    /**
     * Auf WELCHEM Konto diese Zahlung lief (0108). NULL heisst: über den
     * Plattformzugang selbst. Ohne dieses Feld ist eine Zahlung eines fremden
     * Kontos später nicht mehr auffindbar, was jede Erstattung blockiert.
     */
    stripeAccountId: text('stripe_account_id'),
    /** Die entnommene Vermittlungsgebühr in ganzen Cent. Unser Ertrag, nicht seiner. */
    applicationFeeCents: integer('application_fee_cents'),
    outcome: jsonb('outcome').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    providerIntentUq: uniqueIndex('payment_intents_provider_intent_uq').on(
      table.provider,
      table.providerIntentId,
    ),
    statusIdx: index('payment_intents_status_idx').on(table.status, table.createdAt.desc()),
    amountNonNeg: check('payment_intents_amount_nonneg', sql`${table.amountEur} >= 0`),
    outcomeIsObject: check(
      'payment_intents_outcome_is_object',
      sql`jsonb_typeof(${table.outcome}) = 'object'`,
    ),
  }),
);

export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type NewPaymentIntent = typeof paymentIntents.$inferInsert;
