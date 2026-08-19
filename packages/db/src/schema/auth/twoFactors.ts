/**
 * two_factors — TOTP secrets per user.
 *
 * Mandatory enabled=true for ADMIN and READONLY roles (memory.md §3).
 * CASHIER uses PIN login on the POS, not TOTP.
 *
 * The `secret` and `backup_codes` columns store pgp_sym_encrypt() byte
 * sequences (pgcrypto from migration 0001). The symmetric key is held in
 * the API process from Oracle Vault (ADR-0012 §7); the DB has no plaintext.
 *
 * Updatable from the app role: secret (rotate), backup_codes (regenerate),
 * enabled (user toggles, gated by app-level ADMIN policy).
 *
 * DELETE permitted from the app role (user-disable flow, ADMIN-mediated).
 */

import { boolean, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from './users.js';

export const twoFactors = pgTable('two_factors', {
  id: primaryKey(),

  userId: uuid('user_id')
    .notNull()
    .unique()
    .references(() => users.id),

  secret: text('secret').notNull(),
  backupCodes: text('backup_codes'),

  enabled: boolean('enabled').notNull().default(false),

  ...timestamps(),
});

export type TwoFactor = typeof twoFactors.$inferSelect;
export type NewTwoFactor = typeof twoFactors.$inferInsert;
