-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0015 — Product Management (Day 16)
--
-- Closes four gaps in migration 0006 that became visible once Basel made
-- the call to operate the inventory primarily from the Control Desktop
-- (manual entry by Owner) rather than 100% via the automatische Annahmestrecke:
--
--   1. `condition` (Zustand)            — physical condition enum.
--   2. `is_commission` (Kommissionsware) — consignment-goods flag with a
--      DIFFERENT tax treatment than shop-owned stock; intake-locked.
--   3. `acquired_from_customer_id`      — link the product to the seller
--      we bought it from (Ankauf provenance). Intake-locked — fiscal record.
--   4. `archived_at`                    — archive sold products from the
--      active inventory view. Only SOLD products may be archived.
--
-- Bypass-proof discipline (ADR-0008 §10, ADR-0022 §3):
--   • `is_commission` and `acquired_from_customer_id` are intake-locked —
--     the app role CANNOT UPDATE them after the initial INSERT. The CHECK
--     on `is_commission` against tax_treatment_code is policy-light (V1):
--     we DON'T refuse arbitrary combinations because the operator may have
--     legitimate edge cases. Tax classifier (ADR-0015 §7) keeps the
--     primary discipline.
--   • `archived_at` CHECK refuses archiving any product not in SOLD state,
--     defending against accidental archiving of active inventory.
--
-- Idempotent: every ALTER guarded by DO/EXISTS or IF NOT EXISTS.
-- Transactional: BEGIN/COMMIT.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. condition (Zustand) enum — 6 values, matching ADR-0023 §2.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_condition') THEN
    CREATE TYPE product_condition AS ENUM (
      'NEW',                  -- factory-new (refinery gold bars, sealed coins, new watches)
      'USED_EXCELLENT',       -- like-new, no visible wear
      'USED_GOOD',            -- minor wear, fully functional
      'USED_FAIR',            -- visible wear, may need service
      'ANTIQUE_RESTORED',     -- antique that was professionally restored
      'ANTIQUE_AS_FOUND'      -- antique in original condition
    );
    COMMENT ON TYPE product_condition IS
      'Physical condition. 6 values cover gold + coin + antique + watch grading. ADR-0023.';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Add the 4 new columns to products
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS condition product_condition NOT NULL DEFAULT 'USED_GOOD';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_commission BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS acquired_from_customer_id UUID REFERENCES customers(id);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN products.condition IS
  'Physical condition (Zustand). Defaults to USED_GOOD to match historical jewelry inventory.';
COMMENT ON COLUMN products.is_commission IS
  'TRUE = Kommissionsware (consignment goods owned by a third party we sell on behalf of). '
  'Drives a DIFFERENT tax treatment than shop-owned stock — see ADR-0015 §7. Intake-locked.';
COMMENT ON COLUMN products.acquired_from_customer_id IS
  'For Ankauf items: which customer we bought this product from. Intake-locked '
  '(immutable after creation) for §259 StGB Hehlerei evidence + GoBD provenance trail.';
COMMENT ON COLUMN products.archived_at IS
  'Hides sold products from the active-inventory view. Only SOLD products may be archived. '
  'Set NULL = active row; set to a timestamp = archived. CHECK enforces SOLD precondition.';

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Defensive CHECK constraints
-- ═════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'products_archived_only_when_sold'
       AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_archived_only_when_sold
      CHECK (archived_at IS NULL OR status = 'SOLD');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'products_archived_after_sold_at'
       AND conrelid = 'products'::regclass
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_archived_after_sold_at
      CHECK (
        archived_at IS NULL
        OR (sold_at IS NOT NULL AND archived_at >= sold_at)
      );
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Indexes for the new columns
-- ═════════════════════════════════════════════════════════════════════════

-- "Products we bought from this customer" — Ankauf history per customer.
CREATE INDEX IF NOT EXISTS products_acquired_from_customer_idx
  ON products (acquired_from_customer_id)
  WHERE acquired_from_customer_id IS NOT NULL;

-- Active inventory view (the default Control Desktop list).
CREATE INDEX IF NOT EXISTS products_active_idx
  ON products (created_at DESC)
  WHERE archived_at IS NULL;

-- Archived view — analytics + Steuerberater historical queries.
CREATE INDEX IF NOT EXISTS products_archived_idx
  ON products (archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- Commission-goods view — separate tax handling.
CREATE INDEX IF NOT EXISTS products_commission_active_idx
  ON products (status, created_at DESC)
  WHERE is_commission = TRUE AND archived_at IS NULL;

-- Condition filter for storefront ("show NEW only" etc.).
CREATE INDEX IF NOT EXISTS products_condition_available_idx
  ON products (condition, created_at DESC)
  WHERE status = 'AVAILABLE' AND archived_at IS NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. App-role grants — narrow, intake-locked discipline preserved
-- ═════════════════════════════════════════════════════════════════════════

-- The app role can UPDATE:
--   • condition   — Owner can re-grade (e.g. after restoration)
--   • archived_at — Owner can archive SOLD products
-- The app role CANNOT UPDATE:
--   • is_commission              — set at creation, never changed (fiscal integrity)
--   • acquired_from_customer_id  — set at creation, never changed (provenance trail)
GRANT UPDATE (condition, archived_at) ON products TO warehouse14_app;

-- Belt-and-braces: explicit REVOKE on the intake-locked fields.
-- (They were never granted via the migration-0006 column list, but the
-- post-condition is what the security audit checks.)
REVOKE UPDATE (is_commission) ON products FROM warehouse14_app;
REVOKE UPDATE (acquired_from_customer_id) ON products FROM warehouse14_app;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Audit-log event types — documentation only
--
-- Day 16 product routes emit these event types into audit_log:
--   product.created        — POST /api/products
--   product.updated        — PUT  /api/products/:id (with diff in payload)
--   product.archived       — POST /api/products/:id/archive
--   product.photo_requested — POST /api/products/:id/photos (R2 presigned URL issued)
-- ═════════════════════════════════════════════════════════════════════════

COMMIT;
