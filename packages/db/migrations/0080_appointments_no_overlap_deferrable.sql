-- 0080: make the appointment no-overlap EXCLUDE constraint DEFERRABLE so a
-- reschedule can vacate the original and insert its clone in one transaction.
--
-- 0069 added `appointments_no_staff_overlap` as an IMMEDIATE EXCLUDE
-- (staff_user_id WITH =, tstzrange(starts_at, ends_at) WITH &&, WHERE the status
-- is active). The reschedule flow (routes/appointments.ts) MUST insert the clone
-- before it can flip the original to RESCHEDULED, because the
-- `appointments_rescheduled_has_link` CHECK needs the clone id first. With an
-- IMMEDIATE check the clone INSERT collides with the still-active original
-- whenever the new time overlaps the old one (e.g. moving a 10:00 appointment to
-- 10:30, same staff), so a near-time reschedule always failed with 23P01 even
-- though the original is being vacated. Rescheduling by a small amount, the
-- single most common reschedule, was impossible.
--
-- Fix: recreate the constraint as DEFERRABLE INITIALLY IMMEDIATE. The DEFAULT
-- behaviour is unchanged (still checked per statement), so booking conflicts
-- still raise 23P01 immediately and are caught as a clean 409. Only the
-- reschedule transaction issues `SET CONSTRAINTS appointments_no_staff_overlap
-- DEFERRED`, moving ITS check to COMMIT, by which point the original is
-- RESCHEDULED (out of the constraint's WHERE set). A genuine overlap with a
-- DIFFERENT active appointment still raises 23P01 at COMMIT and surfaces as 409.
--
-- A plain UNIQUE/EXCLUDE constraint cannot be made deferrable via ALTER
-- CONSTRAINT (that path is FK-only), so we DROP and re-ADD. Existing rows already
-- satisfy the predicate (it was enforced), so the re-add is safe; btree_gist is
-- already installed (0069).

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_staff_overlap;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_staff_overlap
  EXCLUDE USING gist (
    staff_user_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED'))
  DEFERRABLE INITIALLY IMMEDIATE;
