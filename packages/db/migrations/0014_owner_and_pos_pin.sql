-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0014 — Owner flag + POS PIN auth (Day 12 schema)
--
-- ADR reference: docs/architecture/adr/0022-owner-ux-and-pos-pin.md
--
-- Two concerns, one logical concern ("Owner identity + fast POS PIN"):
--
--   1. `users.is_owner` — partial-UNIQUE flag, exactly one Owner at most.
--      The Owner is the only actor that gets UX bypasses at the API/UI
--      layer (30-day rolling session, no app rate-limit, auto-approval of
--      self-initiated actions). The DB triggers from migration 0013 are
--      UNAFFECTED — the Owner cannot tamper with fiscal evidence.
--
--   2. `users.pos_pin_*` — argon2id-hashed 4-digit PIN with brute-force
--      lockout. Daily morning login on a mTLS-paired terminal uses the PIN.
--      Sensitive actions (finalize/storno/closing/dsfinvk) ALSO use the PIN
--      for step-up via `sessions.last_pin_step_up_at`.
--
-- Defense-in-depth recap (ADR-0022 §5):
--   Device cert (mTLS) ∧ PIN ∧ 5-attempt lockout ∧ Full-Login recovery ∧
--   audit_log on every event ∧ SECURITY DEFINER triggers from 0008/0013.
--
-- Idempotent + transactional. ADR-0008 §9 amendment: this is the 14th
-- migration; the September 2026 "13 migrations" count is now superseded.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ═════════════════════════════════════════════════════════════════════════
-- 1. is_owner — the single-Owner flag on users
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.is_owner IS
  'TRUE for exactly one user (the business Owner). Gives UX bypasses at the API '
  'layer — never bypasses DB triggers / legal floor. Partial UNIQUE on TRUE.';

-- AT MOST ONE row may have is_owner = TRUE. A partial unique index on the
-- column makes the constraint impossible to violate from any role with INSERT
-- or UPDATE privilege.
CREATE UNIQUE INDEX IF NOT EXISTS users_only_one_owner_uq
  ON users ((is_owner))
  WHERE is_owner = TRUE;

-- The Owner must hold the ADMIN role — refuses inconsistency at write time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_owner_implies_admin'
       AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_owner_implies_admin
      CHECK (is_owner = FALSE OR role = 'ADMIN');
  END IF;
END$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 2. POS PIN columns
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pos_pin_hash             TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pos_pin_set_at           TIMESTAMPTZ;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pos_pin_failed_attempts  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pos_pin_locked_until     TIMESTAMPTZ;

COMMENT ON COLUMN users.pos_pin_hash IS
  'Argon2id hash of the 4-digit PIN. NULL = no POS access yet (set on first device pairing).';
COMMENT ON COLUMN users.pos_pin_failed_attempts IS
  'Consecutive wrong-PIN count. Reset to 0 on successful PIN or Full Login.';
COMMENT ON COLUMN users.pos_pin_locked_until IS
  'When set, PIN auth refuses until now() ≥ this. Clear via Full Login (ADR-0022 §4d).';

-- Hash + set-at land together or not at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_pin_hash_set_together'
       AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_pin_hash_set_together
      CHECK ((pos_pin_hash IS NULL AND pos_pin_set_at IS NULL)
          OR (pos_pin_hash IS NOT NULL AND pos_pin_set_at IS NOT NULL));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'users_pin_attempts_nonneg'
       AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_pin_attempts_nonneg
      CHECK (pos_pin_failed_attempts >= 0);
  END IF;
END$$;

-- Hot-path index: lookup by user_id when PIN is set. Skipped for users
-- without POS access to keep the index lean.
CREATE INDEX IF NOT EXISTS users_pos_pin_active_idx
  ON users (id)
  WHERE pos_pin_hash IS NOT NULL AND soft_deleted_at IS NULL;

-- Operator query: who is currently locked out?
CREATE INDEX IF NOT EXISTS users_pos_pin_locked_idx
  ON users (pos_pin_locked_until)
  WHERE pos_pin_locked_until IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Step-up tracking on sessions
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS last_pin_step_up_at TIMESTAMPTZ;

COMMENT ON COLUMN sessions.last_pin_step_up_at IS
  'Most recent PIN step-up confirmation on this session. Compared against '
  'now() - 5min window for sensitive actions (ADR-0022 §4c).';

-- sessions already has full UPDATE/DELETE for warehouse14_app from migration
-- 0004 — no new grant needed for this column.

-- ═════════════════════════════════════════════════════════════════════════
-- 4. App-role grants — column-level, deliberately narrow
-- ═════════════════════════════════════════════════════════════════════════

-- The app role can:
--   • UPDATE pos_pin_hash + pos_pin_set_at   (PIN set / change endpoint).
--   • UPDATE pos_pin_failed_attempts          (++/reset on every PIN attempt).
--   • UPDATE pos_pin_locked_until             (lockout enforcement / Full-Login reset).
--
-- The app role CANNOT UPDATE:
--   • is_owner — only migrator can, via signed manual operation.
GRANT UPDATE (
  pos_pin_hash,
  pos_pin_set_at,
  pos_pin_failed_attempts,
  pos_pin_locked_until
) ON users TO warehouse14_app;

-- Belt-and-braces: explicitly REVOKE is_owner from app role.
-- (It was never granted via the migration-0004 column list, but the
-- post-condition is what the audit will check.)
REVOKE UPDATE (is_owner) ON users FROM warehouse14_app;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Owner-aware audit_log event types — documentation only (no enum here)
--
-- audit_log.event_type is TEXT (not enum) by design — adding new types is
-- documentation, not migration. The Day-12 wiring will emit:
--
--   auth.pin_login                  — successful PIN login
--   auth.pin_failed                 — wrong PIN (still in attempt budget)
--   auth.pin_locked                 — 5th wrong PIN → lockout fired
--   auth.pin_unlocked_via_full_auth — Full Login cleared the lockout
--   auth.step_up_success            — PIN step-up confirmed for sensitive action
--   auth.step_up_failed             — wrong PIN at step-up
--   pin.set                         — new PIN set or changed
--   owner.rate_limit_skipped        — Owner-only rate-limit bypass applied
--   owner.auto_approved_self        — Owner action auto-approved (no queue)
-- ═════════════════════════════════════════════════════════════════════════

COMMIT;
