-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0043 — TSE/TSS certificate-expiry tracking (KassenSichV, #I-1).
--
-- NOTE: numbered 0043 (not 0042) because 0042_duress_pin_schema.sql already
-- holds that slot — migration numbers must be unique + monotonic.
--
-- One row per Fiskaly TSS. The `tse_cert_checker` worker job refreshes
-- `cert_valid_to` daily from the Fiskaly SIGN DE V2 API and emits
-- `alert.tse_cert_expiry` when a certificate is within 30 days of expiry (an
-- expired TSE certificate invalidates the register). `alert_sent_at` throttles
-- the alert to once / 24h.
--
-- Additive, idempotent, transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS tse_clients (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tss_id         TEXT         NOT NULL,
  description    TEXT,
  cert_valid_to  TIMESTAMPTZ  NOT NULL,
  last_checked   TIMESTAMPTZ,
  alert_sent_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Exactly one row per TSS.
CREATE UNIQUE INDEX IF NOT EXISTS tse_clients_tss_id_uq ON tse_clients (tss_id);

-- updated_at maintained by the shared trigger fn (migration 0002).
DROP TRIGGER IF EXISTS set_tse_clients_updated_at ON tse_clients;
CREATE TRIGGER set_tse_clients_updated_at
  BEFORE UPDATE ON tse_clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- The worker job owns the lifecycle; the API/Bridge reads for the compliance view.
GRANT SELECT, INSERT, UPDATE ON tse_clients TO warehouse14_worker, warehouse14_app;

COMMIT;
