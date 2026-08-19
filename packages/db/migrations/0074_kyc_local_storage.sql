-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0074 — KYC ID-document image storage: R2 → LOCAL encrypted-at-rest.
--
-- R2 was never configured anywhere (R2_ACCOUNT_ID/R2_BUCKET/... default to ''),
-- so POST /api/photos/upload-url 500s "R2 not configured" and NO kyc_documents
-- row could ever be created (the old route required an r2Key from that flow).
-- Verified on the dev DB:
--     SELECT count(*) AS total,
--            count(*) FILTER (WHERE document_photo_r2_key IS NOT NULL) AS with_r2key
--       FROM kyc_documents;
--   ->  total = 0 | with_r2key = 0
-- Production is 0 by construction (the upload flow never worked). The pre-flight
-- guard below ABORTS the migration if any R2-keyed row is somehow present, so a
-- real R2 key can never be silently mislabeled as a local storage key. If that
-- ever fires, switch to the ADDITIVE path (ADD document_photo_storage_key +
-- backfill) instead of this RENAME.
--
-- Change: RENAME document_photo_r2_key → document_photo_storage_key. The key now
-- references a LOCAL AES-256-GCM-encrypted `.enc` file under KYC_PHOTOS_DIR (NOT
-- an R2 object). The all-or-nothing purge CHECK is rewritten with the new column
-- name in BOTH arms (LIVE / purged SHELL). The GwG/DSGVO posture is PRESERVED:
-- encrypted at rest, ADMIN + step-up, 5-year retention, sha256 integrity,
-- all-or-nothing purge. No new thresholds.
--
-- Idempotent + transactional. migrate.sh applies each file with NO -1, so the
-- explicit BEGIN/COMMIT controls the transaction.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
BEGIN
  -- Only meaningful BEFORE the rename; makes the migration re-run safe.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'kyc_documents' AND column_name = 'document_photo_r2_key'
  ) THEN
    -- Pre-flight guard: refuse to rename a column that holds real R2 keys.
    IF (SELECT count(*) FROM kyc_documents WHERE document_photo_r2_key IS NOT NULL) > 0 THEN
      RAISE EXCEPTION
        '0074: found % R2-keyed kyc_documents row(s) — use the ADDITIVE path (ADD document_photo_storage_key + backfill), do NOT rename.',
        (SELECT count(*) FROM kyc_documents WHERE document_photo_r2_key IS NOT NULL);
    END IF;
    EXECUTE 'ALTER TABLE kyc_documents RENAME COLUMN document_photo_r2_key TO document_photo_storage_key';
  END IF;
END $$;

-- Byte size of the stored encrypted file, for the SEPARATE KYC store cap
-- (KYC_STORE_MAX_BYTES). NOT PII and NOT part of the all-or-nothing CHECK; the
-- purge nulls it when the file is deleted so the SUM stays accurate.
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS document_photo_size_bytes integer;

-- Rewrite the all-or-nothing purge CHECK with document_photo_storage_key in BOTH
-- arms. Written out IN FULL (never templated) — a missing arm would silently
-- break erasure in one direction.
ALTER TABLE kyc_documents DROP CONSTRAINT IF EXISTS kyc_documents_purged_consistency;
ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_purged_consistency CHECK (
  (purged_at IS NULL
     AND document_number_encrypted IS NOT NULL
     AND document_photo_sha256 IS NOT NULL
     AND document_photo_storage_key IS NOT NULL
     AND purged_by_user_id IS NULL)
  OR
  (purged_at IS NOT NULL
     AND document_number_encrypted IS NULL
     AND document_photo_sha256 IS NULL
     AND document_photo_storage_key IS NULL
     AND purged_by_user_id IS NOT NULL)
);

-- RENAME carries the column ACL, but re-issue the GRANT idempotently under the
-- new name (the 0041 grant named document_photo_r2_key). App = right-to-erasure
-- on request; worker = scheduled retention purge.
GRANT UPDATE (
  purged_at, purged_by_user_id,
  document_number_encrypted, document_photo_storage_key, document_photo_sha256,
  document_photo_size_bytes,
  updated_at
) ON kyc_documents TO warehouse14_app, warehouse14_worker;

COMMIT;
