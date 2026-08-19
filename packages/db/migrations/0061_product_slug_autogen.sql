-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0061 — auto-generate a URL-safe, UNIQUE product slug on publish.
--
-- WHY
-- ───
-- The public storefront builds the PDP link from `products.slug`
-- (GET /api/storefront/products/:slug). `slug` is NULLABLE (0026/0029) and is
-- only set when the operator types one in the PUT /api/products/:id route. So a
-- product published to the web with NO slug (e.g. Basel's product "Basel",
-- slug = NULL) yields a BROKEN PDP link: the listing card has no usable href and
-- /api/storefront/products/null 404s. The catalog also can't fall back forever
-- to `p-<sku>` because that bypasses the operator's SEO-friendly URLs.
--
-- WHAT
-- ────
-- A BEFORE INSERT OR UPDATE trigger that, whenever a row becomes "published"
-- (is_published_to_web = TRUE OR status = 'AVAILABLE') AND `slug IS NULL`,
-- auto-fills a deterministic, URL-safe, collision-free slug derived from `name`
-- (falling back to `sku` when `name` is empty). This covers EVERY publish path
-- — the PUT route, a direct SQL UPDATE, the Owner Desktop DRAFT→AVAILABLE flip,
-- a bulk backfill — because the rule lives in the DB, not one route.
--
-- DESIGN
-- ──────
-- • slugify(text): German-aware. Lower-cases, transliterates ä/ö/ü/ß →
--   ae/oe/ue/ss, strips diacritics on a best-effort basis, replaces every run of
--   non-[a-z0-9] with a single '-', and trims leading/trailing '-'. Pure +
--   IMMUTABLE so the planner can inline it. Returns '' for an all-punctuation
--   input; the trigger then falls back to the sku-derived base.
--
-- • Collision safety: the trigger first tries the bare base slug. If a DIFFERENT
--   product already owns it, it appends '-<6-hex>' from the row's own id (stable
--   across re-publishes of the SAME row — the id never changes), and if THAT
--   still collides (astronomically unlikely) it widens to the full id. The check
--   excludes the row's own id so re-running the trigger on an already-slugged row
--   is a no-op. `slug` already has no UNIQUE constraint in the schema, so the
--   trigger is the integrity gate; the SELECT-then-assign races are not a concern
--   for a single-tenant shop (one writer), and the worst case is a duplicate slug
--   that the operator can rename — never a crash.
--
-- PRIVILEGES / SAFETY
-- ───────────────────
-- This is a PLAIN (non-SECURITY-DEFINER) BEFORE trigger, so its body runs as the
-- INVOKER (warehouse14_app). The collision SELECT reads `products`, on which
-- warehouse14_app already holds SELECT (0003 default privileges); assigning
-- NEW.slug in a BEFORE trigger needs no extra grant (NEW mutation is unrestricted
-- by column privileges), and 0060 already granted UPDATE(slug) for the explicit
-- PUT path. So there is NO 0056/0057-class missing-grant gap here. We still GRANT
-- EXECUTE on slugify() to the app + worker roles defensively (EXECUTE is the
-- default for new functions via 0003 ALTER DEFAULT PRIVILEGES, but we make it
-- explicit so a future privilege tightening can't silently break publish).
--
-- This trigger is INDEPENDENT of trg_products_publish_to_web (0029): that one
-- stamps published_at; this one fills slug. Both are BEFORE-row triggers on
-- products; Postgres fires them in alphabetical name order
-- (trg_products_publish_to_web < trg_products_slug_autogen), which is irrelevant
-- because they touch disjoint columns.
--
-- Append-only + idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.
-- The immutable 0006/0029 files are NOT edited.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. slugify(text) — URL-safe, IMMUTABLE. The ASCII-only normaliser.
--
-- translate()'s from/to strings are length-coupled and 1:1, so it cannot
-- EXPAND ä→ae. We therefore do NOT transliterate here — slugify just maps any
-- remaining non-[a-z0-9] run (incl. residual accents) to a single '-'. Callers
-- that want German expansion go through slugify_de(), which pre-expands the
-- umlauts/ß to ASCII letters BEFORE calling this. This keeps slugify trivially
-- correct (no length-coupled translate table to get wrong) and side-effect free.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION slugify(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT
    -- 3. trim leading / trailing hyphens left by edge punctuation
    btrim(
      -- 2. collapse every run of non [a-z0-9] into a single '-'
      regexp_replace(
        -- 1. lower-case
        lower(input),
        '[^a-z0-9]+', '-', 'g'
      ),
      '-'
    )
$$;

COMMENT ON FUNCTION slugify(TEXT) IS
  'URL-safe slug from already-ASCII text. Lower-case, [a-z0-9-] only, no '
  'leading/trailing hyphen. Non-ASCII (e.g. unexpanded accents) is dropped to a '
  'separator — use slugify_de() for German umlaut/eszett EXPANSION. IMMUTABLE.';

-- German-aware wrapper: expand ä/ö/ü→ae/oe/ue and ß→ss (translate() can't —
-- it is 1:1), THEN run the ASCII slugify. Single source of truth for the trigger.
CREATE OR REPLACE FUNCTION slugify_de(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT slugify(
    replace(replace(replace(replace(replace(replace(replace(
      input,
      'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'),
      'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'),
      'ß', 'ss')
  )
$$;

COMMENT ON FUNCTION slugify_de(TEXT) IS
  'German-aware slug: expands ä/ö/ü→ae/oe/ue and ß→ss, then slugify(). Used by '
  'the product slug-autogen trigger.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Trigger fn — fill slug on first publish when NULL.
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_products_autogen_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug  TEXT;
  candidate  TEXT;
BEGIN
  -- Only act when the row is (becoming) public AND has no slug yet.
  IF NEW.slug IS NOT NULL AND length(btrim(NEW.slug)) > 0 THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.is_published_to_web = TRUE OR NEW.status = 'AVAILABLE') THEN
    RETURN NEW;
  END IF;

  -- Build the base from the display name, fall back to the sku.
  base_slug := slugify_de(COALESCE(NEW.name, ''));
  IF base_slug IS NULL OR base_slug = '' THEN
    base_slug := slugify_de(COALESCE(NEW.sku, ''));
  END IF;
  -- Last-resort base so a row with an empty name AND empty sku still gets a slug.
  IF base_slug IS NULL OR base_slug = '' THEN
    base_slug := 'artikel';
  END IF;

  -- Try the bare base first; only suffix on a real collision with a DIFFERENT row.
  candidate := base_slug;
  IF EXISTS (
    SELECT 1 FROM products p
    WHERE p.slug = candidate AND p.id <> NEW.id
  ) THEN
    -- Deterministic short suffix from THIS row's id (stable across re-publishes).
    candidate := base_slug || '-' || substr(replace(NEW.id::text, '-', ''), 1, 6);
    IF EXISTS (
      SELECT 1 FROM products p
      WHERE p.slug = candidate AND p.id <> NEW.id
    ) THEN
      -- Astronomically unlikely; widen to the full id for a guaranteed-unique slug.
      candidate := base_slug || '-' || replace(NEW.id::text, '-', '');
    END IF;
  END IF;

  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION on_products_autogen_slug IS
  'BEFORE INSERT/UPDATE on products: when the row is (becoming) published '
  '(is_published_to_web=TRUE OR status=AVAILABLE) and slug IS NULL, auto-fills a '
  'collision-free slugify_de(name) (sku fallback). Idempotent on re-publish.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Bind the trigger.
--
-- Fire on every INSERT (a row born AVAILABLE/published gets a slug) and on the
-- UPDATEs that could flip the publish gate. We don't add a restrictive WHEN
-- clause beyond the publish columns so a name edit on an already-published,
-- still-slug-less row also backfills.
-- ─────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_products_slug_autogen ON products;
CREATE TRIGGER trg_products_slug_autogen
  BEFORE INSERT OR UPDATE OF is_published_to_web, status, slug, name ON products
  FOR EACH ROW
  EXECUTE FUNCTION on_products_autogen_slug();

-- ─────────────────────────────────────────────────────────────────────
-- 4. Defensive EXECUTE grants (default privileges already cover these for the
--    app role; explicit grants survive a future privilege tightening so the
--    publish path can never lose the ability to compute its slug).
-- ─────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION slugify(TEXT)    TO warehouse14_app;
GRANT EXECUTE ON FUNCTION slugify_de(TEXT) TO warehouse14_app;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Backfill: any ALREADY-published row sitting on a NULL slug gets one now.
--    Touching `name` re-fires the trigger (it's in the UPDATE OF column list)
--    without changing any value. Safe + idempotent.
-- ─────────────────────────────────────────────────────────────────────
UPDATE products
   SET name = name
 WHERE slug IS NULL
   AND (is_published_to_web = TRUE OR status = 'AVAILABLE');

COMMIT;
