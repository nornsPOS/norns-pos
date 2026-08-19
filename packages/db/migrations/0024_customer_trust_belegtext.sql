-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0024 — Backend Finale: Customer Trust + Belegtext Templates
--                   (Day 26 — last migration of Phase 1)
--
-- Two parallel additions wrapping up the customer/CRM and the
-- Belegausgabe (receipt-text) story.
--
-- (A) customer_trust_level enum + customers extensions:
--       trust_level / kyc_verified_at / kyc_verified_by_user_id /
--       price_expectation_notes + 3 evidence CHECKs + partial watch-list index.
--
-- (B) belegtext_kind enum + belegtext_templates (append-only versioning,
--     one-CURRENT-per-kind/language partial UNIQUE) +
--     resolve_belegtext_for_tax_treatment(text, text) helper +
--     seed of the 4 mandatory German texts + 2 generic header/footer.
--
-- (C) Role grants: app narrow UPDATE on trust + KYC verification columns;
--     SELECT + INSERT on belegtext_templates from default privileges,
--     UPDATE (valid_to) only for the close-out path.
--
-- After this migration, Phase 1 is officially FROZEN. See memory.md #72.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. customer_trust_level enum
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'customer_trust_level') THEN
    CREATE TYPE customer_trust_level AS ENUM (
      'NEW',         -- first contact, no purchase history yet
      'VERIFIED',    -- ID checked + standard relationship
      'VIP',         -- high-trust, repeat customer
      'SUSPICIOUS',  -- flagged for AML watch (operator judgement)
      'BANNED'       -- refused service
    );
    COMMENT ON TYPE customer_trust_level IS
      'Operator business judgement of the customer. Orthogonal to '
      'kyc_status (legal document state). Promotion to VERIFIED/VIP '
      'requires a physical ID check (kyc_verified_at set).';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. customers extensions
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS trust_level customer_trust_level
    NOT NULL DEFAULT 'NEW';

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMPTZ;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS kyc_verified_by_user_id UUID
    REFERENCES users(id);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS price_expectation_notes TEXT;

-- CHECK: kyc_verified_at + kyc_verified_by_user_id are both-or-none.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_kyc_verified_evidence'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_kyc_verified_evidence
      CHECK (
        (kyc_verified_at IS NULL) = (kyc_verified_by_user_id IS NULL)
      );
  END IF;
END$$;

-- CHECK: cannot promote past NEW without a physical ID check.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_verified_trust_requires_kyc'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_verified_trust_requires_kyc
      CHECK (
        trust_level NOT IN ('VERIFIED', 'VIP')
        OR kyc_verified_at IS NOT NULL
      );
  END IF;
END$$;

-- CHECK: SUSPICIOUS or BANNED requires Owner to record the rationale.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_banned_or_suspicious_has_note'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_banned_or_suspicious_has_note
      CHECK (
        trust_level NOT IN ('SUSPICIOUS', 'BANNED')
        OR (price_expectation_notes IS NOT NULL
            AND length(price_expectation_notes) >= 8)
      );
  END IF;
END$$;

-- Hot-path: watch-lists Owner cares about (small selection, partial index).
CREATE INDEX IF NOT EXISTS customers_trust_active_idx
  ON customers (trust_level, updated_at DESC)
  WHERE soft_deleted_at IS NULL
    AND trust_level IN ('VIP', 'SUSPICIOUS', 'BANNED');

COMMENT ON COLUMN customers.trust_level IS
  'Operator business judgement. Distinct from kyc_status (legal state). '
  'Promotion to VERIFIED/VIP requires kyc_verified_at to be set.';
COMMENT ON COLUMN customers.kyc_verified_at IS
  'When the operator personally inspected the physical ID. Different from '
  'kyc_completed_at, which records when the document upload pipeline finished.';
COMMENT ON COLUMN customers.price_expectation_notes IS
  'Free-text notes about haggling patterns, payment-term preferences, etc. '
  'Mandatory when trust_level IN (SUSPICIOUS, BANNED).';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. belegtext_kind enum
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'belegtext_kind') THEN
    CREATE TYPE belegtext_kind AS ENUM (
      'MARGIN_25A',              -- §25a Differenzbesteuerung
      'STANDARD_19',             -- §12 Abs. 1 UStG (19%)
      'REDUCED_7',               -- §12 Abs. 2 UStG (7%)
      'INVESTMENT_GOLD_25C',     -- §25c UStG (Anlagegold)
      'KLEINUNTERNEHMER_19',     -- §19 UStG small-business exemption (future)
      'ANKAUFBELEG_DECLARATION', -- GwG § 8 identity-recording declaration
      'GENERIC_HEADER',          -- always printed at the top
      'GENERIC_FOOTER'           -- always printed at the bottom
    );
    COMMENT ON TYPE belegtext_kind IS
      'Discriminator for receipt/invoice legal-text blocks. The first four '
      'mirror tax_treatment_codes; the last four are universal.';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. belegtext_templates — append-only history with one-current-per-(kind,lang)
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS belegtext_templates (
  id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                belegtext_kind       NOT NULL,
  language            TEXT                 NOT NULL DEFAULT 'de',

  body_text           TEXT                 NOT NULL,

  -- Versioning — close-out the existing CURRENT row then INSERT a new one.
  valid_from          TIMESTAMPTZ          NOT NULL DEFAULT now(),
  valid_to            TIMESTAMPTZ,

  -- Author + notes
  created_by_user_id  UUID                 REFERENCES users(id),
  notes               TEXT,

  created_at          TIMESTAMPTZ          NOT NULL DEFAULT now(),

  CONSTRAINT belegtext_body_length CHECK (
    length(body_text) BETWEEN 1 AND 4000
  ),
  CONSTRAINT belegtext_language_format CHECK (
    language ~ '^[a-z]{2}(-[A-Z]{2})?$'
  ),
  CONSTRAINT belegtext_valid_range CHECK (
    valid_to IS NULL OR valid_to > valid_from
  )
);

-- Exactly one CURRENT template per (kind, language).
CREATE UNIQUE INDEX IF NOT EXISTS belegtext_one_current_per_kind_lang_uq
  ON belegtext_templates (kind, language)
  WHERE valid_to IS NULL;

-- Read path: "give me the active template for (kind, language)".
CREATE INDEX IF NOT EXISTS belegtext_kind_language_validfrom_idx
  ON belegtext_templates (kind, language, valid_from DESC);

COMMENT ON TABLE belegtext_templates IS
  'Append-only history of receipt/invoice legal texts. New version: '
  'UPDATE existing CURRENT row SET valid_to = now(); then INSERT new row. '
  'NEVER DELETE — Finanzamt may audit which text printed on which receipt.';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Seed — the four mandatory German texts + 2 generic blocks
-- ═════════════════════════════════════════════════════════════════════════
--
-- Idempotent: only INSERT if no CURRENT row exists for (kind, 'de').
-- All seed rows have created_by_user_id = NULL (system-seeded).

INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'MARGIN_25A'::belegtext_kind, 'de',
       'Differenzbesteuerung gemäß § 25a UStG. Vorsteuerabzug ist ausgeschlossen.',
       'system-seeded (migration 0024)'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'MARGIN_25A' AND language = 'de' AND valid_to IS NULL
);

INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'STANDARD_19'::belegtext_kind, 'de',
       'Im Preis ist die gesetzliche Umsatzsteuer von 19 % gemäß § 12 Abs. 1 UStG enthalten.',
       'system-seeded (migration 0024)'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'STANDARD_19' AND language = 'de' AND valid_to IS NULL
);

INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'REDUCED_7'::belegtext_kind, 'de',
       'Im Preis ist die gesetzliche Umsatzsteuer von 7 % gemäß § 12 Abs. 2 UStG enthalten.',
       'system-seeded (migration 0024)'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'REDUCED_7' AND language = 'de' AND valid_to IS NULL
);

INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'INVESTMENT_GOLD_25C'::belegtext_kind, 'de',
       'Steuerfreie Lieferung von Anlagegold gemäß § 25c UStG.',
       'system-seeded (migration 0024)'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'INVESTMENT_GOLD_25C' AND language = 'de' AND valid_to IS NULL
);

INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'ANKAUFBELEG_DECLARATION'::belegtext_kind, 'de',
       'Die persönlichen Daten und die Identifizierung des Verkäufers wurden gemäß § 8 GwG aufgenommen. Der Verkäufer versichert, rechtmäßiger Eigentümer der angekauften Ware zu sein.',
       'system-seeded (migration 0024)'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'ANKAUFBELEG_DECLARATION' AND language = 'de' AND valid_to IS NULL
);

INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'GENERIC_HEADER'::belegtext_kind, 'de',
       'Warehouse14 — Edelmetalle · Münzen · Antiquitäten\nWeil am Rhein · Deutschland',
       'system-seeded (migration 0024); operator may override with shop-specific imprint'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'GENERIC_HEADER' AND language = 'de' AND valid_to IS NULL
);

INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'GENERIC_FOOTER'::belegtext_kind, 'de',
       'Vielen Dank für Ihren Einkauf!\nFür Rückfragen wenden Sie sich an unsere Geschäftsstelle.',
       'system-seeded (migration 0024); operator may override with USt-ID + IBAN imprint'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'GENERIC_FOOTER' AND language = 'de' AND valid_to IS NULL
);

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Resolver function
-- ═════════════════════════════════════════════════════════════════════════
--
-- Maps a tax_treatment_codes.code to the active belegtext.body_text.
-- Used by the receipt printer + invoice generator.

CREATE OR REPLACE FUNCTION resolve_belegtext_for_tax_treatment(
  p_code TEXT,
  p_language TEXT DEFAULT 'de'
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT body_text
    FROM belegtext_templates
   WHERE language = p_language
     AND valid_to IS NULL
     AND kind = CASE p_code
       WHEN 'MARGIN_25A'          THEN 'MARGIN_25A'::belegtext_kind
       WHEN 'STANDARD_19'         THEN 'STANDARD_19'::belegtext_kind
       WHEN 'REDUCED_7'           THEN 'REDUCED_7'::belegtext_kind
       WHEN 'INVESTMENT_GOLD_25C' THEN 'INVESTMENT_GOLD_25C'::belegtext_kind
       ELSE NULL
     END
   LIMIT 1
$$;

COMMENT ON FUNCTION resolve_belegtext_for_tax_treatment(TEXT, TEXT) IS
  'Returns the current belegtext.body_text for a tax_treatment_codes.code. '
  'NULL when no template is configured (caller must fall back to a default).';

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Role grants
-- ═════════════════════════════════════════════════════════════════════════

/* customers — extend the app-role UPDATE grant with the new operator-set
   columns. Existing column-restricted UPDATE grants live in 0007/0016. */
GRANT UPDATE (
  trust_level,
  kyc_verified_at,
  kyc_verified_by_user_id,
  price_expectation_notes
) ON customers TO warehouse14_app;

/* belegtext_templates — app: SELECT + INSERT (default privs from 0003) +
   narrow UPDATE on valid_to (the close-out path). */
GRANT UPDATE (valid_to) ON belegtext_templates TO warehouse14_app;

/* Worker — SELECT only (future report-builder reads templates). */
GRANT SELECT ON belegtext_templates TO warehouse14_worker;

/* Functions — EXECUTE for app + worker. */
GRANT EXECUTE ON FUNCTION resolve_belegtext_for_tax_treatment(TEXT, TEXT) TO warehouse14_app;
GRANT EXECUTE ON FUNCTION resolve_belegtext_for_tax_treatment(TEXT, TEXT) TO warehouse14_worker;

COMMIT;
