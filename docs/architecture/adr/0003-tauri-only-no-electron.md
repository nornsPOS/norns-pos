# ADR-0003 — Tauri 2 only, Electron rejected

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik

## Context

The POS terminal runs on the cashier's counter (Windows or macOS). It must:
- Talk to **serial gold scales** and **barcode scanners**
- Survive **flaky internet** without crashing the sale
- Boot fast (cashiers do not wait)
- Ship signed installers for Windows and macOS

Basel's prior project ("Oliver Roos Friseur") maintains **both** Tauri 2 and Electron shells in parallel.

## Decision

**Tauri 2 only.** Electron is rejected.

## Why

| Concern | Electron | Tauri 2 |
|---|---|---|
| Installer size | 100-200 MB | 5-15 MB |
| Memory footprint | 200-500 MB | 30-80 MB |
| Cold start | 2-5 s | < 1 s |
| Serial port access | needs `node-serialport` (native build pain) | `tauri-plugin-serialplugin` (Rust, fast) |
| Auto-update | `electron-updater` (works) | `tauri-plugin-updater` (works) |
| Code signing | mature tooling | mature tooling in v2 |
| Maintenance burden of dual stack | — | **eliminated** |

Tauri 2 closed the remaining ergonomic gaps (multi-window, IPC, plugins, dialog API).

## Consequences

**Positive:**
- One platform to maintain
- ~10× smaller installer → faster onboarding for new shops
- Smaller attack surface
- Rust side is properly typed and fast

**Negative:**
- Cannot reuse Electron-specific patterns from Oliver as-is
- Rust toolchain required for some development tasks (only when touching `src-tauri/`)
- Smaller ecosystem of pre-built plugins compared to Electron

**Mitigations:**
- Rust skill barrier is low for the cases we'll hit (most logic stays in TS frontend)
- Required plugins identified: `tauri-plugin-sql`, `tauri-plugin-serialplugin`, `tauri-plugin-updater`, `tauri-plugin-log`, `tauri-plugin-store`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-notification`

## Alternatives considered

- **Electron alone:** rejected on size/memory grounds
- **Both Electron and Tauri (Oliver pattern):** rejected — doubles maintenance with no benefit
- **PWA only:** rejected — needs serial port access and OS-level offline guarantees
- **Native (Swift / WinUI):** rejected — two codebases would be required

## References

- Tauri 2 release notes — multi-window, IPC v2, plugin API
- Oliver's `electron/` directory shows the dual-stack overhead we're avoiding
