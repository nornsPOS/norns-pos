/**
 * tse_daily_archives — KassenSichV §10 daily TSE archive evidence (I-2).
 *
 * §10 KassenSichV mandates that the complete set of a day's TSE transactions is
 * exported and archived. One row per calendar day records the Fiskaly TSS export
 * bundle: where the TAR lives in R2, its SHA-256, how many transactions it
 * covered, and the GENERATING → GENERATED | FAILED lifecycle. Append-only in
 * spirit (the worker only flips status forward + fills the evidence columns).
 *
 * Written by the `tse_archive_exporter` worker job (daily 03:00). See
 * migration 0040_tse_daily_archives.sql.
 */

import { date, integer, pgEnum, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';

export const tseArchiveStatus = pgEnum('tse_archive_status', ['GENERATING', 'GENERATED', 'FAILED']);

export const tseDailyArchives = pgTable(
  'tse_daily_archives',
  {
    id: primaryKey(),
    /** The calendar day this archive covers. One archive per day. */
    archiveDate: date('archive_date').notNull(),
    status: tseArchiveStatus('status').notNull().default('GENERATING'),
    /** Cloudflare R2 object key for the TAR bundle (null until GENERATED). */
    fileR2Key: text('file_r2_key'),
    /** Lowercase hex SHA-256 of the archive bytes (null until GENERATED). */
    sha256: text('sha256'),
    /** Failure detail when status = FAILED. */
    errorMessage: text('error_message'),
    /** Number of FINISHED TSE transactions signed on `archiveDate`. */
    transactionCount: integer('transaction_count').notNull().default(0),
    /** When the archive reached a terminal state (GENERATED or FAILED). */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => ({
    archiveDateUq: uniqueIndex('tse_daily_archives_archive_date_uq').on(table.archiveDate),
  }),
);

export type TseDailyArchive = typeof tseDailyArchives.$inferSelect;
export type NewTseDailyArchive = typeof tseDailyArchives.$inferInsert;
