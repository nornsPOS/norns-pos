-- Migration 0029 — products.is_published_to_web (Phase 2.A)
--
-- WHY
-- ───
-- Day-13 migrations 0025/0026/0027 unlocked the SEO + taxonomy
-- backbone (categories, slug, seo_title, schema_org_type, business
-- locations). What's still missing is the EXPLICIT publication gate:
-- a row can be fully SEO-decorated yet not ready for the public store.
--
-- Today the `published_at` timestamp + `listed_on_storefront` boolean
-- both exist, but neither is a clean "this SKU is live on the web RIGHT
-- NOW" signal:
--   • `published_at`         was conflated with the SEO-meta "first
--                             published" timestamp.
--   • `listed_on_storefront` was a channel-projection flag the
--                             operator could toggle without the row
--                             being SEO-complete.
--
-- We need ONE field the storefront router can trust:
--   `is_published_to_web = TRUE`  ⇒  show this row on warehouse14.de
--                                    AND nothing else qualifies.
--
-- WHAT
-- ────
-- 1. ADD COLUMN  products.is_published_to_web BOOLEAN NOT NULL DEFAULT FALSE
-- 2. Partial covering index for the storefront's hot path:
--      WHERE is_published_to_web = TRUE AND status = 'AVAILABLE'
--      INCLUDES the columns the catalog endpoint projects
--      → planner uses an index-only scan for the public catalog.
-- 3. A short trigger that auto-stamps `published_at` to now() the FIRST
--    time `is_published_to_web` flips TRUE — operator never has to
--    fiddle with two fields. If they later un-publish (FALSE) and
--    re-publish, `published_at` stays at the FIRST publication
--    (Storefront SEO + sitemap-driven freshness signals expect this).
--
-- WHAT THIS DOES NOT TOUCH
-- ────────────────────────
-- `published_at`             — kept as the "first ever published" stamp.
-- `listed_on_storefront`     — kept; deprecated. Phase 1.5 #I-29 folds
--                              it into a GENERATED column reading
--                              is_published_to_web. Until then, both
--                              exist and the API surfaces is_published_to_web.
-- `acquisition_cost_eur`     — intake-locked, untouched.
-- DSFinV-K / fiscal columns  — untouched.
--
-- DURATION
-- ────────
-- ADD COLUMN with constant DEFAULT is metadata-only in PG 11+.
-- CREATE INDEX CONCURRENTLY would be ideal for a live system but the
-- salon DB is single-tenant (< 1 M rows) — a vanilla CREATE INDEX
-- completes in milliseconds and the operator is offline during deploy.

BEGIN;

-- 1. Publication flag.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_published_to_web BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN products.is_published_to_web IS
  'Phase 2.A storefront publication gate. TRUE = visible at warehouse14.de. '
  'FALSE = hidden from the public catalog regardless of SEO completeness. '
  'Default FALSE so existing rows stay private until the operator opts in.';

-- 2. Trigger — stamp `published_at` on first flip to TRUE.
--    Idempotent re-publish: keeps the original `published_at`, so
--    sitemap.lastmod doesn't churn when the operator toggles for a
--    photo refresh.
CREATE OR REPLACE FUNCTION on_products_publish_to_web()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_published_to_web = TRUE
     AND (OLD.is_published_to_web = FALSE OR OLD.is_published_to_web IS NULL)
     AND NEW.published_at IS NULL THEN
    NEW.published_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_publish_to_web ON products;
CREATE TRIGGER trg_products_publish_to_web
  BEFORE UPDATE ON products
  FOR EACH ROW
  WHEN (NEW.is_published_to_web IS DISTINCT FROM OLD.is_published_to_web)
  EXECUTE FUNCTION on_products_publish_to_web();

COMMENT ON FUNCTION on_products_publish_to_web IS
  'Phase 2.A trigger — stamps published_at on the first time '
  'is_published_to_web flips to TRUE. Idempotent on subsequent flips.';

-- 3. Storefront hot-path covering index.
--    Partial index → only AVAILABLE & published rows participate.
--    INCLUDE list = the columns the catalog API projects, so PG can
--    serve the listing as an index-only scan (no heap fetch).
--
--    NOTE on column order in the predicate: PG can use the partial
--    predicate as a filter regardless of leading-column equality —
--    the leading `is_published_to_web` exists only so EXPLAIN reads
--    sensibly to a human.
CREATE INDEX IF NOT EXISTS products_storefront_catalog_idx
  ON products (is_published_to_web, status, published_at DESC NULLS LAST)
  INCLUDE (id, slug, name, list_price_eur, schema_org_type)
  WHERE is_published_to_web = TRUE AND status = 'AVAILABLE';

COMMENT ON INDEX products_storefront_catalog_idx IS
  'Phase 2.A — covers the GET /api/storefront/products catalog scan. '
  'Partial WHERE keeps the index narrow; INCLUDE list serves the '
  'listing as index-only (no heap fetch). Reads only.';

COMMIT;
