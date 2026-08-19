-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0075 — Owner OS finance backend
--
-- Basel's "Owner barely needs the desktop cashier" push: the mobile app needs
-- a real P&L. Two new Owner-facing planning tables land here; the profit /
-- revenue / inventory-value / metal-weight READ endpoints compute live from
-- the existing `transactions` + `products` tables and add NO schema.
--
-- What lands:
--   (A) expense_category enum (9 German Betriebsausgaben classes).
--   (B) fixed_costs — recurring monthly Fixkosten:
--         label, monthly_amount_cents (> 0), active_from, active_to (NULL =
--         still running), created/updated. Period allocation is computed in
--         the route; a cost line is NEVER deleted, only closed via active_to.
--   (C) operating_expenses — one-off Betriebsausgaben booked per business_day:
--         business_day (Berlin local DATE), category, amount_cents (> 0),
--         note, created_by_user_id, created/updated.
--   (D) Role grants: app gets default SELECT + INSERT (migration 0003) plus
--         column-scoped UPDATE for the PATCH routes; worker gets SELECT only.
--
-- Money here is INTEGER CENTS — these are Owner-facing planning rows, distinct
-- from the fiscal NUMERIC(18,2) `transactions` ledger. The finance API contract
-- speaks cents end-to-end.
--
-- Idempotent + transactional. migrate.sh applies each file with the explicit
-- BEGIN/COMMIT controlling the transaction.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Enum
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_category') THEN
    CREATE TYPE expense_category AS ENUM (
      'WARENEINKAUF',   -- goods / consumables not bought via Ankauf
      'MIETE',          -- one-off rent-adjacent (Kaution etc.)
      'MARKETING',      -- ads, print, listing fees
      'VERSAND',        -- postage / courier
      'BUEROMATERIAL',  -- office supplies
      'REPARATUR',      -- repairs / maintenance
      'GEBUEHREN',      -- bank / platform / professional fees
      'REISEKOSTEN',    -- travel
      'SONSTIGES'       -- other
    );
    COMMENT ON TYPE expense_category IS
      'Nine broad Betriebsausgaben classes for one-off operating_expenses rows.';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. fixed_costs — recurring monthly Fixkosten
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fixed_costs (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  label                 TEXT          NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  monthly_amount_cents  INTEGER       NOT NULL,

  active_from           DATE          NOT NULL,
  active_to             DATE,         -- NULL = still running

  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT fixed_costs_amount_positive CHECK (monthly_amount_cents > 0),
  CONSTRAINT fixed_costs_range_ordered   CHECK (active_to IS NULL OR active_to >= active_from)
);

-- "Currently running" cost lines — hot path for the live P&L allocation.
CREATE INDEX IF NOT EXISTS fixed_costs_active_idx
  ON fixed_costs (active_from)
  WHERE active_to IS NULL;

-- Range scan for historical month allocation.
CREATE INDEX IF NOT EXISTS fixed_costs_range_idx
  ON fixed_costs (active_from, active_to);

DROP TRIGGER IF EXISTS fixed_costs_set_updated_at_trg ON fixed_costs;
CREATE TRIGGER fixed_costs_set_updated_at_trg
  BEFORE UPDATE ON fixed_costs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fixed_costs IS
  'Recurring monthly Fixkosten (Miete, Strom, Versicherung, Abos). Money in '
  'integer cents. Close a line with active_to — never delete (past months keep '
  'their allocation).';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. operating_expenses — one-off Betriebsausgaben per business day
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS operating_expenses (
  id                    UUID              PRIMARY KEY DEFAULT gen_random_uuid(),

  business_day          DATE              NOT NULL,
  category              expense_category  NOT NULL,
  amount_cents          INTEGER           NOT NULL,
  note                  TEXT,

  created_by_user_id    UUID              NOT NULL REFERENCES users(id),

  created_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT operating_expenses_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT operating_expenses_note_length     CHECK (note IS NULL OR length(note) <= 500)
);

-- Period sum hot path: SUM(amount_cents) WHERE business_day BETWEEN … .
CREATE INDEX IF NOT EXISTS operating_expenses_business_day_idx
  ON operating_expenses (business_day, category);

DROP TRIGGER IF EXISTS operating_expenses_set_updated_at_trg ON operating_expenses;
CREATE TRIGGER operating_expenses_set_updated_at_trg
  BEFORE UPDATE ON operating_expenses
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE operating_expenses IS
  'One-off Betriebsausgaben booked against a Berlin-local business_day. Money in '
  'integer cents. Forensic — correct via UPDATE/new row, never delete (GoBD).';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Role grants
-- ═════════════════════════════════════════════════════════════════════════

/* SELECT + INSERT come from the migration 0003 default privileges. UPDATE is
   column-locked here so the PATCH routes can edit the mutable fields while
   created_at / created_by_user_id stay write-once. */
GRANT UPDATE (
  label, monthly_amount_cents, active_from, active_to, updated_at
) ON fixed_costs TO warehouse14_app;

GRANT UPDATE (
  business_day, category, amount_cents, note, updated_at
) ON operating_expenses TO warehouse14_app;

/* Worker role — SELECT only (future reporting / export jobs). */
GRANT SELECT ON fixed_costs        TO warehouse14_worker;
GRANT SELECT ON operating_expenses TO warehouse14_worker;

COMMIT;
