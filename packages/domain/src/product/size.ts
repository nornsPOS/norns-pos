/**
 * Product size classification — a pure, shared derivation so the API, the mobile
 * admin app, the cashier and the storefront ALL agree on what "M" means.
 *
 * The owner enters a product's approximate outer dimensions (length / width /
 * height, in centimetres) + the weight already on the product; from those we
 * derive a single packing SIZE CLASS (S / M / L / XL). The class standardises
 * carton selection for packing + shipping: pick the S box for an S item, etc.
 *
 * Rule: classify by the LONGEST outer edge (the constraining dimension when a
 * box must contain the item), then bump UP one class for a heavy item (a small
 * but dense piece still needs a sturdier, usually larger, carton). Thresholds
 * are tuned for an antiquities / coins / jewellery shop (mostly small items) and
 * are intentionally centralised here so they can be retuned in ONE place.
 */
export type SizeClass = "S" | "M" | "L" | "XL"

export interface ProductDimensions {
  /** Outer length in centimetres. */
  lengthCm?: number | null
  /** Outer width in centimetres. */
  widthCm?: number | null
  /** Outer height in centimetres. */
  heightCm?: number | null
  /** Gross weight in grams (already captured per product). */
  weightGrams?: number | null
}

/** Longest-edge thresholds in cm (inclusive upper bound per class). */
const EDGE_S_CM = 6 // ≤ 6 cm   → S  (a coin, a single ring, a small stamp lot)
const EDGE_M_CM = 15 // ≤ 15 cm → M  (boxed jewellery, a medium piece)
const EDGE_L_CM = 30 // ≤ 30 cm → L  (a larger antiquity)
// > 30 cm → XL

/** A piece at or above this gross weight rides up one class. */
const HEAVY_BUMP_GRAMS = 2000

const BUMP_UP: Record<SizeClass, SizeClass> = { S: "M", M: "L", L: "XL", XL: "XL" }

function positiveEdges(d: ProductDimensions): number[] {
  return [d.lengthCm, d.widthCm, d.heightCm].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
  )
}

/**
 * Derive the packing size class from a product's dimensions + weight.
 * Returns `null` when NO usable dimension is present — never guess a class from
 * weight alone (the owner sees "—", not a fabricated size).
 */
export function deriveSizeClass(d: ProductDimensions): SizeClass | null {
  const edges = positiveEdges(d)
  if (edges.length === 0) return null

  const longest = Math.max(...edges)
  let cls: SizeClass =
    longest <= EDGE_S_CM ? "S" : longest <= EDGE_M_CM ? "M" : longest <= EDGE_L_CM ? "L" : "XL"

  if (typeof d.weightGrams === "number" && Number.isFinite(d.weightGrams) && d.weightGrams >= HEAVY_BUMP_GRAMS) {
    cls = BUMP_UP[cls]
  }
  return cls
}

/** Human label for a size class (German, owner-facing). */
export function sizeClassLabel(c: SizeClass): string {
  switch (c) {
    case "S":
      return "S · klein"
    case "M":
      return "M · mittel"
    case "L":
      return "L · groß"
    case "XL":
      return "XL · sehr groß"
  }
}
