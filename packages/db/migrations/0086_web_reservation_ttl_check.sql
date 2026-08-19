-- 0086_web_reservation_ttl_check.sql
--
-- Fix the reserve-and-pickup channel at the constraint level. 0067 added the
-- WEB_RESERVATION reservation channel (3-day TTL, set by inventory-lock's
-- reserve()) but did NOT amend products_reservation_ttl_per_channel — the
-- 0006 check enumerates POS / STOREFRONT / EBAY only, so EVERY web
-- reservation violated it and POST /api/storefront/cart/reserve could never
-- succeed (found by the first live guest reservation, 2026-07-20).
--
-- WEB_RESERVATION follows the STOREFRONT/EBAY discipline: a RESERVED product
-- on this channel MUST carry an expiry (the autoReleaseExpired sweeper frees
-- it after the 3 days).

ALTER TABLE products DROP CONSTRAINT products_reservation_ttl_per_channel;
ALTER TABLE products ADD CONSTRAINT products_reservation_ttl_per_channel CHECK (
  status <> 'RESERVED' OR (
    (reserved_by_channel = 'POS'             AND reservation_expires_at IS NULL) OR
    (reserved_by_channel = 'STOREFRONT'      AND reservation_expires_at IS NOT NULL) OR
    (reserved_by_channel = 'EBAY'            AND reservation_expires_at IS NOT NULL) OR
    (reserved_by_channel = 'WEB_RESERVATION' AND reservation_expires_at IS NOT NULL)
  )
);
