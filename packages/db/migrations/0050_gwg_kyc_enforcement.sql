-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0050 — GwG go-live KYC enforcement (Roman Grützner sign-off, binding).
--
-- Compliance-First, stricter than the legal minimum. Two changes:
--   (A) Smurfing rolling window 7 → 30 days (detect+document+alert only; the
--       €2.000 sum + the detection rules are UNCHANGED).
--   (B) Direction-aware KYC enforcement as an un-bypassable BEFORE INSERT
--       trigger (mirrors transactions_validate_sanctions, 0013 C-2):
--         • ANKAUF — the seller MUST be KYC-identified for EVERY buy from €0.01
--           (hard §259 StGB Hehlerei rule; NO threshold, intentionally NOT
--           settings-toggleable so the binding rule can't be weakened).
--         • VERKAUF — the buyer MUST be KYC-identified when total ≥ the GwG §10
--           threshold (€2.000, configurable via system_settings).
--       One universal rule — no Warengruppen differentiation.
--
-- Settings reconciliation: the dormant `kyc.high_value_threshold_eur` (€10.000,
-- ADR-0018 §6, read NOWHERE in code) disagreed with Roman's €2.000 Verkauf line.
-- We introduce the authoritative `gwg.*` keys and realign the old key to match so
-- there are not two disagreeing thresholds.
--
-- Append-only + idempotent. The trigger function is SECURITY DEFINER owned by
-- warehouse14_security (the app cannot DROP/ALTER/bypass it). A KYC refusal is a
-- TRANSACTION REJECTION, not a new alert type (memory #45 — no ADR needed).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── (A) Smurfing window → 30 days ──────────────────────────────────────────
UPDATE system_settings
   SET value = '30'::jsonb, updated_at = now()
 WHERE key = 'smurfing.ankauf_count_window_days';

-- ─── (B.1) Authoritative GwG identity settings (single source of truth) ──────
INSERT INTO system_settings (key, value, description) VALUES
  ('gwg.verkauf_identity_threshold_eur', '"2000.00"'::jsonb,
   'VERKAUF: buyer ID required when the sale total >= this (GwG §10). Below it: anonymous sale allowed. Roman Grützner go-live sign-off.'),
  ('gwg.ankauf_identity_required_always', 'true'::jsonb,
   'ANKAUF: seller ID required for EVERY buy from EUR 0.01 (hard §259 StGB). Documentation of the binding policy — the trigger enforces it unconditionally and intentionally does NOT read this flag, so the rule cannot be disabled.')
ON CONFLICT (key) DO NOTHING;

-- Reconcile the dormant ADR-0018 §6 key to Roman's €2.000 line so two thresholds
-- never disagree. (It is read nowhere; gwg.verkauf_identity_threshold_eur is the
-- authoritative key the trigger uses.)
UPDATE system_settings
   SET value = '"2000.00"'::jsonb,
       description = 'SUPERSEDED by gwg.verkauf_identity_threshold_eur (the enforced key). Realigned from EUR 10.000 to Roman''s EUR 2.000 Verkauf line so thresholds do not disagree.',
       updated_at = now()
 WHERE key = 'kyc.high_value_threshold_eur';

-- ─── (B.2) The un-bypassable KYC gate — BEFORE INSERT on transactions ────────
CREATE OR REPLACE FUNCTION transactions_validate_kyc() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  c_kyc_verified_at TIMESTAMPTZ;
  verkauf_threshold NUMERIC;
BEGIN
  -- Stornos reverse an already-validated transaction — never re-block a reversal.
  IF NEW.storno_of_transaction_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ── ANKAUF: ID ALWAYS required, from EUR 0.01 (hard §259 StGB) ──
  IF NEW.direction = 'ANKAUF' THEN
    -- customer_id NOT NULL is already guaranteed by transactions_ankauf_requires_customer.
    SELECT kyc_verified_at INTO c_kyc_verified_at
      FROM customers WHERE id = NEW.customer_id;
    IF c_kyc_verified_at IS NULL THEN
      RAISE EXCEPTION 'KYC hard-block (Ankauf): seller % is not ID-verified; every Ankauf requires identification (§ 259 StGB)', NEW.customer_id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- ── VERKAUF: ID required at/above the GwG §10 threshold (default EUR 2.000) ──
  IF NEW.direction = 'VERKAUF' THEN
    SELECT COALESCE((value #>> '{}')::numeric, 2000.00)
      INTO verkauf_threshold
      FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_eur';
    IF verkauf_threshold IS NULL THEN
      verkauf_threshold := 2000.00;
    END IF;

    IF NEW.total_eur >= verkauf_threshold THEN
      IF NEW.customer_id IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): sale total % >= % requires an ID-verified buyer (§ 10 GwG); no customer attached', NEW.total_eur, verkauf_threshold
          USING ERRCODE = 'check_violation';
      END IF;
      SELECT kyc_verified_at INTO c_kyc_verified_at
        FROM customers WHERE id = NEW.customer_id;
      IF c_kyc_verified_at IS NULL THEN
        RAISE EXCEPTION 'KYC hard-block (Verkauf): buyer % is not ID-verified; a sale total % >= % requires identification (§ 10 GwG)', NEW.customer_id, NEW.total_eur, verkauf_threshold
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION transactions_validate_kyc() OWNER TO warehouse14_security;

-- The function reads customers.kyc_verified_at + system_settings. Narrow grants.
GRANT SELECT (id, kyc_verified_at) ON customers TO warehouse14_security;
GRANT SELECT (key, value) ON system_settings TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_transactions_validate_kyc ON transactions;
CREATE TRIGGER trg_transactions_validate_kyc
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION transactions_validate_kyc();

COMMIT;
