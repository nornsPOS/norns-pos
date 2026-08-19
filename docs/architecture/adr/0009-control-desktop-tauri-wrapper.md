# ADR-0009 — Control Desktop: Tauri 2 wrapper around Next.js admin-web, with native shell guarantees the browser cannot offer

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Related:** ADR-0014 (Live Ops transport — Control Desktop is the canonical Live Ops client), ADR-0019 (Bridge UX — the actual screens this app hosts), ADR-0008 (every Control Desktop action emits a ledger event), ADR-0012 (multi-arch build pipeline), ADR-0003 (Tauri-only, Electron rejected), `docs/memory.md` §2 #30.

## Context

The owner sits at home or at the shop's back-office desk and runs Warehouse14's "bridge" — the single screen from which the entire operation is monitored and commanded. A web browser tab pointed at `admin.warehouse14.de` would deliver 80% of this. The remaining 20% is the difference between an *app* and a *tab*:

- A native OS-level notification when a duress alarm fires — bypassing the browser's silent-tab behavior.
- A persistent system-tray presence so the owner sees pending approvals at a glance, without keeping a browser window focused.
- An mTLS client certificate (ADR-0014 §2) bound to this physical machine — not stored in a browser key store that any Chrome extension can probe.
- A read-only offline cache so the owner can review yesterday's closing while flying.
- Auto-update with a single trusted signing chain — not "did you remember to refresh Chrome and accept the SW update prompt?"
- WebAuthn unlock with the OS biometric (Touch ID / Windows Hello) instead of typing a password into a browser form.
- A keyboard-driven command palette that the browser tab cannot intercept (Ctrl/Cmd+K) reliably.

This ADR defines the **Control Desktop app** that delivers these guarantees: a thin Tauri 2 shell hosting the same Next.js admin-web codebase the browser renders, plus a Rust-side native layer that owns the security-critical and OS-integration surfaces.

Constraints:

1. **Single Next.js codebase.** The admin-web rendered in a browser and rendered inside Control Desktop must be the same source — no fork, no parallel implementation.
2. **Tauri 2 only.** Electron is rejected by ADR-0003. Tauri's smaller footprint (~10 MB installer vs ~150 MB) and OS-WebView reuse fit the single-shop posture.
3. **Multi-arch builds.** Windows x64 (Basel's home PC) and macOS arm64 (Basel's MacBook) from day one. Linux deferred.
4. **Code signing mandatory.** Windows EV cert (memory.md §7), Apple Developer ID. Without them, SmartScreen / Gatekeeper warnings would erode Basel's trust in his own software.
5. **Offline read of recent data.** Reviewing yesterday's reports must not require internet — flights, internet outages, etc.
6. **One Control Desktop per machine.** Two open windows of the same app would duplicate notifications and confuse the SSE stream. Single-instance lock enforced.
7. **The Rust side owns identity and secrets.** Client cert + WebAuthn keys + cached session tokens live in the OS keychain via Tauri's `keyring` plugin — never in webview localStorage.

## Decision

### 1. Architecture — Tauri 2 shell hosts the Next.js admin-web

```
┌──────────────────────────────────────────────────────────┐
│              Control Desktop (Tauri 2 process)           │
│                                                          │
│  ┌───────────────────┐    ┌─────────────────────────┐   │
│  │  Rust core        │    │  WebView (system OS)    │   │
│  │                   │    │                          │   │
│  │  - mTLS client    │ ◄─►│  Next.js admin-web      │   │
│  │  - Keychain       │ IPC│  (loaded from           │   │
│  │  - Native notif   │    │   live.warehouse14.de   │   │
│  │  - Tray           │    │   OR local mirror)      │   │
│  │  - SSE subscriber │    │                          │   │
│  │  - Auto-updater   │    │  Bridge UX (ADR-0019)   │   │
│  │  - WebAuthn       │    │                          │   │
│  │  - Single-instance│    └─────────────────────────┘   │
│  │  - SQLite cache   │                                  │
│  └───────────────────┘                                  │
└──────────────────────────────────────────────────────────┘
              ▲                              ▲
              │ mTLS + SSE                    │ Notifications, Tray menu,
              │ (ADR-0014)                    │ Cmd-K, Touch ID prompts
              ▼                              ▼
       Oracle API                       OS shell
```

**The webview is the dumb-pipe for the UI; the Rust core is the trust boundary.** Anything that needs the OS or a secret goes through a Tauri command (typed Rust function exposed to the webview). The Next.js bundle never touches a private key, a cert, or a notification API directly.

### 2. Source-of-bundle — hybrid (cloud primary, local mirror fallback)

The Next.js admin-web is built once per release and:

- **Pushed to `live.warehouse14.de`** as the canonical URL (Caddy + Cloudflare Tunnel per ADR-0014).
- **Bundled into the Tauri release** as a static export (`next export`) for offline fallback.

On launch, Control Desktop:

1. Attempts to load `https://live.warehouse14.de` over mTLS. If successful and `version_header` matches the bundled version, render the live URL (gets ISR-fresh content).
2. If unreachable within 3 seconds, fall back to the bundled static export. Banner: "Offline mode — reviewing last-cached data."
3. If unreachable but the bundled version is older than 7 days, prompt user to retry (force a connection attempt) — stale offline is worse than no offline.

This hybrid avoids two failure modes:

- *Pure-cloud:* offline = blank screen. Unacceptable for the owner's "review yesterday's report on the train" use case.
- *Pure-bundled:* every code change requires a Tauri release + user-side update. Slow iteration, high friction.

The cloud path serves the live data and the latest UI. The bundled path serves the last-known-good UI plus the SQLite mirror's last-synced data.

### 3. mTLS client certificate — issued by step-ca, stored in OS keychain

Per ADR-0014 §2, the Control Desktop is one of three device classes that hold a client cert:

| Class                  | Lifetime | Renewal trigger    |
|------------------------|----------|--------------------|
| Control Desktop        | 90 days  | prompt re-auth at 14d remaining |

Pairing flow (one-time per machine):

1. Owner installs Control Desktop, launches it.
2. App detects no cert in keychain → "Pair this device" screen.
3. App generates a fresh CSR locally (private key never leaves the device).
4. App displays a 6-digit code + QR.
5. Owner, on his already-paired Control Desktop, runs `Admin → Devices → Pair new device`, enters the 6-digit code.
6. Cloud API verifies the code via signed challenge, calls step-ca to issue a cert against the CSR.
7. Cert returned to the new Control Desktop, stored in OS keychain (Tauri's `keyring` plugin → Keychain Access on macOS, Credential Manager on Windows).
8. From here on: every HTTPS request to `live.warehouse14.de` includes the client cert in the TLS handshake.

The private key **never** touches localStorage, never appears in a log line, never crosses the JS-Rust boundary as a value (the Rust side performs the signing operation; the webview gets back the signed result).

### 4. System tray + always-running posture

Control Desktop installs with a system-tray icon (Windows taskbar tray / macOS menu bar). The tray menu exposes:

- **Status:** 🟢 Connected · 🟡 Degraded · 🔴 Offline
- **Pending approvals:** count + click to jump
- **Unread alerts:** count + click to jump  
- **Open Bridge** (focus the main window)
- **Quit Warehouse14**

Closing the main window with the X button **hides to tray**, does not quit. Quit requires explicit tray menu or `Cmd/Ctrl+Q`. This pattern matches what owners expect from monitoring software (Slack, Discord, Linear desktop) and ensures alerts continue to arrive even when the owner switches focus.

### 5. Single-instance lock

Tauri's `tauri-plugin-single-instance` enforces one running Control Desktop per machine. A second launch attempt focuses the existing window and emits a tray notification. This prevents:

- Duplicate notification streams (the SSE listener would otherwise spawn twice).
- Conflicting mTLS sessions from the same cert.
- Confusion for the owner — "which window has the alert I just got?"

### 6. Native notifications wired to SSE

The Rust core subscribes to the SSE stream from `live.warehouse14.de/api/live/events`. When events arrive, they are forwarded to the webview via Tauri's event bus AND, for events tagged `severity=high` or `event_type IN (alert.*, duress.*, transaction.high_value_pending_approval)`, dispatched as native OS notifications via Tauri's `notification` plugin:

- macOS: NSUserNotification (Notification Center, optional alert sound)
- Windows: Toast (Action Center, optional badge on tray icon)

Click on a notification → focuses the Control Desktop window + navigates to the event's deep-link route. Implementation in `src-tauri/src/notifications.rs`.

The SSE stream is implemented in Rust (using `reqwest` with streaming response), not JavaScript. This means:

- Notifications fire even if the WebView is suspended (some OSes throttle inactive WebViews).
- The cert handshake happens in Rust's reqwest, which natively supports mTLS via `reqwest::Identity`.
- Token-refresh logic is centralized in one Rust module, not duplicated in browser JS.

### 7. Auto-update via Tauri's updater + Windows EV cert + Apple notarization

Tauri's built-in updater (`tauri-plugin-updater`) checks `https://releases.warehouse14.de/updates.json` on launch and every 6 hours. The manifest is signed with our update-signing key (separate from the code-signing cert — defense in depth):

```json
{
  "version": "0.4.2",
  "notes": "Bug fixes and improved appointments view",
  "pub_date": "2026-06-01T10:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "...",
      "url": "https://releases.warehouse14.de/control-desktop-0.4.2-x64.msi"
    },
    "darwin-aarch64": {
      "signature": "...",
      "url": "https://releases.warehouse14.de/control-desktop-0.4.2-arm64.dmg"
    }
  }
}
```

Windows installer is signed with our **EV code-signing certificate** (memory.md §7, ADR-0012). Without it, SmartScreen would warn the owner on every install — eroding trust in his own deployment. EV cert is also what allows Tauri's updater to silently install.

macOS package is **notarized via Apple's Developer ID** and stapled. Without it, Gatekeeper would block the installation.

Updates are delta-encoded where the platform supports it (Tauri 2's updater pipeline) — typical update is <5 MB even after a UI refactor.

### 8. WebAuthn / Touch ID / Windows Hello unlock

The owner does not type a password into Control Desktop daily. After the initial login (email + password + TOTP per ADR-0006), a WebAuthn passkey is registered. Subsequent unlocks (after Control Desktop has been backgrounded > 30 min or restarted):

- macOS: Touch ID prompt (system biometric, OS-managed)
- Windows: Windows Hello (face or fingerprint, OS-managed)

The passkey is stored in the OS's secure enclave (Touch ID Secure Enclave / TPM-backed Windows Hello). Tauri's `webauthn` plugin bridges the webview's `navigator.credentials` API to the OS biometric. The session cookie issued on unlock is short-lived (4 hours) and bound to the device's mTLS cert.

### 9. Cmd/Ctrl+K command palette + keyboard shortcuts

Common operations reachable without leaving the keyboard:

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+K` | Open command palette (fuzzy search across actions, customers, products, recent transactions) |
| `Cmd/Ctrl+1..7` | Jump to Bridge panel 1..7 (see ADR-0019) |
| `Cmd/Ctrl+N` | New (context-sensitive: customer / appointment / catalog item) |
| `Cmd/Ctrl+F` | Focus search bar in current panel |
| `Cmd/Ctrl+,` | Settings |
| `Cmd/Ctrl+/` | Keyboard shortcuts reference |
| `Esc` | Close modal / clear search / close command palette |

Shortcuts are registered via Tauri's `globalShortcut` plugin where they need to work even when Control Desktop is not focused (e.g. push-to-talk for the Phase 2 voice mode); window-scoped shortcuts use webview keybindings.

### 10. Local SQLite read-only mirror

A local SQLite file (`%APPDATA%/Warehouse14/cache.db` on Windows, `~/Library/Application Support/Warehouse14/cache.db` on macOS) holds a **read-only mirror** of the last 30 days of: products, customers, transactions, appointments, ledger_events (last 1000 rows). Synced via a background Rust task subscribing to `ledger_events` projections over SSE.

The mirror is **strictly read-only from the webview's perspective for any fiscal or inventory-affecting query.** It exists only to power the offline-review use case (the owner on a flight reading yesterday's closing). Two categories of write attempts during offline mode, with strict separation enforced at the Tauri command boundary:

#### Whitelisted offline writes (queued + replayed on reconnect)

Strictly limited to non-financial, non-state-changing actions. The action is written to a `pending_actions` SQLite table; a banner shows "{N} actions will sync when you reconnect." Whitelist:

| Action | Why safe offline |
|---|---|
| Add note to a customer profile | Annotative, doesn't affect any other entity |
| Add internal note to a transaction (`notes_internal` field per ADR-0008) | Envelope column, allowed to UPDATE per role grants |
| Add internal note to an appointment (`staff_notes`) | Envelope column |
| Mark a draft as "reviewed by me, defer to next admin" (read state) | Per-user UI state, no business effect |
| Tag a customer (categorization) | Metadata; conflicts on tag-name overlap resolve trivially |
| Mark a notification as read (UI state) | Per-user UI state |

On reconnect, the worker replays in `local_seq` order. Conflicts (rare, since these are append-only annotations) are resolved by "last-write-wins on the note text" with a banner that surfaces any auto-resolved conflict for the owner to review.

#### Hard-blocked offline (refused outright, never queued)

These operations require live connectivity to the cloud — they cannot be queued because their correctness depends on real-time arbitration with other channels, fiscal signing, or the inventory lock. Attempting them offline produces an immediate blocking modal: *"This action requires connectivity. Please reconnect to continue."*

| Forbidden offline action | Reason it must be live |
|---|---|
| **Approve a high-value sale** (Approval Queue) | The POS terminal is waiting in real time; an offline approval that lands 4 hours later when reconnecting may be irrelevant or harmful |
| **Lock or unlock a terminal** | Security command needs real-time delivery |
| **Push a price update** to the POS | Price discipline must be coordinated; stale offline edit could conflict with intake bot's classification |
| **Cancel an appointment** | Soft holds + customer notifications cascade; doing this offline-then-syncing means the customer may have walked in before the cancellation propagated |
| **Reserve / release an inventory item** | Per ADR-0016, the atomic reservation IS the connectivity to Postgres — there is no "offline reservation," conceptually |
| **Issue a refund** | Mollie / Stripe API call, fiscal Storno, ledger event — all require the live API |
| **Modify `tax_treatment_code` on a product** | ADR-0007 / §25a discipline — never editable offline |
| **Promote a soft hold to hard** | Cross-channel coordination required |
| **Any write to the `products`, `transactions`, `payments`, `ledger_events`, or `tse_*` tables** | Hash chain invariant from ADR-0008 cannot be extended offline — only live PG triggers can compute the next chain hash |
| **Trigger End-of-Day closing** | Daily TSE archive + DSFinV-K export must be live |
| **Approve / reject an intake draft for publishing** | Publishing creates inventory; ADR-0016's reservation contract requires Postgres |

The Tauri command boundary enforces the whitelist programmatically. The list is in `src-tauri/src/offline/whitelist.rs` and any new Tauri command must opt-in to offline-allowed status with an explicit annotation, reviewed in PR:

```rust
#[tauri::command]
#[offline_policy(OfflinePolicy::AllowQueue)]    // explicit opt-in; default is Block
async fn add_customer_note(...) -> Result<...> { ... }

#[tauri::command]
#[offline_policy(OfflinePolicy::Block)]          // explicit, also the default
async fn approve_high_value_sale(...) -> Result<...> { ... }
```

This makes the offline-policy auditable in a single file: `grep offline_policy src-tauri/src/` lists exactly which commands can fire offline.

### 11. Crash reporting — self-hosted Sentry or Tauri's built-in panic hook

Tauri panics in Rust + webview JS errors are captured by:

- **Rust side:** `tauri-plugin-log` writes panics to `%APPDATA%/Warehouse14/logs/crash-*.log`, optionally posts to a self-hosted Sentry on Oracle (Phase 1.5 — deferred until we have a crash worth investigating).
- **Webview side:** A global `window.onerror` handler + React's `ErrorBoundary` (cherry-pick from Oliver — `frontend/src/components/ErrorBoundary.tsx`) catches JS errors, displays a friendly "Something went wrong — restart Control Desktop" screen, and writes to the same crash log.

Crash logs include redacted context (no cert, no PII) and never auto-upload. The owner sees a notification: "A crash was recorded. Click to view or send to support."

### 12. Voice mode architecture slot (Phase 2)

Reserved Rust modules in `src-tauri/src/voice/`:

- `whisper_cpp.rs` — Whisper.cpp integration for local STT (no audio leaves the device)
- `wake_word.rs` — push-to-talk for V1; wake-word in Phase 2
- `command_router.rs` — maps spoken intents to Tauri commands

Not implemented in V1, but the IPC contract is defined so that Phase 2 implementation is an extension, not a refactor.

## Schema sketch — `devices` table (referenced by mTLS validation)

```sql
CREATE TABLE devices (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  device_class          TEXT         NOT NULL CHECK (device_class IN ('POS_TERMINAL', 'CONTROL_DESKTOP', 'ADMIN_WEB_BROWSER', 'WORKER')),
  hostname              TEXT,                                  -- self-reported, advisory only
  cert_serial           TEXT         NOT NULL UNIQUE,          -- step-ca-issued serial
  cert_issued_at        TIMESTAMPTZ  NOT NULL,
  cert_expires_at       TIMESTAMPTZ  NOT NULL,
  status                TEXT         NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  paired_by_user_id     UUID         NOT NULL REFERENCES users(id),
  paired_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at          TIMESTAMPTZ,
  last_seen_ip          INET,
  notes                 TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_cert_serial ON devices (cert_serial);
CREATE INDEX idx_devices_status_class ON devices (status, device_class);
```

Every Tauri command that touches business state receives the validated `device_id` from the API layer (which extracted it from the mTLS cert per ADR-0014 §3). Audit events tie back here.

## Consequences

**Positive:**
- The owner gets a real desktop application with the security guarantees a browser cannot match.
- Single codebase (Next.js) renders identically in browser and inside Tauri — zero UI duplication.
- Native notifications + system tray make the Control Desktop a true ambient monitoring tool, not a foreground tab.
- mTLS cert in the OS keychain is stronger than any browser-stored credential.
- Offline read of yesterday's data is a free benefit of the Tauri + SQLite design.
- Auto-update via signed Tauri channel is silent and trustworthy; the owner never sees a "Windows blocked this app" warning.

**Negative:**
- Code signing certs (Windows EV + Apple Developer ID) are real cash outlays (~€500/yr combined) and bureaucratic onboarding overhead. Memory.md §7 tracks the lead time; we kick this off in Phase 1.
- Two binaries (Win x64 + macOS arm64) to build, sign, and ship per release. Mitigated by GitHub Actions matrix builds.
- Tauri's WebView (WebView2 on Windows, WKWebView on macOS) may render minor visual differences vs Chrome that the owner notices. Tested on both platforms in CI via Playwright.
- The hybrid-bundle approach (cloud + offline mirror) means the webview can render two different "versions" of the UI in adjacent sessions (online = latest, offline = bundled). Banner makes the mode explicit.

**Mitigations:**
- Tauri's updater is silent for non-breaking versions; only major version bumps prompt the owner.
- Crash reporting captures the WebView render variance if it ever becomes a real issue.
- CI builds + smoke-tests both binaries on every PR.

## Alternatives considered

- **Electron.** Rejected by ADR-0003. 10× the installer size, no architectural advantage for our use case.
- **PWA (Progressive Web App) installed from the browser.** Rejected. No system tray on most OSes (Chrome PWA tray support is uneven); no native notification reliability when the browser tab is hidden; no OS keychain access for the mTLS cert.
- **Native Win + native macOS apps (Swift + WPF).** Rejected. Two parallel codebases for a single-developer team is a recipe for divergence; we'd lose the "one UI everywhere" benefit.
- **Loading the admin-web exclusively from the cloud.** Rejected — kills offline review.
- **Bundling admin-web exclusively (no live URL).** Rejected — every UI change ships as a new Tauri release; iteration too slow.
- **Auth0 / Clerk hosted SSO inside the webview.** Rejected. Out-of-jurisdiction (per ADR-0005 / ADR-0006); we use better-auth + WebAuthn instead.

## Known limits & deferred decisions

1. **No Linux build in V1.** Tauri supports it; we'll add when a Linux-using staff member needs Control Desktop. Until then, web browser access is the Linux path.
2. **No mobile (Tauri Mobile is alpha).** Phase 2; the owner uses Control Desktop on his laptop, not phone.
3. **Voice mode skeleton only.** Phase 2 fills it.
4. **Crash reporting endpoint deferred** until we have crashes to investigate. Logs collected locally meanwhile.
5. **No central device-policy management** (MDM-style enforcement of cert rotation, app version, etc.). Manual via Control Desktop's Admin → Devices panel for V1.
6. **No multi-window per Control Desktop.** Single main window + modal panels. Multi-window (e.g. "appointments in a second window") is a UX request to revisit in Phase 2.
7. **No Bluetooth / NFC integration for hardware tokens** as a second factor. WebAuthn covers the biometric path; hardware Yubikey support is added by registering a Yubikey as a passkey — no extra app code needed.

## References

- ADR-0003 — Tauri-only decision
- ADR-0006 — better-auth + WebAuthn
- ADR-0012 — multi-arch build pipeline that ships these binaries
- ADR-0014 — mTLS + SSE transport this app consumes
- ADR-0019 — the Bridge UX rendered inside this app
- ADR-0020 — Smart Appointment System this app surfaces
- Tauri 2 docs — https://tauri.app
- Oliver Roos cherry-picks: `components/UpdateBanner.tsx`, `components/UpdateSettingsCard.tsx`, `shell/EmbeddedDesktopGate.tsx`, `components/ErrorBoundary.tsx`, the trusted-device-pairing pattern
- `docs/memory.md` §2 #30, §7 (open items: Windows EV cert + Apple Developer ID)
