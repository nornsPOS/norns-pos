/**
 * internal_tasks — operator day-list (migration 0023, Day 25).
 *
 * The DB is multi-user-shaped (assignment columns are normal user FKs);
 * the *route layer* auto-fills these from `req.actor.id` when the request
 * body omits them. This keeps single-operator UX zero-click while
 * preserving zero-migration team scalability.
 *
 * Lifecycle CHECKs enforced by migration 0023:
 *   • IN_PROGRESS  ⇒ started_at NOT NULL
 *   • DONE         ⇒ completed_at + started_at NOT NULL
 *   • CANCELLED    ⇒ cancelled_at + cancellation_reason (≥ 4 chars) NOT NULL
 *   • OPEN         ⇒ no lifecycle timestamps set
 *   • Not both DONE-completed and CANCELLED at once
 *
 * NEVER DELETE — operator history is forensic + GoBD-relevant.
 */

import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { taskPriority, taskStatus } from './enums.js';

export const internalTasks = pgTable(
  'internal_tasks',
  {
    id: primaryKey(),

    title: text('title').notNull(),
    description: text('description'),
    priority: taskPriority('priority').notNull().default('NORMAL'),
    status: taskStatus('status').notNull().default('OPEN'),

    assignedToUserId: uuid('assigned_to_user_id')
      .notNull()
      .references(() => users.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    dueDate: date('due_date'),

    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: text('cancellation_reason'),

    /** Polymorphic FK target (both NULL or both set; entity_table whitelisted). */
    relatedEntityTable: text('related_entity_table'),
    relatedEntityId: uuid('related_entity_id'),

    ...timestamps(),
  },
  (table) => ({
    assigneeActiveIdx: index('internal_tasks_assignee_active_idx')
      .on(
        table.assignedToUserId,
        table.priority.desc(),
        table.dueDate.asc().nullsLast(),
        table.createdAt.desc(),
      )
      .where(sql`${table.status} IN ('OPEN', 'IN_PROGRESS', 'BLOCKED')`),

    dueSoonIdx: index('internal_tasks_due_soon_idx')
      .on(table.dueDate)
      .where(sql`${table.dueDate} IS NOT NULL AND ${table.status} IN ('OPEN', 'IN_PROGRESS')`),

    relatedIdx: index('internal_tasks_related_idx')
      .on(table.relatedEntityTable, table.relatedEntityId)
      .where(sql`${table.relatedEntityId} IS NOT NULL`),

    statusIdx: index('internal_tasks_status_idx').on(table.status, table.createdAt.desc()),

    titleLength: check(
      'internal_tasks_title_length',
      sql`length(${table.title}) BETWEEN 1 AND 200`,
    ),
    inProgressHasStarted: check(
      'internal_tasks_in_progress_has_started',
      sql`${table.status} <> 'IN_PROGRESS' OR ${table.startedAt} IS NOT NULL`,
    ),
    doneHasCompletion: check(
      'internal_tasks_done_has_completion',
      sql`${table.status} <> 'DONE'
          OR (${table.completedAt} IS NOT NULL AND ${table.startedAt} IS NOT NULL)`,
    ),
    cancelledHasReason: check(
      'internal_tasks_cancelled_has_reason',
      sql`${table.status} <> 'CANCELLED'
          OR (${table.cancelledAt} IS NOT NULL AND ${table.cancellationReason} IS NOT NULL
              AND length(${table.cancellationReason}) >= 4)`,
    ),
    openNoTimestamps: check(
      'internal_tasks_open_no_timestamps',
      sql`${table.status} <> 'OPEN'
          OR (${table.startedAt} IS NULL AND ${table.completedAt} IS NULL
              AND ${table.cancelledAt} IS NULL)`,
    ),
    terminalNotBoth: check(
      'internal_tasks_terminal_not_both',
      sql`${table.completedAt} IS NULL OR ${table.cancelledAt} IS NULL`,
    ),
    relatedBothOrNone: check(
      'internal_tasks_related_entity_both_or_none',
      sql`(${table.relatedEntityTable} IS NULL) = (${table.relatedEntityId} IS NULL)`,
    ),
    relatedTableKnown: check(
      'internal_tasks_related_entity_known',
      sql`${table.relatedEntityTable} IS NULL OR ${table.relatedEntityTable} IN (
        'products', 'customers', 'transactions', 'appraisals',
        'product_photos', 'shifts', 'inventory_sessions'
      )`,
    ),
  }),
);

export type InternalTask = typeof internalTasks.$inferSelect;
export type NewInternalTask = typeof internalTasks.$inferInsert;
