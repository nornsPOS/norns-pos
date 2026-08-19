-- 0087 — cart_status gains CANCELLED (customer-initiated cancellation).
--
-- A shopper may cancel a RESERVED pickup order from the shop app (Widerruf
-- friendliness: one tap, holds released immediately, staff notified live).
-- ABANDONED stays reserved for sweeper-expired carts; CANCELLED is an explicit
-- customer action and reads differently at the POS.
--
-- Own migration file: PG cannot USE a new enum value inside the transaction
-- that added it (0019 precedent) — usage arrives with 0088 and runtime code.

ALTER TYPE cart_status ADD VALUE IF NOT EXISTS 'CANCELLED';
