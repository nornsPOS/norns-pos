# Red Team API Audit — 3rd-Party Addendum (Day 17)

- **Date:** 2026-05-25
- **Auditor:** Independent 3rd-party engagement (commissioned by Basel)
- **Scope:** Days 11–16 deliverables (`apps/api-cloud` + migrations 0006/0009/0013/0014/0015)
- **Antwort der Technik:** (this document)

---

## Auditor findings and CTO disposition

### Finding #1 — Reference Equality Bug (CRITICAL)
**Auditor observation:** In `routes/products.ts`, `marketingAttributes` was compared with `!==` against a previously-fetched array. Reference equality is wrong for jsonb fields — every PUT would record a spurious diff in `audit_log` even when content was identical.

**CTO disposition:** **Confirmed bug.** Pollutes the audit trail, increases storage, breaks the "diff signal-to-noise" of the Bridge UX audit view. **Fixed in Day 17** with a deterministic JSON-serialized deep-equality helper:

```ts
const isJsonEqual = (a, b) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
```

Primitives keep `Object.is` (correct NaN/+0/-0). jsonb fields opt-in via `maybe(key, next, prev, { jsonb: true })`. E2E test (`day17-catalog-customers-debt.test.ts`) asserts identical content → empty `changedFields`.

### Finding #2 — DB-side Financial Validation Gap (CRITICAL)
**Auditor observation:** `validateTransactionMath()` lives only in Node (`apps/api-cloud/src/lib/transaction-math.ts`). A direct SQL bypass (compromised migrator, future worker writing transactions, route bug) could land unbalanced rows.

**CTO disposition:** **Confirmed gap.** ADR-0008 §10 explicitly requires every fiscal invariant to live in the DB. The existing `transactions_balance_equation` CHECK only enforced `subtotal + vat = total` on the header — it did NOT verify the items-sum or payments-sum cross-table.

**Fixed in migration 0016** with `CONSTRAINT TRIGGER verify_transaction_balance` DEFERRABLE INITIALLY DEFERRED on all three tables. Fires at COMMIT (after items + payments have landed) and refuses:
- `Σ items.line_total ≠ transactions.total_eur`
- `Σ items.line_subtotal ≠ transactions.subtotal_eur`
- `Σ items.line_vat ≠ transactions.vat_eur`
- `Σ payments.amount ≠ transactions.total_eur`
- zero items at commit
- zero payments at commit

5 migration tests verify the trigger fires on the wrong paths and accepts the right one. Bypass-proof: even direct migrator SQL refuses unbalanced rows.

### Finding #3 — In-Memory Rate Limit (IMPORTANT, deferred)
**Auditor observation:** `@fastify/rate-limit` defaults to in-memory storage. Won't survive horizontal scaling / blue-green deploys.

**CTO disposition:** **Confirmed architectural cost, but accepted for V1.** ADR-0012 explicitly scopes V1 to single-instance Oracle Cloud. Switching to Redis-backed today adds operational complexity (Redis container provisioning, failover, persistence config) without serving a V1 use case.

**Deferred to Phase 1.5 as item I-6** (internes Arbeitsheft, §7.bis). The swap is a one-line plugin constructor option change once `RATE_LIMIT_REDIS_URL` lands. The plugin API surface is unchanged for routes.

### Praises noted
- `trustProxy: true` for Cloudflare Tunnel — confirmed correct.
- Mandatory `requireStepUp` on storno regardless of amount — confirmed as the right defense posture; not a "feature flag" temptation.

---

## Status after Day 17

| Finding | Severity | Status |
|---|---|---|
| #1 Reference equality | Critical | ✅ Fixed |
| #2 DB balance trigger | Critical | ✅ Fixed (migration 0016) |
| #3 In-memory rate limit | Important | ⏸ Phase 1.5 (I-6) |

The 3rd-party audit's confirmation of the existing defense-in-depth (PII teardown, mTLS, SECURITY DEFINER triggers, hash chain, step-up discipline) means the API can ship with the same confidence as the DB layer that earned its own Red Team report on 2026-05-25.
