# ADR-0021 — `apps/api-cloud` architecture: Fastify + TypeBox + better-auth + mTLS + pg_notify SSE

- **Status:** Accepted (Basel approved 2026-05-25 via choice-of-3 prompt)
- **Date:** 2026-05-25
- **Deciders:** Basel, Technik
- **Related:** ADR-0006 (Auth & RBAC — better-auth), ADR-0008 (schema architecture + role separation), ADR-0009 (mTLS device identity), ADR-0010 (das frühere Kanal-Gateway, ausgezogen), ADR-0012 (Oracle Cloud hosting + Cloudflare Tunnel), ADR-0014 (POS resilience + SSE for Bridge UX), ADR-0016 (Inventory Lock — package consumed here), ADR-0018 §10 (defense-in-depth), `docs/architecture/RED_TEAM_AUDIT_2026-05-25.md` (the audit that confirmed DB readiness), migration `0013_security_hardening.sql` (the pg_notify substrate this ADR consumes), dazu das interne Arbeitsheft (nicht veröffentlicht).

## Context

The 12 SQL migrations + 5 workspace packages (`config`, `domain`, `db`, `inventory-lock`, `audit`) are landed and the Red Team Audit confirmed the database is **API-ready** after migration `0013_security_hardening.sql`. This ADR defines the **first consumer of the schema** — the HTTP API in `apps/api-cloud` that every other surface (Bridge UX, Control Desktop, Tauri POS, Storefront SSR, eBay sync worker, WhatsApp bot) will talk to.

The API is **not** the place where business rules are re-implemented. The rules live in the database (CHECKs, triggers, SECURITY DEFINER ownership) and in the workspace packages (`@norns/inventory-lock`, `@norns/audit`, `@norns/domain`). The API is a **transport + orchestration** layer:

1. Verify identity (better-auth session + mTLS device cert).
2. Inject the per-request PII key into the DB session.
3. Open a single DB transaction per fiscal action.
4. Call into the workspace packages.
5. Map domain errors to HTTP status codes.
6. Auto-generate OpenAPI from the same TypeBox schemas that validate requests.

Constraints from earlier ADRs:

- **EU residency** (ADR-0012): the API runs on Oracle Cloud Frankfurt; no data leaves the EU.
- **No-runtime-DDL** (ADR-0008 §3): the API connects as `warehouse14_app`, which has SELECT + INSERT + per-column UPDATE — never DDL, never DELETE on fiscal tables.
- **Bypass-proof discipline** (ADR-0018 §10): every fiscally relevant action must traverse SECURITY DEFINER triggers; the API does not have a "secret path" around them.
- **Cloudflare Tunnel** (ADR-0012 §6): the API is not directly exposed to the internet. Cloudflare Access enforces mTLS at the edge and forwards the verified cert in headers.

## Decision

### 1. Fastify 4.x as the web framework

Chosen over Express, Hono, NestJS for the combination of:

- **Schema-first validation via JSON Schema / TypeBox** — same schemas drive runtime validation, TypeScript types, and OpenAPI generation. Single source of truth.
- **Pino structured logging built in** — JSON logs ready for Loki/Grafana shipping (ADR-0019).
- **Plugin encapsulation** via `fastify-plugin` — clean dependency injection without a DI framework.
- **Lifecycle hooks** (`onRequest`, `preValidation`, `preHandler`, `onSend`) — exactly the right primitive for cross-cutting concerns (auth, mTLS, PII-key injection, audit).
- **Fastest mainstream NodeJS framework** — benchmarks consistently show 2–3× Express throughput; matters under peak storefront load.

NestJS rejected: brings Angular-style decorators and a heavy DI container; cost > benefit for a single-service API.

### 2. TypeBox for schemas + validation + OpenAPI

```ts
import { Type, Static } from '@sinclair/typebox';

export const FinalizeBody = Type.Object({
  productIds:   Type.Array(Type.String({ format: 'uuid' })),
  customerId:   Type.Optional(Type.String({ format: 'uuid' })),
  direction:    Type.Union([Type.Literal('VERKAUF'), Type.Literal('ANKAUF')]),
  paymentMethod: Type.Union([
    Type.Literal('CASH'), Type.Literal('ZVT_CARD'), Type.Literal('SUMUP'),
    Type.Literal('MOLLIE'), Type.Literal('STRIPE'), Type.Literal('EBAY'),
    Type.Literal('BANK_TRANSFER'), Type.Literal('VOUCHER'),
  ]),
});
export type FinalizeBody = Static<typeof FinalizeBody>;
```

The same `FinalizeBody` value:
- Compiles to an Ajv validator for `fastify.post('/transactions/finalize', { schema: { body: FinalizeBody }, … })`.
- Generates the OpenAPI 3.1 `requestBody` schema in `/openapi.json`.
- Produces the static TS type via `Static<>`.

Zod rejected: requires `fastify-type-provider-zod` adapter; OpenAPI gen needs a second transformation step; Ajv-compiled validators are ~3× faster than zod's runtime validation.

### 3. better-auth wiring

`better-auth` ships framework-agnostic with the `better-auth/api` entry. We mount it as a Fastify plugin:

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: true },
  twoFactor: { enabled: true },                         // ADR-0006
  session: { expiresIn: 60 * 60 * 8 },                  // 8h
  rateLimit: { window: 60, max: 10 },                   // login attempts
  trustedOrigins: env.TRUSTED_ORIGINS.split(','),
});

app.register(authPlugin, { auth });                     // exposes /api/auth/*
app.decorate('auth', auth);                              // routes can call auth.api.getSession(req)
```

The drizzle adapter binds to the existing `users / sessions / accounts / verifications / two_factors` tables from migration 0004. No schema duplication.

### 4. mTLS — step-ca locally, Cloudflare Access in production

**Local development**:
- `infrastructure/docker/step-ca/` runs a smallstep CA in docker-compose.
- A bootstrap script issues a `pos-dev-001` cert valid for 90 days and stores it in `apps/api-cloud/dev-certs/`.
- The Fastify HTTPS server accepts that cert; the `mtls.ts` plugin extracts `cert.fingerprint` and queries `devices.cert_serial`.
- A seeded `devices` row in `infrastructure/docker/postgres/initdb.d/` makes the cert recognizable.

**Production**:
- Cloudflare Access enforces mTLS at the edge.
- After verification, Cloudflare forwards `Cf-Access-Jwt-Assertion` (JWT signed by team key) and `Cf-Client-Cert-Sha256`.
- The plugin verifies the JWT against the team's published JWKS (cached 15 min), reads the cert SHA-256, queries `devices.cert_serial`.
- Origin server still binds HTTPS but accepts any cert — Cloudflare is the trust anchor.

**Failure modes**:
- No header → `401 Unauthorized` "device cert missing".
- Header present, no matching `devices` row → `403 Forbidden` "unknown device".
- `devices.cert_expires_at < now()` → `403 Forbidden` "device cert expired".
- `devices.is_revoked = true` → `403 Forbidden` "device revoked".

The plugin runs at `onRequest` so every route inherits the protection by default. Public routes (`/health`, `/api/auth/login`, `/openapi.json`, `/docs`) opt out via route-level `config: { mtlsOptional: true }`.

### 5. Per-request PII key injection

```ts
app.addHook('onRequest', async (req) => {
  // Future: derive per-shop, per-role, per-time-window key from KMS.
  // V1: single env-provided key, scoped to the request via SET LOCAL.
  const key = env.NORNS_PII_KEY;
  await req.server.db.execute(sql`SELECT set_config('warehouse14.pii_key', ${key}, true)`);
});
```

`SET LOCAL` ties the key to the current transaction. When the request returns, the connection goes back to the pool with the key unset. `pg_stat_statements` strips constants from logged queries, so the key never appears in metrics either.

The `withPiiKey()` helper from `@norns/db` is no longer needed inside the API — the hook does it once per request. The helper remains exported for batch jobs / workers that don't go through Fastify.

### 6. Module layout (Clean Architecture)

```
apps/api-cloud/
├── src/
│   ├── server.ts              # entrypoint: app.listen(env.PORT)
│   ├── app.ts                 # buildApp(opts) — testable factory
│   ├── config/env.ts          # TypeBox validation of process.env
│   ├── plugins/
│   │   ├── db.ts              # postgres + drizzle → app.db
│   │   ├── auth.ts            # better-auth mount + req.session helper
│   │   ├── mtls.ts            # Cloudflare / step-ca cert extraction
│   │   ├── pii.ts             # SET LOCAL warehouse14.pii_key
│   │   ├── audit.ts           # emit() bound to actor/device context
│   │   ├── error-handler.ts   # domain errors → HTTP
│   │   └── swagger.ts         # @fastify/swagger + @fastify/swagger-ui
│   ├── lib/request-context.ts # AsyncLocalStorage
│   ├── schemas/               # shared TypeBox schemas (Money, UUID, …)
│   └── routes/
│       ├── health.ts
│       ├── transactions/finalize.ts
│       └── sse/ledger.ts
└── tests/integration/
```

`app.ts` exports `buildApp(opts: { db?, log? })` so integration tests can inject a test postgres connection. `server.ts` only calls `buildApp` + `.listen()` — never invoked from tests.

### 7. Request context via AsyncLocalStorage

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  actorId: string;
  deviceId: string;
  requestId: string;
  piiKey: string;
}

const als = new AsyncLocalStorage<RequestContext>();

// preHandler hook:
app.addHook('preHandler', (req, _, done) => {
  als.run({ actorId: req.session.userId, deviceId: req.device.id, ...}, done);
});

// Anywhere downstream:
export function currentActor(): string {
  const ctx = als.getStore();
  if (!ctx) throw new Error('No request context');
  return ctx.actorId;
}
```

This kills the "pass `actorId` through 5 function calls" anti-pattern. `@norns/audit`'s `emit()` reads from `als.getStore()` automatically.

### 8. Domain error → HTTP mapping

The workspace packages throw typed errors:

```ts
export class ProductNotReservableError extends Error { code = 'PRODUCT_NOT_RESERVABLE'; }
export class SanctionsBlockError       extends Error { code = 'SANCTIONS_BLOCK'; }
export class ClosingDayGuardError      extends Error { code = 'CLOSING_DAY_FINALIZED'; }
```

The `error-handler.ts` plugin maps them:

| Code | HTTP | When |
|---|---|---|
| `PRODUCT_NOT_RESERVABLE` | 409 Conflict | inventory-lock detected SOLD/RESERVED elsewhere |
| `SANCTIONS_BLOCK` | 403 Forbidden | C-2 trigger raised |
| `CLOSING_DAY_FINALIZED` | 409 Conflict | C-3 trigger raised |
| `STORNO_OF_STORNO` | 422 Unprocessable | existing 0009 trigger raised |
| `DEVICE_NOT_AUTHORIZED` | 403 Forbidden | mTLS plugin rejected |
| `SESSION_EXPIRED` | 401 Unauthorized | better-auth said no |
| Any other | 500 + Pino-log + Sentry | uncaught path |

PG `SQLSTATE 23514` (`check_violation`) maps to 409 generically when no domain code matches.

### 9. SSE substrate via pg_notify (migration 0013 C-6 consumer)

```ts
app.get('/sse/ledger', { onRequest: requireRole('ADMIN') }, async (req, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',                          // disable proxy buffering
  });

  const listener = postgres({ ...env.DB_URL, max: 1, idle_timeout: 0 });
  const sub = await listener.listen('warehouse14_ledger', async (idStr) => {
    const [row] = await req.server.db.execute(sql`
      SELECT id, event_type, entity_table, entity_id, payload, created_at
        FROM ledger_events WHERE id = ${parseInt(idStr, 10)}
    `);
    reply.raw.write(`id: ${row.id}\ndata: ${JSON.stringify(row)}\n\n`);
  });

  const heartbeat = setInterval(() => reply.raw.write(`:hb\n\n`), 25_000);

  req.raw.on('close', async () => {
    clearInterval(heartbeat);
    await sub.unlisten();
    await listener.end({ timeout: 5 });
  });
});
```

Key design choices:
- **Dedicated `postgres` instance per subscription** — `LISTEN` ties to a session; cannot share with the pooled connection.
- **Payload = id only** (per ADR-0014 §4 + migration 0013 C-6) — subscriber reads the row by PK; avoids the 8 KB pg_notify limit and consistency surprises.
- **Heartbeat every 25 s** — Cloudflare's idle timeout is 100 s; well within margin.
- **`X-Accel-Buffering: no`** — disables nginx/Cloudflare buffering that would defeat SSE.

### 10. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit (plugin logic) | Vitest | mTLS header parser, error-handler mapping, request-context |
| Integration (route) | Vitest + supertest + testcontainers/postgresql | One per route; spins up real PG, runs all 13 migrations, hits the route via supertest |
| Contract (OpenAPI) | spectral + a generated client | nightly CI: openapi.json valid, no breaking changes vs main |

The DB tests in `packages/db/tests/migrations/` stay where they are; this app's tests live in `apps/api-cloud/tests/` and exercise the **HTTP surface**, not the schema directly.

## Consequences

### Positive

- **Single source of truth for shapes** — TypeBox drives validation, types, and docs simultaneously.
- **Defense-in-depth holds** — every route inherits mTLS + auth + PII-key injection via hooks; opt-out is explicit.
- **Database does the policing** — the API can be naïve about sanctions, closing-day, double-storno; the DB refuses on its own.
- **SSE is essentially free** — `pg_notify` from migration 0013 already exists; the route is ~30 lines.
- **Test parity with production** — same Postgres image, same migrations, same role separation; no test-only code paths.

### Negative

- **TypeBox is less ergonomic than Zod** for transforms (e.g., `string -> Date` coercion). Mitigated by writing one shared `DateFromIsoString` schema and reusing it.
- **mTLS via step-ca locally adds a `docker-compose up step-ca` step** to onboarding. Documented in `infrastructure/docker/README.md`. Worth the prod parity per Basel's directive.
- **AsyncLocalStorage has ~3% perf overhead** in microbenchmarks. Acceptable; we are not Discord.
- **Per-subscriber Postgres connection for SSE** burns one pool slot per Bridge tab. At single-shop volume (≤5 simultaneous Control Desktop sessions) it is fine. For storefront-scale SSE we'd switch to a NATS / Redis pub-sub.

### Neutral

- We commit to Fastify 4 → 5 upgrade path; not painful, breaking changes are narrow.
- We pay the OpenAPI auto-gen cost upfront; pays dividends once Tauri / Storefront / Bridge consume a generated client.

## Alternatives considered

### Hono + tRPC
Hono is faster than Fastify on raw throughput, and tRPC removes the schema layer entirely. Rejected because:
1. tRPC's tight TS-to-TS coupling defeats OpenAPI generation; we need the latter for Tauri (Rust frontend) and external integrations.
2. Hono's ecosystem is younger; better-auth's first-class Fastify support is more mature.

### NestJS
Considered for the structure it imposes. Rejected: heavy DI container, decorator-heavy boilerplate, our scale doesn't need it.

### gRPC + grpc-gateway
Considered for the binary protocol + auto-gen. Rejected: storefront browsers can't consume gRPC natively; we'd need a translation layer anyway, defeating the value.

## Open questions

1. **WebSockets vs SSE for Tauri POS** — Tauri can speak both. SSE is one-way (server → client) which fits ledger streaming. If POS later needs server-initiated bidirectional (e.g., remote-trigger drawer kick), we'd add WebSockets at that point. **Decision deferred.**
2. **Redis** — `@fastify/rate-limit` and the future jobs queue both want Redis. We'd use the Oracle Cloud-hosted Redis (or DragonflyDB inside the same docker network). **Decision deferred to Day 14 or Phase 1.5.**
3. **Body-size limits for storefront image uploads** — they should not go through this API. The intake pipeline (ADR-0015) presigns R2 uploads directly. The API only sees the R2 keys.

## Compliance & security summary

| Concern | Where enforced |
|---|---|
| EU residency | Oracle Cloud Frankfurt (ADR-0012) |
| GoBD append-only | Migration 0008 chain + 0009 triggers |
| Sanctions hard-block | Migration 0013 C-2 trigger (not the API) |
| Closing immutability | Migration 0013 C-3 trigger (not the API) |
| PII key handling | Per-request `SET LOCAL`; never logged; pg_stat_statements strips |
| mTLS identity | Cloudflare Access (prod) / step-ca (dev) |
| Rate limiting | `@fastify/rate-limit` in-memory dev / Redis prod |
| OpenAPI auto-gen | `@fastify/swagger` from TypeBox schemas |
| Defense-in-depth | Hooks default-on; route-level opt-out is explicit |
