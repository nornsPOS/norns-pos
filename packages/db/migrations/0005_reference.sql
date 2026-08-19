-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0005 — Reference data: tax treatment, karat grades, hallmarks
--
-- Tables created:
--   • tax_treatment_codes  — German §25a / §25c / §12 UStG tax categories
--   • karat_grades         — gold-only karat → fineness (decimal + per-mille)
--   • hallmarks            — visual stamp → (metal, fineness) for Bilderkennung
--
-- ADR references:
--   • ADR-0008 §4    — tax_treatment as lookup table (not enum) for BMF flexibility
--   • ADR-0015 §7    — 8-rule deterministic classifier uses these codes
--   • ADR-0016       — products.tax_treatment_code FK lands in migration 0006
--   • memory.md §7   — open items #13 (karat conversion), #14 (hallmarks)
--
-- Basel's Day-3 architectural directives (2026-05-24):
--   1. Reference tables are READ-ONLY for the app role.
--      • SELECT only. Explicit REVOKE on INSERT / UPDATE / DELETE.
--      • Reference updates happen via migration (or a separately-graented
--        admin role in future) — never from the runtime API.
--   2. Karat → fineness mapping with legal-trade precision (NUMERIC(5,4)).
--      • 8K  → 0.3330       • 14K → 0.5850       • 18K → 0.7500
--      • 22K → 0.9160       • 24K → 0.9990
--   3. Tax codes accurate to German UStG references:
--      • MARGIN_25A         — §25a UStG (Differenzbesteuerung)
--      • INVESTMENT_GOLD_25C — §25c UStG (Anlagegold, VAT-exempt)
--      • STANDARD_19        — §12 Abs. 1 UStG
--      • REDUCED_7          — §12 Abs. 2 UStG
--
-- Sources:
--   • BMF Umsatzsteuer-Handausgabe 2024 — §25a, §25c, §12
--   • DIN 17760 — Edelmetall-Legierungen (gold karat standards)
--   • DIN 17742 — Silberlegierungen
--   • DIN 17745 — Platinlegierungen
--
-- Idempotent: CREATE TABLE IF NOT EXISTS; INSERTs use ON CONFLICT DO NOTHING.
-- Transactional: BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. tax_treatment_codes
--    Lookup table per ADR-0008 §4. The decision to use a lookup
--    table instead of a PG enum is precisely so BMF can add categories
--    (e.g. LANDWIRTSCHAFTLICH_5_5) via a future migration row insert
--    without an ALTER TYPE.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tax_treatment_codes (
  code                TEXT          PRIMARY KEY,
  description_de      TEXT          NOT NULL,
  description_en      TEXT          NOT NULL,
  -- effective_vat_rate semantics:
  --   • A scalar VAT rate that applies to the gross sale (e.g. 0.1900 for 19%).
  --   • NULL means "rate is per-item-margin", i.e. the §25a scheme — VAT is
  --     calculated on the margin (sale − acquisition) at the prevailing rate,
  --     not on gross. The intake / checkout pipeline reads NULL as "use the
  --     margin calculator".
  --   • 0.0000 means exempt — no VAT collected on the sale.
  effective_vat_rate  NUMERIC(5,4),
  legal_reference     TEXT          NOT NULL,
  active              BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT tax_treatment_codes_rate_range
    CHECK (effective_vat_rate IS NULL
           OR (effective_vat_rate >= 0.0000 AND effective_vat_rate <= 1.0000)),
  CONSTRAINT tax_treatment_codes_code_format
    CHECK (code ~ '^[A-Z][A-Z0-9_]*$')
);

CREATE TRIGGER trg_tax_treatment_codes_updated_at
  BEFORE UPDATE ON tax_treatment_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS tax_treatment_codes_active_idx
  ON tax_treatment_codes (active)
  WHERE active = TRUE;

COMMENT ON TABLE tax_treatment_codes IS
  'BMF-derived German tax treatment categories. READ-ONLY for the app role. '
  'Updates land via migration only. See ADR-0008 §4 + ADR-0015 §7.';
COMMENT ON COLUMN tax_treatment_codes.effective_vat_rate IS
  'Scalar rate applied to gross sale. NULL → §25a margin scheme (rate applied '
  'to margin, not gross). 0 → exempt (e.g. §25c investment gold).';

-- ─────────────────────────────────────────────────────────────────────
-- 1.a tax_treatment_codes seed — 4 baseline codes (ADR-0015 §7)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO tax_treatment_codes (code, description_de, description_en, effective_vat_rate, legal_reference)
VALUES
  ('MARGIN_25A',
   'Differenzbesteuerung',
   'Margin tax',
   NULL,                                  -- per-item margin calc
   '§25a UStG'),

  ('INVESTMENT_GOLD_25C',
   'Anlagegold (steuerbefreit)',
   'Investment gold (VAT-exempt)',
   0.0000,
   '§25c UStG'),

  ('STANDARD_19',
   'Standardumsatzsteuer 19%',
   'Standard VAT 19%',
   0.1900,
   '§12 Abs. 1 UStG'),

  ('REDUCED_7',
   'Ermäßigte Umsatzsteuer 7%',
   'Reduced VAT 7%',
   0.0700,
   '§12 Abs. 2 UStG')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 2. karat_grades
--    Gold-only. The intake pipeline and pricing engine call this when a
--    karat value is the input (per Bilderkennung erkannt, customer-stated, or
--    hallmark-derived). Fineness is stored as both per-mille (integer)
--    and decimal (NUMERIC(5,4)) so callers can pick the form that
--    matches their arithmetic surface.
--
--    NUMERIC(5,4) holds [0.0000, 9.9999] which is more than enough for
--    fineness (always ≤ 1.0000). Critical: NO FLOATS — the value flows
--    through Decimal.js (packages/domain/Money) for price calculation.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS karat_grades (
  code                TEXT          PRIMARY KEY,                   -- '8K', '14K', etc.
  karat_value         SMALLINT      NOT NULL UNIQUE,                -- 8, 14, 18, 22, 24
  fineness_per_1000   SMALLINT      NOT NULL UNIQUE,                -- 333, 585, 750, 916, 999
  fineness_decimal    NUMERIC(5,4)  NOT NULL UNIQUE,                -- 0.3330, 0.5850, 0.7500, 0.9160, 0.9990
  hallmark_stamp      TEXT          NOT NULL UNIQUE,                -- '333', '585', '750', '916', '999' (matches hallmarks.stamp for metal='gold')
  display_label_de    TEXT          NOT NULL,
  active              BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT karat_grades_code_format
    CHECK (code ~ '^[0-9]{1,2}K$'),
  CONSTRAINT karat_grades_value_range
    CHECK (karat_value BETWEEN 1 AND 24),
  CONSTRAINT karat_grades_fineness_range
    CHECK (fineness_per_1000 BETWEEN 1 AND 999),
  CONSTRAINT karat_grades_decimal_range
    CHECK (fineness_decimal > 0 AND fineness_decimal <= 1.0000),
  -- The decimal and per-mille values MUST agree to 4 decimal places.
  -- Discovers transcription errors at INSERT time, not at price-calc time.
  CONSTRAINT karat_grades_decimal_matches_per_mille
    CHECK (ABS(fineness_decimal - (fineness_per_1000::numeric / 1000)) < 0.00005)
);

CREATE TRIGGER trg_karat_grades_updated_at
  BEFORE UPDATE ON karat_grades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS karat_grades_active_idx
  ON karat_grades (karat_value)
  WHERE active = TRUE;

COMMENT ON TABLE karat_grades IS
  'Gold karat → fineness lookup. Standard DIN 17760 values. READ-ONLY for app role. '
  'See memory.md §7.13.';
COMMENT ON COLUMN karat_grades.fineness_decimal IS
  'Fineness as NUMERIC(5,4) — 4-decimal precision. Used directly in price calcs '
  'via Decimal.js arithmetic. The CHECK constraint enforces consistency with '
  'fineness_per_1000.';

-- ─────────────────────────────────────────────────────────────────────
-- 2.a karat_grades seed — gold standards per DIN 17760 + Basel directive
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO karat_grades (code, karat_value, fineness_per_1000, fineness_decimal, hallmark_stamp, display_label_de)
VALUES
  ( '8K',  8, 333, 0.3330, '333', 'Gold 333‰ (8 Karat)'),
  ('14K', 14, 585, 0.5850, '585', 'Gold 585‰ (14 Karat)'),
  ('18K', 18, 750, 0.7500, '750', 'Gold 750‰ (18 Karat)'),
  ('22K', 22, 916, 0.9160, '916', 'Gold 916‰ (22 Karat)'),
  ('24K', 24, 999, 0.9990, '999', 'Gold 999‰ (Feingold)')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 3. hallmarks
--    All precious metals. Bilderkennung (intake pipeline ADR-0015) detects a
--    stamp like "585" or "925" and looks up (metal, stamp) here to get the
--    fineness. Disambiguation by metal is required because '999' appears
--    on gold, silver, AND platinum (Feingold / Feinsilber / Feinplatin).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hallmarks (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  stamp               TEXT          NOT NULL,                       -- '333', '585', '925', etc.
  metal               TEXT          NOT NULL
                                    CHECK (metal IN ('gold', 'silver', 'platinum', 'palladium')),
  fineness_per_1000   SMALLINT      NOT NULL,
  fineness_decimal    NUMERIC(5,4)  NOT NULL,
  description_de      TEXT          NOT NULL,
  description_en      TEXT          NOT NULL,
  active              BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT hallmarks_metal_stamp_uq UNIQUE (metal, stamp),
  CONSTRAINT hallmarks_fineness_range
    CHECK (fineness_per_1000 BETWEEN 1 AND 1000),
  CONSTRAINT hallmarks_decimal_range
    CHECK (fineness_decimal > 0 AND fineness_decimal <= 1.0000),
  CONSTRAINT hallmarks_decimal_matches_per_mille
    CHECK (ABS(fineness_decimal - (fineness_per_1000::numeric / 1000)) < 0.00005)
);

CREATE TRIGGER trg_hallmarks_updated_at
  BEFORE UPDATE ON hallmarks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS hallmarks_metal_idx
  ON hallmarks (metal)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS hallmarks_stamp_idx
  ON hallmarks (stamp)
  WHERE active = TRUE;

COMMENT ON TABLE hallmarks IS
  'Visual hallmark → (metal, fineness) lookup. Used by intake Bilderkennung (ADR-0015 §5). '
  'READ-ONLY for app role.';

-- ─────────────────────────────────────────────────────────────────────
-- 3.a hallmarks seed
--   Gold:     DIN 17760 — 333, 585, 750, 916, 999
--   Silver:   DIN 17742 — 800, 835, 925 (Sterling), 950, 999
--   Platinum: DIN 17745 — 850, 900, 950, 999
--   Palladium: 500, 950, 999 (less common but present in German market)
-- ─────────────────────────────────────────────────────────────────────
INSERT INTO hallmarks (stamp, metal, fineness_per_1000, fineness_decimal, description_de, description_en)
VALUES
  -- Gold
  ('333', 'gold',      333, 0.3330, 'Gold 333‰ (8 Karat)',         'Gold 333‰ (8 karat)'),
  ('585', 'gold',      585, 0.5850, 'Gold 585‰ (14 Karat)',        'Gold 585‰ (14 karat)'),
  ('750', 'gold',      750, 0.7500, 'Gold 750‰ (18 Karat)',        'Gold 750‰ (18 karat)'),
  ('916', 'gold',      916, 0.9160, 'Gold 916‰ (22 Karat)',        'Gold 916‰ (22 karat)'),
  ('999', 'gold',      999, 0.9990, 'Gold 999‰ (Feingold)',        'Gold 999‰ (fine gold)'),

  -- Silver
  ('800', 'silver',    800, 0.8000, 'Silber 800‰',                 'Silver 800‰'),
  ('835', 'silver',    835, 0.8350, 'Silber 835‰',                 'Silver 835‰'),
  ('925', 'silver',    925, 0.9250, 'Silber 925‰ (Sterling)',      'Silver 925‰ (sterling)'),
  ('950', 'silver',    950, 0.9500, 'Silber 950‰',                 'Silver 950‰'),
  ('999', 'silver',    999, 0.9990, 'Silber 999‰ (Feinsilber)',    'Silver 999‰ (fine silver)'),

  -- Platinum
  ('850', 'platinum',  850, 0.8500, 'Platin 850‰',                 'Platinum 850‰'),
  ('900', 'platinum',  900, 0.9000, 'Platin 900‰',                 'Platinum 900‰'),
  ('950', 'platinum',  950, 0.9500, 'Platin 950‰',                 'Platinum 950‰'),
  ('999', 'platinum',  999, 0.9990, 'Platin 999‰ (Feinplatin)',    'Platinum 999‰ (fine platinum)'),

  -- Palladium
  ('500', 'palladium', 500, 0.5000, 'Palladium 500‰',              'Palladium 500‰'),
  ('950', 'palladium', 950, 0.9500, 'Palladium 950‰',              'Palladium 950‰'),
  ('999', 'palladium', 999, 0.9990, 'Palladium 999‰ (Feinpalladium)', 'Palladium 999‰ (fine palladium)')
ON CONFLICT (metal, stamp) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 4. APP ROLE GRANTS — Basel Day-3 directive: SELECT-ONLY on every
--    reference table. Explicitly REVOKE the INSERT that migration 0003's
--    default privileges granted automatically.
--
--    The runtime API never mutates these tables. Updates happen via:
--      • Future migrations (preferred — leaves an audit trail in git)
--      • An admin-graented role distinct from warehouse14_app (future
--        scope; not in V1)
-- ─────────────────────────────────────────────────────────────────────

-- tax_treatment_codes — SELECT only
REVOKE INSERT, UPDATE, DELETE ON tax_treatment_codes FROM warehouse14_app;

-- karat_grades — SELECT only
REVOKE INSERT, UPDATE, DELETE ON karat_grades FROM warehouse14_app;

-- hallmarks — SELECT only
REVOKE INSERT, UPDATE, DELETE ON hallmarks FROM warehouse14_app;

COMMIT;
