# Warehouse14 — Design & UX Brief

**The spec the build waves code against.** Cashier-POS redesign · Storefront polish · Mobile-Companions · Customer-Display.

**North star.** Keep the existing *clean / minimal-luxury* DNA — but earn it. In a fiscal/precious-metals POS, "simple" is a *correctness and trust* strategy, not decoration: every removed element lowers cognitive load (Hick), every disciplined whitespace gesture reads as confidence (quiet-luxury), the calm/elegant surface is also *perceived* as more usable and trustworthy (Aesthetic-Usability Effect, judged in ~50ms). Push craft via optical precision — weight-matched icons, an 8/4px rhythm, asymmetric easing, a tiny token vocabulary — **not** more effects.

**The 4 laws every surface obeys**
- **Hick** — cap visible choices, group + de-emphasize the rare (logarithmic cost: 8 ≈ 4, but a *hidden* option costs a whole navigation).
- **Fitts** — bigger + closer + edge-anchored = faster & fewer mis-taps; spend Fitts cost *in reverse* on destructive controls.
- **Doherty** — acknowledge every action in <400ms; users judge *perceived* (tap→first feedback), not completion, time.
- **Jakob** — match the register / cart / phone conventions staff & shoppers already know; novelty here is pure extraneous load.

**System tokens already in place (build on these, don't reinvent):** `packages/ui-kit/src/tokens.css` — `--space-1…12` (4px grid: 4/8/12/16/20/24/32/40/48/64/80/96), motion `--w14-dur-short 120ms / -medium 220ms / -long 380ms`, ease `--w14-ease-curator cubic-bezier(0.16,1,0.3,1)`, radii (0/8/12), `--w14-accent` brass primary, `--w14-wax-red` danger, `--w14-verdigris` positive, `.w14-tabular` tabular figures. Money math lives in `apps/tauri-pos/src/lib/money-core.ts`; German-comma parse in `lib/decimal.ts`.

---

## 1 · CASHIER-POS (desktop touchscreen, keyboard+numpad, ~80cm viewing)
*Files: `screens/kasse/*`, `screens/verkauf/{Verkauf,BezahlenDialog,CartPanel,CatalogGrid,StornoDialog}.tsx`, `screens/ankauf/{Ankauf,AnkaufBezahlenDialog}.tsx`, `screens/kasse/EuroInput.tsx`.*

**Guiding principle.** A cashier's eyes are on the customer, not the screen. Optimize for muscle memory, sub-second feedback, error *forgiveness* (undo, not warnings), and a zero-decision happy path — then layer richness behind it. The everyday flow (add item → Bezahlen → Bar) is the only thing visible by default; the 20% (Storno, Rabatt, split-pay, manual price, ID-capture) lives one disclosure level down.

### Concrete rules (with numbers)
- **Touch targets.** Per-transaction *hot-path* controls (Bezahlen, active keypad keys, tender buttons, Storno) at a **physical 1cm minimum → ~48–64px**; **primary action tiles ≥64px tall** for the 80cm read. WCAG's 24px is a *legal floor, not an ergonomic optimum*. ≥8px gap between competing targets; never two destructive/financial targets within 24px of each other. *(NN/g Touch-Target; MIT Touch Lab fingertip 16–20mm, thumb ~25mm; Apple 44pt / Material 48dp.)*
- **Spatial stability = muscle memory.** Bezahlen, the keypad digit layout (calculator standard, 1-2-3 top row, fixed `C`/Korrektur + comma key), and the quick-tender row occupy **identical coordinates whether the cart has 1 item or 30**. A control that moves forces a visual-search reset every sale. *(NN/g Fitts; PrehKeyTec 17-key standard.)*
- **Bezahlen = effectively-infinite Fitts target:** ~72–88px tall, brass `--w14-accent` fill, **corner/edge-anchored bottom-right of the cart column** (edges are "infinitely large"). An overshoot near it must land on **dead space, not a void**.
- **Permanent money anchor.** Running total / item count / (in split) **Restbetrag** live in a fixed high-contrast anchor, never behind a tap. **Amount-due / change-due is the single largest type on the payment screen**, `.w14-tabular`, ≥4.5:1 for the 80cm read. Split tender shows live `Noch zu zahlen: €X,XX` and the **Abschließen button stays disabled until Restbetrag = €0,00**. *(MS Dynamics; Shopify/Square split-tender; cash-drawer-error research.)*
- **Smart denominations.** BezahlenDialog/AnkaufBezahlenDialog render **4–6 quick-tender chips computed from the total** via `money-core.ts` — `[Passend 23,40] [25] [30] [50] [100]` — tap → instant `Rückgeld: €X,XX`, zero keypad entry for the dominant cash case. One-tap **`Karte`** goes straight to the terminal for full-amount ZVT (no intermediate amount screen). *(MS Dynamics "pay exact".)*
- **EuroInput.** Keys **≥1cm (≥48px) with ≥8–10px gaps**, inner keys slightly larger than edge keys; **numeric keypad only — never a QWERTY keyboard**; accepts the German comma natively (`12,50`); echoes live German formatting `1.234,56 €` (`.w14-tabular`) as the cashier types; **sub-0.1s key feedback** so no one double-taps and double-charges.
- **Dual product path on the luxury grid.** Keep CatalogGrid tiles = **photo + name + price (never bare SKU)** — recognition over recall; a 20-tile grid is fine (read, not memorized — the Miller "7" myth corrected). Add a **sticky typeahead** matching name/SKU/Kategorie on the first 1–2 chars, **frequency-ranked** so a standard 1g-gold or common coin is the top one-tap result. *(Square favorites grid + auto-suggest; NN/g recognition-vs-recall.)*
- **Scan-anywhere (HID wedge).** A top-level scan handler adds the matching product **from ANY focus state in <100ms** (buffer keystrokes ending in CR/TAB, match SKU, append line) — no "tap the search field first." **Dual success feedback** (green flash on the new row + soft tone) and a **distinct error state** ("Unbekannter Code" toast + different tone) — the scanner's own decode-beep confirms a *read*, not a DB *match*. *(Tera/CodeCorp; phantom-success illusion.)*
- **Undo over confirm.** Routine reversible ops (remove line, change qty, clear keypad) = **instant action + 6–10s `Position entfernt — Rückgängig` snackbar**, never a modal. Humans catch the mistake in 1–2s; confirmation dialogs breed click-through habituation. **Reserve modal confirm (+ PIN step-up) strictly for fiscally-irreversible acts:** finalize TSE-signed sale, full Storno of a booked transaction, Kassenabschluss/day-close. *(Raskin "Never Use a Warning When You Mean Undo"; NN/g confirmation.)*
- **Dangerous-proximity / reverse-Fitts.** Storno & refund are **color-coded `--w14-wax-red`, spaced away from Bezahlen, kept out of the bottom thumb cluster** (top-left, behind confirm + PIN). Redundant coding: color + icon + distinct alignment/weight. *(NN/g "Consequential Options Close to Benign Options".)*
- **Progressive disclosure.** BezahlenDialog default = cart + total + one pay action. Rabatt, split-payment, voucher redeem, tax-treatment override live behind a single quiet **`Mehr`**. AppraisalItemForm stages **photo → identify → weigh/price → confirm** (not one giant form). KYC above €2.000 is staged, single-column, labels visible, **pre-filled from any existing customer record**, only GwG-mandatory fields shown. *(NN/g progressive disclosure; Baymard field-count — optimal 7–8, ~4–6% drop per field past the 8th.)*
- **Response & failure states.** Cart add/remove + total = optimistic + instant (<0.1s). TSE-sign / ZVT show **distinct in-pane states** — `wird signiert…` / `Zahlung wird autorisiert…` — with a processing loader; on press, **disable Bezahlen immediately** (reinforces the existing double-pay idempotency guard). **Card decline renders inline in the payment pane with the full cart + entered amounts preserved**: `Zahlung abgelehnt — erneut versuchen oder anderes Zahlmittel?` (retry without re-auth, one tap to switch to cash). Offline-queued sales = **`pending` with a sync badge, never `Fehler`**. *(Nielsen 0.1/1/10s; MS Dynamics in-pane errors; existing ZVT finalize-retry pattern.)*
- **Keyboard+touch hybrid.** Every hot-path action has a stable shortcut **AND** a large touch target, no focus competition: `Enter` = exact-tender/confirm, a clear key for the keypad, F-keys for tender type. Scan / keypad / shortcut all write to the **same cart model with no focus theft**. Document the shortcut map in-app. *(PrehKeyTec; trained owner = keyboard speed, new hire = touch discoverability, one codebase.)*

### Do / Don't
- **Do** keep the cash sale to **≤3 taps** (item card → `Bar` → Kassieren) and treat any common sale needing >3 taps as a bug.
- **Do** run the **squint/blur test** (5–10px Gaussian) on Kasse/Ankauf — only the green Kassieren button and the running total should survive as dominant.
- **Don't** place Storno/refund adjacent to Bezahlen, use a confirmation modal for a removable line, open a QWERTY keyboard for money, or let any hot-path control shift position by cart state.

**Top sources:** NN/g Touch-Target / Fitts / Confirmation-Dialog / Response-Times · MS Dynamics 365 Commerce faster-checkout · Square split-tender & item-grid · Raskin (A List Apart) · WCAG 2.5.5/2.5.8.

---

## 2 · STOREFRONT (public web, gold/coins/antiques, mobile + desktop)
*Next.js at `apps/storefront` (port 4311). Basel's top priority = animation / dazzle — concentrated HERE, while the POS stays quiet.*

**Guiding principle.** Premium feel = perceived trust *before a single price is read* (50ms first impression). The "unlike-anything-before" feeling comes from **extreme restraint executed with sub-pixel precision** — correct durations, asymmetric easing, never stealing the user's scroll, GPU-only properties, one or two *earned* hero moments — not more effects. The product photo *is* the quality signal for high-value gold.

### Concrete rules
- **Conventional commerce grammar (Jakob).** Standard cart/checkout so first-time buyers are instantly oriented; **guest checkout**; **7–8 effective fields**, billing-same-as-shipping default, autofill-friendly, labels visible (not placeholder-only), inline validation on **blur** (not keystroke — ~22% fewer errors). A longer form split into logical steps can outperform a cramped short one by 11–14%. *(Baymard checkout; NN/g form principles.)*
- **One hero CTA per section** (`In den Warenkorb` / `Termin vereinbaren`), filled brass; secondary actions are quiet outline/ghost — never two filled buttons side by side (single-CTA outperforms competing CTAs ~20–30%).
- **Mobile ergonomics.** Sticky **bottom CTA bar 56–64px** (`In den Warenkorb` / checkout) surviving scroll in the green thumb zone (5–12% lift); qty steppers **±48px** with an 8px gap and a directly-tappable number between; filter chips spaced ≥8px so adjacent filters aren't mis-toggled. ~49% one-handed, ~75% thumb-driven. *(Smashing thumb-zone; Baymard mobile checkout.)*
- **Product gallery — zoom is conversion infrastructure.** Keep a **≥2000×2000px master** (not just the display derivative). Desktop magnifier; mobile supports **both pinch AND double-tap**, fetching the high-res tier **on zoom-start** so a coin's mint mark / hallmark stays crisp — never let zoom reveal pixelation (25% of sites fail this). On first mobile image view show a **brief auto-fading German `Doppeltippen zum Zoomen` hint + magnifier icon** (prefer double-tap wording over "pinch"). *(Baymard image-resolution-and-zoom / mobile-image-gestures.)*
- **Performance / loading.** Eager-load **only the LCP hero** with `fetchpriority=high` + preload; lazy-load everything else. Paint a **blur-up LQIP or dominant-color placeholder in the reserved box** — never a blank flash or shifting pop-in (CLS = 0). Use `next/image` (`priority` hero, `blurDataURL`); intake emits the tiny blur placeholder + stores each image's dominant color. *(Cloudfour; DebugBear LCP; Cloudinary blur-up.)*
- **Catalog consistency = trust.** One lighting setup, one background, one color treatment, consistent object scale across every hero — **a QA gate before DRAFT→AVAILABLE**. Inconsistent backgrounds read as a flea-market assortment (fatal for high-value gold). Required shot checklist: **cut-out · in-scale reference · condition macro · certificate/hallmark**. Render condition honestly (34% of high-value returns are "looked different than expected" — over-retouching wins the sale, loses it to a return + a storno that dirties the GoBD books). *(Razor/SiteTuners/TheGood; PhotoRoom/Shopaccino.)*
- **Motion craft (the dazzle, gated).** Time to the NN/g perceptual scale via tokens: **100ms** state feedback (hover/press), **200–300ms** entering content (reveals, drawer, quick-view, add-to-cart), **cap ~400ms** (reserve 400 only for big travel). Anything ≥500ms reads as "a drag." **Asymmetric easing — never linear:** entrances ease-OUT (fast start, gentle settle), exits ease-IN (accelerate away), make entrance ~50ms longer than its exit. Product-card hover lift 100ms; cart drawer slide-in 250–300ms / out 200ms. **GPU-only** (`transform`/`opacity`); never animate layout. **Never hijack scroll.** Concentrate richer motion (hero reveal, the TradingView-style gold-price chart, product transitions) HERE. **Honor `prefers-reduced-motion` everywhere.** *(NN/g animation-duration; Material 3 easing-and-duration; Chrome/MDN perf.)*

### Do / Don't
- **Do** lean product-grid cards on the real **photo**, not a category glyph stamped per card.
- **Don't** lazy-load the hero, scroll-jack, ship a bouncy/spinning transition, or let "elegant" thin hero text drop below 3:1.

**Top sources:** Baymard (checkout-fields, image-zoom, mobile-gestures, mobile-checkout) · NN/g animation-duration · Material 3 motion · Cloudfour/DebugBear LCP · luxury-jewelry photography guides.

---

## 3 · MOBILE-COMPANION (Lager / Zweitkasse / Kundenanzeige — phone/iPad over Wi-Fi)
*Served from `apps/tauri-pos/src-tauri/companion-web`; cart bridge `lib/companion-bridge.ts`. Each paired role opens to ONE job, not a general menu.*

**Guiding principle.** A warehouse picker holding a label gun or a second-cashier holding a customer's item is **effectively one-handed**. Lay out by the **thumb zone**, invert the desktop edge-advantage (a finger doesn't pin to a touch edge), and reuse the *exact* mother-POS keypad/Bezahlen components so muscle memory transfers between stations (Jakob / spatial stability).

### Concrete rules
- **Thumb-zone map (Hoober).** Primary frequent actions (`Scannen` / `Hinzufügen` / `Bestätigen` / `Foto`) in a **bottom sticky bar, green reachable arc, ~56px**; rare/destructive (`Beenden`, delete, settings) exiled to the **top corners (hard red zone)**. List rows **≥48px** with **photo + name + bin/location** so staff recognize the item (and confirm by recognition while holding it in the other hand) rather than recalling where it lives. *(Smashing thumb-zone; NN/g Fitts edge-inversion on touch.)*
- **Targets.** ≥44–48px hit areas, ≥8px spacing; never place a delete/void where a resting thumb sits (swipe-left-to-remove as an accelerator, but a visible delete button always exists too).
- **Repeat-entry intake (EAS: Eliminate→Automate→Simplify).** After save, **keep the form open and carry forward sticky context** (category, metal, bin, supplier, tax_treatment, batch); clear only item-unique fields (title, weight, photo, price) → an N-field form becomes a 3-field form for items 2…n. Explicit **`Duplizieren`** clones everything, change one value. Show a **live batch count + subtotal** (`7 Artikel · 2.340,00 €`). Auto-derive: SKU auto-generated, metal purity → suggested melt price from live rate, category → default tax_treatment, photo → AI-suggested title/condition. *(NN/g EAS; Shopify duplicate-variant.)*
- **Scan as a context-aware verb.** Scan on the list = open that item; in `Wareneingang` mode = increment its quantity; in a sale = add to cart; nothing focused = global find. **Multimodal feedback within ~100ms:** success = chime + single haptic pulse + green row flash + **show item name/photo** (recognition, not re-reading the SKU); failure = *different* error tone + double/longer buzz + red `Unbekannter Code` banner. *(Scandit scan-points; success vs failure must differ in magnitude/frequency.)*
- **Bulk ops at scale.** Persistent action bar pinned above the table once ≥1 row selected, live count; **indeterminate (dash) header checkbox** for partial; explicit select-all scope (`Alle 3.200 Treffer auswählen`); reversible bulk edit/delete fires immediately + **undo toast** (`28 Artikel verschoben — Rückgängig`, 6–8s); per-item success/failure summary on partial failure. *(Eleken bulk-action UX; NN/g consequential-proximity.)*
- **Label printing — template-once, batch-apply, scan-to-verify.** Define the thermal layout once (logo · name · price · bin · 1D barcode + optional QR); print a whole intake batch / multi-select in one action with a queue + reprint-on-demand; **`Platzierung prüfen` step re-reads the freshly printed code**; standardize WHERE the label goes per product type so later scans are reliable. *(LabelFlow; PosNation barcode placement.)*
- **Calm failure.** `Verbindung zur Hauptkasse verloren — Gerät neu koppeln` with the action, never a blank. Cart-bridge updates reflect the mother POS's change **within 400ms or show a syncing shimmer**.

### Do / Don't
- **Do** make scanning one-handed and bottom-anchored; **Do** echo the just-scanned SKU persistently (recognition on the next form).
- **Don't** require tapping a search field before a scan registers, or put confirm and delete in the same thumb arc.

**Top sources:** Smashing thumb-zone · NN/g EAS / data-tables / Fitts · Scandit barcode-inventory · Eleken bulk-actions · Shopify variants.

---

## 4 · CUSTOMER-DISPLAY (read-only second screen facing the buyer)
*Live total over WebSocket (the existing customer-display channel).*

**Guiding principle.** Keep technology in the periphery — glanceable, quiet, calm. The customer-facing surface mirrors the running total with zero decorative noise.

### Concrete rules
- **The total is the hero:** largest element on screen, `.w14-tabular`, ≥4.5:1, readable across the counter. Mirror the cashier's **Restbetrag live during split payment**.
- **No decorative animation.** Line additions get a single calm ~150–200ms ease-out slide (so the customer sees the item registered); **no bounce, no spin** on money surfaces. Success states fade rather than demand a dismiss.
- **Any tap target (if interactive at all) stays bottom-reachable;** otherwise pure read-only.
- **Calm status only:** ambient connection dot, never modal/toast spam to the customer.

**Top sources:** Amber Case Calm-Technology · NN/g visual-hierarchy · Material 3 motion.

---

## 5 · CROSS-CUTTING SYSTEM

### 5a · Iconography & symbol system
**Principle.** Icons are a *recognition aid, not a labeling crutch*. ONE coherent language — single grid, single stroke, single metaphor library — so a glyph means exactly one thing on POS, companion, owner desktop, and storefront.
- **Default: icon + ALWAYS-VISIBLE German label.** Icon-only is a privilege earned only by the universal set (search/magnifier, print, home/back, close-X, +/− qty) at large targets. **Never** hide a label behind hover/tooltip (fails on touch). icon+label = fewest errors + fastest learning. *(NN/g icon-usability — only ~3 icons are near-universal; Tandfonline 2024.)*
- **One grid:** author on **24px grid, 20×20 live area, 2dp padding**, with a 16px dense variant (12px live); ship 16 (Lager rows) / 24 (toolbar/companion) / 32–40 (large cashier tiles, 80cm). Same vector scaled, not redrawn. *(Material system-icons.)*
- **One stroke + join:** lock **2px stroke** on the 24 grid, single rounded join/cap, counter-space ≥ stroke width; **outlined-2px throughout — never mix filled + outlined** on the same surface (matches the clean neutral tokens). *(designsystems.com.)*
- **Optical alignment:** match icon size to adjacent label cap-height; balance on keyline shapes — circular glyphs (coins, the Euro mark) render slightly larger than square ones (boxes, documents) to read as equal weight. *(Apple SF Symbols; keylines.)*
- **Accessibility:** every icon-only control gets a German `aria-label` (`Schließen`, `Menge erhöhen`, `Suchen`); a leading icon on a labeled button is `aria-hidden`.
- **1:1 glyph↔meaning registry** (build it beside `surface-registry.ts`): Ankauf · Verkauf · Lager · Werkstatt · Storno · Rabatt · Bon/Beleg · Kassenabschluss · KYC · eBay-publish · Etikett/Barcode each own **exactly one** glyph reused identically everywhere — no screen invents a local icon, no glyph carries two meanings.
- **Abstract/legal concepts go label-primary** (TSE/GoBD status, §25a/§25c tax treatment, Storno-as-reversal) — a German text chip + optional neutral state dot, **not a clever pictograph** (a wrong guess is a compliance error). Concrete shop metaphors get icons: coin/bar (gold), magnifier (appraise), scale (Bewertung), gem (antiques), printer (Bon). Avoid US-centric metaphors (envelope over mailbox).
- **Don't decorate every row.** Drop the generic per-row product silhouette; use icons only where they carry signal — state badges, KYC check, row actions. Storefront cards rely on the product photo.
- **Validate before shipping icon-only:** out-of-context recognition + weeks-later memorability with real shop staff during the "one real full day" test; any glyph not recognized cold keeps its permanent label.

### 5b · Motion
**Budget split.** POS/fiscal surfaces = **sober, 150–200ms ease-out, no bounce/spin** (`--w14-dur-short/medium`, `--w14-ease-curator`). Storefront = the dazzle, 200–300ms, asymmetric easing, GPU-only. Doherty: acknowledge in <400ms even when the real work (TSE/auth/sync) takes longer. **Honor `prefers-reduced-motion` everywhere** (already wired in `tokens.css`). *(Material 3 easing-and-duration 150–200 desktop / 200–300 mobile; Doherty; Calm Tech.)*

### 5c · Color & type
- **Tiny vocabulary, enforced at the token level.** ≤2 primary + ≤2 secondary colors, **max 3 type sizes** (~14–16 body / 18–22 subhead / up to 32 head), max 3 contrast steps. Codify in `tokens.css`; audit screens for stray font sizes/weights and collapse to the 3-size scale.
- **Red is reserved.** `--w14-wax-red` appears **only** for Storno / KYC-block / low-stock / payment-failure — never decoratively, so its presence always means "attention." (Add a visual/CI audit flagging red used outside danger contexts.)
- **Whitespace is load-bearing** on the existing 8/4 rhythm (`--space-*`): group related controls tight, separate chunks with generous space, **prefer empty space over borders/boxes**. Audit Kasse/Ankauf/Lager for box-in-box clutter; give the total / weight×price line / payout amount each its own calm zone. *(NN/g visual-hierarchy & whitespace; 8pt-grid; ~20% comprehension lift.)*
- **Type renders money as `.w14-tabular`** (tabular figures) everywhere — totals, hashes, SKUs.

### 5d · Accessibility (the floor, not the ceiling)
- **Contrast:** ≥4.5:1 body text, ≥3:1 large text (≥24px or 19px-bold), **≥3:1 UI component borders / input states / focus rings** (WCAG 1.4.3 / 1.4.11). **Audit the "elegant grey" tokens** (`--w14-ink-faded #6b7280`, placeholders, hairline `--w14-rule`): faint-but-premium often fails — bump anything under threshold. The big sale total sits well above 4.5:1 for the 80cm read.
- **Never encode meaning in color alone** (WCAG 1.4.1): pair every status with an icon + German label (red + `Fehlgeschlagen`, green + check) so meaning survives color-blindness and shop glare.
- **Targets:** 24px AA floor everywhere; 44/48px for frequent or money-affecting controls; ≥24px spacing where a small icon button must stay 24px.
- **Focus rings** (`--w14-focus-ring`) clear 3:1 and are always visible; keyboard order = strict reading order.

### 5e · Ergonomics (hardware + body)
- Countertop screen tilted **~30–45°**, set low enough that the forearm rests on the counter; **all hot-path controls in the lower two-thirds**; primary buttons **inset 12–16px from the bezel** to avoid edge-overshoot and all-day gorilla-arm fatigue.
- Design for **gloves / dry fingers / glare / 2× normal tap speed**; a single mis-tap (wrong tile, accidental void) can inflate time-per-customer ~10×, so spend pixels on big stable targets, not density.
- The **Zweitkasse companion reuses the exact same keypad + Bezahlen component and positions** as the mother POS (Jakob / spatial stability — a cashier moving between stations keeps identical muscle memory).

**Top cross-cutting sources:** NN/g icon-usability / bad-icons / visual-hierarchy / aesthetic-minimalist / aesthetic-usability-effect · Material system-icons & motion · Apple HIG / SF Symbols · WCAG 2.2 1.4.3 / 1.4.11 / 2.5.5 / 2.5.8 · Amber Case Calm Technology · Creative-Navy POS-UX (80cm, 2× tap, ×10 error cost) · 8pt-grid.

---

## APPLY-FIRST (prioritized, per surface)

**Cashier-POS**
1. **Permanent money anchor + largest-type total** in BezahlenDialog/AnkaufBezahlenDialog, with live split-pay `Restbetrag` gating the finalize button (disabled until €0,00).
2. **Smart-denomination quick-tender chips + one-tap `Karte`** from `money-core.ts`; verify the **≤3-tap cash path**.
3. **Undo-snackbar for line remove/qty**; reserve modal+PIN confirm only for finalize / Storno / Kassenabschluss.
4. **Storno/refund relocate** out of the bottom thumb cluster, `--w14-wax-red` + icon, spaced ≥24px from Bezahlen.
5. **EuroInput**: ≥48px keys, numeric-only, live `1.234,56 €` formatting, sub-0.1s feedback; freeze keypad/Bezahlen geometry across cart states.
6. **Scan-anywhere HID handler** with distinct success/no-match feedback.

**Storefront**
1. **Sticky 56–64px bottom CTA bar** + ≥48px qty steppers on mobile PDP.
2. **≥2000px zoom master** + pinch & double-tap + auto-fading `Doppeltippen`-hint; no pixelation on zoom.
3. **LCP hero eager + `fetchpriority=high`; blur-up/dominant-color placeholders; CLS=0**; lazy-load the rest.
4. **Guest checkout, 7–8 fields, on-blur inline validation, single hero CTA per section.**
5. **Motion tokens** (`--dur-fast/base/slow`, asymmetric easing) wired; concentrate dazzle on hero + gold chart; `prefers-reduced-motion` honored.

**Mobile-Companion**
1. **Thumb-zone layout** per role: bottom 56px primary bar, destructive/settings top corners, ≥48px rows with photo + bin.
2. **EAS repeat-intake**: sticky carry-forward context + `Duplizieren` + live batch count/subtotal + auto-derived SKU/price/tax.
3. **Context-aware scan** with 100ms multimodal (chime + haptic + green flash + item photo) success and a distinct no-match state.
4. **Bulk action bar** (pinned, live count, indeterminate checkbox, explicit select-all scope, undo toast).
5. **Template-once batch label print + scan-to-verify.**

**Customer-Display**
1. **Total-as-hero** (`.w14-tabular`, ≥4.5:1, counter-readable) mirroring live split-pay Restbetrag.
2. **Strip decorative animation**; single calm 150–200ms line-add; ambient connection dot only.

**Cross-cutting**
1. **Token audit** in `tokens.css`: collapse to ≤3 type sizes, fix sub-threshold greys/borders/focus to ≥4.5:1 / ≥3:1, confine `--w14-wax-red` to danger only.
2. **Build the 1:1 glyph↔concept registry** beside `surface-registry.ts`; convert to icon+visible-label as default, add German `aria-label`s, drop redundant per-row silhouettes.
3. **Squint/blur test pass** on Kasse, Ankauf, storefront hero — confirm the intended element dominates.
4. **Calm-failure copy library** (cause + one recovery action, plain German) replacing every generic `Fehler`.