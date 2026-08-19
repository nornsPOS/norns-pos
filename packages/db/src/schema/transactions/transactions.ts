/**
 * transactions — fiscal transaction master record.
 *
 * Storno discipline (ADR-0016 §1, Day-7 directive):
 *   • A storno is a NEW row with `stornoOfTransactionId` FK to the original.
 *   • Storno carries NEGATIVE money columns whose magnitudes mirror the original.
 *   • `SUM(total_eur)` over a business day naturally yields net revenue.
 *   • Storno-of-storno is forbidden — enforced by trigger.
 *
 * Updatable from app role: receipt_locator, printed_at, notes_internal, updated_at.
 * Everything else is locked at INSERT.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { devices } from '../auth/devices.js';
import { users } from '../auth/users.js';
import { customers } from '../customers/customers.js';
import { taxTreatmentCodes } from '../reference/taxTreatmentCodes.js';
import { salesChannel, shippingStatus } from '../storefront/enums.js';
import { transactionDirection } from './enums.js';

const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const transactions = pgTable(
  'transactions',
  {
    id: primaryKey(),
    shopId: uuid('shop_id'),

    direction: transactionDirection('direction').notNull(),
    stornoOfTransactionId: uuid('storno_of_transaction_id'),

    // 0148 (19.08.2026): Warenruecknahme nach Tz. 4.2.5 — eigener Beleg mit

    // negativen Betraegen, BON_STORNO bleibt 0. Mehrere je Original erlaubt.

    rueckgabeZuTransactionId: uuid('rueckgabe_zu_transaction_id'),

    customerId: uuid('customer_id').references(() => customers.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    cashierUserId: uuid('cashier_user_id')
      .notNull()
      .references(() => users.id),

    subtotalEur: numeric('subtotal_eur', { precision: 18, scale: 2 }).notNull(),
    vatEur: numeric('vat_eur', { precision: 18, scale: 2 }).notNull(),
    totalEur: numeric('total_eur', { precision: 18, scale: 2 }).notNull(),
    taxTreatmentCode: text('tax_treatment_code')
      .notNull()
      .references(() => taxTreatmentCodes.code),

    receiptLocator: text('receipt_locator')
      .notNull()
      .default(
        sql`'RCP-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY') || '-' || lpad(nextval('receipt_locator_seq')::text, 6, '0')`,
      ),
    printedAt: timestamp('printed_at', { withTimezone: true }),
    notesInternal: text('notes_internal'),

    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull().defaultNow(),


    // 0147 (19.08.2026): Beginn des Vorgangs (erstes Stueck im Korb). NULL =


    // unbekannt; die DSFinV-K-Ausfuhr faellt dann auf finalized_at zurueck.


    vorgangBegonnenAt: timestamp('vorgang_begonnen_at', { withTimezone: true }),

    // ── Wanderung 0118: der Verkauf gehoert in seinen eigenen Tag ─────
    //
    // Am 26.07.2026 gemessen: `finalized_at` fiel auf `DEFAULT now()`, also
    // auf die Zeit, zu der der SERVER den Vorgang entgegennahm. Ein Verkauf
    // um 17:50 ohne Netz, der am naechsten Morgen abfloss, landete im Z-Bon
    // des naechsten Tages. `erfasstAm` ist die vom Geraet erfasste Zeit
    // (§ 146a AO / DSFinV-K: die Kasse ist die Quelle), `eingegangenAm` die
    // Eingangszeit des Servers daneben — damit die Verschiebung pruefbar
    // bleibt (§ 146 Abs. 4 AO).
    erfasstAm: timestamp('erfasst_am', { withTimezone: true }),
    eingegangenAm: timestamp('eingegangen_am', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Gesetzt NUR bei einem nachtraeglichen Eingang: der Kassentag, zu dem
     * der Vorgang wirklich gehoert, dessen Abschluss aber schon FINALIZED
     * war. Der Vorgang selbst ist dann auf dem laufenden Tag gebucht.
     */
    nachtragBezugstag: date('nachtrag_bezugstag'),

    // ── Day 19 (migration 0018): omnichannel + shipping ───────────────
    salesChannel: salesChannel('sales_channel').notNull().default('POS'),
    shippingStatus: shippingStatus('shipping_status').notNull().default('NOT_REQUIRED'),
    shippingAddressEncrypted: bytea('shipping_address_encrypted'),
    shippingCarrier: text('shipping_carrier'),
    trackingNumber: text('tracking_number'),

    // ── Day 21 (migration 0019): retail core extensions ──────────────
    pairedWithTransactionId: uuid('paired_with_transaction_id'),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    suspiciousAmlFlag: boolean('suspicious_aml_flag').notNull().default(false),
    suspiciousAmlReason: text('suspicious_aml_reason'),
    suspiciousFlaggedByUserId: uuid('suspicious_flagged_by_user_id'),
    receiptDeclinedAt: timestamp('receipt_declined_at', { withTimezone: true }),
    receiptEmailedAt: timestamp('receipt_emailed_at', { withTimezone: true }),
    shiftId: uuid('shift_id'),

    // ── Migration 0028: client-supplied idempotency token (§19.2 C-4) ─
    // NULL is permitted for pre-V1 rows and worker-generated transactions.
    // V1 POS clients MUST supply a UUID. The partial UNIQUE INDEX
    // `transactions_idempotency_key_uniq` is the enforcement layer.
    idempotencyKey: uuid('idempotency_key'),

    /**
     * Wanderung 0142: die laufende Nummer eines Belegs, der GEBUCHT wurde,
     * bevor eine technische Sicherheitseinrichtung eingerichtet war.
     *
     * NULL bei jedem anderen Beleg, und das ist die weit überwiegende Mehrheit.
     * Die Zahl steht bewusst AN DER ZEILE und nicht als Zähler in den
     * Einstellungen: ein Zähler liesse sich zurückstellen, und dann wären es
     * zwanzig statt zehn, ohne dass irgendwo etwas rot würde. So ist der
     * Vorrat eine Messung über echte Zeilen.
     *
     * Der eindeutige Teilindex `transactions_ohne_tse_nr_einmalig` verhindert,
     * dass zwei gleichzeitig kassierende Kassen dieselbe Nummer vergeben.
     */
    ohneTseNr: integer('ohne_tse_nr'),

    ...timestamps(),
  },
  (table) => ({
    receiptLocatorUq: uniqueIndex('transactions_receipt_locator_uq').on(table.receiptLocator),

    businessDayIdx: index('transactions_business_day_idx').on(
      sql`berlin_business_day(${table.finalizedAt})`,
    ),
    customerIdx: index('transactions_customer_idx')
      .on(table.customerId, table.finalizedAt.desc())
      .where(sql`${table.customerId} IS NOT NULL`),
    stornoIdx: index('transactions_storno_idx')
      .on(table.stornoOfTransactionId)
      .where(sql`${table.stornoOfTransactionId} IS NOT NULL`),
    directionDayIdx: index('transactions_direction_day_idx').on(
      table.direction,
      sql`berlin_business_day(${table.finalizedAt})`,
    ),
    taxTreatmentIdx: index('transactions_tax_treatment_idx').on(table.taxTreatmentCode),
    cashierDayIdx: index('transactions_cashier_day_idx').on(
      table.cashierUserId,
      sql`berlin_business_day(${table.finalizedAt})`,
    ),
    // 0118: die Nachtraege eines Zeitraums in einem Griff auffindbar.
    nachtragIdx: index('transactions_nachtrag_idx')
      .on(table.nachtragBezugstag)
      .where(sql`${table.nachtragBezugstag} IS NOT NULL`),
    // §19.2 C-4: partial unique index — only NON-NULL keys must be unique.
    idempotencyKeyUq: uniqueIndex('transactions_idempotency_key_uniq')
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),

    balanceEquation: check(
      'transactions_balance_equation',
      sql`${table.subtotalEur} + ${table.vatEur} = ${table.totalEur}`,
    ),
    signDiscipline: check(
      'transactions_sign_discipline',
      sql`
        (${table.stornoOfTransactionId} IS NULL     AND ${table.totalEur} >= 0 AND ${table.subtotalEur} >= 0 AND ${table.vatEur} >= 0)
        OR
        (${table.stornoOfTransactionId} IS NOT NULL AND ${table.totalEur} <= 0 AND ${table.subtotalEur} <= 0 AND ${table.vatEur} <= 0)
      `,
    ),
    stornoNotSelf: check(
      'transactions_storno_not_self',
      sql`${table.stornoOfTransactionId} IS NULL OR ${table.stornoOfTransactionId} <> ${table.id}`,
    ),
  }),
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
