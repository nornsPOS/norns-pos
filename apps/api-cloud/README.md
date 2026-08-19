# @norns/api-cloud

Warehouse14 Cloud API — the HTTP transport layer in front of the schema +
workspace packages. See `docs/architecture/adr/0021-api-cloud-architecture.md`
for the canonical decision record.

## Stack

- **Fastify 4** — schema-first, Pino logging, hook lifecycle
- **TypeBox** — single source of truth for validation + OpenAPI + TS types
- **better-auth** *(Day 12)* — bound to the migration-0004 auth tables
- **mTLS** *(Day 12)* — Cloudflare Access (prod) / step-ca (dev)
- **pg_notify SSE** *(Day 14)* — consumer of migration 0013 C-6

## Running locally

```bash
# From repo root, once dependencies are installed:
corepack pnpm install
corepack pnpm --filter @norns/db build
cp apps/api-cloud/.env.example apps/api-cloud/.env.local
# Edit .env.local with your local PG URL etc.
corepack pnpm --filter @norns/api-cloud dev
```

`http://localhost:3000/health` should return `{ ok: true, db: 'up' }`.
`http://localhost:3000/docs` opens the Swagger UI.
`http://localhost:3000/metrics` exposes Prometheus metrics.

## Day-by-day delivery

| Day | Scope | Status |
|-----|-------|--------|
| 11  | Bootstrap & plumbing: factory, env, db, error-handler, swagger, metrics, `/health`, integration test | ✅ landed |
| 12a | Owner UX foundation: ADR-0022 + migration 0014 (`is_owner` + POS PIN) + `@norns/auth-pin` (argon2id + weak-PIN blacklist + lockout state machine, 22 unit tests green) | ✅ landed |
| 12b | Auth wiring: better-auth (email/pw/TOTP) + PIN-login + step-up routes + mTLS plugin + PII-key injection (RED LINE: 6 teardown tests) + AsyncLocalStorage request-context + dev-bootstrap script | ✅ landed |
| 13  | **First vital artery:** `POST /api/transactions/finalize` — all-or-nothing through inventory-lock + 12 DB triggers + 8-test E2E coverage | ✅ landed |
| 14  | **Live stream:** `GET /api/sse/ledger` — dedicated LISTEN connection per subscriber, 25s heartbeat, Last-Event-ID replay, ADMIN-only, 7-test E2E (incl. pg_stat_activity leak check) | ✅ landed |
| 15  | **POS arsenal:** `POST /api/inventory/reserve` (race-safe via inventory-lock) + `/release` (session-guarded) + `/api/transactions/storno` (mandatory step-up, audit_log reason persisted in TX, defense at 422/409/404 before triggers fire) — 13-test E2E | ✅ landed |
| 16  | **API Red Team Audit fixes (A-1 rate-limit / A-2 role guard / A-3 helmet / A-4 CORS) + Product Management API** (migration 0015 + `POST /api/products` + `PUT /:id` + `archive` + R2 presigned-URL photos) — 15-test E2E | ✅ landed |
| 17  | **3rd-party audit fixes (deep-equality bug + DB balance trigger + Redis Phase 1.5) + Unified catalog `GET /api/products` + Customer management (`POST`+`GET /api/customers` with `withPii`, Ankauf history) + DEBT payment wiring (migration 0016 trigger refuses DEBT-without-customer + accumulates `cumulative_debt_eur`)** — 13-test E2E + migration tests | ✅ landed |
| 19  | **E-commerce engine + Stripe primary** (memory.md #65 amends #31). Migration 0018 (5 enums + shoppers + sessions + carts + cart_items + payment_intents + webhook_events + transactions extensions). Routes: `POST /api/storefront/auth/sign-up`/`sign-in`/`sign-out` (argon2id + 5-fail lockout), `GET`+`POST`+`DELETE /api/storefront/cart/*`, `POST /api/storefront/cart/checkout` (15-min inventory-lock STOREFRONT reservation + Stripe PaymentIntent w/ card+sepa_debit+klarna+ideal+giropay), `POST /api/webhooks/stripe` (HMAC-SHA256 verification of Stripe-Signature + replay defense via STRIPE_WEBHOOK_TOLERANCE_SECONDS + idempotency via webhook_events UNIQUE + cart-to-fiscal conversion w/ sales_channel='WEB' + shipping_status='PENDING'). Distinct `req.shopper` plane via `warehouse14.shopper_session` cookie + `storefront-session` plugin — staff auth never sees storefront cookies and vice-versa. 14-test E2E. | ✅ landed |

## Layout

```
src/
├── server.ts              # entrypoint — buildApp().listen()
├── app.ts                 # buildApp(opts) factory — testable
├── config/env.ts          # TypeBox env schema + fail-fast validation
├── plugins/
│   ├── db.ts              # postgres + drizzle decorator
│   ├── error-handler.ts   # typed domain errors → HTTP
│   ├── metrics.ts         # @fastify/metrics → /metrics
│   └── swagger.ts         # @fastify/swagger + @fastify/swagger-ui
└── routes/
    └── health.ts          # GET /health
tests/
└── integration/
    └── health.test.ts     # full stack against testcontainers PG
```

## Conventions

- All routes declare a `schema: { body?, params?, querystring?, response }`
  using TypeBox. The same schema validates the request AND drives OpenAPI.
- All side-effecting routes wrap their DB work in a single `db.transaction(…)`.
- Domain errors thrown by workspace packages are translated by
  `plugins/error-handler.ts` — routes do not handle them inline.
- `app.inject({…})` is used for integration tests; no supertest dependency.
