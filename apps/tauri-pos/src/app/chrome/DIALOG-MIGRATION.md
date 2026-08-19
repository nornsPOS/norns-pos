# Dialog migration checklist (UX P0 → incremental)

The shared `@norns/ui-kit` **`Dialog`** (centered) / **`Sheet`** (right
slide-over) + **Form** primitives (`Field` / `Input` / `Select` / `Textarea` /
`Checkbox`) are the single accessible foundation: focus trap + restore, ESC /
backdrop close, scroll-lock, `aria-modal` + `aria-labelledby`, ≥48px targets.

Every remaining hand-rolled `<div role="dialog">` should migrate to it
incrementally. Behaviour must stay identical (same fields, submit calls,
validation/guards) — only the wrapper changes.

## Done (P0 — proof in production)
- [x] `app/chrome/StepUpModal.tsx` — Dialog core (freeform body; `showClose=false`).
- [x] `screens/kasse/CashMovementDialog.tsx` — Dialog + `DialogBody`/`DialogFooter`
      slots + `Field`/`Input` (the form-primitive proof).

## Remaining DIY dialogs (migrate one per touch, when next edited)
- [ ] `screens/kasse/ZBonDialog.tsx` — two-phase (input → result); Dialog core, keep `EuroInput`.
- [ ] `screens/verkauf/StornoDialog.tsx`
- [ ] `screens/verkauf/BezahlenDialog.tsx` — **payment**: migrate the shell only, do NOT touch finalize/payment logic.
- [ ] `screens/kunden/CustomerCreateDialog.tsx` — strong `Field`/`Input` candidate.
- [ ] `screens/kunden/CustomerEditDialog.tsx`
- [ ] `screens/kunden/CustomerTrustDialog.tsx`
- [ ] `screens/bewertung/AcceptanceDialog.tsx`

## Replaced by the P1 Unified Product Lifecycle `ProductSheet`
- [x] `screens/lager/NeuesProduktDialog.tsx` — **DELETED** → `ProductSheet` (create mode).
- [x] `screens/lager/InventoryAdjustmentDialog.tsx` — **DELETED** → `ProductSheet` (manage mode:
      Bestand + Web&SEO + Etikett + Fotos round-trip + Handel, on the P0 `Sheet`/`Accordion`).
- [ ] `screens/ankauf/AnkaufBezahlenDialog.tsx` — **P1b** (next): wire the same `ProductSheet` into
      the Ankauf post-buy flow and retire `IntakeDraftsTray`.

## Stays bespoke
- `app/chrome/Spotlight.tsx` — a command palette (combobox/listbox), not a form
  dialog. It already sets `role="dialog" aria-modal`, so the number-key nav guard
  (`isAnyDialogOpen`) correctly suppresses while it is open.
