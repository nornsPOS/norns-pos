/**
 * worker_job_status — PG enum landed in migration 0017.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const workerJobStatus = pgEnum('worker_job_status', [
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'TIMEOUT',
  'SKIPPED',
]);
