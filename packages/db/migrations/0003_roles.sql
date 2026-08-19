-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0003 — Database roles and default-deny grants
--
-- Purpose: establish the three-role separation enforced across every later
-- migration. After this migration the database has:
--
--   • warehouse14_migrator  (pre-existing, created by the bootstrap step —
--                            see "Prerequisites" below)
--   • warehouse14_app       — LOGIN. Runtime role for API + worker. SELECT,
--                             INSERT, and per-table UPDATE column lists only.
--                             NEVER DELETE. Default-deny on public schema.
--   • warehouse14_security  — NOLOGIN. Owns security-critical objects (the
--                             ledger BEFORE INSERT trigger fn from 0008).
--                             Defense-in-depth: a compromised app session
--                             cannot DROP TRIGGER or REVOKE the chain because
--                             the warehouse14_app role does not own them.
--
-- Idempotent: all CREATE ROLE statements use DO blocks with EXISTS guards.
--             Re-running this migration on a partially-applied DB is safe.
-- Transactional: BEGIN/COMMIT wraps the whole thing.
--
-- ADR references:
--   • ADR-0008 §3   — role split and default-deny
--   • ADR-0018 §10  — defense-in-depth, including trigger-owner isolation
--   • ADR-0009 §3   — mTLS device identity is layered ON TOP of role grants;
--                     this migration is the database half of the trust chain
--
-- Prerequisites:
--   The connection running this migration must already have:
--     • CREATEROLE privilege (to CREATE ROLE warehouse14_app and ..._security)
--     • Ownership or appropriate grants on schema public to REVOKE/GRANT
--
--   warehouse14_migrator itself is created OUTSIDE Drizzle migrations:
--     • Local dev: infrastructure/docker/postgres/initdb.d/00-create-migrator-role.sh
--     • Production: scripts/bootstrap-oracle.sh (per ADR-0012 §9)
--
--   This separation is intentional: the role that runs migrations cannot
--   be created BY migrations (chicken-and-egg). Bootstrap is a documented,
--   reviewable, one-time provisioning step.
--
-- Passwords:
--   This migration does NOT set passwords on the roles it creates. Secrets
--   are managed externally (ADR-0012 §7):
--     • Local dev: infrastructure/docker/postgres/initdb.d/01-set-app-password.sh
--     • Production: applied via `ALTER ROLE … PASSWORD :app_password` sourced
--                   from Oracle Vault as part of the deploy bootstrap
--   Embedding passwords in a committed migration file is a secrets discipline
--   violation; this file would land in git history forever.
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Roles — create if not exist, never modify if existing.
-- ─────────────────────────────────────────────────────────────────────

-- warehouse14_security — owns security-critical objects, cannot log in.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse14_security') THEN
    CREATE ROLE warehouse14_security NOLOGIN NOINHERIT;
    COMMENT ON ROLE warehouse14_security IS
      'Owner of security-critical objects (ledger trigger fn). NOLOGIN. Defense-in-depth: '
      'compromised warehouse14_app cannot DROP TRIGGER because warehouse14_security owns it.';
  END IF;
END$$;

-- warehouse14_app — runtime role for API + worker. LOGIN, NOINHERIT.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse14_app') THEN
    CREATE ROLE warehouse14_app LOGIN NOINHERIT;
    COMMENT ON ROLE warehouse14_app IS
      'Runtime role used by apps/api-cloud + apps/worker. SELECT, INSERT, scoped UPDATE only. '
      'NEVER DELETE. Password set externally via ALTER ROLE.';
  END IF;
END$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Default-deny on the public schema.
--    REVOKE the broad PUBLIC grants so every subsequent permission is
--    explicit and reviewable.
-- ─────────────────────────────────────────────────────────────────────
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Schema USAGE — minimum required for the roles to see objects at all.
--    Without USAGE on the schema, no GRANT on a contained object has any effect.
-- ─────────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO warehouse14_app;
GRANT USAGE ON SCHEMA public TO warehouse14_security;
-- warehouse14_migrator already has USAGE — it is running this migration.

-- ─────────────────────────────────────────────────────────────────────
-- 4. Default privileges for FUTURE objects created by warehouse14_migrator.
--
--    Every table CREATEd by the migrator from here on automatically gets:
--      • SELECT, INSERT to warehouse14_app
--      • (no DELETE, no UPDATE — those are granted per-table per-column where
--         appropriate)
--    Every sequence: USAGE to warehouse14_app.
--    Every function: EXECUTE to warehouse14_app.
--
--    A specific later migration may grant LESS (e.g. ledger_events grants
--    SELECT + INSERT only); the per-migration grant always wins.
-- ─────────────────────────────────────────────────────────────────────
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO warehouse14_app;

ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO warehouse14_app;

ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO warehouse14_app;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Backfill grants for the functions already created in migration 0002.
--    They predate the default-privilege change above and need explicit grants.
-- ─────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION berlin_business_day(TIMESTAMPTZ) TO warehouse14_app;
GRANT EXECUTE ON FUNCTION set_updated_at()                  TO warehouse14_app;

COMMIT;
