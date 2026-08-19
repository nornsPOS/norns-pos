# ADR-0002 — Drizzle ORM over Prisma

- **Status:** Accepted
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik

## Context

We need an ORM that serves three demanding scenarios:

1. **Backend** talks to **PostgreSQL** (cloud, Frankfurt)
2. **Tauri POS** talks to **SQLite** (local offline cache)
3. **Fiscal exports** (DSFinV-K, DATEV) require **complex SQL** — window functions, CTEs, multi-table joins with exact wording reviewable by a German tax auditor

We evaluated Prisma 7 and Drizzle 0.45 in May 2026.

## Decision

**Drizzle ORM** for the entire stack.

### Why Drizzle wins for Warehouse14 specifically

| Factor | Why it matters here | Verdict |
|---|---|---|
| **GoBD audit transparency** | German auditors may request the exact query that produced a tax export. Drizzle = SQL you wrote; Prisma = engine-generated. | 🟢 Drizzle |
| **Same schema, two drivers** | PostgreSQL in cloud + SQLite on Tauri. Drizzle swaps drivers (`drizzle-orm/postgres-js` vs `drizzle-orm/better-sqlite3`) with no schema rewrite. | 🟢 Drizzle |
| **Bundle size on Tauri** | Drizzle ~7KB vs Prisma 7 ~1.6MB gzipped. Matters for installer size and cold start. | 🟢 Drizzle |
| **Complex tax queries** | DSFinV-K, daily Z-Report, DATEV exports rely on window/CTE. Drizzle supports them first-class; Prisma falls back to `$queryRaw` (typesafety lost). | 🟢 Drizzle |
| **DX for beginners** | Prisma is gentler; Drizzle expects SQL fluency. | 🟡 Prisma |

4–1 for Drizzle on the factors that actually matter to this project.

### Supporting decisions

- **Money columns:** `numeric(18, 2)` in PostgreSQL, `TEXT` in SQLite (numeric not native). The Money class' `toString()` ⇄ `Money.parse()` handles both.
- **Migrations:** managed by `drizzle-kit` — SQL files in `packages/db/drizzle/`. Schema = source of truth.
- **Append-only enforcement:** the ORM layer alone cannot enforce; PG role grants `INSERT, SELECT, UPDATE (audit cols only)` and **no `DELETE`**. ORM cannot bypass.

## Consequences

**Positive:**
- Full SQL visibility → auditor-friendly
- Zero engine binary → simpler deployments, no version mismatch
- Multi-driver out of the box → PG and SQLite from one schema definition
- Drizzle-Zod generates Zod schemas from DB schema → one source of truth

**Negative:**
- Smaller community than Prisma → some plugins absent, sometimes have to write yourself
- Migrations are SQL files (not declarative diffs) → must be reviewed for correctness
- Junior devs onboarding will need more SQL fluency

**Mitigations:**
- Every migration reviewed in PR
- Internal docs include "ORM patterns we use" cookbook
- Repository pattern in `packages/db` hides Drizzle behind interfaces — if Drizzle stalls, the swap surface is small

## Alternatives considered

- **Prisma 7:** closed the historical performance gap by removing Rust engine. But still hides SQL → bad for our audit story. Tauri bundle still 200×+ heavier than Drizzle.
- **Kysely:** thinner than Drizzle, query-builder only, no migrations. We'd need a separate migration tool.
- **Raw SQL + pg-promise:** maximum control, zero type safety on inputs. Rejected.

## References

- See conversation log 2026-05-23 for full benchmark numbers
- Drizzle docs: <https://orm.drizzle.team>
- Prisma 7 changelog: removed Rust engine, dropped from ~14MB to ~1.6MB gzipped
