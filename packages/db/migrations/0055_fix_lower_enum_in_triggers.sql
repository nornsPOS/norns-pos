-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0055 — fix `lower(<enum>)` in three SECURITY DEFINER ledger triggers.
--
-- Latent runtime bug (read-only DB verification; reproduced on pg16 + pg17):
-- three ledger-event trigger functions call `lower(NEW.state)` / `lower(NEW.status)`
-- directly on an ENUM column. PostgreSQL has NO implicit enum→text cast, so the call
-- resolves to `function lower(<enum>) does not exist` THE FIRST TIME the trigger fires
-- at RUNTIME. The plpgsql bodies were created fine at migration time (bodies aren't
-- type-checked until executed, and migrate.sh runs with check_function_bodies=off), so
-- prod installed cleanly at 0050 but would throw on:
--   • the first real TSE state event          → on_tse_state_event()         (0010)
--   • the first real Kassenabschluss insert     → on_daily_closing_event()     (0011)
--   • the first real appointment status event   → on_appointment_state_event() (0012)
--
-- Fix: `lower(NEW.state)` → `lower(NEW.state::text)` (and `NEW.status` → `NEW.status::text`).
-- Note the sibling `'tse.' || NEW.state` style concat already WORKS — `text || anynonarray`
-- casts via the enum's output function; only the explicit `lower(<enum>)` call is unresolved.
--
-- Append-only + idempotent. CREATE OR REPLACE FUNCTION keeps the existing trigger
-- bindings (no DROP/CREATE TRIGGER). Each body is copied BYTE-FOR-BYTE from the
-- immutable 0010/0011/0012 files except the single enum→text cast; SECURITY DEFINER,
-- the `SET search_path`, and the warehouse14_security owner are all preserved.
-- ──────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────
-- 1. on_tse_state_event() — from 0010_tse.sql §4
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

  evt_type := 'tse.' || lower(NEW.state::text);   -- e.g. 'tse.finished', 'tse.failed'

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

-- ─────────────────────────────────────────────────────────────────────
-- 2. on_daily_closing_event() — from 0011_closing.sql §4
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_daily_closing_event() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  -- Skip non-state UPDATEs.
  IF TG_OP = 'UPDATE' AND NEW.state = OLD.state THEN
    RETURN NEW;
  END IF;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id, actor_user_id, payload
  )
  VALUES (
    'daily_closing.' || lower(NEW.state::text),
    'daily_closings',
    NEW.id,
    COALESCE(NEW.finalized_by_user_id, NEW.counted_by_user_id),
    jsonb_build_object(
      'business_day',             to_char(NEW.business_day, 'YYYY-MM-DD'),
      'state',                    NEW.state,
      'verkauf_count',            NEW.verkauf_count,
      'ankauf_count',             NEW.ankauf_count,
      'storno_count',             NEW.storno_count,
      'gross_verkauf_eur',        NEW.gross_verkauf_eur::text,
      'gross_ankauf_eur',         NEW.gross_ankauf_eur::text,
      'net_verkauf_eur',          NEW.net_verkauf_eur::text,
      'net_ankauf_eur',           NEW.net_ankauf_eur::text,
      'cash_drawer_variance_eur', NEW.cash_drawer_variance_eur::text,
      'tse_finished_count',       NEW.tse_finished_count,
      'tse_pending_count',        NEW.tse_pending_count,
      'tse_failed_count',         NEW.tse_failed_count,
      'ledger_anchor_id',         NEW.ledger_anchor_id
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_daily_closing_event() OWNER TO warehouse14_security;

-- ─────────────────────────────────────────────────────────────────────
-- 3. on_appointment_state_event() — from 0012_appointments.sql §10
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_appointment_state_event() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  INSERT INTO ledger_events (
    event_type, entity_table, entity_id, actor_user_id, payload
  )
  VALUES (
    'appointment.' || lower(NEW.status::text),
    'appointments',
    NEW.id,
    COALESCE(NEW.booked_by_user_id, NEW.staff_user_id),
    jsonb_build_object(
      'appointment_type', NEW.appointment_type,
      'status',           NEW.status,
      'previous_status',  CASE WHEN TG_OP = 'UPDATE' THEN OLD.status::text END,
      'starts_at',        to_char(NEW.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'duration_minutes', NEW.duration_minutes,
      'staff_user_id',    NEW.staff_user_id,
      'customer_id',      NEW.customer_id,
      'booked_via',       NEW.booked_via
    )
  );

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_appointment_state_event() OWNER TO warehouse14_security;
