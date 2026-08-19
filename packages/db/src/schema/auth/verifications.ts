/**
 * verifications — short-lived verification tokens.
 *
 * Used by better-auth for email-verification, password-reset, magic-link, etc.
 * Tokens carry a TTL via `expires_at`; consume-then-delete is the standard pattern.
 *
 * The app role has SELECT, INSERT, DELETE (per migration 0004 §9). UPDATE is
 * intentionally NOT granted — verification rows are insert-and-consume, never
 * mutated.
 */

import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';

export const verifications = pgTable(
  'verifications',
  {
    id: primaryKey(),

    identifier: text('identifier').notNull(),
    value: text('value').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    ...timestamps(),
  },
  (table) => ({
    identifierIdx: index('verifications_identifier_idx').on(table.identifier),
    expiresAtIdx: index('verifications_expires_at_idx').on(table.expiresAt),
  }),
);

export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
