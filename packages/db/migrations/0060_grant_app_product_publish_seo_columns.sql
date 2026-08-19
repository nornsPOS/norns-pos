-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0060 — grant warehouse14_app UPDATE on the product publish/SEO/
-- collector-metadata columns that later migrations added but never granted.
--
-- 0006_products.sql granted warehouse14_app column-scoped UPDATE on the base
-- product columns. Subsequent migrations ADDED operator-editable columns —
-- 0029 (is_published_to_web), the Day-13 SEO set (slug, seo_*, schema_org_type)
-- and the collector-metadata set (year_minted_*, origin_country, period,
-- catalog_reference, provenance_notes, *_en) — and the PUT /api/products/:id
-- route writes all of them (apps/api-cloud/src/routes/products.ts), but NO
-- migration ever extended the app's UPDATE grant to cover them.
--
-- Result (found in prod by the live watchdog): publishing a product to the web
-- shop (PUT setting is_published_to_web=TRUE) — or editing any SEO/collector
-- field — fails at runtime with `permission denied for table products` (42501),
-- so a freshly-added product shows in the cashier (POST works) but can NEVER be
-- pushed to the online shop. Latent since 0029; surfaced on the first real
-- web-publish.
--
-- Fix: grant the app column-scoped UPDATE on EXACTLY the operator-editable
-- columns the PUT route writes that it currently lacks. Least-privilege: the
-- intake-locked fiscal fields (acquisition_cost_eur, sku, tax_treatment_code,
-- weight_grams, fineness_decimal, metal, item_type, …) are deliberately NOT
-- granted and stay un-editable. Append-only + idempotent (GRANT is a no-op if
-- already held).
-- ──────────────────────────────────────────────────────────────────────────

GRANT UPDATE (
  is_published_to_web,
  slug,
  seo_title,
  seo_description,
  seo_title_en,
  seo_description_en,
  schema_org_type,
  description_en,
  year_minted_from,
  year_minted_to,
  origin_country,
  period,
  catalog_reference,
  provenance_notes
) ON products TO warehouse14_app;
