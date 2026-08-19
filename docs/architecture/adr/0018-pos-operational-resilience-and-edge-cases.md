# ADR-0018 — POS operational resilience: hardware, fiscal, human, compliance, and appointment-aware edge cases

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Related:** ADR-0014 (network transport — covered cloud/Tunnel/Tailscale outages but not the operational surfaces below), ADR-0008 (every recovery action emits ledger events), ADR-0016 (POS interacts with inventory lock through these flows), **ADR-0020 pending (Smart Appointment System — the source of the appointment-aware POS UX defined here)**, ADR-0007 (GwG → AML edge cases), `docs/memory.md` §3 ("TSE — network-resilient").

## Context

ADR-0014 established the network and cryptographic substrate that keeps the POS reachable. What it did **not** address — and what kills shops in practice — is the operational surface of a cashier's day:

- A jammed cash drawer.
- A receipt printer mid-roll on a busy Saturday.
- A scale that drifted out of calibration.
- A cashier who forgot their PIN at 09:01.
- A robbery in progress.
- A €12,000 sale that needs GwG documentation the cashier has never seen before.
- A customer arriving 20 minutes early for a viewing of an antique, before the cashier has had coffee.

The **invariant** Basel laid down is non-negotiable: *the shop never stops selling because of any single component failing*. Fiscal correctness must hold across all degradations. Cashier UX must be calm under duress.

This ADR enumerates every operational edge case we can foresee, specifies detection and recovery for each, and weaves the Smart Appointment System (ADR-0020 pending) into the cashier's working day as a first-class concern.

## Decision

### 1. The five categories of edge cases, and the principle for each

| Category | Principle |
|---|---|
| **Hardware** | Detect via the device's own status pin / heartbeat. Degrade with a banner, never with a crash. Block only what is *fiscally* required (e.g. cash drawer for cash sales). |
| **Fiscal (TSE)** | Local queue is sacred. Sales continue offline; signatures reconcile on reconnect. A failed TSE is never a reason to refuse a customer. |
| **Network** | Already covered in ADR-0014 (Tunnel + Tailscale failover, offline mode). This ADR adds *operational* network edges: NTP skew, DNS spoofing, certificate expiry. |
| **Human** | Treat the cashier as a teammate, not a suspect. Provide tools for the obvious mistakes (forgot PIN, mid-sale logout, walked away from terminal). Plan for the unobvious horror (duress, theft). |
| **Compliance** | Build the AML / sanctions / high-value workflow into the UI so the cashier cannot accidentally skip a legally-required step. Block only when the law would block; flag-and-continue otherwise. |

### 2. Hardware edge case matrix

The POS Desktop subscribes to a `hardware_health` topic via Tauri's IPC layer. Each connected device (cash drawer, receipt printer, barcode scanner, ZVT PinPad, scale) reports its status; the POS UI renders a per-device chip in the status bar.

| Device | Failure mode | Detection | Cashier UX | Sale blocked? | Recovery path |
|---|---|---|---|---|---|
| **Cash drawer** | Jammed / unable to open | ZVT status query at sale finalize | Banner: "Cash drawer not responding. Open manually or override." | Cash sales: yes (override = ADMIN approval + audit `cash_drawer_override`). Card sales: no. | Maintenance log + manual cycling on next idle window. |
| **Receipt printer** | Out of paper | Printer status query before print | Banner: "Out of paper — replace and reprint queued." | No. Sale completes; receipt enters reprint queue. | Belegausgabepflicht §146a AO: reprint MUST happen within 24h. UI tracks pending reprints. |
| **Receipt printer** | Offline / no response | Print job times out > 3s | Banner: "Printer offline. Sale completed. Receipt held for reprint." | No. | Same reprint queue; alert in Control Desktop if queue depth > 3. |
| **Barcode scanner** | USB disconnect | hidraw device gone | Banner: "Scanner disconnected — enter SKU manually." | No. Cashier types SKU. | Reconnection auto-detected on USB enumerate. |
| **ZVT Kassenterminal** | Heartbeat lost | ZVT ping > 5s no response | Banner: "Card terminal offline — accept cash only or wait." | Card sales: yes. Cash: no. | Power-cycle the terminal; Tauri auto-reconnects. |
| **Scale** | Serial port lost | RS-232 / USB-to-serial timeout | Banner: "Scale offline — Ankauf blocked until reconnected." | Ankauf: yes (override = ADMIN + manual weight entry + photo of physical scale reading). Verkauf: no. | Power-cycle scale. |
| **Touchscreen** | Region dead | Cannot be auto-detected reliably | Cashier-initiated fallback to keyboard mode | No. | Plug-in keyboard always present as backup. |
| **Power loss** | Mid-sale | Reboot detected by API on next connect | "Recovering from unexpected shutdown — resuming cart from local SQLite." | Sale state restored. | Cart, customer, items, subtotal — all in local SQLite (Oliver pattern). |
| **Disk** | < 10% free | Cron check every hour | Warning in Control Desktop; auto-purge local logs > 30 days. | No. | Manual disk cleanup if auto-purge insufficient. |

The principle behind every row: **block only what would create a fiscal violation. Everything else degrades gracefully.**

### 3. Fiscal (TSE) edge cases

TSE = the German fiscal signing device. We use **Fiskaly SIGN DE V2** (cloud TSE) per ADR-0001 / memory.md §29. Every transaction follows the state machine:

```
INTENTION → TRANSACTION → FINISHED (signed)
```

The local SQLite queue holds INTENTIONs that have not yet completed their signature cycle. The shop continues to sell even if the cloud TSE is unreachable — the INTENTION is timestamped and signed locally with the last-cached TSE cert; reconciliation happens on reconnect.

| TSE edge case | Detection | Behavior | Recovery |
|---|---|---|---|
| **Fiskaly cloud unreachable** | API timeout > 5s | Sale continues; INTENTION queued in local SQLite with local signature using cached TSE cert. Banner: "TSE pending sync (N items)." | Worker reconciles on reconnect; signed receipts can be reprinted with cloud signature. |
| **TSE cert near expiry** | Prometheus alert at T-30d, T-7d, T-1d (memory.md §29) | Auto-renewal via Fiskaly API. ADMIN alerted at T-30d to confirm. | Manual renewal path documented in `docs/runbooks/tse-cert-renewal.md` if auto-renewal fails. |
| **Fiskaly rate limit hit** | 429 response or response > 10s | Exponential backoff in worker (1s → 2s → 4s → … capped at 60s). | Resolves within minutes; no action needed. |
| **TSE cert expired during sale** | Fiskaly returns 401 | Sale proceeds offline; INTENTION queued; ADMIN paged immediately. | Issue new cert via Fiskaly dashboard; sync queue replays. |
| **Cross-day Storno** (Storno of a transaction signed yesterday) | TSE request includes `original_finalized_at` from previous Berlin business day | Special TSE request flagged `cross_day_reversal`; signed in today's chain with explicit reference to yesterday's TSE transaction ID. | Both TSE archive periods must reflect the reversal — reconciler verifies on next archive cycle. |
| **TSE archive period mismatch** | Daily closing job (memory.md §6) compares TSE transaction count vs `transactions` row count | Block daily closing with "TSE mismatch — TSE has N transactions, DB has M. Investigate before closing." | ADMIN reviews `tse_transactions` table side-by-side with `transactions`; manual classification of orphans. |
| **TSE INTENTION orphan** (signed locally but never finalized in cloud) | Worker reconciler finds INTENTION older than 1 hour without TRANSACTION | Auto-promote to TRANSACTION + FINISHED in cloud using the locally-signed INTENTION as proof. | Designed-for case; not an error if it happens once a day. |
| **Storno of Ankauf where cash was paid** | Sale type = Ankauf + payment_method = cash + Storno requested | Manual cash drawer count required; reason text mandatory; ADMIN approval. | Accounting impact, not just inventory — `cash_journal` reflects the reversal. |

### 4. Network operational edges (extends ADR-0014)

ADR-0014 covered Tunnel + Tailscale failover and offline mode. These are the **operational** network edges that don't fit the transport ADR:

| Edge | Detection | Mitigation |
|---|---|---|
| **NTP skew** (POS clock off by > 5s) | NTP query on every boot and once per business day | TSE signatures will fail. POS refuses to start sales until clock is reconciled. UX: "Time synchronization in progress." |
| **DNS poisoning / wrong IP** | TLS cert fingerprint mismatch | Tauri's HTTPS client pins the server cert (cert pinning). Rejected connection → banner + alert. |
| **Tailscale auth expired** | `tailscale status` reports not-authenticated | Re-pairing flow via Control Desktop (issue new device token, scan QR, re-authenticate). |
| **Cloudflare cert rotation drops mTLS session** | 503 from Caddy on mTLS layer | Tauri client retries with backoff; if persistent → fallback to Tailscale; if both → offline mode. |
| **Captive portal at venue** | HTTP 302 to unknown host on first request after wake-from-sleep | Detect via probe of `api.warehouse14.de/health`; banner: "Captive portal detected — POS cannot reach cloud. Operating offline." |

### 5. Human edge cases — workflows for the obvious mistakes and the unobvious horrors

#### Forgot PIN

```
Cashier at PIN entry screen → taps "Forgot PIN"
   → POS displays a code (6 digits, expires in 10 min)
   → Cashier calls/messages ADMIN with code
   → ADMIN in Control Desktop: "Reset Cashier PIN" command (remote command per ADR-0014)
       → enters the 6-digit code as a one-shot proof
       → ADMIN's TOTP is required
   → POS receives reset command → cashier sets new PIN on the spot
   → Old session is invalidated everywhere
```

Audit: `cashier.pin_reset` event with full context (which ADMIN approved, from which IP).

#### Mid-sale logout (idle timeout or accidental tap)

Cart state is persisted in local SQLite (`terminal_session_state` table) after every cart mutation. On re-login:

```
"You had an in-progress sale (3 items, €245.50, customer linked) at 14:32.
 [Resume]  [Discard]"
```

`Resume` restores the cart and continues. `Discard` emits `cart.abandoned` event with the items released back to inventory (per ADR-0016).

#### Two cashiers want the same POS

Soft policy: second login displays "Cashier Marie is currently logged in at this terminal. Continue and end her session?" Confirmation kicks her out cleanly (her cart is preserved in `terminal_session_state` for resume on any other terminal). All transitions audit-logged.

#### Duress / robbery — dedicated duress PIN, fired on a background thread

**Initial design (rejected):** "PIN + 1 mod 10 on the last digit." This was elegant on paper but has two failure modes that are unacceptable for a life-safety feature:

1. **Wrap-around ambiguity.** PIN `9999` → duress `0000`. `0000` is on every "common forbidden PINs" blacklist; PIN-entry validators across our stack reject it. A cashier under a gun who types `0000` to signal duress would see a validation error — which is exactly the cue we promised the perpetrator would never see.
2. **Edge-case math under stress.** A cashier whose normal PIN ends in `9` has to remember "wrap to 0" while a gun is pointed at them. That is precisely when the human cognitive bandwidth is at its lowest. We must not introduce arithmetic on the hot path of fear.

**Revised design — dedicated duress PIN.** Each cashier registers **two PINs** during onboarding:

```
Normal PIN  : 4 digits, never written down, used every shift
Duress PIN  : 4 digits, distinct from normal PIN, distinct from common defaults (0000, 1234, etc.)
```

At PIN entry, the validator hashes the input and compares against **both** stored hashes for that cashier:

```ts
type PinValidationResult =
  | { kind: 'invalid' }
  | { kind: 'normal',  cashierId: string }
  | { kind: 'duress',  cashierId: string };

async function validatePin(input: string, cashierId: string): Promise<PinValidationResult> {
  const cashier = await db.cashiers.findById(cashierId);
  // Constant-time comparison against BOTH hashes regardless of outcome.
  // This is critical: timing must not reveal whether the input matched normal or duress.
  const matchesNormal = await timingSafeCompare(hash(input), cashier.normalPinHash);
  const matchesDuress = await timingSafeCompare(hash(input), cashier.duressPinHash);

  if (matchesNormal) return { kind: 'normal',  cashierId };
  if (matchesDuress) return { kind: 'duress',  cashierId };
  return { kind: 'invalid' };
}
```

**Properties of dedicated PINs:**

- No length change ever — same digit count as the normal PIN, no leading-zero edge cases.
- No mathematical relationship between the two PINs — cannot be inferred from the normal PIN if the perpetrator already knows it.
- Cashier remembers a distinct PIN, the same way they'd remember a second-factor code. Onboarding includes practice ("type your duress PIN twice this week so it lives in your fingers").
- Blacklist enforcement: registration rejects duress PINs that are obvious patterns (sequential, repeats, palindrome of the normal PIN).

**The alarm path runs on a separate OS-level thread, never on the UI event loop.** Tauri's IPC layer crosses the JS-Rust boundary; we exploit it deliberately. The cashier's PIN-submit IPC call dispatches into a Rust-side handler that fires off the alarm on a background Tokio task and returns to the UI immediately:

```rust
#[tauri::command]
async fn submit_pin(
  pin: String,
  state: tauri::State<'_, AppState>,
) -> Result<LoginResponse, LoginError> {
  let result = state.pin_validator.validate(&pin).await?;

  // Always write the local audit row FIRST. If the network is dead, the local row
  // is the only evidence the duress event happened. SQLite write is microseconds.
  state.local_db.write_pin_event(&result).await?;

  if let PinValidationResult::Duress { cashier_id, .. } = &result {
    // SPAWN — do NOT await. The alarm runs on a separate Tokio task with its own
    // HTTP connection pool. It will NOT block the response below, will NOT delay
    // the UI's perceived login latency, and will NOT be affected by event-loop
    // congestion in the webview.
    let alarm_payload = build_alarm_payload(cashier_id, &state);
    let alarm_client  = state.duress_alarm_client.clone();   // separate reqwest::Client
    tokio::spawn(async move {
      // Fire to BOTH transports in parallel (Cloudflare Tunnel + Tailscale).
      // First success wins; either succeeding within 60s is acceptable.
      let _ = futures::future::select_ok(vec![
        Box::pin(alarm_client.fire_via_tunnel(&alarm_payload)),
        Box::pin(alarm_client.fire_via_tailscale(&alarm_payload)),
      ]).await;
      // No matter the outcome: do NOT touch the UI. Do NOT log to the webview.
    });
  }

  // CRITICAL: from here down, the code path for normal and duress is IDENTICAL.
  // Same DB writes, same response shape, same latency profile, same animation.
  // Anything else is a leak the attacker can read.
  let session = state.session_manager.create_session(&result.cashier_id()).await?;
  Ok(LoginResponse { session_token: session.token, cashier_name: session.cashier_name })
}
```

**Properties of the threaded alarm:**

1. **Cashier-perceived latency is identical.** The `tokio::spawn` returns in microseconds. The login response is dispatched on exactly the same code path whether normal or duress.
2. **Event-loop congestion in the webview cannot delay the alarm.** Tauri's Rust runtime is a separate Tokio executor; webview blocking has zero effect.
3. **Dual-transport delivery.** Tunnel and Tailscale are raced in parallel; whichever succeeds first is enough. If both fail, the local SQLite audit row remains as the offline evidence; the worker re-attempts on next reconnect.
4. **No log line, toast, or DOM change.** The webview UI knows nothing about the duress branch. There is nothing to leak.
5. **Constant-time PIN comparison.** Both hashes are checked every time; timing reveals neither which PIN matched nor whether the input was valid.

**Behavior after the alarm fires:**

1. Cashier session is created as normal — full privileges to complete the perpetrator's transaction.
2. Control Desktop receives `alert.duress` via SSE (ADR-0014) — full-screen red, sound, the only event that overrides Do Not Disturb mode.
3. Optional SMS / Telegram (per Basel's configuration) is dispatched in parallel by the same background task.
4. Cashier's normal POS flow continues. No banner, no badge, no cue.

The whole cashier flow continues normally — the perpetrator gets what they came for; the help gets notified. **Lives over inventory.** Always.

**Onboarding requires ADMIN opt-in.** Some operators consider duress signals risky if the response could escalate the situation; we default to **disabled** and provide a one-line setting that enables it per cashier. The cashier knows whether their dedicated duress PIN will trigger an alert; they are never put in the position of triggering an alarm without knowing the rules.

#### Cashier walked away from a logged-in terminal

Idle detection (memory.md §5: useIdleTimeout cherry-pick from Oliver):

```
> 5 minutes idle with no cart  → screen lock (cashier re-enters PIN to unlock)
> 10 minutes idle with active cart → cart saved, session ended, audit event emitted
```

### 6. Compliance edge cases — AML, sanctions, and high-value workflows

GwG (anti-money-laundering) is encoded in ADR-0007. This section operationalizes the parts that involve the cashier's runtime decisions.

| Scenario | Threshold | UX intervention |
|---|---|---|
| **High-value Verkauf** | total ≥ €10,000 cash | Modal: "Enhanced due diligence required. Capture KYC + source-of-funds question + ADMIN approval." Cashier cannot finalize until all three completed. |
| **High-value Ankauf** | total ≥ €2,000 cash (per ADR-0007 always-ID policy applies from €0.01; €2k is GwG enhanced-due-diligence) | Source-of-acquisition question for the seller. Photo of any provenance documents. |
| **PEP (Politically Exposed Person) match** | KYC name match against EU PEP list | Block sale until ADMIN reviews and approves. Manual research required. |
| **Sanctions match** | KYC name/DOB match against EU Consolidated List (or OpenSanctions feed) | **Hard block.** Sale cannot proceed. Alert ADMIN + Steuerberater notification. |
| **Cumulative-spend threshold** | Same customer aggregates ≥ €15,000 in 12-month rolling window | Enhanced due diligence triggered at the moment the threshold is crossed. UI shows "This customer's cumulative spend reaches enhanced DD — additional KYC fields appear." |
| **Smurfing pattern** | > 3 Ankauf transactions just below €2,000 in 7 days from same customer | Cashier-facing warning + ADMIN notification. Sale may proceed only with ADMIN approval. (Smurfing detection mid is ADR-0007's mandate; this is its runtime surface in POS.) |
| **Cross-border indicator** | Customer's ID issued by FR or CH | Soft flag (Weil am Rhein has legitimate cross-border traffic). Logged for trend visibility, not blocking. |

**Sanctions feed** is `opensanctions.org`'s free API for V1; refreshed daily into local lookup table for offline lookups. Production-grade integration with WorldCheck/Refinitiv is Phase 2+.

### 7. Smart Appointment integration — POS as the cashier's daily companion

This section specifies the **POS-side** of the Smart Appointment System. The full design (schema, booking flow, reminders, multi-staff capacity, recurring viewings, customer-portal booking) lives in **ADR-0020 (pending)**. Here we lock down how the POS surfaces appointment context to the cashier in real time.

#### Appointment types the POS must recognize

| Type | Purpose | POS surface |
|---|---|---|
| `VIEWING` | Customer wants to inspect specific items | Linked products list (creates soft holds per ADR-0016 §6). |
| `BUYBACK_EVAL` | Customer brings items for evaluation | Pre-prepared Ankauf flow with scale + KYC ready. |
| `CONSULTATION` | General inquiry, no specific items | Customer profile pulled up; no inventory linkage. |
| `PICKUP` | Customer placed a storefront order, picks up in shop | Order details pre-loaded; receipt ready to print. |

#### The "Next Hour" panel — always visible on POS

A persistent strip in the POS UI shows the next 60-minute window of appointments at that shop:

```
┌──────────────────────────────────────────────────────────────────────┐
│  14:45 (in 13m)  Mr. Schmidt          VIEWING                       │
│                  3 items linked (Goldring 585, Münze, ...)          │
│                                                                      │
│  15:30 (in 58m)  Frau Becker          BUYBACK_EVAL                  │
│                  brought items: estate jewelry, ~12 pieces          │
└──────────────────────────────────────────────────────────────────────┘
```

Driven by SSE events (ADR-0014). No polling.

#### Customer arrival — one-tap check-in

When the customer arrives, the cashier taps their row in the Next-Hour panel:

```
Tap → Customer profile opens (KYC if Ankauf type, history, linked items)
    → Status changes to "CHECKED_IN" (visible to ADMIN in Control Desktop)
    → If VIEWING type: linked products are pre-loaded in a "ready to demo" tray
    → If BUYBACK_EVAL: scale calibration check + KYC capture prompt
    → If PICKUP: order details + receipt preview ready
```

The check-in event also fires a `appointment.checked_in` ledger event (ADR-0008). Time-stamps for SLA tracking.

#### No-show handling

```
appointment_start + 30 min, no check-in detected
    → appointment.status = 'NO_SHOW' (auto-emitted by worker job, not the POS)
    → All soft viewing-holds for this appointment released (per ADR-0016 §6)
    → WhatsApp template message sent: "We missed you today — rebook anytime."
    → Recorded in customer's profile (used by smart booking to flag "X has missed 2 appointments in 6 months" for future scheduling — handled in ADR-0020).
```

The 30-minute grace is a configurable system setting (`system_settings.appointment_grace_minutes`).

#### Walk-in interaction with appointment-held items

If a walk-in wants to buy a product with an active soft viewing-hold, ADR-0016 §6's policy applies: cashier sees the warning, decides knowingly, walk-in wins with `product.soft_hold_overridden_by_walk_in` ledger event, the appointment holder is notified via WhatsApp template.

If the appointment holder shows up after their items were sold to a walk-in: ADMIN receives a Control Desktop ticket for graceful handling. Pre-approved templates: apology + 10% discount on next purchase + ranked-similar items.

#### Early arrival (before appointment_start)

```
Customer arrives 15 minutes early → cashier sees Next-Hour panel highlight + check-in option.
Tap check-in → appointment.status = 'CHECKED_IN'; early_arrival_minutes recorded.
Cashier prepares early; ADMIN sees in real time on Control Desktop.
```

#### Late arrival (after appointment_start but before grace)

```
Within 30 min window → still appears in Next-Hour panel (now in red).
Check-in works the same way.
late_arrival_minutes recorded.
```

#### Cashier-initiated appointment booking from POS

Some customers prefer to book in-shop after browsing. The POS exposes a quick "Book a viewing" button:

```
Tap → Select item(s) → Select customer (existing or quick-add) → Select date/time slot
    → Soft hold created; ledger event emitted; WhatsApp confirmation sent (if customer phone known).
```

This unifies the booking surface — owner from Control Desktop, customer from storefront, cashier from POS — all produce the same canonical appointment record.

### 8. The local resilience invariant — "POS never stops selling"

Worst-case scenario:

> Cloud down. Fiskaly down. Tailscale down. Tunnel down. Power blip ten seconds ago. Customer at the counter holding a €500 gold coin.

The POS must:

1. **Continue accepting the sale.** UI shows a calm "Offline mode" banner. No spinners, no "please wait."
2. **Sign the TSE INTENTION locally** with the last-cached cert (renewed pre-emptively when online).
3. **Print the receipt** with a clear "OFFLINE — pending sync" footer (GoBD-compliant; receipt still has all mandatory fields).
4. **Persist the transaction** in local SQLite with full payload.
5. **Reconnect-and-sync** on first cloud reachability. Pending TSE signatures, ledger events, payment confirmations all replay in order. Conflicts (e.g. inventory was sold via Storefront during the offline window) trigger ADR-0016's compensation workflow.

The discipline that makes this work:

- The local SQLite schema is a **strict subset** of the cloud Postgres schema, generated from the same Drizzle source.
- Replay is **idempotent** — every transaction has a UUID assigned at the POS, used as the primary key in both local and cloud DBs.
- Replay order is **strict** — local SQLite has a monotonic `local_seq` that determines replay order on reconnect.
- **Conflict detection** runs at replay: if a product replay finds the cloud already marked it SOLD via another channel, compensation kicks in (refund the customer if they paid, escalate to ADMIN, do not silently override).

### 9. Diagnostics & recovery workflows in Control Desktop

Every edge case above surfaces a corresponding tool in Control Desktop:

```
Recovery Center (ADMIN-only panel):
  ├─ Hardware status (per terminal, per device)
  ├─ TSE queue (depth per terminal + last sync time)
  ├─ Pending receipt reprints (per terminal, with age)
  ├─ Failed Storno reviews
  ├─ AML alerts pending review
  ├─ Sanctions matches (hard blocks for ADMIN unblock)
  ├─ Duress events (with timestamps, terminal, cashier)
  ├─ Double-sale compensations (per ADR-0016 §8)
  └─ Appointment exceptions (no-shows, walk-in overrides, etc.)
```

Every action in this panel produces a ledger event. The owner can reconstruct any operational decision years later.

### 10. Telemetry — what the dashboard must show

Operator-facing metrics (in Control Desktop's Bridge view):

- **Per-terminal hardware health** (green/yellow/red chips per device)
- **TSE queue depth per terminal** (graph)
- **Time-to-reprint** (median, p95) for pending receipts
- **AML alerts open count**
- **Today's appointment compliance** (% checked-in on time, % no-show, % overridden by walk-in)
- **Local offline events** (count of sales completed offline today, with terminal breakdown)

Engineering-facing metrics (Prometheus, alerts):

- `tse_sync_lag_seconds`, `tse_offline_intentions_pending`, `cash_drawer_overrides_per_day`, `printer_reprints_pending`, `appointment_no_show_rate`, `duress_events_total`, `sanctions_blocks_total`.

## Consequences

**Positive:**
- The shop has a documented response for every failure mode the team can foresee. New cashiers can be trained in a day because the POS itself surfaces the right action for the right edge case.
- GoBD compliance is preserved across all failure modes; receipts are issued, TSE signatures replay, audit trail is unbroken.
- The duress workflow gives a safety mechanism that costs nothing in normal operation and saves a life in the worst case.
- AML / sanctions blocks happen at the right moment in the flow (during KYC) and present a clear escalation path (ADMIN review), not a silent rejection the cashier has to explain.
- Appointments are first-class in the cashier's daily flow — preparation happens automatically, no-shows have a graceful release path, walk-ins-vs-appointments have a documented adjudication.
- The local resilience invariant lets Basel sleep at night: the shop will not embarrass itself because the cloud blinked.

**Negative:**
- The matrix of edge cases is large. Onboarding documentation is correspondingly long; we mitigate via short, focused training videos (one per category) rather than a wall-of-text manual.
- Sanctions feed introduces a daily-update dependency. If `opensanctions.org` is unavailable the lookup falls back to the locally-cached snapshot (acceptable for hours; alert ADMIN if > 24h stale).
- Duress PIN can be triggered accidentally (typo). Mitigation: the alert is "ADMIN visual + sound, optional SMS" — by default no police call, configurable per operator preference. False positives produce a Control Desktop confirmation step.
- Cross-day Storno is rare but operationally fiddly. Documented with a runbook + integration tested.

**Mitigations:**
- Onboarding flow has a "Try the edge cases" module — simulated paper-out, simulated TSE outage, simulated scale failure — so a new cashier sees the UX once before encountering it for real.
- Daily reconciliation report (auto-generated, lands in Control Desktop) summarizes every edge case event from the day; ADMIN reviews trends.
- The duress PIN can be disabled per-cashier if they prefer not to carry that responsibility.
- A weekly "Recovery drill" is added to the operations checklist: simulate one outage, run the documented recovery, time it. Drives muscle memory.

## Alternatives considered

- **Block the sale on any hardware degradation.** Rejected. We lose customers and break the "never stops selling" invariant for an aesthetic ideal.
- **No duress PIN.** Rejected. Cost of inclusion is zero in normal operation; benefit in the worst case is non-zero. Default off, configurable on.
- **Manual sanctions lookup instead of automated.** Rejected — the cashier should not be expected to recall 50,000+ sanctioned names. Automated lookup with manual override on ambiguous matches is the right balance.
- **Hard reservation for all viewing appointments.** Rejected (per ADR-0016 §6 alternative analysis). Bad business for soft-value items.
- **Separate POS UI mode for "offline."** Rejected. The cashier should not need to think about whether they're online — the UI continues to work; only the banner changes. A separate mode would invite mistakes ("I forgot we were offline").
- **WebSocket bidirectional channel for hardware events.** Rejected. Tauri IPC + local subscriptions are simpler; no benefit to introducing a WebSocket framing layer for in-process events.

## Known limits & deferred decisions

1. **Full Smart Appointment System (ADR-0020).** This ADR specifies the POS-side surface only; booking flow, multi-staff capacity, recurring appointments, customer-portal booking, and the morning-briefing integration live in ADR-0020.
2. **Hardware vendor-specific quirks.** Each ZVT terminal model, each scale brand, each printer model has its own quirks. V1 supports one specific model per device class (selected with Basel during Phase 1 procurement); broader support is Phase 2+.
3. **Sanctions feed reliability.** OpenSanctions is community-maintained; a paid-tier feed (WorldCheck, Refinitiv) is the production upgrade path for Phase 2+.
4. **Multi-cashier-shift hand-off.** V1 assumes one cashier per terminal at a time; structured hand-off (cash counter reconciliation between shifts) is Phase 2+.
5. **Hardware failover** (two printers, two scales). V1 has one of each per terminal. Redundant hardware is Phase 2+.
6. **POS firmware update process.** V1 uses Tauri's signed auto-update channel. Rollback path needs a documented runbook for Phase 1 go-live.
7. **Customer-arrived-without-appointment buyback.** V1 supports it (standard Ankauf flow). Phase 2+ could add a "queue management" feature if walk-in volume warrants.

## References

- ADR-0007 — GwG always-ID Ankauf policy (this ADR operationalizes the AML side)
- ADR-0008 — Schema; every recovery action emits ledger events
- ADR-0014 — Network transport (this ADR adds operational network edges on top)
- ADR-0016 — Inventory lock (POS interacts via the lock, including soft-hold conflict resolution)
- ADR-0020 (pending) — Smart Appointment System (full schema, booking flow, reminders, capacity)
- §146a AO — Belegausgabepflicht (receipt issuance obligation)
- GwG §§ 10 ff. — enhanced due diligence thresholds
- OpenSanctions — https://www.opensanctions.org
- Oliver Roos cherry-picks: `hooks/useIdleTimeout.ts`, `lib/sessionAuth.ts` (PIN handling), `pages/Reconcile.tsx` (Storno / Kassensturz patterns), `backend/src/modules/hardware/zvt.ts` (ZVT terminal adapter)
- `docs/memory.md` §3 ("TSE — network-resilient"), §5 (cherry-picks)
