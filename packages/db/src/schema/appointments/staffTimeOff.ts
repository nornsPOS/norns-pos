/**
 * staff_time_off — specific absence ranges (vacation, sick days).
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { users } from '../auth/users.js';

export const staffTimeOff = pgTable(
  'staff_time_off',
  {
    id: primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason'),
    approvedBy: uuid('approved_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userRangeIdx: index('staff_time_off_user_range_idx').on(
      table.userId,
      table.startsAt,
      table.endsAt,
    ),
    range: check('staff_time_off_range', sql`${table.endsAt} > ${table.startsAt}`),
  }),
);

export type StaffTimeOff = typeof staffTimeOff.$inferSelect;
export type NewStaffTimeOff = typeof staffTimeOff.$inferInsert;
