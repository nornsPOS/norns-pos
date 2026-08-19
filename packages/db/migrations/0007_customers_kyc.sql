-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0007 — Customers + KYC documents + PII encryption helpers
--
-- This migration lands the GwG / §259 StGB defense layer. After it:
--   • `customers` carries encrypted PII (full name, DOB, email, phone, address,
--     notes) via pgp_sym_encrypt. The key is connection-scoped via SET LOCAL —
--     never on disk, never in pg_stat_statements (which logs prepared params).
--   • `kyc_documents` stores ID-document evidence: encrypted document number,
--     R2 reference to the photo + SHA-256 integrity hash, the verifier chain.
--   • Three helper functions (`encrypt_pii`, `decrypt_pii`, `blind_index`)
--     encapsulate the cipher choice + key lookup. App code calls these, never
--     pgp_sym_encrypt directly.
--   • Blind indexes (HMAC-SHA256 of normalized email/phone) enable exact-match
--     lookup without decryption.
--   • App role discipline: NEVER DELETE on either table (mirror ADR-0008 §3
--     and the users discipline from migration 0004). GDPR deletion is via
--     soft_deleted_at + anonymized_at.
--
-- ADR references:
--   • ADR-0007       — GwG always-ID Ankauf policy
--   • ADR-0008 §3    — role-grant discipline, no DELETE
--   • ADR-0008 §10   — defense-in-depth, pgcrypto column-level encryption
--   • ADR-0018 §6    — sanctions/PEP screening, cumulative-spend thresholds
--   • ADR-0017 §11   — KYC OCR via automatische Bilderkennung (ai_ocr_* columns)
--
-- Basel Day-5 directives (2026-05-24):
--   1. Full pgcrypto exploitation — encrypted PII at the DB level.
--   2. Key separation — pii_key is a session setting, not a DB-resident value.
--   3. GwG compliance — KYC linked to customer, retention discipline,
--      Soft-Delete / Anonymization for post-retention purge.
--   4. Lean tests — central concerns only (roundtrip, blind index, grants,
--      soft-delete semantics).
--
-- Idempotent: enums via DO blocks, CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION.
-- Transactional: BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ENUM types
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status') THEN
    CREATE TYPE kyc_status AS ENUM (
      'NOT_REQUIRED',   -- below GwG threshold + not Ankauf
      'PENDING',        -- Ankauf required, docs not yet captured
      'CAPTURED',       -- docs captured, awaiting human review
      'VERIFIED',       -- ADMIN/cashier confirmed
      'EXPIRED',        -- ID document expired, re-verification needed
      'REJECTED'        -- sanctions match, PEP risk, or fraud suspected
    );
    COMMENT ON TYPE kyc_status IS 'Customer KYC lifecycle (ADR-0007, ADR-0018 §6).';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'id_document_type') THEN
    CREATE TYPE id_document_type AS ENUM (
      'PERSONALAUSWEIS',     -- German national ID
      'REISEPASS',           -- German passport
      'EU_NATIONAL_ID',      -- other EU national ID card
      'AUFENTHALTSTITEL',    -- residence permit (German)
      'PASSPORT_NON_EU'      -- non-EU passport
    );
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. PII helper functions
--    Encapsulate the cipher choice + key lookup. The cipher is AES-256
--    with deflate compression (`cipher-algo=aes256, compress-algo=2`).
--    The key is read from the connection setting `warehouse14.pii_key`,
--    which the app sets via `SET LOCAL` at the start of each transaction
--    touching PII (see packages/db/src/withPiiKey.ts).
--
--    All three functions defer NULL gracefully so the app does not need
--    to wrap every reference in COALESCE.
-- ─────────────────────────────────────────────────────────────────────

-- encrypt_pii(plaintext) → bytea (or NULL pass-through)
CREATE OR REPLACE FUNCTION encrypt_pii(plaintext TEXT) RETURNS BYTEA
  LANGUAGE SQL VOLATILE PARALLEL UNSAFE
  AS $$
    SELECT CASE
      WHEN plaintext IS NULL THEN NULL
      ELSE pgp_sym_encrypt(
        plaintext,
        current_setting('warehouse14.pii_key'),
        'cipher-algo=aes256, compress-algo=2'
      )
    END;
  $$;

COMMENT ON FUNCTION encrypt_pii(TEXT) IS
  'Encrypt PII text using AES-256 + the session-scoped warehouse14.pii_key. '
  'NULL passes through. The key must be set via SET LOCAL before the call '
  '(or the function raises). PARALLEL UNSAFE because it reads a GUC.';

-- decrypt_pii(ciphertext) → text (or NULL pass-through)
CREATE OR REPLACE FUNCTION decrypt_pii(ciphertext BYTEA) RETURNS TEXT
  LANGUAGE SQL STABLE PARALLEL UNSAFE
  AS $$
    SELECT CASE
      WHEN ciphertext IS NULL THEN NULL
      ELSE pgp_sym_decrypt(
        ciphertext,
        current_setting('warehouse14.pii_key')
      )
    END;
  $$;

COMMENT ON FUNCTION decrypt_pii(BYTEA) IS
  'Decrypt PII ciphertext using the session-scoped warehouse14.pii_key. '
  'NULL passes through. Raises on wrong key or corrupted ciphertext — the app '
  'surfaces that as an internal error (never to the user).';

-- blind_index(plaintext) → bytea (HMAC-SHA256 over normalized input).
-- The app is responsible for normalization (lowercase email, E.164 phone).
CREATE OR REPLACE FUNCTION blind_index(plaintext TEXT) RETURNS BYTEA
  LANGUAGE SQL STABLE PARALLEL UNSAFE
  AS $$
    SELECT CASE
      WHEN plaintext IS NULL THEN NULL
      ELSE hmac(
        convert_to(plaintext, 'UTF8'),
        current_setting('warehouse14.pii_key'),
        'sha256'
      )
    END;
  $$;

COMMENT ON FUNCTION blind_index(TEXT) IS
  'HMAC-SHA256 over normalized PII for exact-match lookup without decryption. '
  'Caller MUST normalize (lowercase, E.164, trim) before calling.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Sequence for customer_number display ids (CUST-YYYY-NNNNNN)
-- ─────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS customer_number_seq;

-- ─────────────────────────────────────────────────────────────────────
-- 4. customers
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                          UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID,                                  -- V1 NULL; multi-shop ready

  -- Display identifier (auto-generated; not PII)
  customer_number             TEXT            NOT NULL UNIQUE
                                              DEFAULT ('CUST-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY')
                                                       || '-' || lpad(nextval('customer_number_seq')::text, 6, '0')),

  -- Encrypted PII columns (BYTEA, pgp_sym_encrypt)
  full_name_encrypted         BYTEA           NOT NULL,
  date_of_birth_encrypted     BYTEA,
  email_encrypted             BYTEA,
  phone_encrypted             BYTEA,
  address_encrypted           BYTEA,                                  -- JSONB-shaped plaintext encrypted as single blob
  notes_encrypted             BYTEA,                                  -- staff observations may carry PII; encrypt to be safe

  -- Blind indexes for exact-match lookup without decryption
  email_blind_index           BYTEA,
  phone_blind_index           BYTEA,

  -- Non-PII metadata
  preferred_language          CHAR(2)         NOT NULL DEFAULT 'de'
                                              CHECK (preferred_language IN ('de', 'en', 'ar')),
  customer_tags               TEXT[]          NOT NULL DEFAULT '{}',

  -- GwG / KYC state
  kyc_status                  kyc_status      NOT NULL DEFAULT 'NOT_REQUIRED',
  kyc_completed_at            TIMESTAMPTZ,
  kyc_expires_at              TIMESTAMPTZ,                            -- when the linked document expires

  -- Sanctions / compliance screening (ADR-0018 §6)
  sanctions_screened_at       TIMESTAMPTZ,
  sanctions_match             BOOLEAN         NOT NULL DEFAULT FALSE,
  pep_match                   BOOLEAN         NOT NULL DEFAULT FALSE,

  -- Cumulative spend tracking — written by trigger from migration 0009
  -- onwards. App role has NO UPDATE here (denormalized financial state).
  cumulative_spend_eur        NUMERIC(18,2)   NOT NULL DEFAULT 0 CHECK (cumulative_spend_eur >= 0),
  cumulative_ankauf_eur       NUMERIC(18,2)   NOT NULL DEFAULT 0 CHECK (cumulative_ankauf_eur >= 0),

  -- GDPR retention markers
  retention_until             DATE            NOT NULL,                -- earliest legal anonymization date
  soft_deleted_at             TIMESTAMPTZ,
  anonymized_at               TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ     NOT NULL DEFAULT now(),

  -- Invariants (mirror users discipline from migration 0004)
  CONSTRAINT customers_anonymized_implies_soft_deleted
    CHECK (anonymized_at IS NULL OR soft_deleted_at IS NOT NULL),
  CONSTRAINT customers_anonymized_after_soft_deleted
    CHECK (anonymized_at IS NULL OR anonymized_at >= soft_deleted_at),

  -- KYC verified ⇒ kyc_completed_at and kyc_expires_at are set.
  CONSTRAINT customers_verified_has_kyc_dates
    CHECK (
      kyc_status NOT IN ('VERIFIED', 'EXPIRED') OR
      (kyc_completed_at IS NOT NULL AND kyc_expires_at IS NOT NULL)
    )
);

-- Partial unique blind-index lookups (ignore soft-deleted rows so a new
-- customer with the same email/phone is permitted after GDPR purge).
CREATE UNIQUE INDEX IF NOT EXISTS customers_email_blind_index_active_uq
  ON customers (email_blind_index)
  WHERE email_blind_index IS NOT NULL AND soft_deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_phone_blind_index_active_uq
  ON customers (phone_blind_index)
  WHERE phone_blind_index IS NOT NULL AND soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_kyc_expiring_idx
  ON customers (kyc_expires_at)
  WHERE kyc_status = 'VERIFIED' AND soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_sanctions_flags_idx
  ON customers (sanctions_match, pep_match)
  WHERE (sanctions_match = TRUE OR pep_match = TRUE) AND soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_retention_idx
  ON customers (retention_until)
  WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_shop_id_idx
  ON customers (shop_id)
  WHERE shop_id IS NOT NULL;

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE customers IS
  'Customer records with encrypted PII (pgcrypto). NEVER deleted by app role — GDPR via soft_deleted_at + anonymized_at. '
  'See ADR-0007 (GwG), ADR-0008 §10 (defense-in-depth).';
COMMENT ON COLUMN customers.cumulative_spend_eur IS
  'Denormalized total Verkauf revenue from this customer. Written by trigger in migration 0009. App role has NO UPDATE.';
COMMENT ON COLUMN customers.cumulative_ankauf_eur IS
  'Denormalized total Ankauf payouts to this customer. Drives the GwG enhanced-due-diligence threshold (€15k/12mo).';

-- ─────────────────────────────────────────────────────────────────────
-- 5. kyc_documents
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_documents (
  id                          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                 UUID                NOT NULL REFERENCES customers(id),

  -- Classification
  document_type               id_document_type    NOT NULL,
  issuing_country_iso2        CHAR(2)             NOT NULL CHECK (issuing_country_iso2 ~ '^[A-Z]{2}$'),
  issuing_authority           TEXT,                                       -- "Stadtverwaltung Berlin" — not PII

  -- Encrypted document number (THE legally-required field)
  document_number_encrypted   BYTEA               NOT NULL,

  -- Validity
  issued_on                   DATE,
  expires_on                  DATE                NOT NULL,
  CONSTRAINT kyc_documents_validity_range
    CHECK (issued_on IS NULL OR expires_on > issued_on),

  -- Photo evidence (R2 reference + SHA-256 integrity)
  document_photo_r2_key       TEXT                NOT NULL,
  document_photo_sha256       BYTEA               NOT NULL,
  CONSTRAINT kyc_documents_sha256_length
    CHECK (octet_length(document_photo_sha256) = 32),

  -- Capture context
  captured_by_user_id         UUID                NOT NULL REFERENCES users(id),
  captured_at                 TIMESTAMPTZ         NOT NULL DEFAULT now(),
  captured_at_terminal_id     UUID                REFERENCES devices(id),

  -- Erkennungs-Spalten (nie gebaut; 0149 zieht sie aus)
  ai_ocr_used                 BOOLEAN             NOT NULL DEFAULT FALSE,
  ai_ocr_confidence           NUMERIC(3,2)        CHECK (ai_ocr_confidence IS NULL OR (ai_ocr_confidence >= 0 AND ai_ocr_confidence <= 1)),

  -- Human verification chain
  verified_at                 TIMESTAMPTZ,
  verified_by_user_id         UUID                REFERENCES users(id),

  -- GDPR retention
  retention_until             DATE                NOT NULL,

  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),

  -- verified_at ⇒ verified_by_user_id set
  CONSTRAINT kyc_documents_verified_has_verifier
    CHECK ((verified_at IS NULL) = (verified_by_user_id IS NULL))
);

CREATE INDEX IF NOT EXISTS kyc_documents_customer_id_idx
  ON kyc_documents (customer_id);

CREATE INDEX IF NOT EXISTS kyc_documents_expires_on_idx
  ON kyc_documents (expires_on);

CREATE INDEX IF NOT EXISTS kyc_documents_retention_idx
  ON kyc_documents (retention_until);

CREATE INDEX IF NOT EXISTS kyc_documents_unverified_idx
  ON kyc_documents (created_at DESC)
  WHERE verified_at IS NULL;

CREATE TRIGGER trg_kyc_documents_updated_at
  BEFORE UPDATE ON kyc_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE kyc_documents IS
  'ID document evidence (Personalausweis, Reisepass, …). The §259 StGB defense surface. '
  'NEVER deleted by app role — these rows are the legal proof of good-faith Ankauf.';

-- ─────────────────────────────────────────────────────────────────────
-- 6. Reference: products.customer_id (forward link).
--    We add a nullable column on products now so the FK chain is in
--    place when transactions/checkout flows land (migration 0009).
--
--    The column carries the "this product was bought from this customer
--    via Ankauf" provenance. NULL for products without a buyback origin.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ankauf_customer_id UUID REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS products_ankauf_customer_id_idx
  ON products (ankauf_customer_id)
  WHERE ankauf_customer_id IS NOT NULL;

GRANT UPDATE (ankauf_customer_id) ON products TO warehouse14_app;

-- ─────────────────────────────────────────────────────────────────────
-- 7. APP ROLE GRANTS
--
-- customers: SELECT+INSERT default. Narrow UPDATE on user-mutable cols.
--   NEVER DELETE. NEVER UPDATE: id, customer_number, shop_id, date_of_birth_encrypted,
--                                cumulative_spend_eur, cumulative_ankauf_eur, created_at.
--
-- kyc_documents: SELECT+INSERT default. UPDATE only on verification cols.
--   NEVER DELETE. Document evidence is permanent.
--
-- Helper functions: EXECUTE granted to app.
-- ─────────────────────────────────────────────────────────────────────

GRANT UPDATE (
  -- PII columns (customer profile updates)
  full_name_encrypted,
  email_encrypted,
  phone_encrypted,
  address_encrypted,
  notes_encrypted,
  email_blind_index,
  phone_blind_index,
  -- Note: date_of_birth_encrypted intentionally NOT here — DOB is set once at
  --       KYC capture and immutable thereafter.

  -- Non-PII metadata
  preferred_language,
  customer_tags,

  -- KYC + sanctions lifecycle
  kyc_status,
  kyc_completed_at,
  kyc_expires_at,
  sanctions_screened_at,
  sanctions_match,
  pep_match,

  -- GDPR retention markers
  retention_until,
  soft_deleted_at,
  anonymized_at,

  -- Trigger-maintained
  updated_at
) ON customers TO warehouse14_app;

-- cumulative_spend_eur + cumulative_ankauf_eur are explicitly absent:
-- they will be maintained by a trigger from migration 0009 onwards, owned
-- by warehouse14_security (defense-in-depth: app cannot fabricate spend totals).

GRANT UPDATE (
  -- Verification chain only
  verified_at,
  verified_by_user_id,

  -- Erkennungs-Felder (nie gebaut; 0149 zieht sie aus)
  ai_ocr_used,
  ai_ocr_confidence,

  -- GDPR retention
  retention_until,

  -- Trigger-maintained
  updated_at
) ON kyc_documents TO warehouse14_app;

-- Helper functions
GRANT EXECUTE ON FUNCTION encrypt_pii(TEXT) TO warehouse14_app;
GRANT EXECUTE ON FUNCTION decrypt_pii(BYTEA) TO warehouse14_app;
GRANT EXECUTE ON FUNCTION blind_index(TEXT) TO warehouse14_app;

-- Sequence for customer_number
GRANT USAGE ON SEQUENCE customer_number_seq TO warehouse14_app;

COMMIT;
