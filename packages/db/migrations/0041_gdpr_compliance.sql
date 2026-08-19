-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0041 — GDPR compliance (Phase 1.5 #I-4 + #I-5).
--
--   #I-4  audit_log IP minimization — the worker anonymizes IPs on non-fiscal
--         events older than 180 days (GDPR Art. 5(1)(c) data minimization).
--         ledger_events.ip_address stays full (fiscal record). This migration
--         only grants the worker UPDATE(ip_address) on audit_log.
--
--   #I-5  KYC document purge — retention_until is the date a document MAY be
--         purged, but the NO-DELETE discipline forbids row deletion. So we make
--         the PII columns nullable, add purge-evidence columns, and a CHECK that
--         keeps a row in exactly one of two shapes: LIVE (PII present, not
--         purged) or SHELL (PII nulled, purge stamped). The row survives as an
--         audit shell proving the document existed + when/who purged it.
--
-- Additive, idempotent, transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── #I-5 kyc_documents purge columns + nullable PII ─────────────────────────
ALTER TABLE kyc_documents
  ADD COLUMN IF NOT EXISTS purged_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS purged_by_user_id UUID REFERENCES users(id);

ALTER TABLE kyc_documents ALTER COLUMN document_number_encrypted DROP NOT NULL;
ALTER TABLE kyc_documents ALTER COLUMN document_photo_r2_key     DROP NOT NULL;
ALTER TABLE kyc_documents ALTER COLUMN document_photo_sha256     DROP NOT NULL;

-- A row is either LIVE (PII present, not purged) or a purged SHELL (PII nulled,
-- purge stamped). No in-between.
ALTER TABLE kyc_documents DROP CONSTRAINT IF EXISTS kyc_documents_purged_consistency;
ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_purged_consistency CHECK (
  (purged_at IS NULL
     AND document_number_encrypted IS NOT NULL
     AND document_photo_sha256 IS NOT NULL
     AND document_photo_r2_key IS NOT NULL
     AND purged_by_user_id IS NULL)
  OR
  (purged_at IS NOT NULL
     AND document_number_encrypted IS NULL
     AND document_photo_sha256 IS NULL
     AND document_photo_r2_key IS NULL
     AND purged_by_user_id IS NOT NULL)
);

-- ── Grants ──────────────────────────────────────────────────────────────────
-- App (right-to-erasure on request) + worker (scheduled retention purge) may
-- flip a LIVE row to a SHELL; the worker also minimizes audit_log IPs.
GRANT UPDATE (
  purged_at, purged_by_user_id,
  document_number_encrypted, document_photo_r2_key, document_photo_sha256,
  updated_at
) ON kyc_documents TO warehouse14_app, warehouse14_worker;

GRANT UPDATE (ip_address) ON audit_log TO warehouse14_worker;

-- The gdpr_cleanup job needs to read the rows it operates on.
GRANT SELECT ON kyc_documents TO warehouse14_worker;
GRANT SELECT ON audit_log TO warehouse14_worker;

COMMIT;
