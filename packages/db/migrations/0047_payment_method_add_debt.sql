-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0047 — Add the missing 'DEBT' label to the payment_method enum.
--
-- 0009 created payment_method WITHOUT a 'DEBT' label
--   (CASH, ZVT_CARD, SUMUP, MOLLIE, STRIPE, EBAY, BANK_TRANSFER, VOUCHER; 0019
--    later added TRADE_IN). But 0016 ("DEBT & balance") installed two guard
-- triggers that fire on EVERY transaction_payments INSERT and open with
--   IF NEW.payment_method <> 'DEBT' THEN …
-- PostgreSQL coerces that bare 'DEBT' literal to payment_method to compare it —
-- and since 'DEBT' is not a label, the coercion throws
--   "invalid input value for enum payment_method: \"DEBT\""
-- on the FIRST payment of ANY kind (CASH included). No transaction can record a
-- payment today. Latent only because prod still has 0 transactions.
--
-- Fix: add the label the triggers (and the DEBT pay-later feature) require.
-- Enum additions cannot run inside a transaction block, so this is a bare,
-- autocommitted statement — no surrounding BEGIN/COMMIT (matches 0019/0039).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TYPE payment_method ADD VALUE IF NOT EXISTS 'DEBT';
