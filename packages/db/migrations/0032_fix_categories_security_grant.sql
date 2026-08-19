-- ──────────────────────────────────────────────────────────────────────────
-- Migration 0032 — Fix categories SELECT grant for warehouse14_security
--
-- WHY
-- ───
-- Migration 0025 created the trigger function `enforce_no_grandparent_category()`
-- as SECURITY DEFINER owned by warehouse14_security but did NOT grant the
-- security role SELECT on `categories`. The function body queries:
--
--   SELECT parent_id FROM categories WHERE id = NEW.parent_id;
--
-- Because SECURITY DEFINER runs as the function's owner, any non-app role
-- (e.g. warehouse14_migrator running a seed script, or warehouse14_worker)
-- triggers `permission denied for table categories` (SQLSTATE 42501) from
-- *inside* the trigger as soon as it inserts a child category.
--
-- Latent until apps/api-cloud/scripts/seed-test-data.ts started exercising
-- the path via warehouse14_migrator; the runtime warehouse14_app role
-- already has SELECT (migration 0025 line 123) so production was unaffected.
--
-- WHAT
-- ────
-- Single grant: SELECT on categories for warehouse14_security. The trigger
-- function only reads `parent_id`; SELECT is the minimum required and
-- mirrors the analogous setup for `enforce_no_grandparent` on products
-- (migration 0020), where the security role already had read access via
-- the products grants chain.
--
-- WHAT THIS IS NOT
-- ────────────────
-- Not a schema change. Not a behavior change for warehouse14_app. The
-- only observable effect is that trigger-firing INSERT/UPDATE statements
-- run by other roles now succeed instead of raising 42501.
--
-- Idempotent: GRANT is idempotent in PostgreSQL — re-running is a no-op.
-- Transactional: BEGIN/COMMIT wraps the single statement so failure rolls
-- back cleanly (defensive — there is no realistic failure mode).
-- ──────────────────────────────────────────────────────────────────────────

BEGIN;

GRANT SELECT ON categories TO warehouse14_security;

COMMIT;
