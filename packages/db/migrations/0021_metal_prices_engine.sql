-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0021 — Edelmetall-Kursmodul (Day 23)
--
-- The daily-pricing engine for a gold dealer. Closes audit gap #4
-- (Edelmetall- & Kursmodul) from Basel's 2026-05-26 owner-driven audit.
--
-- What lands:
--   (A) `metal_prices` table — append-only history with partial UNIQUE
--       ensuring exactly one CURRENT row per metal (valid_to IS NULL).
--   (B) products.feingewicht_grams — GENERATED ALWAYS STORED
--       (= weight_grams × fineness_decimal, NULL-safe).
--   (C) products.collector_premium_eur — Sammleraufschlag, ADMIN-set.
--   (D) SQL helpers: current_metal_price_eur_per_gram(metal)
--       + product_schmelzwert_eur(product_id).
--
-- See memory.md decision #69 for the long-form rationale.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. metal_price_source enum
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'metal_price_source') THEN
    CREATE TYPE metal_price_source AS ENUM (
      'LBMA',                -- official LBMA fix
      'XAUEUR_VENDOR',       -- third-party API (metalpriceapi.com etc.)
      'MANUAL',              -- ADMIN override
      'INTERNAL_ESTIMATE'    -- fallback when no live feed
    );
    COMMENT ON TYPE metal_price_source IS
      'Provenance of a metal_prices row. MANUAL requires audit_log + reason.';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. metal_prices — append-only history with one-current-per-metal
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS metal_prices (
  id                      BIGSERIAL              PRIMARY KEY,
  metal                   TEXT                   NOT NULL
                                                 CHECK (metal IN ('gold','silver','platinum','palladium')),
  price_per_gram_eur      NUMERIC(15,4)          NOT NULL CHECK (price_per_gram_eur > 0),
  source                  metal_price_source     NOT NULL,
  fetched_at              TIMESTAMPTZ            NOT NULL DEFAULT now(),

  /** Defines the open interval [valid_from, valid_to). NULL valid_to = CURRENT. */
  valid_from              TIMESTAMPTZ            NOT NULL DEFAULT now(),
  valid_to                TIMESTAMPTZ,

  /** Raw provider response for forensics + re-verification. */
  source_payload          JSONB                  NOT NULL DEFAULT '{}'::jsonb,

  /** When MANUAL: who + why. When LBMA/VENDOR: NULL. */
  manual_override_by_user_id  UUID               REFERENCES users(id),
  manual_override_reason      TEXT,

  /** When LBMA/VENDOR: which worker_job_runs row produced this. */
  fetched_by_job_run_id   BIGINT                 REFERENCES worker_job_runs(id),

  created_at              TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT metal_prices_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT metal_prices_manual_evidence CHECK (
    source <> 'MANUAL' OR (manual_override_by_user_id IS NOT NULL AND manual_override_reason IS NOT NULL)
  ),
  CONSTRAINT metal_prices_payload_object CHECK (jsonb_typeof(source_payload) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS metal_prices_one_current_per_metal_uq
  ON metal_prices (metal)
  WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS metal_prices_metal_validfrom_idx
  ON metal_prices (metal, valid_from DESC);

CREATE INDEX IF NOT EXISTS metal_prices_source_fetched_idx
  ON metal_prices (source, fetched_at DESC);

COMMENT ON TABLE metal_prices IS
  'Append-only Edelmetallkurs history. Partial UNIQUE on (metal) WHERE valid_to IS NULL '
  'guarantees exactly one CURRENT price per metal. Workflow: open one tx, '
  'UPDATE existing current → SET valid_to = now(), then INSERT new row. '
  'NEVER DELETE — forensic audit + DSFinV-K context.';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. products.feingewicht_grams (GENERATED STORED)
--    + products.collector_premium_eur
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS feingewicht_grams NUMERIC(10,4)
  GENERATED ALWAYS AS (
    CASE
      WHEN weight_grams IS NULL OR fineness_decimal IS NULL THEN NULL
      ELSE weight_grams * fineness_decimal
    END
  ) STORED;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS collector_premium_eur NUMERIC(18,2);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_collector_premium_nonneg') THEN
    ALTER TABLE products
      ADD CONSTRAINT products_collector_premium_nonneg
      CHECK (collector_premium_eur IS NULL OR collector_premium_eur >= 0);
  END IF;
END$$;

COMMENT ON COLUMN products.feingewicht_grams IS
  'GENERATED ALWAYS AS STORED = weight_grams × fineness_decimal. The fine-metal '
  'weight underpins Schmelzwert calculations. Never settable directly.';
COMMENT ON COLUMN products.collector_premium_eur IS
  'Sammleraufschlag — operator-set premium over scrap value for collectible items '
  '(numismatic premium, hallmark history, etc.). NULL means "use list_price − schmelzwert".';

CREATE INDEX IF NOT EXISTS products_feingewicht_idx
  ON products (metal, feingewicht_grams)
  WHERE feingewicht_grams IS NOT NULL AND status IN ('AVAILABLE','RESERVED');

-- ═════════════════════════════════════════════════════════════════════════
-- 4. SQL helper functions
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION current_metal_price_eur_per_gram(p_metal TEXT)
RETURNS NUMERIC(15,4)
LANGUAGE sql STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
  SELECT price_per_gram_eur
    FROM metal_prices
   WHERE metal = p_metal AND valid_to IS NULL
   LIMIT 1
$$;

COMMENT ON FUNCTION current_metal_price_eur_per_gram(TEXT) IS
  'Returns the CURRENT price per gram in EUR for the given metal. NULL if no row.';

CREATE OR REPLACE FUNCTION product_schmelzwert_eur(p_product_id UUID)
RETURNS NUMERIC(18,2)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_metal TEXT;
  v_fein  NUMERIC(10,4);
  v_price NUMERIC(15,4);
BEGIN
  SELECT metal, feingewicht_grams
    INTO v_metal, v_fein
    FROM products
   WHERE id = p_product_id
   LIMIT 1;

  IF v_metal IS NULL OR v_fein IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT current_metal_price_eur_per_gram(v_metal) INTO v_price;
  IF v_price IS NULL THEN
    RETURN NULL;
  END IF;

  -- ⚠️ 11.08.2026 KORRIGIERT. Hier stand „Round HALF_EVEN to 2 decimal places
  -- using built-in NUMERIC rounding". Das ist falsch, und zwar messbar:
  --
  --   SELECT ROUND(3653.325::numeric,2), ROUND(0.125::numeric,2),
  --          ROUND(-0.125::numeric,2),   ROUND(2.5::numeric,0);
  --     → 3653.33 | 0.13 | -0.13 | 3
  --   HALF_EVEN waere 3653.32 | 0.12 | -0.12 | 2.
  --
  -- Postgres rundet bei NUMERIC VON DER NULL WEG. Die TypeScript-Seite
  -- (Decimal.js, global ROUND_HALF_EVEN) rundet anders. Wer diesen Kommentar
  -- liest und darauf baut, baut auf eine Zusage, die der Code nicht haelt.
  --
  -- ZWEITE, GROESSERE QUELLE VON ABWEICHUNGEN: `feingewicht_grams` ist
  -- NUMERIC(10,4) GENERATED, das Feingewicht wird also ZUERST auf vier
  -- Stellen gerundet, und erst dieses Zwischenergebnis geht hier ein. Die
  -- Kasse rechnet in bigint durch und rundet genau EINMAL am Ende. Der
  -- Unterschied kommt ueberwiegend von diesem Zwischenschritt, nicht von der
  -- Rundungsart — wer nur die Rundungsart angleicht, behebt fast nichts.
  --
  -- Kein Beleg, keine TSE, keine DSFinV-K haengt daran (Wanderung 0132:
  -- „NUR BESTAND, NIEMALS EIN BELEG"). Der Kommentar wird korrigiert, die
  -- Rechnung bleibt, wie sie ist.
  RETURN ROUND(v_fein * v_price, 2);
END;
$$;

COMMENT ON FUNCTION product_schmelzwert_eur(UUID) IS
  'Current melt value (Schmelzwert) = feingewicht × current metal price. '
  'NULL when metal / weight / fineness / price unset.';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Role grants
-- ═════════════════════════════════════════════════════════════════════════

/* App role: SELECT + INSERT default from migration 0003.
   UPDATE narrowly on the row-closing path (valid_to flip). */
GRANT UPDATE (valid_to) ON metal_prices TO warehouse14_app;
GRANT USAGE ON SEQUENCE metal_prices_id_seq TO warehouse14_app;

/* Worker role: same — needs to close out + insert. */
GRANT UPDATE (valid_to) ON metal_prices TO warehouse14_worker;
GRANT INSERT, SELECT ON metal_prices TO warehouse14_worker;
GRANT USAGE ON SEQUENCE metal_prices_id_seq TO warehouse14_worker;

/* products.collector_premium_eur — settable by app. */
GRANT UPDATE (collector_premium_eur) ON products TO warehouse14_app;
/* feingewicht_grams is GENERATED — Postgres refuses any UPDATE on it regardless of grants. */

/* Functions — EXECUTE for app + worker. */
GRANT EXECUTE ON FUNCTION current_metal_price_eur_per_gram(TEXT) TO warehouse14_app;
GRANT EXECUTE ON FUNCTION current_metal_price_eur_per_gram(TEXT) TO warehouse14_worker;
GRANT EXECUTE ON FUNCTION product_schmelzwert_eur(UUID) TO warehouse14_app;
GRANT EXECUTE ON FUNCTION product_schmelzwert_eur(UUID) TO warehouse14_worker;

COMMIT;
