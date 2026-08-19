# ADR-0006 — better-auth over deprecated Lucia v3

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik

## Context

The auth library had to:
1. Be **self-hosted** (data residency requires we own the user table)
2. Work across **Fastify API**, **Next.js admin/storefront**, and **Tauri POS**
3. Support **passkeys/WebAuthn** for admin (GoBD-friendly: hardware-backed identity)
4. Support **PIN** for cashiers (Oliver's proven flow)
5. Integrate cleanly with **Drizzle**

Initial choice was Lucia v3 — small, well-typed, self-hosted, framework-agnostic.

## Discovery

While preparing the foundation, search-verified that **Lucia v3 was deprecated by its maintainer (pilcrowOnPaper / Pilcrow) in late 2024 / early 2025**.

Source quotes:
- Lucia migration guide: *"Lucia v3 has been deprecated. Lucia is now a learning resource for implementing sessions and more. We ultimately came to the conclusion that it'd be easier and faster to just implement sessions from scratch."* — <https://lucia-auth.com/lucia-v3/migrate>
- Industry analysis (2026): *"In late 2024, its maintainer Pilcrow made a pivotal decision: rather than maintain a shrinking library as better-auth gained traction, he sunset Lucia as a dependency and turned it into an auth architecture guide."*

Picking Lucia today means **building Warehouse14's foundation on a deprecated library**. Not acceptable.

## Decision

**better-auth** is the auth library.

### Why better-auth fits Warehouse14

| Requirement | better-auth |
|---|---|
| Self-hosted (data residency) | ✅ Yes — we host it |
| Drizzle integration | ✅ First-class adapter, no glue code |
| Framework support (Fastify + Next.js + Tauri) | ✅ Framework-agnostic core |
| WebAuthn / Passkeys for admin | ✅ Built-in plugin |
| TOTP / 2FA | ✅ Built-in plugin |
| Multi-org / multi-tenancy | ✅ Plugin (useful for future multi-shop) |
| Active development | ✅ ~3 releases/week in 2025-2026 |
| TypeScript inference quality | ✅ Excellent |

### Cashier PIN flow (Oliver pattern)

PIN-based authentication for the cashier on the POS terminal will be implemented as a custom flow on top of better-auth's session primitives (Oliver's pattern). Sessions persist locally in Tauri's secure storage; rotation policy: rotate session on every successful sale to limit blast radius if the device is left unattended.

### Admin flow

Admin logs into the Next.js dashboard via:
1. Email + password as fallback
2. **Passkey (preferred)** — Touch ID / Windows Hello / hardware key

Every admin action carries a session_id used in audit logs. GoBD-aligned: a tax auditor can reconstruct who did what.

## Consequences

**Positive:**
- Library is healthy, growing, and standardising in the TS ecosystem
- Drizzle adapter eliminates schema friction
- Plugin ecosystem unlocks future features (organizations, magic links, OAuth providers) without lock-in

**Negative:**
- Project is newer than Auth.js — fewer years of production scars (but very actively maintained)
- Some plugins still maturing (multi-tenancy in particular evolves)

**Mitigations:**
- Wrap better-auth behind an `@norns/auth` package — if we ever migrate, the swap surface is one package
- Pin to specific minor versions; review breaking changes before upgrading

## Alternatives considered

- **Lucia v3:** rejected — deprecated
- **Auth.js v5 (formerly NextAuth):** strong ecosystem; framework-agnostic via `@auth/core`; biased toward Next.js. Plugin model less ergonomic than better-auth's. Drizzle adapter exists but is community-maintained.
- **Clerk / Auth0:** rejected — violates ADR-0005 (data residency)
- **Custom roll-our-own (Lucia's recommendation):** more work than necessary for shared-stack project; we'd duplicate what better-auth gives for free

## References

- Lucia deprecation announcement: <https://github.com/lucia-auth/lucia/discussions/1714>
- better-auth docs: <https://www.better-auth.com>
- Oliver's PIN + pairing flow (to be ported): `pages/PairingScreen.tsx`, `components/ui/PinPad.tsx`
