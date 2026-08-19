-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0051 — worker grants for the product-photo auto-purge job.
--
-- Product photos are TEMPORARY media (ADR-0005): the shop keeps them only until
-- the item leaves inventory. The new worker job `product_photo_purge`
-- (apps/worker/src/jobs/product-photo-purge.ts) periodically finds photos whose
-- product is SOLD or ARCHIVED (archived_at IS NOT NULL), plus long-orphaned
-- unassigned photos, deletes the files from PHOTOS_DIR, and DELETEs the rows so
-- server storage stays small.
--
-- The worker role already has SELECT on `products` (migration 0035) and on
-- `product_photos` is granted SELECT here; it needs DELETE on `product_photos`
-- to remove the rows. Photos are media, NOT fiscal records — the photo audit
-- trail is not legally required (the inventory audit trail on `products` is, and
-- is never touched). `warehouse14_app` already holds DELETE on product_photos
-- (migration 0006); this only extends the same right to the daemon role.
--
-- Append-only + idempotent: GRANT is a no-op if already held.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

GRANT SELECT, DELETE ON product_photos TO warehouse14_worker;

COMMIT;
