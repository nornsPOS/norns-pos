-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0059 — AML enforcement: DB-level BANNED-customer transaction block
--                  (+ the SELECT grant the new trigger needs).
--
-- Context (Track A security audit, 2026-06-09):
--   • Migration 0013 (C-2) added `transactions_validate_sanctions` — a BEFORE
--     INSERT trigger that hard-blocks any transaction for a customer with
--     `customers.sanctions_match = TRUE`. The route
--     POST /api/customers/:id/check-sanctions was fixed in the same Track A
--     pass to actually WRITE sanctions_match=TRUE on a positive screen (it
--     previously only wrote an audit_log row, so the column stayed FALSE and
--     the sanctions wall never fired). The app role already holds
--     UPDATE(sanctions_match, sanctions_screened_at) on customers (granted in
--     0007 §7), so NO grant is needed for that write — verified empirically by
--     this migration's test.
--
--   • Migration 0024 introduced customer_trust_level with a 'BANNED' value
--     documented as "refused service" — but NOTHING enforces it. Sanctions,
--     KYC (0050) and closing-day (0013 C-3) all have BEFORE INSERT triggers on
--     `transactions`; BANNED had none. So a customer an Owner deliberately
--     marked BANNED ("refuse service") could still complete a sale or an
--     Ankauf. This migration closes that dead gate at the database layer, the
--     same defense-in-depth posture as the other AML walls: even a compromised
--     or buggy warehouse14_app cannot transact for a BANNED customer.
--
-- This is APPEND-ONLY and ADDITIVE. It does NOT touch / weaken any existing
-- trigger or grant. It only adds a new refusal.
--
-- Trigger ownership discipline (ADR-0008 §10, ADR-0018 §10):
--   The new function is SECURITY DEFINER, `ALTER FUNCTION … OWNER TO
--   warehouse14_security`, so warehouse14_app cannot DROP/ALTER it.
--
-- Idempotent: CREATE OR REPLACE on the function, DROP TRIGGER IF EXISTS before
-- CREATE TRIGGER, GRANT is idempotent. Transactional: BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- BANNED customers cannot transact (ADR-0024 — trust_level 'BANNED' = refused
-- service). BEFORE INSERT trigger that refuses any VERKAUF/ANKAUF whose
-- customer is flagged BANNED. SECURITY DEFINER owned by warehouse14_security so
-- the app cannot bypass / DROP it (mirrors transactions_validate_sanctions).
-- ═════════════════════════════════════════════════════════════════════════

-- The function READS customers.trust_level. warehouse14_security currently has
-- column-level SELECT only on (id, sanctions_match) (0013), (kyc_verified_at)
-- (0050) and the three cumulative counters (0046). Grant the one column the new
-- trigger needs — narrow, like every other security-role grant.
GRANT SELECT (trust_level) ON customers TO warehouse14_security;

CREATE OR REPLACE FUNCTION transactions_validate_trust_level() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  c_trust customer_trust_level;
BEGIN
  -- Walk-in cash sale below KYC threshold: no customer attached. Nothing to check.
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT trust_level
    INTO c_trust
    FROM customers
   WHERE id = NEW.customer_id;

  -- A non-existent customer_id is rejected by the FK; we only act on BANNED.
  IF c_trust = 'BANNED' THEN
    RAISE EXCEPTION
      'Trust-level hard-block: customer % is BANNED (refused service); transaction refused (ADR-0024)',
      NEW.customer_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION transactions_validate_trust_level() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transactions_validate_trust_level ON transactions;
CREATE TRIGGER trg_transactions_validate_trust_level
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_validate_trust_level();

COMMENT ON FUNCTION transactions_validate_trust_level() IS
  'Migration 0059: hard-block any transaction for a BANNED customer (ADR-0024 '
  '"refused service"). BEFORE INSERT. SECURITY DEFINER, owned by warehouse14_security. '
  'Defense-in-depth complement to the sanctions (0013 C-2) + KYC (0050) walls.';

COMMIT;
