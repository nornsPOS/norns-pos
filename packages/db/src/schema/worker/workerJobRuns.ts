/**
 * worker_job_runs — append-then-update history of every apps/worker attempt.
 * Landed in migration 0017.
 */

import { sql } from 'drizzle-orm';
import {
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

import { workerJobStatus } from './enums.js';

export const workerJobRuns = pgTable(
  'worker_job_runs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    jobName: text('job_name').notNull(),
    runId: uuid('run_id').notNull().default(sql`gen_random_uuid()`),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(sql`now()`),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: workerJobStatus('status').notNull().default('RUNNING'),
    errorMessage: text('error_message'),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    jobStatusStartedIdx: index('worker_job_runs_job_status_idx').on(
      table.jobName,
      table.status,
      table.startedAt.desc(),
    ),
    lastSuccessIdx: index('worker_job_runs_last_success_idx')
      .on(table.jobName, table.startedAt.desc())
      .where(sql`${table.status} = 'SUCCESS'`),
    runningIdx: index('worker_job_runs_running_idx')
      .on(table.jobName, table.startedAt)
      .where(sql`${table.status} = 'RUNNING'`),

    finishedIffTerminal: check(
      'worker_job_runs_finished_iff_terminal',
      sql`(${table.status} = 'RUNNING') <> (${table.finishedAt} IS NOT NULL)`,
    ),
    payloadIsObject: check(
      'worker_job_runs_payload_is_object',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    errorOnlyWhenFailing: check(
      'worker_job_runs_error_only_when_failing',
      sql`${table.errorMessage} IS NULL OR ${table.status} IN ('FAILED', 'TIMEOUT')`,
    ),
  }),
);

export type WorkerJobRun = typeof workerJobRuns.$inferSelect;
export type NewWorkerJobRun = typeof workerJobRuns.$inferInsert;
