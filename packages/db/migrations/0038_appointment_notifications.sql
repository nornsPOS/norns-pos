-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0038 — Epic G: appointment_notifications outbox + worker grants.
--
-- ADR-0020 §3 specifies `appointment_notifications` and §11 allows it to land in
-- its own migration. It was omitted from 0012 (which created the appointment
-- core), so this additive migration creates ONLY the missing outbox and the
-- worker-role grants the appointment jobs need (0012 predates 0017's default
-- privileges, so the worker has no rights on the appointment tables yet).
--
-- No appointment core objects are touched — they remain owned by 0012.
-- Idempotent; transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── appointment_notifications — the reminder/confirmation outbox ─────────────
CREATE TABLE IF NOT EXISTS appointment_notifications (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id    UUID         NOT NULL REFERENCES appointments(id),
  notification_type TEXT         NOT NULL,   -- booking_confirmation | reminder_24h | reminder_2h | reminder_30min | no_show_followup | rescheduled | cancelled
  channel           TEXT         NOT NULL,   -- whatsapp | email | sse | sms
  recipient         TEXT         NOT NULL,   -- phone or email (or 'pos' for sse)
  template_id       TEXT,                    -- Meta-approved template ref
  scheduled_for     TIMESTAMPTZ  NOT NULL,
  sent_at           TIMESTAMPTZ,
  delivery_status   TEXT,                    -- queued | sent | delivered | read | failed | window_closed
  external_ref      TEXT,                    -- WhatsApp / email message id
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT appt_notif_type_domain CHECK (notification_type IN (
    'booking_confirmation', 'reminder_24h', 'reminder_2h', 'reminder_30min',
    'no_show_followup', 'rescheduled', 'cancelled'
  )),
  CONSTRAINT appt_notif_channel_domain CHECK (channel IN ('whatsapp', 'email', 'sse', 'sms')),
  CONSTRAINT appt_notif_sent_has_status CHECK (sent_at IS NULL OR delivery_status IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_appt_notif_scheduled
  ON appointment_notifications (scheduled_for) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_appt_notif_appointment
  ON appointment_notifications (appointment_id);

-- ── App-role grants (booking inserts reminders; routes read) ─────────────────
GRANT SELECT, INSERT, UPDATE (sent_at, delivery_status, external_ref)
  ON appointment_notifications TO warehouse14_app;

-- ── Worker-role grants — the appointment jobs (0012 predates 0017 defaults) ──
GRANT SELECT, INSERT,
      UPDATE (sent_at, delivery_status, external_ref)
  ON appointment_notifications TO warehouse14_worker;

-- No-show detector: read appointments, flip status + stamp the marker.
GRANT SELECT ON appointments TO warehouse14_worker;
GRANT UPDATE (status, no_show_marked_at, updated_at) ON appointments TO warehouse14_worker;

-- Release the soft holds when the customer no-shows (release, never DELETE).
GRANT SELECT ON product_viewing_holds TO warehouse14_worker;
GRANT UPDATE (released_at, released_reason) ON product_viewing_holds TO warehouse14_worker;

-- Notification dispatcher: recipient + 24h-window lookups.
GRANT SELECT ON customers TO warehouse14_worker;
GRANT SELECT ON whatsapp_conversations TO warehouse14_worker;

COMMIT;
