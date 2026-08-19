/**
 * Shared German display labels + option list for a product's item type.
 *
 * Single source for every operator-facing surface (Lager table, product
 * sheet, intake drafts). Branch HERE — not at the call site — so the
 * surfaces stay drift-free.
 */

import { germanLabel } from '@norns/i18n-de';

export type ItemType =
  | 'gold_jewelry'
  | 'gold_coin'
  | 'gold_bar'
  | 'silver_jewelry'
  | 'silver_coin'
  | 'silver_bar'
  | 'platinum_jewelry'
  | 'platinum_coin'
  | 'platinum_bar'
  | 'antique'
  | 'watch'
  | 'other';

export const ITEM_TYPE_LABEL: Readonly<Record<ItemType, string>> = Object.freeze({
  gold_jewelry: 'Goldschmuck',
  gold_coin: 'Goldmünze',
  gold_bar: 'Goldbarren',
  silver_jewelry: 'Silberschmuck',
  silver_coin: 'Silbermünze',
  silver_bar: 'Silberbarren',
  platinum_jewelry: 'Platinschmuck',
  platinum_coin: 'Platinmünze',
  platinum_bar: 'Platinbarren',
  antique: 'Antiquität',
  watch: 'Uhr',
  other: 'Sonstiges',
});

export const ITEM_TYPE_OPTIONS: ReadonlyArray<{ value: ItemType; label: string }> = Object.freeze(
  (Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((value) => ({
    value,
    label: ITEM_TYPE_LABEL[value],
  })),
);

/**
 * Graceful display label for a possibly-unknown item-type value. Use this on
 * any operator-facing surface that renders a product's `itemType` straight from
 * the API — it maps the known DB enum values to their German label and, for an
 * unmapped value, shows "Unbekannt" (never a raw `gold_jewelry` leak).
 */
export function itemTypeLabel(value: string | null | undefined): string {
  if (!value) return '-';
  return germanLabel(ITEM_TYPE_LABEL, value, 'Unbekannt');
}

// ─────────────────────────────────────────────────────────────────────────
// Condition (Zustand) — the product `condition` DB enum (migration 0015).
// ─────────────────────────────────────────────────────────────────────────

export type Condition =
  | 'NEW'
  | 'USED_EXCELLENT'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'ANTIQUE_RESTORED'
  | 'ANTIQUE_AS_FOUND';

export const CONDITION_LABEL: Readonly<Record<Condition, string>> = Object.freeze({
  NEW: 'Neu',
  USED_EXCELLENT: 'Gebraucht, sehr gut',
  USED_GOOD: 'Gebraucht, gut',
  USED_FAIR: 'Gebraucht, mäßig',
  ANTIQUE_RESTORED: 'Antik, restauriert',
  ANTIQUE_AS_FOUND: 'Antik, Fundzustand',
});

export const CONDITION_OPTIONS: ReadonlyArray<{ value: Condition; label: string }> = Object.freeze(
  (Object.keys(CONDITION_LABEL) as Condition[]).map((value) => ({
    value,
    label: CONDITION_LABEL[value],
  })),
);

/**
 * Graceful display label for a possibly-unknown condition value. Mirrors
 * `itemTypeLabel` — shows "Unbekannt" for an unmapped value instead of leaking
 * the raw SCREAMING_SNAKE_CASE enum.
 */
export function conditionLabel(value: string | null | undefined): string {
  if (!value) return '-';
  return germanLabel(CONDITION_LABEL, value, 'Unbekannt');
}
