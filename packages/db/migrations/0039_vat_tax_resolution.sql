-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0039 — Epic H: VAT Tax Resolution & Cart Rules
--
-- Adds the new `REVERSE_CHARGE_13B` belegtext kind and updates enums.
-- Extends `customers` with a nullable `vat_id` column.
-- Seeds `MIXED` and `REVERSE_CHARGE_13B` into tax treatment reference codes.
-- Updates `resolve_belegtext_for_tax_treatment` mapping.
-- Seeds German reverse-charge belegtext template.
-- ──────────────────────────────────────────────────────────────────────────

-- Postgres enum additions cannot run inside transaction blocks.
ALTER TYPE belegtext_kind ADD VALUE IF NOT EXISTS 'REVERSE_CHARGE_13B';

BEGIN;

-- ── 1. Extend customers table ─────────────────────────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS vat_id TEXT;

COMMENT ON COLUMN customers.vat_id IS
  'European Union B2B VAT ID (VIES verified).';

-- Grant narrow UPDATE privilege on the new column to the app role.
GRANT UPDATE (vat_id) ON customers TO warehouse14_app;

-- ── 2. Seed new tax treatment codes ────────────────────────────────────────
INSERT INTO tax_treatment_codes (code, description_de, description_en, effective_vat_rate, legal_reference)
VALUES
  ('MIXED',
   'Gemischte Besteuerung',
   'Mixed taxation',
   NULL,
   'UStG'),
  ('REVERSE_CHARGE_13B',
   'Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)',
   'Reverse charge (§13b UStG)',
   0.0000,
   '§13b Abs. 2 Nr. 9 UStG')
ON CONFLICT (code) DO NOTHING;

-- ── 3. Update resolve_belegtext_for_tax_treatment ──────────────────────────
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
       WHEN 'REVERSE_CHARGE_13B'  THEN 'REVERSE_CHARGE_13B'::belegtext_kind
       ELSE NULL
     END
   LIMIT 1
$$;

-- ── 4. Seed §13b belegtext template ────────────────────────────────────────
INSERT INTO belegtext_templates (kind, language, body_text, notes)
SELECT 'REVERSE_CHARGE_13B'::belegtext_kind, 'de',
       'Steuerschuldnerschaft des Leistungsempfängers nach §13b Abs. 2 Nr. 9 UStG.',
       'system-seeded (migration 0039)'
WHERE NOT EXISTS (
  SELECT 1 FROM belegtext_templates
   WHERE kind = 'REVERSE_CHARGE_13B' AND language = 'de' AND valid_to IS NULL
);

COMMIT;
