/**
 * stripe_connected_accounts — das EIGENE Stripe-Konto des Händlers (0108).
 *
 * Connect Standard mit Direktbelastung. Die Zahlung wird auf diesem fremden
 * Konto eröffnet, Stripe zahlt unmittelbar an den Händler aus, und wir
 * entnehmen nur eine Vermittlungsgebühr. Wir nehmen zu keinem Zeitpunkt Geld
 * der Endkunden entgegen; genau deshalb ist Norns kein Zahlungsdienst im
 * Sinne des ZAG und braucht keine Erlaubnis der BaFin.
 *
 * Hier liegt bewusst KEIN Geheimnis: bei Standard-Konten spricht die
 * Plattform mit ihrem eigenen Schlüssel und nennt das fremde Konto nur in
 * einer Kopfzeile. Es gibt nichts zu stehlen ausser einer Kontokennung.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const stripeConnectedAccounts = pgTable(
  'stripe_connected_accounts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** Die Kontokennung bei Stripe, `acct_…`. Ein Laden, ein Konto. */
    stripeAccountId: text('stripe_account_id').notNull().unique(),
    country: text('country').notNull().default('DE'),
    defaultCurrency: text('default_currency').notNull().default('eur'),
    /**
     * Die einzige Wahrheit für die Kasse. Nur wenn wahr, darf eine Zahlung
     * eröffnet werden. Wird ausschliesslich aus einer signierten Meldung von
     * Stripe oder einer aktiven Abfrage gesetzt, nie aus einer Eingabe.
     */
    chargesEnabled: boolean('charges_enabled').notNull().default(false),
    payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
    detailsSubmitted: boolean('details_submitted').notNull().default(false),
    /** Was Stripe noch braucht, roh übernommen, damit die Oberfläche es sagen kann. */
    requirements: jsonb('requirements').notNull().default(sql`'{}'::jsonb`),
    /** Vermittlungsgebühr in Basispunkten. NULL = Vorgabe aus der Umgebung. */
    applicationFeeBps: integer('application_fee_bps'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    readyIdx: index('stripe_connected_accounts_ready_idx').on(
      table.chargesEnabled,
      table.updatedAt.desc(),
    ),
    idShape: check(
      'stripe_connected_accounts_id_shape',
      sql`${table.stripeAccountId} ~ '^acct_[A-Za-z0-9]+$'`,
    ),
    feeSane: check(
      'stripe_connected_accounts_fee_sane',
      sql`${table.applicationFeeBps} IS NULL OR (${table.applicationFeeBps} >= 0 AND ${table.applicationFeeBps} <= 1000)`,
    ),
    payoutsNeedDetails: check(
      'stripe_connected_accounts_payouts_need_details',
      sql`${table.payoutsEnabled} = false OR ${table.detailsSubmitted} = true`,
    ),
  }),
);

export type StripeConnectedAccount = typeof stripeConnectedAccounts.$inferSelect;
export type NewStripeConnectedAccount = typeof stripeConnectedAccounts.$inferInsert;
