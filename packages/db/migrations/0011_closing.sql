-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0011 — Daily closings + DSFinV-K exports + system settings
--
-- The accounting circle closes here:
--   • daily_closings — the Z-report per Berlin business day. Immutable once
--     FINALIZED. Carries a `ledger_anchor_*` snapshot of the chain head at
--     close — the daily checkpoint anchor for ADR-0008 §Known limits #2.
--   • dsfinvk_exports — the legal trail of "we delivered the DSFinV-K bundle
--     to the Steuerberater on date X". Append-only.
--   • system_settings — the runtime config store. Every change writes to
--     audit_log automatically via a SECURITY DEFINER trigger.
--
-- ADR references:
--   • ADR-0008 §Known limits #2 — daily checkpoint anchors
--   • ADR-0014 §End-of-day mode — the wizard that creates the closing row
--   • ADR-0018 §3 — TSE archive period mismatch detection (closing blocked)
--   • ADR-0019 §10 — End-of-day wizard, DSFinV-K export emailed
--   • memory.md §3 — DSFinV-K v2.0 export discipline
--
-- Basel Day-9 directives:
--   1. Closing immutability — once FINALIZED, all totals + counts + anchors
--      + finalization markers are locked. Only `notes` can change after.
--   2. DSFinV-K audit trail — every export records who/when/period; no DELETE.
--   3. System settings audit — every change writes to audit_log automatically.
--
-- Idempotent; transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ENUMs
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'closing_state') THEN
    CREATE TYPE closing_state AS ENUM (
      'COUNTING',         -- cashier is counting the drawer; totals visible
      'FINALIZED'         -- Z-report locked, fully immutable
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dsfinvk_export_state') THEN
    CREATE TYPE dsfinvk_export_state AS ENUM (
      'GENERATING',                   -- worker is building the bundle
      'GENERATED',                    -- bundle ready in R2
      'DELIVERED_TO_STEUERBERATER',   -- emailed or downloaded
      'FAILED'                        -- generation/delivery failed
    );
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. daily_closings — the Z-report per business day
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_closings (
  id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID,                                  -- V1 NULL
  business_day                DATE            NOT NULL,

  state                       closing_state   NOT NULL DEFAULT 'COUNTING',

  -- Transaction counts (originals only; storno counted separately)
  verkauf_count               INTEGER         NOT NULL DEFAULT 0,
  ankauf_count                INTEGER         NOT NULL DEFAULT 0,
  storno_count                INTEGER         NOT NULL DEFAULT 0,

  -- Money totals (net of storno via the negative-amount arithmetic)
  gross_verkauf_eur           NUMERIC(18,2)   NOT NULL DEFAULT 0,
  gross_ankauf_eur            NUMERIC(18,2)   NOT NULL DEFAULT 0,
  net_verkauf_eur             NUMERIC(18,2)   NOT NULL DEFAULT 0,
  net_ankauf_eur              NUMERIC(18,2)   NOT NULL DEFAULT 0,

  -- VAT collected per tax treatment code — JSONB object { code: amount-string }
  vat_by_treatment            JSONB           NOT NULL DEFAULT '{}'::jsonb,

  -- Payment method breakdown — JSONB object { method: amount-string }
  payments_by_method          JSONB           NOT NULL DEFAULT '{}'::jsonb,

  -- Cash drawer reconciliation
  cash_drawer_expected_eur    NUMERIC(18,2),                        -- computed from CASH payments
  cash_drawer_counted_eur     NUMERIC(18,2),                        -- entered by cashier
  cash_drawer_variance_eur    NUMERIC(18,2),                        -- counted - expected

  -- TSE health summary at close
  tse_finished_count          INTEGER         NOT NULL DEFAULT 0,
  tse_pending_count           INTEGER         NOT NULL DEFAULT 0,
  tse_failed_count            INTEGER         NOT NULL DEFAULT 0,

  -- The daily checkpoint anchor (ADR-0008 §Known limits #2)
  ledger_anchor_id            BIGINT          REFERENCES ledger_events(id),
  ledger_anchor_hash          BYTEA,

  -- Finalization
  counted_by_user_id          UUID            REFERENCES users(id),
  counted_at                  TIMESTAMPTZ,
  finalized_by_user_id        UUID            REFERENCES users(id),
  finalized_at                TIMESTAMPTZ,
  notes                       TEXT,

  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- One closing per (business_day, shop)
  CONSTRAINT daily_closings_business_day_shop_uq UNIQUE (business_day, shop_id),

  -- FINALIZED requires all the legally-required fields filled
  CONSTRAINT daily_closings_finalized_has_evidence
    CHECK (state <> 'FINALIZED' OR (
      finalized_by_user_id        IS NOT NULL AND
      finalized_at                IS NOT NULL AND
      counted_by_user_id          IS NOT NULL AND
      counted_at                  IS NOT NULL AND
      cash_drawer_counted_eur     IS NOT NULL AND
      cash_drawer_expected_eur    IS NOT NULL AND
      cash_drawer_variance_eur    IS NOT NULL AND
      ledger_anchor_id            IS NOT NULL AND
      ledger_anchor_hash          IS NOT NULL AND
      octet_length(ledger_anchor_hash) = 32
    )),

  -- Variance math invariant
  CONSTRAINT daily_closings_variance_math
    CHECK (
      cash_drawer_variance_eur IS NULL OR
      (
        cash_drawer_counted_eur  IS NOT NULL AND
        cash_drawer_expected_eur IS NOT NULL AND
        cash_drawer_variance_eur = cash_drawer_counted_eur - cash_drawer_expected_eur
      )
    ),

  -- Non-negative counts
  CONSTRAINT daily_closings_counts_non_negative
    CHECK (
      verkauf_count       >= 0 AND
      ankauf_count        >= 0 AND
      storno_count        >= 0 AND
      tse_finished_count  >= 0 AND
      tse_pending_count   >= 0 AND
      tse_failed_count    >= 0
    ),

  -- vat_by_treatment + payments_by_method must be JSON objects (not arrays/scalars)
  CONSTRAINT daily_closings_vat_object CHECK (jsonb_typeof(vat_by_treatment) = 'object'),
  CONSTRAINT daily_closings_payments_object CHECK (jsonb_typeof(payments_by_method) = 'object'),

  -- Gross totals are always non-negative; net can be negative only via storno-heavy day
  CONSTRAINT daily_closings_gross_non_negative
    CHECK (gross_verkauf_eur >= 0 AND gross_ankauf_eur >= 0)
);

CREATE INDEX IF NOT EXISTS daily_closings_state_idx
  ON daily_closings (state, business_day DESC);

CREATE INDEX IF NOT EXISTS daily_closings_business_day_idx
  ON daily_closings (business_day DESC);

CREATE INDEX IF NOT EXISTS daily_closings_finalized_idx
  ON daily_closings (finalized_at DESC)
  WHERE state = 'FINALIZED';

CREATE TRIGGER trg_daily_closings_updated_at
  BEFORE UPDATE ON daily_closings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE daily_closings IS
  'The Z-report. One row per (business_day, shop_id). Immutable once FINALIZED — '
  'all totals, counts, anchors, and finalization markers are locked. Only `notes` is editable after.';
COMMENT ON COLUMN daily_closings.ledger_anchor_hash IS
  'SHA-256 of the chain head at FINALIZED time — the daily checkpoint anchor (ADR-0008 §Known limits #2).';

-- ─────────────────────────────────────────────────────────────────────
-- 3. State trigger — Closing Immutability
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION daily_closings_validate_state() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  -- Once FINALIZED → all numeric/count/anchor fields are LOCKED.
  -- Only `notes` (and `updated_at` via trigger) may change.
  IF OLD.state = 'FINALIZED' THEN
    IF NEW.state <> 'FINALIZED' THEN
      RAISE EXCEPTION 'Cannot transition out of FINALIZED closing (row %)', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    IF
      NEW.business_day              IS DISTINCT FROM OLD.business_day              OR
      NEW.shop_id                   IS DISTINCT FROM OLD.shop_id                   OR
      NEW.verkauf_count             IS DISTINCT FROM OLD.verkauf_count             OR
      NEW.ankauf_count              IS DISTINCT FROM OLD.ankauf_count              OR
      NEW.storno_count              IS DISTINCT FROM OLD.storno_count              OR
      NEW.gross_verkauf_eur         IS DISTINCT FROM OLD.gross_verkauf_eur         OR
      NEW.gross_ankauf_eur          IS DISTINCT FROM OLD.gross_ankauf_eur          OR
      NEW.net_verkauf_eur           IS DISTINCT FROM OLD.net_verkauf_eur           OR
      NEW.net_ankauf_eur            IS DISTINCT FROM OLD.net_ankauf_eur            OR
      NEW.vat_by_treatment          IS DISTINCT FROM OLD.vat_by_treatment          OR
      NEW.payments_by_method        IS DISTINCT FROM OLD.payments_by_method        OR
      NEW.cash_drawer_expected_eur  IS DISTINCT FROM OLD.cash_drawer_expected_eur  OR
      NEW.cash_drawer_counted_eur   IS DISTINCT FROM OLD.cash_drawer_counted_eur   OR
      NEW.cash_drawer_variance_eur  IS DISTINCT FROM OLD.cash_drawer_variance_eur  OR
      NEW.tse_finished_count        IS DISTINCT FROM OLD.tse_finished_count        OR
      NEW.tse_pending_count         IS DISTINCT FROM OLD.tse_pending_count         OR
      NEW.tse_failed_count          IS DISTINCT FROM OLD.tse_failed_count          OR
      NEW.ledger_anchor_id          IS DISTINCT FROM OLD.ledger_anchor_id          OR
      NEW.ledger_anchor_hash        IS DISTINCT FROM OLD.ledger_anchor_hash        OR
      NEW.counted_by_user_id        IS DISTINCT FROM OLD.counted_by_user_id        OR
      NEW.counted_at                IS DISTINCT FROM OLD.counted_at                OR
      NEW.finalized_by_user_id      IS DISTINCT FROM OLD.finalized_by_user_id      OR
      NEW.finalized_at              IS DISTINCT FROM OLD.finalized_at              OR
      NEW.created_at                IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'Cannot modify FINALIZED closing (row %) — only notes is mutable after finalization', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Valid state transitions: COUNTING → FINALIZED only.
  IF NEW.state <> OLD.state THEN
    IF NOT (OLD.state = 'COUNTING' AND NEW.state = 'FINALIZED') THEN
      RAISE EXCEPTION 'Invalid closing state transition: % → % (row %)', OLD.state, NEW.state, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_closings_validate_state ON daily_closings;
CREATE TRIGGER trg_daily_closings_validate_state
  BEFORE UPDATE ON daily_closings
  FOR EACH ROW EXECUTE FUNCTION daily_closings_validate_state();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Ledger event emission on closing state change
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
    'daily_closing.' || lower(NEW.state),
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

DROP TRIGGER IF EXISTS trg_daily_closings_after_insert ON daily_closings;
CREATE TRIGGER trg_daily_closings_after_insert
  AFTER INSERT ON daily_closings
  FOR EACH ROW EXECUTE FUNCTION on_daily_closing_event();

DROP TRIGGER IF EXISTS trg_daily_closings_after_update ON daily_closings;
CREATE TRIGGER trg_daily_closings_after_update
  AFTER UPDATE OF state ON daily_closings
  FOR EACH ROW EXECUTE FUNCTION on_daily_closing_event();

-- ─────────────────────────────────────────────────────────────────────
-- 5. dsfinvk_exports — the legal paper trail
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dsfinvk_exports (
  id                          UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID,

  -- Period covered
  period_start                DATE                    NOT NULL,
  period_end                  DATE                    NOT NULL,

  state                       dsfinvk_export_state    NOT NULL DEFAULT 'GENERATING',

  -- Audit chain
  requested_by_user_id        UUID                    NOT NULL REFERENCES users(id),
  generated_at                TIMESTAMPTZ,
  delivered_at                TIMESTAMPTZ,
  delivery_method             TEXT,                                       -- 'email' | 'manual_download' | 'api'
  delivery_target             TEXT,                                       -- email address etc.

  -- R2 reference
  r2_key                      TEXT,
  file_size_bytes             BIGINT,
  file_sha256                 BYTEA,

  -- Content summary
  transaction_count           INTEGER,
  daily_closings_count        INTEGER,
  total_gross_eur             NUMERIC(18,2),

  -- Linked closings
  daily_closing_ids           UUID[]                  NOT NULL DEFAULT '{}',

  -- Error tracking
  last_error_at               TIMESTAMPTZ,
  last_error_message          TEXT,

  created_at                  TIMESTAMPTZ             NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ             NOT NULL DEFAULT now(),

  CONSTRAINT dsfinvk_exports_period_order CHECK (period_end >= period_start),
  CONSTRAINT dsfinvk_exports_sha256_length
    CHECK (file_sha256 IS NULL OR octet_length(file_sha256) = 32),
  CONSTRAINT dsfinvk_exports_generated_has_file
    CHECK (
      state NOT IN ('GENERATED', 'DELIVERED_TO_STEUERBERATER')
      OR (r2_key IS NOT NULL AND file_sha256 IS NOT NULL AND file_size_bytes IS NOT NULL AND generated_at IS NOT NULL)
    ),
  CONSTRAINT dsfinvk_exports_delivered_has_marker
    CHECK (state <> 'DELIVERED_TO_STEUERBERATER' OR (delivered_at IS NOT NULL AND delivery_method IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS dsfinvk_exports_state_idx
  ON dsfinvk_exports (state, created_at DESC);

CREATE INDEX IF NOT EXISTS dsfinvk_exports_period_idx
  ON dsfinvk_exports (period_start, period_end);

CREATE INDEX IF NOT EXISTS dsfinvk_exports_requested_by_idx
  ON dsfinvk_exports (requested_by_user_id, created_at DESC);

CREATE TRIGGER trg_dsfinvk_exports_updated_at
  BEFORE UPDATE ON dsfinvk_exports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE dsfinvk_exports IS
  'The legal paper trail of DSFinV-K bundle generation and delivery to the Steuerberater. '
  'NEVER deleted by app role. Each row carries the SHA-256 of the bundle, the requester, the period, '
  'and the delivery evidence.';

-- ─────────────────────────────────────────────────────────────────────
-- 6. system_settings — runtime config with audit trail
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
  key                         TEXT            PRIMARY KEY,
  value                       JSONB           NOT NULL,
  description                 TEXT,
  updated_by_user_id          UUID            REFERENCES users(id),
  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Key naming convention: `<domain>.<sub>.<key>` lowercase + dots + underscores
  CONSTRAINT system_settings_key_format
    CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$')
);

CREATE TRIGGER trg_system_settings_updated_at
  BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE system_settings IS
  'Runtime config store. Every change writes to audit_log automatically via SECURITY DEFINER trigger. '
  'NEVER deleted by app role — keys are forever; only their values change.';

-- ─────────────────────────────────────────────────────────────────────
-- 7. system_settings audit trigger — every change → audit_log
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_system_setting_event() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  evt_type TEXT;
  payload  JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    evt_type := 'system_setting.created';
    payload  := jsonb_build_object(
      'key',       NEW.key,
      'new_value', NEW.value
    );
  ELSE
    -- Skip no-op UPDATEs (e.g. value unchanged but row touched).
    IF NEW.value = OLD.value THEN
      RETURN NEW;
    END IF;
    evt_type := 'system_setting.updated';
    payload  := jsonb_build_object(
      'key',       NEW.key,
      'old_value', OLD.value,
      'new_value', NEW.value
    );
  END IF;

  INSERT INTO audit_log (event_type, actor_user_id, payload)
  VALUES (evt_type, NEW.updated_by_user_id, payload);

  RETURN NEW;
END;
$$;

ALTER FUNCTION on_system_setting_event() OWNER TO warehouse14_security;

-- warehouse14_security needs INSERT on audit_log (was granted via default privileges in 0003).
GRANT INSERT ON audit_log TO warehouse14_security;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_system_settings_audit ON system_settings;
CREATE TRIGGER trg_system_settings_audit
  AFTER INSERT OR UPDATE OF value ON system_settings
  FOR EACH ROW EXECUTE FUNCTION on_system_setting_event();

-- ─────────────────────────────────────────────────────────────────────
-- 8. Seed default system_settings (operator-tunable defaults).
--    INSERTs fire the audit trigger with actor=NULL (system-seeded).
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO system_settings (key, value, description) VALUES
  -- ADR-0019 §6 Anomaly Watchdog
  ('anomaly.sigma_threshold',                       '3.0'::jsonb,        'Z-score threshold for anomaly alerts. ADMIN-tunable 2.0–4.0 (ADR-0019 §6).'),
  -- ADR-0010 §3 Budgets der Annahmestrecke
  ('ai_budget.daily_eur.total',                     '50.00'::jsonb,      'Tagesdeckel der Annahmestrecke in EUR (ADR-0010 §3).'),
  ('ai_budget.alert_threshold_pct',                 '80'::jsonb,         'Percent of budget that triggers alert (ADR-0010 §3).'),
  ('ai_budget.hard_stop_threshold_pct',             '110'::jsonb,        'Percent of budget that triggers hard stop (ADR-0010 §3).'),
  -- ADR-0015 §4 Intake pipeline
  ('intake.grouping_window_seconds',                '120'::jsonb,        'Multi-image grouping window (ADR-0015 §4, Day-3 directive).'),
  -- ADR-0020 §7 Smart Appointment System
  ('appointment.no_show_grace_minutes',             '30'::jsonb,         'Grace period before auto-no-show (ADR-0020 §7).'),
  ('appointment.viewing_default_duration_minutes',  '45'::jsonb,         'Default duration for VIEWING appointments (ADR-0020 §1).'),
  ('appointment.buyback_eval_default_duration_minutes', '30'::jsonb,     'Default duration for BUYBACK_EVAL appointments.'),
  ('appointment.consultation_default_duration_minutes', '20'::jsonb,     'Default duration for CONSULTATION appointments.'),
  ('appointment.pickup_default_duration_minutes',   '15'::jsonb,         'Default duration for PICKUP appointments.'),
  -- ADR-0018 §6 KYC + AML thresholds
  ('kyc.high_value_threshold_eur',                  '"10000.00"'::jsonb, 'Sale total above which enhanced KYC due diligence is required (ADR-0018 §6).'),
  ('kyc.cumulative_dd_threshold_eur',               '"15000.00"'::jsonb, 'Cumulative customer spend that triggers enhanced DD over the lookback window.'),
  ('kyc.dd_lookback_months',                        '12'::jsonb,         'Lookback window for cumulative-spend due-diligence.'),
  -- ADR-0007 Smurfing detection
  ('smurfing.ankauf_count_window_days',             '7'::jsonb,          'Rolling window for smurfing detection (ADR-0007).'),
  ('smurfing.ankauf_count_threshold',               '3'::jsonb,          'Number of near-threshold Ankauf transactions that triggers a flag.'),
  ('smurfing.ankauf_amount_near_threshold_eur',     '"1999.00"'::jsonb,  '"Just-below-€2000" threshold for smurfing flag.'),
  -- Day-9 cash drawer
  ('cash_drawer.variance_alert_threshold_eur',      '"5.00"'::jsonb,     'Cash drawer variance above which closing requires ADMIN review.'),
  -- LBMA price snapshot (worker populates)
  ('lbma.latest_fix',                               '{}'::jsonb,         'Latest LBMA gold/silver/platinum fix (worker-populated every 15 min during market hours).')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 9. App-role grants
--
-- daily_closings:
--   SELECT + INSERT default. UPDATE on lifecycle + totals + anchors;
--   the BEFORE UPDATE trigger enforces immutability after FINALIZED.
--   NO DELETE.
--
-- dsfinvk_exports:
--   SELECT + INSERT default. UPDATE on state + delivery + file + error fields.
--   NO DELETE.
--
-- system_settings:
--   SELECT + INSERT default. UPDATE on value + description + updated_by + updated_at.
--   NO DELETE (settings are forever).
-- ─────────────────────────────────────────────────────────────────────

GRANT UPDATE (
  state,
  verkauf_count, ankauf_count, storno_count,
  gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
  vat_by_treatment, payments_by_method,
  cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
  tse_finished_count, tse_pending_count, tse_failed_count,
  ledger_anchor_id, ledger_anchor_hash,
  counted_by_user_id, counted_at,
  finalized_by_user_id, finalized_at,
  notes,
  updated_at
) ON daily_closings TO warehouse14_app;

GRANT UPDATE (
  state,
  generated_at, delivered_at, delivery_method, delivery_target,
  r2_key, file_size_bytes, file_sha256,
  transaction_count, daily_closings_count, total_gross_eur, daily_closing_ids,
  last_error_at, last_error_message,
  updated_at
) ON dsfinvk_exports TO warehouse14_app;

GRANT UPDATE (
  value, description, updated_by_user_id, updated_at
) ON system_settings TO warehouse14_app;

COMMIT;
