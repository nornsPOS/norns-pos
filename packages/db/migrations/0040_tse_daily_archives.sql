-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0040 — Phase 1.5 #I-2: KassenSichV §10 daily TSE archive evidence.
--
-- §10 KassenSichV mandates a daily export + archive of all TSE transactions. We
-- already have `dsfinvk_exports` for the wider DSFinV-K bundle but no per-day
-- TSE archive evidence. This adds `tse_daily_archives` (one row per calendar
-- day) recording the Fiskaly TSS export TAR: its R2 key, SHA-256, transaction
-- count, and GENERATING → GENERATED | FAILED lifecycle.
--
-- Written by the `tse_archive_exporter` worker job (daily 03:00). Additive,
-- idempotent, transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- Status enum (idempotent — CREATE TYPE has no IF NOT EXISTS).
DO $$ BEGIN
  CREATE TYPE tse_archive_status AS ENUM ('GENERATING', 'GENERATED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tse_daily_archives (
  id                 UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_date       DATE                NOT NULL,
  status             tse_archive_status  NOT NULL DEFAULT 'GENERATING',
  file_r2_key        TEXT,
  sha256             TEXT,
  error_message      TEXT,
  transaction_count  INTEGER             NOT NULL DEFAULT 0,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ         NOT NULL DEFAULT now(),

  -- Evidence columns are mandatory once the archive is GENERATED.
  CONSTRAINT tse_daily_archives_generated_has_evidence CHECK (
    status <> 'GENERATED' OR (
      file_r2_key IS NOT NULL AND
      sha256      IS NOT NULL AND
      completed_at IS NOT NULL
    )
  ),
  CONSTRAINT tse_daily_archives_transaction_count_nonneg CHECK (transaction_count >= 0)
);

-- Exactly one archive row per calendar day.
CREATE UNIQUE INDEX IF NOT EXISTS tse_daily_archives_archive_date_uq
  ON tse_daily_archives (archive_date);

-- updated_at maintained by the shared trigger fn (migration 0002).
DROP TRIGGER IF EXISTS set_tse_daily_archives_updated_at ON tse_daily_archives;
CREATE TRIGGER set_tse_daily_archives_updated_at
  BEFORE UPDATE ON tse_daily_archives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Grants ───────────────────────────────────────────────────────────────
-- The worker job owns the full lifecycle of this table + reads tse_transactions
-- to count the day's signed transactions.
GRANT SELECT, INSERT, UPDATE ON tse_daily_archives TO warehouse14_worker;
GRANT SELECT ON tse_transactions TO warehouse14_worker;

-- The API / Bridge reads archive status for the compliance dashboard.
GRANT SELECT ON tse_daily_archives TO warehouse14_app;

COMMIT;
