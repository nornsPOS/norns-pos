-- ═════════════════════════════════════════════════════════════════════════
-- 0072 — Products: index for the stale-POS-hold reclaim sweep
-- ═════════════════════════════════════════════════════════════════════════
--
-- POS reservations are intentionally TTL-less: `products_reservation_ttl_per_channel`
-- (0067-era) permits `reservation_expires_at = NULL` for the POS channel, and the
-- reservation_sweeper job explicitly leaves them alone (the cashier owns them).
-- That means a POS hold whose release never reached the server (Tauri window
-- SIGKILL / power loss before the `beforeunload` beacon flushed) leaks FOREVER —
-- nothing reclaims it, and the product is silently unsellable.
--
-- P1.4 adds a bounded stale-POS-hold sweep (worker job pos_reservation_sweeper →
-- inventory-lock autoReleaseStalePos) keyed on `reserved_at` age — a conservative
-- window (≫ a shift) so a parked cart is never yanked mid-sale. This index backs
-- that sweep's WHERE clause. The TTL-per-channel CHECK is untouched: we reclaim
-- by `reserved_at` age, not by setting an expiry.
--
-- Idempotent, append-only, no grant change (it is an index).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'products_pos_reserved_at_idx'
  ) THEN
    CREATE INDEX products_pos_reserved_at_idx
      ON products (reserved_at)
      WHERE status = 'RESERVED' AND reserved_by_channel = 'POS';
  END IF;
END$$;

COMMENT ON INDEX products_pos_reserved_at_idx IS
  'Backs the stale-POS-hold reclaim sweep (pos_reservation_sweeper / autoReleaseStalePos).';
