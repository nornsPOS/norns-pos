-- 0064 — Google Calendar mirror for appointments.
--
-- Every appointment (storefront/phone booking, POS, future WhatsApp bot) is
-- mirrored into the shop's Google Calendar so the calendar is the single place
-- all appointments appear (POS Werkstatt → Kalender + the owner's phone). This
-- column stores the mirrored Google event id; NULL until synced (the mirror is
-- best-effort and never blocks a booking).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + grant re-affirmed.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS google_event_id text;

-- INSERT/SELECT on appointments are TABLE-level for warehouse14_app (0003);
-- UPDATE is COLUMN-scoped (0012/0062) — the post-commit mirror writes this one
-- column, so extend the column-scoped UPDATE grant to it.
GRANT UPDATE (google_event_id) ON appointments TO warehouse14_app;

-- Partial index: the back-fill / repair path looks up appointments still
-- missing a mirror in the active window.
CREATE INDEX IF NOT EXISTS appointments_missing_google_event_idx
  ON appointments (starts_at)
  WHERE google_event_id IS NULL
    AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED');
