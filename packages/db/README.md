# @norns/db

Drizzle ORM schema, hand-written SQL migrations, and connection clients for Warehouse14.

## Imports

```ts
import { connectApp, connectMigrator } from '@norns/db/client';
import * as schema from '@norns/db/schema';
```

`connectApp()` for runtime (`apps/api-cloud`, `apps/worker`). `connectMigrator()` for migration runners only.

## Day-1 status (Chunk 0.2)

Foundation only — no tables yet:

- `migrations/0001_extensions.sql` — pgcrypto, vector, citext, btree_gist, pg_stat_statements
- `migrations/0002_helpers.sql` — `berlin_business_day()`, `set_updated_at()`
- `migrations/0003_roles.sql` — `warehouse14_app`, `warehouse14_security`, default-deny grants

Tables land in 0004 onwards. See [`migrations/README.md`](./migrations/README.md) for the full roster.

## Local-dev quick start

From the repo root:

```bash
# 1. Bring up Postgres (with pgvector pre-installed) + Redis.
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 2. Apply the foundation migrations.
pnpm --filter @norns/db db:migrate

# 3. (Optional) run the migration test suites — requires Docker for testcontainers.
pnpm --filter @norns/db test
```

The local Postgres container preloads `pg_stat_statements` and runs the
`initdb.d` scripts to create the `warehouse14_migrator` role + pre-seed
the `warehouse14_app` password. See
[`infrastructure/docker/postgres/initdb.d/README.md`](../../infrastructure/docker/postgres/initdb.d/README.md).

## Migration discipline

- **One logical concern per file.** No splits, no merges.
- **Never modify a committed migration.** Always append.
- **Run as `warehouse14_migrator`.** Pointing migrations at the app role fails — that's the safety net.
- **Idempotent where possible.** `IF NOT EXISTS` + `DO`-block guards.
- **Transactional per file.** `BEGIN`/`COMMIT` everywhere.

See [`migrations/README.md`](./migrations/README.md) for the full discipline and ADR refs.

## Testing

Each migration has an integration test in `tests/migrations/`. Tests use
`@testcontainers/postgresql` to spin up `pgvector/pgvector:pg17` and apply
the same SQL that production runs. No test-mode divergence.

```bash
pnpm --filter @norns/db test
```

Requires the Docker daemon to be reachable.

## ADR references

| ADR | What it dictates |
|---|---|
| [ADR-0002](../../docs/architecture/adr/0002-drizzle-over-prisma.md) | Drizzle ORM, no Prisma |
| [ADR-0008](../../docs/architecture/adr/0008-schema-architecture.md) | Schema architecture, role split, migration ordering |
| [ADR-0012](../../docs/architecture/adr/0012-oracle-cloud-frankfurt-hosting.md) | Hosting + Postgres config + secrets discipline |
| [ADR-0016 §6.bis](../../docs/architecture/adr/0016-omnichannel-inventory-reservation-lock.md) | pgvector + HNSW for similarity |
| [ADR-0018 §10](../../docs/architecture/adr/0018-pos-operational-resilience-and-edge-cases.md) | Defense-in-depth, trigger ownership |
| [ADR-0020 §2](../../docs/architecture/adr/0020-smart-appointment-system.md) | btree_gist for slot capacity |
