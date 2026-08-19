/**
 * tse_transactions — Fiskaly SIGN DE V2 signature evidence per fiscal transaction.
 *
 * One row per `transactions` row (UNIQUE FK). The state machine supports the
 * offline-queue case (`QUEUED_OFFLINE`) so the sale never stops when Fiskaly
 * is unreachable.
 *
 * Discipline:
 *   • NEVER deleted by app role.
 *   • App can UPDATE state, signature fields, timing, error fields.
 *   • Trigger enforces valid state transitions + signature immutability
 *     after `FINISHED`.
 *   • Every state change emits a `tse.<state>` ledger event (chain extends).
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { transactions } from '../transactions/transactions.js';
import { tseState } from './enums.js';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const tseTransactions = pgTable(
  'tse_transactions',
  {
    id: primaryKey(),

    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transactions.id),

    state: tseState('state').notNull().default('QUEUED_OFFLINE'),
    stateReason: text('state_reason'),

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
    fiskalyTransactionNumber: bigint('fiskaly_transaction_number', { mode: 'bigint' }),

    signatureValue: text('signature_value'),
    signatureCounter: bigint('signature_counter', { mode: 'bigint' }),
    signatureAlgorithm: text('signature_algorithm'),

    certificateSerial: text('certificate_serial'),
    certificatePublicKey: text('certificate_public_key'),

    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),

    processType: text('process_type').notNull().default('Kassenbeleg-V1'),
    processDataHash: bytea('process_data_hash'),

    qrCodeData: text('qr_code_data'),

    createdOffline: boolean('created_offline').notNull().default(false),
    signedAt: timestamp('signed_at', { withTimezone: true }),

    retryCount: smallint('retry_count').notNull().default(0),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),

    ...timestamps(),
  },
  (table) => ({
    transactionIdUq: uniqueIndex('tse_transactions_unique_per_transaction').on(table.transactionId),

    queuedOfflineIdx: index('tse_transactions_queued_offline_idx')
      .on(table.createdAt)
      .where(sql`${table.state} = 'QUEUED_OFFLINE'`),
    activeIdx: index('tse_transactions_active_idx')
      .on(table.updatedAt)
      .where(sql`${table.state} = 'ACTIVE'`),
    finishedBusinessDayIdx: index('tse_transactions_finished_business_day_idx')
      .on(sql`berlin_business_day(${table.signedAt})`)
      .where(sql`${table.state} = 'FINISHED'`),
    failedIdx: index('tse_transactions_failed_idx')
      .on(table.lastErrorAt.desc())
      .where(sql`${table.state} = 'FAILED'`),
    fiskalyTxUq: uniqueIndex('tse_transactions_fiskaly_tx_uq')
      .on(table.fiskalyTransactionId)
      .where(sql`${table.fiskalyTransactionId} IS NOT NULL`),
    signatureCounterUq: uniqueIndex('tse_transactions_signature_counter_uq')
      .on(table.fiskalyTssId, table.signatureCounter)
      .where(sql`${table.signatureCounter} IS NOT NULL`),

    finishedHasSignature: check(
      'tse_transactions_finished_has_signature',
      sql`${table.state} <> 'FINISHED' OR (
        ${table.signatureValue}           IS NOT NULL AND
        ${table.signatureCounter}         IS NOT NULL AND
        ${table.fiskalyTransactionNumber} IS NOT NULL AND
        ${table.signatureAlgorithm}       IS NOT NULL AND
        ${table.startTime}                IS NOT NULL AND
        ${table.endTime}                  IS NOT NULL AND
        ${table.signedAt}                 IS NOT NULL AND
        ${table.qrCodeData}               IS NOT NULL
      )`,
    ),
    errorConsistency: check(
      'tse_transactions_error_consistency',
      sql`(${table.lastErrorAt} IS NULL AND ${table.lastErrorCode} IS NULL)
          OR (${table.lastErrorAt} IS NOT NULL AND ${table.lastErrorCode} IS NOT NULL)`,
    ),
    counterPositive: check(
      'tse_transactions_counter_positive',
      sql`${table.signatureCounter} IS NULL OR ${table.signatureCounter} > 0`,
    ),
    timeOrder: check(
      'tse_transactions_time_order',
      sql`${table.startTime} IS NULL OR ${table.endTime} IS NULL OR ${table.endTime} >= ${table.startTime}`,
    ),
    retryBounded: check(
      'tse_transactions_retry_count_bounded',
      sql`${table.retryCount} >= 0 AND ${table.retryCount} <= 100`,
    ),
  }),
);

export type TseTransaction = typeof tseTransactions.$inferSelect;
export type NewTseTransaction = typeof tseTransactions.$inferInsert;
