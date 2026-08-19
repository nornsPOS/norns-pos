/**
 * accounts — better-auth provider records (credentials, OAuth).
 *
 * One row per (provider_id, account_id). The `credentials` provider stores
 * an argon2id `password` hash; OAuth providers store access/refresh tokens.
 * The DB-level CHECK constraint forbids mixing the two.
 *
 * Updatable columns from the app role:
 *   • password — for password changes
 *   • access_token, refresh_token, id_token — for OAuth token refresh
 *   • access_token_expires_at, refresh_token_expires_at
 *   • scope
 *   • updated_at (via trigger)
 *
 * NOT updatable:
 *   • user_id, provider_id, account_id — identity invariants
 *
 * NEVER DELETE: unlinking a provider is mediated by ADMIN flow (Phase 2+).
 * The account record persists as audit evidence of past authentication links.
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from './users.js';

export const accounts = pgTable(
  'accounts',
  {
    id: primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),

    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),

    password: text('password'),

    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),

    ...timestamps(),
  },
  (table) => ({
    providerAccountUq: unique('accounts_provider_account_uq').on(table.providerId, table.accountId),
    userIdIdx: index('accounts_user_id_idx').on(table.userId),
    credentialsOrOauth: check(
      'accounts_credentials_or_oauth',
      sql`
        (${table.providerId} = 'credentials' AND ${table.password} IS NOT NULL AND ${table.accessToken} IS NULL)
        OR
        (${table.providerId} <> 'credentials' AND ${table.password} IS NULL)
      `,
    ),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
