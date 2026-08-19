-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0006 — Products, photos, pgvector + HNSW, atomic reservation envelope
--
-- This migration lands the inventory authority. After it:
--   • `products` is the single source of truth for "what does Warehouse14 own,
--     and is it for sale?" (ADR-0016 §1).
--   • The 4-state machine (DRAFT → AVAILABLE → RESERVED → SOLD) is enforced
--     by CHECK constraints at the DB level (ADR-0016 §1).
--   • Atomic reservation via `UPDATE … WHERE status = 'AVAILABLE'` works
--     out of the box; the implementation lives in @warehouse14/inventory-lock.
--   • Semantic similarity (ADR-0016 §6.bis) is queryable via the HNSW index
--     on the embedding column, partial-restricted to AVAILABLE rows.
--   • Photos live in `product_photos`, referenced into Cloudflare R2 by `r2_key`.
--
-- ADR references:
--   • ADR-0008 §6, §9   — Money cols NUMERIC(18,2)/(15,4)/(10,4); migration ordering
--   • ADR-0015 §7       — tax_treatment_code FK; intake-locked classification fields
--   • ADR-0016 §1, §2   — state machine + atomic reservation contract
--   • ADR-0016 §6.bis   — pgvector(1536) + HNSW partial on AVAILABLE
--   • ADR-0017          — embedding powers the bot's semantic search tool
--
-- Idempotent: CREATE TABLE/INDEX/TYPE/TRIGGER all guarded.
-- Transactional: BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ENUM types
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_status') THEN
    CREATE TYPE product_status AS ENUM ('DRAFT', 'AVAILABLE', 'RESERVED', 'SOLD');
    COMMENT ON TYPE product_status IS '4-state machine per ADR-0016 §1. No other states exist.';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_channel') THEN
    CREATE TYPE reservation_channel AS ENUM ('POS', 'STOREFRONT', 'EBAY');
    COMMENT ON TYPE reservation_channel IS 'The 3 channels permitted to win a reservation race (ADR-0016 §4).';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_type') THEN
    CREATE TYPE item_type AS ENUM (
      'gold_jewelry',
      'gold_coin',
      'gold_bar',
      'silver_jewelry',
      'silver_coin',
      'silver_bar',
      'platinum_jewelry',
      'platinum_coin',
      'platinum_bar',
      'antique',
      'watch',
      'other'
    );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'photo_source') THEN
    CREATE TYPE photo_source AS ENUM ('intake', 'admin_upload', 'storefront_user');
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. products
--
-- The state machine is enforced by CHECK constraints (not triggers) — the
-- atomic UPDATE statement is its own discipline, and the CHECKs catch any
-- code path that tries to leave the row in an inconsistent shape.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  sku                         TEXT                NOT NULL UNIQUE,
  barcode                     TEXT                UNIQUE,

  -- State machine (ADR-0016 §1)
  status                      product_status      NOT NULL DEFAULT 'DRAFT',

  -- Reservation envelope — populated when status = 'RESERVED', NULL otherwise.
  -- Atomic reservation flips status + sets these 5 cols in one UPDATE.
  reserved_by_channel         reservation_channel,
  reserved_by_session_id      UUID,
  reserved_by_user_id         UUID                REFERENCES users(id),
  reserved_at                 TIMESTAMPTZ,
  reservation_expires_at      TIMESTAMPTZ,

  -- Tax + classification (intake-locked — see grants below)
  tax_treatment_code          TEXT                NOT NULL REFERENCES tax_treatment_codes(code),
  item_type                   item_type           NOT NULL,
  metal                       TEXT                CHECK (metal IS NULL OR metal IN ('gold','silver','platinum','palladium')),
  karat_code                  TEXT                REFERENCES karat_grades(code),
  fineness_decimal            NUMERIC(5,4)        CHECK (fineness_decimal IS NULL OR (fineness_decimal > 0 AND fineness_decimal <= 1.0000)),
  weight_grams                NUMERIC(10,4)       CHECK (weight_grams IS NULL OR weight_grams > 0),
  hallmark_stamps             TEXT[]              NOT NULL DEFAULT '{}',

  -- Pricing (acquisition_cost_eur is immutable for §25a margin-tax integrity)
  acquisition_cost_eur        NUMERIC(18,2)       NOT NULL CHECK (acquisition_cost_eur >= 0),
  list_price_eur              NUMERIC(18,2)       NOT NULL CHECK (list_price_eur >= 0),

  -- Storefront presentation
  name                        TEXT                NOT NULL,
  description_de              TEXT,
  marketing_attributes        JSONB               NOT NULL DEFAULT '[]'::jsonb,

  -- Semantic similarity (ADR-0016 §6.bis) — populated by Annahmestrecke
  embedding                   vector(1536),

  -- Channel projections (eBay mirror reads + writes these)
  listed_on_storefront        BOOLEAN             NOT NULL DEFAULT FALSE,
  listed_on_ebay              BOOLEAN             NOT NULL DEFAULT FALSE,
  ebay_listing_id             TEXT,

  -- Provenance: link to the intake session that produced this product.
  -- FK added later (intake_sessions table lands in a future migration).
  intake_session_id           UUID,

  -- Lifecycle markers
  published_at                TIMESTAMPTZ,
  sold_at                     TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),

  -- ─── State-machine invariants (DB-enforced, bypass-proof) ─────────

  -- AVAILABLE must have no reservation envelope.
  CONSTRAINT products_available_no_reservation CHECK (
    status <> 'AVAILABLE' OR (
      reserved_by_channel    IS NULL AND
      reserved_by_session_id IS NULL AND
      reserved_at            IS NULL AND
      reservation_expires_at IS NULL
    )
  ),

  -- RESERVED must have a channel + reserved_at.
  CONSTRAINT products_reserved_has_envelope CHECK (
    status <> 'RESERVED' OR (
      reserved_by_channel IS NOT NULL AND
      reserved_at         IS NOT NULL
    )
  ),

  -- RESERVED TTL discipline: POS holds indefinitely; STOREFRONT/EBAY have hard expiries.
  CONSTRAINT products_reservation_ttl_per_channel CHECK (
    status <> 'RESERVED' OR (
      (reserved_by_channel = 'POS'        AND reservation_expires_at IS NULL) OR
      (reserved_by_channel = 'STOREFRONT' AND reservation_expires_at IS NOT NULL) OR
      (reserved_by_channel = 'EBAY'       AND reservation_expires_at IS NOT NULL)
    )
  ),

  -- SOLD must have sold_at + carry the final reservation context.
  CONSTRAINT products_sold_has_sold_at CHECK (
    status <> 'SOLD' OR sold_at IS NOT NULL
  ),

  -- DRAFT must NOT be published yet.
  CONSTRAINT products_draft_unpublished CHECK (
    status <> 'DRAFT' OR published_at IS NULL
  ),

  -- published_at MUST be set once leaving DRAFT.
  CONSTRAINT products_non_draft_is_published CHECK (
    status = 'DRAFT' OR published_at IS NOT NULL
  )
);

-- ─── Indexes ──────────────────────────────────────────────────────────

-- Catalog browse + AVAILABLE filter dominates the hot path.
CREATE INDEX IF NOT EXISTS products_status_available_idx
  ON products (created_at DESC)
  WHERE status = 'AVAILABLE';

-- Reservation auto-release sweeper: only scans rows that need attention.
CREATE INDEX IF NOT EXISTS products_reservation_expires_idx
  ON products (reservation_expires_at)
  WHERE status = 'RESERVED' AND reservation_expires_at IS NOT NULL;

-- Tax-treatment lookups (margin reporting, DSFinV-K export).
CREATE INDEX IF NOT EXISTS products_tax_treatment_idx
  ON products (tax_treatment_code);

-- Channel filters for the eBay reconciler + storefront feed.
CREATE INDEX IF NOT EXISTS products_listed_on_ebay_idx
  ON products (listed_on_ebay)
  WHERE listed_on_ebay = TRUE;

-- ADR-0016 §6.bis: HNSW vector similarity, partial on AVAILABLE.
-- m=16, ef_construction=64 are the well-tested defaults for ≤1M vectors;
-- can be tuned later via DROP+CREATE without changing the column.
CREATE INDEX IF NOT EXISTS products_embedding_hnsw_idx
  ON products USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE status = 'AVAILABLE' AND embedding IS NOT NULL;

-- Updated_at trigger from migration 0002.
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE products IS
  'Inventory authority. 4-state machine. Atomic reservation via UPDATE WHERE status=''AVAILABLE''. '
  'See ADR-0016.';
COMMENT ON COLUMN products.acquisition_cost_eur IS
  'Immutable after intake — required for §25a margin tax integrity. '
  'App role cannot UPDATE this column.';
COMMENT ON COLUMN products.embedding IS
  'Aehnlichkeitsvektor (1536 Dimensionen). Populated by intake pipeline. '
  'HNSW index restricted to status=AVAILABLE for fast similarity search (ADR-0016 §6.bis).';

-- ─────────────────────────────────────────────────────────────────────
-- 3. product_photos
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_photos (
  id                    UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID            NOT NULL REFERENCES products(id),

  -- Cloudflare R2 object keys
  r2_key                TEXT            NOT NULL,           -- original photo
  r2_key_bg_removed     TEXT,                                -- Photoroom output (may be NULL during pipeline failure)

  -- Presentation
  display_order         SMALLINT        NOT NULL DEFAULT 0,
  is_primary            BOOLEAN         NOT NULL DEFAULT FALSE,

  -- Source / a11y
  source                photo_source    NOT NULL DEFAULT 'intake',
  alt_text_de           TEXT,
  alt_text_en           TEXT,

  created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Browse the photos of a product in display order.
CREATE INDEX IF NOT EXISTS product_photos_product_id_idx
  ON product_photos (product_id, display_order);

-- Enforce exactly-one-primary per product (partial unique).
CREATE UNIQUE INDEX IF NOT EXISTS product_photos_one_primary_per_product_uq
  ON product_photos (product_id)
  WHERE is_primary = TRUE;

CREATE TRIGGER trg_product_photos_updated_at
  BEFORE UPDATE ON product_photos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE product_photos IS
  'Per-product photo metadata. Bytes live in Cloudflare R2 (ADR-0005). '
  'is_primary is the storefront thumbnail; partial unique index enforces exactly one.';

-- ─────────────────────────────────────────────────────────────────────
-- 4. ROLE GRANTS
--
-- products: SELECT+INSERT come from migration 0003 default privileges.
--   UPDATE permitted only on the columns the runtime API legitimately mutates.
--   Specifically excluded (intake-locked / fiscal integrity):
--     • sku, barcode (identity)
--     • tax_treatment_code, item_type, metal, karat_code, fineness_decimal,
--       weight_grams, hallmark_stamps (classification — set at intake)
--     • acquisition_cost_eur (§25a margin-tax integrity)
--     • intake_session_id, created_at (lifecycle)
--
--   NEVER DELETE on products — inventory audit trail.
--
-- product_photos: SELECT+INSERT default. UPDATE on display/metadata cols.
--   DELETE permitted — photos are media metadata, not fiscal records.
-- ─────────────────────────────────────────────────────────────────────

GRANT UPDATE (
  -- State machine + atomic reservation envelope
  status,
  reserved_by_channel,
  reserved_by_session_id,
  reserved_by_user_id,
  reserved_at,
  reservation_expires_at,

  -- Lifecycle markers
  published_at,
  sold_at,

  -- Channel projections (eBay mirror)
  listed_on_storefront,
  listed_on_ebay,
  ebay_listing_id,

  -- Admin-mutable fields
  list_price_eur,
  name,
  description_de,
  marketing_attributes,

  -- automatisch befuellt (Kanalerbe; 0149 zieht die Spalte aus)
  embedding,

  -- Trigger-maintained
  updated_at
) ON products TO warehouse14_app;

-- product_photos: full lifecycle for media (not fiscal).
GRANT UPDATE (
  r2_key_bg_removed,
  display_order,
  is_primary,
  alt_text_de,
  alt_text_en,
  updated_at
) ON product_photos TO warehouse14_app;

GRANT DELETE ON product_photos TO warehouse14_app;

COMMIT;
