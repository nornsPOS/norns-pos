# Warehouse14 POS — UX Redesign Study & Plan

> Autor: Strategie. Datum: 2026-06-06. Publikum: Basel + Umsetzung.
> Method: (1) code-grounded audit of the live app — every primary/secondary surface,
> the shell, and `packages/ui-kit`; (2) internet research on proven patterns
> (jewelry/pawn POS, touch UX, navigation IA, cash-management, price tickers,
> item-lifecycle). Goal: make the POS **logical, fast, guided, coherent** for Roman
> (single operator, counter touchscreen) — without discarding the existing design language.

---

## 1. Honest diagnosis — why it feels "confusing / soulless / disorienting"

The foundation is genuinely strong: a Karteikasten chip rail **plus** a Spotlight command
palette (⌘K, fuzzy search), a real design-token system, SSE live data, shift/role gating,
and a deliberate "parchment-ledger / wax-seal / gold" aesthetic with real character.
**The pain is not the visual brand — it's five structural gaps:**

1. **IA is mis-prioritized.** The 8-chip primary rail mixes daily-critical tasks
   (Verkauf / Ankauf / Kasse) with heavy-but-occasional tools (**Kurse = a 983-LOC trading
   terminal**; Schreiben = an A4 doc studio) and **buries the HOME dashboard at chip #6**
   ("Werkstatt"). The eye has no clear "where do I start / what matters now."
2. **Unfinished affordances.** The rail shows number labels **1–8 but the number keys are
   NOT bound** to navigation — a promise the UI visibly breaks. Small, but it reads as "unpolished."
3. **Dead-end flows.** Adding a product redirects to the full-screen `/fotos` route with
   **no back-link** — the operator is stranded and must guess their way back.
4. **Guidance gaps + jargon.** Ankauf's right pane is **locked until a customer is selected,
   with no hint why**. Kasse speaks accountant ("Z-Bon", "Kassenbuch", "Kassensturz-Varianz")
   with no plain-language framing. The operator feels lost, not guided.
5. **Fragmentation.** Creating/managing a product is scattered across **6 surfaces**
   (NeuesProduktDialog, InventoryAdjustmentDialog, AnkaufBezahlenDialog, Fotos, eBay,
   IntakeDraftsTray) with **inconsistent label printing** (auto here, manual button there,
   absent elsewhere) and no unified lifecycle.

> **Conclusion:** the redesign is about **coherence, focus, and guidance** — completing and
> concentrating the existing system, not rebranding it. "Soul" comes from consistency +
> responsiveness + the system guiding you, not from new colors. We keep the parchment/gold/
> wax-seal language; we make it legible, guided, and whole.

---

## 2. Governing principles (each researched + sourced)

1. **Guided over blank.** Never show a locked/empty pane — show the next step. Jewelry/pawn
   leaders use a structured **"Estimator"** that walks the operator through category → condition
   → live market price → suggested price. _[Bravo Store Systems]_
2. **Less = more, task-focused nav (hub-and-spoke).** "Present only a handful of obvious options
   with clear labels." Daily tasks front-and-center; occasional tools one layer back. _[NN/G, IxDF]_
3. **Touch-first ergonomics.** ≥48px (≈1 cm) targets, 8px+ spacing, primary actions in easy reach,
   **immediate visual feedback on every tap**. _[NN/G — Touch Targets / Large Touchscreen UX]_
4. **One flow per job.** Consolidate multi-step work (intake) into a single connected flow with
   breadcrumbs and an always-available back. _[single-flow intake research]_
5. **Live market data is a ticker, not a screen.** A glanceable KPI/ticker strip with built-in
   currency formatting and real-time updates (e.g. Tremor-style cards). _[financial-dashboard patterns]_
6. **Plain language first, jargon second.** "Open the day / Close the day," with the legal term
   ("Tagesabschluss / Z-Bon") as a subtitle. _[cash-management UX]_
7. **The item has a lifecycle.** One object, clear stages (Intake → Photos → Price → Published →
   Reserved → Sold), visible everywhere. _[jewelry work-order / consignment tracking]_

Sources: NN/G (touch-target-size, very-large-touchscreen-ux, mobile-navigation-patterns),
IxDF (hub-and-spoke), Bravo Store Systems, Jewel360 (work orders), financial-dashboard/ticker patterns.

---

## 3. Information Architecture — the new map

**Today:** flat 8 primary (mixed importance) + 7 secondary + Spotlight; home buried at #6;
number keys unbound; metal prices appear in BOTH a 983-LOC `Kurse` tab AND a Werkstatt panel (redundant).

**Proposed:** three tiers by frequency-of-use, with a persistent market ticker.

### A. Persistent chrome
- Keep: Seal (→ Home), Sync status, Spotlight (⌘K), theme toggle, sign-out.
- **NEW — metal-price ticker strip** (Gold / Silber / Platin / Palladium · €/g · Δ) always visible
  under the header. **Replaces the Kurse primary tab.** Click a metal → a small detail popover
  (1T/1W/1M chart, reusing Kurse's chart) — not a full screen.

### B. Primary rail = the daily loop (4 chips, number-key bound)
1. **Home** (today's overview — rename "Werkstatt"; make it chip #1 / the seal-home)
2. **Verkauf** (sell)
3. **Ankauf** (buy — guided)
4. **Kasse** (open / close the day)

### C. Support layer (grouped + discoverable; still one keystroke away via Spotlight)
- **Lager** (inventory), **Kunden** (customers), **Belege/Schreiben** (documents), **eBay**, plus
  settings / tagebuch / dokumente / aufgaben / whatsapp.
- `Kurse`-as-screen is **retired** into the ticker's detail popover (keep the charts for the owner,
  off the daily hot path).

**Rationale:** money-moving daily tasks own the rail; heavy/occasional tools move one layer back
but stay instantly reachable. The ticker satisfies "prices as a ticker, not a screen" and removes
a 983-LOC tab from the hot path. Bind number keys for real (the UI already promises them).

---

## 4. Per-screen direction

### 4.1 Unified Product Lifecycle — the keystone (replaces the 6-surface fragmentation)
One object, one flow. A single **Product sheet** (slide-over) whose sections are the stages:
**Details → Photos → Preis & Veröffentlichen → Etikett → (optional) eBay/Storefront.**
- Reached identically from **Lager** ("+ Neues Produkt" / row click) and from **Ankauf** (after a buy).
- **Photos become an inline step** (camera / drag-drop) — not a separate `/fotos` route with no return.
  (`/fotos` may remain as a deep-capture mode, but always with a breadcrumb back to the product.)
- **Label printing = ONE consistent control** at every stage: auto-on-publish **and** an
  always-available "Etikett drucken" with a preview. Kill the auto-here / manual-there / absent mess.
- **One visible lifecycle chip:** Entwurf → Fotos → Bepreist → Veröffentlicht → Reserviert → Verkauft.
- Add the **missing "Auf eBay anmelden"** affordance here (today there's no discoverable entry).

### 4.2 Ankauf → guided Estimator
- Don't lock-and-hide the right pane. Lead with a quiet, always-visible 3-step guide:
  **1 · Kunde wählen → 2 · Stücke bewerten → 3 · Auszahlen.**
- Per item: category → weight + fineness → **live melt value
  (Schmelzwert = Gewicht × Feinheit × Live-€/g − Marge)** auto-suggests the buy price (same ticker data).
  This is the industry "Estimator" and it kills the €0 / guesswork case.
- Keep KYC surfaced early (already solid from prior work).

### 4.3 Kasse → plain-language daily ritual
- Two big, obvious actions: **"Tag beginnen"** (open: count starting float) and
  **"Tag abschließen"** (close: count drawer → app shows **Erwartet vs. Gezählt = Differenz** → Z-Bon).
- Jargon becomes subtitle: "Tagesabschluss (Z-Bon)" with one plain sentence on what it is.
- Keep the Kassenbuch, reframed as "today's money in / out."

### 4.4 Metal prices → ticker (+ optional detail)
- The always-visible header ticker (see §3.A). Click a metal → popover with the 1T/1W/1M chart
  (decomposed from the 983-LOC Kurse screen). No primary tab.

### 4.5 Verkauf (already sells — polish only)
- In-flight reservation feedback (tap-again guard / spinner), clearer tax-incompatibility message
  on the offending line, keep the post-finalize auto-refocus.

### 4.6 Home (rename "Werkstatt")
- Make it the literal home (chip #1 + seal). Today's numbers + live Tagebuch + the ticker.
  Fix the stat-tile lag (align the dashboard query with the live feed instead of debounced invalidation).

### 4.7 Foundation in `ui-kit` (this is where "soul" actually comes from)
- Add a reusable **Dialog/Sheet** primitive — today **every dialog is hand-rolled** → inconsistency =
  the "unfinished" feel. Add **Form** primitives (Field, Label, Input, Select, inline validation/error).
  This single investment makes every screen consistent and is the cheapest path to "feels designed."

---

## 5. Phased plan (ship + pressure-test incrementally — no big bang)

- **P0 — Foundation (small, high-leverage):** ui-kit Dialog/Sheet + Form primitives; bind number-key
  nav; add breadcrumbs/back to the dead-end flows. → instantly more "finished," unblocks everything.
- **P1 — [recommended] Unified Product Lifecycle** (kills the biggest fragmentation pain)
  _or_ **Metal-price ticker** (smaller, visible, his explicit ask).
- **P2 — Ankauf guided Estimator + Schmelzwert auto-pricer** (Roman's core buying loop).
- **P3 — Kasse plain-language ritual.**
- **P4 — IA regroup + Home rename + retire Kurse-as-screen.**

Each phase: prototype → test on the real counter flow → adjust.

---

## 6. Open product decisions for Basel
- **P1 priority:** unified intake (biggest structural fix) vs ticker (quick visible win) vs
  Ankauf Estimator (Roman's daily core).
- **Rename "Werkstatt" → "Home/Übersicht"?** (Werkstatt = "workshop" is misleading for a dashboard.)
  Is there a real **repair-workshop** need (work orders) we should additionally model?
- **Keep the parchment/ledger aesthetic** (recommended) vs a lighter/brighter skin?

---

## Appendix — current-state map (from the code audit)
- **Shell:** `app/chrome/AppShell.tsx`, `AppShellHeader.tsx`, `Spotlight.tsx`, `surface-registry.ts`.
- **Primary surfaces:** Verkauf `screens/verkauf/Verkauf.tsx` (410) · Ankauf `screens/ankauf/Ankauf.tsx` (141)
  · Kasse `screens/kasse/Kasse.tsx` (64) · Lager `screens/lager/Lager.tsx` (356) · Kunden
  `screens/kunden/Kunden.tsx` (57) · Werkstatt `screens/werkstatt/Werkstatt.tsx` (home/dashboard)
  · Kurse `screens/secondary/Kurse.tsx` (983) · Schreiben `screens/secondary/Schreiben.tsx`.
- **Secondary:** /aufgaben /bewertung /ebay /fotos /belegtexte /tagebuch /dokumente /einstellungen /whatsapp.
- **Intake surfaces (fragmented):** NeuesProduktDialog (475, auto-print, redirects to /fotos no-back),
  InventoryAdjustmentDialog (536, tabs Bestand/Web&SEO, manual label button), AnkaufBezahlenDialog (600+),
  Fotos (800+, dead-end), Ebay (Kanban state machine), IntakeDraftsTray (orphan publish).
- **ui-kit:** good tokens (parchment/ink/gold/wax-red/verdigris; Inter + JetBrains Mono; 4px grid;
  radii 0/8/12; motion 120/220/380ms) + ~18 components (Button, ParchmentCard, StatTile, Toast,
  MoneyAmount, RomanIndex, Seal, PinPad, DiamondRule, LedgerEntry…). **Missing: a reusable Dialog/Sheet
  and Form primitives** (every dialog is hand-rolled = the inconsistency the operator feels).
