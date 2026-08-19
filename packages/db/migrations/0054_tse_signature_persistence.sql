-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0054 — durable server-side persistence of TSE (KassenSichV)
--                   signatures returned by Fiskaly per fiscal transaction.
--
-- THE GAP (fiscal audit 2026-06): the Fiskaly SIGN DE V2 signature produced on
-- every sale was ONLY printed on the thermal receipt and, on failure, queued to
-- the POS's browser localStorage. It was NEVER recorded server-side. GoBD / BSI
-- TR-03153 require the TSE signature data to be durably and immutably stored,
-- linked to the transaction it signs, so the fiscal record survives a lost
-- receipt or a wiped POS workstation.
--
-- This migration lands `tse_signatures`: an APPEND-ONLY evidence table, one row
-- per `transactions` row (UNIQUE FK). The POS POSTs the signature it received
-- from the local TSE bridge right after a successful finalize+FINISH, via
-- POST /api/transactions/:id/tse-signature. Idempotent: a duplicate POST for the
-- same transaction is a no-op (23505 on the UNIQUE index → route returns the
-- existing row).
--
-- Distinction from `tse_transactions` (migration 0010): that table models the
-- full Fiskaly state machine + offline queue (QUEUED_OFFLINE → ACTIVE → FINISHED)
-- driven by the worker. `tse_signatures` is the narrow, immutable fiscal-record
-- of the signature VALUE as it was actually rendered on the customer's receipt —
-- captured client-side at the moment of sale, the GoBD evidentiary artefact.
--
-- Discipline (mirrors the fiscal-core tables):
--   • App role: INSERT + SELECT only. NO UPDATE, NO DELETE — the signature is
--     immutable evidence once written.
--   • A BEFORE UPDATE/DELETE trigger hard-refuses mutation regardless of grants.
--   • INSERT emits a `tse.signature_recorded` ledger_event (the hash chain
--     extends to cover the signature evidence) via a SECURITY DEFINER trigger
--     owned by warehouse14_security, mirroring migration 0010.
--
-- ADR references:
--   • ADR-0014 — Fiskaly cloud TSE
--   • BSI TR-03153 / KassenSichV §4 §6 — fiscal record requirements
--   • GoBD — durable, immutable retention of fiscal records
--
-- Append-only; idempotent; transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. tse_signatures — one immutable signature row per fiscal transaction.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tse_signatures (
  id                            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Hard linkage: exactly one signature record per transactions row.
  transaction_id                UUID            NOT NULL REFERENCES transactions(id),

  -- Fiskaly identity context (TSS module + client + per-TSS tx number/id).
  fiskaly_tss_id                UUID            NOT NULL,
  fiskaly_client_id             UUID            NOT NULL,
  fiskaly_transaction_id        UUID,                                  -- Fiskaly's TRANSACTION uuid (when known)
  fiskaly_transaction_number    BIGINT          NOT NULL,              -- monotonic per-TSS tx number

  -- Signature payload (the KassenSichV-mandated block printed on the receipt).
  signature_value               TEXT            NOT NULL,              -- base64 signature
  signature_counter             BIGINT          NOT NULL,              -- monotonic per-TSS signature counter
  signature_algorithm           TEXT,                                  -- e.g. 'ecdsa-plain-SHA256'

  -- KassenSichV process classification + receipt-ready QR (BSI TR-03151).
  process_type                  TEXT            NOT NULL DEFAULT 'Kassenbeleg-V1',
  qr_code_data                  TEXT,

  -- TSS-reported timing of the signed TRANSACTION.
  tse_start_time                TIMESTAMPTZ,                            -- when the TSE TRANSACTION started
  tse_end_time                  TIMESTAMPTZ,                            -- when the TSE TRANSACTION finalized (signed)

  -- When the POS recorded this signature server-side.
  recorded_at                   TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Provenance.
  device_id                     UUID,                                  -- the mTLS POS device that signed
  recorded_by_user_id           UUID,                                  -- the cashier actor

  -- Lifecycle (audit pair; updated_at present for shape parity, never mutated).
  created_at                    TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Exactly one signature per transaction — the idempotency boundary.
  CONSTRAINT tse_signatures_unique_per_transaction
    UNIQUE (transaction_id),

  -- Counter is monotonic — must be > 0.
  CONSTRAINT tse_signatures_counter_positive
    CHECK (signature_counter > 0),

  -- Transaction number is monotonic — must be > 0.
  CONSTRAINT tse_signatures_tx_number_positive
    CHECK (fiskaly_transaction_number > 0),

  -- end_time follows start_time when both set.
  CONSTRAINT tse_signatures_time_order
    CHECK (tse_start_time IS NULL OR tse_end_time IS NULL OR tse_end_time >= tse_start_time)
);

COMMENT ON TABLE tse_signatures IS
  'Durable, append-only server-side record of the Fiskaly SIGN DE V2 signature '
  'produced per fiscal transaction (GoBD / BSI TR-03153). One immutable row per '
  'transactions row; INSERTed by the POS after finalize+FINISH. NEVER updated or '
  'deleted by the app role — the BEFORE UPDATE/DELETE trigger enforces this.';

-- ─── Indexes ──────────────────────────────────────────────────────────

-- Per-TSS signature counter is unique within a Fiskaly TSS module.
CREATE UNIQUE INDEX IF NOT EXISTS tse_signatures_signature_counter_uq
  ON tse_signatures (fiskaly_tss_id, signature_counter);

-- Per-TSS transaction number is unique within a Fiskaly TSS module.
CREATE UNIQUE INDEX IF NOT EXISTS tse_signatures_tx_number_uq
  ON tse_signatures (fiskaly_tss_id, fiskaly_transaction_number);

-- Idempotency on Fiskaly transaction_id (when assigned).
CREATE UNIQUE INDEX IF NOT EXISTS tse_signatures_fiskaly_tx_uq
  ON tse_signatures (fiskaly_transaction_id)
  WHERE fiskaly_transaction_id IS NOT NULL;

-- Daily DSFinV-K / audit export: walk signatures per business day.
CREATE INDEX IF NOT EXISTS tse_signatures_recorded_business_day_idx
  ON tse_signatures (berlin_business_day(recorded_at));

-- updated_at maintenance for shape parity (rows are never mutated in practice).
CREATE TRIGGER trg_tse_signatures_updated_at
  BEFORE UPDATE ON tse_signatures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 2. Immutability trigger — refuse any UPDATE or DELETE.
--    The signature is fiscal evidence; once written it is frozen. This is
--    enforced at the trigger level so even a misbehaving app code path (or a
--    compromised warehouse14_app) cannot mutate it.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tse_signatures_immutable() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- Allow ONLY the set_updated_at() touch (no business column changed). Any
  -- other UPDATE, and every DELETE, is refused.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tse_signatures rows are immutable fiscal evidence and cannot be deleted (row %)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.transaction_id              IS DISTINCT FROM OLD.transaction_id              OR
       NEW.fiskaly_tss_id              IS DISTINCT FROM OLD.fiskaly_tss_id              OR
       NEW.fiskaly_client_id           IS DISTINCT FROM OLD.fiskaly_client_id           OR
       NEW.fiskaly_transaction_id      IS DISTINCT FROM OLD.fiskaly_transaction_id      OR
       NEW.fiskaly_transaction_number  IS DISTINCT FROM OLD.fiskaly_transaction_number  OR
       NEW.signature_value             IS DISTINCT FROM OLD.signature_value             OR
       NEW.signature_counter           IS DISTINCT FROM OLD.signature_counter           OR
       NEW.signature_algorithm         IS DISTINCT FROM OLD.signature_algorithm         OR
       NEW.process_type                IS DISTINCT FROM OLD.process_type                OR
       NEW.qr_code_data                IS DISTINCT FROM OLD.qr_code_data                OR
       NEW.tse_start_time              IS DISTINCT FROM OLD.tse_start_time              OR
       NEW.tse_end_time                IS DISTINCT FROM OLD.tse_end_time                OR
       NEW.recorded_at                 IS DISTINCT FROM OLD.recorded_at                 OR
       NEW.device_id                   IS DISTINCT FROM OLD.device_id                   OR
       NEW.recorded_by_user_id         IS DISTINCT FROM OLD.recorded_by_user_id THEN
      RAISE EXCEPTION 'tse_signatures rows are immutable fiscal evidence and cannot be modified (row %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tse_signatures_immutable_update ON tse_signatures;
CREATE TRIGGER trg_tse_signatures_immutable_update
  BEFORE UPDATE ON tse_signatures
  FOR EACH ROW EXECUTE FUNCTION tse_signatures_immutable();

DROP TRIGGER IF EXISTS trg_tse_signatures_immutable_delete ON tse_signatures;
CREATE TRIGGER trg_tse_signatures_immutable_delete
  BEFORE DELETE ON tse_signatures
  FOR EACH ROW EXECUTE FUNCTION tse_signatures_immutable();

COMMENT ON FUNCTION tse_signatures_immutable() IS
  'Refuses any business-column UPDATE and every DELETE on tse_signatures. The '
  'signature is append-only fiscal evidence (GoBD). Only the set_updated_at() '
  'no-op touch is permitted.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Ledger-event emitter — AFTER INSERT.
--    SECURITY DEFINER owned by warehouse14_security, mirrors migration 0010.
--    Extends the hash chain to cover signature-recording evidence.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_tse_signature_recorded() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  cashier UUID;
  device  UUID;
BEGIN
  -- Prefer the provenance carried on the row; fall back to the linked
  -- transaction's cashier/device for the audit trail.
  SELECT cashier_user_id, device_id INTO cashier, device
    FROM transactions WHERE id = NEW.transaction_id;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id,
    actor_user_id, device_id,
    payload
  )
  VALUES (
    'tse.signature_recorded',
    'tse_signatures',
    NEW.id,
    COALESCE(NEW.recorded_by_user_id, cashier),
    COALESCE(NEW.device_id, device),
    jsonb_build_object(
      'transaction_id',             NEW.transaction_id,
      'fiskaly_tss_id',             NEW.fiskaly_tss_id,
      'fiskaly_client_id',          NEW.fiskaly_client_id,
      'fiskaly_transaction_number', NEW.fiskaly_transaction_number,
      'signature_counter',          NEW.signature_counter,
      'signature_algorithm',        NEW.signature_algorithm,
      'process_type',               NEW.process_type
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_tse_signature_recorded() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_tse_signatures_after_insert ON tse_signatures;
CREATE TRIGGER trg_tse_signatures_after_insert
  AFTER INSERT ON tse_signatures
  FOR EACH ROW EXECUTE FUNCTION on_tse_signature_recorded();

COMMENT ON FUNCTION on_tse_signature_recorded() IS
  'AFTER INSERT on tse_signatures. Emits a ledger_event ''tse.signature_recorded'' '
  'so the hash chain captures the durable TSE signature evidence. SECURITY DEFINER '
  'owned by warehouse14_security.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. App-role grants.
--    INSERT + SELECT only — NO UPDATE, NO DELETE (immutable evidence).
--    Default privileges (migration 0003) already grant SELECT+INSERT to
--    warehouse14_app on migrator-owned tables; this explicit GRANT mirrors
--    migration 0053 and documents intent at the table.
-- ─────────────────────────────────────────────────────────────────────
GRANT INSERT, SELECT ON TABLE tse_signatures TO warehouse14_app;

-- The on_tse_signature_recorded() function INSERTs into ledger_events;
-- warehouse14_security already holds the column-restricted INSERT (migration 0009).

COMMIT;
