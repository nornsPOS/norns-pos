/**
 * shopper_sessions — B2C session table (Day 19).
 *
 * Separate from `sessions` (staff). Different cookie name (`warehouse14.shopper_session`),
 * different middleware, different TTLs (30-day rolling).
 */

import { sql } from 'drizzle-orm';
import { check, index, inet, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { shoppers } from './shoppers.js';

export const shopperSessions = pgTable(
  'shopper_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shopperId: uuid('shopper_id')
      .notNull()
      .references(() => shoppers.id),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
    /**
     * Soft kill-switch (0106), mirroring staff `sessions.revoked_at` (0089).
     * Stamped → the resolver drops the session on the next request, WITHOUT
     * deleting the row (so a revoke stays auditable). Null = live.
     */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    shopperIdx: index('shopper_sessions_shopper_idx').on(table.shopperId),
    expiresIdx: index('shopper_sessions_expires_idx').on(table.expiresAt),
    expiryAfterCreation: check(
      'shopper_sessions_expiry_after_creation',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  }),
);

export type ShopperSession = typeof shopperSessions.$inferSelect;
export type NewShopperSession = typeof shopperSessions.$inferInsert;
