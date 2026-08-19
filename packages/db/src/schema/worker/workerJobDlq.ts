/**
 * worker_job_dlq — dead-letter queue for jobs exceeding the runner's
 * consecutive-failures budget. Operator ACKs by setting acked_at + acked_by_user_id.
 *
 * Landed in migration 0017.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/users.js';
import { workerJobRuns } from './workerJobRuns.js';

export const workerJobDlq = pgTable(
  'worker_job_dlq',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    jobName: text('job_name').notNull(),
    failureCount: integer('failure_count').notNull(),
    lastError: text('last_error'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    lastRunId: bigint('last_run_id', { mode: 'bigint' }).references(() => workerJobRuns.id),
    pushedAt: timestamp('pushed_at', { withTimezone: true }).notNull().default(sql`now()`),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    ackedByUserId: uuid('acked_by_user_id').references(() => users.id),
    ackNote: text('ack_note'),
  },
  (table) => ({
    unackedIdx: index('worker_job_dlq_unacked_idx')
      .on(table.jobName, table.pushedAt.desc())
      .where(sql`${table.ackedAt} IS NULL`),
    ackedIdx: index('worker_job_dlq_acked_idx')
      .on(table.ackedAt.desc())
      .where(sql`${table.ackedAt} IS NOT NULL`),
    failureCountPositive: check('worker_job_dlq_failure_count_pos', sql`${table.failureCount} > 0`),
    ackPair: check(
      'worker_job_dlq_ack_pair',
      sql`(${table.ackedAt} IS NULL) = (${table.ackedByUserId} IS NULL)`,
    ),
    payloadIsObject: check(
      'worker_job_dlq_payload_is_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
  }),
);

export type WorkerJobDlqRow = typeof workerJobDlq.$inferSelect;
export type NewWorkerJobDlqRow = typeof workerJobDlq.$inferInsert;
