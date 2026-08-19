-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0046 — Grant warehouse14_security SELECT on the cumulative customer
-- columns its own SECURITY DEFINER triggers read.
--
-- The accumulation triggers run as warehouse14_security (SECURITY DEFINER):
--   • on_transaction_finalized()          (0009): SET cumulative_spend_eur  = cumulative_spend_eur  + …
--                                                 SET cumulative_ankauf_eur = cumulative_ankauf_eur + …
--   • transaction_payments_accumulate_debt() (0016): SET cumulative_debt_eur = cumulative_debt_eur + …
--
-- Each does `col = col + NEW.x`, which READS `col`. PostgreSQL requires SELECT
-- privilege on a column whose value is read in an UPDATE's SET expression — but
-- 0009/0016 granted warehouse14_security only UPDATE on those columns (and 0013
-- granted SELECT on just id + sanctions_match). So as soon as a transaction is
-- finalized for a KNOWN customer (customer_id set), or a DEBT payment lands, the
-- trigger fails with "permission denied for table customers" and the whole
-- transaction aborts. Only anonymous (customer_id NULL) transactions work today.
--
-- Fix: grant the missing column-level SELECT. This is the minimal complement to
-- the existing UPDATE grants — security can read exactly the three counters it
-- already maintains, nothing more.
-- ──────────────────────────────────────────────────────────────────────────

GRANT SELECT (cumulative_spend_eur, cumulative_ankauf_eur, cumulative_debt_eur)
  ON customers TO warehouse14_security;
