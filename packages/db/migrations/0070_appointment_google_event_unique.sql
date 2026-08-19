-- ═════════════════════════════════════════════════════════════════════════
-- 0070 — Appointments: UNIQUE(google_event_id) — inbound calendar-pull idempotency
-- ═════════════════════════════════════════════════════════════════════════
--
-- The Google-calendar inbound pull (lib/calendar-pull.ts) imports a Google event
-- as a new appointment with `INSERT … ON CONFLICT DO NOTHING`. But `google_event_id`
-- (added in 0064) had NO unique index, so that `ON CONFLICT` could only ever
-- arbiter on the primary key — which never conflicts for a fresh row. It was a
-- no-op guard. Two outcomes followed:
--   • a slow 15s poll tick overlapping the next tick re-imported the same event;
--   • the outbound mirror (a POS booking → Google event) could link `google_event_id`
--     onto an existing appointment AFTER the pull read a stale "no match" snapshot,
--     producing TWO appointments for one Google event.
--
-- This makes "at most one appointment per Google event" a DATABASE GUARANTEE.
-- With the unique index in place, the pull's `ON CONFLICT (google_event_id) DO
-- NOTHING` is a real idempotent UPSERT and the duplicate race is impossible.
--
-- NULLs are distinct in a B-tree, so the many not-yet-synced rows (google_event_id
-- IS NULL) are unaffected — a non-partial unique index is correct and keeps the
-- `ON CONFLICT (google_event_id)` clause minimal (no partial-index arbiter
-- inference).
--
-- Step 1 defensively de-duplicates any existing duplicate google_event_id rows
-- BEFORE adding the index (prod ran the broken import for weeks, so real dupes
-- may exist and would make CREATE UNIQUE INDEX fail with 23505). We keep the
-- OLDEST row per event id and NULL out the google_event_id of the rest — never
-- DELETE (appointments are append-only per 0012 and ledger_events FK them).
-- Idempotent + append-only.

-- Step 1 — detach duplicate google_event_id values (keep the oldest per event).
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY google_event_id ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM appointments
  WHERE google_event_id IS NOT NULL
)
UPDATE appointments a
   SET google_event_id = NULL
  FROM ranked r
 WHERE a.id = r.id
   AND r.rn > 1;

-- Step 2 — the unique index (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'appointments_google_event_id_uq'
  ) THEN
    CREATE UNIQUE INDEX appointments_google_event_id_uq
      ON appointments (google_event_id);
  END IF;
END$$;

COMMENT ON INDEX appointments_google_event_id_uq IS
  'Inbound calendar-pull idempotency key — at most one appointment per Google event.';
