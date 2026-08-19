# ADR-0008 — Schema Architecture: append-only ledger with bypass-proof hash chain, role isolation, modular Drizzle layout

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Supersedes:** none
- **Related:** ADR-0002 (Drizzle), ADR-0007 (GwG always-ID), `docs/memory.md` §2 #24 #25, §3 (compliance facts)

## Context

GoBD §146 AO, KassenSichV, and DSFinV-K together impose three database-level invariants on every tax-relevant write:

1. **No record may be silently mutated or deleted.** Reversals must be additive (Storno entries), the original row must remain readable for 10 years.
2. **The trail must be tamper-evident.** A motivated insider with `DELETE` rights on the production DB must be unable to alter history without detection.
3. **The full chain must be reconstructible** for a Finanzamt auditor years later, including who/when/what/where for every change.

We must also satisfy operational realities:
- Single shop on a single Oracle Cloud ARM VM (memory.md §29). Postgres 17 self-hosted in Docker.
- Cashier flow must be fast: < 200ms for a `POST /transactions/finalize` round-trip including TSE state transition + ledger append.
- Drizzle is the ORM (ADR-0002), so the schema must be expressible as typed TS modules with first-class `$inferSelect`/`$inferInsert`.
- Migrations must be reviewable in PRs (no single 800-line file).
- The schema must be Greenfield but informed by Oliver Roos's audit/scheduling/TSE patterns (memory.md §5).

These three pressures — compliance integrity, performance, and reviewability — drive every decision below.

## Decision

### 1. Single-stream `ledger_events` table is the canonical audit chain

We do **not** add `prev_hash`/`row_hash` columns to each fiscal table. Instead, all tamper-evident events flow into one append-only stream:

```sql
CREATE TABLE ledger_events (
  id            BIGSERIAL    PRIMARY KEY,
  event_type    TEXT         NOT NULL,           -- 'transaction.finalized', 'transaction.storno', 'closing.zreport', 'kyc.captured', 'product.tax_treatment_set', ...
  entity_table  TEXT         NOT NULL,           -- 'transactions', 'customers', etc.
  entity_id     UUID         NOT NULL,           -- target row's id (no FK — entity_table varies)
  actor_user_id UUID,                            -- nullable for system events
  device_id     UUID,                            -- terminal that triggered the event
  ip_address    INET,
  payload       JSONB        NOT NULL,           -- canonical snapshot of the relevant fields at event time
  prev_hash     BYTEA        NOT NULL,           -- 32 bytes SHA-256
  row_hash      BYTEA        NOT NULL,           -- 32 bytes SHA-256
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

**Why single-stream, not per-table:**
- Verification is O(n) over one ordered list — trivial to implement and inspect.
- Cross-entity relationships (a Storno entry referencing the original transaction's user_id at the time of the original sale) live in one place.
- Auditors get one tail to walk, not seven.
- Concurrency is centralised at one row-level lock (head row), which is fine for single-shop throughput.

This is the concrete implementation of **Event Sourcing Lite** from memory.md §2 #26: operational tables hold current state, `ledger_events` is the immutable journal, both maintained in the same DB transaction.

### 2. Bypass-proof hash via Postgres trigger — application code cannot opt out

The hash is computed inside a `BEFORE INSERT` trigger. Application code sets `event_type`, `entity_*`, `actor_*`, `payload`, and `created_at`. The trigger sets `prev_hash` and `row_hash`:

```sql
CREATE OR REPLACE FUNCTION ledger_compute_hash() RETURNS TRIGGER AS $$
DECLARE
  last_hash BYTEA;
  canonical TEXT;
BEGIN
  -- Serialise chain extension on the head row's hash.
  -- A SELECT FOR UPDATE on the single tail row forces concurrent INSERTs to queue.
  SELECT row_hash INTO last_hash
    FROM ledger_events
    ORDER BY id DESC
    LIMIT 1
    FOR UPDATE;

  IF last_hash IS NULL THEN
    -- Genesis: 32 zero bytes.
    last_hash := decode('0000000000000000000000000000000000000000000000000000000000000000', 'hex');
  END IF;

  NEW.prev_hash := last_hash;

  -- Canonical form: positional concatenation with explicit separator.
  -- jsonb_pretty + sort_keys would also work; we pick concat to avoid PG version drift on jsonb text formatting.
  canonical := concat_ws(
    char(31),                                    -- ASCII Unit Separator: not legal in any field value
    encode(NEW.prev_hash, 'hex'),
    NEW.event_type,
    NEW.entity_table,
    NEW.entity_id::TEXT,
    COALESCE(NEW.actor_user_id::TEXT, ''),
    COALESCE(NEW.device_id::TEXT, ''),
    COALESCE(host(NEW.ip_address), ''),
    encode(digest(NEW.payload::TEXT, 'sha256'), 'hex'),   -- hash the payload first, then include the hash → stable
    to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );

  NEW.row_hash := digest(canonical, 'sha256');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_compute_hash
  BEFORE INSERT ON ledger_events
  FOR EACH ROW EXECUTE FUNCTION ledger_compute_hash();
```

**Why a trigger, not application code:** the `warehouse14_app` role has `INSERT` on `ledger_events` but no privilege to `ALTER TABLE` or `DROP TRIGGER`. A compromised API process cannot disable the chain. Defense in depth.

**Anticipated problem — canonical JSON drift:** PG's `jsonb::text` is stable within a major version but not contractually so across versions. We sidestep this by hashing `payload::TEXT` separately (line `encode(digest(...), 'hex')`) before including its hash in the outer canonical string. The payload's exact bytes are stored in `ledger_events.payload`; verification recomputes its hash from the stored value at audit time.

**Anticipated problem — contention on the head row:** `FOR UPDATE` serialises all `ledger_events` inserts. At single-shop volumes (~100–500 events/day peak) this is invisible. If we hit it at multi-shop scale (Phase 2+), the migration path is per-shop sub-chains anchored to a master chain — documented in §Known limits.

### 3. Two DB roles, with `DELETE` granted to neither

```sql
-- Runtime role: used by the API and background workers.
CREATE ROLE warehouse14_app LOGIN PASSWORD :app_password;

-- Migration role: used only by drizzle-kit during deploy. Never connects from app code.
CREATE ROLE warehouse14_migrator LOGIN PASSWORD :migrator_password;

-- Default-deny.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO warehouse14_app, warehouse14_migrator;

-- Migrator: full DDL + DML.
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO warehouse14_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO warehouse14_migrator;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO warehouse14_migrator;

-- App: scoped grants, table by table. NEVER DELETE. UPDATE only on specific columns.
-- (See per-table grant blocks inside each migration file.)
```

For each fiscal table, app grants are minimal. Example for `transactions`:

```sql
GRANT SELECT, INSERT ON transactions TO warehouse14_app;
GRANT UPDATE (printed_at, receipt_locator, notes_internal) ON transactions TO warehouse14_app;
-- Note: financial columns (amount_*, tax_treatment_code, items, payments) are INSERT-once. No UPDATE grant on them.
-- No DELETE grant. Ever.
```

The migrator runs from CI under a different connection string read from Oracle Vault. The runtime process never has access to migrator credentials.

### 4. `tax_treatment` is a lookup table, not a PG enum

```sql
CREATE TABLE tax_treatment_codes (
  code                TEXT          PRIMARY KEY,                           -- 'MARGIN_25A', 'INVESTMENT_GOLD_25C', 'STANDARD_19', 'REDUCED_7'
  description_de      TEXT          NOT NULL,
  description_en      TEXT          NOT NULL,
  effective_vat_rate  NUMERIC(5,4),                                        -- 0.1900 = 19%; NULL = margin scheme (per-item calc)
  legal_reference     TEXT          NOT NULL,                              -- '§25a UStG Abs. 1 Nr. 3', etc.
  active              BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);
```

`products.tax_treatment_code TEXT NOT NULL REFERENCES tax_treatment_codes(code)`.

**Why lookup, not enum:** BMF adds tax categories without consulting our schema. Adding `LANDWIRTSCHAFTLICH_5_5` to a PG enum requires `ALTER TYPE` (locking, version-specific syntax). Adding a row to a lookup table is `INSERT`. Same query cost, far better evolution story.

The lookup is also the natural place to keep bilingual descriptions, legal references, and the `active` flag (deprecate codes without rewriting history).

### 5. Storno = additive entry; financial UPDATEs are forbidden

`transactions` has:

```sql
storno_of_transaction_id UUID REFERENCES transactions(id)
```

- `NULL` → this is an original sale or Ankauf.
- `NOT NULL` → this row is a Storno of the referenced one.

Invariants enforced at the DB level:

```sql
-- A Storno of a Storno is illegal.
ALTER TABLE transactions ADD CONSTRAINT storno_not_recursive CHECK (
  storno_of_transaction_id IS NULL
  OR (SELECT storno_of_transaction_id FROM transactions t2 WHERE t2.id = transactions.storno_of_transaction_id) IS NULL
);

-- Storno totals must mirror the original (sign-flipped).
-- Enforced via trigger that reads the original and validates the sum invariant at INSERT time.
```

Both the original and the Storno emit `ledger_events` rows. Verification: the sum of all `transactions.total_cents` grouped by `coalesce(storno_of_transaction_id, id)` must equal zero for stornoed pairs and the original total otherwise.

### 6. Money, weight, and decimal precision

Aligned with ADR-0002 #12 and memory.md §2 #12:

| Column kind                      | Type             | Example              |
|----------------------------------|------------------|----------------------|
| Money amount (invoice line, total) | `NUMERIC(18,2)` | `1999.99`            |
| Per-unit price (e.g. €/g)        | `NUMERIC(15,4)`  | `64.2317`            |
| Weight in grams                  | `NUMERIC(10,4)`  | `12.5400`            |
| Karat (fineness factor cached)   | `NUMERIC(5,4)`   | `0.5850` (= 585/1000) |
| Tax rate                         | `NUMERIC(5,4)`   | `0.1900`             |

**No `DOUBLE PRECISION`, no `FLOAT4`, no `REAL` anywhere in fiscal tables.** Linter rule in CI will enforce this on every migration file.

Money is *always* stored in major units (EUR with 2 dp), never in cents-as-bigint. The Decimal.js layer in TS handles arithmetic; the DB stores the same number the user sees. The receipt printed value, the DB row, and the TSE-signed value all agree byte-for-byte.

### 7. `berlin_business_day()` — IMMUTABLE function for indexable temporal queries

```sql
CREATE OR REPLACE FUNCTION berlin_business_day(ts TIMESTAMPTZ) RETURNS DATE AS $$
  SELECT (ts AT TIME ZONE 'Europe/Berlin')::DATE;
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;
```

`IMMUTABLE` is the technically correct marker here: the function's output depends only on its input, and PG's `Europe/Berlin` timezone is fixed within a server (DST is data, not behaviour). This unlocks:

```sql
CREATE INDEX idx_transactions_business_day
  ON transactions (berlin_business_day(finalized_at));
```

A daily-closing query (`WHERE berlin_business_day(finalized_at) = '2026-05-23'`) uses this index directly. Without `IMMUTABLE`, PG would refuse and we would carry redundant `business_day` columns everywhere.

This mirrors `backend/src/lib/finance/berlinMonthBounds.ts` from Oliver but lifts the logic into the DB so reports written by the Steuerberater (read-only role) get the same answer as the app.

### 8. Modular Drizzle schema — one table per file, grouped by domain

```
packages/db/src/schema/
├── index.ts                     # re-exports everything
├── _shared/
│   ├── columnHelpers.ts         # primaryKey(), timestamps(), softAudit() shortcuts
│   └── types.ts                 # shared Drizzle column types
├── auth/                        # better-auth tables (mostly auto-generated, lightly customised)
│   ├── users.ts
│   ├── sessions.ts
│   ├── accounts.ts
│   └── verifications.ts
├── reference/                   # slowly-changing reference data
│   ├── taxTreatmentCodes.ts
│   ├── karatGrades.ts           # 8K/14K/18K/22K/24K with fineness
│   └── hallmarks.ts             # 333/585/750/916/999
├── products/
│   ├── products.ts
│   └── productPhotos.ts
├── customers/
│   ├── customers.ts             # encrypted PII columns
│   └── kycDocuments.ts
├── transactions/
│   ├── transactions.ts          # the spine; INSERT-once on financial cols
│   ├── transactionItems.ts
│   └── transactionPayments.ts
├── audit/
│   ├── ledgerEvents.ts          # the hash chain
│   └── auditLog.ts              # non-fiscal who-when-what (logins, role changes, settings updates)
├── tse/
│   └── tseTransactions.ts       # Fiskaly state machine: INTENTION → TRANSACTION → FINISHED
├── closing/
│   ├── dailyClosings.ts
│   └── dsfinvkExports.ts
└── system/
    └── systemSettings.ts        # TSE config, gold-price-feed config, smurfing thresholds
```

Each file exports the Drizzle table plus a `Select`/`Insert` type alias. `packages/db/src/index.ts` re-exports everything.

### 9. Migration discipline — one logical concern per file, numerically ordered

```
packages/db/migrations/
├── 0001_extensions.sql          # pgcrypto, citext, btree_gist
├── 0002_helpers.sql             # berlin_business_day(), update_timestamp_trigger()
├── 0003_roles.sql               # warehouse14_app, warehouse14_migrator, default REVOKE
├── 0004_auth.sql                # better-auth tables + role grants
├── 0005_reference.sql           # tax_treatment_codes (+ initial seed), karat_grades, hallmarks
├── 0006_products.sql            # products, product_photos
├── 0007_customers_kyc.sql       # customers (encrypted PII), kyc_documents
├── 0008_audit_chain.sql         # ledger_events + trigger function + audit_log
├── 0009_transactions.sql        # transactions, transaction_items, transaction_payments + storno triggers
├── 0010_tse.sql                 # tse_transactions Fiskaly state machine
└── 0011_closing.sql             # daily_closings, dsfinvk_exports, system_settings
```

Each migration is generated by drizzle-kit then **hand-edited** to add the bits Drizzle doesn't model (triggers, role grants, IMMUTABLE functions, CHECK constraints with subqueries). Drizzle's generated SQL is the starting point, not the deliverable.

A `packages/db/migrations/README.md` documents the hand-edit pattern and the policy: never modify a committed migration; only append a new one.

### 10. Defense in depth — five concentric walls

| Wall | Mechanism | Failure mode it stops |
|---|---|---|
| 1 | `warehouse14_app` role with no `DELETE` grant | App bug or compromised process tries `DELETE FROM transactions WHERE …` |
| 2 | `BEFORE INSERT` trigger on `ledger_events` (writes prev_hash + row_hash) | App forgets or refuses to write hash |
| 3 | Trigger ownership: `OWNER` is a separate `warehouse14_security` role with no login | Compromised app cannot `DROP TRIGGER` |
| 4 | Application-layer business rules (storno amount invariants, tax_treatment immutability after first use) | Operator-level mistake |
| 5 | `pgcrypto`-encrypted PII columns with key in Oracle Vault | DB dump leak doesn't expose customer data |

## Schema sketch — illustrative SQL for the two most contested tables

```sql
-- ledger_events: the single source of audit truth.
CREATE TABLE ledger_events (
  id            BIGSERIAL                  PRIMARY KEY,
  event_type    TEXT                       NOT NULL,
  entity_table  TEXT                       NOT NULL,
  entity_id     UUID                       NOT NULL,
  actor_user_id UUID                       REFERENCES users(id),
  device_id     UUID                       REFERENCES devices(id),
  ip_address    INET,
  payload       JSONB                      NOT NULL,
  prev_hash     BYTEA                      NOT NULL,
  row_hash      BYTEA                      NOT NULL,
  created_at    TIMESTAMPTZ                NOT NULL DEFAULT now(),

  CHECK (octet_length(prev_hash) = 32),
  CHECK (octet_length(row_hash)  = 32)
);
CREATE INDEX idx_ledger_events_entity      ON ledger_events (entity_table, entity_id);
CREATE INDEX idx_ledger_events_business_day ON ledger_events (berlin_business_day(created_at));

GRANT SELECT, INSERT ON ledger_events           TO warehouse14_app;
GRANT USAGE          ON ledger_events_id_seq    TO warehouse14_app;
-- No UPDATE, no DELETE. Ever.


-- transactions: financial cols locked at INSERT; envelope cols updatable.
CREATE TABLE transactions (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  direction                   TEXT         NOT NULL CHECK (direction IN ('VERKAUF','ANKAUF')),
  storno_of_transaction_id    UUID         REFERENCES transactions(id),
  customer_id                 UUID         REFERENCES customers(id),
  device_id                   UUID         NOT NULL REFERENCES devices(id),
  cashier_user_id             UUID         NOT NULL REFERENCES users(id),

  -- Financial: INSERT-only.
  subtotal_eur                NUMERIC(18,2) NOT NULL,
  vat_eur                     NUMERIC(18,2) NOT NULL,
  total_eur                   NUMERIC(18,2) NOT NULL,
  tax_treatment_code          TEXT         NOT NULL REFERENCES tax_treatment_codes(code),

  -- Envelope: updatable.
  printed_at                  TIMESTAMPTZ,
  receipt_locator             TEXT,
  notes_internal              TEXT,

  finalized_at                TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_transactions_business_day ON transactions (berlin_business_day(finalized_at));
CREATE INDEX idx_transactions_customer     ON transactions (customer_id);
CREATE INDEX idx_transactions_storno       ON transactions (storno_of_transaction_id) WHERE storno_of_transaction_id IS NOT NULL;

GRANT SELECT, INSERT                                          ON transactions TO warehouse14_app;
GRANT UPDATE (printed_at, receipt_locator, notes_internal)    ON transactions TO warehouse14_app;
```

## Consequences

**Positive:**
- An auditor can verify the entire chain in one `SELECT` walk; the verification script lives in `packages/db/scripts/verify-chain.ts` and runs nightly in CI.
- A compromised API process cannot tamper with history. Worst case it inserts a **new** Storno entry, which is itself logged and visible in the chain.
- Drizzle types flow end-to-end: `db.select().from(transactions)` returns a typed row in the API, the same type in the Tauri POS, the same type in the Next.js admin.
- Migrations are small and reviewable. A single PR touches one logical area.
- `tax_treatment` evolution is INSERT-only, no schema migration when BMF adds categories.
- The hash chain provides cryptographic evidence for a future GoBD audit beyond what GoBD itself strictly requires — a deliberate over-provision for §259 StGB defence.

**Negative:**
- `ledger_events` writes serialise on a single row lock. At ~500 events/day this is invisible (each event holds the lock for sub-millisecond). At >100/sec sustained it would surface. Documented in Known limits.
- Hand-edited migrations (after drizzle-kit generation) are slightly more error-prone than fully-generated ones. Mitigation: every migration has a paired `*.sql.test.ts` integration test that asserts the grants, triggers, and constraints are in place.
- The chain is verification-O(n). For Phase 1 (~1 year of data ≈ 100k events) this is a 30-second nightly job. For year 10 (~1M events) it remains under 5 minutes. Acceptable.
- Encrypted PII columns are not searchable by content without decrypt-then-scan or a separate `citext` search column. Documented per-column.

**Mitigations:**
- `packages/db/scripts/verify-chain.ts` (chunked, resumable, parallel-safe per shard) — Phase 1 deliverable.
- Each migration has a `drizzle-kit verify` step in CI that re-derives the schema from `schema/*.ts` and diffs against the database state. Hand-edits that aren't reflected in the Drizzle schema fail the build.
- Read-replica strategy is documented but deferred (memory.md §Known limits §11).

## Alternatives considered

- **Per-table hash chains:** rejected. Multiplies trigger code, complicates cross-entity verification, makes the chain unreadable without joining seven tables.
- **Append-only by `pg_audit` extension only:** rejected. `pg_audit` produces server logs, not queryable rows. Useless for an in-app audit screen and not legally sufficient on its own.
- **Hash chain in application code (Node/TS):** rejected. The whole point is bypass-proof. App code can be modified faster than DB triggers can.
- **Row-Level Security (RLS) instead of role grants:** deferred. RLS adds per-row policy evaluation overhead and only pays off at multi-tenant scale. Single-shop V1 doesn't need it; we will add RLS when Phase 2 introduces multi-shop.
- **Materialised projections for current state (full Event Sourcing):** rejected for V1. Operational tables are the snapshot; ledger_events is the journal; both kept in sync inside a DB transaction. We get auditable history without paying the rebuild-from-events cost.
- **`tax_treatment` as PG enum:** rejected — see §4.
- **bigint cents storage for money:** rejected for fiscal columns (`NUMERIC(18,2)` chosen). bigint cents survives in TS as `bigint` only at the TSE-hash boundary in `packages/domain`.

## Known limits & deferred decisions

1. **Ledger contention at multi-shop scale.** Single chain serialises. Mitigation when needed: per-shop sub-chains anchored to a master chain on a daily merkle root. Re-open this decision when Phase 2 begins.
2. **Chain verification cost grows linearly with history.** At year 10 (~1M events) the full re-walk is minutes. We snapshot a "trusted checkpoint" every day after the daily closing — the chain from that checkpoint forward is the only thing verified online; everything before is archived to S3 Glacier with the daily checkpoint hash as the integrity anchor.
3. **PII encryption key rotation.** V1 stores one symmetric key in Oracle Vault. Rotation = re-encrypt all `customers` rows with the new key inside a maintenance window. Documented for Phase 2; not implemented in 0.2.
4. **Read replicas / streaming replication.** Not needed at single-shop scale; the same VM holds primary + nightly base backup. Phase 2+.
5. **Logical sharding by shop_id.** Schema is single-tenant V1. The `customers`, `transactions`, etc. tables will gain `shop_id UUID NOT NULL` in a future migration when multi-shop arrives; the column is omitted now to keep V1 small.
6. **Hot-table partitioning.** `ledger_events` and `transactions` will likely be partitioned by `berlin_business_day` from year 3+. Not in scope for 0.2.

## References

- BSI TR-03153 — Technische Richtlinie für TSE — implicitly requires tamper-evident logging
- BMF Schreiben vom 28.11.2019 (DSFinV-K) — defines the export the ledger must support
- §146 AO, §147 AO — record-keeping and retention obligations
- Stripe Engineering blog, "Designing immutable APIs" — confirms the single-stream ledger pattern in fintech practice
- Oliver Roos cherry-pick: `backend/src/lib/audit/logger.ts` (write pattern), `backend/src/lib/finance/berlinMonthBounds.ts` (business-day helper), `backend/drizzle/0005_audit_logs_delta.sql` (early audit schema — note we are improving on it with the hash chain)
- `docs/memory.md` §2 #24 #25, §3 (Append-only ledger paragraph)
