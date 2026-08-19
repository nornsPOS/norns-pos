-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0034 — Seed the Owner-editable Ankauf safety margin (Epic A, A3)
--
-- Adds the `pricing.ankauf_safety_margin_pct` system_settings key so the
-- /api/metal-prices/rates handler reads a real value and PATCH
-- /api/metal-prices/margin updates an existing row (mirrors the lbma.latest_fix
-- convention — keys are seeded by migrations; the app role only changes
-- values, never creates/deletes keys, per system_settings' design).
--
-- Value is a bare jsonb fraction (0.10 = 10%), matching the existing
-- threshold keys (anomaly.sigma_threshold = 3.0, ai_budget.* …).
--
-- Idempotent: ON CONFLICT DO NOTHING preserves any value an Owner has already
-- set if this migration is ever re-run.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO system_settings (key, value, description) VALUES
  (
    'pricing.ankauf_safety_margin_pct',
    '0.10'::jsonb,
    'Ankauf safety margin as a fraction (0.10 = 10%). Buy rate = 10-day average × (1 − pct). Owner-editable via PATCH /api/metal-prices/margin (step-up). Epic A Phase A3.'
  )
ON CONFLICT (key) DO NOTHING;

COMMIT;
