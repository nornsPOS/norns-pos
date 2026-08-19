-- Epic C Part 2 — local KYC document index.
--
-- One row per encrypted ID scan written to the local vault (see kyc.rs). The
-- ciphertext lives at `file_path` ($APP_DATA/kyc_vault/<uuid>.enc); this table
-- is the offline-queryable index so the POS can list/preview a customer's
-- documents without the cloud. `sha256` (of the original plaintext) is UNIQUE
-- so re-scanning identical bytes is a no-op rather than a duplicate row.
--
-- Forward-only (registered as migration version 2). Never edit a shipped one.

CREATE TABLE IF NOT EXISTS customer_kyc (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id         TEXT NOT NULL,
  doc_type            TEXT NOT NULL,
  file_path           TEXT NOT NULL,
  sha256              TEXT NOT NULL UNIQUE,
  verified_at         INTEGER,
  verified_by_user_id TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_customer_kyc_customer ON customer_kyc (customer_id, created_at DESC);
