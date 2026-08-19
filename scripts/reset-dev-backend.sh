#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# DEV-ONLY — reset + seed the LOCAL Norns dev backend (engine + Postgres).
#
# NEVER run against production. Everything here targets the local Docker
# Postgres and the local api-cloud on this Mac.
# 14.08.2026: gerettet aus apps/mobile/dev/ bei der Trennung von warehouse14.
# The device-fingerprint unblock below is a DEV SEED — it must retire for real
# per-phone mTLS at go-live (see apps/api-cloud/src/plugins/mtls.ts).
#
# Why this exists: `pnpm --filter @norns/api-cloud dev:bootstrap` skips
# migrations whenever the `users` table already exists, so a DB that was seeded
# before a later migration stays DRIFTED (e.g. missing products.storage_kind →
# staff product routes 500). And its `sql.unsafe(whole-file)` applier batches
# each migration into one implicit transaction, which breaks files that do
# `ALTER TYPE … ADD VALUE` then use the value (migration 0039, error 55P04).
# The canonical applier is infrastructure/docker/migrate.sh (psql, per-file).
# This script does a clean drop + per-file psql apply, then seeds.
#
# Result: Owner `basel@warehouse14.local` (role ADMIN, is_owner, PIN 0000) +
# a paired dev `devices` row (cert_serial = the dev cert SHA-256) + 20 demo
# products. The mobile app injects that fingerprint via the
# `X-Dev-Device-Fingerprint` header (dev bypass of the mTLS wall).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PG=warehouse14-postgres
SU="postgres://warehouse14:warehouse14_dev_pw@localhost:5432/warehouse14_dev"
MIG="$(grep '^MIGRATOR_DATABASE_URL=' .env | cut -d= -f2- | tr -d '"')"
psql_su() { docker exec -i "$PG" psql "$SU" -v ON_ERROR_STOP=1 -q "$@"; }
psql_mig() { docker exec -i -e PGOPTIONS="-c check_function_bodies=off" "$PG" psql "$MIG" -v ON_ERROR_STOP=1 -q "$@"; }

echo "[reset] stopping any local api-cloud on :3001"
lsof -ti tcp:3001 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

echo "[reset] drop + recreate warehouse14 (clean schema)"
psql_su -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='warehouse14' AND pid<>pg_backend_pid();" >/dev/null
psql_su -c "DROP DATABASE IF EXISTS warehouse14;"
psql_su -c "ALTER ROLE warehouse14_migrator SUPERUSER;"   # 0001 creates untrusted extensions
psql_su -c "CREATE DATABASE warehouse14 OWNER warehouse14_migrator;"

echo "[reset] apply all migrations (per-file psql, like migrate.sh)"
psql_mig -c "CREATE TABLE IF NOT EXISTS _w14_schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"
for f in packages/db/migrations/*.sql; do
  base="$(basename "$f")"
  psql_mig -f - < "$f"
  psql_mig -c "INSERT INTO _w14_schema_migrations (filename) VALUES ('$base');"
  echo "  ✓ $base"
done

echo "[reset] seed Owner + dev device (dev:bootstrap) and demo products (dev:seed)"
pnpm --filter @norns/api-cloud dev:bootstrap
pnpm --filter @norns/api-cloud dev:seed

echo "[reset] dev device fingerprint (put this in apps/mobile EXPO_PUBLIC_DEV_DEVICE_FINGERPRINT):"
psql_mig -tAc "SELECT cert_serial FROM devices LIMIT 1;"

cat <<'EOF'

[reset] DONE. Start the server (AUTH_SECRET + KYC_IMAGE_ENCRYPTION_KEY are
required and intentionally NOT in .env):
  mkdir -p /tmp/w14-photos /tmp/w14-kyc
  cd apps/api-cloud
  AUTH_SECRET="dev-local-poc-secret-please-change-0123456789abcdef" \
  TRUSTED_ORIGINS="http://localhost:8081,http://192.168.179.93:8081" \
  PHOTOS_DIR="/tmp/w14-photos" \
  PHOTOS_PUBLIC_BASE_URL="http://192.168.179.93:3001" \
  KYC_IMAGE_ENCRYPTION_KEY="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')" \
  KYC_PHOTOS_DIR="/tmp/w14-kyc" \
  pnpm exec tsx watch --env-file-if-exists=../../.env src/server.ts

  # PHOTOS_DIR overrides the non-writable /data default (the LOCAL photo store);
  # PHOTOS_PUBLIC_BASE_URL overrides the PRODUCTION default so served photo URLs
  # are dev-local (the LAN IP, so a phone can load <Image> too). R2 is unset on
  # purpose — uploadDirect uses the server-side LOCAL store, no R2 creds needed.
  # KYC_IMAGE_ENCRYPTION_KEY is the dedicated 32-byte AES key for the SERVER KYC
  # store (migration 0074, REQUIRED — the server won't boot without it); a fresh
  # random dev key is generated inline. KYC_PHOTOS_DIR holds the encrypted .enc
  # files. Use a STABLE key if you want stored Ausweis images to survive a
  # restart (a fresh key can't decrypt files written under the old one).

Login:  Owner basel@warehouse14.local · PIN 0000 · role ADMIN (is_owner)
EOF
