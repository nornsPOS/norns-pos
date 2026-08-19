/**
 * Enums backing the internal_tasks table (migration 0023, Day 25).
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const taskPriority = pgEnum('task_priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT']);

export const taskStatus = pgEnum('task_status', [
  'OPEN',
  'IN_PROGRESS',
  'BLOCKED',
  'DONE',
  'CANCELLED',
]);

/**
 * Whitelist of `related_entity_table` values enforced by the migration's
 * CHECK constraint. Re-exported here so route validators can use the same
 * source of truth.
 */
export const RELATED_ENTITY_TABLES = [
  'products',
  'customers',
  'transactions',
  'appraisals',
  'product_photos',
  'shifts',
  'inventory_sessions',
] as const;
export type RelatedEntityTable = (typeof RELATED_ENTITY_TABLES)[number];
