/**
 * payment_commission_rates — die Vermittlungsgebühr von Norns (0110).
 *
 * Bis 0109 stand sie als EINE Zahl auf dem Stripe-Konto des Händlers. Damit
 * konnte ein Verkauf über den Marktplatz keine andere Gebühr tragen als einer
 * im eigenen Shop desselben Händlers, und ein Anbieterwechsel hätte die
 * Gebührenregel mitgerissen, obwohl sie mit dem Anbieter nichts zu tun hat.
 *
 * Die Gebühr ist eine Abmachung zwischen Norns und dem Händler. Deshalb steht
 * in dieser Tabelle kein Anbietername als Bauteil, sondern nur als Angabe.
 *
 * NULL heisst in BEIDEN Bezugsspalten "gilt für alle". Die Rangfolge über die
 * vier Stufen steht BEWUSST NICHT in SQL, sondern in
 * `apps/api-cloud/src/lib/commission.ts`, wo sie ohne Datenbank prüfbar ist.
 *
 * Die Anwendung darf hier ausschliesslich LESEN (siehe GRANTs in 0110).
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { paymentProvider } from './enums.js';

export const paymentCommissionRates = pgTable(
  'payment_commission_rates',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    provider: paymentProvider('provider').notNull(),
    /**
     * Der Kontobezug BEIM ANBIETER, bei Stripe `acct_…`. Bewusst ohne
     * Formprüfung: eine auf `acct_` festgenagelte Bedingung wäre genau die
     * Fessel, die diese Wanderung löst. NULL = jedes Konto dieses Anbieters.
     */
    accountRef: text('account_ref'),
    /** 'POS' | 'WEB' | 'MARKETPLACE' | 'EBAY'. NULL = jeder Kanal. */
    channel: text('channel'),
    feeBps: integer('fee_bps').notNull(),
    /** Wozu diese Zeile gehört. Bei einem Streit über eine Rechnung ist das die Frage. */
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    /**
     * ⚠️ UNVOLLSTÄNDIG GEGENÜBER DER DATENBANK, und das mit Absicht.
     *
     * Der echte Index in 0110 trägt zusätzlich NULLS NOT DISTINCT, und das
     * ist sein Kern, kein Feinschliff: nach der Vorgabe von Postgres sind
     * zwei NULL verschieden, und dann liessen sich beliebig viele
     * Hauspreis-Zeilen (NULL, NULL) anlegen. Welche davon gewänne, hinge an
     * der Reihenfolge der Zeilen, also am Zufall. Eine Gebühr, die vom Zufall
     * abhängt, ist ein Streit mit offenem Ausgang.
     *
     * Drizzle 0.36.4 kann das nicht ausdrücken (`IndexBuilder` kennt nur
     * `concurrently()`). Die Erklärung hier ist ohnehin nur Beschreibung: die
     * Wanderungen sind in diesem Muster von Hand geschrieben (ADR-0008 §9),
     * Drizzle erzeugt keine davon.
     *
     * Damit aus dieser Lücke keine STILLE Abweichung wird, prüft 0110 nach
     * dem Anlegen selbst nach und bricht ab, wenn NULLS NOT DISTINCT fehlt.
     * Genau diese Sorte Abweichung sitzt seit 0086 unbemerkt im Typ
     * `reservation_channel`, dessen Erklärung `WEB_RESERVATION` bis heute
     * nicht kennt.
     */
    scopeUq: uniqueIndex('payment_commission_rates_scope_uq').on(
      table.provider,
      table.accountRef,
      table.channel,
    ),
    lookupIdx: index('payment_commission_rates_lookup_idx').on(table.provider, table.accountRef),
    feeSane: check(
      'payment_commission_rates_fee_sane',
      sql`${table.feeBps} > 0 AND ${table.feeBps} <= 1000`,
    ),
    channelKnown: check(
      'payment_commission_rates_channel_known',
      sql`${table.channel} IS NULL OR ${table.channel} IN ('POS','WEB','MARKETPLACE','EBAY')`,
    ),
    accountRefNonEmpty: check(
      'payment_commission_rates_account_ref_nonempty',
      sql`${table.accountRef} IS NULL OR length(btrim(${table.accountRef})) > 0`,
    ),
  }),
);

export type PaymentCommissionRate = typeof paymentCommissionRates.$inferSelect;
export type NewPaymentCommissionRate = typeof paymentCommissionRates.$inferInsert;
