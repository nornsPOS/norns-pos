# ADR-0019 — The Bridge: cognitive-load-disciplined UX for the owner's command center

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Technik
- **Related:** ADR-0009 (the Tauri app this UX lives inside), ADR-0014 (the SSE event stream that powers the live feed), ADR-0010 (Morning Briefing über das frühere Kanal-Gateway, ausgezogen), ADR-0016 + ADR-0018 (every business event surfaces here), ADR-0020 (appointments are a first-class panel here), `docs/memory.md` §2 #30 #33.

## Context

Basel's "Bridge" is the screen he opens at 09:00 and glances at 50 times a day. If the design fails — too noisy, too dense, too many surprises — he stops trusting it; once he stops trusting it, every alert becomes background noise and the entire investment in mTLS + SSE + AI is wasted.

The design philosophy is **cognitive load discipline.** Each screen must answer one question in under 2 seconds:

- **Bridge view:** "Is anything wrong?"
- **Sales panel:** "How's today going?"
- **Inbox panel:** "Who needs me?"
- **Drafts panel:** "What's waiting for my approval?"
- **Appointments panel:** "Who's coming and what do they want?"

This is **not** an admin dashboard — Salesforce, Zoho, SAP all give you 47 widgets and a search bar and call it productivity. The Bridge gives Basel five things at a glance and a path to any deep dive in one click.

The proactive layer matters more than the reactive: the Morning Briefing, Anomaly Watchdog, Approval Queue, and End-of-Day mode are not "nice-to-haves." They are the difference between Basel feeling **in command** and Basel feeling **buried**.

Constraints:

1. **Single primary screen** — the "Bridge" — always one keyboard-shortcut away.
2. **Progressive disclosure** — Bridge shows summaries; click for deep dive.
3. **No modal interruptions** for routine work. Modals only for destructive confirmations.
4. **Sound discipline** — silent by default; only `severity=high` events make sound.
5. **Color discipline** — red / yellow / green for state, never decorative.
6. **No notification interrupts an in-progress text input.** Queue and dispatch when idle.
7. **End-of-day mode** — one click closes the loop and pauses non-critical noise.
8. **Cherry-picked Luxury* aesthetic from Oliver** (memory.md §5) — generous whitespace, fluid typography, no `backdrop-blur`.

## Decision

### 1. The Bridge — three-pane layout, always rendered

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Warehouse14 Bridge                       🟢 Nominal · 14:32 · Today    │
├────────────────┬─────────────────────────────────┬────────────────────────┤
│                │                                  │                        │
│  ALERTS        │  LIVE FEED                      │  QUICK ACTIONS         │
│  ────────      │  ────────                       │  ────────              │
│  🔴 0          │  14:32  Sale €1,250  Marie     │  📥 Intake Drafts  (3) │
│  🟡 2          │         Customer: anon (Verk.)  │  💬 Inbox          (7) │
│  🟢 18         │                                  │  🎯 Approvals       (1)│
│                │  14:28  KYC captured · Marie    │  📅 Appointments       │
│  ────────      │         Customer #4521          │     ↳ Next:  14:45     │
│                │         Ankauf €450             │     ↳ Today: 4         │
│  WATCH         │                                  │                        │
│  ─────         │  14:25  Draft ready: Goldring  │  ────────              │
│  • TSE cert    │         585 18mm Filigree      │                        │
│    expires 14d │                                  │  🤖 Bot                │
│  • Reconciler  │  14:20  Sale €87  Marie  cash  │     ↳ Active: 3        │
│    queue dep.: │                                  │     ↳ Awaiting        │
│    3 skipped   │  14:14  Appointment checked-in │       human: 2         │
│    last hour   │         Mr. Schmidt · VIEWING  │                        │
│                │                                  │  ────────              │
│                │  …                              │                        │
│                │                                  │  📊 Today              │
│                │                                  │  €4,250 · 12 sales    │
│                │                                  │  3 Ankauf · €1,800   │
│                │                                  │  ────────              │
│                │                                  │  🌙 End-of-day        │
│                │                                  │                        │
└────────────────┴─────────────────────────────────┴────────────────────────┘
```

Each chip in the left rail (alerts) and right rail (quick actions) is clickable → opens the corresponding deep-dive panel (full screen, side-slides in, `Esc` to return). The center feed is the always-on chronological log driven by SSE.

The header shows three things and nothing else: overall system status, current Berlin time, scope ("Today" / "This week" / "Custom range" — click to change).

### 2. Component hierarchy — atoms / molecules / organisms (cherry-picked Luxury* family)

We adopt the atomic-design layout from Oliver's `frontend/src/components/` (memory.md §5), reimplemented in Next.js with Tailwind v4 + shadcn/ui primitives:

```
apps/admin-web/src/components/
├── atoms/
│   ├── LuxuryToggle.tsx              # cherry-picked + light refactor
│   ├── LuxuryButton.tsx              # buttons with the editorial typography
│   ├── PinPad.tsx                    # used for in-app PIN re-entry
│   └── StatusDot.tsx                 # 🟢🟡🔴 with accessible label
├── molecules/
│   ├── BentoCard.tsx                 # the chip pattern in the rails
│   ├── EventRow.tsx                  # one row of the live feed
│   ├── AlertChip.tsx                 # left-rail alert items
│   ├── QuickActionTile.tsx           # right-rail action tiles
│   └── SkeletonCard.tsx              # loading states
├── organisms/
│   ├── Bridge.tsx                    # the three-pane root
│   ├── LiveFeed.tsx                  # center column
│   ├── AlertRail.tsx                 # left rail
│   ├── QuickActionsRail.tsx          # right rail
│   ├── MorningBriefingBanner.tsx     # 09:00 collapsible header
│   ├── CommandPalette.tsx            # ⌘K palette
│   └── EndOfDayWizard.tsx
└── panels/                           # deep-dive screens (route-level)
    ├── SalesPanel.tsx
    ├── InboxPanel.tsx
    ├── DraftsPanel.tsx
    ├── AppointmentsPanel.tsx
    ├── InventoryPanel.tsx
    ├── TerminalsPanel.tsx
    └── InsightsPanel.tsx
```

**Aesthetic constraints (locked in code via design tokens):**

- No `backdrop-blur` (memory.md performance constraint inherited from Oliver salon Mac).
- Generous whitespace: `12-16px` minimum padding between sections, `24-32px` between rails.
- Editorial typography (cherry-picked `lib/editorialTheme.ts`): serif display for numbers and panel titles, sans-serif body. Fluid scale via `clamp()` for 21" salon displays and small laptops alike.
- Motion: `motionPresets.ts` cherry-pick — short (180ms) easings, no decorative animation.

### 3. State management — TanStack Query (server cache) + Zustand (client state)

Per memory.md #16, the same combo we already use elsewhere. Specifically for the Bridge:

| Concern | Tool |
|---|---|
| Live feed events (last 100 in memory) | Zustand store `liveFeedStore` — appended to from the SSE subscriber |
| Alerts list | Zustand store `alertsStore` — derived from live feed + pull queries |
| Quick-action counts (drafts, inbox, approvals) | TanStack Query — cached 30s, refetched on SSE invalidation event |
| Today's summary numbers | TanStack Query — cached 60s, refetched on SSE invalidation |
| Per-panel deep-dive data | TanStack Query — standard fetch + cache |
| Command palette index | Zustand — lazy-loaded once + invalidated on inventory mutations |
| Bridge layout preferences (collapsed rails, panel order) | Zustand + `localStorage` persistence |

The SSE subscriber lives in the Tauri Rust side (per ADR-0009 §6) and forwards events to the webview via Tauri's event bus. A single hook `useLiveEvents()` exposes a typed callback registration for any component that needs to react.

### 4. Smart Attention Router — two-tier model: routine queues one-at-a-time, critical stacks

The principle is **two-tier** (refined per Basel's 2026-05-23 review). Routine work respects single-display discipline; disaster scenarios get critical-stacking so that life-safety + fiscal-safety signals never wait their turn.

#### Tier A — Routine (severity `low` / `normal` / `high`): one at a time, queued by priority

The owner sees at most **one** routine toast / banner at any moment. Multiple routine items queue, sorted by priority, FIFO within a priority band. Suppressed during active typing (§8 Distraction Discipline). Suppressed during Do-Not-Disturb mode (§9 End-of-Day).

#### Tier B — Critical (severity `critical`): stack on top of everything, no queue, no suppression

Critical events are **rare** and **must never wait**. Examples: duress alarm (ADR-0018 §5), sanctions hard match (ADR-0018 §6), fiscal emergency (TSE down + cash sale attempted, hash chain verification failure), high-value approval timeout. These bypass:

- The single-display rule — multiple critical events render simultaneously as a stack.
- The typing guard — they appear over an in-progress text field with no debounce.
- Do-Not-Disturb mode — the owner is asleep, but the gun pointed at the cashier doesn't care.
- The audio discipline — each critical fires its assigned sound; if three fire in 5 seconds, the owner hears three distinct sounds.

The critical stack renders in a dedicated zone at the top-right of the Bridge, **above** the routine toast lane. Each critical card requires explicit acknowledgement (click or keyboard `A` while focused) — they do not auto-dismiss on a timer. Acknowledgement writes a `ledger_events` row capturing who-when-what.

```ts
// apps/admin-web/src/lib/attentionRouter.ts (sketch — refined Basel 2026-05-23)
type Severity = 'critical' | 'high' | 'normal' | 'low';

type Notification = {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  action?: { label: string; href: string };
  source: 'sse' | 'local';
  receivedAt: Date;
  requiresAck?: boolean;            // critical defaults to true
};

class AttentionRouter {
  private routineQueue: Notification[] = [];
  private currentRoutine: Notification | null = null;
  private criticalStack: Notification[] = [];     // many concurrent, ordered by receivedAt
  private userIsTyping = false;
  private dndUntil: Date | null = null;

  enqueue(n: Notification) {
    if (n.severity === 'critical') {
      // Tier B — stack, bypass everything.
      n.requiresAck = n.requiresAck ?? true;
      this.criticalStack.push(n);
      this.criticalStack.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());  // oldest at top
      playCriticalSoundFor(n);                     // bypasses DND
      renderCriticalStack(this.criticalStack);     // renders all concurrent criticals
      return;
    }

    // Tier A — routine path with queue + suppression.
    if (this.dndUntil && new Date() < this.dndUntil) return;
    this.routineQueue.push(n);
    this.routineQueue.sort(byPriorityThenTime);
    this.pumpRoutine();
  }

  acknowledgeCritical(id: string, actorUserId: string) {
    const idx = this.criticalStack.findIndex(n => n.id === id);
    if (idx < 0) return;
    const acked = this.criticalStack[idx];
    this.criticalStack.splice(idx, 1);
    renderCriticalStack(this.criticalStack);
    emitLedgerEvent({
      event_type: 'attention.critical_acknowledged',
      entity_id: acked.id,
      actor_user_id: actorUserId,
    });
  }

  private pumpRoutine() {
    if (this.currentRoutine) return;
    if (this.userIsTyping) {
      onInputIdleOnce(() => this.pumpRoutine());
      return;
    }
    const next = this.routineQueue.shift();
    if (!next) return;
    this.currentRoutine = next;
    showRoutineToast(next, () => { this.currentRoutine = null; this.pumpRoutine(); });
  }
}
```

#### Critical-stack visual model

```
┌────────────────────────────────────────────────────┐
│  🔴 CRITICAL — Duress alarm at POS-2 (Marie)       │
│     14:32:08 · ack required                        │
│     [ Acknowledge & Open ]                         │
├────────────────────────────────────────────────────┤
│  🔴 CRITICAL — Sanctions match (Mr. X.)            │
│     14:32:09 · ack required                        │
│     [ Acknowledge & Open ]                         │
└────────────────────────────────────────────────────┘
            ← routine toast lane below →
```

The owner sees both at once, can acknowledge each independently, and the system has an audit trail of exactly when each was seen and resolved. Hardcoded eligible critical event types (the only events that can promote to `severity = 'critical'`) are listed in `apps/api-cloud/src/lib/events/severity.ts`:

```ts
const CRITICAL_EVENT_TYPES = [
  'alert.duress',
  'alert.sanctions_match',
  'alert.smurfing_detected',          // when hits the absolute-block threshold
  'alert.hash_chain_verification_failed',
  'alert.tse_critical_failure',       // local cert expired AND offline INTENTION queue overflow
  'alert.fiscal_health_red',
  'transaction.high_value_pending_approval.timeout',  // auto-rejected at TTL
] as const;
```

The list is reviewed in every PR; promotion of any new event type to critical requires an explicit ADR amendment.

This is the only path by which a toast / banner / stacked critical ever appears. Components do not call `toast.show()` directly — they call `attention.notify(n)`. ESLint rule `no-direct-toast-call` enforces this in CI.

### 5. Morning Briefing — automatisch erzeugt, scheduled, collapsible

Every weekday at 09:00 (configurable in settings), a worker job assembles structured input (yesterday's totals, today's pending drafts/inbox/approvals, today's appointment list, low-stock items, expiring certs, LBMA price snapshot) and calls `gateway.tasks.composeBotReply` with a "morning briefing" prompt. The output is stored in `morning_briefings` table and pushed to all active Control Desktops via SSE.

Bridge displays it as a **collapsible banner above the live feed**, dismissable. Default expanded on first open of the day; auto-collapses after first dismiss or 30 min.

Example output:

```
صباح الخير. اليوم عندك:
• 3 drafts بانتظار موافقتك (intake bot من أمس بعد 18:00)
• 1 طلب eBay وصل في الليل — Goldmünze 1oz Krügerrand €1,890
• تذكير: Steuerberater يحتاج DSFinV-K export قبل الأربعاء
• Marie تبدأ في 09:30 (per schedule)
• سعر الذهب اليوم €58.42/g (LBMA Vormittagsfix)
• 4 مواعيد اليوم — أولها 14:45 Mr. Schmidt VIEWING
```

The brief is Arabic by Basel's preference (`users.preferred_language`); other ADMINs would receive German or English.

### 6. Anomaly Watchdog — moving averages + standard deviations, no heavy ML

A background worker job (`apps/worker/src/jobs/anomaly-watchdog.ts`) runs every 15 minutes and computes simple statistics over the last 30 days of transactions per cashier, per shop, per hour-of-day:  ⟵ geloescht am 14.08.2026: der Arbeiter gehoerte zu warehouse14

- Today's cash-sale count vs 30-day median for the same hour-of-day-of-week
- Today's average ticket vs 30-day median
- Per-customer cumulative spend vs the customer's own 6-month baseline
- Per-cashier sale velocity (sales/hour) vs 30-day baseline

When any signal exceeds **±σ × `system_settings.anomaly.sigma_threshold`** of its baseline (default `3.0`, ADMIN-tunable between `2.0` and `4.0` from the Bridge Settings panel — see below), an `alert.anomaly` event is emitted (severity `normal`) with a structured explanation:

```json
{
  "alert_type": "cash_sales_anomaly",
  "signal": "today's cash sale count by 14:00 is 3.2× the 30-day median for Saturday",
  "values": { "today": 9, "baseline_median": 2.8, "stddev": 1.1 },
  "suggested_check": "Is this a known walk-in surge, or worth a closer look?"
}
```

This is **not machine learning.** It's z-score statistics. The code is 80 lines, deterministic, and reviewable. If the signal-to-noise becomes a problem, we add per-signal sensitivity tuning before reaching for an actual model.

#### Sigma threshold — ADMIN-tunable from the Bridge

`system_settings` carries the global threshold + optional per-signal overrides:

```sql
-- Seeded at migration 0011_closing.sql
INSERT INTO system_settings (key, value) VALUES
  ('anomaly.sigma_threshold',                         '3.0'),     -- global default
  ('anomaly.sigma_threshold.cash_sales_count',        NULL),       -- per-signal override; NULL inherits global
  ('anomaly.sigma_threshold.average_ticket',          NULL),
  ('anomaly.sigma_threshold.customer_cumulative_spend', NULL),
  ('anomaly.sigma_threshold.cashier_sale_velocity',   NULL);

-- Constraint: any non-null override must lie in [2.0, 4.0].
-- Enforced by application layer and a daily CI check that asserts current values.
```

The Bridge Settings panel exposes a small slider per signal: **More sensitive (2.0σ) — Default (3.0σ) — Less noisy (4.0σ)**. Changing the value writes `system_settings`, emits a `system.anomaly_threshold_changed` ledger event, and takes effect on the next watchdog tick (≤15 min). The watchdog reads the threshold per signal per tick — no daemon restart required.

Why ADMIN-tunable: the right threshold is empirical. Single-shop volume means standard deviation is wide; the first three months will tell Basel whether ±3σ over-alerts or under-alerts. The slider is the regulator; the code stays simple.

**Hard floor and ceiling.** Values outside [2.0, 4.0] are refused at write time. Below 2.0 the alert volume is unreadable; above 4.0 the watchdog effectively silences itself. Both extremes have been observed as anti-patterns in operations forums; the constraint protects the owner from himself.

Critical anomalies hook into the smurfing detection from ADR-0007:

- Same customer with > 3 Ankauf transactions just under €2,000 in 7 days
- Multiple customers within a short window with sequential ID number patterns

These produce `alert.smurfing_suspected` events (severity `high`) that surface via the Attention Router and require ADMIN acknowledgement before clearing.

### 7. Approval Queue — high-value sales waiting for ADMIN

Per ADR-0018 §6, sales above configurable thresholds (€10,000 cash, €15,000 cumulative-spend) pause at the POS terminal and post a `command.approval_requested` event. The Bridge renders these as a top-of-rail card:

```
┌─────────────────────────────────────────────────────────┐
│ ⏸  POS-2 (Marie) — Sale €12,500 (gold bar 100g)         │
│    Customer: Mr. Mustermann (KYC complete since 2025-03)│
│    Source-of-funds answered: ✓ Inheritance              │
│    Sanctions: ✓ No match                                │
│    PEP:       ✓ No match                                │
│    Pending: 47s                                         │
│                                                          │
│    [ ✓ APPROVE ]   [ ✗ REJECT ]   [ 💬 Ask cashier ]    │
└─────────────────────────────────────────────────────────┘
```

Approval requires a fresh WebAuthn touch (Touch ID / Windows Hello) — not just a click — to prevent shoulder-surfing approval. Rejection requires a reason field. Both produce a `command.dispatched` event back to the POS (ADR-0014 §6) and a `ledger_events` row with the full decision context.

### 8. Distraction Discipline — never interrupt active input

A small hook `useInputActivity()` listens for `input`, `keydown`, and `compositionupdate` events on form fields and reports "user is typing" state to the Attention Router. While the user is typing:

- No toasts appear.
- Non-critical notifications queue silently in the alert rail (visible without modal interruption).
- Critical notifications (duress alarm, fiscal emergency) bypass this guard — life-safety overrides.

The router resumes dispatching 10 seconds after the last input event (debounced). The owner never has a toast pop over their half-typed reply to a customer.

### 9. End-of-Day mode — one click closes the day

The right-rail "🌙 End-of-day" tile opens a wizard:

```
End-of-day · 18:45 · Wednesday

Today's totals:
   Revenue: €4,250 (12 sales, 3 Ankauf)
   Cash drawer expected: €1,830 — count?  [____]
   
   ▢ Daily TSE archive: 12 transactions signed ✓
   ▢ DSFinV-K export ready for Steuerberater
   ▢ External Fortress Backup: today's incremental ✓

Outstanding:
   1 draft pending review     [ Review now ]
   2 unread inbox messages    [ View ]
   No remaining appointments today
   
[Confirm end-of-day]   [Cancel]
```

On Confirm:

1. Triggers daily closing (Z-report, cash reconciliation, DSFinV-K export emailed to Steuerberater).
2. Generates the AI day-summary (`gateway.tasks.composeBotReply` with day-summary prompt).
3. **Enters Do-Not-Disturb mode until tomorrow 09:00** — only `severity=critical` notifications break through (duress, fiscal emergency).
4. Writes `ledger_events` row `system.day_finalized` carrying the chain's checkpoint hash (per ADR-0008's verification optimization).

The owner closes the laptop knowing the day is closed.

### 10. Color, typography, sound — strict discipline tokens

`apps/admin-web/src/styles/tokens.css`:

```css
:root {
  /* status colors — never decorative */
  --color-status-ok:       #16a34a;
  --color-status-watch:    #ca8a04;
  --color-status-alert:    #dc2626;
  --color-status-info:     #2563eb;

  /* neutrals (editorial palette) */
  --color-bg:              #fafaf9;
  --color-surface:         #ffffff;
  --color-text-primary:    #1c1917;
  --color-text-secondary:  #57534e;
  --color-divider:         #e7e5e4;

  /* typography */
  --font-display:          'Cormorant Garamond', Georgia, serif;
  --font-body:             'Inter', system-ui, sans-serif;
  --font-numeric:          'Cormorant Garamond', tabular-nums;

  /* sizing — fluid */
  --size-display:          clamp(2rem, 4vw, 3.5rem);
  --size-headline:         clamp(1.25rem, 2vw, 1.75rem);
  --size-body:             clamp(0.95rem, 1.1vw, 1.05rem);
  --size-caption:          clamp(0.8rem, 0.95vw, 0.9rem);
}
```

Sound: a single soft chime for `severity=high`, distinct lower-pitched tone for `severity=critical`. `severity=normal` and below: silent. The Attention Router enforces the rule; no component plays audio directly.

### 11. Empty, loading, error states — designed, not afterthoughts

Every panel has explicit states:

- **Empty state** with friendly copy + a primary CTA ("No drafts to review yet · Pipeline status: 🟢 healthy")
- **Loading state** with SkeletonCard atoms (no spinner — spinners signal "broken" in our aesthetic)
- **Error state** with retry CTA + automatic retry on reconnect + escalation to Inbox if persistent
- **Offline state** with banner indicating which data is from cache vs live, and which actions are blocked

### 12. Accessibility — keyboard-first, screen-reader-correct, WCAG AA contrast

- Full keyboard nav: Tab through panels, Enter to open, Esc to close, arrow keys within lists.
- ARIA roles on rails, feeds, dialogs.
- Color contrast ≥ 4.5:1 for body text (status colors meet AA on the neutral background).
- Focus rings always visible (no `outline: none`).
- Screen reader labels for status dots: "🟢 Connected" → `<span role="status" aria-label="System status: connected">🟢 Connected</span>`.
- Tested against NVDA on Windows and VoiceOver on macOS in CI (Playwright a11y assertions).

### 13. Voice mode UX slot (Phase 2)

The architecture leaves a place for voice — a push-to-talk button in the header that, when held, captures audio via Tauri's microphone permission and runs local speech-to-text, then routes the text to the command palette's intent matcher. Not in V1; the slot is there. (Das frühere Kanal-Gateway ist am 19.08.2026 ausgezogen.)

## Consequences

**Positive:**
- The owner gets a single, calm screen from which the entire business is visible at a glance.
- The four proactive layers (Morning Briefing, Anomaly Watchdog, Approval Queue, End-of-Day) shift Basel from reactive firefighting to deliberate command.
- Distraction Discipline ensures the system never gets in the way of the work the owner is doing inside it.
- Cherry-picked Luxury* aesthetic gives the app a brand-aligned visual identity from day one — no "default shadcn" look.
- Accessibility-first design accommodates future hires, vision changes, and EU accessibility regulations.

**Negative:**
- Five panels is the right number for V1; if Basel finds he needs more (e.g. a dedicated "Suppliers" or "Marketing" panel), they need to fit into the rails-and-feed model. We resist adding tabs that break the bridge metaphor.
- The Anomaly Watchdog at single-shop scale is statistically weak (low data volume → wide sigma). False positives in the first 6 months are expected; tuning is a Phase 1.5 ongoing task.
- Das automatisch erzeugte Morning Briefing hatte tageweise schwankenden Ton; das Kanal-Gateway dahinter ist inzwischen ausgezogen.

**Mitigations:**
- Settings panel exposes per-panel toggles ("Hide appointments rail this week") so the owner can simplify his Bridge during quiet seasons.
- Anomaly Watchdog has a "less sensitive" mode that requires ±4σ for alerts (silences common false positives at the cost of latency on real ones).
- Morning Briefing supports a "regenerate" button if the day's tone is off.

## Alternatives considered

- **Dashboard with 12 widgets + drag-and-drop layout.** Rejected. Generic admin tool aesthetic; promotes feature accretion; defeats glance-discoverability.
- **Tabs for each panel as the primary navigation.** Rejected — tabs hide state. The rails-and-feed pattern surfaces every count and status without click.
- **Real-time charts everywhere.** Rejected — chart fatigue. Numbers + status dots beat charts for the "glance" use case. Charts live in the Insights panel for the deep-dive.
- **AI-driven layout (the UI rearranges based on what's "important").** Rejected as Phase 1 risk. Predictable layout is a trust-building feature; AI-driven layout means the owner has to re-learn the screen daily.
- **Voice as primary input.** Rejected in V1; complement, not substitute. Voice is great for "show me yesterday's closings" but not for approving a €12k sale.

## Known limits & deferred decisions

1. **No multi-language UI strings in V1.** German + Arabic at the data level (memory.md #5); UI chrome is English at V1. We translate the UI when a non-English-reading ADMIN joins.
2. **No mobile/tablet Bridge.** Designed for 1280×800+ screens. A read-only mobile companion is Phase 2.
3. **No customizable rails order via drag-drop.** Settings page exposes visibility toggles; order is fixed for V1 to keep the design language tight.
4. **No reusable "build your own dashboard" capability.** Anti-feature for the cognitive-load goal.
5. **Voice mode skeleton only.** Architecture slot exists, implementation deferred.

## References

- ADR-0009 — the Tauri shell that hosts this UX
- ADR-0010 — das frühere Kanal-Gateway für Morning Briefing + Anomaly Watchdog (ausgezogen)
- ADR-0014 — the SSE event stream the Bridge subscribes to
- ADR-0016 + ADR-0018 — every business event surfaces here
- ADR-0020 — appointments are a first-class Bridge panel
- Oliver Roos cherry-picks: `components/ui/Luxury*`, `lib/motionPresets.ts`, `lib/editorialTheme.ts`, `components/molecules/BentoCard.tsx`, `components/molecules/SkeletonCard.tsx`, `components/organisms/PrintPaperFX.tsx`, `pages/DashboardHome.tsx`, the entire atomic-design layout
- `docs/memory.md` §2 #30 #33, §5 (cherry-picks)
