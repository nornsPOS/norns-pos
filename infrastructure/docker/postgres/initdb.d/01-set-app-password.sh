#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Local-dev initdb: pre-seed the warehouse14_app role's password.
#
# The role itself is created by migration 0003_roles.sql (which runs against
# the migrator role). This initdb step ensures that when an app developer
# runs `pnpm db:migrate && pnpm dev` for the first time, the app role's
# password is already set so apps/api-cloud can connect without a separate
# manual ALTER ROLE step.
#
# Note: at the moment this initdb script runs, migration 0003 has NOT yet
# run (initdb is before any user migrations). So we cannot ALTER ROLE
# directly — the role does not exist yet. Instead we pre-create a tiny stub
# role with the password and let migration 0003's `IF NOT EXISTS` guard
# leave the password in place.
#
# Production parallel: ALTER ROLE … PASSWORD … sourced from Oracle Vault.
# This dev convenience script is NEVER used in production.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

psql --variable=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<-EOSQL
  -- Pre-create warehouse14_app with the dev password. Migration 0003 will see
  -- it already exists and leave it (DO IF NOT EXISTS guard).
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'warehouse14_app') THEN
      CREATE ROLE warehouse14_app LOGIN NOINHERIT PASSWORD 'warehouse14_app_dev_pw';
    END IF;
  END\$\$;
EOSQL

echo "[initdb] warehouse14_app role pre-created with dev password."
