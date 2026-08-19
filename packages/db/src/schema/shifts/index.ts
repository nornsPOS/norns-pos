/**
 * shifts/ — per-cashier-per-device cash session (Day 21, migration 0019).
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { devices } from '../auth/devices.js';
import { users } from '../auth/users.js';

export const shiftStatus = pgEnum('shift_status', ['OPEN', 'CLOSED']);

export const cashMovementDirection = pgEnum('cash_movement_direction', [
  'OPENING_FLOAT',
  'INJECTION',
  'BANK_DROP',
  'SAFE_TRANSIT',
  'CLOSING_RECONCILIATION',
]);

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    openedByUserId: uuid('opened_by_user_id')
      .notNull()
      .references(() => users.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().default(sql`now()`),
    openingFloatEur: numeric('opening_float_eur', { precision: 18, scale: 2 }).notNull(),

    status: shiftStatus('status').notNull().default('OPEN'),

    blindCountEur: numeric('blind_count_eur', { precision: 18, scale: 2 }),
    systemExpectedEur: numeric('system_expected_eur', { precision: 18, scale: 2 }),
    /** Generated stored column — the SQL DDL is in migration 0019. */
    varianceEur: numeric('variance_eur', { precision: 18, scale: 2 }),

    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    oneOpenPerDevice: uniqueIndex('shifts_one_open_per_device_uq')
      .on(table.deviceId)
      .where(sql`${table.status} = 'OPEN'`),
    openedByIdx: index('shifts_opened_by_idx').on(table.openedByUserId, table.openedAt.desc()),
    closedHasEvidence: check(
      'shifts_closed_has_evidence',
      sql`${table.status} <> 'CLOSED' OR (
        ${table.closedByUserId} IS NOT NULL AND
        ${table.closedAt} IS NOT NULL AND
        ${table.blindCountEur} IS NOT NULL AND
        ${table.systemExpectedEur} IS NOT NULL
      )`,
    ),
  }),
);

export type Shift = typeof shifts.$inferSelect;
export type NewShift = typeof shifts.$inferInsert;

export const cashMovements = pgTable(
  'cash_movements',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id),
    direction: cashMovementDirection('direction').notNull(),
    amountEur: numeric('amount_eur', { precision: 18, scale: 2 }).notNull(),
    reason: text('reason').notNull(),
    witnessUserId: uuid('witness_user_id').references(() => users.id),
    performedByUserId: uuid('performed_by_user_id')
      .notNull()
      .references(() => users.id),
    externalRef: text('external_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    shiftIdx: index('cash_movements_shift_idx').on(table.shiftId, table.createdAt),
  }),
);

export type CashMovement = typeof cashMovements.$inferSelect;
export type NewCashMovement = typeof cashMovements.$inferInsert;
