# ADR-0001 — Monorepo with Turborepo + pnpm, Fastify backend, Next.js for web

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik

## Context

Warehouse14 needs to ship multiple deployable units:

- POS desktop (Tauri 2)
- Backend API
- Admin dashboard (web)
- Public storefront (web, SEO-critical)
- Background worker

These units share:
- Domain logic (Money, tax rules, GwG thresholds)
- Database schema (Drizzle)
- UI primitives (from Oliver's Luxury* components)
- Event type definitions
- Auth flows

If we use multiple repositories, every shared change becomes a cross-repo dance with version bumps and lockstep deploys. For a one-person-led project, that is fatal.

## Decision

**Monorepo** managed by:
- **Turborepo 2.3** for task orchestration and remote caching
- **pnpm 9** workspaces for dependency management

**Backend:** Fastify
- 2-3× faster HTTP than Express
- First-class Zod integration via `@fastify/type-provider-zod`
- Auto-OpenAPI generation via `@fastify/swagger`
- Mature plugin system; lighter weight than NestJS

**Admin Dashboard & Storefront:** Next.js (App Router)
- Storefront needs SEO + ISR — Next.js is the natural fit
- Admin: shared design language with storefront → one framework
- Both deployed independently from the API

**Other infrastructure choices:**
- **Event bus:** PostgreSQL `LISTEN/NOTIFY` for Phase 1 → graduate to NATS only if volume demands
- **Background jobs:** BullMQ + Redis (mature, predictable)
- **Real-time UI:** Server-Sent Events (SSE) — proven in Oliver, simpler than WebSockets behind proxies
- **Frontend state:** TanStack Query (server cache) + Zustand (client state)
- **Lint/Format:** Biome — replaces ESLint + Prettier with one fast tool

## Consequences

**Positive:**
- One `pnpm install` brings up everything
- Turbo remote cache will speed up CI dramatically once enabled
- Shared types end-to-end: DB row → API response → frontend, no drift
- Refactors that touch multiple layers are single PRs

**Negative:**
- Slightly higher initial onboarding cognitive load (apps vs packages distinction)
- pnpm workspace protocol (`workspace:*`) is non-standard; tooling that doesn't understand it will fail
- Turbo caching has edge cases with side-effecting tasks (mitigated via explicit `cache: false`)

**Mitigations:**
- README documents the apps/packages distinction
- All workspace protocol references happen in package.json only — generated artifacts use real version numbers
- `clean: false` set explicitly on dev tasks in `turbo.json`

## Alternatives considered

- **Nx:** more powerful but heavier; not justified for our scale
- **Just pnpm workspaces, no Turbo:** simpler, but loses task orchestration and caching
- **NestJS backend:** more structure but ceremony-heavy for solo lead
- **Hono backend:** edge-ready but ecosystem too young for the compliance work we need

## References

- Siehe das interne Arbeitsheft, §2, für die volle Entscheidungsmatrix
