/**
 * api_keys — programmatic access tokens (personal access tokens).
 *
 * A key lets a staff member or manager integrate an agent, LLM, or external
 * service with the API. It resolves to a non-interactive ACTOR carrying:
 *   • role       — ADMIN | CASHIER | READONLY (the permission ceiling)
 *   • read_only  — a HARD block on every mutation (POST/PUT/PATCH/DELETE),
 *                  independent of role. A "read-only key" sets this true.
 *   • scopes     — optional finer-grained allow-list (reserved; enforced later).
 *
 * SECURITY:
 *   • Only the SHA-256 HASH of the secret is stored; the plaintext is shown to
 *     the creator exactly once and is unrecoverable thereafter.
 *   • `token_prefix` (e.g. `w14k_a1b2c3d4`) is stored for display/identification.
 *   • NEVER DELETE — revocation is a soft `revoked_at` stamp so the audit trail
 *     and last-used forensics survive. The app role has no DELETE grant.
 *   • Creation is gated by an ADMIN + PIN step-up route; the app role may INSERT
 *     (mediated by that route) and UPDATE only last-used / revocation columns.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { userRole } from './enums.js';
import { users } from './users.js';

export const apiKeys = pgTable(
  'api_keys',
  {
    id: primaryKey(),

    /** Human label ("LLM-Agent", "Zapier", …). */
    label: text('label').notNull(),

    /** SHA-256 hex of the secret. The plaintext is never stored. */
    tokenHash: text('token_hash').notNull(),
    /** First chars of the token (incl. the `w14k_` marker) for display. */
    tokenPrefix: text('token_prefix').notNull(),

    /** Permission ceiling. */
    role: userRole('role').notNull(),
    /** Hard block on all mutations regardless of role. */
    readOnly: boolean('read_only').notNull().default(true),
    /** Reserved for finer-grained scopes; enforced in a later phase. */
    scopes: jsonb('scopes').$type<string[]>(),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: inet('last_used_ip'),

    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id),

    ...timestamps(),
  },
  (table) => ({
    tokenHashUq: uniqueIndex('api_keys_token_hash_uq').on(table.tokenHash),
    activeIdx: index('api_keys_active_idx')
      .on(table.id)
      .where(sql`${table.revokedAt} IS NULL`),
    createdByIdx: index('api_keys_created_by_idx').on(table.createdByUserId),
    labelLen: check(
      'api_keys_label_len',
      sql`char_length(${table.label}) BETWEEN 1 AND 120`,
    ),
  }),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
