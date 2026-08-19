/**
 * sessions — active authentication sessions.
 *
 * Day-2 directive (Basel 2026-05-24): the app role has **FULL** grants
 * including DELETE. Logout removes the session row immediately; expired-row
 * cleanup is a worker job.
 *
 * Linked to (user, device). The device link is nullable in V1 (admin-web
 * browser sessions don't carry mTLS device identity); mTLS-bound surfaces
 * (POS, Control Desktop) require a non-null device_id per ADR-0014 §3.
 *
 * NOT updatable:
 *   • id, user_id, device_id, token — identity invariants
 *   • created_at, expires_at — set once at session creation
 *   (Only updated_at is bumped via trigger on UPDATE; the app role
 *    rarely UPDATEs sessions — typically just inserts and deletes.)
 */

import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { devices } from './devices.js';
import { users } from './users.js';

export const sessions = pgTable(
  'sessions',
  {
    id: primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    token: text('token').notNull(),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),

    deviceId: uuid('device_id').references(() => devices.id),

    // Day-12a (migration 0014): step-up auth timestamp for sensitive actions.
    // Compared against the 10-minute window in `requireStepUp()` (ADR-0022 §4c).
    lastPinStepUpAt: timestamp('last_pin_step_up_at', { withTimezone: true }),

    // Migration 0089: explicit revocation kill switch. NULL = live. The
    // per-request auth loader requires `revoked_at IS NULL`, so stamping this
    // ends the session on the very next request (a lost device, a forced
    // sign-out) without waiting for expiry or erasing the user.
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    ...timestamps(),
  },
  (table) => ({
    tokenUq: uniqueIndex('sessions_token_uq').on(table.token),
    userIdIdx: index('sessions_user_id_idx').on(table.userId),
    expiresAtIdx: index('sessions_expires_at_idx').on(table.expiresAt),
    userLiveIdx: index('sessions_user_live_idx')
      .on(table.userId)
      .where(sql`${table.revokedAt} IS NULL`),
    deviceIdIdx: index('sessions_device_id_idx')
      .on(table.deviceId)
      .where(sql`${table.deviceId} IS NOT NULL`),
    expiryAfterCreation: check(
      'sessions_expiry_after_creation',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
  }),
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
