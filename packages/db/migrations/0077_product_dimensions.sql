-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0077 — product packing dimensions (cm)
--
-- The owner measures a product's approximate outer dimensions (length / width /
-- height, in centimetres) so the system can derive a packing SIZE CLASS
-- (S / M / L / XL) to standardise carton selection for packing + shipping.
--
-- The size class itself is NOT stored — it is derived on read from these three
-- columns via @warehouse14/domain `deriveSizeClass`, so the classification rule
-- lives in exactly one place and never goes stale in the database.
--
-- All three are nullable: dimensions are optional, set only when measured.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS length_cm numeric(7, 1),
  ADD COLUMN IF NOT EXISTS width_cm  numeric(7, 1),
  ADD COLUMN IF NOT EXISTS height_cm numeric(7, 1);

-- A measured dimension, when present, must be positive (matches the
-- products_weight_positive discipline from migration 0006).
ALTER TABLE products
  ADD CONSTRAINT products_length_cm_positive CHECK (length_cm IS NULL OR length_cm > 0),
  ADD CONSTRAINT products_width_cm_positive  CHECK (width_cm  IS NULL OR width_cm  > 0),
  ADD CONSTRAINT products_height_cm_positive CHECK (height_cm IS NULL OR height_cm > 0);

-- The runtime app role already holds UPDATE on products (migration 0006), so the
-- new columns are writable by the create/update routes without an extra grant.
