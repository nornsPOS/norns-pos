# Warehouse14 — The Official Design System

This is the visual law for the public storefront (`warehouse14-onlineshop`) and
the mobile app (iOS + Android). It is transcribed from the storefront, which is
the canonical reference **for those two surfaces**. When a value here disagrees
with what one of them currently does, the app is wrong — fix the app.

> **The desktop cashier is the exception since 27.07.2026.** By Basel's direct
> decision it carries its own interior voice — inspired by Norns, not copied,
> burgundy on ivory, no gold theme in any form. Its law lives in
> **section 10** below and, executable, in `packages/ui-kit/src/tokens.css`
> (with the mapping tables as comments) and the three guard tests. For the
> cashier, section 10 wins over sections 2–5.

For the storefront and mobile this replaced the old "antique" theme (Cormorant
Garamond, dark gold): their display font is **Bricolage Grotesque**. Any
remaining `Cormorant` strings in the repo are stale comments or `dist/` build
artifacts, not live styling.

---

## 1. Philosophy

One warm ground + one ink + hairlines. Aged paper, **never** pure white.

- **Gilt (gold) is a thread, an edge, a seal — only.** Never a fill, never a
  background, never body text.
- **Functional colors carry meaning only.** Green = positive / up / alive.
  Red = error / down / negative. They are never decoration.
- Restraint over ornament. The page is a museum label, not a poster.

---

## 2. Color tokens

> **Critical technique — define every color twice.** A HEX variable *and* an
> RGB-triplet variable, e.g. `--w14-ink: #1c1c1c` **and**
> `--w14-ink-rgb: 28 28 28`. Tailwind cannot inject an alpha channel onto a
> `var(--hex)`, so in `tailwind.config` colors must be written as
> `rgb(var(--w14-x-rgb) / <alpha-value>)`. Without the RGB triplet, every alpha
> utility (`bg-ink/45`) silently fails.

### Surfaces (warm parchment)
| Token | HEX | RGB | Use |
|---|---|---|---|
| `--w14-parchment` | `#efece3` | `239 236 227` | app ground |
| `--w14-parchment-2` | `#f8f6f1` | `248 246 241` | cards / panels (a half-step lighter) |
| `--w14-parchment-3` | `#e6e2d6` | `230 226 214` | raised / hover (deeper than the ground) |

### Ink (text + strokes)
| Token | HEX | RGB | Use |
|---|---|---|---|
| `--w14-ink` | `#1c1c1c` | `28 28 28` | primary text, dark buttons |
| `--w14-ink-aged` | `#4c4a45` | `76 74 69` | secondary text |
| `--w14-ink-faded` | `#6e6b64` | `110 107 100` | faint / meta |
| `--w14-rule` | `#e9e7e1` | `233 231 225` | hairlines / borders |

### Gilt (thread / edge / seal only)
| Token | HEX | RGB | Use |
|---|---|---|---|
| `--w14-gilt` | `#a3823b` | `163 130 59` | the gold thread |
| `--w14-gilt-deep` | `#876a2c` | `135 106 44` | press / hover |

### Functional (meaning only)
| Token | HEX | RGB | Meaning |
|---|---|---|---|
| `--w14-verdigris` | `#3f6b54` | `63 107 84` | positive / up / alive |
| `--w14-wax-red` | `#c0492f` | `192 73 47` | error / down / negative |
| `--w14-forest` | `#46583f` | `70 88 63` | rare olive accent |
| `--w14-terra` | `#a4633c` | `164 99 60` | rare warm accent |

### Legacy (do not use in new code)
The old `--w14-gold` / `gold-soft` / `gold-deep` now map to dark umber ink
(`#2e2b26` / `#59554d` / `#17150f`) so any stale `*-gold` class reads as quiet ink,
not yellow. In new code use **ink + gilt** directly.

### Resulting Tailwind class names
`bg-surface` · `bg-card` · `bg-raised` · `text-ink` · `text-ink-aged` ·
`text-ink-faded` · `border-rule` · `text-gilt` / `border-gilt` · `text-verdigris` ·
`text-wax-red`.

---

## 3. Typography (fixed — do not change the families)

- **Display / headings (all H1–H3):** Bricolage Grotesque 400–700 →
  `--font-display`.
- **Body:** Inter → `--font-inter`.
- **Numbers, prices, quantities:** JetBrains Mono 400–600 → `--font-mono`, class
  `.tnum` (tabular).
- All three are **self-hosted** (DSGVO, zero CDN).

### Fluid clamp scale
| Step | Value | Use |
|---|---|---|
| step--1 | `0.8125rem` | eyebrow |
| step-0 | `clamp(1rem, 0.98rem + 0.12vw, 1.0625rem)` | body |
| step-1 | `clamp(1.0625rem, 1.02rem + 0.25vw, 1.25rem)` | lead |
| step-2 | `clamp(1.3125rem, 1.18rem + 0.55vw, 1.625rem)` | H3 |
| step-3 | `clamp(1.625rem, 1.36rem + 1.1vw, 2.5rem)` | H2 |
| step-4 | `clamp(2.0625rem, 1.55rem + 2.2vw, 4rem)` | H1 |
| step-5 | `clamp(2.5rem, 1.7rem + 3.4vw, 5.5rem)` | hero |
| step-6 | `clamp(3rem, 1.9rem + 4.6vw, 7.5rem)` | display hero |

Line-height: headings **1.1**, body **1.62**. Eyebrow: letter-spacing **0.14em** +
small-caps. Reading width `--w14-measure: 62ch`.

---

## 4. Spacing, radii, shadows (8pt grid)

- **Space scale** `space-1..7` = `8 / 16 / 24 / 40 / 64 / 96 / 128px`.
- `section-pad` = `clamp(56px, 4vw + 40px, 128px)`;
  `card-pad` = `clamp(20px, 1.5vw + 14px, 28px)`;
  `gutter` = `clamp(20px, 5vw, 40px)`.
- **Radii (one system):** button `8px`, card `12px`, xl2 `20px`.
- **Shadows (only these three):** `shadow-card` (subtle), `shadow-lift` (hover),
  `shadow-modal`.
- Max content width: `max-w-edge` = `1240px`.

---

## 5. Motion (one language)

- **ease-out "curator"** `cubic-bezier(0.16, 1, 0.3, 1)` — entrances (the signature
  curve).
- **ease-hover** `cubic-bezier(0.4, 0, 0.2, 1)` — small interactions.
- Durations: fast `180ms` / base `420ms` / slow `650ms`. Stagger `70ms`.
- Rules: enter **once** (`whileInView once: true`); hover = **one** calm change;
  infinite motion only for continuous meaning; always respect
  `prefers-reduced-motion` (jump to the final state); animate **only** transform +
  opacity.
- **Forbidden:** glow, bloom, gaudy ripple.

---

## 6. Icons (three separate layers — never mixed)

1. **Brand marks** — the official logo elements (viewBox `0 0 2229.59 1539.31`:
   the plate, the WAREHOUSE wordmark, the 14 circle, the lens, the diamond, the
   ruler), `fill="currentColor"`, extracted element-by-element, never redrawn.
2. **Engraved category icons** — hand-carved stroke, strokeWidth `1.5–1.8`, round
   caps, a faint hatch, with **one** accent group that gilds on hover
   (`group-hover:text-gilt`).
3. **Lucide line icons** — header only (user / heart / cart / search), size
   `18` or `20px`, strokeWidth `1.6–1.8`.

Every section opens with a **Kicker** = a gold diamond ◆ + a small-caps line.

---

## 7. Utilities (in `globals.css`, `@layer utilities`)

- `.grain` — a very subtle `feTurbulence` paper texture, opacity `0.12`,
  layout-safe.
- `.eyebrow` — small-caps + tracking.
- `.tnum` — tabular numerals (prices).
- `.measure` — 62ch reading width.
- `.hairline` — a rule-colored border.
- `.reveal` / `.reveal-in` — scroll reveal.
- `.hover-lift` / `.underline-draw` — calm hover.

---

## 8. Applying it per platform

### Desktop cashier (`apps/tauri-pos`) and `packages/ui-kit`
**Follows section 10 (Die Norns-Stimme), not sections 2–5.** The executable
truth is `packages/ui-kit/src/tokens.css`; the app consumes the BUILT package
(`dist/`), so after any tokens edit run
`pnpm --filter @norns/ui-kit build` and verify a new token resolves in
the browser — a stale `dist` serves yesterday's design and nothing errors.

### Mobile (`apps/mobile`, Expo RN + NativeWind)
**Translate faithfully**, keeping the exact hex:

- Put the exact tokens into `src/warehouse14/theme.ts` + `global.css` + the
  NativeWind config.
- Load the three fonts via `expo-font` (Bricolage Grotesque + Inter + JetBrains
  Mono), bundled locally — **no CDN**. The live display family is already
  `BricolageGrotesque_500Medium` / `_600SemiBold` / `_700Bold`.
- Map the fluid clamp scale to responsive RN sizing.
- Implement `.grain` as a cheap tiling paper texture.
- Do motion via reanimated with the **exact** curves / durations above.
- Build the Kicker / diamond opener.
- Keep the palette and philosophy exact: parchment ground, ink text, gilt as
  thread / edge / seal only, functional colors for meaning only.

---

## 9. The one-line test (storefront + mobile)

If a screen has a warm paper ground, ink text, a single gold hairline somewhere,
prices in mono, headings in Bricolage, calm motion, and not one underscore visible
— it is on-system. If it has boxes inside boxes, a gold fill, a glow, or a raw
token in view — it is not.

---

## 10. Die Norns-Stimme der Kasse (desktop cashier, since 27.07.2026)

Decided by Basel: the cashier interior takes its voice from Norns as
**inspiration, not copy** — dark wine red on ivory, **no gold theme in any
form**. Everything below is measured and guarded; the executable source is
`packages/ui-kit/src/tokens.css`.

### Voice
- **Display (headings, names):** Fraunces, variable, local. Hard measured
  limit: its GSUB carries no `tnum` (digit 0 = 1457 units, 1 = 1019) —
  **Fraunces never over money.**
- **Text and EVERY number:** Manrope, variable, local. Money surfaces set
  `tabular-nums lining-nums` explicitly (`.w14-tabular`).
- **Accent:** `--w14-weinrot` `#9c2630` on ivory (`--w14-parchment` `#f2ece1`
  family). At night the wine lightens one step (`#b8404c`) so it reads on
  slate — measured 5,03:1 text, 3,04:1 surface.

### The three ladders (each with a guard that proves red)
- **Type:** `--w14-schrift-fussnote` (9px) … `-buehne` (48px), 17 roles. The
  mapping table lives as comments in tokens.css; `tokens.test.ts` proves the
  table matches the rungs.
- **Spacing:** `--w14-abstand-2 … -128`, 17 rungs including the lived
  half-steps 2/6/10/14 (justified by a census of 1346 raw components).
- **Money sizes:** `--w14-betrag-zeile` (row) / `-spalte` (32–44px, the cart
  total and Rückgeld heroes) / `-gross`.

### Contracts
- **MoneyAmount never forces a size**: default `1em` (inherits), `emphasis` =
  weight 600 + Zeilenstufe, call sites override via `style`. The size belongs
  to the surface.
- **`body { font-size: 1rem }`** — the body rides the root so the text-scale
  lever (`data-text-scale` lg/xl) reaches every inherited size, money
  included. Never pin body to a px literal.
- **Tempo:** base 250ms / slow 300ms / instrument 400ms.

### Guards (all in-repo, all proven red on sabotage)
- `apps/tauri-pos/src/schriftleiter-waechter.test.ts` — every fontSize is an
  existing rung or line-waived (`schriftleiter-frei:` + reason).
- `apps/tauri-pos/src/abstandsleiter-waechter.test.ts` — same law for
  gap/padding (`abstandsleiter-frei:`).
- `packages/ui-kit/src/kontrast-waechter.test.ts` — WCAG pairs + hex/RGB
  twins in lockstep.
- Exempt by reason (paper/artwork, listed inside the guards):
  `ReceiptPreview.tsx`, `Schreiben.tsx`, `zielkarte/instruments.tsx`.

### The cashier one-line test
Ivory ground, wine-red accent carrying the primary action, Fraunces over names
and Manrope over every number, one big total per surface, and no raw font size
or spacing outside the ladders — that is the Kasse. Any gold fill, any second
equally-loud total, any 0.83rem literal — it is not.
