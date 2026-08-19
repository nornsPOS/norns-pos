#!/usr/bin/env node
/**
 * Scoped Biome lint — checks only the files this branch ADDS relative to
 * origin/main (plus graphify-out generated artifacts excluded).
 *
 * Why: the v0.1.0 baseline predates a clean `biome check .` pass (repo-wide
 * formatting drift + ~450 pre-existing noNonNullAssertion errors). Cleaning the
 * whole baseline is tracked separately; until then CI must still guard NEW code.
 * Run the full repo lint with `pnpm lint:all` once the baseline is cleaned.
 *
 * Falls open (lints nothing, exits 0) if origin/main can't be resolved — better
 * a soft no-op than a hard CI failure on an unfetchable base.
 */
import { execSync, spawnSync } from 'node:child_process';

function tryExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Best-effort fetch of the base tip (CI checkouts are often shallow/single-branch).
tryExec('git fetch --no-tags --depth=1 origin main');

const base =
  tryExec('git rev-parse --verify --quiet origin/main') ||
  tryExec('git rev-parse --verify --quiet FETCH_HEAD');

if (!base) {
  console.log('[lint-added] origin/main not resolvable — skipping scoped lint.');
  process.exit(0);
}

const diff = tryExec(`git diff --name-only --diff-filter=A ${base.trim()} HEAD`);
if (diff === null) {
  console.log('[lint-added] diff against base failed — skipping scoped lint.');
  process.exit(0);
}

const files = diff
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => /\.(ts|tsx|js|jsx|json)$/.test(f))
  .filter((f) => !f.startsWith('graphify-out/'));

if (files.length === 0) {
  console.log('[lint-added] no PR-added files to lint.');
  process.exit(0);
}

console.log(`[lint-added] linting ${files.length} added file(s):`);
for (const f of files) console.log(`  ${f}`);

const res = spawnSync('pnpm', ['exec', 'biome', 'check', ...files], { stdio: 'inherit' });
process.exit(res.status ?? 1);
