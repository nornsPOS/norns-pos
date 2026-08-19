/**
 * system_settings — runtime config store.
 *
 * Every INSERT/UPDATE writes a row to audit_log via SECURITY DEFINER trigger
 * (`on_system_setting_event` from migration 0011) so we always know who
 * changed which threshold and when.
 *
 * NEVER deleted by app role — keys are forever; only their values change.
 */

import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';

export const systemSettings = pgTable(
  'system_settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    description: text('description'),
    updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
    ...timestamps(),
  },
  (table) => ({
    keyFormat: check(
      'system_settings_key_format',
      sql`${table.key} ~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)*$'`,
    ),
  }),
);

export type SystemSetting = typeof systemSettings.$inferSelect;
export type NewSystemSetting = typeof systemSettings.$inferInsert;
