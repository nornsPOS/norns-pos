-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0017 — Worker infrastructure (Day 18)
--
-- The DB substrate for `apps/worker`. Three pieces:
--
--   1. `warehouse14_worker` role  — separate identity for the daemon. Default
--      privileges (SELECT + INSERT from migration 0003) cover most tables;
--      narrow UPDATE grants for the operational tables it must mutate
--      (`worker_job_runs`, `worker_job_dlq`, `daily_closings`,
--      `dsfinvk_exports`, `system_settings.lbma.latest_fix`, ...).
--      DOES NOT have UPDATE on fiscal-immutable columns (acquisition_cost_eur,
--      sanctions_match, is_owner, is_commission, etc.) — same posture as
--      warehouse14_app.
--
--   2. `worker_job_runs` — append-only audit of every job attempt.
--      One row per `runner.runOnce(jobName)` call. status RUNNING is written
--      at start, then UPDATEd to SUCCESS / FAILED / TIMEOUT / SKIPPED at end.
--      Indexed for the operator query "last successful run of job X".
--
--   3. `worker_job_dlq` — dead-letter queue. When a job hits its
--      consecutive-failure budget (default 5), the runner pushes a row here
--      and emits `alert.worker_job_dead_letter` to ledger_events. Stays
--      visible until an ADMIN ACKs (`acked_at` + `acked_by_user_id`).
--
-- ADR-0001 #14 (BullMQ + Redis) is **superseded for V1** by this PG-native
-- queue + scheduler — see memory.md decision #63. Redis-backed jobs return
-- as a Phase 1.5 option (item I-7) if horizontal scaling lands.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. warehouse14_worker role
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse14_worker') THEN
    CREATE ROLE warehouse14_worker LOGIN NOINHERIT;
    COMMENT ON ROLE warehouse14_worker IS
      'Daemon role for apps/worker. Same default-deny posture as warehouse14_app; '
      'gets explicit UPDATE on the operational tables it owns. NEVER DELETE on fiscal.';
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO warehouse14_worker;

-- Mirror the app role's default privileges so future tables auto-grant.
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO warehouse14_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO warehouse14_worker;
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO warehouse14_worker;

-- Backfill SELECT + INSERT on tables that landed before this migration.
GRANT SELECT, INSERT ON
  ledger_events, audit_log, transactions, transaction_items, transaction_payments,
  customers, kyc_documents, products, product_photos, devices, users,
  sessions, accounts, verifications, two_factors,
  daily_closings, dsfinvk_exports, system_settings,
  tse_transactions,
  appointments, appointment_linked_products, product_viewing_holds,
  staff_working_hours, staff_time_off, shop_holidays,
  tax_treatment_codes, karat_grades, hallmarks
  TO warehouse14_worker;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO warehouse14_worker;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. worker_job_status enum
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'worker_job_status') THEN
    CREATE TYPE worker_job_status AS ENUM (
      'RUNNING',     -- started, in flight
      'SUCCESS',     -- finished without throwing
      'FAILED',      -- threw; counted against consecutive-failures budget
      'TIMEOUT',     -- hard timeout exceeded
      'SKIPPED'      -- another instance held the advisory lock (or shutting down)
    );
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. worker_job_runs — per-attempt history
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS worker_job_runs (
  id              BIGSERIAL           PRIMARY KEY,
  job_name        TEXT                NOT NULL,
  /** Correlation id; logged alongside Pino entries in the worker. */
  run_id          UUID                NOT NULL DEFAULT gen_random_uuid(),
  /** When the runner CALLED the job (after advisory lock acquired, or for SKIPPED, the tick fired). */
  started_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
  /** NULL while RUNNING. */
  finished_at     TIMESTAMPTZ,
  status          worker_job_status   NOT NULL DEFAULT 'RUNNING',
  /** Pino-formatted error string when status IN (FAILED, TIMEOUT). Capped at 8 KiB. */
  error_message   TEXT,
  /** Job-specific metrics — e.g. {"rowsProcessed": 5, "lbmaPriceEur": "62.30"}. */
  payload         JSONB               NOT NULL DEFAULT '{}'::jsonb,
  /** Consecutive-failures counter SNAPSHOT at attempt time (lets the operator graph it). */
  consecutive_failures INTEGER        NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CONSTRAINT worker_job_runs_finished_iff_terminal
    CHECK ((status = 'RUNNING') <> (finished_at IS NOT NULL)),
  CONSTRAINT worker_job_runs_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT worker_job_runs_error_only_when_failing
    CHECK (error_message IS NULL OR status IN ('FAILED', 'TIMEOUT'))
);

CREATE INDEX IF NOT EXISTS worker_job_runs_job_status_idx
  ON worker_job_runs (job_name, status, started_at DESC);

/* "Show me the last successful run of every job" — the operator dashboard query. */
CREATE INDEX IF NOT EXISTS worker_job_runs_last_success_idx
  ON worker_job_runs (job_name, started_at DESC)
  WHERE status = 'SUCCESS';

/* RUNNING rows — useful for "is anything stuck?" probe. */
CREATE INDEX IF NOT EXISTS worker_job_runs_running_idx
  ON worker_job_runs (job_name, started_at)
  WHERE status = 'RUNNING';

COMMENT ON TABLE worker_job_runs IS
  'Append-then-update audit log for every apps/worker job attempt. '
  'The runner INSERTs a RUNNING row then UPDATEs to terminal status on completion. '
  'Old rows can be archived by a purge job (Phase 1.5); fiscal data never lives here.';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. worker_job_dlq — dead-letter queue
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS worker_job_dlq (
  id              BIGSERIAL           PRIMARY KEY,
  job_name        TEXT                NOT NULL,
  /** How many consecutive failures landed this row in the DLQ. */
  failure_count   INTEGER             NOT NULL,
  /** Last error message (truncated to 8 KiB at the application layer). */
  last_error      TEXT,
  /** Snapshot of the job's input/state at the time of final failure — JSON object. */
  payload         JSONB               NOT NULL DEFAULT '{}'::jsonb,
  /** Optional pointer to the worker_job_runs row of the last failing attempt. */
  last_run_id     BIGINT              REFERENCES worker_job_runs(id),
  pushed_at       TIMESTAMPTZ         NOT NULL DEFAULT now(),

  /** ADMIN acknowledgement — marks the operator has seen it and won't bother them again. */
  acked_at        TIMESTAMPTZ,
  acked_by_user_id UUID                REFERENCES users(id),
  ack_note        TEXT,

  CONSTRAINT worker_job_dlq_failure_count_pos CHECK (failure_count > 0),
  CONSTRAINT worker_job_dlq_ack_pair
    CHECK ((acked_at IS NULL) = (acked_by_user_id IS NULL)),
  CONSTRAINT worker_job_dlq_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS worker_job_dlq_unacked_idx
  ON worker_job_dlq (job_name, pushed_at DESC)
  WHERE acked_at IS NULL;

CREATE INDEX IF NOT EXISTS worker_job_dlq_acked_idx
  ON worker_job_dlq (acked_at DESC)
  WHERE acked_at IS NOT NULL;

COMMENT ON TABLE worker_job_dlq IS
  'Dead-letter queue for jobs whose consecutive-failures exceeded the runner budget. '
  'Operator acks via Bridge UX (sets acked_at + acked_by_user_id + ack_note). '
  'Persistent — fiscal compliance posture: NEVER DELETE.';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Role grants — narrow, deliberate
-- ═════════════════════════════════════════════════════════════════════════

/* worker role: full lifecycle on its own tables. */
GRANT SELECT, INSERT, UPDATE ON worker_job_runs TO warehouse14_worker;
GRANT SELECT, INSERT, UPDATE ON worker_job_dlq TO warehouse14_worker;
GRANT USAGE ON SEQUENCE worker_job_runs_id_seq TO warehouse14_worker;
GRANT USAGE ON SEQUENCE worker_job_dlq_id_seq TO warehouse14_worker;

/* worker role: domain-specific UPDATE grants for the jobs it runs. */
-- reservation_sweeper releases reservations (status + envelope cols).
GRANT UPDATE (
  status,
  reserved_by_channel,
  reserved_by_session_id,
  reserved_by_user_id,
  reserved_at,
  reservation_expires_at,
  updated_at
) ON products TO warehouse14_worker;

-- dsfinvk_daily_export lifecycle.
GRANT UPDATE (
  state, generated_at, delivered_at, delivery_method, delivery_target,
  r2_key, file_size_bytes, file_sha256,
  transaction_count, daily_closings_count, total_gross_eur, daily_closing_ids,
  last_error_at, last_error_message, updated_at
) ON dsfinvk_exports TO warehouse14_worker;

-- lbma_prices writes to system_settings.lbma.latest_fix.
GRANT UPDATE (value, description, updated_by_user_id, updated_at)
  ON system_settings TO warehouse14_worker;

-- sessions_cleanup needs DELETE on expired sessions.
GRANT DELETE ON sessions TO warehouse14_worker;

-- ledger_events column-restricted INSERT (same shape as app role per 0008).
REVOKE INSERT ON ledger_events FROM warehouse14_worker;
GRANT INSERT (
  event_type, entity_table, entity_id, actor_user_id, device_id, ip_address, payload
) ON ledger_events TO warehouse14_worker;
GRANT USAGE ON SEQUENCE ledger_events_id_seq TO warehouse14_worker;

-- audit_log INSERT.
GRANT INSERT ON audit_log TO warehouse14_worker;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO warehouse14_worker;

/* app role: SELECT-only — Bridge UX reads worker state but never writes. */
GRANT SELECT ON worker_job_runs TO warehouse14_app;
GRANT SELECT ON worker_job_dlq TO warehouse14_app;
-- App can acknowledge DLQ rows (ack column updates) but not INSERT/DELETE.
GRANT UPDATE (acked_at, acked_by_user_id, ack_note) ON worker_job_dlq TO warehouse14_app;

/* security role: SELECT — for any SECURITY DEFINER trigger that needs to
   read worker state (none currently). */
GRANT SELECT ON worker_job_runs TO warehouse14_security;
GRANT SELECT ON worker_job_dlq TO warehouse14_security;

COMMIT;
