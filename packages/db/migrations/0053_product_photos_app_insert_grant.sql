-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0053 — ensure warehouse14_app can INSERT product photos.
--
-- The server-side photo store (apps/api-cloud/src/routes/photo-direct-upload.ts,
-- added in 0052) INSERTs a `product_photos` row on every upload. An earlier
-- grant (0006) gave the app SELECT/UPDATE/DELETE but NOT INSERT, so uploads
-- failed at runtime with `permission denied for table product_photos` (42501).
-- Grant the full owner-data right set explicitly. RLS still scopes rows.
--
-- Append-only + idempotent: GRANT is a no-op if already held.
-- ──────────────────────────────────────────────────────────────────────────

GRANT INSERT, SELECT, UPDATE, DELETE ON TABLE product_photos TO warehouse14_app;
