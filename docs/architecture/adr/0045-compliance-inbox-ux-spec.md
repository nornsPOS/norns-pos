# ADR-0045: Compliance Inbox — UX Architecture Spec

**Status:** Proposed
**Date:** 2026-05-28
**Companion to:** ADR-0044 (Offline Queue & Idempotency)
**Design language:** Parchment-2 (existing tokens in `packages/ui-kit/src/tokens.css`) — see §7
**Audience:** Engineering, Steuerberater (compliance review), Owner usability test

This document specifies the human-in-the-loop resolution surface that ADR-0044 declared a pre-merge blocker. It covers the decision model (what the Owner must decide and why), the interaction architecture (how cognitive load is minimized at the critical moment), the underlying state machine, and accessibility/keyboard semantics.

It does NOT contain implementation code. A high-fidelity visualization lives at `docs/architecture/design/0045-compliance-inbox-mockup.png` (to be authored alongside this ADR).

---

## 1. The decision the Owner is actually making

A `STATE_DIVERGED` conflict is not a "fix the bug" moment. It is a fiscal-record reconciliation decision under §146 GoBD: **two ledgers — the device's outbox and the cloud's record — disagree, and the Owner must decide which is the truth of record, with their reasoning preserved verbatim for ten years**.

The cognitive frame to design for is: *the Owner has 60 seconds, is in the middle of a normal Tuesday at the shop in Weil am Rhein, and is being asked to make a decision they will be asked to defend by a Steuerprüfer in four years.* Everything on the surface either helps them make that decision quickly *and* defend it later, or it is removed.

### 1.1 The canonical Warehouse14 examples

The conflict cases differ from a generic retail POS because Warehouse14 deals in precious-metals Ankauf and antiques where the *thing being recorded* is itself fiscally heavy.

**Case A — Storno against a closed Tagesabschluss.**
The mutation in the outbox: `POST /sales/8920/void { reason: 'customer changed mind' }`.
The server responds 409 with `code: 'CLOSING_DAY_FINALIZED'`. The shift containing sale #8920 has been closed, and a Storno against a closed Tagesabschluss requires a different fiscal mechanism (a corrective entry in the next open period, not a back-dated void).

**Case B — Ankauf with metal-price divergence.**
The mutation in the outbox: `POST /ankauf { gold_g: 12.4, agreed_price_eur: 720.00, ... }` queued at a moment when the device's LBMA cache showed €58.06/g.
The server responds 409 with `code: 'STATE_DIVERGED'` and details indicating the server-side LBMA value at replay time is €61.20/g — beyond the configurable tolerance threshold.

**Case C — Storno of a sale that the server doesn't have.**
The mutation in the outbox: `POST /sales/4711/void`.
The server responds 409 with `code: 'STATE_DIVERGED'` and details `parent_not_found: true`. The sale never reached the server (a different device's queue is still pending, or the sale was rolled back manually).

**Case D — Sanctions block on a pending Ankauf.**
The customer associated with a queued Ankauf was sanctioned during the offline window.
The server responds 403 with `code: 'SANCTIONS_BLOCK'`. By GwG this *must* result in a Verdachtsmeldung filing path, not a silent skip.

These four account for the vast majority of conflicts expected during the first year of operation. The UI presents the divergence reason **in plain German** in the inspector header, not the raw code.

---

## 2. The four decisions

The decision space is deliberately quartered. Hicks' Law: more than four primary options at a critical moment increases reaction time non-linearly. Less than three under-serves real cases. Four is the documented sweet spot for triage.

### 2.1 Übergehen & Annotieren — *Skip & Annotate*

**When it is correct.** The Owner has concluded that the mutation should NOT be applied, and the server's current state is the truth of record. Most common case: the Storno was a duplicate (the customer was already handed the cash from the till and the receipt voided manually).

**What the system does.** Marks the queue row `resolved_skip`. The mutation never executes. The annotation text becomes part of the immutable audit row.

**Mandatory inputs.** Free-text reason in German, minimum 10 characters. No template, no preset reasons — the auditor wants the Owner's own words. The system *suggests* nothing; suggestion would taint the audit.

**Audit footprint.** A row in `outbox_resolutions` with: `key`, `decision = 'skip'`, `reason_text`, `resolver_id`, `resolved_at`, `device_id`. Append-only; cannot be edited.

**Default highlight.** Visual *primary* in the decision quarter. Most common correct answer; least destructive — choosing it can never make the books worse.

### 2.2 Stornieren & Neu — *Void & Re-issue*

**When it is correct.** The mutation in the queue is wrong (wrong sale ID, wrong amount, wrong metal weight, typo at tender time), and the correct action is to abandon this attempt and re-issue a corrected one through the normal POS flow.

**What the system does.** Marks the queue row `resolved_void`. Closes the inspector and routes the Owner back to the relevant POS screen (Ankauf list, sale detail, Tagesabschluss view) with the original payload pre-filled and editable. Submitting the corrected version creates a fresh outbox row with a new idempotency key, linked via `voids_predecessor` for audit.

**Mandatory inputs.** Free-text reason. The corrected mutation does *not* require a separate reason — it follows normal POS audit rules.

**Audit footprint.** Two linked rows: the voided original (`decision = 'void'`, `reason`) and the new mutation (linked via `voids_predecessor = <old key>`).

**Default highlight.** Calm neutral. Correct when the device was wrong, but multi-step and not the default click.

### 2.3 Erzwingen — *Force Override*

**When it is correct.** Vanishingly rare. The server is wrong (verified out-of-band: cloud-side restore from backup, manual database correction by Basel, a documented incident) AND the Owner has documentary evidence to defend the override at audit.

**What the system does.** Sends the original mutation with an `X-Force-Override` header that the server accepts only with valid step-up credentials and writes a *manual-adjustment* record on the append-only ledger (memory.md §3 hash chain). The outbox row is marked `resolved_override`. The override creates a paired entry on both client and server audit logs, tagged for the year-end annual review.

**Mandatory inputs.** (1) Step-up PIN modal (the same flow as `stepUpMiddleware`). (2) Long-form reason text, minimum 50 characters, in German. (3) Evidence reference field (free-text — a Tagesbericht filename, a Vorgangsnummer, an email reference, an Incident-ID).

**Audit footprint.** The most expensive footprint of any decision. The override row is *flagged for annual review* automatically. The end-of-year archive includes a separate manifest of all overrides issued in the fiscal year, surfaced to the Steuerberater.

**Default highlight.** Oxblood frame. Visually demoted in the quarter — same physical size and position as the others, but with the only red ink on the entire surface. Deliberate, never accidental. A second confirmation step ("Sind Sie sicher? Diese Entscheidung wird zehn Jahre lang geprüft.") is non-skippable.

### 2.4 Steuerberater — *Defer to Specialist*

**When it is correct.** The Owner is not sure. Doubt is itself a correct signal. Rather than make a wrong decision, defer.

**What the system does.** Marks the queue row `deferred`. The queue remains halted at this position. Exports the row, the divergence detail, and a snapshot of relevant local context (the Ankauf, related sales, the day's Tagesbericht, the LBMA cache at intake time) as a DATEV-compatible XML file. The Owner receives a clear next-step instruction: "Diese Datei an Ihren Steuerberater senden. Sobald die Auflösung vorliegt, hier importieren."

**Mandatory inputs.** None beyond the export destination.

**Audit footprint.** Deferral is itself audited (`decision = 'defer'`, `exported_to_path`). When the Steuerberater's resolution returns, a `Auflösung importieren` flow allows the Owner to upload the response, which becomes the resolution and replaces the deferral status.

**Default highlight.** Calm neutral. The responsible answer when uncertain — the UI must not punish uncertainty.

---

## 3. Cognitive-load architecture

Five techniques apply at the critical moment:

### 3.1 Diff narrows to divergence

The dual-pane "Ihre Aufzeichnung / Server-Stand" view shows **only the fields that differ**, not all fields. Identical fields summarize as a single line ("11 weitere Felder stimmen überein"). Largest single reduction in visual noise.

### 3.2 Plain-language divergence header

The inspector's first line, in serif italic, reads what the divergence *means*, not its error code:

> *Der Storno bezieht sich auf einen bereits abgeschlossenen Tagesabschluss vom 27.05.2026.*

The raw `code` and `trace_id` live below in monospace, smaller, for engineering reference.

### 3.3 Suggestion never appears

Despite technical feasibility of pattern-matching against prior resolutions and suggesting "Owners usually choose Skip for this divergence type" — **the system does not suggest a default**. Audit ethics: a suggestion taints the Owner's free will, and the auditor must be able to trust that the resolution reason is the Owner's own.

The system *does* show the **history of how the Owner has resolved similar divergences before**, as a small footer in the inspector ("Ähnliche Fälle: 3× Übergehen, 1× Stornieren in den letzten 90 Tagen"). This is historical fact, not suggestion. The Owner draws their own inference.

### 3.4 The destructive choice is muted, not flagged

Force Override is presented in oxblood, same size and position as the others, same typographic treatment. Not surrounded by warning icons, not preceded by a banner, not separated by extra spacing. *Quiet*. The act of clicking it triggers the friction (PIN modal, 50-char reason, evidence reference), not its visual treatment.

Reasoning: visual urgency is a form of theater, and theater erodes trust in the surface. "If you mean to do this, the system will let you, but you will have to *mean* it" is more honest than alarm-bell UX.

### 3.5 Reason text is treated as evidence

The reason text field is large, serif, generous in line-height, and unstyled — it looks like writing paper, not a form field. Deliberate. The Owner is being asked to write something a stranger will read in four years; the field should feel like a notebook, not a tweet box.

---

## 4. State machine

```
                       ┌──────────────┐
                       │   pending    │◄── enqueued from offline-queue middleware
                       └──────┬───────┘
                              │ replay loop picks up
                              ▼
                       ┌──────────────┐
                       │  in_flight   │
                       └──────┬───────┘
                              │
        ┌─────────────────────┼──────────────────────┐
        │                     │                       │
        ▼                     ▼                       ▼
  ┌──────────┐         ┌──────────────┐       ┌──────────────┐
  │succeeded │         │   conflict   │       │failed_terminal│
  └──────────┘         └──────┬───────┘       └──────────────┘
                              │
                              │ Owner reviews in Compliance Inbox
                              │
            ┌─────────┬───────┴────────┬────────┐
            ▼         ▼                ▼        ▼
       resolved_  resolved_     resolved_     deferred
        skip      void          override        │
                    │                           │ Steuerberater returns
                    │                           ▼
                    │                    resolved_by_
                    │                     specialist
                    │
                    └─► new outbox row (linked via voids_predecessor)
```

Once a row leaves the `conflict` state, it never returns. All resolution states are terminal. The replay loop's queue head advances only when the head is in a terminal state.

---

## 5. Keyboard and accessibility

The Compliance Inbox is rare enough that *recall* matters more than *familiarity* — but power-user keyboard semantics earn back time on review-heavy days (quarterly close, year-end).

| Key | Action |
|---|---|
| `⌘1` / `⌘2` / `⌘3` / `⌘4` | Switch tab (Angehalten / Ausstehend / Aufgelöst / Archiviert) |
| `↑` / `↓` | Navigate row in current tab |
| `Enter` / `→` | Open inspector for selected row |
| `Esc` / `←` | Close inspector, return focus to list |
| `S` | Open Übergehen & Annotieren, focus reason field |
| `V` | Open Stornieren & Neu, focus reason field |
| `F` | Open Erzwingen (gated; presents step-up before reason field) |
| `D` | Defer to Steuerberater, focus export-path field |
| `⌘S` | Save decision (only valid when reason meets minimum length) |
| `⌘Z` | NOT supported in this surface — decisions are immutable on save |

Accessibility:
- Contrast: `--w14-parchment` (#F1ECE0) on `--w14-ink` (carbon) exceeds WCAG AAA (7:1).
- Oxblood accent on parchment exceeds AAA.
- No information is conveyed by color alone. The diff highlights diverged fields with a left-margin marker (`‖`) in addition to subtle color.
- Every interactive element has a visible focus ring (1px oxblood inset).
- Reason fields announce minimum length to screen readers and show a remaining-character count.
- Tab order follows visual reading order (top to bottom, left to right) without traps.

---

## 6. The decision tree, in a sentence each

For the Steuerprüfer reading this document in 2030:

1. The Owner sees the inspector. They read the plain-language divergence line.
2. If they conclude the device was wrong → **Stornieren & Neu**.
3. If they conclude the server is right and the device should yield → **Übergehen & Annotieren**.
4. If they conclude the server is wrong and have evidence → **Erzwingen** (PIN, long reason, evidence reference).
5. If they conclude they don't know → **Steuerberater**.
6. Every decision requires a German-language reason which becomes part of the immutable audit row.
7. No decision is suggested by the system. The Owner's choice is their own.
8. Decisions are final on save; reversal requires a fresh corrective mutation through the normal POS flow, not editing the audit.

---

## 7. Design system — Parchment-2 applied

The Warehouse14 design system already defines parchment tokens in `packages/ui-kit/src/tokens.css`:

| Token | Light | Dark | Use in Compliance Inbox |
|---|---|---|---|
| `--w14-parchment`    | #F1ECE0 | #1A1614 | Background everywhere; surface plane. |
| `--w14-parchment-2`  | #EAE4D5 | #221C18 | Subtle warm tint for selected rows, active nav. |
| `--w14-parchment-3`  | #DED6C2 | #2A231D | Two-tier nesting (e.g. inspector header band). Avoid in this surface — Compliance Inbox uses parchment + parchment-2 only, no third tier. |
| `--w14-ink`          | (project default carbon) | — | Primary text. |
| `--w14-ink-mid`      | — | — | Secondary text (labels, paths, timestamps). |
| `--w14-ink-ghost`    | — | — | Tertiary text (footnotes, "ago" markers). |
| `--w14-oxblood`      | — | — | Sole accent. Compliance alert codes, Force Override frame, left rules on selected rows, focus rings. |

For this surface, the operative rules:

| Aspect | Rule |
|---|---|
| Background | `--w14-parchment` everywhere. No alternate surfaces. |
| Selected row tint | `--w14-parchment-2`. |
| Hairlines | `--w14-rule-hair` (existing token). Vertical rules between zones use `--w14-rule-heavy`. |
| Type — fiscal numbers | Humanist serif, tabular figures, aligned to decimal. (`Source Serif 4` → `Tiempos Text` → `Georgia` fallback). |
| Type — body & labels | Quiet sans, weight 400 default, 500 for headers. (`Inter` → `Helvetica Neue` fallback). |
| Type — codes & timestamps | Monospace, tabular. (`JetBrains Mono` → `Menlo` fallback). |
| Grid | 8px baseline. 24px row height for list rows. |
| Margins | Generous. 32px minimum gutter around content blocks. |
| Icons | None in fiscal contexts. Every action labeled in words. |
| Motion | None for state changes. Page transitions only, ≤200ms ease-out. |
| Shadows | None. Depth implied by hairline alone. |
| Currency | Always with `€` symbol and tabular figures. Never abbreviated. |

The aesthetic spirit of Parchment-2 is documented separately in the companion design philosophy `docs/architecture/design/0045-compliance-inbox-philosophy.md` ("Ruled Silence" — Hanseatic-counting-house reference woven invisibly into the surface).

---

## 8. Hand-off checklist for engineering

1. [ ] Implement `Compliance Inbox` route at `/compliance/inbox` in `apps/control-desktop` (gated by ADMIN role per memory.md §1 roles).
2. [ ] Implement four resolution flows: Übergehen, Stornieren, Erzwingen (with step-up integration from ADR-0043), Steuerberater.
3. [ ] Implement `outbox_resolutions` table (append-only, hash-chained per memory.md §3) with the schema implied in §2.
4. [ ] Implement DATEV-compatible XML exporter for the Steuerberater flow.
5. [ ] Implement the resolution-import flow for Steuerberater responses.
6. [ ] Apply Parchment-2 tokens consistently to the existing primitive POS chrome where it touches Compliance Inbox (separate epic — this is the catalyst, not the only surface).
7. [ ] Usability test the inspector with Basel (Owner). Specifically: can he explain in his own words what he is deciding, before deciding?
8. [ ] Year-end review report: list all `resolved_override` rows from the fiscal year, with reasons and evidence references, for the Steuerberater binder.

---

*Compliance-critical UX is craft. The Owner at the shop in Weil am Rhein will not read this document, but he should be able to feel everything it argues for the moment the screen renders.*
