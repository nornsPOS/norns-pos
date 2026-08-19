-- 0065 — inbound Google Calendar sync (two-way).
--
-- The pull job (api-cloud lib/calendar-pull.ts) reflects Google-side changes
-- back into appointments: it may RESCHEDULE (update starts_at/duration in place)
-- and IMPORT brand-new Google-created events as appointments. This needs:
--   • a 'google_calendar' booked_via + 'GOOGLE' source value, and
--   • UPDATE rights on starts_at + duration_minutes for warehouse14_app.
--
-- Idempotent: constraints are dropped+re-added; grants are no-ops when held.

-- NB: depending on how the column-domain CHECK was first created, the live
-- constraint may carry the auto-generated '_check' name OR the explicit
-- '_domain' name — drop both to be safe before re-adding the canonical one.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_booked_via_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_booked_via_domain;
ALTER TABLE appointments ADD CONSTRAINT appointments_booked_via_domain
  CHECK (booked_via IN ('control_desktop', 'storefront', 'pos', 'whatsapp_bot', 'google_calendar'));

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_source_check;
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_source_domain;
ALTER TABLE appointments ADD CONSTRAINT appointments_source_domain
  CHECK (source IN ('POS', 'WEB', 'WHATSAPP', 'GOOGLE'));

-- The reschedule path moves an appointment in place when its Google event is
-- dragged to a new time. status + marker columns were already grantable
-- (0012/0062); google_event_id in 0064. Add the two time columns.
GRANT UPDATE (starts_at, duration_minutes) ON appointments TO warehouse14_app;
