#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Local-dev initdb: create the warehouse14_migrator role.
#
# Postgres runs every file in /docker-entrypoint-initdb.d/ exactly once, on a
# fresh data volume. To re-run after the volume already exists:
#
#     docker compose down -v
#     docker compose up -d
#
# Production parallel: scripts/bootstrap-oracle.sh on the Oracle VM (ADR-0012 §9).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Connect as the superuser the docker-compose POSTGRES_USER created.
psql --variable=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<-EOSQL
  -- Migrator role:
  --   * CREATEROLE -- creates warehouse14_app + warehouse14_security in 0003_roles.sql.
  --   * SUPERUSER  -- DEV ONLY. Migration 0001 creates the vector +
  --     pg_stat_statements extensions, both UNTRUSTED, so CREATE EXTENSION
  --     requires a superuser. This is the "local-dev superuser" migration 0001's
  --     header anticipates. Production NEVER uses this file (the prod migrator is
  --     provisioned by scripts/bootstrap-oracle.sh with extensions pre-installed).
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    CREATEROLE
    SUPERUSER
    PASSWORD 'warehouse14_migrator_dev_pw';

  -- Ownership and write access on the public schema, so migrations can create
  -- objects whose default privileges land per ADR-0008 section 3.
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;

  -- The application database. The postgres image only auto-creates POSTGRES_DB
  -- (warehouse14_dev, this maintenance DB); the app + migrations target
  -- warehouse14. Owned by the migrator so migration 0003 ALTER DEFAULT PRIVILEGES
  -- FOR ROLE warehouse14_migrator governs every table it creates (warehouse14_app
  -- inherits SELECT/INSERT). Without this, "down -v" then "pnpm dev" fails with:
  -- database "warehouse14" does not exist.
  CREATE DATABASE warehouse14 OWNER warehouse14_migrator;
EOSQL

echo "[initdb] warehouse14_migrator role (+ SUPERUSER) and warehouse14 database created."
