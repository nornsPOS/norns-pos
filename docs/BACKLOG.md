# Warehouse14 — Working Backlog & Decisions

> Gemeinsames Arbeitsheft zwischen Strategie und Basel. Stand 2026-06-06 (historisch).
> ⚠️ **This file MUST stay committed** — branch switches wiped it once when it was untracked.

## Operating model
- **Strategie/Review:** owns technical decisions; reviews EVERY executor claim against the real code and **re-runs the gates independently — never rubber-stamps**; writes the deep prompts. Full technical authority — brings Basel only goals/product decisions.
- **Basel:** direction/goals; relays prompts to the executor; triggers deploys; live-tests on the real Mac.
- **Umsetzung (historische Arbeitszweige):** implementation/commits; TDD + plan-first per prompt.
- **Doctrine:** no facade — nothing ships that looks strong but is hollow; prove under real pressure; tests = disaster discovery; "green" must prove correctness vs the real world, not self-consistency.

## 📍 WHERE WE ARE (2026-06-06)
The core sell path + a deep UX redesign are SOFTWARE-COMPLETE and reviewed, on stacked branches.
**Readiness (honest): NOT yet ready for real paying customers.** Go-live blockers:
1. **Cash-confirm button** — the new AmountPad keypad pushed the Bezahlen button below the dialog fold → operator can't finalize a cash sale. *(IN PROGRESS — historischer Arbeitszweig.)*
2. **Kasse still unclear to the owner** (twice-flagged) — needs a deeper reframe (purpose / the €200 opening float / its link to checkout), not just language.
3. **Real-hardware validation (HIL session):** ZVT card terminal (no card payments without it), label printer + hand scanner (receipt/label/barcode round-trip), TSE/Fiskaly in prod, camera.
4. **Deploy to prod:** the reserve fix (PR #2) + the 0045–0048 migrations are NOT on prod yet.

A preliminary **cash-only dev demo** is ~1 fix away (the cash-confirm button).

## 🌿 GIT / DEPLOY STATE (source of truth)
- **main** base = `d3869c7` (macOS-signing merge). **Prod (api.warehouse14.de) runs OLD code.**
- **PR #2** (historischer Arbeitszweig) → main = the reserve sell-bug fix, isolated for a clean merge. **OPEN / not merged / not deployed.** Prod-critical (latent — 0 customers). Merge + redeploy api-cloud before go-live.
- **Pushed** (consolidated 06-06): `ux-p0-foundation`, `ux-p1-product-lifecycle`, `ux-p2-metal-ticker`, `ux-p3-ankauf-estimator`, `fix-reserve-sell-bug`.
- **NOT pushed** (local, stacked in this order on top of p0): `ux-kasse-plain-language` → `ux-icons-foundation` → `ux-cashier-keypad` → `ux-cashier-discount` → `ux-cashier-barcode` (current HEAD) → *(next)* `ux-cashier-confirm`. Push for backup when Basel says.
- The **reserve + dev-env fixes** ride in the stack (committed on `ux-p0-foundation`); the reserve fix is ALSO cherry-picked onto `fix-reserve-sell-bug` for the clean main merge.
- **The POS app ships via OTA (Tauri desktop), SEPARATE from the server container.** All UX work = a POS app release; only the reserve fix + migrations touch the server.

## 🎨 UX REDESIGN — study + phases
Full study: **`docs/UX-REDESIGN.md`** (code-grounded audit + researched principles + IA map + phased plan). **Reframe:** the app isn't soulless by design (parchment/ink/gold/wax-seal + Spotlight palette + a real design-token system) — the pain was IA mis-priority, unfinished affordances, dead-ends, jargon, fragmentation. Fix = coherence + focus + guidance, not a rebrand. **Tools (researched + integrated):** Lucide icons; Shopify/Square/NN-G POS patterns (keypad/discount/barcode); DATEV/GoBD/GDPdU for the export phase.

Every phase below was **reviewed by the strategist against the real code with the gates re-run independently** (typecheck · ui-kit+tauri-pos tests · vite build · lint:all net-0-new). Each on its own branch.
- ✅ **P0 foundation** (`ux-p0-foundation`): ui-kit `Dialog`/`Sheet` + `Form` primitives (focus-trap/restore, scroll-lock, a11y) + bound number-key nav (pure resolver + input/dialog guards) + migrated 2 stable dialogs. The "feels finished" foundation — every dialog used to be hand-rolled.
- ✅ **P1 unified ProductSheet** (`ux-p1-product-lifecycle`): ONE slide-over replaces NeuesProduktDialog + InventoryAdjustmentDialog (Details → Fotos → Preis → Bestand → Web&SEO → Etikett → Handel); pure `deriveLifecycleStage` chip; kills the /fotos dead-end (round-trip breadcrumb); reuses ALL locked guards (publish/€0, notes≥8, label gating) verbatim.
- ✅ **P2 metal ticker** (`ux-p2-metal-ticker`): always-visible price strip in the chrome + detail popover (new ui-kit `Popover` + `Sparkline`); Kurse demoted primary→secondary (full terminal + ADMIN override preserved); removed the redundant Werkstatt price panel. Δ = vs 10-day avg (labelled "ggü. Ø 10 Tage").
- ✅ **P3 Ankauf guided Estimator** (`ux-p3-ankauf-estimator`): 3-step guide replaces the silent lock; live Schmelzwert (`computeSchmelzwertEur`, bigint, German-comma fix) → editable suggested buy price (server ankauf rate, margin baked in). KYC gate reused verbatim.
- ✅ **Kasse plain-language** (`ux-kasse-plain-language`): "Tag beginnen/abschließen", Erwartet·Gezählt·Differenz readout (`classifyDifferenz`), jargon→subtitle. **Blind-count + TSE/Z-Bon/variance enforcement untouched.** ⚠️ Owner STILL finds it unclear → deeper reframe pending (blocker #2).
- ✅ **Icons foundation** (`ux-icons-foundation`): `lucide-react` + `Icon`/`IconButton` (a11y, ≥44px) + `packages/ui-kit/UI-CONVENTIONS.md`; cart "entfernen" → Trash2; curated sweep (close/add/etc.).
- ✅ **Core cashier ⭐** (the owner's top priority): **keypad** (`ux-cashier-keypad`) on-screen `AmountPad` (TDD reducer) + Rückgeld in the cash path · **discount** (`ux-cashier-discount`) per-line + invoice %-discount (`percentToEur` + Σ-exact `distributeInvoiceDiscount`, bigint-cent, capped; reason preserved; `computeLineMath` tax untouched) · **barcode** (`ux-cashier-barcode`) label = Code128 of the SKU (printer-native), Verkauf scan → `classifyScanMatch` → reserve → cart (the scanner was unwired at the till before). All finalize/TSE/reserve paths untouched.

## 🔧 Live-test feedback — PENDING (Basel, from running the build)
1. **Cash-confirm button** — IN PROGRESS (blocker #1).
2. **Kasse deeper reframe** — purpose / €200 float / link to checkout (still opaque to the owner).
3. **ProductSheet create→manage in-place** — after saving the initial create it closes + forces "go back to Lager + re-click the product"; should flow straight into the manage sections.
4. **Metal-margin global propagation** — the server DOES derive `ankauf = avg×(1−margin)` in SQL; the gaps are the per-metal margin UI + pushing the new derived price to all OPEN consumers (ticker / Ankauf) immediately (owner: "changes in one isolated place").
5. **DATEV / Kassenbericht export** — DATEV CSV (EXTF) exists server-side (`closing-export.ts`) but there is **NO POS UI**; add GDPdU + a Kassenbericht + an on-demand download surface.
6. + more as Basel keeps live-testing.

## ✅ Foundation already fixed
- **Reserve sell-bug** (`packages/inventory-lock/src/reserve.ts`, committed): drizzle `db.execute()` returns timestamptz as a STRING; `rowToReservation` typed it `Date` → the route's `.toISOString()` → HTTP 500 on EVERY reserve (after the row already committed RESERVED → stranded → 409 retries). **The real "can't sell".** Fix: `toDate()` coerce. → PR #2 (pending merge+deploy). Follow-ups: a testcontainers regression test asserting `reserve()` returns a `Date`; audit other raw `db.execute()` callers that treat a returned timestamptz as a Date without a `new Date()` wrap.
- **Local-dev env** (4 layered facades, committed on `ux-p0-foundation`): nothing created the `warehouse14` app DB; migrator wasn't superuser (untrusted `vector`/`pg_stat_statements`); no `check_function_bodies=off`; root `.env` pointed at the empty `warehouse14_dev` and env was shell-sourced not file-loaded. → initdb creates the DB + a dev-only SUPERUSER migrator; `dev-bootstrap.ensureMigratorAndDatabase()` self-heals; `--env-file-if-exists` on the dev scripts. `down -v && pnpm dev` now works from a clean shell (stale shell exports still win → fresh terminal / `unset`).
- **test-gate (0045–0048)** — 4 latent prod bugs (blind_index hmac / security counter SELECT / DEBT enum / ledger fork) fixed + proven red→green; harness boots; runbook `docs/runbooks/0045-0048-prod-apply.md`. **Confirm these are applied on prod** before go-live.
- **macOS signing** (`fix-macos-signing`, in main `d3869c7`): `signingIdentity:"-"` adhoc-signs both desktop apps → no more "damaged". control-desktop sibling done.

## 🔌 Hardware-in-the-loop (pre-go-live)
- ✅ **ZVT card path** software-complete (BMP parser ecrterm-grounded, robust framing, validating mocks); **TSE solid** (config validation + monotonic counter). 🔦 Real CCV A920 session: PAN/approval-code field location, status cadence.
- 🔦 **Barcode label = sale label** software-complete (Code128 of the SKU via the printer's native cmd — ZPL `^BC` / ESC-POS `GS k 73`; scan→cart). **HIL gate:** real label printer rasterises a physically scannable Code128 (tune `^BY`/`GS w·h` + media); the hand scanner decodes → exactly the SKU (Enter suffix, no prefix/AIM-ID, ≥6 chars <200ms); end-to-end print→scan→cart.
- ⏳ **Phase 2:** label + receipt printers HIL (assert SKU + TSE block), camera→inventory.
- **One hardware validation session** (card + printer + scanner + camera) is a go-live gate.

## 📦 Deferred / tech-debt
- ~49 mechanical db-test bit-rot fixes (before the CI db-suites gate can be made *required*).
- Intel CI leg of the OTA release hangs (24h timeout) → `latest.json` omits `darwin-x86_64` (fine — Roman is Apple Silicon + Windows). Fix so runs complete cleanly + stop masking failures.
- **Apple Notarization** (Developer ID + notarize, ~$99/yr) — DEFERRED by Basel; adopt before public go-live for a friction-free first launch.
- Roman's 4 doc templates (Briefpapier / Bewertung / Ankauf / Expertise) — Documents phase (pdfme / TipTap vs satori).
