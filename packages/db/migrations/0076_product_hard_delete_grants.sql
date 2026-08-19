-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0076 — DELETE grants for the guarded product hard-delete route
--
-- Ground truth (wave-5 live QA): DELETE /api/products/:id returned a 500 for a
-- never-transacted DRAFT. The route (apps/api-cloud/src/routes/products.ts)
-- deletes the owned child rows and then the product row inside one transaction,
-- as the runtime role `warehouse14_app`. But that role was NEVER granted DELETE
-- on two of those tables:
--
--   • products                     — migration 0006 deliberately withheld it
--                                     ("NEVER DELETE on products — inventory
--                                     audit trail") back when no delete route
--                                     existed.
--   • product_ebay_listing_events  — migration 0022 granted only INSERT+SELECT
--                                     (an append-only listing log).
--
-- So the very first child delete the route runs —
--   DELETE FROM product_ebay_listing_events WHERE product_id = $1
-- — aborts with SQLSTATE 42501 ("permission denied for table
-- product_ebay_listing_events"). 42501 is NOT a foreign-key violation (23503),
-- so the route's catch-all FK→409 guard does not catch it and it escapes as a
-- raw 500. (The product row delete would fail the same way one step later.)
--
-- The delete route is a deliberate, narrowly-guarded capability, NOT a hole in
-- the inventory audit trail:
--   • Owner-only + step-up (same bar as archive), writes a `product.deleted`
--     audit_log row inside the same transaction.
--   • Refuses SOLD / archived / RESERVED rows and live eBay listings (409).
--   • Refuses anything a transaction_item or appointment link references (409).
--   • Every OTHER table that points at products (appraisal_items, cart_items,
--     document_attachments, intake_sessions, inventory_scans,
--     product_viewing_holds, the konvolut parent self-FK, …) carries an
--     ON DELETE NO ACTION foreign key, so a stray reference physically rolls
--     the whole transaction back as 23503 → the route maps THAT to a calm
--     German 409. Fiscal history therefore stays undeletable by construction;
--     only a never-transacted draft can actually be removed.
--
-- This migration grants exactly the two missing table-level DELETE privileges
-- so the guarded route can complete. No other role is touched; no schema
-- changes. (product_categories and product_photos already carry DELETE for the
-- app role from migrations 0006 / 0053, which is why those child deletes never
-- threw.)
--
-- Idempotent: GRANT is a no-op if the privilege already exists. The DO block on
-- the worker is omitted — the worker neither has nor needs product deletes.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- The inventory row itself. FKs from fiscal tables (transaction_items et al.)
-- are NO ACTION, so this grant cannot be abused to erase fiscal history — such
-- a delete still aborts with 23503 and surfaces as a German 409.
GRANT DELETE ON products TO warehouse14_app;

-- The append-only eBay listing-event log. The route clears a draft's own
-- listing-event rows before removing the product (no ON DELETE CASCADE on this
-- FK). INSERT+SELECT were granted in 0022; DELETE was the missing piece.
GRANT DELETE ON product_ebay_listing_events TO warehouse14_app;

COMMIT;
