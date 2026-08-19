-- Migration 0083 — api_keys (programmatic access tokens).
--
-- Lets a staff member / manager mint a token to integrate an agent, LLM, or
-- external service. A key resolves to a non-interactive actor with a `role`
-- (permission ceiling) plus a hard `read_only` block on all mutations, and an
-- optional finer `scopes` allow-list (reserved).
--
-- SECURITY:
--   • Only the SHA-256 HASH of the secret is stored (token_hash). The plaintext
--     is shown once at creation and is unrecoverable.
--   • NO DELETE for warehouse14_app — revocation is a soft revoked_at stamp so
--     the audit + last-used trail survives.
--   • INSERT is granted (mediated by an ADMIN + PIN step-up route). UPDATE is
--     narrowed to the last-used + revocation columns only.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS api_keys (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label               text NOT NULL,
  token_hash          text NOT NULL,
  token_prefix        text NOT NULL,
  role                user_role NOT NULL,
  read_only           boolean NOT NULL DEFAULT true,
  scopes              jsonb,
  created_by_user_id  uuid NOT NULL REFERENCES users(id),
  expires_at          timestamptz,
  last_used_at        timestamptz,
  last_used_ip        inet,
  revoked_at          timestamptz,
  revoked_by_user_id  uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_label_len CHECK (char_length(label) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS api_keys_token_hash_uq ON api_keys (token_hash);
CREATE INDEX IF NOT EXISTS api_keys_active_idx ON api_keys (id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS api_keys_created_by_idx ON api_keys (created_by_user_id);

-- ─── ROLE GRANTS ──────────────────────────────────────────────────────────
-- The app looks keys up on every request (SELECT), mints them behind an
-- ADMIN + step-up route (INSERT), and stamps last-used + revocation (UPDATE).
-- NO DELETE: a revoked key stays as a soft-deleted forensic record.
GRANT SELECT, INSERT ON api_keys TO warehouse14_app;
GRANT UPDATE (last_used_at, last_used_ip, revoked_at, revoked_by_user_id, updated_at)
  ON api_keys TO warehouse14_app;
