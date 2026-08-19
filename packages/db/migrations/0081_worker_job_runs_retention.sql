-- 0081_worker_job_runs_retention.sql
--
-- worker_job_runs grows unbounded: ~8,100 rows/day, no legal-retention
-- requirement, and by 2026-07 it was 83% of the whole database (151 MB /
-- 324k rows). It is operational telemetry, not a fiscal record. The new
-- worker_job_runs_retention job prunes it, so warehouse14_worker needs DELETE
-- on this ONE non-fiscal operational table.
--
-- This grants NOTHING on any fiscal or audit table. The worker still cannot
-- DELETE from transactions, ledger_events, audit_log, tse_transactions or
-- tse_signatures — the fiscal immutability discipline (0003/0017) is untouched.

GRANT DELETE ON worker_job_runs TO warehouse14_worker;

-- A btree on started_at makes the retention DELETE (range on started_at) an
-- index range scan instead of a seq scan as the table grows.
CREATE INDEX IF NOT EXISTS worker_job_runs_started_at_idx
  ON worker_job_runs (started_at);
