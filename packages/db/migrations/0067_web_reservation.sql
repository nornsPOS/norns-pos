-- ═════════════════════════════════════════════════════════════════════════
-- 0067 — Web reservation (reserve-and-pickup) channel + cart status
-- ═════════════════════════════════════════════════════════════════════════
--
-- The storefront's first commerce phase is RESERVE-AND-PICKUP: a customer
-- reserves items online and completes the purchase IN THE SHOP via the POS
-- (identity for thresholded gold, payment, and the TSE-signed fiscal receipt all
-- happen at the till). A web reservation is therefore NOT a fiscal sale and never
-- becomes a `transactions` row on its own — it is a staff pickup request that
-- holds the stock.
--
--   • `reservation_channel` gains 'WEB_RESERVATION' — a 3-day soft hold (added to
--     inventory-lock's reserve() CASE). The EXISTING autoReleaseExpired sweeper
--     frees it when it expires (it releases any RESERVED row with a past
--     reservation_expires_at), so no new sweeper is needed.
--   • `cart_status` gains 'RESERVED' — the cart state for a submitted reservation.
--   • `carts.reserved_at` records when the reservation was submitted (staff queue
--     ordering + a future expiry view).
-- ═════════════════════════════════════════════════════════════════════════

-- ADD VALUE is safe inside the migration transaction because we do not USE the
-- new value in this same migration (only the runtime reserve() / route do).
ALTER TYPE reservation_channel ADD VALUE IF NOT EXISTS 'WEB_RESERVATION';
ALTER TYPE cart_status ADD VALUE IF NOT EXISTS 'RESERVED';

ALTER TABLE carts ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ;

-- The app already holds UPDATE(status) on carts (checkout flips ACTIVE→CHECKOUT);
-- grant the new column so the reserve route can stamp it.
GRANT UPDATE (reserved_at) ON carts TO warehouse14_app;
