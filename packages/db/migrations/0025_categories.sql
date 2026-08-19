-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0025 — Categories taxonomy (Day 13, Phase 2.B kick-off)
--
-- Lifts the Phase 1 Backend Freeze (memory.md #72) and lands the FIRST of
-- three Day-13 commerce migrations. Closes audit §11 W-1 of
-- `docs/architecture/commerce-seo-audit.md`: the existing `item_type`
-- enum (12 flat values, metals-biased) cannot represent Briefmarken,
-- Postkarten, Militaria, Nachlass-Sammlungen, etc. The new `categories`
-- table is a self-referencing hierarchy capped at 2 levels (parent +
-- children), joined to products via `product_categories` M:N with a
-- partial UNIQUE enforcing exactly one primary category per product.
--
-- Non-destructive: existing `item_type` enum stays + every existing
-- product keeps its current row. Future products optionally land
-- categories via `POST /api/products/:id/categories`. The enum becomes
-- legacy + may be folded into a generated column in Phase 1.5 #I-40.
--
-- Trigger `enforce_no_grandparent_category` mirrors the
-- `enforce_no_grandparent` trigger on products.parent_product_id from
-- migration 0020 — the operator's mental model + storefront category
-- landing pages fit in 2 ranks; deeper hierarchies arrive Phase 1.5 #I-19.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS categories (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id                   UUID REFERENCES categories(id) ON DELETE RESTRICT,
  slug                        TEXT NOT NULL,
  name_de                     TEXT NOT NULL,
  name_en                     TEXT,
  description_de              TEXT,
  description_en              TEXT,
  schema_org_type             TEXT,
  display_order               INTEGER NOT NULL DEFAULT 0,
  hidden_from_storefront      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT categories_slug_format
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT categories_no_self_parent
    CHECK (id <> parent_id)
);

COMMENT ON TABLE categories IS
  '2-level hierarchical taxonomy. parent_id NULL = top-level. Day 13 — Phase 2.B.';

CREATE UNIQUE INDEX IF NOT EXISTS categories_slug_uq ON categories (slug);
CREATE INDEX IF NOT EXISTS categories_parent_idx ON categories (parent_id);
CREATE INDEX IF NOT EXISTS categories_display_order_idx
  ON categories (parent_id, display_order, name_de);

-- Trigger: 2-level depth cap (mirrors enforce_no_grandparent on products).
CREATE OR REPLACE FUNCTION enforce_no_grandparent_category() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_catalog, pg_temp
  AS $$
DECLARE
  parent_parent_id UUID;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT parent_id INTO parent_parent_id
      FROM categories
      WHERE id = NEW.parent_id;
    IF parent_parent_id IS NOT NULL THEN
      RAISE EXCEPTION
        'Categories are capped at 2 levels (parent + children). '
        'Cannot nest grandchildren of category %.', NEW.parent_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_no_grandparent_category() OWNER TO warehouse14_security;

DROP TRIGGER IF EXISTS trg_enforce_no_grandparent_category ON categories;
CREATE TRIGGER trg_enforce_no_grandparent_category
  BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION enforce_no_grandparent_category();

-- Shared touch_updated_at function.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_touch_updated_at ON categories;
CREATE TRIGGER trg_categories_touch_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- M:N join: product_categories
CREATE TABLE IF NOT EXISTS product_categories (
  product_id      UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id     UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  is_primary      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, category_id)
);

COMMENT ON TABLE product_categories IS
  'M:N product↔category. is_primary partial UNIQUE = at most one primary per product. '
  'ON DELETE CASCADE product side, RESTRICT category side.';

CREATE INDEX IF NOT EXISTS product_categories_category_idx
  ON product_categories (category_id);

CREATE UNIQUE INDEX IF NOT EXISTS product_categories_one_primary_uq
  ON product_categories (product_id)
  WHERE is_primary = TRUE;

-- Role grants.
GRANT SELECT, INSERT, UPDATE, DELETE ON categories TO warehouse14_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON product_categories TO warehouse14_app;
GRANT EXECUTE ON FUNCTION enforce_no_grandparent_category() TO warehouse14_app;
GRANT EXECUTE ON FUNCTION touch_updated_at() TO warehouse14_app;

COMMIT;
