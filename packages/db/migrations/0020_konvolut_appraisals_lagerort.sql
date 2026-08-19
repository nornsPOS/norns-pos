-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0020 — Konvolut + Appraisals + Lagerort (Day 22)
--
-- Response to Basel's deep audit (2026-05-25): closes three critical
-- commercial gaps for opening to estate (Nachlass) business.
--
-- (A) Konvolut / Hauptposten → Unterartikel
--     products.parent_product_id (self-FK). 1-level depth enforced by
--     trigger; recursive-CTE for deeper trees deferred to Phase 1.5 #I-19.
--
-- (B) Appraisals workflow (Bewertungs-/Expertisen-Modul)
--     appraisal_status enum + appraisals + appraisal_items.
--     Pro-rata cost allocation at ACCEPTED — preserves §25a margin
--     integrity per item across a lump-sum Ankauf.
--
-- (C) Lagerort (storage location)
--     products: location_storage_unit + location_drawer + location_position
--     + location_assigned_at. 3-column model (Basel's choice 2026-05-25)
--     for grouping/filtering during Stichtagsinventur.
--
-- memory.md decision #68 is the long-form rationale.
--
-- Idempotent + transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. products extensions — parent_product_id + Lagerort
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS parent_product_id UUID REFERENCES products(id);

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS location_storage_unit TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS location_drawer TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS location_position TEXT;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS location_assigned_at TIMESTAMPTZ;

COMMENT ON COLUMN products.parent_product_id IS
  'Self-FK for Konvolut/Hauptposten. NULL = standalone item OR top-level lot. '
  'Set = this row is an Unterartikel under the referenced parent. '
  '1-level depth enforced by trg_products_no_deep_nesting (Phase 1.5 may relax to recursive trees).';

COMMENT ON COLUMN products.location_storage_unit IS
  'Top-level physical location: Tresor-1, Lager-A, Vitrine-B. Free-text V1.';
COMMENT ON COLUMN products.location_drawer IS
  'Second-level: Fach-3, Schublade-7. Free-text V1.';
COMMENT ON COLUMN products.location_position IS
  'Third-level micro-position: Position-12. Free-text V1.';

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Trigger: enforce no_grandparent (1-level Konvolut)
-- ═════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION enforce_no_grandparent() RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent_has_parent BOOLEAN;
BEGIN
  IF NEW.parent_product_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_product_id = NEW.id THEN
    RAISE EXCEPTION 'products.parent_product_id cannot point to self (id=%)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  -- Refuse if the referenced parent ALREADY has a parent of its own.
  SELECT (parent_product_id IS NOT NULL)
    INTO parent_has_parent
    FROM products
   WHERE id = NEW.parent_product_id;
  IF parent_has_parent IS TRUE THEN
    RAISE EXCEPTION 'products.parent_product_id depth limit exceeded — V1 allows only 1 level of nesting (Phase 1.5 #I-19)'
      USING ERRCODE = 'check_violation';
  END IF;
  -- A row that IS a child cannot become a parent.
  IF NEW.parent_product_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM products WHERE parent_product_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'products.parent_product_id: row % already has children — cannot also be a child', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_no_deep_nesting ON products;
CREATE TRIGGER trg_products_no_deep_nesting
  BEFORE INSERT OR UPDATE OF parent_product_id ON products
  FOR EACH ROW EXECUTE FUNCTION enforce_no_grandparent();

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Indexes for Konvolut + Lagerort
-- ═════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS products_parent_idx
  ON products (parent_product_id)
  WHERE parent_product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_location_idx
  ON products (location_storage_unit, location_drawer)
  WHERE archived_at IS NULL
    AND status IN ('AVAILABLE', 'RESERVED');

-- ═════════════════════════════════════════════════════════════════════════
-- 4. App-role grants for new product columns
-- ═════════════════════════════════════════════════════════════════════════

GRANT UPDATE (
  parent_product_id,
  location_storage_unit, location_drawer, location_position, location_assigned_at
) ON products TO warehouse14_app;
-- Note: parent_product_id at INSERT time is set when the appraisal is
-- ACCEPTED and child products are spawned. UPDATE is permitted for re-parenting
-- corrections by ADMIN; the trigger still enforces the 1-level invariant.

-- ═════════════════════════════════════════════════════════════════════════
-- 5. appraisal_status enum
-- ═════════════════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appraisal_status') THEN
    CREATE TYPE appraisal_status AS ENUM (
      'DRAFT',      -- being filled in
      'COMPLETED',  -- all items appraised + total_offered_eur set; awaiting Owner accept/reject
      'ACCEPTED',   -- Owner accepted; Ankauf transaction + child products created
      'REJECTED',   -- Customer or Owner declined
      'EXPIRED'     -- offer aged out (e.g. 30-day validity)
    );
    COMMENT ON TYPE appraisal_status IS
      'State machine for the estate appraisal (Bewertung) workflow. Day 22.';
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. appraisals — header row
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS appraisals (
  id                            UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id                   UUID               NOT NULL REFERENCES customers(id),
  appraised_by_user_id          UUID               NOT NULL REFERENCES users(id),

  status                        appraisal_status   NOT NULL DEFAULT 'DRAFT',

  /**
   * Σ of appraisal_items.individual_appraised_eur — our internal market estimate.
   * Maintained by app layer (or a Phase 1.5 trigger). Non-negative.
   */
  total_appraised_eur           NUMERIC(18,2)      NOT NULL DEFAULT 0
                                                   CHECK (total_appraised_eur >= 0),

  /**
   * The lump-sum we offer the customer. Set at the COMPLETED transition.
   * NULL while DRAFT. Required at ACCEPTED (CHECK below).
   */
  total_offered_eur             NUMERIC(18,2)
                                                   CHECK (total_offered_eur IS NULL OR total_offered_eur >= 0),

  /**
   * The customer's price expectation (Preisvorstellung) — closes audit gap #7.
   * NULL when not declared.
   */
  customer_expectation_eur      NUMERIC(18,2)
                                                   CHECK (customer_expectation_eur IS NULL OR customer_expectation_eur >= 0),

  /**
   * Once ACCEPTED, the Ankauf transaction this appraisal materialised into.
   * UNIQUE — at most one Ankauf per appraisal.
   */
  ankauf_transaction_id         UUID               UNIQUE REFERENCES transactions(id),

  notes                         TEXT,

  opened_at                     TIMESTAMPTZ        NOT NULL DEFAULT now(),
  completed_at                  TIMESTAMPTZ,
  accepted_at                   TIMESTAMPTZ,
  rejected_at                   TIMESTAMPTZ,
  rejection_reason              TEXT,
  expires_at                    TIMESTAMPTZ,

  created_at                    TIMESTAMPTZ        NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ        NOT NULL DEFAULT now(),

  CONSTRAINT appraisals_completed_has_timestamp CHECK (
    status NOT IN ('COMPLETED', 'ACCEPTED', 'REJECTED') OR completed_at IS NOT NULL
  ),
  CONSTRAINT appraisals_accepted_has_evidence CHECK (
    status <> 'ACCEPTED' OR (
      accepted_at IS NOT NULL AND
      ankauf_transaction_id IS NOT NULL AND
      total_offered_eur IS NOT NULL
    )
  ),
  CONSTRAINT appraisals_rejected_has_timestamp CHECK (
    status <> 'REJECTED' OR rejected_at IS NOT NULL
  ),
  CONSTRAINT appraisals_rejected_has_reason CHECK (
    status <> 'REJECTED' OR rejection_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS appraisals_customer_idx
  ON appraisals (customer_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS appraisals_status_opened_idx
  ON appraisals (status, opened_at DESC);
CREATE INDEX IF NOT EXISTS appraisals_ankauf_tx_idx
  ON appraisals (ankauf_transaction_id) WHERE ankauf_transaction_id IS NOT NULL;

CREATE TRIGGER trg_appraisals_updated_at
  BEFORE UPDATE ON appraisals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE appraisals IS
  'Pre-Ankauf valuation workflow. One row per Nachlass/Konvolut appraisal session. '
  'On ACCEPTED, the route runs pro-rata allocation: each child product gets '
  'acquisition_cost = (item.individual_appraised / Σ items_appraised) × total_offered, '
  'with last child absorbing rounding remainder so Σ children = total_offered exactly. '
  'Never deleted (NO DELETE app grant).';

-- ═════════════════════════════════════════════════════════════════════════
-- 7. appraisal_items — per-piece line in the appraisal
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS appraisal_items (
  id                          UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  appraisal_id                UUID                 NOT NULL REFERENCES appraisals(id),
  sequence_in_lot             INTEGER              NOT NULL DEFAULT 0,

  -- Item identification (mirrors a subset of products columns).
  name                        TEXT                 NOT NULL,
  description                 TEXT,
  item_type                   item_type            NOT NULL,
  metal                       TEXT
                              CHECK (metal IS NULL OR metal IN ('gold','silver','platinum','palladium')),
  karat_code                  TEXT                 REFERENCES karat_grades(code),
  fineness_decimal            NUMERIC(5,4)
                              CHECK (fineness_decimal IS NULL OR (fineness_decimal > 0 AND fineness_decimal <= 1.0000)),
  weight_grams                NUMERIC(10,4)
                              CHECK (weight_grams IS NULL OR weight_grams > 0),
  condition                   product_condition,
  hallmark_stamps             TEXT[]               NOT NULL DEFAULT '{}',

  /**
   * Our internal market estimate of this piece. Used by the pro-rata
   * allocation at ACCEPTED to back-distribute the lump-sum total_offered.
   */
  individual_appraised_eur    NUMERIC(18,2)        NOT NULL CHECK (individual_appraised_eur >= 0),

  /**
   * Pre-Ankauf photos — R2 keys captured during appraisal.
   * On ACCEPTED, copied into product_photos rows under the child product_id.
   */
  photo_r2_keys               TEXT[]               NOT NULL DEFAULT '{}',

  notes                       TEXT,

  /**
   * Set at ACCEPTED when child products are spawned. NULL while DRAFT/COMPLETED.
   */
  product_id                  UUID                 REFERENCES products(id),

  created_at                  TIMESTAMPTZ          NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ          NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appraisal_items_appraisal_idx
  ON appraisal_items (appraisal_id, sequence_in_lot);
CREATE INDEX IF NOT EXISTS appraisal_items_product_idx
  ON appraisal_items (product_id) WHERE product_id IS NOT NULL;

CREATE TRIGGER trg_appraisal_items_updated_at
  BEFORE UPDATE ON appraisal_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE appraisal_items IS
  'Per-piece valuation in an estate appraisal. individual_appraised_eur is the '
  'operator''s market estimate; the per-piece acquisition_cost is derived at '
  'ACCEPTED by pro-rata allocation of appraisals.total_offered_eur.';

-- ═════════════════════════════════════════════════════════════════════════
-- 8. App-role grants for appraisals + appraisal_items
-- ═════════════════════════════════════════════════════════════════════════

GRANT UPDATE (
  status, total_appraised_eur, total_offered_eur, customer_expectation_eur,
  ankauf_transaction_id, notes,
  completed_at, accepted_at, rejected_at, rejection_reason, expires_at,
  updated_at
) ON appraisals TO warehouse14_app;

GRANT UPDATE (
  sequence_in_lot, name, description, item_type, metal, karat_code,
  fineness_decimal, weight_grams, condition, hallmark_stamps,
  individual_appraised_eur, photo_r2_keys, notes,
  product_id,
  updated_at
) ON appraisal_items TO warehouse14_app;

GRANT DELETE ON appraisal_items TO warehouse14_app;
-- DRAFT-only deletion is enforced at the API layer.

-- Worker role: read-only for now (Phase 1.5 might add expiry sweeper).
GRANT SELECT ON appraisals, appraisal_items TO warehouse14_worker;

COMMIT;
