-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0049 — tse_clients.last_alert_tier (escalation-aware cert alerts).
--
-- 0043 created tse_clients with `alert_sent_at` (a 24h time throttle). That is
-- too blunt for KassenSichV cert-expiry: the operator should get a FRESH warning
-- each time the certificate crosses into a more urgent band (T-30 → T-7 → T-1 →
-- expired), but must NOT be re-spammed while sitting in the same band for weeks.
--
-- This adds `last_alert_tier` so the tse_cert_checker job can alert iff the
-- current tier is MORE urgent than the last one it alerted at (see
-- apps/worker/src/lib/cert-expiry-tier.ts). No new alert TYPE is introduced —
-- the existing critical `alert.tse_cert_expiry` event simply carries the tier in
-- its payload (memory.md #45: no new critical alert types).
--
-- Append-only + idempotent: ADD COLUMN IF NOT EXISTS, nullable (NULL = never
-- alerted). The existing table-level UPDATE grant to warehouse14_worker /
-- warehouse14_app already covers the new column — no GRANT change needed.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE tse_clients
  ADD COLUMN IF NOT EXISTS last_alert_tier TEXT;

COMMENT ON COLUMN tse_clients.last_alert_tier IS
  'The cert-expiry escalation tier (T-30/T-7/T-1/expired) most recently alerted on; NULL = never alerted. Drives escalation-only re-alerting.';

COMMIT;
