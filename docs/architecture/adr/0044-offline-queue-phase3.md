# ADR-0044: API Client — Offline Queue & Idempotency (Phase 3)

**Status:** Proposed
**Date:** 2026-05-28
**Extends:** ADR-0042 (engine + telemetry + dedup), ADR-0043 (resilience: retry + circuit + step-up migration)
**Deciders:** Basel (Eng), Steuerberater (GoBD/KassenSichV review), Compliance reviewer
**Touches:** `packages/api-client`, `apps/tauri-pos/src-tauri` (SQLite + Rust commands), `apps/tauri-pos/src/lib/api-context.tsx`, server-side `Idempotency-Key` cache on `apps/api-cloud`

---

## 1. Context

After Phases 1 & 2 the client survives transient endpoint flaps and stale credentials. The last remaining originally-prioritized failure is **Mode A — wifi drops mid-transaction**. Today, a POST that hits `ApiNetworkError` is surfaced as a toast and silently lost. For a German precious-metals / antiques retailer this is not just bad UX — it is a **GoBD §146 breach**: a sale, Ankauf (buyback), or Storno the cashier believes was tendered must be persistable and reconstructible, regardless of network state at the moment of tender.

Warehouse14-specific stakes that sharpen the requirement:

- **Ankauf is fiscally heavier than retail sale.** GwG identity records are linked to the transaction at the moment of intake. A lost Ankauf row = lost identity record = §259 StGB exposure (Hehlerei defense weakens).
- **§25a UStG margin tax and §25c investment-gold VAT exemption** are decided per line item at tender time. A re-keyed mutation after offline period must not allow the tax_treatment lookup to drift; the original choice is the audit record.
- **Smurfing detection** (Weil am Rhein, Dreiländereck DE/CH/FR — see dem internen Arbeitsheft (nicht veröffentlicht). A queue that replays out-of-order would mask threshold-crossing patterns.
- **Metal-price volatility.** Spot gold can move 1–2 % in a single offline hour. The queue stores the price *agreed at tender time*, not the current price at replay — the customer's contract is the historical price.
- **The Owner monitors live from home.** The Control Desktop (Tauri app on Windows) consumes the same API. An offline event at the shop must be visible to the Owner as "X mutations pending sync" within seconds of reconnection.

Operational constraints:

- Single Mac mini per till on the Tauri POS side (internes Arbeitsheft). The replay loop must survive process restarts, macOS updates, power loss. In-memory queues are non-starters.
- The app is unsigned for the Tauri side initially (code-signing pending). The replay path must not depend on background processes that Gatekeeper might quarantine — it lives inside the same Tauri process as the UI.
- End user is non-technical; a stack trace is never acceptable.

---

## 2. Decision summary

1. Add `offlineQueueMiddleware` to the production chain, positioned **above retry** so it intercepts network failures (and `ApiCircuitOpenError`) before retry burns budget on unreachable infrastructure.
2. Persist queued mutations in a Tauri-side SQLite table `outbox_mutations` with bifurcated retention: **10 years for GoBD-relevant rows (sales, ankauf, payments, storno, cash-movements), 30 days otherwise**.
3. **Idempotency keys are caller-supplied** by intent-bearing code paths (the fiscal contract). The middleware **auto-generates** UUID v7 keys for non-fiscal mutations as ergonomics, with a flag marking the difference for audit.
4. Conflict resolution on replay distinguishes three categories — **transient, permanent, divergent** — and only divergent conflicts halt the queue pending human review through the Compliance Inbox (ADR-0045).
5. Introduce two new typed exceptions: `ApiOfflineQueuedError` (success-equivalent from UI POV: "Im Offline-Modus gespeichert — Synchronisierung läuft") and `ApiOutboxConflictError` (audit-required: action diverged from server state).
6. The replay loop is a **single-flight, in-order, Tauri-driven background task** that reuses the same `ApiClient` (and thus the same middleware chain), preventing duplicate logic and ensuring telemetry sees every replay attempt.

---

## 3. Layer ordering — the load-bearing call

The Phase 2 order was:

```
step-up → retry → telemetry → circuit → dedup → terminal
```

Adding offline-queue, the candidate positions and why each fails or works:

| Candidate position | Verdict | Reasoning |
|---|---|---|
| Below dedup (innermost) | ❌ | Dedup only fires for GET. Offline-queue only acts on mutations. They never overlap, but placing offline-queue below circuit means a fast-fail `CIRCUIT_OPEN` would **never enqueue**, even though the user's intent is just as durable as if the network had dropped. We'd lose Ankauf rows during cloud-API flaps. |
| Below circuit, above dedup | ❌ | Same as above. Circuit-OPEN ≠ network-down, but to a cashier who just pressed "Ankauf bestätigen" the user-visible outcome ("Cloud nicht erreichbar") is identical. Both must enqueue. |
| Above retry (chosen) | ✅ | Catches `ApiNetworkError` AND `ApiCircuitOpenError` before retry wastes attempts on transient unreachability. Retry's behavior on POST is no-op anyway (mutations aren't retried without an idempotency key contract); placing offline-queue above retry just makes the enqueue happen one layer sooner. For GETs, retry still operates normally because offline-queue passes GETs through. |
| Above step-up (outermost) | ❌ | A `STEP_UP_REQUIRED` while online means the cashier must re-PIN. Queueing it would defer the PIN modal until next connectivity — meaningless and confusing. Step-up must run first. |

**Final order:**

```
step-up → offline-queue → retry → telemetry → circuit → dedup → terminal
```

This change demotes Phase 2's "retry sees everything" assumption slightly: retry now sees only requests that offline-queue chose to forward. For mutations, that means retry sees nothing it can act on (POST isn't retried by default). For reads, retry behavior is unchanged.

A second-order consequence: telemetry no longer logs the *enqueue event* (it sits below offline-queue). The middleware emits its own telemetry via the same injected `TelemetrySink` — deliberate, because the enqueue is a **state transition in the outbox**, not a request attempt, and conflating the two muddies the audit trail.

---

## 4. Idempotency keys — generation, ownership, lifecycle

This is the **single hardest correctness concern in Phase 3**. The key must satisfy:

- **Pre-flight existence.** The key exists *before* the first network attempt, persisted with the user-intent record. If the device crashes between intent crystallization and the network call, the next launch must be able to find the orphan intent and resubmit with the *same* key.
- **Identical across all attempts.** The first attempt and the Nth replay must carry byte-identical `Idempotency-Key` headers. Server-side dedup depends on this.
- **Auditable provenance.** Auditor must be able to say: "key X was generated at time T by intent Y on device D" — so keys are time-ordered (UUID v7) and the outbox row records `device_id` and `caller_supplied_key` provenance.
- **Crash-survival for fiscally relevant mutations.** Sales, Ankauf, Storno, cash-movements: the key persists to disk *before* the request enters the middleware chain.

### Ownership model: caller-supplied, middleware-fallback

```
ankauf / sales / storno / cash-movement   →  caller persists intent + key
                                              BEFORE invoking client.request
                                              passes via opts.meta.custom.idempotencyKey

inventory adjustments / non-fiscal         →  middleware auto-generates UUID v7
                                              tags meta.custom.idempotencyKeyAutoGenerated = true
```

Why bifurcated:
- Forcing every call site to generate a key is unergonomic for low-stakes mutations and a footgun (developers forget). Auto-generation in the middleware lifts the cognitive load.
- Forcing the middleware to generate keys for fiscal mutations is *unsafe*: by the time the middleware sees the request, the user-intent record on disk does not yet have the key, so a crash before middleware runs loses the linkage forever. The fiscally critical call sites must persist their intent and key atomically.

The flag `idempotencyKeyAutoGenerated` is forensic: an auditor reading the outbox can see at a glance "this row was generated by a low-stakes path; loss-of-intent on crash is acceptable" vs "this row was caller-supplied and survives crash by contract".

### Key format

UUID v7 (RFC 9562) — 128 bits, time-ordered, encoded as 36-char string. Time-ordered helps SQLite index locality on `enqueued_at` correlation.

For fiscal mutations, the caller SHOULD suffix the key with a deterministic intent hash and the device fingerprint: `<uuidv7>-<sha256(intent-payload)[:8]>-<device-id-short>`. This lets crash-recovery match orphan intents to enqueued rows by structural prefix even if the linking ID was lost, and lets the multi-device future (if a second till is added) avoid collisions.

### Header

```
Idempotency-Key: <uuidv7>[-<hash8>[-<device-id-short>]]
```

Standard `Idempotency-Key` header per the in-flight IETF draft. Server contract: same key + same body → cached response. Same key + different body → 409 with `code: 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY'` (a developer bug or tampering signal — see §6 conflict categories).

### Crash-recovery contract (fiscal paths)

Fiscally critical call sites (e.g. `ankaufFlow.tender()`, `salesFlow.finalize()`, `stornoFlow.issue()`, `shifts.cashMovement()`) MUST follow this sequence:

```
1. generateKey() → uuidv7-hash8-device
2. INSERT INTO pos_intents (key, intent_type, payload_json, created_at) VALUES (?, ?, ?, ?)
   -- atomic; survives crash
3. client.request('POST', path, payload, {
     meta: { custom: { idempotencyKey: key, gobdRelevant: true } }
   })
4. on success: UPDATE pos_intents SET resolved_at = ?, response_json = ? WHERE key = ?
5. on offline-queued: leave pos_intents row; outbox row carries the key
6. on permanent failure: UPDATE pos_intents SET failed_at = ?, error_json = ?
```

On app startup, a recovery sweep:

```sql
SELECT i.* FROM pos_intents i
LEFT JOIN outbox_mutations o ON i.key = o.idempotency_key
WHERE i.resolved_at IS NULL AND i.failed_at IS NULL
```

- Intent + outbox row present → outbox replay will handle it.
- Intent present, outbox row absent → orphan; re-invoke `client.request` with the same key. Server-side idempotency makes this safe.

An ESLint rule (`@norns/eslint-plugin/require-idempotency-key-on-fiscal-write`) flags any `client.request` to a fiscal route lacking `meta.custom.idempotencyKey`. The fiscal route set is exported as a const map from the api-client package, shared with the server's route registration so they cannot drift.

---

## 5. SQLite schema — outbox + intent

### `outbox_mutations`

```sql
CREATE TABLE IF NOT EXISTS outbox_mutations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key   TEXT NOT NULL UNIQUE,
  trace_id          TEXT NOT NULL,
  method            TEXT NOT NULL,
  path              TEXT NOT NULL,
  url               TEXT NOT NULL,
  headers_json      TEXT NOT NULL,        -- sealed at enqueue; replay uses these exact headers
  body_json         TEXT NOT NULL,        -- zlib-compressed for rows >2KB
  enqueued_at       INTEGER NOT NULL,     -- ms epoch, device clock
  monotonic_seq     INTEGER NOT NULL,     -- per-device atomic counter — ordering authority
  last_attempt_at   INTEGER,
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL,        -- 'pending' | 'in_flight' | 'succeeded' | 'failed_terminal' | 'conflict' | 'deferred'
  last_error_json   TEXT,
  response_json     TEXT,                 -- cached server response, for audit + UI replay
  resolved_at       INTEGER,
  gobd_relevant     INTEGER NOT NULL DEFAULT 0,
  retention_until   INTEGER NOT NULL,     -- ms epoch; +10y if gobd_relevant else +30d
  caller_supplied_key INTEGER NOT NULL DEFAULT 0,
  device_id         TEXT NOT NULL
);

CREATE INDEX idx_outbox_status_seq ON outbox_mutations(status, monotonic_seq);
CREATE INDEX idx_outbox_retention ON outbox_mutations(retention_until);
CREATE INDEX idx_outbox_trace ON outbox_mutations(trace_id);
```

Notes:
- `monotonic_seq` is a per-device counter incremented atomically on insert. It is the **authoritative ordering field** for replay — device clocks can skew (NTP correction during offline period). `enqueued_at` is kept for human-readable audit.
- `headers_json` is **sealed at enqueue**. Replay does NOT recompose headers from current state — auth cookies will have rotated, but the server validates them at *original intent time* via the `Idempotency-Key` cache.
- `body_json` over 2KB is zlib-compressed. Antique catalog payloads with photos and provenance notes hit this threshold.
- `gobd_relevant` is set by a route classifier (a const map shared between client and server). Paths matching `/ankauf`, `/sales`, `/storno`, `/cash-movements`, `/shifts/close` are flagged true.

### `pos_intents` (caller-side, fiscal paths only)

```sql
CREATE TABLE IF NOT EXISTS pos_intents (
  key               TEXT PRIMARY KEY,
  intent_type       TEXT NOT NULL,        -- 'ankauf' | 'sale' | 'storno' | 'cash_movement' | 'shift_close'
  payload_json      TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  resolved_at       INTEGER,
  response_json     TEXT,
  failed_at         INTEGER,
  error_json        TEXT,
  retention_until   INTEGER NOT NULL      -- always +10y; fiscal-only table
);

CREATE INDEX idx_intents_unresolved ON pos_intents(resolved_at, failed_at);
```

### Schema migrations

Use SQLite `user_version`. Each migration script lives in `apps/tauri-pos/src-tauri/migrations/` and is forward-only. On Tauri startup, run pending migrations before any UI mounts. Rollback strategy: none — for financial-record tables, destructive rollback is prohibited by §25a UStG documentation requirements. Bug-fix migrations only.

---

## 6. Conflict resolution — three categories

Server response to a replayed mutation falls into exactly one of:

| Category | Server signal | Status set to | Action |
|---|---|---|---|
| **Success** | 200/201 with body | `succeeded` | Store `response_json`, surface to UI ("Ankauf #4711 synchronisiert"), `resolved_at` = now |
| **Transient** | `ApiNetworkError`, 5xx, 429 (with Retry-After), `CIRCUIT_OPEN` | remain `pending` | Increment `attempt_count`, store `last_error_json`, sleep per backoff schedule, re-attempt. After 50 attempts, downgrade to `failed_terminal` + alert |
| **Permanent (caller-fixable)** | 400, 422 | `failed_terminal` | Audit-log full body + error. Alert UX: "Vorgang #X benötigt manuelle Prüfung". Linked to a worklist. |
| **Divergent (server state collision)** | 409 with `code: 'STATE_DIVERGED'` (e.g. Storno on an already-closed Tagesabschluss, refund on already-refunded sale, Ankauf line item where the metal price has moved beyond an agreed tolerance) | `conflict` | **Halt the queue head until human review** via Compliance Inbox (ADR-0045). |
| **Duplicate-key abuse** | 409 with `code: 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY'` | `conflict` | Treated identically to divergent. Indicates tampering or a developer bug. Forensic alert. |
| **Step-up required** | 403 with `code: 'STEP_UP_REQUIRED'` | remain `pending` | Step-up sits above offline-queue. The replay-loop sets `meta.custom.skipStepUp = true` because there is no UI to present in the background. Marked `pending` for the next foreground cycle. |
| **Sanctions block** | 403 with `code: 'SANCTIONS_BLOCK'` | `failed_terminal` | The customer was sanctioned during the offline window. Per GwG, this rises to a Compliance Inbox conflict for the Owner. |
| **Closing-day finalized** | 409 with `code: 'CLOSING_DAY_FINALIZED'` | `conflict` | Tagesabschluss already locked for the fiscal day. Cannot be auto-resolved. |

**Why `conflict` halts the queue head rather than skipping:** in a fiscal-record system, applying mutation N+1 when mutation N is in conflict can produce nonsensical states (e.g. a Storno applied before its parent sale is reconciled, or a cash-movement applied across a closed Tagesabschluss). Strict FIFO halt is the safe default. The Compliance Inbox UI (ADR-0045) gives the Owner the controls to advance.

### The replay loop

Single-flight, per-device, FIFO by `monotonic_seq`. Driven by a Tauri network-status listener:

```
on network status changed to online:
  acquire replay lock (single-instance per app process)
  while online and queue head exists:
    row ← peek head where status = 'pending'
    if none: break
    UPDATE row SET status = 'in_flight', last_attempt_at = now()
    attempt ← client.request(row.method, row.path, decompress(row.body_json), {
      headers: row.headers_json,
      meta: { custom: {
        skipOfflineQueue: true,
        skipStepUp: true,
        idempotencyKey: row.idempotency_key,
        gobdRelevant: row.gobd_relevant,
      } },
    })
    classify outcome → update status per table above
    if conflict: emit ConflictRequiresReviewEvent, break loop
  release replay lock
```

`skipOfflineQueue: true` prevents recursive enqueueing during replay. `skipStepUp: true` ensures the background task doesn't try to open a PIN modal at the cashier's screen.

---

## 7. Retention policy — 10y for fiscal, 30d otherwise

GoBD §147 requires 10-year retention of fiscally relevant records. The split:

- `gobd_relevant = 1` → `retention_until = enqueued_at + 10 years`
- `gobd_relevant = 0` → `retention_until = enqueued_at + 30 days`

A daily job (Tauri scheduled task at 03:00 device time) runs:

```sql
DELETE FROM outbox_mutations
WHERE retention_until < ?
  AND status IN ('succeeded', 'failed_terminal')
  AND gobd_relevant = 0;
```

**Rows in `conflict` or `deferred` state are NEVER auto-pruned**, regardless of retention. They require explicit human resolution audit-logged before deletion.

### Archive workflow (end of fiscal year)

End of fiscal year, the Owner runs the export command from the Control Desktop:

1. Filter `outbox_mutations WHERE status IN ('succeeded', 'failed_terminal') AND gobd_relevant = 1 AND enqueued_at < <year_end>`.
2. Bundle to a tamper-evident DATEV-compatible archive (XML + SHA-256 hash file).
3. Write to AWS Glacier Deep Archive eu-central-1 (per das interne Arbeitsheft, §4 retention strategy) AND to a local NAS as second copy.
4. Operator confirms successful read-back; only then are rows marked `archived` and eligible for deletion (but kept in DB for 1 more fiscal year as safety buffer).

### Storage growth model

Estimate: ~25 Ankauf/sale rows per day × 365 days × 10 years ≈ 91,000 fiscal rows. Average compressed body ~1.5KB (Ankauf payloads include intake photos referenced by R2 URL, not embedded — but condition descriptors and Stempel/hallmark notes add bulk). Total table size ~140 MB over 10 years on a single device — fully acceptable for a Mac mini.

---

## 8. New typed exceptions

### `ApiOfflineQueuedError`

```ts
export class ApiOfflineQueuedError extends Error {
  readonly idempotencyKey: string;
  readonly enqueuedAt: number;
}
```

Semantically a **success** from the UI POV: the user's intent is durable, the mutation will sync. The toast is "✓ Im Offline-Modus gespeichert — Synchronisierung läuft" (warm tone, not error). The caller that catches it should NOT treat it as failure — UI state should advance as if the mutation succeeded, with a "Sync ausstehend" badge.

### `ApiOutboxConflictError`

```ts
export class ApiOutboxConflictError extends Error {
  readonly idempotencyKey: string;
  readonly serverCode: 'STATE_DIVERGED' | 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' | 'CLOSING_DAY_FINALIZED' | 'SANCTIONS_BLOCK';
  readonly serverDetails: unknown;
}
```

Emitted by the replay loop (via an event bus to the UI) — NOT thrown to the original caller, because by the time the conflict is detected, the original caller has long since received an `ApiOfflineQueuedError` and the UI has moved on. The conflict surfaces as a Compliance Inbox entry (ADR-0045).

---

## 9. Middleware sketch

```ts
// packages/api-client/src/middleware/offline-queue.ts (Phase 3 — to land)

export interface OutboxStore {
  enqueue(record: OutboxRecord): Promise<void>;
  markSucceeded(key: string, response: unknown): Promise<void>;
}

export interface OfflineQueueDependencies {
  store: OutboxStore;
  isOnline: () => boolean;
  generateKey: () => string;
  classifyGobdRelevant: (req: MiddlewareRequest) => boolean;
  deviceId: string;
}

export function offlineQueueMiddleware(deps: OfflineQueueDependencies): Middleware {
  return async (req, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next(req);
    if (req.meta.custom?.skipOfflineQueue === true) return next(req);

    const callerSupplied = typeof req.meta.custom?.idempotencyKey === 'string';
    const idempotencyKey = callerSupplied
      ? (req.meta.custom!.idempotencyKey as string)
      : deps.generateKey();

    req.headers['idempotency-key'] = idempotencyKey;
    req.meta.custom = {
      ...(req.meta.custom ?? {}),
      idempotencyKey,
      idempotencyKeyAutoGenerated: !callerSupplied,
    };

    const gobdRelevant = req.meta.custom?.gobdRelevant === true
      || deps.classifyGobdRelevant(req);

    if (!deps.isOnline()) {
      await deps.store.enqueue(buildRecord(req, idempotencyKey, gobdRelevant, callerSupplied, deps.deviceId));
      throw new ApiOfflineQueuedError(idempotencyKey, Date.now());
    }

    try {
      return await next(req);
    } catch (err) {
      const shouldEnqueue =
        err instanceof ApiNetworkError ||
        err instanceof ApiCircuitOpenError;
      if (!shouldEnqueue) throw err;
      await deps.store.enqueue(buildRecord(req, idempotencyKey, gobdRelevant, callerSupplied, deps.deviceId));
      throw new ApiOfflineQueuedError(idempotencyKey, Date.now());
    }
  };
}
```

Full implementation, replay loop, Rust-side Tauri commands, and tests are out of scope for the ADR — tracked as action items.

---

## 10. Consequences

**Easier:**
- Mutations during wifi blips are no longer lost. UX shows "Im Offline-Modus gespeichert" instead of an error.
- GoBD §146 / §147 compliance for sale-at-tender-time is enforced by the durability contract.
- Conflict workflow makes silent server-side divergence impossible to ignore.
- GwG identity records remain linked to their transactions because the Ankauf intent persists before any network call.

**Harder:**
- Call-site convention burden: fiscal paths MUST persist intent + key before invoking the client. ESLint rule mitigates but doesn't eliminate footgun risk.
- Storage management: yearly export-to-archive workflow needs to exist before this ADR can be marked Accepted. Owner must be trained.
- Schema migrations are forward-only and immutable for the outbox — a bug in the schema is a multi-year liability.
- Replay loop adds a new failure mode: if the loop crashes mid-replay (e.g. SQLite corruption), the queue head may stay `in_flight` forever. Recovery sweep at startup must detect `in_flight` rows older than 5 minutes and revert them to `pending`.
- Smurfing detection on the server depends on transaction order; replay-after-extended-offline may flag a chunk of transactions retroactively. Coordinate with the smurfing middleware spec (internes Arbeitsheft, §3) so the audit understands the replay flag.

**To revisit:**
- Long-haul retention strategy after 10y mark: archive format, key rotation for archive integrity, regulator-accepted storage mediums beyond Glacier.
- Conflict UI: see ADR-0045 for the Compliance Inbox.
- Multi-device coordination: if a second till is added (internes Arbeitsheft, §1 "multi-location-ready"), per-device idempotency keys avoid collisions; per-device monotonic_seq diverges and a server-side merge order needs to be defined.

---

## 11. Action items

1. [ ] Add `outbox_mutations` and `pos_intents` migrations to Tauri SQLite via Drizzle.
2. [ ] Implement `OutboxStore` interface backed by `tauri-plugin-sql` (Rust commands exposed to JS).
3. [ ] Implement `offlineQueueMiddleware` and add to `productionMiddlewares` at the second position (after step-up, before retry).
4. [ ] Implement replay loop as a Tauri background task triggered by network-status changes.
5. [ ] Add `ApiOfflineQueuedError` and `ApiOutboxConflictError` exception classes; wire UI banner copy.
6. [ ] Add UUID v7 generation utility (use `uuid` v9.x with the `v7` export).
7. [ ] Add `classifyGobdRelevant` route-map const, shared between middleware and the fiscal call-site convention; mirror the const on the server's route registration.
8. [ ] ESLint rule: flag fiscal-path `client.request` without `meta.custom.idempotencyKey`.
9. [ ] Call-site refactor: `ankaufFlow.tender()`, `salesFlow.finalize()`, `stornoFlow.issue()`, `shifts.cashMovement()`, `shifts.close()` to follow the persist-intent-first contract.
10. [ ] Server-side (`apps/api-cloud`): confirm `Idempotency-Key` cache TTL ≥ 30 days on `/ankauf`, `/sales`, `/storno`, `/cash-movements`, `/shifts/close`. Document in OpenAPI.
11. [ ] CI integration test: simulate 100 mutations enqueued offline, then reconnect, assert FIFO replay completes without duplicates and without conflicts.
12. [ ] CI conflict test: simulate `STATE_DIVERGED` response on row #50; assert queue halts at #50 and rows #51-#100 stay `pending`.
13. [ ] Build the end-of-year archive export tool, surfaced in Control Desktop.
14. [ ] Operator runbook: how to review a halted queue, how to run end-of-year archive, how to verify archive integrity.
15. [ ] Steuerberater sign-off: review of 10y retention policy, conflict workflow, and archive procedure against GoBD §146 / §147 + §25a UStG documentation requirements.

---

## 12. Open questions for compliance review

1. **Server idempotency cache TTL.** If `apps/api-cloud` caches `Idempotency-Key` results for only 24h, a device offline for 48h produces server-side ambiguity on replay. Recommended TTL: ≥30 days. Confirm with Steuerberater and document in §25a outsourcing controls.
2. **Conflict resolution audit format.** A `conflict` row's resolution must be logged: who reviewed, when, what action. Does it belong in `outbox_mutations.response_json`, in a separate `conflict_resolutions` table, or in the existing append-only ledger (internes Arbeitsheft, §3)?
3. **Device fingerprint in keys.** Embed device fingerprint as key suffix so multi-device futures don't collide. Confirm fingerprint stability across macOS updates.
4. **Smurfing detection interaction.** Coordinate with smurfing middleware (internes Arbeitsheft, §3): replay-after-offline mutations should carry a `was_offline_queued` flag so the smurfing window calculation treats them honestly.
5. **TSE state machine interaction.** The Fiskaly SIGN DE V2 cloud TSE has its own offline-queue semantics for the INTENTION → TRANSACTION → FINISHED state machine. The outbox here is for the *API request* layer; the TSE queue is a separate concern at the hardware/signing layer. Document where they intersect.

---

*End of ADR-0044.*
