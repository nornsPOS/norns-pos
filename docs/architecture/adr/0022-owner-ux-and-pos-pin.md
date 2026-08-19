# ADR-0022 — Owner UX policy + POS PIN authentication: fast cashier login with banking-grade depth defense

- **Status:** Accepted (Basel directive 2026-05-25 mid Day-12 planning)
- **Date:** 2026-05-25
- **Deciders:** Basel (the Owner), Technik
- **Related:** ADR-0006 (better-auth library choice), ADR-0008 §3 (RBAC roles), ADR-0009 (mTLS device identity — the first layer of defense this ADR builds on), ADR-0014 (Bridge UX session model), ADR-0018 §5 (duress PIN — sibling concept on different threat surface), ADR-0021 (the API architecture this auth lives inside), dazu das interne Arbeitsheft (nicht veröffentlicht).

## Context

Day 12 of the API construction reached an architectural fork. Basel — as the **sole operator** for V1 and the **Owner** of the business — issued a strategic directive:

> "I refuse to let security become bureaucracy that blocks me from my daily work. Build the steel walls — but make sure the master key in my hand passes through them invisibly."

Two earlier auth proposals were rejected after consideration:

1. **WebAuthn-only passkeys** (initially recommended). Rejected because the POS UX expectation is "tap a number, the drawer opens" — a fingerprint sensor is fine at home but creates friction during a customer transaction. Cashiers historically expect a 4-digit PIN at a POS terminal; deviating from that mental model burns staff training and customer perception.

2. **Long sessions with periodic full re-auth** (email + password + TOTP every N days). Rejected because Owner does ~50 actions/day, many requiring step-up — periodic full re-auth is the bureaucracy that Basel rejected.

The accepted model is **classic POS PIN, layered on top of mTLS, with full-auth as the recovery path** — what banks have used for ATMs for 40 years. Short PIN ⇔ strict lockout; lockout ⇔ full unlock; full unlock ⇔ email/password/TOTP. Each layer compensates for the weakness of the layer above.

## Decision

### 1. The moral framework — what CANNOT be bypassed even for the Owner

There is a class of guarantees that the database refuses to relax for ANY actor. This is the **legal floor** — the §259 StGB / GoBD / KassenSichV / EU-sanctions floor — that the Red Team Audit + migration 0013 just cemented in `BEFORE INSERT` SECURITY DEFINER triggers.

The Owner has zero ability to disable these. This protects the Owner too: if the Owner's account is compromised, the attacker cannot tamper with fiscal evidence.

| Guarantee | Where enforced | Bypassable by Owner? |
|---|---|---|
| Sanctions hard-block on transactions | `transactions_validate_sanctions` (C-2) | ❌ No |
| FINALIZED business-day immutability | `transactions_validate_closing_day` (C-3) | ❌ No |
| Ankauf requires customer_id | `transactions_ankauf_requires_customer` CHECK | ❌ No |
| SHA-256 hash chain on ledger | `ledger_compute_hash` (migration 0008) | ❌ No |
| No DELETE on fiscal tables | Role grants (migration 0003 + per-table) | ❌ No |
| Audit log INSERT on every action | DB role grants + SECURITY DEFINER triggers | ❌ No — **especially logged for Owner** |
| Initial 2FA registration | better-auth `twoFactor` + Day-12 wiring | ❌ No (registers once per identity) |

### 2. What IS made invisible — the UX layer

These are the friction sources that the Owner directive eliminates **at the API + UI layer**, while every relaxation is still recorded in `audit_log` so it leaves a trace:

| Friction source | Owner relaxation | Recorded as |
|---|---|---|
| Email + password every login | **4-digit PIN** on a mTLS-paired device | `actor.auth_method = 'pin'` in audit row |
| 8-hour session forces re-login mid-day | **30-day rolling** for Owner | `session.ttl_days = 30` |
| 2FA prompt every login | TOTP only at first device-pairing; PIN thereafter | Device-pairing creates audit `device.paired` |
| Login rate-limit per IP | Owner exempt from app-level rate-limit (Cloudflare/edge still applies) | `owner.rate_limit_skipped` |
| Approval-queue for own actions | Auto-approves Owner-initiated actions | `owner.auto_approved_self` in payload |
| Sensitive-action step-up | PIN, not full re-auth | `actor.last_step_up_at` recorded |

**The asymmetry is deliberate.** The DB layer cannot tell apart "Basel typed it" from "an attacker pretending to be Basel" — so it never lowers its guard. The API/UI layer DOES know (mTLS + PIN + session), so it relaxes friction for the verified Owner.

### 3. Schema delta — migration 0014

```sql
-- 3a. The single-Owner flag.
ALTER TABLE users ADD COLUMN is_owner BOOLEAN NOT NULL DEFAULT FALSE;

-- AT MOST ONE row can have is_owner = TRUE (partial unique index).
CREATE UNIQUE INDEX users_only_one_owner_uq
  ON users ((is_owner)) WHERE is_owner = TRUE;

-- Owner must also be ADMIN (consistency).
ALTER TABLE users ADD CONSTRAINT users_owner_implies_admin
  CHECK (is_owner = FALSE OR role = 'ADMIN');

-- 3b. POS PIN — argon2id-hashed 4-digit code, per-user.
-- NULLable: not every user has POS access (e.g. READONLY Steuerberater).
ALTER TABLE users ADD COLUMN pos_pin_hash             TEXT;
ALTER TABLE users ADD COLUMN pos_pin_set_at           TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN pos_pin_failed_attempts  INTEGER     NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN pos_pin_locked_until     TIMESTAMPTZ;

ALTER TABLE users ADD CONSTRAINT users_pin_hash_set_together
  CHECK ((pos_pin_hash IS NULL AND pos_pin_set_at IS NULL)
      OR (pos_pin_hash IS NOT NULL AND pos_pin_set_at IS NOT NULL));

ALTER TABLE users ADD CONSTRAINT users_pin_attempts_nonneg
  CHECK (pos_pin_failed_attempts >= 0);

-- 3c. Step-up tracking — added to sessions table so step-up is per-session
-- (not per-user — a hostile session shouldn't be able to forge step-up).
ALTER TABLE sessions ADD COLUMN last_pin_step_up_at TIMESTAMPTZ;
```

### 4. The authentication flow

#### 4a. First time on a fresh device — Full Login

```
Device:    POS terminal (mTLS cert provisioned by Owner at pairing)
Sequence:
  1. Browser/Tauri POSTs /api/auth/sign-in with { email, password }.
  2. Server: better-auth verifies credentials.
  3. If two_factors row exists for user → server demands TOTP.
  4. POST /api/auth/two-factor/verify with { code }.
  5. Server: better-auth creates session → session cookie.
  6. UI: if user.pos_pin_hash is NULL → prompt "set 4-digit PIN".
  7. POST /api/auth/pin/set with { pin: "XXXX" }.
  8. Server: argon2id-hash, store, set pos_pin_set_at = now().
  9. Audit: 'auth.full_login' + 'pin.set'.
```

#### 4b. Daily morning login — Fast PIN

```
Device:    Already-paired terminal (mTLS cert still valid)
Sequence:
  1. UI shows numeric keypad ONLY (no email field).
  2. UI POSTs /api/auth/pin-login with { pin: "XXXX" }.
  3. Server identifies the user via mTLS device cert → devices.paired_by_user_id.
     (Future multi-cashier per terminal: UI shows avatar list, picks one, then PIN.)
  4. If pos_pin_locked_until > now() → 423 Locked → UI forces Full Login.
  5. Argon2id-verify the PIN.
     ✗ wrong → pos_pin_failed_attempts++; if = 5 → set pos_pin_locked_until = now() + 30 min;
                 audit 'pin.failed' (or 'pin.locked' if 5th); return 401.
     ✓ right → pos_pin_failed_attempts := 0; pos_pin_locked_until := NULL.
  6. Create better-auth session with TTL = (is_owner ? 30d rolling : 8h fixed).
  7. Audit: 'auth.pin_login' { actor_id, device_id, is_owner }.
```

#### 4c. Sensitive action — Step-Up

```
Sensitive routes (configured in src/lib/auth-policy.ts):
  • POST /transactions/finalize             (cash, sale, ankauf)
  • POST /transactions/:id/storno           (reversal)
  • POST /closing/finalize                  (Z-report)
  • POST /dsfinvk-exports                   (legal export)
  • POST /users (create user / promote role)
  • POST /devices (pair new device)

Middleware: requireStepUp({ maxAgeMinutes: 5 })
  1. Read session.last_pin_step_up_at.
  2. If now - last_pin_step_up_at < 5 min → pass.
  3. Else → 403 { code: 'STEP_UP_REQUIRED' }.
     UI catches this code → modal "Enter PIN to confirm".
     POST /api/auth/step-up with { pin: "XXXX" }.
     ✓ → session.last_pin_step_up_at := now() → UI retries original request.
     ✗ → same brute-force rules as login (failed_attempts++, lockout at 5).
```

#### 4d. Lockout recovery

```
pos_pin_locked_until set → PIN paths refuse → user must Full Login.
After successful Full Login + TOTP:
  pos_pin_failed_attempts := 0
  pos_pin_locked_until    := NULL
Audit: 'pin.unlocked_via_full_auth'.
```

#### 4e. PIN strength validation

`@norns/auth-pin` checks new PINs against:

- Format: exactly 4 ASCII digits 0–9 (regex `^\d{4}$`).
- **Blacklist** (production-only — dev seeds may use `0000`):
  - All same digit (`0000`, `1111`, …, `9999`).
  - Sequential ascending (`0123`, `1234`, …, `6789`).
  - Sequential descending (`9876`, `8765`, …, `3210`).
  - Common-leaks list of ~20 PINs (`1004`, `2580`, `7777`, etc.).

The dev bootstrap seeds Basel's user with PIN `0000` — but **production refuses** any of the blacklisted PINs at `/api/auth/pin/set`. Operators set their real PIN before going live.

### 5. Brute-force defense — depth

| Layer | Cost to attacker |
|---|---|
| 10,000 4-digit combinations | Trivial in isolation. |
| 5 attempts → 30 min lockout | Worst case ≈ 2,000 attempts/day ⇒ ≥ 4 days to exhaust. |
| Lockout forces Full Login | Attacker needs ALSO email + password + TOTP. |
| mTLS device cert | Attacker needs ALSO physical device or extracted cert + private key. |
| Audit log on every failed attempt | Operator sees the attack in the Bridge anomaly panel. |
| SECURITY DEFINER triggers | Even after compromise: cannot tamper fiscal history. |

The 4-digit PIN, combined with mTLS + lockout, has effective brute-force cost **higher than** an 8-character alphabetic password without lockout. Convention beats theoretical entropy.

### 6. Future scaling — when Basel hires staff

When a second user is added:

- `is_owner` partial UNIQUE refuses a second `TRUE` → there is **only one Owner**.
- New ADMIN users get `is_owner = FALSE` → none of the Owner UX relaxations apply:
  - 8-hour fixed session, not 30-day rolling.
  - App-level rate-limit applies.
  - Approval-queue applies (Owner sees pending approvals for non-Owner ADMINs).
  - PIN auth still available, but step-up uses same 5-minute window.
- Audit log distinguishes `actor.is_owner` ON every action → operator can review Owner actions separately for self-audit.

If the business ever transfers ownership, a one-time migration script (privileged, manual, signed by both parties) toggles `is_owner` on the new Owner and clears it from the old. Cannot be done from the app.

### 7. Dev experience — `scripts/dev-bootstrap.ts`

A Node script (idempotent) that runs as the very first step of `pnpm --filter @norns/api-cloud dev`:

```ts
async function devBootstrap() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('dev-bootstrap MUST NOT run in production');
  }
  await ensurePostgresContainer();      // docker compose up -d if not running
  await applyMigrationsIfEmpty();       // migrations 1..N if PG fresh
  await ensureDevCert();                // generate self-signed if not in dev-certs/
  await seedDevDeviceRow();             // upsert devices with the cert SHA-256
  await seedOwnerAccountWithPin0000();  // upsert Basel as Owner + PIN '0000'
  // ⇒ proceed to start the Fastify server.
}
```

Production refuses to start if it detects:
- The self-signed dev cert's CN pattern (`CN=warehouse14-dev-*`).
- The dev Owner email pattern (`*@warehouse14.local`).
- Any user with `pos_pin_set_at IS NOT NULL` and the PIN-hash matching the dev-seed argon2id of `'0000'`.

These three checks live in `src/lib/prod-safety.ts` and run once at boot. Any match → log fatal error + exit code 78 (config error).

### 8. Audit-log additions — visibility into Owner-only behavior

Three new `event_type` values land in `audit_log` from Day 12:

| event_type | When |
|---|---|
| `auth.pin_login` | Every successful PIN login |
| `auth.pin_failed` | Every wrong PIN |
| `auth.pin_locked` | Failed attempt 5 → lockout fires |
| `auth.pin_unlocked_via_full_auth` | Lockout cleared by Full Login |
| `auth.step_up_success` | PIN step-up confirmed for sensitive action |
| `auth.step_up_failed` | Wrong PIN at step-up |
| `pin.set` | New PIN set or changed |
| `owner.rate_limit_skipped` | Owner-only rate-limit exception applied |
| `owner.auto_approved_self` | Owner action auto-approved without queue |

Each carries `{ actor_id, is_owner, device_id, ip, occurred_at }` in payload.

## Consequences

### Positive

- **Cashier-speed login** matches the Oliver Roos / German POS muscle memory.
- **Owner does not become a single point of UX failure** — the friction relaxations are visible (audit log) and limited (the DB triggers don't relax).
- **Brute-force cost is high** through the lockout + Full-Login fallback chain, not through PIN length.
- **Future team scaling is mechanically forced** — the partial UNIQUE means there will never be two Owners by accident.

### Negative

- **Operators who skip PIN strength advice and use `1234` in production** weaken the chain. Mitigation: the blacklist + the `prod-safety.ts` check.
- **Sessions live for 30 days for Owner** — a stolen and unlocked laptop has 30 days of access. Mitigation: mTLS cert is bound to the device's OS keychain (Tauri); a stolen laptop without the user-account password loses the cert.
- **PIN auth requires storing argon2id-hashes** — slight extra CPU at login. Acceptable.
- **The custom PIN flow lives alongside better-auth** instead of inside it — two code paths to maintain. Mitigation: the PIN routes call into better-auth's session-creation API; we don't duplicate session storage.

### Neutral

- The dev bootstrap script is one more thing to maintain, but pays back daily.

## Alternatives considered

### A. WebAuthn / passkeys only (Touch ID, Windows Hello)
Rejected (initial proposal, then rejected on POS context): biometric prompts during a transaction in front of a customer feel less professional than a numeric keypad; cashier muscle memory expects digits.

### B. Long full sessions + periodic re-auth
Rejected: the periodic re-auth IS the bureaucracy Basel rejected.

### C. Per-action password re-prompt
Rejected: this is what banks were doing in 2005 and abandoned for the same reasons.

### D. No PIN at all — just mTLS + 30-day session
Rejected: mTLS cert lives on disk; a stolen unlocked laptop is then unconditional access. The PIN is the "something you know" layer that the cert (something you have) lacks.

## Compliance fit

- **DSGVO Art. 32** (appropriate security): defense-in-depth with documented threat model.
- **GoBD** (fiscal evidence): every PIN event is audit-logged; legal floor triggers untouched.
- **§203 StGB** (professional secrecy — KYC data): per-request PII key injection + role separation unchanged.
- **§25c UStG** (investment gold scope): unaffected (this ADR is purely identity, not tax).

## Open questions

1. **Multi-cashier per terminal** — V1 has one user per device. When the second cashier joins, the PIN-login UI needs a "pick your face from the row of avatars, then PIN" flow. Schema is ready; UI work is in the Tauri POS shell (out of scope for the API).
2. **PIN rotation policy** — do we force PIN change every N days? V1: NO. Phase 1.5: ADMIN can `/api/auth/pin/force-rotate` to trigger a per-user rotation prompt.
3. **Wrong-PIN-during-step-up** — does this contribute to the same lockout counter as login? V1: YES, single shared counter. Phase 1.5 may split if operators report friction.
