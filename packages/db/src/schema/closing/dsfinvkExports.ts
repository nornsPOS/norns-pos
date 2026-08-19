/**
 * dsfinvk_exports — DSFinV-K v2.0 bundle generation + delivery audit trail.
 *
 * Every export records: who requested it, what period it covers, when it was
 * generated, when delivered to the Steuerberater, the SHA-256 of the bundle.
 * NEVER deleted by app role.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { dsfinvkExportState } from './enums.js';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const dsfinvkExports = pgTable(
  'dsfinvk_exports',
  {
    id: primaryKey(),
    shopId: uuid('shop_id'),

    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),

    state: dsfinvkExportState('state').notNull().default('GENERATING'),

    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id),
    generatedAt: timestamp('generated_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveryMethod: text('delivery_method'),
    deliveryTarget: text('delivery_target'),

    r2Key: text('r2_key'),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'bigint' }),
    fileSha256: bytea('file_sha256'),

    transactionCount: integer('transaction_count'),
    dailyClosingsCount: integer('daily_closings_count'),
    totalGrossEur: numeric('total_gross_eur', { precision: 18, scale: 2 }),

    dailyClosingIds: uuid('daily_closing_ids').array().notNull().default(sql`'{}'::uuid[]`),

    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastErrorMessage: text('last_error_message'),

    ...timestamps(),
  },
  (table) => ({
    stateIdx: index('dsfinvk_exports_state_idx').on(table.state, table.createdAt.desc()),
    periodIdx: index('dsfinvk_exports_period_idx').on(table.periodStart, table.periodEnd),
    requestedByIdx: index('dsfinvk_exports_requested_by_idx').on(
      table.requestedByUserId,
      table.createdAt.desc(),
    ),

    periodOrder: check(
      'dsfinvk_exports_period_order',
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    sha256Length: check(
      'dsfinvk_exports_sha256_length',
      sql`${table.fileSha256} IS NULL OR octet_length(${table.fileSha256}) = 32`,
    ),
    generatedHasFile: check(
      'dsfinvk_exports_generated_has_file',
      sql`${table.state} NOT IN ('GENERATED', 'DELIVERED_TO_STEUERBERATER') OR (
        ${table.r2Key}         IS NOT NULL AND
        ${table.fileSha256}    IS NOT NULL AND
        ${table.fileSizeBytes} IS NOT NULL AND
        ${table.generatedAt}   IS NOT NULL
      )`,
    ),
    deliveredHasMarker: check(
      'dsfinvk_exports_delivered_has_marker',
      sql`${table.state} <> 'DELIVERED_TO_STEUERBERATER' OR (
        ${table.deliveredAt}    IS NOT NULL AND
        ${table.deliveryMethod} IS NOT NULL
      )`,
    ),
  }),
);

export type DsfinvkExport = typeof dsfinvkExports.$inferSelect;
export type NewDsfinvkExport = typeof dsfinvkExports.$inferInsert;
