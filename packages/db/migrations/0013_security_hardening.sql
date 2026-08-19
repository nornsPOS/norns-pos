-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0013 — Security hardening (Red Team Audit fixes, 2026-05-25)
--
-- This migration closes six gaps where the *documented intent* (ADRs 0007,
-- 0008, 0014, 0016, 0018, 0020) was not yet *enforced by the database*. Every
-- fix here means a category of app-layer bug can no longer corrupt fiscal /
-- legal / inventory state — the database refuses on its own.
--
-- See docs/architecture/RED_TEAM_AUDIT_2026-05-25.md for the full audit.
--
-- The six fixes — append-only, surgical, no existing tables/triggers touched:
--
--   C-1  CHECK constraint  ─ ANKAUF requires customer_id (ADR-0007, §259 StGB).
--   C-2  BEFORE INSERT trg ─ sanctions hard-block on transactions (ADR-0018 §6).
--   C-3  BEFORE INSERT trg ─ no transactions for FINALIZED business days
--                            (ADR-0008, KassenSichV Z-report immutability).
--   C-4  AFTER UPDATE trg  ─ release viewing-holds on terminal appointment
--                            states (ADR-0016 §6 + ADR-0020 §6).
--   C-5  UNIQUE partial    ─ one storno per original transaction, one linked
--                            transaction per appointment (ADR-0008 §5, GoBD).
--   C-6  AFTER INSERT trg  ─ pg_notify('warehouse14_ledger', NEW.id::text)
--                            so SSE can push instead of poll (ADR-0014 §4).
--
-- Trigger ownership discipline (ADR-0008 §10, ADR-0018 §10):
--   Every new SECURITY DEFINER function is `ALTER FUNCTION … OWNER TO
--   warehouse14_security`. A compromised warehouse14_app cannot DROP/ALTER
--   them because it does not own them.
--
-- Idempotent: CREATE OR REPLACE on functions, DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER, CREATE UNIQUE INDEX IF NOT EXISTS, ALTER TABLE … ADD
-- CONSTRAINT IF NOT EXISTS pattern via DO block.
-- Transactional: BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- C-1 — ANKAUF without customer_id is silently accepted
--
-- ADR violated: ADR-0007 — "ID ALWAYS required for any customer buy".
-- Legal risk:   §259 StGB Hehlerei defense collapses if the shop cannot
--               prove good-faith due diligence on the Ankauf.
--
-- Fix: a CHECK constraint. Direction='ANKAUF' ⇒ customer_id IS NOT NULL.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'transactions_ankauf_requires_customer'
       AND conrelid = 'transactions'::regclass
  ) THEN
    ALTER TABLE transactions
      ADD CONSTRAINT transactions_ankauf_requires_customer
      CHECK (direction <> 'ANKAUF' OR customer_id IS NOT NULL);
  END IF;
END$$;

COMMENT ON CONSTRAINT transactions_ankauf_requires_customer ON transactions IS
  'Red Team Audit C-1: every Ankauf (we buy from customer) MUST identify the seller. '
  'ADR-0007 + §259 StGB. The legal "ID always required" rule, now DB-enforced.';

-- ═════════════════════════════════════════════════════════════════════════
-- C-2 — Sanctions match does not block transactions
--
-- ADR violated: ADR-0018 §6 — "Sanctions match → Hard block. Sale cannot proceed."
-- Legal risk:   EU + US sanctions fines that dwarf any single sale.
--
-- Fix: BEFORE INSERT trigger that rejects any transaction whose customer_id
--      points to a row with sanctions_match = TRUE. SECURITY DEFINER owned by
--      warehouse14_security so the app cannot bypass / DROP it.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION transactions_validate_sanctions() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  c_sanctioned BOOLEAN;
BEGIN
  -- Walk-in cash sale below KYC threshold: no customer attached. Nothing to check.
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sanctions_match
    INTO c_sanctioned
    FROM customers
   WHERE id = NEW.customer_id;

  -- A non-existent customer_id will be rejected by the FK; we only act on TRUE.
  IF c_sanctioned IS TRUE THEN
    RAISE EXCEPTION 'Sanctions hard-block: customer % is sanctions-flagged; transaction refused (ADR-0018 §6)', NEW.customer_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION transactions_validate_sanctions() OWNER TO warehouse14_security;

-- The function reads customers.sanctions_match. Narrow column-level SELECT.
GRANT SELECT (id, sanctions_match) ON customers TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transactions_validate_sanctions ON transactions;
CREATE TRIGGER trg_transactions_validate_sanctions
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_validate_sanctions();

COMMENT ON FUNCTION transactions_validate_sanctions() IS
  'Red Team Audit C-2: hard-block any transaction for a sanctions-flagged customer. '
  'BEFORE INSERT. SECURITY DEFINER, owned by warehouse14_security.';

-- ═════════════════════════════════════════════════════════════════════════
-- C-3 — Transactions can be inserted for a FINALIZED business day
--
-- ADR violated: ADR-0008 (closing immutability), KassenSichV (Z-report is
--               the immutable daily record).
-- Scenario:     Cashier finalizes at 23:55. At 23:58 a delayed Mollie webhook
--               lands a sale with finalized_at on the closed day. Z-report
--               is now wrong; the auditor finds it during Steuerprüfung.
--
-- Fix: BEFORE INSERT trigger. If a FINALIZED daily_closings row exists for
--      berlin_business_day(NEW.finalized_at) and the same shop_id, refuse.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION transactions_validate_closing_day() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  finalized_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM daily_closings dc
     WHERE dc.business_day = berlin_business_day(NEW.finalized_at)
       AND dc.shop_id IS NOT DISTINCT FROM NEW.shop_id
       AND dc.state = 'FINALIZED'
  ) INTO finalized_exists;

  IF finalized_exists THEN
    RAISE EXCEPTION
      'Closing-day guard: business day % is FINALIZED (shop %); cannot insert transaction (ADR-0008 + KassenSichV)',
      berlin_business_day(NEW.finalized_at), COALESCE(NEW.shop_id::text, 'NULL')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION transactions_validate_closing_day() OWNER TO warehouse14_security;

-- The function reads daily_closings. Narrow column-level SELECT.
GRANT SELECT (business_day, shop_id, state) ON daily_closings TO warehouse14_security;

-- The function calls berlin_business_day(); EXECUTE inside a SECURITY DEFINER
-- runs as the function owner (warehouse14_security), which lacks EXECUTE by default.
GRANT EXECUTE ON FUNCTION berlin_business_day(TIMESTAMPTZ) TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transactions_validate_closing_day ON transactions;
CREATE TRIGGER trg_transactions_validate_closing_day
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_validate_closing_day();

COMMENT ON FUNCTION transactions_validate_closing_day() IS
  'Red Team Audit C-3: refuse any transaction landing on a FINALIZED business day '
  '(per ADR-0008 closing immutability + KassenSichV Z-report). SECURITY DEFINER.';

-- ═════════════════════════════════════════════════════════════════════════
-- C-4 — Soft viewing-holds NOT released when appointment terminates
--
-- ADR violated: ADR-0016 §6 + ADR-0020 §6.
-- Operational:  Appointment cancelled at 09:00 for a 17:00 slot leaves the
--               linked products invisible-blocked for 8h until hold_expires_at.
--               Storefront / eBay buyers see them as unavailable.
--
-- Fix: AFTER UPDATE trigger on appointments. When status transitions into a
--      terminal value (CANCELLED / NO_SHOW / RESCHEDULED / COMPLETED),
--      release every unreleased product_viewing_holds row for that
--      appointment with a structured released_reason.
--
-- Note: COMPLETED is included because by the time the customer is served,
--       either a sale happened (product is SOLD, hold is moot) or they walked
--       out without buying (hold serves no purpose — let inventory breathe).
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION release_holds_on_terminal_appointment() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  -- Status unchanged: nothing to do.
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Only act on transitions into terminal states.
  IF NEW.status NOT IN ('COMPLETED', 'NO_SHOW', 'CANCELLED', 'RESCHEDULED') THEN
    RETURN NEW;
  END IF;

  UPDATE product_viewing_holds
     SET released_at     = now(),
         released_reason = 'appointment_' || lower(NEW.status::text)
   WHERE appointment_id = NEW.id
     AND released_at IS NULL;

  RETURN NEW;
END;
$$;

ALTER FUNCTION release_holds_on_terminal_appointment() OWNER TO warehouse14_security;

-- The function updates released_at + released_reason; needs SELECT on
-- (appointment_id, released_at) for the WHERE clause.
GRANT SELECT (appointment_id, released_at, released_reason)
  ON product_viewing_holds TO warehouse14_security;
GRANT UPDATE (released_at, released_reason)
  ON product_viewing_holds TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_release_holds_on_terminal_appointment ON appointments;
CREATE TRIGGER trg_release_holds_on_terminal_appointment
  AFTER UPDATE OF status ON appointments
  FOR EACH ROW EXECUTE FUNCTION release_holds_on_terminal_appointment();

COMMENT ON FUNCTION release_holds_on_terminal_appointment() IS
  'Red Team Audit C-4: on appointment status → terminal (CANCELLED/NO_SHOW/RESCHEDULED/COMPLETED), '
  'release every unreleased viewing-hold for that appointment. '
  'AFTER UPDATE OF status. SECURITY DEFINER, owned by warehouse14_security.';

-- ═════════════════════════════════════════════════════════════════════════
-- C-5 — Duplicate storno + duplicate appointment-transaction link possible
--
-- ADR violated: ADR-0008 §5 + GoBD discipline (one original, at most one
--               reversal); ADR-0020 (an appointment can result in at most
--               one transaction).
--
-- Fix: Partial UNIQUE indexes.
--   • Each transaction can be the original of AT MOST ONE storno.
--   • Each appointment can be linked to AT MOST ONE transaction.
-- ═════════════════════════════════════════════════════════════════════════

CREATE UNIQUE INDEX IF NOT EXISTS transactions_one_storno_per_original_uq
  ON transactions (storno_of_transaction_id)
  WHERE storno_of_transaction_id IS NOT NULL;

COMMENT ON INDEX transactions_one_storno_per_original_uq IS
  'Red Team Audit C-5: at most one storno row per original transaction. '
  'Partial UNIQUE — NULLs (originals) excluded. ADR-0008 §5 + GoBD.';

CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_transaction_link_uq
  ON appointments (linked_transaction_id)
  WHERE linked_transaction_id IS NOT NULL;

COMMENT ON INDEX appointments_one_transaction_link_uq IS
  'Red Team Audit C-5: an appointment can result in at most one transaction. '
  'Partial UNIQUE — NULLs (no sale yet) excluded. ADR-0020.';

-- ═════════════════════════════════════════════════════════════════════════
-- C-6 — No pg_notify substrate for SSE
--
-- ADR violated: ADR-0014 §4 — "SSE = projection from ledger_events with
--               monotonic ID".
-- Operational:  The Bridge UX needs sub-second push of new ledger rows.
--               Without pg_notify, the API would poll — wasteful + sluggish.
--
-- Fix: AFTER INSERT row trigger on ledger_events that emits
--      pg_notify('warehouse14_ledger', NEW.id::text).
--      Subscribers `LISTEN warehouse14_ledger;` and on payload arrival do
--      `SELECT … FROM ledger_events WHERE id = $1`.
--
-- pg_notify payload limit is 8000 bytes — we send only the id (small text)
-- to stay well under, and avoid the consistency risk of broadcasting full
-- rows (e.g. payload size, encoding pitfalls). The subscriber reads through
-- the table for the authoritative row.
--
-- The function does NOT need SECURITY DEFINER: pg_notify is granted to PUBLIC
-- by default in Postgres, so any role that fires the trigger (the inserter)
-- can NOTIFY in its own session.
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ledger_events_notify() RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = public, pg_catalog, pg_temp
  AS $$
BEGIN
  PERFORM pg_notify('warehouse14_ledger', NEW.id::text);
  RETURN NULL;  -- AFTER trigger return value is ignored
END;
$$;

-- This one is NOT owned by warehouse14_security — pg_notify needs no special
-- privileges, and the function does no reads/writes against tables. Migrator
-- owns it (the default).

DROP TRIGGER IF EXISTS trg_ledger_events_notify ON ledger_events;
CREATE TRIGGER trg_ledger_events_notify
  AFTER INSERT ON ledger_events
  FOR EACH ROW EXECUTE FUNCTION ledger_events_notify();

COMMENT ON FUNCTION ledger_events_notify() IS
  'Red Team Audit C-6: pg_notify(''warehouse14_ledger'', NEW.id::text) on every '
  'ledger_events INSERT. Substrate for SSE push (ADR-0014 §4). '
  'Payload = id only; subscribers fetch the row by primary key.';

COMMIT;
