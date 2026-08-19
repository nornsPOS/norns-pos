-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0004 — Authentication, identity, and device pairing
--
-- Tables created:
--   • users          — better-auth-shaped + Warehouse14 extensions (role, language,
--                      soft-delete + anonymization for GDPR)
--   • devices        — mTLS-paired terminals (POS, Control Desktop, worker)
--   • accounts       — better-auth credentials + OAuth provider records
--   • sessions       — better-auth sessions, linked to (user, device)
--   • verifications  — better-auth short-lived verification tokens
--   • two_factors    — TOTP secrets for ADMIN/READONLY mandatory 2FA
--
-- ADR references:
--   • ADR-0006 §3 — better-auth chosen over Lucia; password column on accounts;
--                   TOTP mandatory for ADMIN/READONLY
--   • ADR-0008 §3 — role-grant discipline (app: no DELETE on most tables)
--   • ADR-0008 §8 — modular schema; auth tables together under auth/
--   • ADR-0009    — devices table for mTLS identity (ADR-0014 transport)
--   • ADR-0014 §2 — devices.cert_serial unique; status lifecycle
--   • ADR-0015 §2 — staff_phone_numbers (next migration); users.preferred_language drives
--                   bot reply language + intake status template selection
--   • ADR-0017 §12 — preferred_language enum domain DE/EN/AR for V1
--
-- Basel's Day-2 architectural directives (2026-05-24):
--   1. NO DELETE for warehouse14_app on `users`. GDPR deletion uses
--      `soft_deleted_at` + `anonymized_at`. Fiscal links (transactions,
--      audit_log) must remain referentially intact.
--   2. FULL grants (incl. DELETE) for warehouse14_app on `sessions` — logout
--      requires immediate session row removal.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS where possible. Enums use DO blocks.
-- Transactional: BEGIN/COMMIT wraps everything.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. ENUM types
-- ─────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('ADMIN', 'CASHIER', 'READONLY');
    COMMENT ON TYPE user_role IS 'Warehouse14 RBAC roles (ADR-0008 §3, memory.md §3).';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_class') THEN
    CREATE TYPE device_class AS ENUM (
      'POS_TERMINAL',
      'CONTROL_DESKTOP',
      'ADMIN_WEB_BROWSER',
      'WORKER'
    );
    COMMENT ON TYPE device_class IS 'Physical/logical device categories with distinct mTLS lifetimes (ADR-0014 §2).';
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_status') THEN
    CREATE TYPE device_status AS ENUM ('active', 'revoked', 'expired');
    COMMENT ON TYPE device_status IS 'Lifecycle state of a paired device. Revoked devices are blocked at the API guard (ADR-0014 §3).';
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. users
--    GDPR posture: NEVER deleted by the app. Soft-delete via soft_deleted_at;
--    anonymization (PII scrub) via anonymized_at. Fiscal joins from
--    transactions / ledger_events / audit_log remain intact.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- better-auth core fields (CITEXT email for case-insensitive uniqueness)
  email               CITEXT       NOT NULL,
  email_verified      BOOLEAN      NOT NULL DEFAULT FALSE,
  name                TEXT         NOT NULL,
  image               TEXT,

  -- Warehouse14 extensions
  role                user_role    NOT NULL,
  preferred_language  CHAR(2)      NOT NULL DEFAULT 'de'
                                   CHECK (preferred_language IN ('de', 'en', 'ar')),
  shop_id             UUID,                                  -- V1 NULL; multi-shop adds FK

  -- GDPR soft-delete + anonymization (Day-2 directive)
  soft_deleted_at     TIMESTAMPTZ,
  anonymized_at       TIMESTAMPTZ,

  -- Lifecycle
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- A row is unique by active email. Anonymized rows are excluded via
  -- the partial unique index below so a freshly-anonymized account does
  -- not block a new user signing up with the same email.
  CONSTRAINT users_anonymized_implies_soft_deleted
    CHECK (anonymized_at IS NULL OR soft_deleted_at IS NOT NULL),
  CONSTRAINT users_anonymized_after_soft_deleted
    CHECK (anonymized_at IS NULL OR anonymized_at >= soft_deleted_at)
);

-- Partial unique index so soft-deleted+anonymized rows don't collide
-- with future signups using the same email.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_active_uq
  ON users (email)
  WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_role_active_idx
  ON users (role)
  WHERE soft_deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS users_shop_id_idx
  ON users (shop_id)
  WHERE shop_id IS NOT NULL;

COMMENT ON TABLE users IS
  'Authenticated users (ADMIN/CASHIER/READONLY). NEVER deleted by app role — GDPR via soft_deleted_at + anonymized_at.';
COMMENT ON COLUMN users.soft_deleted_at IS
  'Set when the user is "deleted" by the app. The row remains for fiscal/audit referential integrity.';
COMMENT ON COLUMN users.anonymized_at IS
  'Set when PII has been scrubbed (email reset, name nullified, image deleted). Always >= soft_deleted_at.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. devices
--    mTLS-paired terminals. References users via paired_by_user_id.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devices (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  device_class        device_class    NOT NULL,
  hostname            TEXT,                                     -- self-reported, advisory only
  cert_serial         TEXT            NOT NULL UNIQUE,           -- step-ca-issued serial
  cert_issued_at      TIMESTAMPTZ     NOT NULL,
  cert_expires_at     TIMESTAMPTZ     NOT NULL,
  status              device_status   NOT NULL DEFAULT 'active',
  paired_by_user_id   UUID            NOT NULL REFERENCES users(id),
  paired_at           TIMESTAMPTZ     NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ,
  last_seen_ip        INET,
  notes               TEXT,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

  CONSTRAINT devices_cert_validity_range
    CHECK (cert_expires_at > cert_issued_at)
);

CREATE INDEX IF NOT EXISTS devices_status_class_idx
  ON devices (status, device_class);

CREATE INDEX IF NOT EXISTS devices_expiring_soon_idx
  ON devices (cert_expires_at)
  WHERE status = 'active';

COMMENT ON TABLE devices IS
  'mTLS-paired terminals + Control Desktop instances. Cert serial maps the TLS handshake to a row (ADR-0009 §3).';

-- ─────────────────────────────────────────────────────────────────────
-- 4. accounts
--    better-auth credentials + OAuth records. password column carries an
--    argon2id hash for the 'credentials' provider.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID         NOT NULL REFERENCES users(id),
  account_id                  TEXT         NOT NULL,                          -- provider's user identifier
  provider_id                 TEXT         NOT NULL,                          -- 'credentials' | 'github' | ...
  password                    TEXT,                                            -- argon2id hash for credentials provider
  access_token                TEXT,
  refresh_token               TEXT,
  id_token                    TEXT,
  access_token_expires_at     TIMESTAMPTZ,
  refresh_token_expires_at    TIMESTAMPTZ,
  scope                       TEXT,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT accounts_provider_account_uq UNIQUE (provider_id, account_id),

  -- Discipline: credentials accounts have a password and no OAuth tokens;
  -- OAuth accounts have no password.
  CONSTRAINT accounts_credentials_or_oauth
    CHECK (
      (provider_id = 'credentials' AND password IS NOT NULL AND access_token IS NULL)
      OR
      (provider_id <> 'credentials' AND password IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS accounts_user_id_idx ON accounts (user_id);

COMMENT ON TABLE accounts IS
  'better-auth account records. One row per (provider, user). NEVER deleted by app role — unlink-provider is mediated.';

-- ─────────────────────────────────────────────────────────────────────
-- 5. sessions
--    Day-2 directive: FULL grants including DELETE — logout removes immediately.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id),
  token         TEXT         NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ  NOT NULL,
  ip_address    INET,
  user_agent    TEXT,
  device_id     UUID         REFERENCES devices(id),    -- nullable V1; required for mTLS-bound surfaces (ADR-0014 §3)
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx     ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx  ON sessions (expires_at);
CREATE INDEX IF NOT EXISTS sessions_device_id_idx   ON sessions (device_id) WHERE device_id IS NOT NULL;

COMMENT ON TABLE sessions IS
  'Active auth sessions. DELETE permitted for app role (logout flow). Cleanup of expired rows is a worker job.';

-- ─────────────────────────────────────────────────────────────────────
-- 6. verifications
--    Short-lived (≤24h) verification tokens. SELECT/INSERT/DELETE granted to app
--    (consume-then-delete pattern).
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verifications (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier   TEXT         NOT NULL,
  value        TEXT         NOT NULL,
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verifications_identifier_idx ON verifications (identifier);
CREATE INDEX IF NOT EXISTS verifications_expires_at_idx ON verifications (expires_at);

COMMENT ON TABLE verifications IS
  'Email-verification / password-reset / magic-link tokens. Short-lived; DELETE permitted on consume.';

-- ─────────────────────────────────────────────────────────────────────
-- 7. two_factors
--    Mandatory for ADMIN/READONLY (memory.md §3). secret + backup_codes are
--    pgp_sym_encrypted at the app layer — pgcrypto already enabled in 0001.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS two_factors (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL UNIQUE REFERENCES users(id),
  secret        TEXT         NOT NULL,                           -- pgp_sym_encrypt() bytes encoded
  backup_codes  TEXT,                                             -- pgp_sym_encrypt() of JSON array
  enabled       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE two_factors IS
  'TOTP secrets per user. ADMIN/READONLY mandatory enabled=true. DELETE permitted on user-disable (app-mediated).';

-- ─────────────────────────────────────────────────────────────────────
-- 8. updated_at triggers
--    Apply set_updated_at() (migration 0002) to every table with both
--    created_at and updated_at columns.
-- ─────────────────────────────────────────────────────────────────────

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_devices_updated_at
  BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_accounts_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_verifications_updated_at
  BEFORE UPDATE ON verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_two_factors_updated_at
  BEFORE UPDATE ON two_factors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────
-- 9. ROLE GRANTS — per Basel's Day-2 directives.
--
--    The default privileges set in migration 0003 already grant SELECT+INSERT
--    on new tables; we add narrow UPDATE column lists and the exceptions
--    (DELETE on sessions, DELETE on verifications, DELETE on two_factors).
-- ─────────────────────────────────────────────────────────────────────

-- ─── users ────────────────────────────────────────────────────────────
-- NEVER DELETE. UPDATE only on the user-mutable column set + GDPR markers.
-- Specifically: email, role, shop_id are NOT in the UPDATE list — those
-- changes are admin-mediated through specific migration-owned stored
-- procedures (added in a later migration) or by the migrator role.
GRANT UPDATE (
  name,
  image,
  preferred_language,
  email_verified,
  soft_deleted_at,
  anonymized_at,
  updated_at
) ON users TO warehouse14_app;

-- ─── devices ──────────────────────────────────────────────────────────
-- NEVER DELETE. Cert lifecycle (cert_serial, cert_*_at, paired_by_user_id)
-- is mediated by step-ca + admin; the app only updates lifecycle metadata.
GRANT UPDATE (
  status,
  last_seen_at,
  last_seen_ip,
  notes,
  hostname,
  updated_at
) ON devices TO warehouse14_app;

-- ─── accounts ─────────────────────────────────────────────────────────
-- NEVER DELETE. Password change is UPDATE on `password`. OAuth token refresh
-- updates the token columns.
GRANT UPDATE (
  password,
  access_token,
  refresh_token,
  id_token,
  access_token_expires_at,
  refresh_token_expires_at,
  scope,
  updated_at
) ON accounts TO warehouse14_app;

-- ─── sessions ─────────────────────────────────────────────────────────
-- DAY-2 DIRECTIVE: FULL grants. Logout = DELETE. Session refresh = UPDATE.
GRANT UPDATE, DELETE ON sessions TO warehouse14_app;
-- (SELECT + INSERT come from the default privileges in migration 0003.)

-- ─── verifications ────────────────────────────────────────────────────
-- Short-lived tokens. Consume-then-delete. UPDATE intentionally omitted —
-- verification rows are insert-and-consume.
GRANT DELETE ON verifications TO warehouse14_app;

-- ─── two_factors ──────────────────────────────────────────────────────
-- App can flip enabled, rotate the secret, regenerate backup codes, or
-- delete on user-disable (admin-mediated in app code).
GRANT UPDATE (
  secret,
  backup_codes,
  enabled,
  updated_at
) ON two_factors TO warehouse14_app;
GRANT DELETE ON two_factors TO warehouse14_app;

COMMIT;
