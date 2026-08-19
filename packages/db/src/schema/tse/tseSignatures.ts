/**
 * tse_signatures — durable, append-only server-side record of the Fiskaly
 * SIGN DE V2 signature produced per fiscal transaction (GoBD / BSI TR-03153).
 *
 * One row per `transactions` row (UNIQUE FK). The POS POSTs the signature it
 * received from the local TSE bridge immediately after a successful
 * finalize+FINISH, via POST /api/transactions/:id/tse-signature.
 *
 * Discipline:
 *   • App role: INSERT + SELECT only — NO UPDATE, NO DELETE.
 *   • A BEFORE UPDATE/DELETE trigger hard-refuses mutation (immutable evidence).
 *   • INSERT emits a `tse.signature_recorded` ledger event (the hash chain
 *     extends to cover the signature evidence).
 *
 * See migration 0054_tse_signature_persistence.sql. This is distinct from
 * `tse_transactions` (the Fiskaly state-machine / offline-queue table,
 * migration 0010): this table is the narrow, immutable fiscal-record of the
 * signature value as printed on the customer's receipt.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { transactions } from '../transactions/transactions.js';

export const tseSignatures = pgTable(
  'tse_signatures',
  {
    id: primaryKey(),

    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),

    /**
     * Kennung der Sicherungseinrichtung.
     *
     * ⚠️ TEXT, nicht UUID: eine Wolken-TSE vergibt UUIDs, ein Swissbit-Stecker
     * trägt eine SERIENNUMMER. Als UUID hätte eine Kasse mit Hardware-TSE
     * keinen einzigen Beleg schreiben können (Wanderung 0131). Der Spaltenname
     * stammt aus der Zeit, als es nur die Wolke gab.
     */
    fiskalyTssId: text('fiskaly_tss_id').notNull(),
    fiskalyClientId: text('fiskaly_client_id').notNull(),
    fiskalyTransactionId: text('fiskaly_transaction_id'),
    fiskalyTransactionNumber: bigint('fiskaly_transaction_number', { mode: 'bigint' }).notNull(),

    signatureValue: text('signature_value').notNull(),
    signatureCounter: bigint('signature_counter', { mode: 'bigint' }).notNull(),
    signatureAlgorithm: text('signature_algorithm'),

    /**
     * ── DIE ZWEI ANGABEN, DIE EINE SIGNATUR ERST NACHRECHENBAR MACHEN ──────
     *
     * Bis zum 13.08.2026 gab es hier keinen Ort für sie, und deshalb blieben
     * `TSE_SERIAL` und `TSE_PUBLIC_KEY` in JEDEM gezogenen Prüferpaket leer
     * (DSFinV-K 2.4, `tse.csv`).
     *
     * Was das für eine Prüfung heisst: eine Signatur ohne öffentlichen
     * Schlüssel ist für den Prüfer eine Zeichenkette ohne Beweiswert — er kann
     * sie nicht verifizieren. Und ohne Seriennummer kann er sie keiner
     * Sicherungseinrichtung zuordnen. Der Auszug sah vollständig aus und trug
     * an der entscheidenden Stelle nichts.
     *
     * NULL erlaubt: die Belege, die vor dieser Wanderung entstanden sind,
     * haben die Werte nie mitbekommen. Sie nachträglich zu ERFINDEN wäre eine
     * unrichtige Angabe nach § 146a AO und damit schlimmer als die Lücke.
     * Der Export weist eine fehlende Angabe deshalb als leer aus, statt sie
     * abzuleiten.
     */
    tssSerialNumber: text('tss_serial_number'),
    signaturePublicKey: text('signature_public_key'),

    processType: text('process_type').notNull().default('Kassenbeleg-V1'),
    qrCodeData: text('qr_code_data'),

    tseStartTime: timestamp('tse_start_time', { withTimezone: true }),
    tseEndTime: timestamp('tse_end_time', { withTimezone: true }),

    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    deviceId: uuid('device_id'),
    recordedByUserId: uuid('recorded_by_user_id'),

    ...timestamps(),
  },
  (table) => ({
    transactionIdUq: uniqueIndex('tse_signatures_unique_per_transaction').on(table.transactionId),

    signatureCounterUq: uniqueIndex('tse_signatures_signature_counter_uq').on(
      table.fiskalyTssId,
      table.signatureCounter,
    ),
    txNumberUq: uniqueIndex('tse_signatures_tx_number_uq').on(
      table.fiskalyTssId,
      table.fiskalyTransactionNumber,
    ),
    fiskalyTxUq: uniqueIndex('tse_signatures_fiskaly_tx_uq')
      .on(table.fiskalyTransactionId)
      .where(sql`${table.fiskalyTransactionId} IS NOT NULL`),
    recordedBusinessDayIdx: index('tse_signatures_recorded_business_day_idx').on(
      sql`berlin_business_day(${table.recordedAt})`,
    ),

    counterPositive: check('tse_signatures_counter_positive', sql`${table.signatureCounter} > 0`),
    txNumberPositive: check(
      'tse_signatures_tx_number_positive',
      sql`${table.fiskalyTransactionNumber} > 0`,
    ),
    timeOrder: check(
      'tse_signatures_time_order',
      sql`${table.tseStartTime} IS NULL OR ${table.tseEndTime} IS NULL OR ${table.tseEndTime} >= ${table.tseStartTime}`,
    ),
  }),
);

export type TseSignature = typeof tseSignatures.$inferSelect;
export type NewTseSignature = typeof tseSignatures.$inferInsert;
