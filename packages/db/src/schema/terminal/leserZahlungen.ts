/**
 * leser_zahlungen — der Stand jeder servergesteuerten Leser-Zahlung.
 *
 * Warum nicht `payment_intents` (0018): die Tabelle haengt mit NOT NULL am
 * Web-Warenkorb, eine Kassenzahlung hat keinen.
 *
 * DER DOPPELBELASTUNGS-RIEGEL (Wanderung 0121): eine girocard-Zahlung mit
 * PIN erzeugt bei Stripe ZWEI Belastungen — erst die weich abgelehnte mit
 * `online_or_offline_pin_required`, dann die echte. Deshalb:
 *   • `status` SUCCEEDED ist endgueltig (kein Weg zurueck),
 *   • die weiche Ablehnung wird in `weiche_ablehnungen` GEZAEHLT, nie als
 *     Fehlschlag gebucht,
 *   • `idempotenz_schluessel` ist UNIQUE — dieselbe Geste eroeffnet nie
 *     eine zweite Zahlung.
 *
 * Geld in ganzen Cent als bigint (Hausregel). Stripe rechnet nichts.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/index.js';
import { paymentProvider } from '../storefront/enums.js';
import { kartenleser } from './kartenleser.js';

/** Eine Warenkorbzeile, wie sie auf dem Kundendisplay des Lesers stand. */
export interface LeserZahlungPosition {
  bezeichnung: string;
  menge: number;
  betragCents: number;
}

export const leserZahlungen = pgTable(
  'leser_zahlungen',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    /** SET NULL: ein entfernter Leser reisst seine Zahlungen nicht mit. */
    leserId: uuid('leser_id').references(() => kartenleser.id, { onDelete: 'set null' }),
    /** Schnappschuss der Leser-Kennung, damit der Beweis vollstaendig bleibt. */
    providerReaderId: text('provider_reader_id').notNull(),
    provider: paymentProvider('provider').notNull(),
    providerIntentId: text('provider_intent_id').notNull(),
    /** Auf wessen Konto die Zahlung lief — ohne das ist keine Erstattung auffindbar. */
    stripeAccountId: text('stripe_account_id').notNull(),
    betragCents: bigint('betrag_cents', { mode: 'bigint' }).notNull(),
    steuerCents: bigint('steuer_cents', { mode: 'bigint' }).notNull().default(0n),
    gebuehrCents: bigint('gebuehr_cents', { mode: 'bigint' }).notNull().default(0n),
    gebuehrBps: integer('gebuehr_bps'),
    gebuehrQuelle: text('gebuehr_quelle'),
    status: text('status').notNull().default('PROCESSING'),
    fehlerbild: text('fehlerbild'),
    fehlerMeldung: text('fehler_meldung'),
    weicheAblehnungen: integer('weiche_ablehnungen').notNull().default(0),
    /** Die echten Zeilen des Kundendisplays. */
    positionen: jsonb('positionen').notNull().$type<LeserZahlungPosition[]>(),
    idempotenzSchluessel: uuid('idempotenz_schluessel').notNull().unique(),
    angelegtVon: uuid('angelegt_von').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    intentJeAnbieter: uniqueIndex('leser_zahlungen_intent_je_anbieter').on(
      table.provider,
      table.providerIntentId,
    ),
    statusIdx: index('leser_zahlungen_status_idx').on(table.status, table.createdAt.desc()),
    betragPositiv: check('leser_zahlungen_betrag_positiv', sql`${table.betragCents} > 0`),
    statusErlaubt: check(
      'leser_zahlungen_status_erlaubt',
      sql`${table.status} IN ('PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED')`,
    ),
  }),
);

export type LeserZahlung = typeof leserZahlungen.$inferSelect;
export type NeueLeserZahlung = typeof leserZahlungen.$inferInsert;
