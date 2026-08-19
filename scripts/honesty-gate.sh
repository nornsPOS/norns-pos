#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# honesty-gate.sh — the desktop doctrine (a)/(b) leak counter.
#
# Greps the OPERATOR-FACING desktop source (apps/tauri-pos/src +
# for the frozen set of patterns that let a raw
# machine string reach a human, or bake a dev URL into a shipped build:
#
#   err.message / error.message / j.error.message   — raw wire text to the UI
#   ?? err                                          — raw-token enum fallback
#   humanizeEnum                                    — ad-hoc English-ish deriver
#   localhost:3001                                  — dev API in operator code
#
# Phase 0: WARN-ONLY. It prints the live count and every hit, and exits 0 so it
# never blocks a merge yet. Phase 2 (the parity sweep) drives this exact set to
# ZERO, then flips the gate to fail-on-nonzero by running it with STRICT=1.
#
# The baseline is whatever THIS set returns today (~89 at Phase 0), never a
# hand-typed number — the sweep and the gate can therefore never disagree.
#
# Usage:
#   bash scripts/honesty-gate.sh          # warn-only: print count + hits, exit 0
#   STRICT=1 bash scripts/honesty-gate.sh # fail (exit 1) when the count is > 0
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The frozen regex set. Kept as one array so the sweep target and the gate are
# literally the same list.
PATTERNS=(
  'err\.message'
  'error\.message'
  'j\.error\.message'
  '\?\? err'
  'humanizeEnum'
  'localhost:3001'
)

# Operator-facing desktop source only. Exclude tests and generated declarations —
# a leak in a *.test.ts never reaches a human.
SEARCH_DIRS=(
  "apps/tauri-pos/src"
)

alt="$(IFS='|'; echo "${PATTERNS[*]}")"

hits="$(
  grep -REn "${alt}" "${SEARCH_DIRS[@]}" \
    --include='*.ts' --include='*.tsx' \
    2>/dev/null \
    | grep -v -E '\.test\.tsx?:' \
    | grep -v -E '\.d\.ts:' \
    || true
)"

count="$(printf '%s' "$hits" | grep -c . || true)"

echo "─────────────────────────────────────────────────────────────"
echo "  Honesty gate — raw-token / dev-URL leaks in desktop UI code"
echo "─────────────────────────────────────────────────────────────"
if [ "$count" -gt 0 ]; then
  printf '%s\n' "$hits"
  echo "─────────────────────────────────────────────────────────────"
fi
echo "  Total leaks: ${count}"
echo "  Patterns:    err.message · error.message · j.error.message · ?? err · humanizeEnum · localhost:3001"
echo "  Scope:       apps/tauri-pos/src (excl. tests, .d.ts)"

# Phase 2.1 complete — the sweep drove this to ZERO, so the gate is now STRICT by
# DEFAULT: any reintroduced raw-error / token / dev-URL leak fails. Downgrade to
# warn-only with STRICT=0 only if you must.
if [ "${STRICT:-1}" = "1" ] && [ "$count" -gt 0 ]; then
  echo "  STRICT mode: FAIL — a leak was reintroduced. Route it through describeError/germanLabel (@norns/i18n-de), not raw wire text." >&2
  exit 1
fi
if [ "${STRICT:-1}" = "1" ]; then
  echo "  Mode: STRICT (fails on any leak). Currently clean."
else
  echo "  Mode: warn-only (STRICT=0)."
fi

# ── House-style guard: no em/en dash in user-facing UI text ──────────────────
# (comment-aware; the 2026-07-08 repo-wide dash purge stays enforced). Runs after
# the token check so both rules are covered by the single `honesty-gate.sh` call.
echo "─────────────────────────────────────────────────────────────"
if node "$ROOT/scripts/no-userfacing-dashes.mjs"; then
  :
elif [ "${STRICT:-1}" = "1" ]; then
  echo "  STRICT mode: FAIL — a user-facing em/en dash was reintroduced. Use a comma, a full stop, or \"bis\"." >&2
  exit 1
else
  echo "  (warn-only) user-facing em/en dash present."
fi

exit 0
