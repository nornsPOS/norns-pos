/**
 * shop_holidays — closed-day calendar.
 */

import { date, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { primaryKey } from '../_shared/columns.js';

export const shopHolidays = pgTable(
  'shop_holidays',
  {
    id: primaryKey(),
    shopId: uuid('shop_id'),
    closedDate: date('closed_date').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shopDateUq: uniqueIndex('shop_holidays_shop_date_uq').on(table.shopId, table.closedDate),
  }),
);

export type ShopHoliday = typeof shopHolidays.$inferSelect;
export type NewShopHoliday = typeof shopHolidays.$inferInsert;
