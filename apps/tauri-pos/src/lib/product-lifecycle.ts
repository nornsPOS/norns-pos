/**
 * product-lifecycle — pure derivation of a product's visible lifecycle stage
 * for the unified ProductSheet status chip (UX-REDESIGN §4.1, principle 7:
 * "the item has a lifecycle"). Kept pure + unit-tested so the chip can never
 * drift from the real product state.
 *
 *   Entwurf → Fotos → Bepreist → Veröffentlicht → Reserviert → Verkauft
 *
 * Reuses the locked €0 guard (`isPositivePrice`) so "has a real price" means
 * exactly the same thing here as in the publish decision (DRY).
 */
import { isPositivePrice } from './product-publish.js';

export type LifecycleStage =
  | 'Entwurf'
  | 'Fotos'
  | 'Bepreist'
  | 'Veröffentlicht'
  | 'Reserviert'
  | 'Verkauft';

export interface LifecycleInput {
  status: 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';
  /** Decimal string (German comma tolerated via normalizeDecimal). */
  listPriceEur: string;
  /** Best-effort count of bound product photos; absent ⇒ treated as 0. */
  photoCount?: number;
}

/** The ordered stages, for rendering a progress affordance if desired. */
export const LIFECYCLE_ORDER: readonly LifecycleStage[] = [
  'Entwurf',
  'Fotos',
  'Bepreist',
  'Veröffentlicht',
  'Reserviert',
  'Verkauft',
] as const;

export function deriveLifecycleStage(p: LifecycleInput): LifecycleStage {
  if (p.status === 'SOLD') return 'Verkauft';
  if (p.status === 'RESERVED') return 'Reserviert';
  if (p.status === 'AVAILABLE') return 'Veröffentlicht';
  // DRAFT — refine by what work has been done.
  if (isPositivePrice(p.listPriceEur)) return 'Bepreist';
  if ((p.photoCount ?? 0) > 0) return 'Fotos';
  return 'Entwurf';
}
