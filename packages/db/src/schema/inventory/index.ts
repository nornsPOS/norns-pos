/**
 * inventory/ — Stichtagsinventur (Day 21, migration 0019).
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';
import { products } from '../products/products.js';

export const inventorySessionStatus = pgEnum('inventory_session_status', ['OPEN', 'CLOSED']);
export const inventoryScanMatch = pgEnum('inventory_scan_match', [
  'MATCHED',
  'UNKNOWN_BARCODE',
  'DUPLICATE',
  'EXPECTED_BUT_SOLD',
  'UNEXPECTED',
]);

export const inventorySessions = pgTable(
  'inventory_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    openedByUserId: uuid('opened_by_user_id')
      .notNull()
      .references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().default(sql`now()`),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    status: inventorySessionStatus('status').notNull().default('OPEN'),
    expectedCount: integer('expected_count').notNull().default(0),
    matchedCount: integer('matched_count'),
    missingCount: integer('missing_count'),
    unexpectedCount: integer('unexpected_count'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    oneOpen: uniqueIndex('inventory_sessions_one_open_uq')
      .on(sql`(1)`)
      .where(sql`${table.status} = 'OPEN'`),
    closedHasEvidence: check(
      'inventory_sessions_closed_has_evidence',
      sql`${table.status} <> 'CLOSED' OR (
        ${table.closedByUserId} IS NOT NULL AND
        ${table.closedAt} IS NOT NULL AND
        ${table.matchedCount} IS NOT NULL AND
        ${table.missingCount} IS NOT NULL AND
        ${table.unexpectedCount} IS NOT NULL
      )`,
    ),
  }),
);

export type InventorySession = typeof inventorySessions.$inferSelect;
export type NewInventorySession = typeof inventorySessions.$inferInsert;

export const inventoryScans = pgTable(
  'inventory_scans',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => inventorySessions.id),
    rawBarcode: text('raw_barcode').notNull(),
    productId: uuid('product_id').references(() => products.id),
    matchStatus: inventoryScanMatch('match_status').notNull(),
    scannedByUserId: uuid('scanned_by_user_id')
      .notNull()
      .references(() => users.id),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    sessionIdx: index('inventory_scans_session_idx').on(table.sessionId, table.scannedAt),
    productIdx: index('inventory_scans_product_idx')
      .on(table.productId)
      .where(sql`${table.productId} IS NOT NULL`),
  }),
);

export type InventoryScan = typeof inventoryScans.$inferSelect;
export type NewInventoryScan = typeof inventoryScans.$inferInsert;
