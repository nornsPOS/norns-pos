-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0002 — Helper functions
--
-- Purpose: cross-cutting helper functions used by triggers and indexes across
-- every later migration. Pure SQL or PL/pgSQL; no table dependencies; safe to
-- create before any tables exist.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- Transactional: wrapped in BEGIN/COMMIT.
--
-- ADR references:
--   • ADR-0008 §7 — berlin_business_day() as IMMUTABLE for functional indexes
--   • ADR-0008 §8 — set_updated_at() trigger fn pattern
--   • ADR-0015 §5 — Oliver Roos `backend/src/lib/finance/berlinMonthBounds.ts`
--     is the conceptual ancestor; this lifts the logic into the DB so the
--     Steuerberater's read-only role gets identical answers.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- berlin_business_day(ts TIMESTAMPTZ) RETURNS DATE
--
-- Wraps a tz-aware timestamp into the Europe/Berlin midnight-to-midnight day
-- boundary it falls on. DST handled automatically by PG's tz database (zic).
--
-- Marked:
--   • IMMUTABLE     — output depends only on input. Required so PG can use
--                     this in functional indexes:
--                       CREATE INDEX idx_x_business_day ON x (berlin_business_day(ts));
--                     Without IMMUTABLE, PG refuses the index and downstream
--                     queries fall back to seq scans.
--   • PARALLEL SAFE — no side effects, no shared state — usable in parallel
--                     query plans.
--   • LANGUAGE SQL  — single SELECT, inlinable by the planner.
--
-- Time-zone correctness note:
--   PG's `Europe/Berlin` is data-driven from the system zoneinfo. DST
--   transitions are facts in that data, not behaviour in the function. The
--   function is mathematically a pure projection: (ts, tz) → DATE.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION berlin_business_day(ts TIMESTAMPTZ) RETURNS DATE
  LANGUAGE SQL IMMUTABLE PARALLEL SAFE
  RETURN (ts AT TIME ZONE 'Europe/Berlin')::DATE;

COMMENT ON FUNCTION berlin_business_day(TIMESTAMPTZ) IS
  'Convert a tz-aware timestamp to the Europe/Berlin business day it falls on. '
  'IMMUTABLE — usable in functional indexes. DST-correct via PG zoneinfo. '
  'See ADR-0008 §7.';

-- ─────────────────────────────────────────────────────────────────────
-- set_updated_at() — generic BEFORE UPDATE trigger function
--
-- Stamps NEW.updated_at = now() on every UPDATE. Used uniformly across every
-- table that carries created_at + updated_at columns.
--
-- Application pattern (in later migrations):
--
--   CREATE TRIGGER trg_<table>_updated_at
--     BEFORE UPDATE ON <table>
--     FOR EACH ROW
--     EXECUTE FUNCTION set_updated_at();
--
-- We deliberately do NOT short-circuit on "no real change" — a row-level
-- UPDATE that touches only audit columns must still bump updated_at, so
-- downstream consumers (Bridge live feed, SSE projections) see the event.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION set_updated_at() IS
  'BEFORE UPDATE trigger fn. Stamps updated_at = now() on every row. '
  'Apply via CREATE TRIGGER ... BEFORE UPDATE ... EXECUTE FUNCTION set_updated_at(). '
  'See ADR-0008 §8.';

COMMIT;
