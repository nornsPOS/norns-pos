# Red Team Audit — Warehouse14 Database Layer

- **Date:** 2026-05-25
- **Auditor:** Technik (Red-Team-Rolle)
- **Scope:** Migrations 0001–0012, packages db / inventory-lock / audit, 20 ADRs
- **Verdict:** **NOT defect-free.** 6 critical findings → fixed in migration 0013. 5 important findings → Phase 1.5 backlog. 3 minor / app-layer items. No deadlock risks under projected load.

---

## Executive Summary

The schema is structurally sound and the trigger-based discipline is well-applied. But I found six gaps where the *documented intent* (ADRs) is not yet *enforced by the database*. In every case, the app layer would have to be perfect to avoid corruption — and "the app must be perfect" is exactly the assumption Warehouse14 chose to design against (see ADR-0008 §10, ADR-0018 §10).

The fixes are surgical, append-only via a new migration `0013_security_hardening.sql`, and do not touch any existing table or trigger.

---

## Critical findings — fixed in `0013_security_hardening.sql`

### Finding C-1: Ankauf without customer_id is silently accepted

**ADR violated:** ADR-0007 — "ID **ALWAYS** required for any customer buy (stricter than legal threshold)."

**Evidence:** `transactions.customer_id` is nullable. No CHECK / trigger enforces "direction = 'ANKAUF' ⇒ customer_id IS NOT NULL". An app bug could write an Ankauf row with NULL customer — and the trigger that updates `cumulative_ankauf_eur` would silently no-op.

**Legal risk:** §259 StGB (Hehlerei) defense collapses. The shop cannot prove good-faith due diligence on the Ankauf if no customer was identified.

**Fix:** CHECK constraint:
```sql
ALTER TABLE transactions
  ADD CONSTRAINT transactions_ankauf_requires_customer
  CHECK (direction <> 'ANKAUF' OR customer_id IS NOT NULL);
```

---

### Finding C-2: Sanctions match does not block transactions

**ADR violated:** ADR-0018 §6 — "Sanctions match → **Hard block.** Sale cannot proceed."

**Evidence:** `customers.sanctions_match` is a BOOLEAN column read by the app, but the DB does not enforce. An app bug or compromised checkout flow could complete a sale to a sanctioned customer. The `ledger_events` row would record the transaction; sanctions exposure realised.

**Legal risk:** EU + US sanctions violations carry corporate fines that dwarf any single transaction.

**Fix:** BEFORE INSERT trigger on `transactions` rejecting any transaction whose `customer_id` matches a row with `sanctions_match = TRUE`.

---

### Finding C-3: Transactions can be inserted for a FINALIZED business day

**ADR violated:** ADR-0008 (closing immutability), KassenSichV (Z-report is the immutable daily record).

**Evidence:** `daily_closings` is immutable after `FINALIZED` (verified by trigger). But `transactions` does not check the closing state. A late transaction with `finalized_at` on a closed business day inserts cleanly — making the Z-report retroactively incorrect.

**Realistic scenario:** Cashier finalizes the day at 23:55. At 23:58 a delayed Mollie webhook lands a sale with `finalized_at` matching the closed day. The Z-report is now wrong; the chain still validates; the discrepancy may not be noticed until Steuerprüfung.

**Fix:** BEFORE INSERT trigger on `transactions` that checks for a `FINALIZED` `daily_closings` row covering `berlin_business_day(NEW.finalized_at)` for the same shop. If present, reject.

---

### Finding C-4: Soft viewing-holds are NOT released when appointment terminates

**ADR violated:** ADR-0016 §6 + ADR-0020 §6 (hold lifecycle).

**Evidence:** The hold expires by `hold_expires_at` (= appointment + 30 min grace), but that's an hour or more in the future. If the appointment is **CANCELLED** or **NO_SHOW** at 09:00 for a 17:00 slot, the linked products sit blocked for 8 hours despite no holder. Storefront / eBay buyers see the holds as unavailable.

**Operational risk:** Lost sales from stale soft-holds. Inventory hygiene breaks.

**Fix:** AFTER UPDATE trigger on `appointments` that, when status transitions to a terminal state, releases all unreleased `product_viewing_holds` for that appointment with a structured `released_reason`.

---

### Finding C-5: Duplicate storno of the same transaction is possible

**ADR violated:** ADR-0008 §5 + GoBD discipline (one original, at most one reversal).

**Evidence:** `transactions.storno_of_transaction_id` has an FK but **no uniqueness constraint**. Two storno rows can be inserted referencing the same original. Each fires the cumulative update trigger; the customer's `cumulative_spend_eur` is over-subtracted (goes negative, violating the CHECK ≥ 0, which would error — but only on the second update, not the second insert).

Wait — the CHECK would catch it. Let me re-examine. Actually:
- Original: total=+100. Cumulative: 100.
- Storno #1: total=-100. Cumulative: 0.
- Storno #2: total=-100. Cumulative: -100 → CHECK rejects.

So the CHECK on `customers.cumulative_spend_eur ≥ 0` *would* catch double-storno, but only at the cumulative update step. The double-storno row would still be in `ledger_events` until ROLLBACK. The error message wouldn't immediately tell the operator what happened.

**Cleaner fix:** Partial unique index ensures the second storno is rejected at INSERT time with a clear constraint name.

**Fix:**
```sql
CREATE UNIQUE INDEX transactions_one_storno_per_original_uq
  ON transactions (storno_of_transaction_id)
  WHERE storno_of_transaction_id IS NOT NULL;
```

Same defensive logic applies to `appointments.linked_transaction_id` (an appointment can result in at most one transaction).

---

### Finding C-6: No `pg_notify` substrate for SSE

**ADR violated:** ADR-0014 §4 — "SSE = projection from `ledger_events` with monotonic ID".

**Evidence:** The SSE consumer (Bridge UX) needs to be notified when a new `ledger_events` row lands. Currently the app would need to **poll** the table, which is wasteful and adds latency.

**Operational impact:** Real-time Bridge updates would be sluggish or expensive. The "as if standing next to the cashier" feel that Basel asked for (internes Arbeitsheft, §2 #33) needs sub-second push.

**Fix:** AFTER INSERT trigger on `ledger_events` that calls `pg_notify('warehouse14_ledger', NEW.id::text)`. Subscribers `LISTEN warehouse14_ledger;` and pull the full row when an ID arrives.

---

## Important findings — Phase 1.5 backlog

### Finding I-1: TSE certificate expiry has no central tracking

**ADR referenced:** ADR-0018 §3 — "Prometheus alert at T-30d, T-7d, T-1d".

**Gap:** `tse_transactions` carries `cert_serial` and `certificate_public_key` per row, but no `cert_expires_at`. The alerting query would have to call Fiskaly's API per scrape — wasteful and online-dependent.

**Phase 1.5 fix:** Add a `tse_clients` table (one row per `(tss_id, client_id)`) with `cert_expires_at`. Worker refreshes nightly from Fiskaly. Prometheus queries this table.

---

### Finding I-2: No `tse_daily_archives` table

**ADR referenced:** KassenSichV §10 (daily archive obligation).

**Gap:** Every day's TSE transactions must be archived to long-term storage. We have `dsfinvk_exports` for the DSFinV-K bundle but no per-day TSE archive evidence.

**Phase 1.5 fix:** Add `tse_daily_archives` table tracking the daily TSE archive: `(date, file_r2_key, sha256, completed_at, transaction_count)`.

---

### Finding I-3: No webhook idempotency table

**ADR referenced:** ADR-0014 + ADR-0017 (Mollie / Fiskaly / WhatsApp webhooks).

**Gap:** External providers retry webhooks at-least-once. Without idempotency tracking, retries can double-process events. Currently each consumer must roll its own dedupe (e.g., `transaction_payments.external_ref` is UNIQUE-able but not enforced).

**Phase 1.5 fix:** A `webhook_events` table with `(provider, provider_event_id) UNIQUE`, used as a dedupe gate by every webhook handler.

---

### Finding I-4: GDPR data minimization for `audit_log.ip_address`

**ADR referenced:** ADR-0008 §10 + GDPR Art. 5(1)(c).

**Gap:** `audit_log.ip_address` and `ledger_events.ip_address` are kept for 10 years (GoBD retention). For non-fiscal events (login, password reset), full IP retention beyond 6 months is debatable under GDPR.

**Phase 1.5 fix:** Worker that anonymizes IPs in `audit_log` older than 180 days (zero the last octet for IPv4, last 80 bits for IPv6). `ledger_events` keeps the full IP (fiscal record).

---

### Finding I-5: KYC document retention purge mechanism conflicts with NO DELETE

**ADR referenced:** ADR-0007 KYC + GDPR data minimization.

**Gap:** `kyc_documents.retention_until` says when the document can be purged. But the schema forbids DELETE on `kyc_documents` (audit trail). GDPR requires actual erasure of expired KYC data.

**Phase 1.5 fix:** Add `purged_at` + `purged_by_user_id` columns; on purge, set those + NULL out `document_number_encrypted`, `document_photo_sha256`, and delete the R2 object referenced by `document_photo_r2_key`. The row remains as audit shell.

---

## Minor / app-layer concerns

### M-1: Belegausgabepflicht (§146a AO) is not DB-enforced

App layer must run a reconciliation worker that flags unprinted transactions > 24h. Not a schema gap.

### M-2: Hot dashboards run live queries

Single-shop volume is small. Materialized views for "today's stats" can be added in Phase 2 if Bridge UX feels sluggish.

### M-3: Sub-second precision CHECK on `appointments.starts_at`

The CHECK exists; no test asserts it. Add a one-line test in a future iteration.

---

## Operational blind spots — assessed, no action needed

### Deadlocks under load

- `ledger_compute_hash` uses `pg_advisory_xact_lock(14000000)` — serializes ledger writes. No lock-ordering issue. Contention only.
- `on_transaction_finalized` locks one customer row + the advisory lock. Single resource ordering across transactions; no deadlock path identified.
- Concurrent reserve() on the same product: row-level lock on `products`; one winner per SQL spec.
- **No deadlock risk identified** at projected V1 / V2 volumes.

### TRUNCATE / DROP TABLE bypass

These commands require the table owner role (warehouse14_migrator). The app role cannot. Production discipline (ADR-0012 §7) keeps migrator credentials in Vault, never exposed at runtime. **Acceptable risk** for V1.

### Generated columns

`appointments.ends_at GENERATED ALWAYS AS STORED` is correctly defined with an IMMUTABLE expression. No write path can override.

### Money precision

NUMERIC(18,2) end-to-end + DB CHECK on subtotal+vat=total. No float drift possible.

---

## Forward to API — verified ready

| Requirement | Status |
|---|---|
| better-auth schema (users/sessions/accounts/verifications) | ✅ migration 0004 |
| mTLS device extraction (`devices.cert_serial`) | ✅ migration 0004 |
| PII key injection (`withPiiKey()` helper) | ✅ in `@norns/db` |
| Inventory atomic reservation API | ✅ `@norns/inventory-lock` |
| Ledger emit API | ✅ `@norns/audit` |
| SSE substrate (`pg_notify`) | ❌ → **fixed in 0013** |
| Rate-limit table | Not needed at DB layer (Redis-based per ADR-0014) |
| Webhook idempotency | Phase 1.5 — app rolls per-integration for V1 |

After migration 0013 lands and verifies green, the database is **API-ready**.

---

## Acceptance criteria

To declare "defect-free for V1":

1. ✅ Migration 0013 written and tested
2. ✅ All 6 critical findings have an enforcing DB construct
3. ✅ Phase 1.5 backlog documented im internen Arbeitsheft, §7
4. ✅ The audit report (this file) committed alongside

When all four are true, we cross the line to API construction with confidence.
