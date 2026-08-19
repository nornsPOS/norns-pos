-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0022 — Photo workflow + eBay listing state machine (Day 24)
--
-- The Owner: "Das ist bei euch kein Nebenthema, sondern Kernprozess."
--
-- Two state machines, each with its own append-only event log; a single
-- cross-system trigger guarantees a product sold on eBay cannot also be
-- sold over the counter.
--
-- What lands:
--   (A) photo_workflow_state enum (5 states)
--       + product_photos extensions: nullable product_id, workflow_state,
--         workflow_changed_at, workflow_changed_by_user_id
--       + 2 CHECK constraints enforcing state-machine invariants
--       + reshape of "one primary per product" UNIQUE to skip orphans
--       + product_photo_workflow_events append-only log
--       + photo_source enum gains 'photographer' + 'phone_intake'
--   (B) ebay_listing_state enum (9 states)
--       + products.ebay_state + ebay_state_changed_at
--       + partial index on (ebay_state) WHERE active
--       + product_ebay_listing_events append-only log
--   (C) Trigger enforce_ebay_sold_reserves_locally — when ebay_state flips
--       into (VERKAUFT|BEZAHLT|VERPACKT|VERSENDET):
--         · AVAILABLE        → auto-promote to RESERVED via EBAY channel
--         · RESERVED by EBAY → no-op
--         · RESERVED by POS / STOREFRONT → emit alert.ebay_sale_conflict
--         · SOLD             → emit alert.ebay_double_sale_attempt
--
-- See memory.md decision #70 for the long-form rationale.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. photo_workflow_state enum
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'photo_workflow_state') THEN
    CREATE TYPE photo_workflow_state AS ENUM (
      'FOTOGRAFIERT',       -- raw shot uploaded to R2
      'BEARBEITET',         -- edited (Lightroom / color-corrected)
      'FREIGESTELLT',       -- background removed (r2_key_bg_removed populated)
      'ZUGEORDNET',         -- assigned to a product (product_id populated)
      'FUER_EBAY_BEREIT'    -- final QA, ready for eBay listing
    );
    COMMENT ON TYPE photo_workflow_state IS
      'Owner-defined 5-stage photo lifecycle. NEVER skip a state; the route '
      'layer is the gatekeeper for transitions.';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. photo_source enum — extend with two new sources (idempotent)
-- ═════════════════════════════════════════════════════════════════════════
--
-- ALTER TYPE … ADD VALUE only works outside a transaction; we
-- conditionally add via DO block + pg_enum lookup so re-running the
-- migration is safe. The COMMIT below excludes these from the txn.
-- We work around by issuing the ALTER TYPE in a sub-transaction-safe
-- block using DO blocks (ADD VALUE IF NOT EXISTS).

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'photo_source' AND e.enumlabel = 'photographer'
  ) THEN
    ALTER TYPE photo_source ADD VALUE 'photographer';
  END IF;
END$$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'photo_source' AND e.enumlabel = 'phone_intake'
  ) THEN
    ALTER TYPE photo_source ADD VALUE 'phone_intake';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. product_photos — nullable product_id + workflow tracking columns
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE product_photos
  ALTER COLUMN product_id DROP NOT NULL;

ALTER TABLE product_photos
  ADD COLUMN IF NOT EXISTS workflow_state photo_workflow_state
    NOT NULL DEFAULT 'FOTOGRAFIERT';

ALTER TABLE product_photos
  ADD COLUMN IF NOT EXISTS workflow_changed_at TIMESTAMPTZ
    NOT NULL DEFAULT now();

ALTER TABLE product_photos
  ADD COLUMN IF NOT EXISTS workflow_changed_by_user_id UUID
    REFERENCES users(id);

-- CHECK: ZUGEORDNET / FUER_EBAY_BEREIT require an assigned product.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_photos_assigned_state_has_product'
  ) THEN
    ALTER TABLE product_photos
      ADD CONSTRAINT product_photos_assigned_state_has_product
      CHECK (
        workflow_state NOT IN ('ZUGEORDNET', 'FUER_EBAY_BEREIT')
        OR product_id IS NOT NULL
      );
  END IF;
END$$;

-- CHECK: FREIGESTELLT / ZUGEORDNET / FUER_EBAY_BEREIT require the
-- background-removed R2 key to be populated.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_photos_bg_removed_state_has_key'
  ) THEN
    ALTER TABLE product_photos
      ADD CONSTRAINT product_photos_bg_removed_state_has_key
      CHECK (
        workflow_state NOT IN ('FREIGESTELLT', 'ZUGEORDNET', 'FUER_EBAY_BEREIT')
        OR r2_key_bg_removed IS NOT NULL
      );
  END IF;
END$$;

-- The one-primary-per-product partial UNIQUE survives but is now scoped to
-- assigned photos only. Orphans (product_id IS NULL) cannot be is_primary.
-- We have to drop + recreate because the WHERE clause changes.
DROP INDEX IF EXISTS product_photos_one_primary_per_product_uq;
CREATE UNIQUE INDEX product_photos_one_primary_per_product_uq
  ON product_photos (product_id)
  WHERE is_primary = TRUE AND product_id IS NOT NULL;

-- CHECK: orphan photos cannot claim is_primary (defence in depth).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'product_photos_orphan_not_primary'
  ) THEN
    ALTER TABLE product_photos
      ADD CONSTRAINT product_photos_orphan_not_primary
      CHECK (product_id IS NOT NULL OR is_primary = FALSE);
  END IF;
END$$;

-- Hot-path indexes for the photo-workflow surface.
CREATE INDEX IF NOT EXISTS product_photos_workflow_state_idx
  ON product_photos (workflow_state, workflow_changed_at DESC);

CREATE INDEX IF NOT EXISTS product_photos_unassigned_idx
  ON product_photos (workflow_state, created_at DESC)
  WHERE product_id IS NULL;

COMMENT ON COLUMN product_photos.product_id IS
  'Nullable until workflow_state >= ZUGEORDNET. Enforced by '
  'product_photos_assigned_state_has_product CHECK.';
COMMENT ON COLUMN product_photos.workflow_state IS
  '5-stage Owner-defined lifecycle. Transitions audited via '
  'product_photo_workflow_events. Never written directly outside the '
  'workflow-state route.';

-- ═════════════════════════════════════════════════════════════════════════
-- 4. product_photo_workflow_events — append-only forensic trail
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_photo_workflow_events (
  id                  BIGSERIAL              PRIMARY KEY,
  product_photo_id    UUID                   NOT NULL REFERENCES product_photos(id),
  from_state          photo_workflow_state,                 -- NULL for initial INSERT
  to_state            photo_workflow_state   NOT NULL,
  changed_by_user_id  UUID                   NOT NULL REFERENCES users(id),
  notes               TEXT,
  created_at          TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT photo_workflow_events_state_change
    CHECK (from_state IS NULL OR from_state <> to_state)
);

CREATE INDEX IF NOT EXISTS photo_workflow_events_photo_idx
  ON product_photo_workflow_events (product_photo_id, created_at DESC);

COMMENT ON TABLE product_photo_workflow_events IS
  'Append-only audit trail of every product_photos.workflow_state transition. '
  'NEVER DELETE. The forensic surface for Owner reviews.';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. ebay_listing_state enum + products extensions
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ebay_listing_state') THEN
    CREATE TYPE ebay_listing_state AS ENUM (
      'ENTWURF',       -- draft
      'GEPRUEFT',      -- reviewed / approved by Owner
      'ONLINE',        -- live on eBay
      'VERKAUFT',      -- buyer committed
      'BEZAHLT',       -- payment confirmed
      'VERPACKT',      -- packed
      'VERSENDET',     -- shipped
      'REKLAMIERT',    -- buyer complaint / dispute
      'RETOURNIERT'    -- returned
    );
    COMMENT ON TYPE ebay_listing_state IS
      'Owner-defined 9-stage eBay listing lifecycle. Transitions audited via '
      'product_ebay_listing_events. State VERKAUFT and beyond auto-reserves '
      'the local product via enforce_ebay_sold_reserves_locally trigger.';
  END IF;
END$$;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ebay_state ebay_listing_state;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ebay_state_changed_at TIMESTAMPTZ;

-- Backfill from the legacy boolean — "currently on eBay" maps to ONLINE.
UPDATE products
   SET ebay_state = 'ONLINE',
       ebay_state_changed_at = COALESCE(updated_at, created_at)
 WHERE listed_on_ebay = TRUE
   AND ebay_state IS NULL;

CREATE INDEX IF NOT EXISTS products_ebay_state_active_idx
  ON products (ebay_state, ebay_state_changed_at DESC)
  WHERE ebay_state IS NOT NULL AND archived_at IS NULL;

COMMENT ON COLUMN products.ebay_state IS
  'Realized eBay listing state (9 stages). The legacy `listed_on_ebay` '
  'boolean is the operator intent flag and is left alone in V1 — Phase 1.5 '
  'item I-19 will fold it into a GENERATED column derived from ebay_state.';
COMMENT ON COLUMN products.ebay_state_changed_at IS
  'When ebay_state last changed. Updated by the trigger that records the '
  'transition event row.';

-- ═════════════════════════════════════════════════════════════════════════
-- 6. product_ebay_listing_events — append-only forensic trail
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_ebay_listing_events (
  id                   BIGSERIAL            PRIMARY KEY,
  product_id           UUID                 NOT NULL REFERENCES products(id),
  from_state           ebay_listing_state,                   -- NULL for first listing
  to_state             ebay_listing_state   NOT NULL,
  changed_by_user_id   UUID                 REFERENCES users(id),
  changed_by_source    TEXT                 NOT NULL,
  ebay_order_id        TEXT,
  notes                TEXT,
  payload              JSONB                NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ          NOT NULL DEFAULT now(),

  CONSTRAINT ebay_events_state_change
    CHECK (from_state IS NULL OR from_state <> to_state),
  CONSTRAINT ebay_events_known_source
    CHECK (changed_by_source IN ('OWNER','EBAY_WEBHOOK','WORKER','SYSTEM')),
  CONSTRAINT ebay_events_owner_has_user
    CHECK (changed_by_source <> 'OWNER' OR changed_by_user_id IS NOT NULL),
  CONSTRAINT ebay_events_payload_object
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS ebay_events_product_idx
  ON product_ebay_listing_events (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ebay_events_order_idx
  ON product_ebay_listing_events (ebay_order_id)
  WHERE ebay_order_id IS NOT NULL;

COMMENT ON TABLE product_ebay_listing_events IS
  'Append-only audit trail of every products.ebay_state transition. '
  'NEVER DELETE. Source distinguishes OWNER manual flips from EBAY_WEBHOOK '
  'pushes (Phase 1.5) and WORKER reconciler updates (#36).';

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Cross-system trigger — eBay sold ⇒ local RESERVED
-- ═════════════════════════════════════════════════════════════════════════
--
-- BEFORE UPDATE on products. Fires when ebay_state transitions INTO the
-- "buyer-committed" half of the state machine. Idempotent: a re-tick on
-- an already-RESERVED-by-EBAY product is a no-op.

CREATE OR REPLACE FUNCTION enforce_ebay_sold_reserves_locally()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, pg_temp
AS $$
DECLARE
  v_sold_states ebay_listing_state[] := ARRAY[
    'VERKAUFT', 'BEZAHLT', 'VERPACKT', 'VERSENDET'
  ]::ebay_listing_state[];
  v_entering_sold BOOLEAN;
BEGIN
  -- Only act when the state actually moved into the sold-cluster.
  v_entering_sold :=
       NEW.ebay_state IS NOT NULL
   AND NEW.ebay_state = ANY(v_sold_states)
   AND (OLD.ebay_state IS NULL OR OLD.ebay_state <> NEW.ebay_state);

  IF NOT v_entering_sold THEN
    -- Still update timestamp if ebay_state changed at all (e.g. ENTWURF→GEPRUEFT).
    IF NEW.ebay_state IS DISTINCT FROM OLD.ebay_state THEN
      NEW.ebay_state_changed_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- Stamp the transition time.
  NEW.ebay_state_changed_at := now();

  -- Case 1: locally AVAILABLE → auto-reserve via EBAY channel.
  IF NEW.status = 'AVAILABLE' THEN
    NEW.status                  := 'RESERVED';
    NEW.reserved_by_channel     := 'EBAY';
    NEW.reserved_at             := now();
    NEW.reservation_expires_at  := now() + interval '7 days';
    -- POS/STOREFRONT reservation envelope fields stay NULL — this is an EBAY hold.
    RETURN NEW;
  END IF;

  -- Case 2: already RESERVED by EBAY → no-op (idempotent re-tick).
  IF NEW.status = 'RESERVED' AND NEW.reserved_by_channel = 'EBAY' THEN
    RETURN NEW;
  END IF;

  -- Case 3: RESERVED by POS or STOREFRONT → local cashier wins, but record alert.
  IF NEW.status = 'RESERVED' AND NEW.reserved_by_channel IN ('POS', 'STOREFRONT') THEN
    INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
    VALUES (
      'alert.ebay_sale_conflict',
      'products',
      NEW.id,
      jsonb_build_object(
        'productId',                NEW.id,
        'localReservationChannel',  NEW.reserved_by_channel,
        'localReservedAt',          NEW.reserved_at,
        'newEbayState',             NEW.ebay_state,
        'priorEbayState',           OLD.ebay_state
      )
    );
    RETURN NEW;
  END IF;

  -- Case 4: locally SOLD → record alert; do not mutate.
  IF NEW.status = 'SOLD' THEN
    INSERT INTO ledger_events (event_type, entity_table, entity_id, payload)
    VALUES (
      'alert.ebay_double_sale_attempt',
      'products',
      NEW.id,
      jsonb_build_object(
        'productId',      NEW.id,
        'localSoldAt',    NEW.sold_at,
        'newEbayState',   NEW.ebay_state,
        'priorEbayState', OLD.ebay_state
      )
    );
    RETURN NEW;
  END IF;

  -- DRAFT or unknown — leave alone.
  RETURN NEW;
END;
$$;

ALTER FUNCTION enforce_ebay_sold_reserves_locally() OWNER TO warehouse14_security;
REVOKE EXECUTE ON FUNCTION enforce_ebay_sold_reserves_locally() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_ebay_sold_reserves_locally_trg ON products;
CREATE TRIGGER enforce_ebay_sold_reserves_locally_trg
  BEFORE UPDATE OF ebay_state ON products
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ebay_sold_reserves_locally();

COMMENT ON FUNCTION enforce_ebay_sold_reserves_locally() IS
  'BEFORE UPDATE OF ebay_state trigger. When the state enters the '
  '"buyer-committed" cluster (VERKAUFT/BEZAHLT/VERPACKT/VERSENDET), '
  'auto-RESERVE the local product via EBAY channel (if AVAILABLE) or '
  'emit a ledger alert (if locally claimed). Idempotent. SECURITY DEFINER '
  'owned by warehouse14_security so the app role cannot DROP it.';

-- ═════════════════════════════════════════════════════════════════════════
-- 8. Role grants
-- ═════════════════════════════════════════════════════════════════════════

/* product_photo_workflow_events:
   App + worker need INSERT to log transitions; no UPDATE/DELETE. */
GRANT INSERT, SELECT ON product_photo_workflow_events TO warehouse14_app;
GRANT INSERT, SELECT ON product_photo_workflow_events TO warehouse14_worker;
GRANT USAGE ON SEQUENCE product_photo_workflow_events_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE product_photo_workflow_events_id_seq TO warehouse14_worker;

/* product_ebay_listing_events: same default-deny + INSERT/SELECT only. */
GRANT INSERT, SELECT ON product_ebay_listing_events TO warehouse14_app;
GRANT INSERT, SELECT ON product_ebay_listing_events TO warehouse14_worker;
GRANT USAGE ON SEQUENCE product_ebay_listing_events_id_seq TO warehouse14_app;
GRANT USAGE ON SEQUENCE product_ebay_listing_events_id_seq TO warehouse14_worker;

/* product_photos: app needs UPDATE on the new workflow columns.
   Existing SELECT/INSERT come from migration 0003 default privileges. */
GRANT UPDATE (
  workflow_state, workflow_changed_at, workflow_changed_by_user_id,
  product_id, r2_key_bg_removed, alt_text_de, alt_text_en,
  display_order, is_primary
) ON product_photos TO warehouse14_app;

/* products: extend the column-level UPDATE grant with ebay_state +
   ebay_state_changed_at. The status / reservation columns stay locked
   to the inventory-lock package (its grants land in migration 0006/0013). */
GRANT UPDATE (ebay_state, ebay_state_changed_at) ON products TO warehouse14_app;
/* Worker also needs to flip ebay_state during the future reconciler. */
GRANT UPDATE (ebay_state, ebay_state_changed_at) ON products TO warehouse14_worker;

COMMIT;
