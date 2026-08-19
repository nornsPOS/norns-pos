Both facts confirmed: the replay path hard-sets `idempotencyKey` from `record.idempotencyKey` (`offline-replay.ts:62`), and the outbox has `url`, `headers_json`, `device_id` all `NOT NULL` (`0001_outbox.sql:15-30`) while `pos_intents.payload_json` is the only body-carrying column (`0001_outbox.sql:43`). The G3 blocker and the D4/Step-0 softening both hold. I have everything needed.

Here is the definitive spec.

---

# Durable Fiscal Recovery — Definitive Implementation Spec (1.3 + 1.4)

Single author, sequential. Every sub-step ends behind the green gate `pnpm --filter @norns/db build && pnpm -r typecheck` **and, where a test file is touched, `vitest` green**. Live-check only where a Tauri runtime is required (SQLite / TSE). Migrations are forward-only: only `0003` is added; `0001`/`0002` are never edited.

This revision absorbs the full critique: the record-only window is closed with an explicit method and its inner window is documented as residual risk (A1); the FINISH-already-consumed hole is handled (B1); the queue gets a real uniqueness key with UPSERT-promote semantics (B2/B3); `in_flight` re-selection is made concrete (A3); the table is `STRICT` to preserve integer-cents (C2); the per-step gate is kept green by merging test-retarget into the deletion step (C1); the overflow policy gets a numeric cap and a coherent succeeded/retention/badge story (F1/F2); `pos_intents` carries the sealed request so reconcile cannot hit NOT NULL violations (G3); three oversized steps are split (D-splits); and two overstated claims are corrected (Step 0 scope, "new required params").

---

## Key design decisions (with rationale + evidence)

### D1 — The durable TSE queue gets its OWN new table (migration `0003_tse_queue.sql`), NOT `outbox_mutations`

Three reasons, each evidenced:

1. **Different replay verb.** `outbox_mutations` replay is a pure HTTP resubmit — `client.request(method, path, body, …)` (`apps/tauri-pos/src/lib/offline-replay.ts:56-67`). A queued TSE entry replays a **two-leg Fiskaly-then-server sequence**: `tseClient.finish(params)` — a Rust `invoke` (`apps/tauri-pos/src/lib/hardware-client.ts:184-186`) — **then** `transactionsApi.recordTseSignature(...)` (`packages/api-client/src/domains/transactions.ts:265-275`). The `OutboxRecord` shape (`packages/api-client/src/lib/outbox-store.ts:138-152`: `method/path/url/headers/body`) cannot express a Rust `invoke` leg without corrupting the at-most-once FIFO that `drainOutbox` depends on.
2. **Two crash windows need two states the outbox has no vocabulary for.** (a) FINISH threw → `signature_json IS NULL`, replay = finish + record; (b) FINISH succeeded but `recordTseSignature` threw (`apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx:612`, `apps/tauri-pos/src/screens/ankauf/AnkaufBezahlenDialog.tsx:301`) → `signature_json` populated, replay = record **only** (never re-finish an already-finished Fiskaly transaction).
3. **Package-boundary safety (Roman's gate).** `OutboxStore`/`OutboxRecord` live in `@norns/api-client` (`packages/api-client/src/lib/offline-queue.ts:81-98`, imported at `outbox-store.ts:20` and `offline-replay.ts:20-25`). Extending them ripples across the package boundary; a new app-layer table + store touches zero shared types.

`pos_intents` (1.4) already exists in the shipped `apps/tauri-pos/src-tauri/migrations/0001_outbox.sql:40-52`. 1.4 needs **no** migration. Only 1.3 adds `0003`.

### D2 — The enriched, replayable TSE queue entry shape (table `tse_signature_queue`, `STRICT`)

The table is declared **`STRICT`** (SQLite ≥ 3.37) so `amount_cents INTEGER` and every integer column **reject** a non-integer at write time instead of silently coercing a bad string to `0`/NULL. This is what preserves the end-to-end "never a lossy float, never a string" invariant that the current typebox schema enforces (`apps/tauri-pos/src/lib/tse-service.ts:32-39`); a non-`STRICT` INTEGER column would *not* preserve it (corrects the draft's Step 4 doctrine claim). See E2 for the bundled-SQLite requirement.

Uniqueness key: **`UNIQUE(intention_id)`** — exactly one FINISH per fiscal intention. This is what makes `INSERT … ON CONFLICT` meaningful (B2); a table with only `id`/`monotonic_seq` would let a double-tap or React re-render insert a duplicate fiscal row.

| Column | Type | Source at enqueue | Why replay needs it |
|---|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | — | row identity |
| `monotonic_seq` | INTEGER NOT NULL | subselect `MAX(monotonic_seq)+1` (mirror `outbox-store.ts:67`) | deterministic FIFO drain order |
| `intention_id` | TEXT NOT NULL **UNIQUE** | `input.intention.intentionId` (`tse-service.ts:107`) | FINISH param + conflict target |
| `fiskaly_transaction_id` | TEXT NOT NULL | `input.intention.fiskalyTransactionId` (`hardware-client.ts:143`; in scope at `BezahlenDialog.tsx:603`, `AnkaufBezahlenDialog.tsx:292`) | FINISH param + `recordTseSignature` body |
| `tss_id` | TEXT NOT NULL | `config.tssId` (`BezahlenDialog.tsx:601`, `AnkaufBezahlenDialog.tsx:290`) | `recordTseSignature.fiskalyTssId` |
| `client_id` | TEXT NOT NULL | `config.clientId` (`BezahlenDialog.tsx:602`, `AnkaufBezahlenDialog.tsx:291`) | `recordTseSignature.fiskalyClientId` |
| `server_transaction_id` | TEXT NOT NULL | `result.id` Verkauf (`BezahlenDialog.tsx:600`) / `result.transactionId` Ankauf (`AnkaufBezahlenDialog.tsx:289`) | the `:id` in the POST route (`transactions.ts:272`) |
| `amount_cents` | INTEGER NOT NULL | `input.amountCents` (integer cents, never float) | FINISH param |
| `payment_kind` | TEXT NOT NULL | `input.paymentKind` (`'Bar'`/`'Unbar'`; Ankauf derived `payoutMethod==='CASH'?'Bar':'Unbar'` at `AnkaufBezahlenDialog.tsx:243`) | FINISH param |
| `amounts_per_vat_id_json` | TEXT NOT NULL | `JSON.stringify(input.amountsPerVatId)` — `VatAmount[]` (`apps/tauri-pos/src/lib/tse-vat.ts:38-43`), integer cents per bucket | signed body §146a (Phase 1.5 correctness) |
| `process_type` | TEXT NOT NULL | `input.processType ?? 'Kassenbeleg-V1'` (`tse-service.ts:112`) | FINISH param |
| `receipt_locator` | TEXT | `input.receiptLocator` | audit / receipt link |
| `signature_json` | TEXT | NULL for finish-failed; populated `TseSignature` for record-failed | selects replay path (a) vs (b) |
| `status` | TEXT NOT NULL DEFAULT `'pending'` | — | `pending` \| `in_flight` \| `succeeded` \| `failed_terminal` |
| `attempt_count` | INTEGER NOT NULL DEFAULT 0 | — | attempt cap |
| `last_attempt_at` | INTEGER | — | stale-`in_flight` re-selection + backoff |
| `last_error_json` | TEXT | — | honest surface |
| `created_at` | INTEGER NOT NULL | `Date.now()` | ordering fallback / audit |
| `retention_until` | INTEGER NOT NULL | `created_at + 10y` (mirror `outbox-store.ts:24,54-55`) | fiscal retention |

Indexes: `idx_tsq_status_seq (status, monotonic_seq)`, `idx_tsq_retention (retention_until)`.

`amount_cents` and every `amounts_per_vat_id_json` bucket stay integer cents so the replayed signed body is byte-identical to the online path (`amountsPerVatId` at `BezahlenDialog.tsx:568`, `AnkaufBezahlenDialog.tsx:268`).

### D2a — Enqueue is an UPSERT that PROMOTES, never an `INSERT OR IGNORE` (B2/B3)

The enqueue statement is:

```sql
INSERT INTO tse_signature_queue (…, signature_json, status, …)
VALUES (…)
ON CONFLICT(intention_id) DO UPDATE SET
  signature_json = COALESCE(excluded.signature_json, tse_signature_queue.signature_json),
  status         = 'pending',
  last_error_json = excluded.last_error_json,
  last_attempt_at = excluded.last_attempt_at;
```

Rationale: two enqueue paths can fire for one intention — a finish-failed row (signature NULL) may already exist when the record-failed path later tries to enqueue a signature. Plain `INSERT OR IGNORE` would **silently drop the signature** (fiscal-signature loss). `COALESCE(excluded.signature_json, existing)` **promotes** a NULL-signature row to a signed one and never overwrites a real signature with NULL, while re-arming `status='pending'` for the drain. A pure duplicate (both NULL, e.g. double-tap) collapses to a no-op UPDATE. This is the property `outbox-store.ts` gets from `idempotency_key … UNIQUE` (`0001_outbox.sql:12`); we reproduce it on the natural key.

### D3 — sync→async ripple: complete caller inventory

`readQueue` (`tse-service.ts:133`) and `enqueueFailure` (`tse-service.ts:149`) are synchronous localStorage today; the SQLite store is Promise-based.

1. **`enqueueFailure` call site** — `closeTseSession` catch (`tse-service.ts:120`). `closeTseSession` is already `async` (`tse-service.ts:94`), so `await store.enqueue(...)` slots in with **no** caller-signature change.
2. **Only non-test `readQueue` reader** — none. Verified: zero non-test `readQueue` readers in `apps/tauri-pos/src`; `GeraeteManager.tsx` uses only `HardwareStatusBadge`, never `readQueue`. The Gerätemanager badge (D7) is **net-new**, not a repoint.
3. **`readQueue`'s only source reader is the test** — `apps/tauri-pos/src/lib/tse-service.test.ts:47`. Retargeted in the same step that deletes the exports (see C1 / Step 4-merge).
4. **`enqueueFailure`'s internal `readQueue`** (`tse-service.ts:151`) — deleted; the store UPSERT replaces the read-modify-write.

Net async ripple is contained to already-async `closeTseSession` plus the one test.

### D4 — 1.4 boundary vs the api-client outbox (no double-finalize); Step 0 scope corrected

Two durable logs, layered not competing:
- `pos_intents` = "operator committed, I am **about to** call the network" — the pre-request crash window (`0001_outbox.sql:37-39`).
- `outbox_mutations` = "the request left and the network ate it" — handled by `offlineQueueMiddleware` (`apps/tauri-pos/src/lib/api-context.tsx:84-89`) + `drainOutbox` (`offline-replay.ts`).

Bridge = the shared `idempotencyKey`. Startup reconcile must **not** raw-fire an unresolved intent; it **inserts-or-ignores an `outbox_mutations` row on the same key** and lets `drainOutbox` carry it, so recovery rides the one at-most-once FIFO path and the server's partial-UNIQUE dedups (`transactions.ts:277-280`).

**Corrected claim (softens the draft): the reconcile is key-safe regardless of Step 0.** `drainOutbox`'s replay hard-sets `custom.idempotencyKey` from `record.idempotencyKey` (`offline-replay.ts:62`, verified). So any reconstructed outbox row replays under the key we stored, independent of the `finalize` forwarding fix.

**What Step 0 actually fixes** is narrower: the *original online-enqueue* path. `transactionsApi.finalize` (`transactions.ts:250-252`) does **not** forward `body.idempotencyKey` into `meta.custom`, unlike `ankauf` (`transactions.ts:281-285`). When a finalize enqueues offline *directly* (not via reconcile), `offlineQueueMiddleware` auto-generates a UUIDv7 key (`caller_supplied_key=0`) that differs from the body key — breaking the `pos_intents ↔ outbox` identity for that direct-enqueue path. Step 0 fixes finalize to mirror ankauf. It is a correctness fix for direct offline finalize, **not** a hard precondition for Step 8's reconcile correctness. It is still sequenced first because it is client-only and removes a latent double-finalize on the direct path.

### D5 — Drain scheduler, `in_flight` re-selection, attempt cap, overflow policy

Mirror `offline-replay.ts`: single-flight `running` flag (`offline-replay.ts:54,70`), `online` listener + startup sweep (`offline-replay.ts:96-108`), try/finally that never throws from the listener (`offline-replay.ts:84-93`), gated on `status === 'authenticated'` (App mounts the replay hook at `apps/tauri-pos/src/app/App.tsx:47`). The TSE drain runs on the **same 5s heartbeat** used by `useOfflineReplay` (`offline-replay.ts:146-157`) but as a **separate hook with its own `running` flag** (see D-split-3 / Step 5b) so the two drains cannot starve each other.

- **`in_flight` re-selection (concrete, replaces "older than one sweep").** Define `const STALE_MS = 60_000`. The drain's selection query is:
  ```sql
  SELECT * FROM tse_signature_queue
  WHERE status = 'pending'
     OR (status = 'in_flight' AND (last_attempt_at IS NULL OR last_attempt_at < :now - :STALE_MS))
  ORDER BY monotonic_seq ASC;
  ```
  A crash mid-drain leaves an `in_flight` row; after `STALE_MS` the next sweep re-selects it. `getStats()` counts `in_flight` too (see F2) so a stranded row is never invisible.
- **Attempt cap (numeric).** `const MAX_ATTEMPTS = 8`. Each attempt does `markInFlight` → work → on success `markSucceeded`, on error `incrementAttempt(id, error)`. When `attempt_count` reaches `MAX_ATTEMPTS` → `markFailedTerminal(id, error)` (`status='failed_terminal'` + `last_error_json`) — surfaced, never deleted. This bounds outbound retries against a recovering Fiskaly (the real DoS direction is outbound); the drain does not hammer Fiskaly forever for a permanently-bad row.
- **Overflow policy (1.3c).** Replaces the old `slice(-200)` silent drop (`tse-service.ts:154`), which the `AppShell.tsx` note forbids for fiscal records. Never silently drop, never block the sale. The queue never rolls off; growth during a sustained Fiskaly outage is *bounded per row* by the attempt cap (rows go `failed_terminal` and stop retrying) but the table is intentionally *not* size-capped (dropping a fiscal record is prohibited). Surface = a **persistent Gerätemanager alert** (D7 badge shows `pending + in_flight + failed_terminal`, never clears while non-zero). The manager step-up (F1): acknowledging does **not** clear the alert; it records to the audit ledger an **outage event** ("TSE-Signatur-Rückstau bestätigt", with the current backlog count and the earliest `created_at`), which is the KassenSichV §146a Abs. 1 outage-notation obligation, not a dismissal. This gives the step-up teeth (a legally-meaningful audit record) rather than empty ceremony.

### D6 — succeeded rows are retained, not deleted; `getStats` excludes them (F2)

Resolving the draft's `markSucceeded`-vs-delete contradiction: a drained row is set `status='succeeded'` (UPDATE, **not** DELETE) and kept until `retention_until` (10y) as a fiscal record — consistent with the outbox keeping rows. There is **no auto-pruner** in this cluster (the index `idx_tsq_retention` exists for a future pruner; none is specified or built here). `getStats()` therefore counts **only** `pending + in_flight + failed_terminal` and **excludes** `succeeded`, so the badge returns to zero after a successful drain — this is what makes Step 6's "drain replays and clears it" live-check true.

---

## Sub-steps (ordered: self-contained + off-device first; live finalize dialogs last)

### Step 0 — Fix the finalize/ankauf idempotency asymmetry (direct-offline-enqueue correctness)
- **Build**: In `packages/api-client/src/domains/transactions.ts:250-252`, make `finalize` forward `custom:{ idempotencyKey, gobdRelevant:true }` when `body.idempotencyKey` is set — identical shape to `ankauf` (`transactions.ts:281-285`).
- **Files**: `packages/api-client/src/domains/transactions.ts`.
- **Doctrine**: additive; makes the `pos_intents ↔ outbox` key identity sound on the *direct* offline-enqueue path (the reconcile path is already key-safe via `offline-replay.ts:62`).
- **Verify**: unit test asserting `finalize` passes `meta.custom.idempotencyKey === body.idempotencyKey` (parallel to any existing ankauf test); then the gate + `vitest`. No live needed.

### Step 1 — Migration `0003_tse_queue.sql` (`STRICT`) + register version 3
- **Build**: New file `apps/tauri-pos/src-tauri/migrations/0003_tse_queue.sql` — `CREATE TABLE tse_signature_queue (…) STRICT;` with the D2 columns, `UNIQUE(intention_id)`, and the two indexes. Register `Migration{ version:3, description:"create TSE signature replay queue", sql: include_str!("../migrations/0003_tse_queue.sql"), kind: Up }` appended **after** the version-2 entry at `apps/tauri-pos/src-tauri/src/lib.rs:34` (never edit 0001/0002; the existing entries use the `../migrations/` relative form at `lib.rs:26` — the author must not "fix" the `..`).
- **Doctrine**: forward-only; fiscal retention; own-table (D1); `STRICT` preserves integer-cents (C2).
- **Verify**: `cargo check` in `src-tauri`; the gate (JS unaffected). Live: launch the Tauri app once, confirm the migration applies without error (Rust applies before UI mounts).
- **E2 note in the file header**: `STRICT` requires bundled SQLite (tauri-plugin-sql default, well past 3.37). Do **not** switch the plugin to system SQLite — an older system libsqlite would throw on `CREATE TABLE … STRICT` at startup, before UI mounts, bricking the till.

### Step 2 — Pure store module `tse-queue-store.ts` + unit tests
- **Build**: New `apps/tauri-pos/src/lib/tse-queue-store.ts` — `class TauriSqlTseQueueStore` modeled on `outbox-store.ts:42-136`: lazy `db()` via `import('@tauri-apps/plugin-sql').then(({default:Db}) => Db.load('sqlite:warehouse14.db'))` (same `DB_PATH` as `outbox-store.ts:45-50`). Methods:
  - `enqueue(entry)` — the D2a UPSERT with the `monotonic_seq` subselect.
  - `listDrainable(now)` — the D5 `pending`-or-stale-`in_flight` selection, `ORDER BY monotonic_seq`.
  - `markInFlight(id)`, `incrementAttempt(id, error)`, `markSucceeded(id)`, `markFailedTerminal(id, error)`.
  - `getStats()` → `{ pending, inFlight, failedTerminal }` (counts by status; **excludes `succeeded`** per D6).
  - Export typed `TseQueueRow` and the app-facing `EnrichedTseQueueEntry` interface (the D2 fields).
- **Doctrine**: template reuse; bigint-cents discipline (integer columns + `STRICT`); degrade-to-empty when `Db.load` rejects in browser/Vitest (the `apps/tauri-pos/src/lib/kyc-store.ts:8-10` contract).
- **Verify**: unit tests mocking `@tauri-apps/plugin-sql` (a fake `Database` over in-memory rows) covering: enqueue→`listDrainable` FIFO order; UPSERT-promote (NULL→signed does not drop the signature; signed is never overwritten by NULL; pure duplicate is a no-op); `markInFlight`/`markSucceeded` transitions; stale-`in_flight` re-selection at the `STALE_MS` boundary; attempt-cap→`failed_terminal`; `getStats` excludes `succeeded`. Then the gate + `vitest`. No live (store not wired).

### Step 3a — Widen `closeTseSession`; finish-failed enqueue to the new store; thread new params at both call sites
- **Build**: In `apps/tauri-pos/src/lib/tse-service.ts`:
  - Widen the `closeTseSession` input (`tse-service.ts:94-101`) to require, on the finish-failed enqueue path, the fields only the dialog has in scope: **`serverTransactionId`, `tssId`, `clientId` are genuinely NEW required params** (corrects the draft's "no new param needed"); `fiskalyTransactionId` is reachable via `input.intention.fiskalyTransactionId`; `amountsPerVatId`/`processType`/`amountCents`/`paymentKind`/`receiptLocator` already flow in.
  - Replace the `enqueueFailure({thin})` call (`tse-service.ts:120`) with `await tseQueueStore.enqueue({ …D2 fields…, signatureJson: null })`.
  - Thread the three new params at the two call sites: **Verkauf** `BezahlenDialog.tsx` must pass `serverTransactionId: result.id` (in scope after `finalize`; the `closeTseSession` call is at `BezahlenDialog.tsx:574`), plus `tssId: config.tssId`, `clientId: config.clientId`; **Ankauf** `AnkaufBezahlenDialog.tsx` must pass `serverTransactionId: result.transactionId` (call at `AnkaufBezahlenDialog.tsx:277`), plus the config ids.
- **Files**: `tse-service.ts`, `BezahlenDialog.tsx` (call-site edit only), `AnkaufBezahlenDialog.tsx` (call-site edit only).
- **Doctrine**: enrichment at the source (only the dialogs have `result.id`/`result.transactionId` + config); honest German toasts unchanged; integer cents.
- **Verify**: the gate + a `tse-service` unit test asserting the finish-failed mapping writes `signature_json = NULL` and all D2 fields. Live deferred.

### Step 3b — `enqueueSignatureRecordOnly` + wire into BOTH dialog record catches (A1)
- **Build**: Add `enqueueSignatureRecordOnly(entry)` to `tse-service.ts` (a thin wrapper over `tseQueueStore.enqueue` that sets `signatureJson` populated, `status='pending'`). Call it from **inside** both dialog `catch` blocks — `BezahlenDialog.tsx:612` and `AnkaufBezahlenDialog.tsx:301` — replacing the toast-only handling, because the signature (`sig`) exists only in dialog scope (`closeTseSession` returns `{kind:'signed', signature}` at `tse-service.ts:117` and enqueues nothing). The UPSERT-promote (D2a) means this row *promotes* any pre-existing finish-failed row for the same `intention_id` rather than duplicating or being dropped.
- **Files**: `tse-service.ts`, `BezahlenDialog.tsx` (catch block), `AnkaufBezahlenDialog.tsx` (catch block).
- **Doctrine**: closes crash window (b) — the record-failed window the draft *created* but never captured; honesty (persisted, not just toasted).
- **Residual-risk note (must be documented, not silently claimed closed):** a process death **after** `tseClient.finish()` returns but **before** `enqueueSignatureRecordOnly` writes loses that signature; the Fiskaly intention is already finished, so re-finish will fail. This narrow window is **accepted residual risk** for this cluster (closing it requires a finish-attempted marker written *before* `finish()`, which is a larger design — see B1 handling in Step 5b for the drain-side of the same shape). Do not claim window (b) is fully closed; claim it is closed *except* for this documented sub-window.
- **Verify**: the gate + unit test asserting the record-only path writes a `signature_json`-populated row and that a prior NULL-signature row for the same `intention_id` is promoted (not duplicated). Live deferred.

### Step 4 — Retarget `tse-service.test.ts` AND delete the legacy exports in the SAME step (C1)
- **Build**: Rewrite `apps/tauri-pos/src/lib/tse-service.test.ts` (today hard-codes `'warehouse14.tse-queue.v1'` at `:12` and calls sync `readQueue()` at `:47`) to exercise the new store seam via the mocked `@tauri-apps/plugin-sql`; move the corrupt-entry-drop coverage into the Step 2 store tests (now enforced by `STRICT` + the row parse). **In the same step**, delete `readQueue`, `enqueueFailure`, `QUEUE_STORAGE_KEY`, `TseQueueEntry`, `TseQueueEntrySchema` (`tse-service.ts:32-55,133-159`). Deleting the exports and retargeting their only consumer together is what keeps `pnpm -r typecheck` (which type-checks test files) green at the step boundary — deleting in Step 3 while the test still imported them would go red (the draft's Step 3→4 split violated its own per-step-gate rule).
- **Files**: `tse-service.test.ts`, `tse-service.ts`.
- **Doctrine**: keep the corrupt-row-drop guarantee — now enforced end-to-end by the `STRICT` INTEGER column, not a discarded typebox schema.
- **Verify**: the gate + `vitest` green. No live.

### Step 5a — Build `createTseQueueDrain` + unit tests (pure, off-device)
- **Build**: New `apps/tauri-pos/src/lib/tse-queue-drain.ts` — `createTseQueueDrain(tseQueueStore, api, tseClient)` mirroring `createOfflineReplay` (`offline-replay.ts:49-116`): single-flight, `online` listener + startup sweep, try/finally, never-throw. Per drainable row (from `listDrainable(now)`):
  1. `markInFlight(id)`.
  2. If `signature_json IS NULL`: call `tseClient.finish(paramsFromRow)`. **On success, immediately `UPDATE signature_json` on the row (persist the signature) before calling `recordTseSignature`** — so a crash between a successful `finish()` and the record leg leaves a re-runnable record-only row instead of a NULL row that would re-`finish()` an already-finished intention (B1). If `finish()` fails with Fiskaly's **"already finished"** error, treat it as finish-consumed-with-unknown-signature → `markFailedTerminal` + surface (the signature is unreconstructable; do not loop). Then `recordTseSignature`.
  3. Else (`signature_json` populated): `recordTseSignature` **only** (never re-finish).
  4. On full success: `markSucceeded`. On any other error: `incrementAttempt`; at `MAX_ATTEMPTS` → `markFailedTerminal`.
  `recordTseSignature` is server-idempotent (`transactions.ts:262`, "Idempotent — safe to retry"; `created:false` on repeat at `transactions.ts:205-206`), so a re-run of the record leg is safe.
- **Files**: `tse-queue-drain.ts` (new).
- **Doctrine**: single at-most-once path; never re-finish a finished intention; the FINISH-already-consumed hole is explicitly terminal, not an infinite loop.
- **Verify**: unit tests against the mocked store + fake `tseClient`/`api`: finish-then-record for NULL sig; signature persisted *before* record leg (assert the intermediate `UPDATE`); record-only for populated sig; "already finished" → `failed_terminal`; cap→`failed_terminal`. Then the gate + `vitest`. No live.

### Step 5b — Separate `useTseQueueDrain(enabled)` hook with its OWN running flag, mounted alongside `useOfflineReplay` (D-split-3)
- **Build**: A dedicated `useTseQueueDrain(enabled)` hook that owns the drain controller and its **own** single-flight flag and heartbeat trigger, mounted in `App.tsx` **next to** (not folded into) `useOfflineReplay`, gated on `status === 'authenticated'` (`App.tsx:47`). Do **not** edit `useOfflineReplay` or the CI-guarded middleware neighborhood (`api-context.tsx:82-94`, asserted by `production-middleware-order.test.ts`). Keeping the two drains independent means neither's `running` flag can starve the other and the guarded hook is untouched.
- **Files**: `apps/tauri-pos/src/app/App.tsx` (mount the new hook at the `:47` gate); the hook may live in `tse-queue-drain.ts` or a sibling.
- **Doctrine**: no double-finalize/starvation; CI-guarded order untouched.
- **Verify**: the gate + `vitest`. Live deferred to Step 6.

### Step 6 — Gerätemanager badge (net-new reader) + first live check (1.3 complete)
- **Build**: A reader calling `tseQueueStore.getStats()` rendered in `apps/tauri-pos/src/screens/geraetemanager/GeraeteManager.tsx` as a German count — e.g. "Ausstehende TSE-Signaturen: N" — with an alert tone while `failedTerminal > 0` and the count = `pending + inFlight + failedTerminal` (excludes `succeeded`, per D6, so it can return to zero). Degrade to a clean German empty/locked state when `Db.load` rejects (browser). Wire the D5 overflow acknowledgement as a manager step-up that records the **outage event** to the audit ledger (backlog count + earliest `created_at`); acknowledging does not clear the badge.
- **Files**: `GeraeteManager.tsx`.
- **Doctrine**: honesty (real count or clean empty/locked); overflow surfaced, never silent; no machine text; step-up has legal teeth (§146a outage notation), not ceremony.
- **Verify**: the gate; then **live on a real till/sim**: force a `finish()` throw (offline Fiskaly) → confirm a durable `signature_json`-NULL row appears and the badge shows the count; reconnect → drain replays, row goes `succeeded`, badge returns to **zero**; force a record-only failure → confirm a `signature_json`-populated row that drains via the record-only leg; confirm the queue **survives sign-out** (it must NOT be in `PER_OPERATOR_STORAGE_KEYS` — leave `AppShell.tsx` untouched).

### Step 7a — `pos_intents` store + `api-context` wiring + unit tests (off-device)
- **Build**: New `apps/tauri-pos/src/lib/pos-intents-store.ts` — `posIntentsStore` with `create({ key, intentType, sealedRequestJson, createdAt, retentionUntil:+10y })`, `markResolved(key, response)`, `markHandedOff(key)`, `markFailed(key, error)`, `listUnresolved()` (`WHERE resolved_at IS NULL AND failed_at IS NULL`, using `idx_intents_unresolved`). **`payload_json` stores the SEALED REQUEST, not just the body (G3):** `{ method, path, url, headers, body, deviceId, idempotencyKey, gobdRelevant }` — the exact fields `offlineQueueMiddleware` seals into an `OutboxRecord` (`offline-queue.ts` OutboxRecord shape). This makes `pos_intents` self-sufficient so Step 8's reconcile can reconstruct a valid `outbox_mutations` row without hitting the `url`/`headers_json`/`device_id` NOT NULL columns (`0001_outbox.sql:15,16,30`). Do **not** extend the api-client `OutboxStore` interface (D1 reason 3). Add `posIntentsStore` as a sibling to `outboxStore` at `apps/tauri-pos/src/lib/api-context.tsx:62`.
- **Files**: `pos-intents-store.ts` (new), `api-context.tsx` (sibling instantiation only; do not touch the locked middleware order at `:82-94`).
- **Doctrine**: self-sufficient sealed intent; cents-as-integers inside `body`; degrade-to-empty when `Db.load` rejects.
- **Verify**: unit tests (create/markResolved/markHandedOff/listUnresolved; assert the sealed shape round-trips all NOT-NULL outbox fields). The gate + `vitest`. No live.

### Step 7b — Verkauf intent-write before network + its three catches
- **Build**: In `apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx`: freeze the **existing** `idempotencyKeyRef.current` (generated via `newIntentionId()` at `BezahlenDialog.tsx:303`; do **not** introduce a new generator — G1); `await posIntentsStore.create({ key: idempotencyKeyRef.current, intentType:'sale', sealedRequestJson: the sealed finalize request })` **before** `transactionsApi.finalize` (before `BezahlenDialog.tsx:556`) so the write is on disk before the network. On 2xx: `await posIntentsStore.markResolved`. In the three existing `ApiOfflineQueuedError` catch branches (`BezahlenDialog.tsx:889`, `:1064`, `:1261`): `markHandedOff` (an outbox row now exists on the same key), **not** `markFailed`.
- **Files**: `BezahlenDialog.tsx`.
- **Doctrine**: closes only the pre-request gap (D4); `await`-to-disk before the network; the intent is handed off, not failed, once the outbox owns it.
- **Verify**: the gate + `vitest`. Live: kill the app between intent-write and `finalize` → confirm an unresolved `pos_intents` row remains (a sale intent).

### Step 7c — Ankauf intent-write before network + its catch
- **Build**: In `apps/tauri-pos/src/screens/ankauf/AnkaufBezahlenDialog.tsx`: freeze the **existing** `idempotencyKeyRef.current` (generated via `crypto.randomUUID()` at `AnkaufBezahlenDialog.tsx:104,122`; reuse the ref, do not unify generators — G1); `await posIntentsStore.create({ key, intentType:'ankauf', sealedRequestJson: the sealed ankauf request })` **before** `transactionsApi.ankauf` (before `AnkaufBezahlenDialog.tsx:252`); resolve on success; `markHandedOff` in the ankauf `ApiOfflineQueuedError` catch (`AnkaufBezahlenDialog.tsx:350`).
- **Files**: `AnkaufBezahlenDialog.tsx`.
- **Doctrine**: same as 7b.
- **Verify**: the gate + `vitest`. Live: kill the app between intent-write and `ankauf` → confirm an unresolved `pos_intents` row remains (an ankauf intent).

### Step 8 — 1.4 startup reconcile (funnel through the outbox)
- **Build**: In `offline-replay.ts` `start()`/startup sweep (`offline-replay.ts:101-108`), before/alongside `trigger()`: load `posIntentsStore.listUnresolved()`; for each, **insert-or-ignore an `outbox_mutations` row** built entirely from the sealed request in `payload_json` — `idempotencyKey` (same key), `method`, `path` (`/api/transactions/finalize` or `/api/transactions/ankauf`), `url`, `headers`, `body`, `device_id`, `gobd_relevant:1`. Because 7a persisted the full sealed request, every NOT-NULL outbox column is populated (G3 resolved). Then let `drainOutbox` carry it; mark the intent resolved-into-outbox (`markResolved`). Same session gate as `drainOutbox` (authenticated only; `App.tsx:47`; UNAUTHORIZED-as-transient at `offline-replay.ts:64-65`).
- **Files**: `offline-replay.ts` (reconcile in `start()`). Note: `offline-replay.ts` is in `@norns/api-client`; the reconcile must be injected (the app passes `posIntentsStore` into the replay controller) rather than importing the app-layer store into the package — keep the package boundary clean (D1 reason 3). If injection into the api-client controller is undesirable, place the reconcile in an app-layer wrapper invoked at the same startup gate; either way it runs before/alongside `trigger()`.
- **Doctrine**: one at-most-once FIFO path; the replay force-sets the key (`offline-replay.ts:62`) and the server partial-UNIQUE dedups the shared key → **no double-finalize** (D4). Reconcile is key-safe regardless of Step 0 (Step 0 covers the *direct* offline-enqueue path only).
- **Verify**: unit test — an unresolved intent produces exactly one insert-or-ignore on the matching key; a second run is a no-op; the reconstructed outbox row has all NOT-NULL columns populated from the sealed request. The gate + `vitest`. Live: simulate the pre-request crash (Step 7b/7c leave an unresolved intent), relaunch, confirm exactly **one** server transaction results and the intent is marked resolved-into-outbox.

---

## Sequencing rationale

Step 0 (client-only, removes the direct-path double-finalize latent) → Steps 1, 2, 3a, 3b, 4, 5a, 5b (self-contained 1.3: migration, pure store, source enrichment across both windows, test+delete together, drain build, drain hook — all unit-testable off-device) → Step 6 (first live check; 1.3 complete) → Steps 7a, 7b, 7c, 8 (riskiest — the live finalize dialogs, one dialog per step — last, behind a proven store, the corrected idempotency symmetry, and a self-sufficient sealed intent). 1.3 and 1.4 stay independent: 1.4 touches zero api-client store *types* and rides the existing outbox machinery via injection; 1.3 never touches the api-client package. Every step ends behind the green gate; the two steps that delete/retarget do so atomically (Step 4) to keep `typecheck` green at each boundary.

## Files touched (absolute)

- `/Users/basel/Desktop/warehouse14/packages/api-client/src/domains/transactions.ts` (Step 0)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/migrations/0003_tse_queue.sql` (new, Step 1)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/src/lib.rs` (Step 1, register version 3 after line 34)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/tse-queue-store.ts` (new, Step 2)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/tse-service.ts` (Steps 3a, 3b, 4)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx` (Steps 3a, 3b, 7b)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/screens/ankauf/AnkaufBezahlenDialog.tsx` (Steps 3a, 3b, 7c)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/tse-service.test.ts` (Step 4)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/tse-queue-drain.ts` (new, Steps 5a, 5b)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/app/App.tsx` (Step 5b, mount `useTseQueueDrain` at the `:47` gate)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/screens/geraetemanager/GeraeteManager.tsx` (Step 6, badge)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/pos-intents-store.ts` (new, Step 7a)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/api-context.tsx` (Step 7a, `posIntentsStore` sibling at line 62; do not touch `:82-94`)
- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/offline-replay.ts` (Step 8 reconcile, via injection at `start()` `:101-108`)

## Do-not-touch (guardrails)

- `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/migrations/0001_outbox.sql` and `0002_kyc.sql` — shipped, forward-only.
- `PER_OPERATOR_STORAGE_KEYS` in `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/app/chrome/AppShell.tsx` — never add the TSE queue (re-introduces the fiscal-record-loss bug the note guards).
- The locked middleware order in `api-context.tsx:82-94` (CI-asserted by `production-middleware-order.test.ts`) and the `useOfflineReplay` hook itself — the TSE drain is a **separate** hook with its own flag (Step 5b), never folded in.

## Residual risks explicitly accepted (not silently claimed closed)

1. **Step 3b inner window** — process death after `tseClient.finish()` returns but before `enqueueSignatureRecordOnly` persists the signature loses that signature (Fiskaly intention already finished). Accepted for this cluster; fully closing it needs a finish-attempted marker written before `finish()`.
2. **Step 5a "FINISH already consumed"** — a drain that crashes after a successful `finish()` but before the in-step `UPDATE signature_json` is mitigated by persisting the signature immediately on `finish()` return; the *remaining* case (crash between `finish()` returning and that `UPDATE`) resolves to a `failed_terminal` + surfaced row on the next sweep (the "already finished" branch), never an infinite re-finish loop.

Both are narrow, surfaced (badge + audit), and never silently drop a fiscal record.