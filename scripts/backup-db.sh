#!/usr/bin/env bash
#
# backup-db.sh — encrypted, off-site PostgreSQL backups to Cloudflare R2 via
# Restic (Decision #23 — Object Storage / R2).
#
# The dump is streamed directly into restic over stdin, so no unencrypted SQL
# file is ever written to local disk. Restic encrypts client-side before the
# bytes leave the host, then we prune to a 7-daily / 4-weekly retention window.
#
# Required environment:
#   RESTIC_REPOSITORY  e.g. s3:https://<account>.r2.cloudflarestorage.com/<bucket>
#   RESTIC_PASSWORD    restic repository encryption password
#   DATABASE_URL       postgres:// connection string for pg_dump
#   (for R2/S3) AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in the environment
#
# Usage:  RESTIC_REPOSITORY=... RESTIC_PASSWORD=... DATABASE_URL=... ./scripts/backup-db.sh
#
set -Eeuo pipefail

# `set -o pipefail` above makes the pg_dump | restic pipeline fail if EITHER
# side errors, so a failed dump can never be silently backed up as empty.

log() { printf '[backup-db] %s\n' "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

# ── 1. Validate required environment ────────────────────────────────────────
missing=()
for var in RESTIC_REPOSITORY RESTIC_PASSWORD DATABASE_URL; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  die "missing required env var(s): ${missing[*]}"
fi

command -v pg_dump >/dev/null 2>&1 || die "pg_dump not found on PATH"
command -v restic  >/dev/null 2>&1 || die "restic not found on PATH"

# ── 2. Ensure the restic repository exists (idempotent) ─────────────────────
if ! restic cat config >/dev/null 2>&1; then
  log "initializing restic repository at ${RESTIC_REPOSITORY}"
  restic init
fi

# ── 3. Dump + stream directly into restic over stdin (no file on disk) ──────
HOSTNAME_TAG="$(hostname 2>/dev/null || echo unknown)"
log "starting pg_dump → restic backup (stdin)"
pg_dump --no-owner --no-privileges --clean --if-exists "${DATABASE_URL}" \
  | restic backup \
      --stdin \
      --stdin-filename postgres-backup.sql \
      --tag warehouse14-postgres \
      --host "${HOSTNAME_TAG}"

# ── 4. Enforce retention: 7 daily + 4 weekly, prune the rest ────────────────
log "applying retention policy (keep-daily 7, keep-weekly 4) + prune"
restic forget \
  --tag warehouse14-postgres \
  --keep-daily 7 \
  --keep-weekly 4 \
  --prune

log "backup complete"
