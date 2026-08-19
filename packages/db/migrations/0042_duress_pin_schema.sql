-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0042 — Duress PIN & Silent Alarm (Decision #37).
--
-- Each cashier may register a SECOND PIN (distinct from their normal POS PIN).
-- Typing the duress PIN logs in normally — byte-for-byte identical UX, no hint
-- to a coercing attacker — while firing a silent alarm in the background. The
-- duress hash lives alongside the normal one; the route layer decides which was
-- entered (constant-time, double-verify) and never lets a duress attempt tick
-- the lockout counter.
--
-- Constraints mirror the POS-PIN discipline (migration 0014):
--   • both duress columns set together or both NULL;
--   • the duress hash must differ from the POS hash (belt-and-braces — the real
--     distinctness check is app-level verifyPin, since argon2id salts every
--     hash; this catches a literal copy of the stored hash string).
--
-- Additive, idempotent, transactional.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS duress_pin_hash   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS duress_pin_set_at TIMESTAMPTZ;

-- Both-or-neither: a duress hash without its set-at marker (or vice versa) is invalid.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_duress_pin_hash_set_together;
ALTER TABLE users ADD CONSTRAINT users_duress_pin_hash_set_together CHECK (
  (duress_pin_hash IS NULL AND duress_pin_set_at IS NULL)
  OR (duress_pin_hash IS NOT NULL AND duress_pin_set_at IS NOT NULL)
);

-- The duress hash must not be the literal POS hash.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_duress_pin_distinct;
ALTER TABLE users ADD CONSTRAINT users_duress_pin_distinct CHECK (
  duress_pin_hash IS NULL OR duress_pin_hash <> pos_pin_hash
);

-- App role may set/rotate the duress PIN (same surface as the POS PIN).
GRANT UPDATE (duress_pin_hash, duress_pin_set_at) ON users TO warehouse14_app;

COMMIT;
