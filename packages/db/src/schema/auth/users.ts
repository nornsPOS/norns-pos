/**
 * users — Warehouse14 user records.
 *
 * Discipline (per Basel's Day-2 directive 2026-05-24):
 *   • NEVER deleted by the app role. GDPR deletion is a soft delete via
 *     `softDeletedAt` plus a PII scrub stamped by `anonymizedAt`. Fiscal
 *     joins (transactions, ledger_events, audit_log, devices.paired_by_user_id)
 *     retain referential integrity.
 *
 * Updatable columns from the app role (per migration 0004 §9):
 *   • name, image, preferred_language, email_verified
 *   • soft_deleted_at, anonymized_at   ← the GDPR mechanism
 *   • updated_at (via trigger)
 *
 * NOT updatable from the app role:
 *   • email      — change is admin-mediated
 *   • role       — admin-mediated
 *   • shop_id    — admin-mediated
 *   • id, created_at — immutable
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { citext } from '../_shared/columnTypes.js';
import { primaryKey, timestamps } from '../_shared/columns.js';
import { userRole } from './enums.js';

export const users = pgTable(
  'users',
  {
    id: primaryKey(),

    // better-auth core
    email: citext('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull(),
    image: text('image'),

    // Warehouse14 extensions
    role: userRole('role').notNull(),
    preferredLanguage: char('preferred_language', { length: 2 }).notNull().default('de'),
    shopId: uuid('shop_id'),

    // GDPR markers
    softDeletedAt: timestamp('soft_deleted_at', { withTimezone: true }),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),

    // Day-12a (migration 0014): Owner flag — partial-UNIQUE WHERE TRUE.
    isOwner: boolean('is_owner').notNull().default(false),

    // Day-12a (migration 0014): POS PIN auth columns.
    posPinHash: text('pos_pin_hash'),
    posPinSetAt: timestamp('pos_pin_set_at', { withTimezone: true }),
    posPinFailedAttempts: integer('pos_pin_failed_attempts').notNull().default(0),
    posPinLockedUntil: timestamp('pos_pin_locked_until', { withTimezone: true }),

    // Migration 0042 (Decision #37): duress PIN — a distinct second PIN that
    // logs in normally while firing a silent alarm.
    duressPinHash: text('duress_pin_hash'),
    duressPinSetAt: timestamp('duress_pin_set_at', { withTimezone: true }),

    ...timestamps(),
  },
  (table) => ({
    emailActiveUq: uniqueIndex('users_email_active_uq')
      .on(table.email)
      .where(sql`${table.softDeletedAt} IS NULL`),
    roleActiveIdx: index('users_role_active_idx')
      .on(table.role)
      .where(sql`${table.softDeletedAt} IS NULL`),
    shopIdIdx: index('users_shop_id_idx').on(table.shopId).where(sql`${table.shopId} IS NOT NULL`),
    preferredLanguageCheck: check(
      'users_preferred_language_chk',
      sql`${table.preferredLanguage} IN ('de', 'en', 'ar')`,
    ),
    anonymizedImpliesSoftDeleted: check(
      'users_anonymized_implies_soft_deleted',
      sql`${table.anonymizedAt} IS NULL OR ${table.softDeletedAt} IS NOT NULL`,
    ),
    anonymizedAfterSoftDeleted: check(
      'users_anonymized_after_soft_deleted',
      sql`${table.anonymizedAt} IS NULL OR ${table.anonymizedAt} >= ${table.softDeletedAt}`,
    ),

    // Day-12a (migration 0014) extensions.
    onlyOneOwnerUq: uniqueIndex('users_only_one_owner_uq')
      .on(table.isOwner)
      .where(sql`${table.isOwner} = TRUE`),
    ownerImpliesAdmin: check(
      'users_owner_implies_admin',
      sql`${table.isOwner} = FALSE OR ${table.role} = 'ADMIN'`,
    ),
    pinHashSetTogether: check(
      'users_pin_hash_set_together',
      sql`(${table.posPinHash} IS NULL AND ${table.posPinSetAt} IS NULL)
        OR (${table.posPinHash} IS NOT NULL AND ${table.posPinSetAt} IS NOT NULL)`,
    ),
    pinAttemptsNonneg: check('users_pin_attempts_nonneg', sql`${table.posPinFailedAttempts} >= 0`),

    // Migration 0042 (Decision #37): duress PIN constraints.
    duressPinHashSetTogether: check(
      'users_duress_pin_hash_set_together',
      sql`(${table.duressPinHash} IS NULL AND ${table.duressPinSetAt} IS NULL)
        OR (${table.duressPinHash} IS NOT NULL AND ${table.duressPinSetAt} IS NOT NULL)`,
    ),
    duressPinDistinct: check(
      'users_duress_pin_distinct',
      sql`${table.duressPinHash} IS NULL OR ${table.duressPinHash} <> ${table.posPinHash}`,
    ),
    posPinActiveIdx: index('users_pos_pin_active_idx')
      .on(table.id)
      .where(sql`${table.posPinHash} IS NOT NULL AND ${table.softDeletedAt} IS NULL`),
    posPinLockedIdx: index('users_pos_pin_locked_idx')
      .on(table.posPinLockedUntil)
      .where(sql`${table.posPinLockedUntil} IS NOT NULL`),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
