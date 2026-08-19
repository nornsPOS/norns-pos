# Security Policy

## Supported versions

The latest GitHub release is the only supported version. Older releases
do not receive security patches — the in-app auto-updater (memory.md
§25) keeps every installation on the latest tag automatically.

## Reporting a vulnerability

Please **do not** open a public issue for security-impacting bugs. The
audit log in memory.md §19 (Brutal Audit) calls out the invariants that
must hold; breaking any of them is the kind of report this policy
exists to handle.

Send disclosures to **security@warehouse14.de** with subject
`[SECURITY] <short title>`. Include:

- Affected version (visible in app → Werkstatt footer or
  `Get-AppxPackage` / `/Applications/Warehouse14 POS.app/Contents/Info.plist`)
- Reproduction steps (a single `curl` against the local API counts)
- Expected vs observed behaviour
- Suggested mitigation if one comes to mind

Acknowledgement within 72 hours. Coordinated disclosure timeline is
case-by-case, generally 30–90 days depending on severity. The reporter
is credited in the release notes unless they request anonymity.

## Locked invariants (memory.md §24.6)

The following six contracts must NOT regress. Any patch that breaks one
re-opens a closed Brutal-Audit finding and is treated as a security
regression:

1. `inventory-lock.finalize()` / `release()` match BOTH
   `reserved_by_session_id` AND `reserved_by_user_id`.
2. `POST /api/transactions/finalize` requires a client-supplied
   `idempotencyKey` (UUIDv4); the partial UNIQUE index
   `transactions_idempotency_key_uniq` enforces at-most-once.
3. `AppShell.handleSignOut` iterates `PER_OPERATOR_STORAGE_KEYS` and
   removes each from `localStorage`.
4. `BezahlenDialog` `submit` / `submitCard` open with an
   `inFlightRef.current` synchronous mutex check.
5. `toStorefrontProduct(row)` in `routes/storefront-catalog.ts` is the
   ONLY place that decides which product columns become public —
   `acquisition_cost_eur` and PII linkage must NOT appear.
6. (Entfallen am 19.08.2026: der Fernwerkzeug-Endpunkt und sein
   Protokoll sind mit Wanderung 0149 ausgezogen.)

## Update-signature key handling

The Tauri auto-updater verifies a minisign signature against the
public key embedded in `apps/tauri-pos/src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`). The matching private key lives in:

- The operator's password manager (cold backup), and
- The GitHub Actions repository secret `TAURI_SIGNING_PRIVATE_KEY`.

It MUST NOT live in the repository, on any developer's laptop, or in
any CI environment other than the official release pipeline. Rotating
the key is a deliberate breaking change: every installed copy stops
accepting updates until they are re-installed manually. The Phase 1.5
backlog (#I-42) carries the runbook for graceful key rotation.

## macOS code-signing (ad-hoc, not Apple Developer ID)

The desktop bundles are **ad-hoc codesigned** (`codesign -s -`, configured
via `bundle.macOS.signingIdentity = "-"`), **not** Apple Developer-ID
signed or notarized. This is a deliberate cost/scope choice for the
current phase, with one hard requirement: the signature must be
*internally consistent*.

- **Why ad-hoc and not nothing.** On Apple Silicon every Mach-O must
  carry at least an ad-hoc signature to execute, so the linker always
  emits one on the main binary. If the surrounding `.app` is then never
  bundle-signed, the executable advertises sealed resources that do not
  exist (`Contents/_CodeSignature/CodeResources` is absent) — an
  *inconsistent* state Gatekeeper reports as **"is damaged and can't be
  opened"**. Bundle-signing ad-hoc generates `CodeResources`, making the
  signature consistent, so a fresh install shows the ordinary
  **"unidentified developer"** prompt instead — resolvable by the user
  (Finder right-click → Open, or the `xattr` quarantine strip documented
  in `README.md`).
- **CI gate.** `.github/workflows/release.yml` runs
  `codesign --verify --deep --strict` on the built `.app` and asserts
  `Contents/_CodeSignature/CodeResources` exists, failing the release if
  the bundle ever regresses to the inconsistent ("damaged") state.
- **Auto-updates are unaffected.** The Tauri updater verifies its own
  minisign signature (see above) independently of macOS code-signing.
- **Go-live upgrade path.** For a friction-free first launch (no prompt
  at all), the bundles must be Apple Developer-ID signed **and**
  notarized — an Apple Developer account + a Developer-ID certificate +
  notary credentials in CI. Tracked as a go-live decision; until then
  the documented one-time first-launch step stands.

## DSGVO / GoBD context

The POS handles PII (customer KYC documents, payment details) and
fiscal-grade records (TSE-signed transactions, ledger hash chain).
Any vulnerability affecting integrity or confidentiality of either is
treated as a P0 incident. The same `security@warehouse14.de` address
receives both technical disclosures and the formal data-protection
incident notifications required under DSGVO Art. 33.
