/**
 * kartenleser — die beim Zahlungsanbieter registrierten Leser des Haendlers.
 *
 * MANDANTENDATEN (Wanderung 0121, Muster 0119): die Kennungen (`tmr_…`)
 * kommen ueber die API herein, niemals per Wanderung. Die Tabelle ist
 * anbieterneutral gebaut (Spalte `provider`), auch wenn heute nur Stripe
 * Terminal sie fuellt — die 0110-Doktrin: der Anbieter ist austauschbar.
 */

import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from '../auth/index.js';
import { paymentProvider } from '../storefront/enums.js';

export const kartenleser = pgTable(
  'kartenleser',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: paymentProvider('provider').notNull(),
    /** Die Kennung beim Anbieter, bei Stripe `tmr_…`. */
    providerReaderId: text('provider_reader_id').notNull().unique(),
    /** Der Name, unter dem die Kasse den Leser anbietet ("Tresen links"). */
    bezeichnung: text('bezeichnung').notNull(),
    geraetetyp: text('geraetetyp'),
    seriennummer: text('seriennummer'),
    /** Der Standort (`tml_…`) beim Anbieter. */
    providerLocationId: text('provider_location_id'),
    /** Der zuletzt bei Stripe gesehene Stand — Auskunft, keine Wahrheit. */
    zuletztGesehenStatus: text('zuletzt_gesehen_status'),
    registriertAm: timestamp('registriert_am', { withTimezone: true }).notNull().default(sql`now()`),
    registriertVon: uuid('registriert_von').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => ({
    kennungForm: check(
      'kartenleser_kennung_form',
      sql`${table.providerReaderId} ~ '^tmr_[A-Za-z0-9]+$'`,
    ),
    bezeichnungLaenge: check(
      'kartenleser_bezeichnung_laenge',
      sql`char_length(${table.bezeichnung}) BETWEEN 1 AND 100`,
    ),
  }),
);

export type Kartenleser = typeof kartenleser.$inferSelect;
export type NeuerKartenleser = typeof kartenleser.$inferInsert;
