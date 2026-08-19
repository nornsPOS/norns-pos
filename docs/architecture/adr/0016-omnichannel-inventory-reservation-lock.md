# ADR-0016 — Omnichannel inventory authority: Postgres as the single source of truth, atomic reservations, soft viewing-holds, one-way eBay mirror

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Related:** ADR-0008 (the `ledger_events` chain anchors every state change here), ADR-0013 pending (Mollie + ZVT + Stripe — finalize through this lock), ADR-0014 (SSE pushes inventory state to all subscribed clients in real-time), ADR-0017 pending (WhatsApp bot reads inventory via this lock), **ADR-0020 pending (Smart Appointment System — the producer of soft viewing-holds defined here)** dem internen Arbeitsheft (nicht veröffentlicht).

## Context

Warehouse14 sells **unique items** — every gold ring, every coin, every antique is a one-of-one. The same item is exposed simultaneously on four channels:

1. **POS** — cashier finalizes a sale at the counter.
2. **warehouse14.de storefront** — online buyer hits Mollie checkout.
3. **eBay** — international buyer hits Buy It Now or makes a Best Offer.
4. **In-shop physical viewing** — booked via the appointment system (ADR-0020 pending), customer is on their way.

The race is real and the cost is large. A double-sell on a €4,000 gold bar means an angry customer, an eBay refund + rating hit, an apology workflow, and a fiscal anomaly to reconcile. The architecture has to make race conditions either **impossible** or **detectable and recoverable** — not "hopefully rare."

This ADR establishes one and only one authority for "is this item available?" — and defines exactly how every channel composes with it.

The constraints:

1. **No two-phase commit across systems.** eBay's API does not expose 2PC. Mollie does not. We cannot synchronously coordinate.
2. **Reservations have different lifetimes per channel.** A POS cashier holding the item physically may take 10 minutes to finalize. A Mollie checkout times out at 15 minutes. eBay Buy It Now is decided in seconds. A viewing appointment may span an hour and a half.
3. **eBay is eventually consistent, with latency.** A listing can persist on eBay for up to 30 seconds after we delete it. A Buy It Now webhook can arrive 2–30 seconds after the buyer clicks. There is a race window we cannot fully close — we narrow and we compensate.
4. **Audit posture from ADR-0008 must not be violated.** Every state change of every product must produce a `ledger_events` row.
5. **Smart Appointment integration.** Viewing appointments create *soft* holds that respect the simple state machine without polluting the AVAILABLE/RESERVED/SOLD axis.

## Decision

### 1. The canonical state machine

Each `products` row carries a `status` column that takes exactly one of four values:

```
                       ┌─────────────┐
                       │  DRAFT      │  ◄── output of the former Annahmestrecke (ADR-0015, ausgezogen 19.08.2026)
                       └──────┬──────┘
                              │ ADMIN approves
                              ▼
                       ┌─────────────┐
       ┌──── auto ────▶│  AVAILABLE  │  ◄── listed on storefront + eBay automatically
       │  release      └──┬───┬───┬──┘
       │ on timeout       │   │   │
       │ or cancel        │   │   │  reserved by any channel
       │                  ▼   ▼   ▼
       │            ┌─────────────────┐
       │            │   RESERVED      │
       │            │   by_channel    │  ◄── one and only one reservation at a time
       │            │   by_session    │
       │            │   expires_at?   │
       │            └────────┬───┬────┘
       │           paid /    │   │  timeout / cancel
       │           finalize  │   │
       │                     ▼   ▼
       │            ┌──────────┐ ┌─────────────┐
       └────────────│  SOLD    │ │ AVAILABLE   │  ◄── via auto-release job
                    └──────────┘ └─────────────┘
```

**No other states.** "On hold," "reserved for inspection," "preview-only" — they do not extend the state axis. They live in a separate concept (soft holds, §6) and the cashier-facing UI overlays them on top of the underlying state.

**Why exactly these four:** Each one corresponds to a financial reality the GoBD auditor expects to see. `DRAFT` = "not yet a sellable thing." `AVAILABLE` = "asset on the shelf." `RESERVED` = "in active sale flow." `SOLD` = "asset gone, revenue booked."

### 2. Atomic reservation via `UPDATE … WHERE status = 'AVAILABLE'`

This is the **only** way any code path in the entire system moves a product into `RESERVED`. There is no alternative entry point. The implementation lives in `packages/inventory-lock` and every channel imports it.

```sql
-- packages/inventory-lock/src/reserve.sql.ts
UPDATE products
   SET status                 = 'RESERVED',
       reserved_by_channel    = $1,                -- 'POS' | 'STOREFRONT' | 'EBAY'
       reserved_by_session_id = $2,                -- session UUID for traceability
       reserved_by_user_id    = $3,                -- nullable for eBay (no internal user)
       reserved_at            = now(),
       reservation_expires_at = CASE $1
         WHEN 'POS'        THEN NULL                         -- physically held, no auto-release
         WHEN 'STOREFRONT' THEN now() + INTERVAL '15 minutes' -- Mollie checkout TTL
         WHEN 'EBAY'       THEN now() + INTERVAL '10 minutes' -- BIN/Best-Offer decision window
       END
 WHERE id     = $4
   AND status = 'AVAILABLE'                       -- ← the atomic race protection
RETURNING id, reserved_at, reservation_expires_at;
```

Postgres guarantees that exactly one transaction wins the `WHERE status = 'AVAILABLE'` check. The losers get zero rows back and know to compensate.

**Why `UPDATE … WHERE` and not `SELECT FOR UPDATE` + `UPDATE`:** the single-statement form is shorter, faster (one round-trip, no lock-then-write window), and impossible to misuse. With `SELECT FOR UPDATE` a hurried code reviewer might forget that the row could change after the select; the single-statement form removes that footgun entirely.

The corresponding `ledger_events` row is inserted in the same transaction (ADR-0008's append-only chain extends):

```sql
INSERT INTO ledger_events (event_type, entity_table, entity_id, actor_user_id, device_id, ip_address, payload)
VALUES ('product.reserved', 'products', $4, $3, $5, $6,
        jsonb_build_object('channel', $1, 'session_id', $2, 'expires_at', $expires_at));
```

The trigger from ADR-0008 computes the hash chain; the reservation and its audit row commit together or roll back together. This is the discipline.

### 3. Per-channel reservation lifetimes — backed by reasoning, not convenience

| Channel       | TTL                | Why this exact value                                                                  |
|---------------|--------------------|---------------------------------------------------------------------------------------|
| **POS**       | `NULL` (no timeout)| The cashier physically holds the item. If they walk away and forget, an ADMIN sweep does the cleanup. The product is in their hand; releasing it on a timer would be insane. |
| **STOREFRONT**| 15 minutes         | Mollie's hosted checkout session expires at 15 minutes by default; we match exactly so we never release before Mollie does (would create a brief inconsistency window). |
| **EBAY**      | 10 minutes         | eBay's purchase-flow decision window is shorter than Mollie's; the buyer either confirms or abandons quickly. 10 minutes gives us slack against webhook lag without holding the item too long against other channels. |

A background job (`auto_release_expired_reservations`) runs every 60 seconds:

```sql
UPDATE products
   SET status                 = 'AVAILABLE',
       reserved_by_channel    = NULL,
       reserved_by_session_id = NULL,
       reserved_by_user_id    = NULL,
       reserved_at            = NULL,
       reservation_expires_at = NULL
 WHERE status = 'RESERVED'
   AND reservation_expires_at IS NOT NULL
   AND reservation_expires_at < now()
RETURNING id;
-- Each released product emits 'product.released_expired' ledger event.
```

The job is **idempotent and re-entry-safe**: re-running it on the same minute does nothing because the rows have already moved back to `AVAILABLE`.

### 4. Per-channel behavior matrix on win and loss

| Channel       | On win                                                                                       | On loss                                                                                                      |
|---------------|----------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|
| **POS**       | Cart accepts item; sale flow continues; on finalize → `SOLD`, ledger event, TSE call. | Cashier UI flashes: "Item just sold via eBay/Storefront — cart updated." Tied to SSE push (ADR-0014) so the update lands in <1s. No payment was attempted yet. |
| **STOREFRONT**| Mollie checkout opens with the 15-min hold. On `payment.succeeded` → `SOLD`. On timeout → `AVAILABLE`. | Frontend shows "This item was just sold — would you like to see similar items?" before any card data is collected. Zero PCI exposure on the failure path. |
| **EBAY**      | Acknowledge eBay order webhook with success; mark `SOLD`; fulfillment begins.               | Call `endItem` on eBay's API to delist immediately. Send Meta-approved refund + apology template to the buyer's eBay message thread. Open a manual reconciliation ticket in Control Desktop for ADMIN review. |

### 5. eBay synchronization — **one-way mirror, Postgres is the source**

The architectural invariant: **there is no such thing as an eBay listing without a corresponding `products` row in `AVAILABLE` state.** Listings are projections.

```
products.status='AVAILABLE' + listed_on_ebay flag    ─────▶  eBay listing exists
products.status='RESERVED' or 'SOLD'                 ─────▶  eBay listing ended
```

The synchronizer service (`apps/worker/src/jobs/ebay-mirror.ts`) reacts to every `ledger_events` row whose `event_type` matches `product.*`:

- `product.published` (a new `AVAILABLE` after intake) → POST listing to eBay
- `product.reserved` → POST `endItem` to eBay
- `product.sold` → POST `endItem` if still up (race protection)
- `product.released_expired` → POST listing back to eBay

Every eBay API call is idempotent and retried with exponential backoff up to 5 minutes. Persistent failure pages Basel.

**The reconciler job** runs every 5 minutes as a safety net against webhook loss and eBay's own eventual consistency.

#### Distributed lock — Redlock — against reconciler-overlap race conditions

eBay's API has been observed to slow to multi-minute response times during their incident windows. If a reconciler run takes >5 minutes, the next cron tick would start a second concurrent run, and the two would race each other on `endItem` / `createListing` calls. The result: duplicate listings, premature ends, lost items.

**The reconciler acquires a Redis Redlock before doing any work.** Single-Redis-instance Redlock is sufficient at our scale (single Oracle VM, Redis colocated). The pattern:

```ts
import { Redlock } from 'redlock';

const RECONCILER_LOCK_KEY = 'lock:inventory:ebay:reconciler';
const LOCK_MAX_LIFETIME_MS = 9 * 60 * 1000;        // 9 minutes — generous ceiling
const LOCK_EXTEND_INTERVAL_MS = 30 * 1000;         // heartbeat every 30s while running

async function reconcile() {
  let lock;
  try {
    // acquire returns immediately. Throws LockError if already held.
    lock = await redlock.acquire([RECONCILER_LOCK_KEY], LOCK_MAX_LIFETIME_MS, {
      retryCount: 0,                               // do NOT queue another run
    });
  } catch (e) {
    if (e instanceof LockError) {
      // Previous run still active. Skip this tick — that is the correct behavior.
      metrics.increment('reconciler_skipped_locked');
      logger.info('reconciler skipped: previous run still in progress');
      return;
    }
    throw e;
  }

  // Heartbeat: extend the lock periodically so a long-running but live job is not
  // killed by lock TTL. If we crash, no heartbeat → lock expires → next tick can run.
  const heartbeat = setInterval(async () => {
    try {
      lock = await lock.extend(LOCK_MAX_LIFETIME_MS);
    } catch (e) {
      logger.error('reconciler lock extend failed — aborting job', { error: e });
      clearInterval(heartbeat);
    }
  }, LOCK_EXTEND_INTERVAL_MS);

  const startedAt = Date.now();
  try {
    const ebayActive = await ebay.getActiveListings();
    const dbAvailable = await db.products.findAvailable();

    for (const listing of ebayActive) {
      const dbRow = dbAvailable.find(r => r.id === listing.sku);
      if (!dbRow || dbRow.status !== 'AVAILABLE') {
        await ebay.endItem(listing.id, 'OutOfStock');
        await ledger.emit({ event_type: 'ebay.reconciled.ended_stale', /* ... */ });
      }
    }
    for (const product of dbAvailable) {
      if (!ebayActive.find(l => l.sku === product.id)) {
        await ebay.createListing(productToListing(product));
        await ledger.emit({ event_type: 'ebay.reconciled.relisted', /* ... */ });
      }
    }

    metrics.histogram('reconciler_duration_ms', Date.now() - startedAt);
  } finally {
    clearInterval(heartbeat);
    await lock.release();
  }
}
```

**Invariants this guarantees:**

1. **At most one reconciler runs at any moment** across the entire stack — even if we scale to multiple `worker` containers (ADR-0012 §12 scalability seam).
2. **A hung job does not block forever** — if the process crashes without releasing, the lock expires within 9 minutes (no heartbeat).
3. **A healthy but slow job extends its hold** — the heartbeat refreshes the lock every 30 seconds, so a legitimate 8-minute run completes cleanly.
4. **Overlap is observable** — `reconciler_skipped_locked` metric increments on every skipped tick. Alert at >3 skips/hour: indicates eBay is degraded and we need to triage.
5. **No queuing of skipped runs** — the next 5-minute tick is sufficient. Running every-tick-that-was-skipped would amplify any incident.

This is the safety net. Without it, every webhook drop is a slow leak. **With it, every overlap is detected and the system fails closed.**

### 6. Soft viewing-holds — appointment-aware overlay on top of the state machine

The full appointment system is **ADR-0020** (deferred per Basel's directive — written when we reach wave 3 with Control Desktop UX). This ADR specifies only the **inventory-side contract**: how an appointment interacts with the lock without polluting the four-state machine.

#### The two-tier hold concept

- **Hard reservation** = `products.status = 'RESERVED'`. One winner, no overlap. Reserves the item against all other channels.
- **Soft viewing-hold** = a row in `product_viewing_holds`. **Advisory**, not authoritative. Multiple holds can coexist on the same product. Does NOT change `products.status`.

Schema (sketch — fully specified in ADR-0008's `0006_products.sql` and the eventual ADR-0020):

```sql
CREATE TABLE product_viewing_holds (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID         NOT NULL REFERENCES products(id),
  appointment_id     UUID         NOT NULL REFERENCES appointments(id),
  customer_id        UUID         REFERENCES customers(id),
  hold_strength      TEXT         NOT NULL DEFAULT 'SOFT' CHECK (hold_strength IN ('SOFT', 'HARD')),
  hold_starts_at     TIMESTAMPTZ  NOT NULL,
  hold_expires_at    TIMESTAMPTZ  NOT NULL,   -- typically appointment start + 30min grace
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  released_at        TIMESTAMPTZ,
  released_reason    TEXT
);

CREATE INDEX idx_viewing_holds_active
  ON product_viewing_holds (product_id, hold_expires_at)
  WHERE released_at IS NULL;
```

#### Interaction with the reservation lock

`reserve()` consults the holds table before applying its `UPDATE`:

```ts
async function reserve(productId: string, channel: Channel, ctx: ReservationContext) {
  // 1. Detect any active soft/hard holds.
  const activeHolds = await db.query.productViewingHolds.findMany({
    where: and(
      eq(productViewingHolds.productId, productId),
      isNull(productViewingHolds.releasedAt),
      gt(productViewingHolds.holdExpiresAt, sql`now()`),
    ),
  });

  // 2. Decide based on hold_strength, the channel, and the requesting actor.
  for (const hold of activeHolds) {
    if (hold.holdStrength === 'HARD') {
      // HARD blocks everyone except the holder's own checkout flow.
      if (channel === 'POS' && ctx.customerId === hold.customerId) {
        // The holder showed up at the counter — proceed and release the hold.
        await releaseHold(hold.id, 'fulfilled_by_purchase');
      } else {
        // Anyone else: refuse with a clear reason. ADMIN may override (next branch).
        throw new ReservationBlockedByHoldError(hold, { overridable: ctx.actorRole === 'ADMIN' });
      }
    } else {
      // SOFT: the cashier UI surfaces a warning. Storefront and eBay are blocked outright
      // (no human to weigh the trade-off in real time). POS may proceed with explicit confirm.
      if (channel === 'STOREFRONT' || channel === 'EBAY') {
        throw new ReservationBlockedByHoldError(hold, { overridable: false });
      }
      // POS: cashier sees a yellow banner with hold details; proceeding requires
      // a confirm + audit event 'product.soft_hold_overridden_by_walk_in'.
      if (!ctx.softHoldAcknowledged) {
        throw new SoftHoldAcknowledgmentRequiredError(hold);
      }
      // Walk-in beat the appointment-holder. Release the soft hold AND fire the
      // intelligent compensation flow (§6.bis below) — never a bare apology.
      await releaseHold(hold.id, 'overridden_by_walkin');
      await fireIntelligentCompensation(hold);
    }
  }

  // 3. Run the atomic reservation as in §2.
  return await applyReservationUpdate(productId, channel, ctx);
}
```

**Why SOFT by default:** the appointment booker has not paid anything. Letting them indefinitely block walk-ins is bad business. The cashier, who can see the customer at the counter, is the right person to weigh the trade-off in real time. SOFT-with-confirmation gives them the choice + the audit trail.

**When is HARD appropriate:** ADMIN can promote a soft hold to hard via Control Desktop ("This is a serious viewing for a €15,000 antique — block all other channels"). Hard holds always require a manual decision and always produce a `product.hold_promoted_to_hard` ledger event.

#### Hold lifecycle

```
Appointment booked → soft hold created (hold_strength=SOFT, expires=appt_start + 30min)
                  → ledger event 'appointment.viewing_hold_created'
                  → SSE push to in-shop POS and Control Desktop
                          │
                          ├── Customer arrives, buys → product.sold, hold.released_reason='fulfilled_by_purchase'
                          ├── Customer arrives, decides not to buy → hold.released_reason='viewing_concluded'
                          ├── No-show (30 min after appt_start) → auto-release, send 'we missed you' template
                          ├── Walk-in wins (POS override) → hold.released_reason='overridden_by_walkin' + customer notified
                          ├── ADMIN cancels appointment → hold.released_reason='appointment_cancelled'
                          └── Appointment promoted to HARD → reservation upgraded, eBay listing ends immediately
```

### 6.bis. Intelligent compensation — semantic search when a walk-in beats an appointment

A bare "we're sorry, your item was sold" template is a marketing failure. The customer booked a viewing, took the time to plan, and now receives an apology with no path forward. They will not rebook.

The correct response: **a single message that turns the loss into a curated alternative.** Built on the similarity vectors the former Annahmestrecke (ADR-0015, ausgezogen) generated for every product, we ship the customer two hand-picked alternatives in the same notification that delivers the bad news.

#### Schema requirement

The `products` table carried an `embedding` column populated by the former Annahmestrecke (ausgezogen 19.08.2026 mit Wanderung 0149):

```sql
-- migration 0006_products.sql (ADR-0008 §9)
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE products
  ADD COLUMN embedding vector(1536);

CREATE INDEX idx_products_embedding_hnsw
  ON products USING hnsw (embedding vector_cosine_ops)
  WHERE status = 'AVAILABLE';
```

HNSW index restricted to `AVAILABLE` keeps similarity search fast and always-relevant — sold items are not candidates.

#### The compensation flow

```ts
async function fireIntelligentCompensation(hold: ProductViewingHold) {
  // 1. Read the lost product (still in the row, status=SOLD now)
  const soldProduct = await db.query.products.findById(hold.productId);

  // 2. pgvector cosine-similarity over AVAILABLE inventory, same tax_treatment family
  //    (showing a margin-tax piece to someone who came for investment gold would be tone-deaf)
  const candidates = await db.execute(sql`
    SELECT id, name, price_eur, primary_photo_r2_key, description_de,
           1 - (embedding <=> ${soldProduct.embedding}) AS cosine_similarity
      FROM products
     WHERE status              = 'AVAILABLE'
       AND tax_treatment_code  = ${soldProduct.tax_treatment_code}
       AND id                 != ${soldProduct.id}
       AND embedding IS NOT NULL
     ORDER BY embedding <=> ${soldProduct.embedding}      -- ascending distance = descending similarity
     LIMIT 2
  `);

  // 3. Generate a signed recommendation page on warehouse14.de
  //    (signed URL with 7-day expiry — customer can revisit, but link cannot be shared widely)
  const pageUrl = await buildSignedRecommendationPage({
    holdId: hold.id,
    customerId: hold.customerId,
    soldProduct,
    suggestions: candidates,
    appointmentId: hold.appointmentId,
    expiresAt: addDays(new Date(), 7),
  });

  // 4. Compose payload for the pre-approved WhatsApp template
  //    Template name: appointment_item_replaced_v1 (registered with Meta, German body)
  const customer = await db.query.customers.findById(hold.customerId);
  const appointment = await db.query.appointments.findById(hold.appointmentId);

  await whatsapp.sendTemplate({
    to: customer.phone,
    template_name: 'appointment_item_replaced_v1',
    language: 'de',
    components: {
      // Pre-approved placeholders inside the template (no free-form text required)
      header_image: candidates[0].primary_photo_r2_key,        // first alternative as visual hook
      customer_first_name: customer.firstName,
      sold_item_name: soldProduct.name,
      appointment_date: format(appointment.startsAt, 'EEEE, d. MMMM', { locale: de }),
      alternative_1_name: candidates[0].name,
      alternative_1_price: formatMoney(candidates[0].price_eur),
      alternative_2_name: candidates[1].name,
      alternative_2_price: formatMoney(candidates[1].price_eur),
      cta_url: pageUrl,                                        // "Details ansehen"
    },
  });

  // 5. Append to the ledger so the entire intelligent compensation is auditable
  await ledger.emit({
    event_type: 'appointment.walk_in_override.compensation_sent',
    entity_table: 'product_viewing_holds',
    entity_id: hold.id,
    payload: {
      sold_product_id: soldProduct.id,
      alternative_ids: candidates.map(c => c.id),
      cosine_similarities: candidates.map(c => c.cosine_similarity),
      recommendation_page_url: pageUrl,
      template_message_id: /* Meta-returned ID */,
    },
  });

  // 6. Hold the two alternative slots warm: a soft hold pointing to the SAME appointment,
  //    expiring at appointment_start + 30min — so when the customer arrives, the items
  //    are still there. This is the salesmanship Basel called for.
  await db.transaction(async tx => {
    for (const candidate of candidates) {
      await tx.insert(productViewingHolds).values({
        productId: candidate.id,
        appointmentId: hold.appointmentId,
        customerId: hold.customerId,
        holdStrength: 'SOFT',
        holdStartsAt: new Date(),
        holdExpiresAt: addMinutes(appointment.startsAt, 30),
      });
    }
    await ledger.emit({
      event_type: 'appointment.alternative_holds_created',
      entity_table: 'appointments',
      entity_id: hold.appointmentId,
      payload: { alternative_product_ids: candidates.map(c => c.id) },
    });
  });
}
```

#### Why each step matters

1. **Same `tax_treatment_code` filter** — recommending an investment-gold bar to someone who came for an Art Deco antique brooch is worse than no recommendation. Tax treatment is a coarse proxy for "buyer intent category."
2. **HNSW + cosine similarity over `description_de` embeddings + structured attributes** — the intake pipeline (ADR-0015) generates embeddings from `name + description + marketing_attributes`, so similarity reflects what the customer would actually care about, not just SKU code proximity.
3. **Signed recommendation page** — single canonical URL with photos, prices, and "confirm I want to view these instead" button. Customer interaction with this page updates the appointment's `linked_products` automatically.
4. **Pre-approved WhatsApp template** — soft-hold notifications go out outside the 24-hour conversation window (the appointment was likely booked days ago). Free-form text is not allowed; we register `appointment_item_replaced_v1` with Meta during Phase 1 onboarding.
5. **Pre-emptive soft holds on the alternatives** — the customer arrives at their appointment time to find two curated alternatives actually waiting. The walk-in loss becomes a curation win.
6. **Full ledger trail** — the entire compensation flow lives in `ledger_events`. ADMIN can audit "did we send the right message to the right customer?" years later.

#### Failure modes

- **No similar items above a minimum similarity threshold (cosine < 0.6):** fall back to a simpler template that omits the alternatives and offers a 10% next-visit discount instead. Better honest than tone-deaf.
- **Customer has no phone on file:** fall back to email (if known) using the same flow. No phone + no email → Control Desktop ticket for ADMIN to handle personally.
- **pgvector index missing or stale:** log + alert; flow degrades to the simpler template; ADMIN re-runs `embedding-backfill` job.

This is the discipline Basel called for: **every loss is a sales opportunity for the next conversation.** The system enforces it.

### 7. Race window narrowing — the parts we cannot close, we surface

There is **one window we cannot close**: between the moment an eBay buyer clicks Buy It Now and the moment eBay's webhook reaches our API (2–30 seconds typical). During this window, a cashier at the counter can legitimately sell the same item.

Mitigations, in order of effect:

1. **Subscribe to eBay's `marketplace_decision` event** when the buyer enters checkout (before they confirm). Reserve the product as `RESERVED by EBAY` immediately on this event. The decision event fires earlier than the purchase webhook, shrinking the window to ~1-3 seconds.
2. **Real-time "eBay activity" badge in POS UI.** When a product has any eBay buyer activity in the last 60 seconds (page view, watch, BIN cart-add — whichever events eBay surfaces on our account tier), the POS shows: `⚠️ eBay activity 23s ago — confirm sale?`. Cashier decides knowingly.
3. **Yellow flag in Control Desktop.** Owner sees in real time which items have concurrent activity across channels.

The unclosable window matters less than the **discovery and compensation** workflow when a double-sell does happen.

### 8. The compensation workflow — when double-sell happens

Two writers reach `RESERVED` apparently-simultaneously through Postgres? **No** — Postgres serializes the single-statement update, exactly one wins. The double-sell case is different: one channel **successfully reserved-then-finalized** while another channel had already started a buyer-facing flow and now arrives with a webhook expecting to reserve.

Example: eBay BIN clicked at T+0, our `marketplace_decision` did not arrive (event drop). Cashier reserves and sells the item at T+5. Purchase webhook arrives at T+12.

Compensation flow (`packages/inventory-lock/src/compensate.ts`):

```ts
export async function compensateDoubleSale(opts: {
  productId: string;
  winningChannel: Channel;
  winningTxId: string;
  losingChannel: Channel;
  losingExternalRef: string;        // eBay order ID, Mollie payment intent, etc.
}) {
  // 1. Append a compensation ledger event.
  await ledger.emit({
    event_type: 'product.double_sale_compensated',
    entity_table: 'products',
    entity_id: opts.productId,
    payload: { ...opts },
  });

  // 2. Channel-specific reversal.
  switch (opts.losingChannel) {
    case 'EBAY':
      await ebay.refundOrder(opts.losingExternalRef, 'OutOfStock');
      await ebay.sendBuyerApology(opts.losingExternalRef, 'apology_double_sale_de_v1');
      await eBayFeedbackAcknowledge(opts.losingExternalRef);  // pro-active feedback recovery
      break;
    case 'STOREFRONT':
      await mollie.refundPayment(opts.losingExternalRef);
      await email.send(opts.losingExternalRef, 'storefront_apology_de_v1', {
        discountCodeForNextOrder: await generateDiscountCode(opts.productId),
      });
      break;
    // POS never loses this race because the cashier physically holds the item.
  }

  // 3. Open Control Desktop ticket for ADMIN visibility.
  await tickets.create({
    type: 'double_sale_compensation',
    severity: 'high',
    body: `Product ${opts.productId} was sold via ${opts.winningChannel} (tx ${opts.winningTxId}); ` +
          `${opts.losingChannel} buyer (${opts.losingExternalRef}) refunded + apologized.`,
  });
}
```

A successful compensation is a **good** outcome — the harm is contained, the customer is acknowledged, the audit trail is unbroken. The shop's reputation survives because the apology is fast and gracious.

### 9. eBay Best Offer handling — pause-the-world semantics

A Best Offer arriving on a unique item is structurally different from BIN: the buyer is proposing a price, the seller can accept/counter/reject, and the deliberation window is 48 hours by default.

Decision: **upon receiving a Best Offer webhook, immediately reserve the product as `RESERVED by EBAY` with a 48-hour TTL.** Surface to Control Desktop. ADMIN decides:

- **Accept** → mark `SOLD`, eBay processes payment, fulfillment kicks off.
- **Counter** → keep `RESERVED`, communicate counter via eBay messaging, await buyer response.
- **Reject** → release to `AVAILABLE`, eBay closes the offer.

48 hours is a long block for a unique item. The mitigation: ADMIN can promote pending offers visible in Control Desktop — sort by "value × probability of accept" descending — and resolve them in batches.

### 10. The `@norns/inventory-lock` package — the single import point

```
packages/inventory-lock/
├── src/
│   ├── reserve.ts                  # atomic reserve, returns Reservation or ReservationError
│   ├── release.ts                  # explicit release back to AVAILABLE (with audit)
│   ├── finalize.ts                 # RESERVED → SOLD with payment confirmation reference
│   ├── compensate.ts               # double-sale recovery workflow
│   ├── auto-release-expired.ts     # background job (60s cron)
│   ├── ebay-mirror/
│   │   ├── listing-sync.ts         # event-driven mirror
│   │   ├── reconciler.ts           # 5-min reconciler
│   │   └── best-offer-handler.ts
│   ├── soft-holds/
│   │   ├── check-conflicts.ts      # used by reserve()
│   │   ├── release.ts              # explicit + on-purchase + on-expiry
│   │   └── promote-to-hard.ts      # ADMIN action
│   ├── types.ts                    # Reservation, ReservationError, HoldStrength, Channel
│   └── errors.ts                   # explicit error types, never thrown as bare strings
└── tests/
    ├── race-conditions/
    │   ├── concurrent-reserve.test.ts        # 100 parallel reserves → exactly 1 succeeds
    │   ├── reserve-vs-soft-hold.test.ts
    │   ├── reserve-vs-hard-hold.test.ts
    │   ├── expiry-race.test.ts               # finalize at T-0.5s of expiry
    │   └── ebay-webhook-vs-pos.test.ts       # the unclosable window scenarios
    ├── ebay-mirror/
    │   ├── reconciler-resyncs-drift.test.ts
    │   └── best-offer-flow.test.ts
    └── compensation/
        └── double-sale-paths.test.ts
```

**Discipline:** no other package, no API route, no Drizzle query touches `products.status` directly. Every state transition goes through this package. CI lints for `products.status` writes outside `packages/inventory-lock/` and rejects the PR.

## Consequences

**Positive:**
- Postgres becomes the unambiguous arbiter; "who really owns this item right now?" is a single SQL query, not a distributed-systems debate.
- The race window for double-sells is narrowed to a 1–3 second eBay-specific edge that is mitigated by an in-product UI signal and a documented compensation workflow.
- Soft viewing-holds give appointments real operational meaning without polluting the GoBD-relevant state machine.
- Every state change is in the ledger and reconstructible years later.
- The package boundary is enforced by CI; no team member can accidentally write a "quick UPDATE products" outside the discipline.
- eBay reconciler is the safety net against any single failure mode in the mirror pipeline.

**Negative:**
- The reconciler is a moving part with its own bugs and rate-limit considerations. Anticipated: rate limits hit only if drift accumulates abnormally; alert at 50% utilization.
- Soft-hold UX adds a step to the cashier flow when a walk-in collides with an appointment. This is the right trade — the alternative is silent overrides or surprise blocks. The cashier sees the situation clearly.
- Best Offer's 48-hour hold can make unique items "invisible" for two days. ADMIN must triage offers actively; we add a "stale offer aging" metric to Control Desktop.
- Compensating a double-sale costs us a refund + apology + potentially a discount code. We accept this cost; we estimate <5 events per year at single-shop scale.

**Mitigations:**
- The race-conditions test suite runs against a real Postgres in CI (`testcontainers`) and asserts the invariant after every PR.
- Every operator-facing screen (POS, Control Desktop) subscribes to SSE inventory events and reflects state changes within 1 second.
- The apology templates for double-sales are pre-approved by Meta (WhatsApp) and Mollie / eBay's policies; deployment of a compensation does not require manual copywriting.

## Alternatives considered

- **Distributed lock via Redis Redlock.** Rejected. Adds another moving part for a problem Postgres solves with a single SQL statement. Redlock is also famously fraught at the edges of clock skew; we have no need to pay that complexity.
- **Optimistic concurrency control with `version` column.** Rejected for the hot path. Equivalent atomicity, but the `UPDATE … WHERE status='AVAILABLE'` pattern reads more like a security policy than a concurrency tactic — and that's exactly what it is.
- **Per-channel inventory mirrors** (eBay maintains its own counter, etc.). Rejected. Anti-pattern; introduces drift; auditor cannot tell which mirror is canonical.
- **Hard reservation on appointment booking by default.** Rejected. Too aggressive for soft cases (consultation, low-value viewings); blocks walk-ins unnecessarily; bad business for a single-shop with limited inventory. Hard reservation is opt-in by ADMIN.
- **Two-phase commit between Postgres and eBay via custom protocol.** Rejected; eBay's API does not support it; building a synthetic 2PC against a non-compliant remote system is a fool's errand.
- **Reservation TTL extension on activity.** Rejected. We considered "extend the storefront TTL if buyer is still actively typing in the checkout form" — adds complexity, opens edge cases, savings minimal. Mollie's 15 minutes is enough.

## Known limits & deferred decisions

1. **eBay listing latency is bounded by eBay, not us.** Our delete-on-reserve fires in milliseconds; eBay's listing-removal latency can be up to 30 seconds. The reconciler covers this; live UI signals reduce the surprise.
2. **Multi-channel concurrent Best Offer (rare).** Two Best Offers arriving within the same minute on the same item — we reserve on the first, second buyer sees "offer no longer available." Documented as expected behavior.
3. **No multi-warehouse routing in V1.** Single shop, no shipping center, no transfers. Schema slot `shop_id` left for the multi-shop future (ADR-0008 Known limits #5).
4. **No commit-or-rollback across PG + Stripe/Mollie on storefront finalize.** Storefront flow: reserve → Mollie checkout → on `payment.succeeded` webhook → finalize. If the webhook is lost, reservation expires at 15 min, the customer is refunded by Mollie (their dispute flow), we apologize. Anti-pattern is to "finalize on optimistic UI button click" — never do this.
5. **eBay sub-account isolation.** Single eBay seller account in V1. Multi-shop future requires per-shop eBay accounts and per-account mirror state — defer.
6. **No back-orders for unique items by design.** Each product is one-of-one. The state machine has no "ordered, awaiting restock" path. This is a feature, not a limit.
7. **Full appointment system (ADR-0020).** Soft-hold producer side is sketched here; the booking flow, notification cadence, no-show grace policy, recurring viewings, and capacity model for multiple-staff shops live in ADR-0020 when it lands.

## References

- ADR-0008 — Schema (the `ledger_events` chain anchors every state change emitted by this lock)
- ADR-0014 — Live Ops transport (SSE pushes every inventory state change to all subscribed clients)
- ADR-0020 (pending) — Smart Appointment System (the producer of soft viewing-holds)
- Stripe Engineering, "Designing payments idempotency keys" — the discipline of separating reservation from finalization
- eBay Inventory & Trading API docs — listing lifecycle, `marketplace_decision`, end-item semantics
- Mollie Checkout API docs — 15-minute session TTL
- Oliver Roos cherry-pick: `backend/src/lib/inventoryCheckoutDeduction.ts` (the deduction pattern), `backend/src/lib/checkoutPipeline.ts` (the orchestration shape)
- dem internen Arbeitsheft (nicht veröffentlicht)
