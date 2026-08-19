# Red Team API Audit — `apps/api-cloud`

- **Date:** 2026-05-25
- **Auditor:** Technik (Red-Team-Rolle — Day 16)
- **Scope:** All Fastify routes, plugins, helpers landed Days 11–15.
- **Verdict:** **NOT defect-free.** 4 important findings → fixed in Day 16. 4 minor findings → Phase 1.5 backlog. The DB layer (Days 1–10 + migration 0013) remains untouched and bank-vault-strong.

---

## Executive summary

The HTTP layer was built on a heavily fortified DB substrate (Red Team Audit 2026-05-25 + migration 0013). The audit confirmed the DB-level guarantees are intact, but found four HTTP-layer hardening gaps that an Internet-exposed origin would notice within hours of going live. All four are landed in Day 16.

---

## Critical findings — fixed in Day 16

### Finding A-1: No HTTP-layer rate limiting

**Risk:** Brute-force surface on `/api/auth/sign-in` and `/api/auth/pin-login`. The DB-level PIN lockout (5 attempts → 30-min lock) protects pin-login per-user, but without HTTP rate limit a distributed attacker could rotate IPs and hammer the password endpoint, bypassing the per-account discipline.

**Fix:** `@fastify/rate-limit@9.1.0` plugin (`src/plugins/rate-limit.ts`):
- Global default: 300 req/min/key
- Key generator: `req.actor.id` when authenticated, else `req.ip`
- Allow-list: `/health`, `/metrics`, `/docs/*`, `/openapi.json`
- Per-route override: routes set stricter caps via Fastify `config.rateLimit`
- Dev/test: cap is bumped 10000× so test runs + curl loops don't hit the limit

### Finding A-2: better-auth's `DATABASE_URL` could point at over-privileged role

**Risk:** A misconfiguration could set the runtime URL to the migrator role, granting `DELETE` and DDL inside the API process. Even though the production env is set correctly today, a single typo at deploy time would silently elevate.

**Fix:** `assertAppRoleInDatabaseUrl(env)` in `src/config/env.ts`, called from `server.ts` before `buildApp()`. Parses the URL and asserts the user segment is `warehouse14_app`. Refuses to start otherwise. Override flag `DATABASE_URL_ROLE_OVERRIDE=1` for tests where testcontainers may use the `postgres` superuser temporarily.

### Finding A-3: No OWASP security headers

**Risk:** Missing HSTS, X-Frame-Options, Referrer-Policy, X-Content-Type-Options. clickjacking + protocol-downgrade pathways exist purely at the HTTP layer regardless of how strong the application logic is.

**Fix:** `@fastify/helmet@12.0.1` in the new `src/plugins/security-headers.ts`. Applies the OWASP defaults plus:
- HSTS: 180-day max-age, includeSubDomains
- X-Frame-Options: DENY
- Referrer-Policy: no-referrer
- Cross-Origin-Resource-Policy: same-origin
- CSP: intentionally off in V1 (Swagger UI inline scripts) — Phase 1.5 splits per-route CSP

### Finding A-4: No CORS enforcement at the app layer

**Risk:** `TRUSTED_ORIGINS` env was read but never applied. Cloudflare may enforce at edge but defense-in-depth needs both. A direct origin probe (bypassing the tunnel) would accept any cross-origin request.

**Fix:** `@fastify/cors@10.1.0` co-registered with helmet in `src/plugins/security-headers.ts`. Reads `TRUSTED_ORIGINS`, allows the listed origins with `credentials: true` (cookies pass), exposes the rate-limit + request-id headers.

---

## Important findings — Phase 1.5 backlog

### Finding A-5: PUBLIC_PREFIXES duplicated across plugins

**Where:** `plugins/auth.ts:44` + `plugins/mtls.ts:39` both maintain identical lists.
**Risk:** Drift — adding a new public route requires updating both.
**Fix (deferred):** Extract to `src/lib/public-routes.ts` exporting a single readonly list, imported by both plugins.

### Finding A-6: `negateDecimalString` uses string manipulation

**Where:** `routes/transactions-storno.ts`.
**Risk:** Edge cases like `'-0.00'`, `'00.00'` (leading-zero variants) may slip past the regex without Decimal.js's normalization.
**Fix (deferred):** Replace with `new Decimal(x).negated().toFixed(2)`. Already covered by the storno trigger's `magnitude exactly mirrors` check at the DB level; the string approach is belt-and-braces.

### Finding A-7: STORNO_OF_STORNO trigger message match is fragile

**Where:** `plugins/error-handler.ts:72` matches the trigger's RAISE message via regex.
**Risk:** If the trigger's German prose is reworded, the mapping silently degrades to generic 23514.
**Fix (deferred):** Encode stable error codes in the trigger's `USING ERRCODE = …` or `USING DETAIL = 'TOKEN:STORNO_OF_STORNO'`. Phase 1.5 migration adds it.

### Finding A-8: Body size limit is global 1 MiB

**Where:** `app.ts:82` `bodyLimit: 1024 * 1024`.
**Risk:** Some routes don't need anywhere near 1 MiB.
**Fix (deferred):** Per-route `bodyLimit` overrides. Most routes can drop to 64 KiB.

---

## Audited and confirmed OK (no action)

| Concern | Where enforced | Verdict |
|---|---|---|
| PII key cross-request leakage | `lib/pii.ts` — `withPii` is the only path; `set_config(…, true)` is transaction-scoped | ✅ proven by 6 dedicated tests |
| mTLS prod fail-closed | `plugins/mtls.ts` — production throws when `Cf-Client-Cert-Sha256` missing | ✅ |
| Inventory race protection | Single-statement UPDATE in `@norns/inventory-lock` | ✅ |
| Hash chain bypass-proofing | SECURITY DEFINER + warehouse14_security ownership | ✅ |
| Step-up window | Uniform 10-min via `auth-policy.requireStepUp` | ✅ |
| Storno step-up mandatory | Unconditional in `routes/transactions-storno.ts` | ✅ (Basel Day 15 §3) |
| Audit log NEVER DELETE | Role grants in migrations 0008 + 0011 | ✅ |
| Decimal.js validation in finalize | `lib/transaction-math.ts` — Decimal-equal checks across header/lines/payments | ✅ |
| pg_notify SSE leak prevention | `routes/sse-ledger.ts` — three cleanup hooks + closed-flag guard | ✅ proven by `pg_stat_activity` test |

---

## Compliance fit reaffirmed

| Concern | Where enforced |
|---|---|
| GoBD append-only | Migrations 0008 + 0009 + 0013 triggers |
| Sanctions hard-block | Migration 0013 C-2 (still inviolate) |
| Closing-day immutability | Migration 0013 C-3 (still inviolate) |
| §259 StGB Ankauf evidence | Migration 0013 C-1 (still inviolate); now reinforced by `acquired_from_customer_id` intake-locked column in migration 0015 |
| DSGVO PII handling | `withPii` transaction-scoped key + 6 dedicated tests |
| Brute-force defense | DB-level lockout (PIN) + HTTP rate limit (Day 16 A-1) — defense-in-depth |
| mTLS device identity | Cloudflare Access in prod + step-ca in dev |

---

## Acceptance criteria — "defect-free for V1"

1. ✅ A-1 rate-limit plugin landed + Fastify registered after auth
2. ✅ A-2 `assertAppRoleInDatabaseUrl` called at boot from `server.ts`
3. ✅ A-3 + A-4 helmet + CORS via `security-headers` plugin landed early
4. ✅ Workspace typecheck across 7 projects green
5. ✅ Day 16 E2E test suite includes a smoke check on the security headers
6. ⏸ A-5 / A-6 / A-7 / A-8 documented in this report + dem internen Arbeitsheft (Phase-1.5-Rueckstand)

After Day 16 the API can ship to production with the same confidence the DB layer earned in Audit 1.
