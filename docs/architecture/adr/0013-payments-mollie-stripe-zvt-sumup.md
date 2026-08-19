# ADR-0013 — `@norns/payments`: Mollie + Stripe for storefront, ZVT + SumUp for POS, PCI-out-of-scope by construction

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Related:** ADR-0008 (every payment row + state change emits a ledger event), ADR-0010 (no AI here, but the abstraction discipline is the model), ADR-0016 (reservation lock interlocks with payment lifecycle), ADR-0018 (cash drawer + ZVT terminal edge cases), `docs/memory.md` §2 #31 #32.

## Context

Warehouse14 receives money on three channels — POS in-shop (card + cash), storefront (online card + SEPA + Klarna), and eBay (eBay's own Managed Payments). Every channel has:

- A different regulatory framing (KassenSichV cash flow vs PSD2 online vs eBay's marketplace policy).
- A different technical interface (ZVT serial protocol vs Mollie REST API vs eBay webhook).
- A different reconciliation cadence (real-time receipt vs nightly bank settlement vs eBay's bi-weekly payout).
- A different failure model (cash misscount vs declined card vs eBay buyer dispute).

If we build all of this directly in the API code, we will end up with a tangled bouquet of webhook handlers, brittle retry policies, and a fiscal-record audit story that no Steuerprüfer would respect.

Two architectural principles drive this ADR:

1. **PCI out of scope by construction.** Warehouse14 **never touches a raw PAN, CVV, or magnetic-stripe track.** All card data is collected by Mollie / Stripe / SumUp / the ZVT terminal directly. Our system stores only tokenized references, last-four digits, and outcome status. This shrinks the audit surface from "PCI DSS Level 4 merchant" to "card-data-aware-system" — orders of magnitude less compliance work.
2. **One abstraction package, one set of state machines.** `@norns/payments` is the single import for any payment operation. The provider SDKs (Mollie, Stripe, ZVT, SumUp) live inside it, never leak out. Every payment is a typed state machine, with the transitions audit-logged.

Constraints:

1. **No custom payment code** (Basel's directive 2026-05-23). Reinventing payment processing is malpractice in 2026.
2. **PCI: we are out of scope.** No PAN, no CVV, no magnetic stripe. Tokens and tokens only.
3. **Idempotency at every layer.** Webhook redeliveries are routine; double-charging a customer is unacceptable.
4. **Webhook signature verification mandatory.** A fake Mollie webhook claiming "payment succeeded" must not lead to a fulfilled order.
5. **Reconciliation against bank statements** at month-end is a documented runbook, not an ad-hoc spreadsheet.
6. **Refund and chargeback flows produce fiscal Storno rows** (per ADR-0008 + ADR-0007).
7. **DSFinV-K compatibility** — every payment's `Zahlart` (cash / EC-Karte / Kreditkarte / Gutschein / Online-Transfer / Sonstiges) is recorded explicitly per the BMF DSFinV-K v2.0 schema.

## Decision

### 1. Package shape — `packages/payments`

```
packages/payments/
├── src/
│   ├── index.ts                          # the only public export — `payments` namespace
│   ├── providers/
│   │   ├── mollie.ts                     # Mollie REST + webhook signature verification
│   │   ├── stripe.ts                     # Stripe Payment Intent + webhook
│   │   ├── zvt.ts                        # ZVT terminal (cherry-picked from Oliver `backend/src/modules/hardware/zvt.ts`)
│   │   ├── sumup.ts                      # SumUp Solo (HTTP API path; the Bluetooth Solo Plus is treated as ZVT-class)
│   │   └── types.ts                      # ProviderClient interface
│   ├── core/
│   │   ├── stateMachine.ts               # the canonical state machine (§4)
│   │   ├── webhooks.ts                   # signature verify + idempotent dispatch
│   │   ├── reconciler.ts                 # monthly bank-statement reconciliation
│   │   ├── retry.ts                      # provider-aware retry policies
│   │   └── ledger.ts                     # writes `payments` rows + ledger events
│   ├── flows/
│   │   ├── posSaleCard.ts                # ZVT or SumUp-card POS sale
│   │   ├── posSaleCash.ts                # cash recording (no provider call)
│   │   ├── posSaleSplit.ts               # split payment (cash + card on one tx)
│   │   ├── storefrontCheckout.ts         # Mollie / Stripe checkout for online
│   │   ├── refund.ts                     # initiates refund + Storno
│   │   └── chargeback.ts                 # incoming chargeback handling
│   ├── dsfinvk/
│   │   └── zahlartMapping.ts             # maps our payment_method enum to DSFinV-K codes
│   └── errors.ts                         # typed errors — no bare strings
└── tests/
    ├── flows/
    ├── providers/                        # against provider sandbox APIs
    ├── webhooks/                         # signature spoof attempts, replay attacks
    └── reconciler/
```

CI lints for direct imports of `@mollie/api-client`, `stripe`, etc. outside `packages/payments`. Same discipline as the former channel gateway (ADR-0010, inzwischen ausgezogen).

### 2. Channel × provider matrix

| Channel | Primary provider | Fallback / alt | What's stored on our side |
|---|---|---|---|
| **Storefront card** | Mollie (NL, EU-native, SEPA + Klarna + iDEAL + German cards) | Stripe (international cards Mollie doesn't cover well) | Mollie's `payment_id`, `status`, last-four if present, `bank` if SEPA, settlement amount |
| **Storefront SEPA** | Mollie | — | Mollie's `payment_id`, mandate reference, status |
| **Storefront Klarna** | Mollie | — | Mollie's `payment_id`, Klarna reservation ID |
| **POS card (chip / contactless / mag-stripe)** | ZVT German Kassenterminal (Ingenico/Verifone, selected during Phase 1 procurement) | SumUp Solo (Bluetooth, low-end alternative for pop-ups / spare) | ZVT's `Transaktionsnummer`, `Beleg-Nr`, last-four, terminal ID |
| **POS cash** | — (no provider) | — | Amount tendered, change given, drawer state |
| **POS gift card / voucher** | internal ledger (`gift_cards` table; not external) | — | Card code (one-way hash), balance ledger |
| **eBay (Managed Payments)** | eBay platform | — | eBay `order_id`, `payout_id` (when settled to our bank) |

**Why Mollie primary:** EU-native, German-card optimization, native iDEAL/Klarna/SEPA, lower fees than Stripe for SEPA-heavy traffic, Frankfurt-region data processing. Stripe is the fallback for the rare international Visa/Amex case where Mollie's coverage is weaker. eBay's own payments are not our choice — eBay enforces.

**Why ZVT primary for POS:** the German Kassenterminal market is ZVT-protocol-standard. Any certified terminal speaks it. The terminal itself is PCI-certified; we only see Belegnummer + outcome. SumUp Solo is the alternative for low-volume / mobile setups; it offers a simpler HTTP API but at higher per-transaction fees, so we route to it only when the ZVT terminal is unavailable.

### 3. Schema — three tables + one append-only event log

```sql
CREATE TYPE payment_status AS ENUM (
  'INITIATED',     -- request created, awaiting customer action
  'PROCESSING',    -- provider is processing (e.g. 3DS challenge)
  'AUTHORIZED',    -- card auth obtained, not yet captured
  'CAPTURED',      -- funds confirmed by provider (customer's bank says "yes")
  'SETTLED',       -- funds arrived in our bank account (provider payout)
  'REFUNDED',      -- partial or full refund completed
  'FAILED',        -- provider rejected (declined card, insufficient funds, etc.)
  'EXPIRED',       -- TTL expired without resolution
  'CANCELLED',     -- explicitly cancelled before processing
  'CHARGEBACK',    -- post-settlement dispute initiated by customer's bank
  'CHARGEBACK_LOST', -- chargeback resolved against us
  'CHARGEBACK_WON'   -- chargeback resolved in our favor
);

CREATE TYPE payment_method AS ENUM (
  'cash',
  'card_present_zvt',
  'card_present_sumup',
  'card_online_mollie',
  'card_online_stripe',
  'sepa_mollie',
  'klarna_mollie',
  'gift_card_internal',
  'voucher_internal',
  'ebay_managed'
);

-- One row per transaction's intended payment plan.
-- A transaction may have multiple payment rows (split: €300 cash + €700 card).
CREATE TABLE payments (
  id                          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id              UUID                NOT NULL REFERENCES transactions(id),
  status                      payment_status      NOT NULL DEFAULT 'INITIATED',
  method                      payment_method      NOT NULL,
  amount_eur                  NUMERIC(18,2)       NOT NULL,
  currency                    CHAR(3)             NOT NULL DEFAULT 'EUR',
  -- Provider-side identifiers (tokens, NEVER raw card data)
  provider                    TEXT                NOT NULL,
  provider_payment_id         TEXT,                                   -- Mollie/Stripe/ZVT receipt ref
  provider_settlement_id      TEXT,                                   -- payout reference when SETTLED
  card_last_four              TEXT,                                   -- safe to store; CHECK constraint allows only 4 digits or NULL
  card_brand                  TEXT,                                   -- 'visa' | 'mastercard' | 'amex' | 'maestro' | 'girocard' | etc.
  -- Idempotency
  client_idempotency_key      TEXT                NOT NULL UNIQUE,    -- our request key; replays are no-ops
  -- DSFinV-K
  dsfinvk_zahlart_code        TEXT                NOT NULL,           -- maps from `method` via flows/dsfinvk/zahlartMapping.ts
  -- Lifecycle timestamps
  initiated_at                TIMESTAMPTZ         NOT NULL DEFAULT now(),
  authorized_at               TIMESTAMPTZ,
  captured_at                 TIMESTAMPTZ,
  settled_at                  TIMESTAMPTZ,
  refunded_at                 TIMESTAMPTZ,
  failed_at                   TIMESTAMPTZ,
  failure_code                TEXT,
  failure_message             TEXT,
  -- Audit envelope (updatable)
  notes_internal              TEXT,
  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CHECK (amount_eur > 0),
  CHECK (card_last_four IS NULL OR card_last_four ~ '^[0-9]{4}$')
);

CREATE INDEX idx_payments_tx                 ON payments (transaction_id);
CREATE INDEX idx_payments_provider_id        ON payments (provider, provider_payment_id);
CREATE INDEX idx_payments_status_method      ON payments (status, method);
CREATE INDEX idx_payments_settled_business_day ON payments (berlin_business_day(settled_at)) WHERE settled_at IS NOT NULL;

-- Append-only log of incoming webhooks (for replay protection + audit).
CREATE TABLE webhook_events_log (
  id                  BIGSERIAL    PRIMARY KEY,
  provider            TEXT         NOT NULL,
  event_type          TEXT         NOT NULL,
  external_event_id   TEXT         NOT NULL,                          -- provider's unique ID
  signature_verified  BOOLEAN      NOT NULL,
  payment_id          UUID         REFERENCES payments(id),
  raw_payload         JSONB        NOT NULL,                          -- store as received (for forensics)
  processed_at        TIMESTAMPTZ,
  processing_outcome  TEXT,                                            -- 'applied' | 'duplicate' | 'invalid_signature' | 'unknown_payment' | 'state_mismatch'
  received_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (provider, external_event_id)                                 -- duplicate webhooks no-op
);

-- Chargebacks: separate table because their lifecycle is independent
CREATE TABLE chargeback_events (
  id                          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id                  UUID                NOT NULL REFERENCES payments(id),
  external_chargeback_id      TEXT                NOT NULL,
  reason_code                 TEXT,                                    -- provider-specific (4837, 4855, etc.)
  amount_eur                  NUMERIC(18,2)       NOT NULL,
  status                      TEXT                NOT NULL,            -- 'opened' | 'evidence_required' | 'evidence_submitted' | 'won' | 'lost'
  opened_at                   TIMESTAMPTZ         NOT NULL,
  evidence_due_at             TIMESTAMPTZ,
  resolved_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  UNIQUE (payment_id, external_chargeback_id)
);
```

`payments` is `INSERT, SELECT, UPDATE (envelope only)` for the `warehouse14_app` role — never `DELETE`. Status transitions are state-machine-enforced at the application layer with a CHECK-trigger pair (similar to `transactions` storno enforcement in ADR-0008).

### 4. The state machine — explicit, exhaustive, ledger-emitting

```
                          ┌─────────────┐
                          │  INITIATED  │   ◄── creation
                          └──────┬──────┘
                                 │
                  ┌──────────────┼──────────────────────┐
        cancel    │              ▼                      │  ttl
                  │       ┌─────────────┐               │
                  │       │ PROCESSING  │ ──────────────┤
                  │       └──────┬──────┘               │
                  │              │                      │
                  ▼              ▼                      ▼
           ┌──────────┐    ┌─────────────┐       ┌──────────┐
           │CANCELLED │    │ AUTHORIZED  │       │ EXPIRED  │
           └──────────┘    └──────┬──────┘       └──────────┘
                                  │
                                  │ capture (auto or manual)
                                  ▼
                           ┌─────────────┐
                           │  CAPTURED   │ ──────► (refund) ────►  REFUNDED
                           └──────┬──────┘
                                  │ provider settlement (batch)
                                  ▼
                           ┌─────────────┐
                           │  SETTLED    │ ──────► (chargeback) ──► CHARGEBACK ──► WON / LOST
                           └─────────────┘
                                  │
                                  │ (terminal from a fiscal-ledger perspective)
                                  ▼
                          (no further state machine moves)


  FAILED can be reached from PROCESSING or AUTHORIZED.
  All transitions emit a `ledger_events` row (event_type='payment.<new_state>').
```

The state machine is implemented in `core/stateMachine.ts` with TypeScript discriminated unions; invalid transitions throw at compile time (within `packages/payments`) and are rejected at the DB trigger if reached at runtime.

### 5. Mollie integration — storefront card / SEPA / Klarna

#### Outbound: creating a payment

```ts
// packages/payments/src/flows/storefrontCheckout.ts (sketch)
import { Mollie } from '../providers/mollie';

export async function initiateStorefrontCheckout(opts: {
  transactionId: string;
  amount: Money;
  description: string;
  customerEmail: string;
  redirectUrl: string;
}) {
  const idemKey = `storefront-checkout-${opts.transactionId}-${uuid()}`;

  const molliePayment = await Mollie.payments.create({
    amount: { value: opts.amount.toMollieString(), currency: 'EUR' },
    description: opts.description,
    redirectUrl: opts.redirectUrl,
    webhookUrl: `${API_BASE}/webhooks/mollie`,
    metadata: { transaction_id: opts.transactionId, idem_key: idemKey },
    // No method specified → Mollie's hosted page lets the customer pick.
  }, { idempotencyKey: idemKey });

  await db.insert(payments).values({
    transactionId: opts.transactionId,
    status: 'INITIATED',
    method: 'card_online_mollie',                  // generic until customer picks at Mollie
    amount_eur: opts.amount.toString(),
    provider: 'mollie',
    providerPaymentId: molliePayment.id,
    clientIdempotencyKey: idemKey,
    dsfinvkZahlartCode: 'TBD',                     // resolved on webhook when method known
  });

  // Emit ledger event
  await ledger.emit({
    event_type: 'payment.initiated',
    entity_table: 'payments',
    entity_id: /* the new payment.id */,
    payload: { provider: 'mollie', amount_eur: opts.amount.toString() },
  });

  return { checkoutUrl: molliePayment.getCheckoutUrl() };
}
```

#### Inbound: webhook handling

Every Mollie webhook lands on `POST /webhooks/mollie`. The handler:

1. **Verifies the source.** Mollie does not sign webhooks; instead we verify by calling Mollie back with the payment ID (their documented best practice — "always re-fetch from Mollie, never trust the webhook body").
2. **Idempotency check.** Insert into `webhook_events_log` with `UNIQUE (provider, external_event_id)`. Duplicate → no-op.
3. **State-machine transition.** Look up our `payments` row; apply the new status only if the transition is valid.
4. **Ledger event.** Emit `payment.<new_state>`.
5. **Side effects.** If `CAPTURED` → finalize the transaction in `transactions` (via ADR-0016's `finalize()` from inventory-lock); if `FAILED` → release any reservations.

Stripe webhooks (signed via `stripe-signature` header) go through the same logging-and-dispatch path with provider-specific verification.

### 6. ZVT integration — POS card terminal over Ethernet / TCP-IP

The ZVT protocol (Zahlungsverkehrs-Terminal-Schnittstelle) is the German Kassenterminal standard. We connect to the terminal **exclusively over Ethernet / TCP-IP** — no serial, no USB pass-through. Basel's directive (2026-05-23) explicitly excludes USB pass-through to avoid Docker's USB device-passing complexity (which is awkward on Linux containers and breaks the "Dockerized everything" discipline from ADR-0012).

**Target terminal models (Phase 1 procurement):**

- **Verifone V200c** or **V400c** — modern, Ethernet-capable, German-market-certified
- **Ingenico Desk/5000 series** — equivalent specification, broader installed base in Germany

Both families support TCP-IP ZVT natively (no adapter dongles, no "ZVT over serial over USB-to-Ethernet converter" Frankenstein paths). Both are PCI-PTS-certified, so PCI scope stays as designed (§Context).

#### Connection model — long-lived TCP socket, heartbeat, reconnect with backoff

```ts
// packages/payments/src/providers/zvt.ts (sketch)
class ZvtTerminalClient {
  private socket: net.Socket | null = null;
  private readonly host: string;        // terminal's static IP on the shop LAN, e.g. '10.10.40.21'
  private readonly port: number;        // typically 22000 for Verifone/Ingenico ZVT default
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectDelayMs = 1000;      // exponential up to 30s
  private inflightCommand: { resolve, reject, timeoutAt } | null = null;

  async connect(): Promise<void> {
    this.socket = net.createConnection({ host: this.host, port: this.port });
    this.socket.on('data',  buf => this.onFrame(buf));
    this.socket.on('error', err => this.onError(err));
    this.socket.on('close', () => this.scheduleReconnect());
    await this.handshake();             // ZVT 06 00 Registration command with our APE-ID + config flags
    this.startHeartbeat();
  }

  private startHeartbeat() {
    // ZVT 06 1B Status-Enquiry every 5 seconds. Loss of response → mark terminal degraded
    // (surfaces in Control Desktop + POS Hardware status chip per ADR-0018 §2).
    this.heartbeatTimer = setInterval(() => this.sendStatusEnquiry(), 5_000);
  }

  private scheduleReconnect() {
    setTimeout(() => this.connect().catch(() => { /* exp backoff retries forever */ }),
               Math.min(this.reconnectDelayMs * 2, 30_000));
  }

  async authorize(opts: { amountCents, currency }): Promise<ZvtAuthResult> {
    return await this.sendCommand({
      cmd: 0x06_01,                     // Authorisation
      tlv: { amount: opts.amountCents, currency: 0x0978 /* EUR */ },
      timeoutMs: 60_000,                // chip+PIN can be slow with elderly customers
    });
  }

  // ... reverse, refund, end-of-day, etc.
}
```

#### POS sale flow

```
Cashier confirms cart total →
  packages/payments/flows/posSaleCard.ts
    → inserts a `payments` row with status='INITIATED', method='card_present_zvt'
    → calls zvtClient.authorize({ amount, currency })
        → ZvtTerminalClient sends ZVT 06 01 over the persistent TCP socket
        → terminal handles chip/contactless/mag-stripe interaction with the customer
        → terminal returns 06 0F (Status) with result, Beleg-Nr, TLV blocks
        → terminal also prints customer receipt + merchant receipt locally on its built-in printer
        → (or routes to our receipt printer if the terminal is configured for "host print" — but the default
           is "terminal prints its own"; we accept either, configured per shop in `system_settings`)
    → flow parses the TLV response, updates payment.status:
        - success → AUTHORIZED → CAPTURED  (ZVT chip/contactless is immediate-capture)
        - failure → FAILED with failure_code from the ZVT result byte
    → emits ledger event
    → transaction proceeds to TSE signing flow (Fiskaly, ADR-0014)
```

#### Network & operational discipline

- **Terminal on isolated VLAN.** The Verifone/Ingenico sits on a `payment_terminal` VLAN; only the POS container has firewall ingress to it. This is per-PCI-best-practice "card-data-zone" segmentation even though we don't see PAN — defense in depth.
- **Static IP per terminal.** Documented in the shop's network inventory (Control Desktop "Terminals" panel surfaces the configured IP per terminal record in `devices` table from ADR-0009).
- **Multi-terminal support.** Each POS terminal (cashier station) has its own paired payment terminal. The `devices` table's `device_class='POS_TERMINAL'` row carries a `payment_terminal_ip` config field. One ZvtTerminalClient instance per POS.
- **Idle disconnect handling.** Some Verifone firmwares drop idle TCP sockets after 10-15 minutes. The 5-second heartbeat keeps the connection alive **and** detects loss within heartbeat-interval seconds.
- **TLS-on-ZVT (optional, terminal-dependent).** Modern Verifone V400c supports ZVT-over-TLS; we enable it if the firmware supports it. Per shop LAN this is belt-and-braces — the terminal-to-POS link is already on an isolated VLAN.

The Oliver pattern handles ZVT timeouts and terminal-offline gracefully (per ADR-0018 §2 row "ZVT Kassenterminal disconnected"); the 5-second heartbeat to the terminal is monitored; loss of heartbeat for >15 s surfaces a banner and disables card sales until reconnect.

#### What this rules out

- **Serial (RS-232) over USB-to-serial.** Rejected: USB pass-through into Docker containers requires `--device` flags + privileged mode + per-OS quirks. Not portable.
- **Bluetooth pairing.** Rejected for the primary path: Bluetooth in a Linux container is purgatory. SumUp Solo's Bluetooth model lives outside Docker (a small native helper bridges it to our API) — but that is the SumUp alternative path, not the primary.
- **Vendor-specific cloud-mediated card readers** (Square, Toast, etc.). Rejected: not common in DE, and routes card-touching events through a foreign-jurisdiction cloud, breaking ADR-0005.

### 7. SumUp Solo — alternative POS provider

SumUp Solo (Bluetooth terminal + iPad app, or SumUp's REST API for headless) is the fallback for shops without a permanent ZVT terminal — or for our Phase 1.5 in case the certified Kassenterminal vendor lead time is too long.

The HTTP API path:

```
POST https://api.sumup.com/v2.0/checkouts
  Authorization: Bearer <merchant_token>
  Body: { checkout_reference, amount, currency }
  Returns: { id, checkout_url, status }
```

Same state machine, same `payments` row shape. The only differences from Mollie: SumUp settles to its own bank account, then payouts arrive at our bank with a 1-2 day delay (vs Mollie's immediate-credit on our Mollie balance). The reconciler accommodates both paths.

### 8. Cash payments — recorded same way, no provider

Cash sales create a `payments` row with `method='cash'`, no `provider_payment_id`, immediate `SETTLED` status (cash is already in our drawer). The `cash_journal` table (ADR-0008's `0011_closing.sql`) tracks the drawer balance independently, and daily closing reconciles `cash_journal` against the sum of cash `payments` for the day.

```ts
export async function recordCashSale(opts: { transactionId, amountTendered, change, ... }) {
  // Single transaction: payment + cash_journal_entry + ledger_event, all-or-nothing.
  await db.transaction(async tx => {
    const [payment] = await tx.insert(payments).values({
      transactionId: opts.transactionId,
      method: 'cash',
      status: 'SETTLED',
      amount_eur: opts.amount.toString(),
      dsfinvkZahlartCode: 'Bar',
      capturedAt: new Date(),
      settledAt: new Date(),
    }).returning();
    await tx.insert(cashJournal).values({ /* movement entry */ });
    await ledger.emit({ /* payment.settled */ }, tx);
  });
}
```

### 9. Split payments — multiple methods on one transaction

A customer may pay €300 in cash and €700 by card on the same €1,000 sale. The flow:

```ts
// packages/payments/src/flows/posSaleSplit.ts
export async function recordSplitSale(opts: { transactionId, parts: PaymentPart[] }) {
  // Sum of parts must equal the transaction.total_eur exactly (validated upstream).
  // Each part becomes its own payments row.
  await db.transaction(async tx => {
    for (const part of opts.parts) {
      if (part.method === 'cash') await recordCashSalePart(tx, opts.transactionId, part);
      else if (part.method === 'card_present_zvt') await recordZvtCardPart(tx, opts.transactionId, part);
      // ... other methods
    }
    // Verify: SUM(payments.amount_eur WHERE transaction_id = X) = transaction.total_eur
    const verify = await tx.execute(sql`
      SELECT SUM(amount_eur) AS paid FROM payments WHERE transaction_id = ${opts.transactionId}
    `);
    const tx_total = (await tx.query.transactions.findById(opts.transactionId)).totalEur;
    if (!Money.equal(verify.paid, tx_total)) {
      throw new SplitPaymentMismatchError(verify.paid, tx_total);
    }
  });
}
```

The verify-step inside the transaction guarantees a split sale either fully reconciles or rolls back atomically.

### 10. Refund flow — initiates fiscal Storno

```ts
// packages/payments/src/flows/refund.ts
export async function refundPayment(opts: { paymentId, amountEur, reason, actorUserId }) {
  // 1. Validate: payment is CAPTURED or SETTLED; refund amount ≤ original captured.
  // 2. Call the provider's refund API (Mollie / Stripe / ZVT depending on method).
  // 3. On provider confirmation:
  //    - Update payment.status = 'REFUNDED' (full) or remain 'SETTLED' with partial refund tracked separately
  //    - Insert a Storno transactions row (per ADR-0008 §5: storno_of_transaction_id = original)
  //    - Insert ledger events: 'payment.refund_initiated' → 'payment.refunded'
  //    - TSE sign the Storno (Fiskaly state machine: INTENTION → TRANSACTION → FINISHED for the reversal)
  //    - DSFinV-K export marks the day's NETTO_KASSE with the reversal entry
}
```

The refund flow is the **only** path to undo a captured payment. UI-level "delete this sale" is impossible — the role grants from ADR-0008 §3 reject `DELETE` on payments outright.

### 11. Chargeback flow — semi-automated evidence pack, manual review-and-submit

Chargebacks arrive asynchronously, sometimes weeks after the original payment, when a customer disputes the charge with their issuing bank. Provider sends a webhook → we open a `chargeback_events` row + emit `payment.chargeback_opened` event.

The lifecycle:

```
opened → evidence_assembling → evidence_ready_for_review → evidence_submitted → won / lost

  ↓               ↓                          ↓                       ↓                 ↓
ledger event   automated (worker)        Bridge alert            ADMIN clicks       provider
                                       severity=high          'Submit' in UI       webhook
```

Submission is **manual review-and-submit** per Basel's directive (2026-05-23): the system assembles evidence into a draft, the ADMIN reviews and clicks Submit. Full automation of financial disputes is rejected as risky for V1 — every submitted dispute is a public record visible to acquirers and the customer's bank.

#### Automated evidence pack assembly

On `payment.chargeback_opened`, a worker job (`apps/worker/src/jobs/chargeback-evidence-builder.ts`) assembles a structured evidence pack and renders it to a draft PDF. The pack pulls every fact the provider's dispute portal expects, in a single browsable file:

| Section in evidence PDF | Source | What it proves |
|---|---|---|
| **1. Transaction summary** | `transactions` + `payments` rows | Date/time/amount/method match what the customer was charged |
| **2. Itemized receipt** | `transaction_items` + signed PDF receipt from R2 | The goods/services delivered against the charge |
| **3. TSE signature record** | `tse_transactions` row | Fiskaly-signed proof of finalized transaction (KassenSichV-compliant; acquirers respect this) |
| **4. Customer identity link** | `customers` + KYC artifacts if Ankauf | The cardholder vs the shop customer match (when KYC was captured) |
| **5. Delivery / pickup proof** | `appointments` (PICKUP) + cashier check-in record + customer signature image if captured at counter | Customer was present + acknowledged the sale |
| **6. Cardholder match indicators** | Mollie/Stripe AVS + 3DS results from the original auth | Provider's own fraud-check signals were green at authorization |
| **7. Communication history** | `whatsapp_conversations` + `whatsapp_messages` (decrypted for the pack) — only messages **directly referencing this transaction** (matched by tx id, item id, order id, date proximity) | Customer engaged with the shop about this item; no prior complaint pattern |
| **8. Inventory provenance** | intake_drafts + product photos + intake messages | The item sold matches the listing description (defends "item not as described" disputes) |
| **9. Refund and contact attempts** | any prior refund records + outbound messages | Demonstrates good-faith effort to resolve before dispute |

The PDF is generated server-side using a Pdf library (chromium-headless via `puppeteer-core` works; deferred-decision whether we use that or a templated alternative like `pdfkit`). Each evidence section is timestamped and includes the source ledger event IDs, so the auditor can trace every claim back to its `ledger_events` row.

#### The review-and-submit UX

When the evidence pack is `evidence_ready_for_review`, the Bridge (ADR-0019) raises a `severity=high` alert and the ADMIN opens the Chargeback Review panel:

```
┌──────────────────────────────────────────────────────────┐
│  Chargeback · €1,250 · Visa ending 4242                 │
│  Reason code 4855 (Goods or services not received)      │
│  Opened: 2026-06-15  ·  Evidence due: 2026-06-22 18:00  │
│                                                          │
│  [📄 Open evidence PDF (draft)]                          │
│  [📝 Add a written rebuttal]                              │
│                                                          │
│  Evidence package contains:                              │
│   ✓ Transaction + TSE signature                          │
│   ✓ Receipt (PDF, R2)                                    │
│   ✓ KYC photo (encrypted)                                │
│   ✓ Pickup appointment + signature                       │
│   ✓ 14 WhatsApp messages with customer                   │
│   ✓ Intake photos showing item authenticity              │
│                                                          │
│  [ ✓ Approve & Submit ]    [ ✗ Decline to defend ]      │
└──────────────────────────────────────────────────────────┘
```

The ADMIN clicks **Approve & Submit** → the worker uploads the PDF + structured fields to the provider's dispute API. State transitions to `evidence_submitted`; the dispute is in the provider's hands. The ADMIN may also **Decline to defend** (rare — typically when the dispute is legitimate); status moves directly to `lost` with reason `admin_declined_to_defend`.

If `evidence_due_at` arrives without an ADMIN action, status auto-transitions to `lost` with reason `evidence_deadline_missed`. This makes deadline-discipline a hard constraint visible in the Bridge.

A lost chargeback (whether by submission outcome, decline, or deadline miss) emits a Storno-equivalent fiscal entry against the original sale, with the reason clearly tagged in the ledger.

#### What stays out of automation in V1

- **The rebuttal narrative** (free-form text the dispute portal accepts). ADMIN writes this manually; we never let an LLM compose dispute language on the shop's behalf.
- **The decision to defend vs concede.** ADMIN judgment; the system assembles facts.
- **Submission timing.** ADMIN clicks when ready; deadline pressure is surfaced but not bypassed.

Phase 2 may add AI-suggested rebuttal phrasing as a **suggestion** (not auto-submit), evaluated case-by-case.

### 12. Monthly reconciliation — bank statement vs `payments` rows

End of month, an ADMIN runs the reconciler:

```
For each Mollie payout row in the bank statement (CAMT.053 / MT940):
  Find the payments rows whose provider_settlement_id matches
  Verify SUM(those payments.amount_eur) - SUM(refunds) - mollie_fees = bank_credit_amount
  Flag any mismatch for manual review
```

The reconciler outputs a Steuerberater-friendly report (CSV + PDF summary). Discrepancies are typically Mollie fees that change rate mid-month (negotiated) or rare currency conversion deltas; both have documented resolution paths.

### 13. DSFinV-K Zahlart mapping

```ts
// packages/payments/src/dsfinvk/zahlartMapping.ts
export const ZAHLART_MAPPING: Record<PaymentMethod, string> = {
  cash:               'Bar',
  card_present_zvt:   'Unbar',         // card-present
  card_present_sumup: 'Unbar',
  card_online_mollie: 'Unbar',         // (online card → still "Unbar" cashless)
  card_online_stripe: 'Unbar',
  sepa_mollie:        'Unbar',
  klarna_mollie:      'Unbar',
  gift_card_internal: 'Gutschein',
  voucher_internal:   'Gutschein',
  ebay_managed:       'Unbar',
};
```

This mapping is the single source of truth for the DSFinV-K `BON_KASSE` export's `ZAHLART` field. The mapping is reviewed in every PR; changing it is a deliberate compliance act.

## Consequences

**Positive:**
- PCI scope = card-data-aware only (orders of magnitude less work than handling-PAN merchant level).
- The state machine is exhaustive and tested; every transition is auditable years later.
- Mollie + Stripe + ZVT + SumUp are best-in-class for their channels — we benefit from their security, fraud detection, and reliability without owning them.
- Webhook idempotency + signature verification eliminate the entire class of "double-charge from a redelivered webhook" bugs.
- Refund and chargeback flows are integrated with the fiscal Storno discipline; the Steuerberater sees a clean audit trail.
- Reconciliation tooling means month-end is hours, not days.

**Negative:**
- Four providers means four sandbox accounts to maintain and four contract relationships. Provider fees are real cost — typically 1.5-2.9% per transaction depending on method.
- A provider outage degrades that channel; we accept this (Mollie has 99.95% uptime SLA, ZVT terminals are local + offline-capable per ADR-0018).
- SumUp Solo's HTTP API has higher per-transaction fees than the ZVT path; we use SumUp only as fallback or for pop-ups.

**Mitigations:**
- Sandbox credentials kept in Oracle Vault; CI tests against sandboxes are non-blocking (sandbox flakiness is normal); production uses the live keys.
- Provider-status banner in Control Desktop subscribes to each provider's status page; an outage surfaces before the cashier discovers it.
- The reconciler runs against sandbox data weekly during dev; production reconciliation is a one-click Bridge action with the report emailed to Steuerberater.

## Alternatives considered

- **Build our own card processing integration directly with acquiring bank.** Rejected. PCI DSS Level 4 merchant compliance is a full-time job; the cost-benefit is catastrophic for a single-shop V1.
- **Single provider for everything (just Stripe or just Mollie).** Rejected. Stripe doesn't natively handle German Girocard well; Mollie doesn't cover all international cards equally. The split gives strength on both surfaces.
- **Vendor-managed POS that we don't integrate with at the API level (e.g. SumUp Air + manual recording).** Rejected. No DSFinV-K integration = manual workarounds = audit risk.
- **Adyen / Wirecard-successor.** Rejected. Adyen targets enterprise volumes; Wirecard's collapse left a credibility hole in its successors.
- **Cash-only POS.** Rejected. Customers expect card payment in 2026; cash-only is a competitive disadvantage.
- **Cryptocurrency payments.** Rejected. Regulatory clarity in Germany for gold/precious-metal businesses + crypto is murky; KYC implications double; no benefit for our customer base.

## Known limits & deferred decisions

1. **No recurring payments / subscriptions.** Not relevant to our retail model. The schema slot exists but is not wired.
2. **No multi-currency.** EUR only V1. CH-customer paying in CHF means they convert at the Mollie checkout; we receive EUR.
3. **No PayPal direct.** Available via Mollie if needed; we evaluate add in Phase 1.5 based on storefront analytics.
4. **No Apple Pay / Google Pay direct integrations.** Both come for free via Mollie + Stripe hosted checkouts.
5. **No installment / Buy-Now-Pay-Later beyond Klarna (via Mollie).** Klarna covers most of the use case for the customer base.
6. **No real-time bank-statement integration** (e.g. open banking). The reconciler imports CAMT.053 / MT940 files exported from the bank; nightly auto-import is Phase 2.
7. **eBay Managed Payments reconciliation** is documented but not yet automated; payouts arrive bi-weekly and the ADMIN reconciles via the eBay seller dashboard until we automate.
8. **No fraud-scoring above what providers offer.** Mollie's and Stripe's built-in fraud tools (machine learning on their massive cross-merchant data) outperform anything we could build. We accept their judgment + manual review on flagged cases.

## References

- ADR-0007 — GwG / KYC (sanctions screening before payment authorization)
- ADR-0008 — Schema; the `payments`, `webhook_events_log`, `chargeback_events` tables land in migration `0009_transactions.sql` (extending the existing transactions migration to include their payment artifacts; updated to `0009_transactions_and_payments.sql` or split — Chunk 0.2 will decide the precise file boundary)
- ADR-0016 — Inventory lock (payment finalization triggers `finalize()` in the lock package)
- ADR-0018 — POS resilience (ZVT terminal outages + cash drawer edge cases)
- Mollie API — https://docs.mollie.com
- Stripe Payment Intents — https://stripe.com/docs/payments/payment-intents
- ZVT spec — https://www.terminalhersteller.de/spezifikation
- SumUp REST API — https://developer.sumup.com
- BMF DSFinV-K v2.0 schema — `Zahlart` codes (Bar, Unbar, Gutschein, Sonstiges)
- Oliver Roos cherry-pick: `backend/src/modules/hardware/zvt.ts`, `backend/src/lib/finance/datevFormatter.ts`, `backend/src/lib/export/datev.ts`
- `docs/memory.md` §2 #31 #32
