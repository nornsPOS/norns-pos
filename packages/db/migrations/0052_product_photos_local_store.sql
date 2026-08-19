-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0052 — server-side local photo store (replaces the empty R2 bucket).
--
-- R2_BUCKET is unset in production and R2 is not a good fit for the shop's
-- handful of product photos, so product-photo BYTES now live on the API
-- server's local disk (PHOTOS_DIR, default /data/photos), aggressively
-- compressed to WebP (main ≤1600px q≈80, thumb ≤400px q≈70) with EXIF stripped.
--
-- The DB still carries ONLY metadata + the storage pointer — never the bytes.
-- We add the columns the local store needs and keep `r2_key` for backward
-- compatibility (legacy rows + the still-supported R2 path). `r2_key` is the
-- canonical "storage key" for a row: for local rows it doubles as the on-disk
-- base name (`<id>`), and `storage_kind` disambiguates how to serve it.
--
--   storage_kind   'r2' (legacy/default) | 'local' (new local-disk store)
--   size_bytes     compressed MAIN webp size — the unit the 20 GiB cap counts
--   thumb_bytes    compressed THUMB webp size (informational)
--   width/height   MAIN image pixel dimensions after resize
--   content_type   always 'image/webp' for the local store
--
-- Append-only + idempotent. Photos are MEDIA, not fiscal records — the app
-- role already holds INSERT/SELECT/UPDATE/DELETE here; we extend the
-- column-scoped UPDATE grant to the new presentation columns.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── New columns (all nullable so legacy R2 rows are untouched) ─────────────
ALTER TABLE product_photos
  ADD COLUMN IF NOT EXISTS storage_kind  TEXT NOT NULL DEFAULT 'r2',
  ADD COLUMN IF NOT EXISTS size_bytes    BIGINT,
  ADD COLUMN IF NOT EXISTS thumb_bytes   BIGINT,
  ADD COLUMN IF NOT EXISTS width         INTEGER,
  ADD COLUMN IF NOT EXISTS height        INTEGER,
  ADD COLUMN IF NOT EXISTS content_type  TEXT;

-- storage_kind is a tiny closed enum; a CHECK keeps it honest without a new type.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_photos_storage_kind_chk'
  ) THEN
    ALTER TABLE product_photos
      ADD CONSTRAINT product_photos_storage_kind_chk
      CHECK (storage_kind IN ('r2', 'local'));
  END IF;
END$$;

-- Sum(size_bytes) drives the live usage gauge + the cap check. A partial index
-- on the local rows keeps that aggregate cheap.
CREATE INDEX IF NOT EXISTS product_photos_local_size_idx
  ON product_photos (storage_kind)
  WHERE storage_kind = 'local';

COMMENT ON COLUMN product_photos.storage_kind IS
  'Where the bytes live: ''local'' = PHOTOS_DIR on the API server (compressed WebP); ''r2'' = legacy Cloudflare R2.';
COMMENT ON COLUMN product_photos.size_bytes IS
  'Compressed MAIN WebP size in bytes — the unit the PHOTO_STORE_MAX_BYTES cap counts.';

-- ─── Extend the column-scoped UPDATE grant ──────────────────────────────────
-- The upload route inserts these, but a future re-compress / re-point may UPDATE
-- them; grant the columns now so the app role is never short a privilege.
GRANT UPDATE (
  storage_kind,
  size_bytes,
  thumb_bytes,
  width,
  height,
  content_type
) ON product_photos TO warehouse14_app;

COMMIT;
