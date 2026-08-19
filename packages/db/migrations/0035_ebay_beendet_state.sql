-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0035 — Epic D: eBay "BEENDET" state + worker reconciler grants
--
-- The `ebay_listing_state` enum had no "listing ended" value. When an item is
-- sold at the retail counter (products.status → SOLD) while its eBay listing
-- is still ONLINE, the `ebay_sync` worker ends the listing and transitions the
-- product to a new terminal state BEENDET (ended/withdrawn — distinct from
-- VERKAUFT, which means sold *on* eBay).
--
-- NOTE: `ALTER TYPE ... ADD VALUE` is intentionally NOT wrapped in BEGIN/COMMIT
-- and does not reference the new value in the same migration — both are
-- requirements for adding an enum value safely.
-- ──────────────────────────────────────────────────────────────────────────

ALTER TYPE ebay_listing_state ADD VALUE IF NOT EXISTS 'BEENDET';

-- The ebay_sync reconciler runs as warehouse14_worker: it reads product state,
-- flips ebay_state, and appends an audit row. (Idempotent grants.)
GRANT SELECT ON products TO warehouse14_worker;
GRANT UPDATE (ebay_state, ebay_state_changed_at) ON products TO warehouse14_worker;
GRANT INSERT, SELECT ON product_ebay_listing_events TO warehouse14_worker;
GRANT USAGE ON SEQUENCE product_ebay_listing_events_id_seq TO warehouse14_worker;
