/**
 * staff_working_hours — per-staff weekly schedule.
 *
 * Times are LOCAL (Europe/Berlin). The capacity model uses this +
 * staff_time_off + shop_holidays inside available_slots().
 */

import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, smallint, time, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';
import { users } from '../auth/users.js';

export const staffWorkingHours = pgTable(
  'staff_working_hours',
  {
    id: primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    shopId: uuid('shop_id'),
    weekday: smallint('weekday').notNull(),
    startsAtLocal: time('starts_at_local').notNull(),
    endsAtLocal: time('ends_at_local').notNull(),
    effectiveFrom: date('effective_from')
      .notNull()
      .default(sql`(now() AT TIME ZONE 'Europe/Berlin')::date`),
    effectiveUntil: date('effective_until'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userWeekdayIdx: index('staff_working_hours_user_weekday_idx')
      .on(table.userId, table.weekday)
      .where(
        sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} >= (now() AT TIME ZONE 'Europe/Berlin')::date`,
      ),
    weekdayRange: check('staff_working_hours_weekday_range', sql`${table.weekday} BETWEEN 0 AND 6`),
    timeOrder: check(
      'staff_working_hours_time_order',
      sql`${table.endsAtLocal} > ${table.startsAtLocal}`,
    ),
    effectiveRange: check(
      'staff_working_hours_effective_range',
      sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} >= ${table.effectiveFrom}`,
    ),
  }),
);

export type StaffWorkingHours = typeof staffWorkingHours.$inferSelect;
export type NewStaffWorkingHours = typeof staffWorkingHours.$inferInsert;
