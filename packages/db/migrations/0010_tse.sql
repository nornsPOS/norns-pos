-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0010 — TSE (Technische Sicherheitseinrichtung) / KassenSichV
--
-- This migration lands the Fiskaly SIGN DE V2 integration table:
--   • tse_transactions — one row per signed transaction, linked 1:1 to transactions.
--   • State machine: QUEUED_OFFLINE → ACTIVE → FINISHED (or CANCELLED / FAILED).
--   • Offline-queue support — `QUEUED_OFFLINE` rows wait for the worker to
--     replay them to Fiskaly on reconnect (memory.md §3, ADR-0014).
--   • SECURITY DEFINER trigger emits ledger_events on every state transition;
--     verify_ledger_chain() naturally extends to cover TSE-state evidence.
--
-- ADR references:
--   • ADR-0014 — Live Ops transport, Fiskaly cloud TSE
--   • ADR-0018 §3 — TSE edge cases (cert expiry, cross-day storno, archive mismatch)
--   • memory.md §3 — "Network-resilient: Tauri queues INTENTIONs in local SQLite"
--   • BSI TR-03153 / KassenSichV §4 §6 — fiscal record requirements
--
-- Basel Day-8 directives:
--   1. Offline resilience — the sale never stops; INTENTIONs queue, signing
--      happens asynchronously, the customer leaves with a receipt.
--   2. Immutable fiscal records — no DELETE, no UPDATE on signature columns
--      once FINISHED. The trigger enforces this regardless of app code bugs.
--   3. Hard linkage to transactions — UNIQUE FK ensures exactly one TSE record
--      per fiscal transaction, ready for DSFinV-K export.
--
-- Idempotent; transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ENUM — tse_state
-- ─────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tse_state') THEN
    CREATE TYPE tse_state AS ENUM (
      'QUEUED_OFFLINE',    -- locally-signed during outage; awaiting Fiskaly sync
      'ACTIVE',            -- Fiskaly opened the TSE transaction; awaiting FINISH
      'FINISHED',          -- Fully signed by Fiskaly; receipt-ready
      'CANCELLED',         -- TSE transaction was cancelled (rare)
      'FAILED'             -- Max retries exhausted; manual intervention needed
    );
    COMMENT ON TYPE tse_state IS
      'TSE lifecycle. QUEUED_OFFLINE supports offline-resilient sales per memory.md §3. '
      'Terminal states: FINISHED, CANCELLED, FAILED.';
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. tse_transactions
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tse_transactions (
  id                            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Hard linkage: one TSE record per transactions row.
  transaction_id                UUID            NOT NULL REFERENCES transactions(id),

  -- State machine
  state                         tse_state       NOT NULL DEFAULT 'QUEUED_OFFLINE',
  state_reason                  TEXT,                                  -- free-form (e.g. cancellation reason)

  -- Fiskaly identity (TSS module + client)
  fiskaly_tss_id                UUID            NOT NULL,
  fiskaly_client_id             UUID            NOT NULL,
  fiskaly_transaction_id        UUID,                                  -- assigned by Fiskaly when ACTIVE
  fiskaly_transaction_number    BIGINT,                                -- monotonic per-TSS counter, set at FINISHED

  -- Signature fields (filled by Fiskaly at FINISHED) — IMMUTABLE after FINISHED
  signature_value               TEXT,                                  -- base64 signature
  signature_counter             BIGINT,                                -- monotonic per-TSS signature counter
  signature_algorithm           TEXT,                                  -- 'ecdsa-plain-SHA256'

  -- TSS certificate context (for offline verification)
  certificate_serial            TEXT,
  certificate_public_key        TEXT,                                  -- PEM, cached at signing time

  -- TSS-reported timing (KassenSichV §4)
  start_time                    TIMESTAMPTZ,                            -- when TSE TRANSACTION started
  end_time                      TIMESTAMPTZ,                            -- when TSE TRANSACTION finalized

  -- KassenSichV process classification
  process_type                  TEXT            NOT NULL DEFAULT 'Kassenbeleg-V1',
  process_data_hash             BYTEA,                                  -- SHA-256 of canonical signed payload

  -- Receipt-ready QR code data per BSI TR-03151
  qr_code_data                  TEXT,

  -- Offline-queue provenance
  created_offline               BOOLEAN         NOT NULL DEFAULT FALSE,
  signed_at                     TIMESTAMPTZ,                            -- when Fiskaly actually signed

  -- Retry / error tracking (managed by the worker)
  retry_count                   SMALLINT        NOT NULL DEFAULT 0,
  last_error_at                 TIMESTAMPTZ,
  last_error_code               TEXT,
  last_error_message            TEXT,

  -- Lifecycle
  created_at                    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Invariants
  CONSTRAINT tse_transactions_unique_per_transaction
    UNIQUE (transaction_id),

  -- A FINISHED row has every signature field set.
  CONSTRAINT tse_transactions_finished_has_signature
    CHECK (
      state <> 'FINISHED' OR (
        signature_value             IS NOT NULL AND
        signature_counter           IS NOT NULL AND
        fiskaly_transaction_number  IS NOT NULL AND
        signature_algorithm         IS NOT NULL AND
        start_time                  IS NOT NULL AND
        end_time                    IS NOT NULL AND
        signed_at                   IS NOT NULL AND
        qr_code_data                IS NOT NULL
      )
    ),

  -- Error fields are coherent — both NULL or both set.
  CONSTRAINT tse_transactions_error_consistency
    CHECK (
      (last_error_at IS NULL AND last_error_code IS NULL)
      OR
      (last_error_at IS NOT NULL AND last_error_code IS NOT NULL)
    ),

  -- Counter is monotonic — must be > 0 once set.
  CONSTRAINT tse_transactions_counter_positive
    CHECK (signature_counter IS NULL OR signature_counter > 0),

  -- end_time follows start_time when both set.
  CONSTRAINT tse_transactions_time_order
    CHECK (start_time IS NULL OR end_time IS NULL OR end_time >= start_time),

  -- retry_count is bounded — keeps the worker from looping forever.
  CONSTRAINT tse_transactions_retry_count_bounded
    CHECK (retry_count >= 0 AND retry_count <= 100)
);

-- ─── Indexes ──────────────────────────────────────────────────────────

-- Worker: poll for offline-queued INTENTIONs to sync.
CREATE INDEX IF NOT EXISTS tse_transactions_queued_offline_idx
  ON tse_transactions (created_at)
  WHERE state = 'QUEUED_OFFLINE';

-- Worker: poll for stuck ACTIVE transactions (signed too long ago, needs FINISH).
CREATE INDEX IF NOT EXISTS tse_transactions_active_idx
  ON tse_transactions (updated_at)
  WHERE state = 'ACTIVE';

-- Daily DSFinV-K export: walk FINISHED transactions per business day.
CREATE INDEX IF NOT EXISTS tse_transactions_finished_business_day_idx
  ON tse_transactions (berlin_business_day(signed_at))
  WHERE state = 'FINISHED';

-- Admin / manual investigation of FAILED rows.
CREATE INDEX IF NOT EXISTS tse_transactions_failed_idx
  ON tse_transactions (last_error_at DESC)
  WHERE state = 'FAILED';

-- Idempotency on Fiskaly transaction_id (when assigned).
CREATE UNIQUE INDEX IF NOT EXISTS tse_transactions_fiskaly_tx_uq
  ON tse_transactions (fiskaly_transaction_id)
  WHERE fiskaly_transaction_id IS NOT NULL;

-- Per-TSS signature counter must be unique within a Fiskaly TSS module.
CREATE UNIQUE INDEX IF NOT EXISTS tse_transactions_signature_counter_uq
  ON tse_transactions (fiskaly_tss_id, signature_counter)
  WHERE signature_counter IS NOT NULL;

CREATE TRIGGER trg_tse_transactions_updated_at
  BEFORE UPDATE ON tse_transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tse_transactions IS
  'TSE (Fiskaly SIGN DE V2) state machine and signature evidence. '
  'One row per fiscal transaction. NEVER deleted by app role. State transitions '
  'are enforced by trigger; signature fields immutable once FINISHED.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. State-transition trigger — BEFORE UPDATE
--    Enforces the state machine + signature immutability after FINISHED.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tse_validate_transition() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  is_terminal_old BOOLEAN;
  valid_transition BOOLEAN;
BEGIN
  -- Terminal states cannot transition further.
  is_terminal_old := OLD.state IN ('FINISHED', 'CANCELLED', 'FAILED');

  IF is_terminal_old AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'Cannot transition out of terminal TSE state % (row %)', OLD.state, NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate the transition graph when state actually changes.
  IF NEW.state <> OLD.state THEN
    valid_transition :=
      (OLD.state = 'QUEUED_OFFLINE' AND NEW.state IN ('ACTIVE', 'FINISHED', 'FAILED'))
      OR
      (OLD.state = 'ACTIVE'         AND NEW.state IN ('FINISHED', 'CANCELLED', 'FAILED'));

    IF NOT valid_transition THEN
      RAISE EXCEPTION 'Invalid TSE state transition: % → % (row %)', OLD.state, NEW.state, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- After FINISHED, signature columns are immutable.
  IF OLD.state = 'FINISHED' THEN
    IF NEW.signature_value             IS DISTINCT FROM OLD.signature_value             OR
       NEW.signature_counter           IS DISTINCT FROM OLD.signature_counter           OR
       NEW.signature_algorithm         IS DISTINCT FROM OLD.signature_algorithm         OR
       NEW.fiskaly_transaction_number  IS DISTINCT FROM OLD.fiskaly_transaction_number  OR
       NEW.certificate_serial          IS DISTINCT FROM OLD.certificate_serial          OR
       NEW.certificate_public_key      IS DISTINCT FROM OLD.certificate_public_key      OR
       NEW.start_time                  IS DISTINCT FROM OLD.start_time                  OR
       NEW.end_time                    IS DISTINCT FROM OLD.end_time                    OR
       NEW.qr_code_data                IS DISTINCT FROM OLD.qr_code_data                OR
       NEW.process_data_hash           IS DISTINCT FROM OLD.process_data_hash           OR
       NEW.signed_at                   IS DISTINCT FROM OLD.signed_at THEN
      RAISE EXCEPTION 'TSE signature columns are immutable after FINISHED (row %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- transaction_id linkage is immutable from INSERT — no UPDATE allowed.
  IF NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
    RAISE EXCEPTION 'tse_transactions.transaction_id is immutable (row %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- created_offline is set at INSERT time only.
  IF NEW.created_offline IS DISTINCT FROM OLD.created_offline THEN
    RAISE EXCEPTION 'tse_transactions.created_offline is set at INSERT and immutable (row %)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tse_validate_transition ON tse_transactions;
CREATE TRIGGER trg_tse_validate_transition
  BEFORE UPDATE ON tse_transactions
  FOR EACH ROW EXECUTE FUNCTION tse_validate_transition();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Ledger-event emitter — INSERT + state-change UPDATE
--    SECURITY DEFINER, owned by warehouse14_security, mirrors the pattern
--    from migration 0009.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_tse_state_event() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  evt_type TEXT;
  cashier UUID;
  device  UUID;
BEGIN
  -- Skip non-state UPDATEs (e.g. updated_at-only touches).
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  evt_type := 'tse.' || lower(NEW.state);   -- e.g. 'tse.finished', 'tse.failed'

  -- Pull actor + device from the linked transaction for the audit trail.
  SELECT cashier_user_id, device_id INTO cashier, device
    FROM transactions WHERE id = NEW.transaction_id;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id,
    actor_user_id, device_id,
    payload
  )
  VALUES (
    evt_type,
    'tse_transactions',
    NEW.id,
    cashier,
    device,
    jsonb_build_object(
      'transaction_id',             NEW.transaction_id,
      'state',                      NEW.state,
      'previous_state',             CASE WHEN TG_OP = 'UPDATE' THEN OLD.state::text ELSE NULL END,
      'fiskaly_tss_id',             NEW.fiskaly_tss_id,
      'fiskaly_transaction_number', NEW.fiskaly_transaction_number,
      'signature_counter',          NEW.signature_counter,
      'created_offline',            NEW.created_offline,
      'state_reason',               NEW.state_reason
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_tse_state_event() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_tse_after_insert ON tse_transactions;
CREATE TRIGGER trg_tse_after_insert
  AFTER INSERT ON tse_transactions
  FOR EACH ROW EXECUTE FUNCTION on_tse_state_event();

DROP TRIGGER IF EXISTS trg_tse_after_update ON tse_transactions;
CREATE TRIGGER trg_tse_after_update
  AFTER UPDATE OF state ON tse_transactions
  FOR EACH ROW EXECUTE FUNCTION on_tse_state_event();

COMMENT ON FUNCTION on_tse_state_event() IS
  'AFTER trigger on tse_transactions INSERT + state UPDATE. Emits a ledger_event '
  '''tse.<state>'' so the hash chain captures the full TSE lifecycle. '
  'SECURITY DEFINER owned by warehouse14_security.';

-- ─────────────────────────────────────────────────────────────────────
-- 5. App-role grants
--
-- tse_transactions:
--   • SELECT + INSERT (default privileges)
--   • UPDATE on the state-machine + signature + retry columns ONLY
--   • NO DELETE
-- ─────────────────────────────────────────────────────────────────────

GRANT UPDATE (
  -- State + reason
  state,
  state_reason,

  -- Fiskaly identifiers populated post-INSERT
  fiskaly_transaction_id,
  fiskaly_transaction_number,

  -- Signature fields (locked once FINISHED by the trigger)
  signature_value,
  signature_counter,
  signature_algorithm,
  certificate_serial,
  certificate_public_key,

  -- TSS-reported timing
  start_time,
  end_time,

  -- Process data + QR code
  process_data_hash,
  qr_code_data,

  -- Worker bookkeeping
  signed_at,
  retry_count,
  last_error_at,
  last_error_code,
  last_error_message,

  -- Trigger-maintained
  updated_at
) ON tse_transactions TO warehouse14_app;

-- The on_tse_state_event() function INSERTs into ledger_events; warehouse14_security
-- already has the column-restricted INSERT from migration 0009.

COMMIT;
