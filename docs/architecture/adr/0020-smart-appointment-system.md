# ADR-0020 — Smart Appointment System: typed appointments, multi-source booking, pre-emptive soft holds, no-show graceful recovery

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Related:** ADR-0008 (the schema this ADR adds to migration `0006_products.sql` — or a new migration, see §11), ADR-0014 (reminders + check-ins flow as SSE events), ADR-0016 §6 (the *consumer-side* contract of soft viewing-holds — this ADR is the *producer side*), ADR-0017 pending (WhatsApp delivery of reminders and confirmations), ADR-0018 §7 (the POS-side interactions with appointments), ADR-0019 (the Appointments panel in the Bridge), `docs/memory.md` §2 #33.

## Context

Basel set the appointment system as a **first-class concern** during the holistic-review wave. Two earlier ADRs (ADR-0016 §6 and ADR-0018 §7) defined the *consumer surfaces* — how soft viewing-holds plug into the inventory lock, how the POS shows the "Next Hour" panel and one-tap check-in. This ADR is the **producer side**: the schema, the booking flow, the multi-staff capacity model, the reminder cadence, the no-show grace, the SLA tracking, and the worker jobs that make appointments behave like the high-quality concept Basel expects.

The system must serve three distinct booking surfaces, each with different UX constraints:

| Surface | Who books | Constraints |
|---|---|---|
| **Control Desktop (Admin / Bridge)** | Owner or staff with ADMIN role | Full power: any customer, any item, any slot, override capacity |
| **Storefront (warehouse14.de)** | Customer self-service | Public-facing UX; only future slots; capacity-aware; KYC-lite (phone + name) until appointment confirmed |
| **POS (in-shop cashier)** | Cashier book on behalf of walk-in customer who wants a follow-up | Quick: pick item → pick slot → SMS/WhatsApp confirmation |

All three surfaces produce the same canonical `appointments` row. The booking surface is a metadata field, not a parallel schema.

Constraints:

1. **Time zones are Europe/Berlin.** Cross-border customers may operate in CH or FR — UI displays Europe/Berlin always; customer-facing emails show both Europe/Berlin and the customer's IANA tz when known.
2. **Multi-staff from V1.** Even if the shop has only two cashiers today, the capacity model must accommodate staff growth without a schema migration.
3. **Soft viewing-holds produced for VIEWING-type appointments** with linked products (per ADR-0016 §6).
4. **Reminders honor WhatsApp's 24-hour conversation window** (template messages outside the window; free-form messages inside).
5. **No-show grace + auto-release** — the soft hold expires automatically; the appointment closes with a recorded reason; the customer gets a non-blaming follow-up.
6. **Calendar export (.ics) for the customer** so they can put the slot in their own calendar.
7. **Smart suggestion**: when the customer books a VIEWING and the item is already RESERVED elsewhere, the system suggests the next-best similar items (using `gateway.tasks.embedQuery` + pgvector — same machinery as ADR-0016 §6.bis).

## Decision

### 1. Four appointment types

```sql
CREATE TYPE appointment_type AS ENUM (
  'VIEWING',          -- customer wants to inspect specific items
  'BUYBACK_EVAL',     -- customer brings items for evaluation (Ankauf-preparation)
  'CONSULTATION',     -- general inquiry, no specific items
  'PICKUP'            -- customer placed a storefront order, picks up in shop
);
```

Each type maps to a distinct POS preparation flow per ADR-0018 §7:

| Type | POS prep on check-in | Linked entities | Default duration |
|---|---|---|---|
| `VIEWING` | Linked products tray pre-loaded; soft holds active until appt + 30min | `appointment_linked_products` rows | 45 min |
| `BUYBACK_EVAL` | Scale calibration check; KYC capture prompt opens immediately | none (items are TBD) | 30 min |
| `CONSULTATION` | Customer profile + history opens; no inventory linkage | none | 20 min |
| `PICKUP` | Storefront order pre-loaded; receipt ready to print | `orders` row (Phase 2 storefront) | 15 min |

Default durations are tunable in `system_settings` per appointment type.

### 2. Multi-staff capacity — slot grid per staff + shop

We model capacity at the **(staff × shop × time-slot) grain**. Two cashiers physically present means two parallel slot streams. The slot grid is computed on-demand from staff working hours + existing appointments + slot duration — there is no materialized "slots" table to maintain.

```sql
CREATE TABLE staff_working_hours (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users(id),
  shop_id         UUID,                                       -- V1: NULL = the single shop; multi-shop adds FK
  weekday         SMALLINT     NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0=Mon, 6=Sun (ISO 8601)
  starts_at_local TIME         NOT NULL,
  ends_at_local   TIME         NOT NULL,
  effective_from  DATE         NOT NULL DEFAULT now(),
  effective_until DATE,                                       -- NULL = open-ended
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE staff_time_off (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES users(id),
  starts_at       TIMESTAMPTZ  NOT NULL,
  ends_at         TIMESTAMPTZ  NOT NULL,
  reason          TEXT,
  approved_by     UUID         REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE shop_holidays (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID,                                       -- V1 NULL
  closed_date     DATE         NOT NULL,
  reason          TEXT,
  UNIQUE (shop_id, closed_date)
);
```

The slot-availability function:

```sql
CREATE OR REPLACE FUNCTION available_slots(
  appt_type        appointment_type,
  duration_minutes INTEGER,
  from_dt          TIMESTAMPTZ,
  to_dt            TIMESTAMPTZ,
  preferred_staff_id UUID DEFAULT NULL
) RETURNS TABLE (
  staff_user_id UUID,
  slot_starts_at TIMESTAMPTZ,
  slot_ends_at   TIMESTAMPTZ
) AS $$
  -- Generate candidate slots from working_hours (excluding time_off and shop_holidays),
  -- subtract existing appointments + capacity buffer, return slots that fit duration.
  -- (Full SQL omitted; ~80 lines, fully unit-tested with edge cases for DST transitions,
  -- overlapping working_hours periods, time-off spanning a working-hours boundary, etc.)
$$ LANGUAGE plpgsql STABLE;
```

The function is `STABLE` (not `IMMUTABLE`) — depends on database state, but does not modify it. Critical: handles **DST transitions correctly** by computing in `Europe/Berlin` then converting to `TIMESTAMPTZ` on output. Property-tested against the next 3 years of DST switches.

**Capacity buffer:** a configurable per-type buffer (`appointment_buffers` table) reserves transition time between back-to-back appointments. Default: 5 min for VIEWING/PICKUP, 10 min for BUYBACK_EVAL (cleanup of scale + station), 0 for CONSULTATION.

### 3. Core schema — `appointments` and related

```sql
CREATE TYPE appointment_status AS ENUM (
  'SCHEDULED',         -- created, in the future
  'CONFIRMED',         -- customer confirmed (via WhatsApp reply or email link)
  'CHECKED_IN',        -- physically arrived, POS tap recorded
  'IN_PROGRESS',       -- check-in plus service started
  'COMPLETED',         -- finished, may have led to a sale (linked tx)
  'NO_SHOW',           -- grace window elapsed without check-in
  'CANCELLED',         -- explicitly cancelled before start
  'RESCHEDULED'        -- soft-cancelled, see rescheduled_to_appointment_id
);

CREATE TABLE appointments (
  id                          UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id                     UUID,                                  -- V1 NULL; multi-shop adds FK
  appointment_type            appointment_type    NOT NULL,
  status                      appointment_status  NOT NULL DEFAULT 'SCHEDULED',
  -- Time
  starts_at                   TIMESTAMPTZ         NOT NULL,
  duration_minutes            INTEGER             NOT NULL CHECK (duration_minutes > 0),
  ends_at                     TIMESTAMPTZ         GENERATED ALWAYS AS (starts_at + (duration_minutes * INTERVAL '1 minute')) STORED,
  -- People
  customer_id                 UUID                REFERENCES customers(id),     -- nullable for walk-in placeholders
  staff_user_id               UUID                NOT NULL REFERENCES users(id),
  booked_by_user_id           UUID                REFERENCES users(id),         -- NULL = customer self-service
  booked_via                  TEXT                NOT NULL CHECK (booked_via IN ('control_desktop', 'storefront', 'pos', 'whatsapp_bot')),
  -- Context
  customer_notes              TEXT,                                             -- free-form from customer at booking
  staff_notes                 TEXT,                                             -- internal
  -- Lifecycle timestamps (SLA tracking)
  confirmed_at                TIMESTAMPTZ,
  checked_in_at               TIMESTAMPTZ,
  early_arrival_minutes       INTEGER,                                          -- negative = late; positive = early
  in_progress_started_at      TIMESTAMPTZ,
  completed_at                TIMESTAMPTZ,
  no_show_marked_at           TIMESTAMPTZ,
  cancelled_at                TIMESTAMPTZ,
  cancellation_reason         TEXT,
  -- Rescheduling
  rescheduled_from_appointment_id UUID            REFERENCES appointments(id),
  rescheduled_to_appointment_id   UUID            REFERENCES appointments(id),
  -- Outcome
  linked_transaction_id       UUID                REFERENCES transactions(id),  -- populated if appointment ended in a sale
  -- Audit
  created_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ         NOT NULL DEFAULT now(),

  CHECK (status != 'CHECKED_IN' OR checked_in_at IS NOT NULL),
  CHECK (status != 'COMPLETED'  OR completed_at  IS NOT NULL),
  CHECK (status != 'CANCELLED'  OR cancelled_at  IS NOT NULL),
  CHECK (status != 'NO_SHOW'    OR no_show_marked_at IS NOT NULL)
);

CREATE INDEX idx_appointments_status_starts_at ON appointments (status, starts_at);
CREATE INDEX idx_appointments_staff_starts_at  ON appointments (staff_user_id, starts_at);
CREATE INDEX idx_appointments_customer         ON appointments (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_appointments_today_at_shop    ON appointments (shop_id, berlin_business_day(starts_at));
```

```sql
CREATE TABLE appointment_linked_products (
  appointment_id  UUID         NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
  product_id      UUID         NOT NULL REFERENCES products(id),
  added_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (appointment_id, product_id)
);
-- INSERTs into this table trigger creation of product_viewing_holds (ADR-0016 §6 mechanism).
```

```sql
CREATE TABLE appointment_notifications (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id    UUID         NOT NULL REFERENCES appointments(id),
  notification_type TEXT         NOT NULL,                       -- 'booking_confirmation' | 'reminder_24h' | 'reminder_2h' | 'reminder_30min' | 'no_show_followup' | 'rescheduled' | 'cancelled'
  channel           TEXT         NOT NULL,                       -- 'whatsapp' | 'email' | 'sms'
  recipient         TEXT         NOT NULL,                       -- phone or email
  template_id       TEXT,                                        -- Meta-approved template ref
  scheduled_for     TIMESTAMPTZ  NOT NULL,
  sent_at           TIMESTAMPTZ,
  delivery_status   TEXT,                                        -- 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'window_closed'
  external_ref      TEXT,                                        -- WhatsApp / email message ID
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_appt_notif_scheduled ON appointment_notifications (scheduled_for) WHERE sent_at IS NULL;
```

Every state transition (`SCHEDULED → CONFIRMED → CHECKED_IN → IN_PROGRESS → COMPLETED`, plus the abnormal exits NO_SHOW / CANCELLED / RESCHEDULED) emits a `ledger_events` row with the appointment ID and the timing context (per ADR-0008).

### 4. Booking flow — three surfaces, one canonical write

```ts
// packages/appointments/src/book.ts
type BookingInput = {
  type: AppointmentType;
  customerId?: string;            // null for storefront walk-up; we create a Customer record at booking time
  startsAt: Date;
  durationMinutes?: number;       // default per type
  staffUserId?: string;           // default: any-available with VIEWING preference for the requesting customer's history-paired staff
  bookedByUserId?: string;        // null for customer-self-service
  bookedVia: 'control_desktop' | 'storefront' | 'pos' | 'whatsapp_bot';
  linkedProductIds?: string[];    // VIEWING only
  customerNotes?: string;
};

async function book(input: BookingInput): Promise<Appointment> {
  return await db.transaction(async tx => {
    // 1. Verify the slot is still available (re-check inside the transaction; the slot list was advisory)
    const slot = await tx.execute(sql`
      SELECT 1 FROM available_slots(
        ${input.type}, ${input.durationMinutes ?? defaultDurationFor(input.type)},
        ${input.startsAt}, ${input.startsAt + interval}, ${input.staffUserId}
      )
      WHERE slot_starts_at = ${input.startsAt}
      FOR UPDATE
    `);
    if (slot.rowCount === 0) throw new SlotUnavailableError();

    // 2. Insert the appointment
    const [appt] = await tx.insert(appointments).values({ /* ... */ }).returning();

    // 3. For VIEWING: insert linked products + create soft holds via ADR-0016 §6 contract
    if (input.type === 'VIEWING' && input.linkedProductIds?.length) {
      await tx.insert(appointmentLinkedProducts)
              .values(input.linkedProductIds.map(pid => ({ appointmentId: appt.id, productId: pid })));
      // Trigger creates product_viewing_holds rows automatically (see §5)
    }

    // 4. Schedule the notification cadence (see §7)
    await scheduleNotificationsFor(appt, tx);

    // 5. Audit
    await ledger.emit({
      event_type: 'appointment.created',
      entity_table: 'appointments',
      entity_id: appt.id,
      actor_user_id: input.bookedByUserId,
      payload: { type: input.type, starts_at: input.startsAt, booked_via: input.bookedVia },
    }, tx);

    return appt;
  });
}
```

The `book()` function is the **only** entry point for creating an appointment. The three surfaces (Control Desktop, storefront, POS) call it with different `bookedVia` values; the function is the contract.

**Failure modes:**

- `SlotUnavailableError` — another booking grabbed the slot between the user seeing it and confirming. UI shows next 3 alternatives.
- `LinkedProductReservedError` — by the time of booking, a linked product was sold. UI shows the message + offers to drop that product from the link and proceed.
- `CustomerSanctionsMatchError` — if the customer matches sanctions (ADR-0018 §6), booking is blocked with an ADMIN escalation path.

### 5. Soft viewing-holds — produced via trigger, consumed by inventory-lock

`appointment_linked_products` insert triggers a row in `product_viewing_holds` (ADR-0016 §6 schema):

```sql
CREATE OR REPLACE FUNCTION create_viewing_hold_on_link() RETURNS TRIGGER AS $$
DECLARE
  appt_row    appointments%ROWTYPE;
BEGIN
  SELECT * INTO appt_row FROM appointments WHERE id = NEW.appointment_id;
  IF appt_row.appointment_type = 'VIEWING' AND appt_row.status IN ('SCHEDULED', 'CONFIRMED') THEN
    INSERT INTO product_viewing_holds (
      product_id, appointment_id, customer_id,
      hold_strength, hold_starts_at, hold_expires_at
    )
    VALUES (
      NEW.product_id, NEW.appointment_id, appt_row.customer_id,
      'SOFT',  -- per ADR-0016 §6; ADMIN can later promote to HARD
      now(),
      appt_row.starts_at + INTERVAL '30 minutes'   -- soft hold expires at appt + grace
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_viewing_hold
  AFTER INSERT ON appointment_linked_products
  FOR EACH ROW EXECUTE FUNCTION create_viewing_hold_on_link();
```

Cancelling / rescheduling / completing an appointment releases the associated holds; the worker job (§8) handles this on state transitions.

### 6. Smart suggestion at booking — customer wanted X, X is sold, system offers similar

When the storefront customer attempts to add product X to a VIEWING booking and `products.status != 'AVAILABLE'`:

```ts
async function suggestAlternatives(wantedProductId: string, customerId?: string) {
  const wanted = await db.products.findById(wantedProductId);   // may be RESERVED or SOLD
  // Reuse the same machinery as ADR-0016 §6.bis
  const candidates = await db.execute(sql`
    SELECT id, name, price_eur, primary_photo_r2_key,
           1 - (embedding <=> ${wanted.embedding}) AS similarity
      FROM products
     WHERE status              = 'AVAILABLE'
       AND tax_treatment_code  = ${wanted.tax_treatment_code}
       AND id                 != ${wanted.id}
     ORDER BY embedding <=> ${wanted.embedding}
     LIMIT 3
  `);
  return candidates;
}
```

UI: "That piece was just reserved. We've selected three you might love just as much:" — customer can swap one of the suggestions into the booking with one click.

### 7. Reminder cadence — three-stage, channel-aware, template-honest

```
T-24h          : Email + WhatsApp template (booking_confirmation_v1)
                 — "Hello {name}, here's your appointment tomorrow at {time}. Calendar attached."
T-2h           : WhatsApp template (reminder_2h_v1) — "Quick reminder for today {time}. Reply CONFIRM."
T-30min        : SSE event to in-shop POS — "Mr. Schmidt arriving in 30 minutes" (ADR-0018 §7)
T+0            : Highlighted in POS "Next Hour" panel (orange "now" state)
T+30min if no  : Move to NO_SHOW; release holds; send no-show follow-up (no_show_followup_v1)
check-in       :   — "We missed you today — would you like to rebook? [link]"
```

The notification scheduler is a single worker job (`apps/worker/src/jobs/appointment-notifications.ts`) that runs every minute and dispatches anything in `appointment_notifications WHERE scheduled_for <= now() AND sent_at IS NULL`. Idempotency: a `sent_at IS NULL` check inside the dispatch transaction guarantees at-most-once delivery.  ⟵ geloescht am 14.08.2026: der Arbeiter gehoerte zu warehouse14; die Warteschlange hat seither keinen Leerer

**WhatsApp 24-hour window handling:** if the customer last messaged us within 24 hours, we can send free-form text; otherwise the scheduler uses the pre-approved template. The dispatcher checks `whatsapp_conversations.last_inbound_at` (ADR-0017's table) and selects accordingly. If outside the window AND no template covers the case, the notification is logged with `delivery_status='window_closed'` and surfaces as a Control Desktop alert.

### 8. Worker jobs — the appointment lifecycle automation

```
apps/worker/src/jobs/
├── appointment-notifications.ts       # 1-min cron: dispatches scheduled notifications
├── appointment-no-show-detector.ts    # 1-min cron: marks NO_SHOW after grace, releases holds, sends follow-up
├── appointment-hold-cleanup.ts        # 5-min cron: releases holds for COMPLETED/CANCELLED appointments missed by trigger paths
└── appointment-sla-rollup.ts          # daily: writes the daily SLA snapshot (on-time check-in rate, no-show rate, etc.)
```

The no-show detector:

```sql
UPDATE appointments
   SET status = 'NO_SHOW',
       no_show_marked_at = now()
 WHERE status IN ('SCHEDULED', 'CONFIRMED')
   AND starts_at + (
         SELECT (value::integer || ' minutes')::interval
           FROM system_settings WHERE key = 'appointment.no_show_grace_minutes'
       ) < now()
RETURNING id, customer_id;
-- For each returned id: release holds (DELETE FROM product_viewing_holds WHERE appointment_id = ...),
-- emit ledger event, schedule no-show follow-up notification.
```

Configurable via `system_settings.appointment.no_show_grace_minutes` (default 30).

### 9. SLA tracking — daily and rolling metrics

Daily metrics rolled up by `appointment-sla-rollup`:

| Metric | Definition | Target |
|---|---|---|
| `check_in_on_time_rate` | % of appointments where check-in ≤ start + 5 min | ≥ 80% |
| `no_show_rate` | % of appointments marked NO_SHOW | ≤ 10% |
| `customer_avg_early_arrival_minutes` | mean of `early_arrival_minutes` (positive = early) | informational |
| `customer_late_arrival_5_to_30_min_rate` | % arriving 5-30 min late | informational |
| `walkin_override_count` | per ADR-0016 §6.bis | trend watch |
| `linked_product_purchase_conversion_rate` | % of VIEWING appointments that ended with linked product purchase | informational |
| `appointment_to_sale_revenue_eur` | sum of `linked_transaction_id` totals per day | ↑ |

Surfaced in the Bridge's Insights panel (ADR-0019 panel #7).

### 10. Calendar export (.ics) for the customer

Every confirmation email includes a `.ics` attachment generated from the appointment data:

```
BEGIN:VCALENDAR
PRODID:-//Warehouse14//EN
VERSION:2.0
BEGIN:VEVENT
UID:appt-{id}@warehouse14.de
DTSTAMP:...
DTSTART:...
DTEND:...
SUMMARY:Warehouse14 - {appointment_type} appointment
LOCATION:Warehouse14, Weil am Rhein
DESCRIPTION:...
END:VEVENT
END:VCALENDAR
```

This drops the appointment into the customer's Google Calendar / Apple Calendar / Outlook with one tap. Reduces no-show rate measurably (industry data: 15-25% reduction).

## Schema sketch — migration ownership

Per ADR-0008 §9, the migration order is fixed at 11 files. Appointments do **not fit cleanly into the existing 11** without bending one of them. The right move: **add migration `0012_appointments.sql`** as a clean extension. This is a documented amendment to ADR-0008 §9 — appointments are a coherent vertical, and squeezing them into another migration would defeat the "one logical concern per file" discipline ADR-0008 chose deliberately.

```
packages/db/migrations/
├── 0001_extensions.sql
├── 0002_helpers.sql
├── 0003_roles.sql
├── 0004_auth.sql
├── 0005_reference.sql
├── 0006_products.sql
├── 0007_customers_kyc.sql
├── 0008_audit_chain.sql
├── 0009_transactions.sql
├── 0010_tse.sql
├── 0011_closing.sql
└── 0012_appointments.sql          # ← NEW (this ADR)
```

## Consequences

**Positive:**
- One canonical `book()` function for three booking surfaces — no parallel implementations, no drift between channels.
- Multi-staff capacity from day one means we don't migrate the schema when shop hires a second cashier.
- Soft viewing-holds produced via trigger eliminates a class of bugs where an app developer forgets to create the hold.
- DST-correct slot availability is handled in one SQL function tested in CI against 3 years of DST switches.
- Reminders honor WhatsApp's 24-hour window automatically; the owner never receives "template fell out" failures.
- No-show grace + auto-release means inventory does not get stuck waiting for a customer who isn't coming.
- SLA metrics in the Bridge make appointment behavior visible; trends drive operational improvements.

**Negative:**
- The `available_slots()` SQL function is non-trivial (DST, time-off, capacity buffer, multi-staff). It must be unit-tested obsessively because every booking depends on it.
- Multi-staff schema is forward-looking; V1 only has 1-2 cashiers. Some complexity is paid up-front for future flexibility we may not need for 12 months.
- Adding `0012_appointments.sql` extends ADR-0008's 11-migration commitment to 12. We document this as an explicit amendment, not a silent drift.

**Mitigations:**
- The slot function is the centerpiece of the test suite: ~200 property-based tests covering DST, working-hours edge cases, time-off overlaps, simultaneous bookings.
- Multi-staff complexity is genuinely small (one additional table + one extra column on appointments) — the dev cost of forward-looking design is hours, not weeks.
- The amendment to ADR-0008 §9 is recorded in this ADR's §11 (Migration ownership) and in memory.md.

## Alternatives considered

- **Materialized slot table.** Rejected. Maintaining it across working-hours changes, time-off additions, and DST transitions is bug-prone. On-demand computation is correct by construction.
- **Single global slot stream (not per-staff).** Rejected. Two cashiers physically present should each have their own bookings. Single stream forces serializing what is naturally parallel.
- **Customer self-service from a third-party booking SaaS (Calendly, etc.).** Rejected. DSGVO surface; data-residency leak; doesn't integrate with our inventory-lock soft-hold contract.
- **No soft viewing-holds for storefront-booked appointments.** Rejected. The storefront customer who reserves a viewing is the same legitimacy as an in-shop reservation; the same conflict-resolution rules should apply.
- **Per-staff capacity instead of per-(staff, type) capacity.** Considered. We have `appointment_buffers` per type for transition time; finer-grain capacity per type is deferred until evidence demands it.
- **Two parallel booking flows for customer-facing and admin-facing.** Rejected. The complexity is in slot availability; both flows hit the same function and the same `book()` contract.

## Known limits & deferred decisions

1. **No recurring appointments in V1** (e.g. weekly cleaning consultation). Phase 2; the schema can extend via an `appointment_series_id` FK without breaking existing rows.
2. **No waitlist** when all slots are taken on the customer's preferred date. UX shows next-available; customer must rebook manually. Phase 1.5 adds a "notify me when {date} opens up" subscription.
3. **No customer-side rescheduling**. Customer can cancel + rebook (manual two-step). Phase 1.5 adds one-click reschedule via signed link.
4. **No appointment-to-appointment dependencies** ("Consultation A must be at least 7 days before Viewing B"). Phase 2+ if a use case emerges.
5. **No multi-shop in V1**. The `shop_id` column is `NULL` for single-shop; the slot function and capacity model are already shop-aware to ease the future migration.
6. **No "shared capacity" rooms** (e.g. one VIP viewing room used by either staff). V1 assumes each staff member has their own working surface. Phase 2 adds resource-pool capacity.
7. **No subscription / membership tier** that bypasses normal capacity rules. Not a current business model.
8. **No SMS reminders.** WhatsApp + email cover the V1 customer base. SMS via Twilio is a one-day add if the data tells us German customers want SMS.

## References

- ADR-0008 — Schema architecture; this ADR amends §9 to add migration `0012_appointments.sql`
- ADR-0010 — das frühere Kanal-Gateway (ausgezogen 19.08.2026)
- ADR-0014 — Live Ops; reminders + check-ins flow as SSE events
- ADR-0016 §6 + §6.bis — Soft viewing-holds + intelligent walk-in compensation (this ADR is the producer side)
- ADR-0017 (pending) — WhatsApp customer service bot (handles inbound CONFIRM replies)
- ADR-0018 §7 — POS appointment surfaces (Next Hour panel, one-tap check-in, walk-in conflict policy)
- ADR-0019 — Bridge UX (Appointments panel + Morning Briefing integration)
- iCalendar RFC 5545 — https://datatracker.ietf.org/doc/html/rfc5545
- `docs/memory.md` §2 #33 (Live Ops architecture)
