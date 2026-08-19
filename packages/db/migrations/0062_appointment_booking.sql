-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0062 — public web appointment booking (storefront).
--
-- WHY
-- ───
-- The storefront gains two public endpoints (CONTRACT 1+2):
--   GET  /api/storefront/appointments/slots   — 30-min availability grid
--   POST /api/storefront/appointments/book    — walk-in booking, no login
-- A web visitor has NO customer record and NO staff actor, so the existing
-- `appointments` shape (0012) lacks two things:
--   1. an origin marker that survives analytics ('POS' | 'WEB' | 'WHATSAPP')
--      — `booked_via` exists but is the *channel UI* domain
--      ('control_desktop'|'storefront'|'pos'|'whatsapp_bot'); `source` is the
--      cross-team CONTRACT enum every consumer (POS, phone, exports) reads;
--   2. walk-in contact fields so a booking without a `customer_id` still
--      carries who to call/confirm (plain TEXT — appointment contact data is
--      operational, NOT the encrypted KYC PII store; GDPR cleanup of stale
--      appointments is handled by the existing retention jobs).
--
-- Also seeds the operator-tunable business-hours JSON the slots endpoint
-- reads ('appointments.business_hours'). The iCal feed token
-- ('appointments.ics_feed_token') is deliberately NOT seeded: the feed stays
-- 401 (disabled) until the owner explicitly rotates one via
-- POST /api/appointments/feed-token.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, constraint guarded by pg_constraint
-- probe, seed via ON CONFLICT DO NOTHING, GRANTs are no-ops when already held.
-- ──────────────────────────────────────────────────────────────────────────

-- 1. Booking origin (CONTRACT enum) + walk-in contact fields.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source        TEXT NOT NULL DEFAULT 'POS';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS contact_name  TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS contact_email TEXT;

COMMENT ON COLUMN appointments.source IS
  'Booking origin per the cross-team CONTRACT: POS (default, staff-made), WEB (public storefront), WHATSAPP (bot).';
COMMENT ON COLUMN appointments.contact_name IS
  'Walk-in contact name for bookings without a customer record (public web booking). Operational data, not KYC PII.';
COMMENT ON COLUMN appointments.contact_phone IS
  'Walk-in contact phone — the confirmation/reminder recipient for source=WEB bookings.';
COMMENT ON COLUMN appointments.contact_email IS
  'Optional walk-in contact email for source=WEB bookings.';

-- 2. source domain check (ADD CONSTRAINT has no IF NOT EXISTS — probe first).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'appointments_source_domain'
      AND conrelid = 'appointments'::regclass
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_source_domain
      CHECK (source IN ('POS', 'WEB', 'WHATSAPP'));
  END IF;
END
$$;

-- 3. Seed the business-hours default for the public slots endpoint
--    (operator-tunable later; the route also falls back to this exact JSON
--    when the key is absent, so seed + code default can never diverge).
INSERT INTO system_settings (key, value, description) VALUES
  ('appointments.business_hours',
   '{"mo-fr":["10:00","18:00"],"sa":["10:00","14:00"],"so":null}'::jsonb,
   'Öffnungszeiten für die Online-Terminbuchung (Europe/Berlin). Bänder: mo-fr, sa, so; null = geschlossen; 30-Minuten-Raster.')
ON CONFLICT (key) DO NOTHING;

-- 4. Grants.
--
-- INSERT/SELECT on `appointments` are TABLE-level for warehouse14_app (0003
-- default privileges), so the new columns are already insertable/readable.
-- UPDATE however was granted COLUMN-scoped in 0012 — extend it to the new
-- columns so staff tooling may correct a typo'd walk-in contact.
GRANT UPDATE (source, contact_name, contact_phone, contact_email)
  ON appointments TO warehouse14_app;

-- Re-affirm (idempotent) the table-level reads the other roles rely on —
-- 0038 gave the worker SELECT (notification sweeps read contact fields now),
-- 0057 gave the SECURITY DEFINER trigger owner SELECT (lesson 0055/0056/0057:
-- a trigger reading a table needs its OWNER role granted, not the caller).
GRANT SELECT ON appointments TO warehouse14_worker;
GRANT SELECT ON appointments TO warehouse14_security;
