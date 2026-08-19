# Warehouse14 UI conventions — icons & actions

Generic action icons use **lucide-react** (Feather-style refined line icons, MIT,
tree-shakeable) via the ui-kit `Icon` / `IconButton`. The **brand motifs**
(`Seal`, `DiamondRule`, `MagnifierIcon`) stay as-is — they carry identity, not
generic actions.

## When icon-only vs icon + label

- **Icon-only** (`IconButton`, REQUIRES an `aria-label` via `label`) — only for
  **universal, unambiguous** actions where the glyph is self-evident:
  delete (`Trash2`), close (`X`), search (`Search`), add (`Plus`),
  print (`Printer`), back (`ChevronLeft`), edit (`Pencil`), confirm (`Check`).
- **Icon + label** — everything else. A non-obvious action MUST show its word.
  Put the icon before the label inside a normal `Button`.
- **Never** icon-only for a non-obvious or destructive-but-unusual action.

## Rules

1. Every icon-only control has an **`aria-label`** (the `IconButton.label`). It is
   also set as the hover `title`.
2. Icons are **decorative** (`Icon` is `aria-hidden`) — the name lives on the
   surrounding button/control.
3. Touch targets are **≥44px** (`IconButton` enforces `minWidth/minHeight: 44`).
4. Aesthetic: **20px** default, **1.75** stroke-width (matches the hairline ink
   rules), `color: currentColor` so the icon inherits the button/text tone
   (`tone="danger"` → wax-red for destructive).
5. Import the curated set from `@norns/ui-kit` (re-exported), not from
   `lucide-react` directly, so the action vocabulary stays consistent.

## Usage

```tsx
import { IconButton, Trash2, Button, Icon, Plus } from '@norns/ui-kit';

// icon-only, universal action
<IconButton icon={Trash2} label="Position entfernen" tone="danger" onClick={onRemove} />

// icon + label, non-obvious action
<Button onClick={onAdd}><Icon icon={Plus} size={18} /> Neues Produkt</Button>
```

## Swept so far (UX icons phase 1)
- Verkauf cart line → `IconButton` `Trash2` "Position entfernen".
- Lager "+ Neues Produkt" → `Plus` + label.
- ProductSheet / Dialog close → `X` (via the Dialog close affordance).
- Metal ticker detail "Details" → `ChevronLeft`/link kept.

## Remaining checklist (lower-traffic — incremental follow-up)
- [ ] Kasse: "Letzten Beleg erneut drucken" → `Printer` + label.
- [ ] Lager search field → unify `MagnifierIcon` usages with `Search` (decide one).
- [ ] ZBonDialog / CustomerDialogs close X's → `X` IconButton.
- [ ] Ankauf IntakeList item remove → `Trash2`.
- [ ] Fotos / eBay toolbars → `Pencil` / `Check` where universal.
- [ ] Back-links on deep routes → `ChevronLeft`.
