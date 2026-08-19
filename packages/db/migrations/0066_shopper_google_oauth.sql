-- ═════════════════════════════════════════════════════════════════════════
-- 0066 — Google Sign-In for storefront shoppers
-- ═════════════════════════════════════════════════════════════════════════
--
-- Adds a Google identity to the existing B2C `shoppers` account (introduced in
-- 0018). A Google-linked account has NO password, so `password_hash` becomes
-- nullable; a CHECK keeps every shopper anchored to at least one credential
-- (a password OR a linked Google account). The Google `sub` (stable subject id)
-- is the identity key — one Google account maps to exactly one active shopper.
--
-- Security notes:
--   • `google_sub` is Google's opaque, immutable subject id — NOT the email
--     (emails can change / be reassigned). We key the account on `sub`.
--   • A Google login is account identity only. It is NOT a GwG identification
--     and MUST NEVER set `email_verified_at` for KYC purposes nor any KYC flag;
--     identity for thresholded gold stays the in-shop POS path.
-- ═════════════════════════════════════════════════════════════════════════

-- A Google-only shopper has no password.
ALTER TABLE shoppers ALTER COLUMN password_hash DROP NOT NULL;

-- Google's stable subject id (the `sub` claim). NULL for password-only accounts.
ALTER TABLE shoppers ADD COLUMN IF NOT EXISTS google_sub TEXT;

-- Every shopper keeps at least one usable credential.
ALTER TABLE shoppers DROP CONSTRAINT IF EXISTS shoppers_has_credential;
ALTER TABLE shoppers ADD CONSTRAINT shoppers_has_credential
  CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);

-- One Google identity → one active shopper (soft-deleted rows don't block re-link).
CREATE UNIQUE INDEX IF NOT EXISTS shoppers_google_sub_active_uq
  ON shoppers (google_sub)
  WHERE google_sub IS NOT NULL AND soft_deleted_at IS NULL;

-- The app links/unlinks Google on an existing account (INSERT is already table-wide
-- from migration 0003; UPDATE is column-scoped, so grant the new column).
GRANT UPDATE (google_sub) ON shoppers TO warehouse14_app;
