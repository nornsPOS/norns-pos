-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0026 — Product SEO + collector metadata (Day 13, Phase 2.B)
--
-- Closes audit §11 W-2 + W-3 + W-4 of `commerce-seo-audit.md`:
--   W-2: `slug TEXT` — URL routing on `/artikel/<slug>-<sku-tail>`; without
--        this the storefront would have UUID-based URLs (SEO-hostile).
--   W-3: `seo_title` + `seo_description` (+ EN-side mirrors) — operator
--        override of the auto-derived <title> + <meta description> per page.
--   W-4: collector-universal facts as typed columns instead of opaque JSONB:
--        `period`, `year_minted_from`/`to`, `origin_country CHAR(2)`,
--        `catalog_reference` (Michel-Nr, Krause-KM, etc.), `provenance_notes`.
--
-- Additive only. All columns NULL-able. Existing rows are backfilled with
-- a `p-<sku>` slug to satisfy the partial UNIQUE index. The
-- `marketing_attributes JSONB` escape hatch survives untouched for the
-- 10% truly-domain-specific edges.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════
-- 1. New columns on products
-- ═════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS slug                    TEXT,
  ADD COLUMN IF NOT EXISTS seo_title               TEXT,
  ADD COLUMN IF NOT EXISTS seo_description         TEXT,
  ADD COLUMN IF NOT EXISTS schema_org_type         TEXT,
  ADD COLUMN IF NOT EXISTS year_minted_from        INTEGER,
  ADD COLUMN IF NOT EXISTS year_minted_to          INTEGER,
  ADD COLUMN IF NOT EXISTS origin_country          CHAR(2),
  ADD COLUMN IF NOT EXISTS period                  TEXT,
  ADD COLUMN IF NOT EXISTS catalog_reference       TEXT,
  ADD COLUMN IF NOT EXISTS provenance_notes        TEXT,
  ADD COLUMN IF NOT EXISTS description_en          TEXT,
  ADD COLUMN IF NOT EXISTS seo_title_en            TEXT,
  ADD COLUMN IF NOT EXISTS seo_description_en      TEXT,
  ADD COLUMN IF NOT EXISTS published_at            TIMESTAMPTZ;

COMMENT ON COLUMN products.slug IS
  'URL-safe identifier — drives /artikel/<slug>-<sku-tail>. '
  'Unique within active (archived_at IS NULL) rows. Day 13.';
COMMENT ON COLUMN products.published_at IS
  'When the row went storefront-public (NULL while DRAFT or pre-publish). '
  'Distinct from created_at so "neue Ankünfte" sort by intent.';

-- ═════════════════════════════════════════════════════════════════════
-- 2. Backfill slug for existing rows
-- ═════════════════════════════════════════════════════════════════════

UPDATE products
SET slug = LOWER(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      'p-' || sku,
      '[^a-zA-Z0-9]+', '-', 'g'
    ),
    '(^-+|-+$)', '', 'g'
  )
)
WHERE slug IS NULL;

-- ═════════════════════════════════════════════════════════════════════
-- 3. Constraints + indexes (idempotent via DO blocks since ALTER TABLE
--    ADD CONSTRAINT doesn't accept IF NOT EXISTS in older PG)
-- ═════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_slug_format'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_slug_format
      CHECK (slug IS NULL OR slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_year_minted_range_valid'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_year_minted_range_valid
      CHECK (
        year_minted_from IS NULL
        OR year_minted_to IS NULL
        OR year_minted_from <= year_minted_to
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_origin_country_format'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_origin_country_format
      CHECK (origin_country IS NULL OR origin_country ~ '^[A-Z]{2}$');
  END IF;
END$$;

-- Slug uniqueness scoped to active (non-archived) rows.
CREATE UNIQUE INDEX IF NOT EXISTS products_slug_active_uq
  ON products (slug)
  WHERE archived_at IS NULL AND slug IS NOT NULL;

-- Indexes for faceted browsing + storefront "neue Ankünfte" feed.
CREATE INDEX IF NOT EXISTS products_published_at_active_idx
  ON products (published_at)
  WHERE archived_at IS NULL AND published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_year_minted_idx
  ON products (year_minted_from, year_minted_to)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS products_origin_country_idx
  ON products (origin_country)
  WHERE archived_at IS NULL AND origin_country IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_period_idx
  ON products (period)
  WHERE archived_at IS NULL AND period IS NOT NULL;

COMMIT;
