-- 0089_session_revocation.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Explicit session revocation (security review 2026-07-21).
--
-- Until now a session could only end by expiry (owner TTL was 30d) or by
-- soft-deleting the whole user. There was no way to kill ONE device's session
-- (a lost phone) or to force-sign-out a specific user without erasing them.
--
-- `revoked_at` is the kill switch: the per-request auth loader
-- (loadActorBySession) now additionally requires `revoked_at IS NULL`, so
-- stamping it takes effect on the VERY NEXT request — no waiting for expiry.
-- NULL = live. A soft-delete of the user still kills all their sessions via the
-- existing users join; this adds the finer-grained, per-session control.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

-- Fast lookup of a user's LIVE sessions (revoke-all, session list). Partial
-- index keeps it small: only live rows are ever scanned for these actions.
CREATE INDEX IF NOT EXISTS sessions_user_live_idx
  ON sessions (user_id)
  WHERE revoked_at IS NULL;
