/**
 * beleg_logo — das Beleg-Logo des Haendlers, EIN Mandantendatum, EINE Zeile.
 *
 * Warum eine eigene Tabelle und nicht `system_settings` (26.07.2026): der
 * Einstellungsweg ist ein kuratiertes jsonb-TEXT-Muster mit 200-Zeichen-
 * Deckel — ein 256-KB-Binaerbild passt dort nicht hinein. Und warum nicht das
 * Foto-Lager auf der Platte: das Logo muss die taegliche Datenbanksicherung
 * MITFAHREN (die Rueckspielung ist bewiesen, die API-Platte nicht).
 *
 * Gespeichert wird das BEREINIGTE Original (SVG nach der Schadcode-Waesche,
 * PNG/JPEG nach Format- und Kantenpruefung) — nie das rohe Hochgeladene.
 * Ohne Zeile druckt der Bon die dezente norns.de-Systemzeile; einen
 * Vorgabewert gibt es absichtlich NICHT (mandantenneutral, Doktrin 26.07.).
 *
 * Siehe Wanderung 0119.
 */

import { sql } from 'drizzle-orm';
import { check, customType, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';

/** Lokaler bytea-Typ, dasselbe Muster wie in customers/kycDocuments. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const belegLogo = pgTable(
  'beleg_logo',
  {
    /** Immer 1 — genau eine Zeile je Mandant, jeder Schreibweg ist ein UPSERT. */
    id: smallint('id').primaryKey().default(1),
    /** 'svg' | 'png' | 'jpeg'. */
    format: text('format').notNull(),
    /** Das bereinigte Original, hoechstens 256 KB (CHECK in 0119). */
    daten: bytea('daten').notNull(),
    hochgeladenAm: timestamp('hochgeladen_am', { withTimezone: true }).notNull().defaultNow(),
    /** SET NULL beim Loeschen des Kontos — das Logo gehoert dem Laden. */
    hochgeladenVon: uuid('hochgeladen_von').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => ({
    nurEineZeile: check('beleg_logo_nur_eine_zeile', sql`${table.id} = 1`),
    formatErlaubt: check('beleg_logo_format', sql`${table.format} IN ('svg', 'png', 'jpeg')`),
  }),
);

export type BelegLogoZeile = typeof belegLogo.$inferSelect;
export type NeueBelegLogoZeile = typeof belegLogo.$inferInsert;
