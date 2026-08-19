#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// set-version.mjs — one source of truth for the desktop app versions.
//
// tauri.conf.json is CANONICAL: the auto-updater compares the Tauri version, so
// that is the number that decides whether an installed copy sees an update. This
// script keeps package.json and Cargo.toml in lock-step with it, for BOTH
//
// Modes:
//   node scripts/set-version.mjs 1.0.0     Set all three files (package.json,
//                                          tauri.conf.json, Cargo.toml) for BOTH
//                                          apps to 1.0.0. Used at release time
//                                          from the pushed tag.
//   node scripts/set-version.mjs --sync    Per app, force package.json +
//                                          Cargo.toml to match THAT app's
//                                          tauri.conf.json version. A no-behavior
//                                          reconcile of existing drift.
//   node scripts/set-version.mjs --check [1.0.0]
//                                          Verify all three agree per app; if a
//                                          version is given, also assert it
//                                          equals each tauri.conf version (the
//                                          release tag guard). Exit 1 on any
//                                          mismatch, printing what disagrees.
//
// Phase 8.5 wires `--check "$TAG"` as a required status check on the release
// workflow so a mismatched tag can never publish.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

// The desktop apps under apps/<name>/ (control-desktop was removed 2026-07-19).
const APPS = ["tauri-pos"]

function paths(app) {
  const base = join(ROOT, "apps", app)
  return {
    pkg: join(base, "package.json"),
    conf: join(base, "src-tauri", "tauri.conf.json"),
    cargo: join(base, "src-tauri", "Cargo.toml"),
  }
}

function readJsonVersion(file) {
  return JSON.parse(readFileSync(file, "utf8")).version
}

function writeJsonVersion(file, version) {
  const raw = readFileSync(file, "utf8")
  const obj = JSON.parse(raw)
  if (obj.version === version) return false
  obj.version = version
  // Preserve two-space indentation + trailing newline (matches the repo style).
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`)
  return true
}

function readCargoVersion(file) {
  const m = readFileSync(file, "utf8").match(/^version\s*=\s*"([^"]+)"/m)
  return m ? m[1] : null
}

function writeCargoVersion(file, version) {
  const raw = readFileSync(file, "utf8")
  const next = raw.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`)
  if (next === raw) return false
  writeFileSync(file, next)
  return true
}

function setApp(app, version) {
  const p = paths(app)
  const changed = []
  if (writeJsonVersion(p.pkg, version)) changed.push("package.json")
  if (writeJsonVersion(p.conf, version)) changed.push("tauri.conf.json")
  if (writeCargoVersion(p.cargo, version)) changed.push("Cargo.toml")
  console.log(
    `  ${app}: ${version}` + (changed.length ? `  (updated ${changed.join(", ")})` : "  (already consistent)"),
  )
}

function checkApp(app, expected) {
  const p = paths(app)
  const conf = readJsonVersion(p.conf)
  const pkg = readJsonVersion(p.pkg)
  const cargo = readCargoVersion(p.cargo)
  const problems = []
  if (pkg !== conf) problems.push(`package.json ${pkg} != tauri.conf ${conf}`)
  if (cargo !== conf) problems.push(`Cargo.toml ${cargo} != tauri.conf ${conf}`)
  if (expected && conf !== expected) problems.push(`tauri.conf ${conf} != tag ${expected}`)
  if (problems.length) {
    console.error(`  ✗ ${app}: ${problems.join("; ")}`)
    return false
  }
  console.log(`  ✓ ${app}: ${conf}${expected ? " (matches tag)" : ""}`)
  return true
}

const [mode, arg] = process.argv.slice(2)

if (mode === "--check") {
  const expected = arg ? arg.replace(/^v/, "") : null
  if (expected && !SEMVER.test(expected)) {
    console.error(`Invalid version: ${arg}`)
    process.exit(2)
  }
  console.log("Version check (tauri.conf.json is canonical):")
  const ok = APPS.map((a) => checkApp(a, expected)).every(Boolean)
  process.exit(ok ? 0 : 1)
} else if (mode === "--sync") {
  console.log("Reconciling package.json + Cargo.toml to each app's canonical tauri.conf version:")
  for (const app of APPS) setApp(app, readJsonVersion(paths(app).conf))
} else if (mode && SEMVER.test(mode.replace(/^v/, ""))) {
  const version = mode.replace(/^v/, "")
  console.log(`Setting all desktop apps to ${version}:`)
  for (const app of APPS) setApp(app, version)
} else {
  console.error("Usage: set-version.mjs <x.y.z> | --sync | --check [<x.y.z>]")
  process.exit(2)
}
