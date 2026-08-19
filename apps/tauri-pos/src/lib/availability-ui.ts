/**
 * Verfügbarkeit — the one shared model of „was ist verkäuflich" on desktop
 * (ported from apps/mobile/src/warehouse14/availability-ui.ts, decoupled from
 * the mobile Badge type). An article is only sellable when its lifecycle status
 * is exactly AVAILABLE. RESERVED is held by a live session (may free up), SOLD
 * has left the inventory, DRAFT is not yet released. Both the Lager catalog and
 * the Verkauf picker read THIS module so the verdict — and its honest German
 * reason — never drifts between screens.
 *
 * Pure + presentational only: status → label/reason and a live-count shape.
 * No fetching, no fabricated number; the caller passes real wire values.
 */
import type { ProductStatus } from '@norns/api-client';

/** The ONE status from which an article can be reserved → sold. */
export const SELLABLE_STATUS: ProductStatus = 'AVAILABLE';

/** TRUE only for AVAILABLE stock — the single gate the sell flow trusts. */
export function isSellable(status: ProductStatus | string | null | undefined): boolean {
  return status === SELLABLE_STATUS;
}

/** The three first-class availability buckets (DRAFT is an editing state, not a bucket). */
export type AvailabilityBucket = 'AVAILABLE' | 'RESERVED' | 'SOLD';

/** Semantic tone the surface maps to its own antique palette. */
export type AvailabilityTone = 'available' | 'held' | 'gone';

export interface AvailabilityBucketMeta {
  bucket: AvailabilityBucket;
  /** German one-word label, e.g. „Verfügbar". */
  label: string;
  tone: AvailabilityTone;
}

/** The buckets in scan-verdict order: what you can sell, what's held, what's gone. */
export const AVAILABILITY_BUCKETS: readonly AvailabilityBucketMeta[] = [
  { bucket: 'AVAILABLE', label: 'Verfügbar', tone: 'available' },
  { bucket: 'RESERVED', label: 'Reserviert', tone: 'held' },
  { bucket: 'SOLD', label: 'Verkauft', tone: 'gone' },
];

/**
 * Why a non-AVAILABLE row cannot be added to the cart — an honest German line,
 * never a raw token. AVAILABLE returns null (it IS sellable). Any unknown/future
 * status degrades to a calm, truthful catch-all.
 */
export function notSellableReason(
  status: ProductStatus | string | null | undefined,
): string | null {
  switch (status) {
    case 'AVAILABLE':
      return null;
    case 'RESERVED':
      return 'Reserviert in einer laufenden Sitzung gehalten, nicht verkäuflich.';
    case 'SOLD':
      return 'Bereits verkauft nicht mehr im Bestand.';
    case 'DRAFT':
      return 'Entwurf noch nicht für den Verkauf freigegeben.';
    default:
      return 'Zurzeit nicht verkäuflich.';
  }
}

// ── Live counts (Verfügbar/Reserviert/Verkauft + Bestand gesamt) ──────────────

/** The shape both screens render. Every field is a real `total` from the wire. */
export interface InventoryCounts {
  available: number;
  reserved: number;
  sold: number;
  /** Sum of the three sellable-relevant buckets (excludes DRAFT). */
  inStock: number;
}

export const EMPTY_INVENTORY_COUNTS: InventoryCounts = {
  available: 0,
  reserved: 0,
  sold: 0,
  inStock: 0,
};

/** Assemble counts from the three bucket totals (inStock is derived, never guessed). */
export function makeInventoryCounts(parts: {
  available: number;
  reserved: number;
  sold: number;
}): InventoryCounts {
  return {
    available: parts.available,
    reserved: parts.reserved,
    sold: parts.sold,
    inStock: parts.available + parts.reserved + parts.sold,
  };
}

/** The live count for a single bucket — used to label the Lager status chips. */
export function bucketCount(counts: InventoryCounts | null, bucket: AvailabilityBucket): number {
  if (counts == null) return 0;
  return bucket === 'AVAILABLE'
    ? counts.available
    : bucket === 'RESERVED'
      ? counts.reserved
      : counts.sold;
}
