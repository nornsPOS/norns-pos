-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0037 — Epic F: automatische Annahmestrecke (ADR-0015)
--
-- Staging tables for the Nachrichtenfoto → Bilderkennung → deterministische Steuer-Einordnung →
-- automatischer deutscher Textentwurf → Control Desktop flow:
--   • staff_phone_numbers — E.164 identity layer for intake (phone IS identity).
--   • intake_sessions     — the RECEIVED→…→PUBLISHED/REJECTED state machine.
--   • intake_messages     — one row per inbound/outbound WhatsApp message
--                           (wamid is the idempotency key).
--   • intake_drafts       — automatische Ergebnisse + deterministic enrichment + reviewer
--                           overrides; one per session.
--
-- DELETE is forbidden everywhere (audit trail); a stale session is reclaimed via
-- UPDATE to a terminal status, never deleted (ADR §11).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Staff identity ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff_phone_numbers (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID         NOT NULL REFERENCES users(id),
  phone_e164         TEXT         NOT NULL UNIQUE,
  role               TEXT         NOT NULL,
  preferred_language CHAR(2)      NOT NULL DEFAULT 'de',
  verified_at        TIMESTAMPTZ  NOT NULL,
  active             BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT staff_phone_role_check
    CHECK (role IN ('INTAKE_FIELD_BUYER', 'INTAKE_IN_SHOP', 'BOTH')),
  CONSTRAINT staff_phone_lang_check
    CHECK (preferred_language IN ('de', 'en', 'ar'))
);
CREATE INDEX IF NOT EXISTS idx_staff_phone_active
  ON staff_phone_numbers (phone_e164) WHERE active = TRUE;

-- ── Session state machine ───────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE intake_status AS ENUM (
    'RECEIVED', 'GROUPED', 'PROCESSING', 'ENRICHED', 'READY_FOR_REVIEW',
    'PUBLISHED', 'REJECTED', 'NEEDS_MORE_INFO', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS intake_sessions (
  id                      UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_phone_id          UUID            NOT NULL REFERENCES staff_phone_numbers(id),
  started_at              TIMESTAMPTZ     NOT NULL DEFAULT now(),
  grouping_closes_at      TIMESTAMPTZ     NOT NULL,
  status                  intake_status   NOT NULL DEFAULT 'RECEIVED',
  product_id              UUID            REFERENCES products(id),
  rejected_reason         TEXT,
  processing_started_at   TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  reviewer_user_id        UUID            REFERENCES users(id),
  reviewer_decided_at     TIMESTAMPTZ,
  created_at              TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_status   ON intake_sessions (status);
CREATE INDEX IF NOT EXISTS idx_intake_sessions_grouping ON intake_sessions (grouping_closes_at)
  WHERE status = 'RECEIVED';
CREATE INDEX IF NOT EXISTS idx_intake_sessions_phone    ON intake_sessions (staff_phone_id, started_at DESC);

-- ── Messages (idempotent on the Meta wamid) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS intake_messages (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID         NOT NULL REFERENCES intake_sessions(id),
  whatsapp_message_id TEXT         NOT NULL UNIQUE,
  direction           TEXT         NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_type        TEXT         NOT NULL,
  media_r2_key        TEXT,
  text_body           TEXT,
  received_at         TIMESTAMPTZ  NOT NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intake_messages_session ON intake_messages (session_id, received_at);

-- ── Drafts (automatische Ergebnisse + deterministic enrichment + reviewer overrides) ──────
CREATE TABLE IF NOT EXISTS intake_drafts (
  id                            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                    UUID         NOT NULL UNIQUE REFERENCES intake_sessions(id),

  bg_removed_photo_keys         TEXT[],
  vision_classification         JSONB,
  vision_hallmark_detection     JSONB,
  vision_scale_reading          JSONB,

  lbma_price_snapshot_eur_per_g NUMERIC(15,4),
  tax_treatment_code            TEXT         REFERENCES tax_treatment_codes(code),
  classifier_explanation        TEXT,
  suggested_acquisition_eur     NUMERIC(18,2),
  suggested_sale_eur            NUMERIC(18,2),

  german_description            TEXT,
  marketing_angles              JSONB,
  embedding                     VECTOR(1536),

  final_data                    JSONB,

  pipeline_errors               JSONB,
  created_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_intake_drafts_updated_at ON intake_drafts;
CREATE TRIGGER trg_intake_drafts_updated_at
  BEFORE UPDATE ON intake_drafts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Grants (ADR §11: INSERT/SELECT/UPDATE; DELETE forbidden) ─────────────────
GRANT SELECT, INSERT, UPDATE ON staff_phone_numbers TO warehouse14_app;
GRANT SELECT, INSERT, UPDATE ON intake_sessions     TO warehouse14_app, warehouse14_worker;
GRANT SELECT, INSERT, UPDATE ON intake_messages     TO warehouse14_app, warehouse14_worker;
GRANT SELECT, INSERT, UPDATE ON intake_drafts       TO warehouse14_app, warehouse14_worker;
GRANT SELECT ON staff_phone_numbers TO warehouse14_worker;

COMMIT;
