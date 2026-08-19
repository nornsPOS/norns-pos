-- ═════════════════════════════════════════════════════════════════════════
-- 0069 — Appointments: DB-level no-overlap exclusion (double-booking guard)
-- ═════════════════════════════════════════════════════════════════════════
--
-- The appointment table (0012) had NO overlap constraint, even though 0001
-- installs `btree_gist` for exactly this. All three booking paths —
-- routes/appointments.ts (POS/staff), lib/whatsapp-bot-tools.ts (bot), and the
-- already-safe storefront path — did a SELECT-then-INSERT availability check.
-- Under READ COMMITTED two concurrent requests for the same staff + instant can
-- BOTH pass the check and BOTH insert → a double-booked slot. The storefront
-- path mitigated this with a `pg_advisory_xact_lock`; the other two did not.
--
-- This makes the invariant a DATABASE GUARANTEE that holds no matter what the
-- application does: a staff member cannot have two ACTIVE appointments whose
-- [starts_at, ends_at) ranges overlap. A losing concurrent insert raises
-- SQLSTATE 23P01 (exclusion_violation), which the error-handler maps to 409
-- CONFLICT and the booking routes surface as "slot unavailable".
--
-- Active = NOT IN ('CANCELLED','NO_SHOW','RESCHEDULED'): a cancelled / no-show /
-- rescheduled appointment frees the slot, so it must not block a re-book.
--
-- Idempotent (DO-guarded on pg_constraint) + append-only. If this ALTER fails on
-- a live DB, EXISTING overlapping rows are real double-bookings to clean up
-- first — that surfacing is intentional.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'appointments_no_staff_overlap'
  ) THEN
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_no_staff_overlap
      EXCLUDE USING gist (
        staff_user_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      )
      WHERE (status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED'));
  END IF;
END$$;
