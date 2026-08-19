/**
 * Products domain client. Mirrors the routes from products-list.ts (Day 17)
 * + products-detail.ts (Day 7, post-Freeze additive read) + products.ts PUT.
 *
 *   list(query)  — GET /api/products             paged + filtered
 *   get(id)      — GET /api/products/:id         full record with cost
 *   update(id,b) — PUT /api/products/:id         partial update (Day-13 SEO ok)
 *   reserve(body)— POST /api/inventory/reserve   atomic, race-safe
 *   release(body)— POST /api/inventory/release   session-id-guarded
 *
 * Day 13 (Phase 2.B) additions:
 *   • ProductListRow gains `slug` + `primaryCategory` (breadcrumb hint).
 *   • ProductDetail surfaces full SEO + collector metadata + `categories[]`.
 *   • UpdateProductBody accepts the 13 NULL-able SEO/collector fields so
 *     the Owner can curate them after creation.
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// Common types
// ────────────────────────────────────────────────────────────────────────

export type ProductStatus = 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';
export type Metal = 'gold' | 'silver' | 'platinum' | 'palladium';
export type ReservationChannel = 'POS' | 'STOREFRONT' | 'EBAY';
export type ReleaseReason =
  | 'storefront_checkout_abandoned'
  | 'storefront_payment_failed'
  | 'ebay_offer_rejected'
  | 'pos_cart_cleared'
  | 'admin_manual_release';

/** TaxTreatmentCode values seeded in migration 0005. */
export type TaxTreatmentCode =
  | 'MARGIN_25A'
  | 'INVESTMENT_GOLD_25C'
  | 'STANDARD_19'
  | 'REDUCED_7'
  | 'MIXED'
  | 'REVERSE_CHARGE_13B';

// ────────────────────────────────────────────────────────────────────────
// GET /api/products (list)
// ────────────────────────────────────────────────────────────────────────

/** Lightweight breadcrumb hint surfaced on every list row (Day 13). */
export interface PrimaryCategoryRef {
  id: string;
  slug: string;
  nameDe: string;
}

export interface ProductListRow {
  id: string;
  sku: string;
  /** Day-13 addition: SEO-friendly slug for URL routing. NULL until set. */
  slug: string | null;
  /** Day-13 addition: primary category (storefront breadcrumb hint). */
  primaryCategory: PrimaryCategoryRef | null;
  /** Day-9 addition: surfaced for Lager table + barcode-scanner pinpointing. */
  barcode: string | null;
  /**
   * Primary product photo THUMB rendition as a RELATIVE api path
   * (`/api/photos/<id>/thumb`); NULL when the product has no local primary
   * photo. Prefix with the api-client `baseUrl` to render the Verkauf catalog
   * tile image — the /thumb route is public-by-UUID so an `<img>` can load it.
   */
  primaryPhotoThumbUrl: string | null;
  status: ProductStatus;
  condition: string;
  itemType: string;
  metal: Metal | null;
  weightGrams: string | null;
  listPriceEur: string;
  name: string;
  descriptionDe: string | null;
  // Netzverkaufs-Felder am 14.08.2026 mit der Trennung entfernt (der Motor
  // sendet sie nicht mehr): listedOnStorefront, listedOnEbay,
  // isPublishedToWeb, ebayState, ebayStateChangedAt.
  isCommission: boolean;
  /** Day-9 additions: Lagerort triplet for the Lager table. */
  locationStorageUnit: string | null;
  locationDrawer: string | null;
  locationPosition: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface ProductListResponse {
  items: ProductListRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface ProductListQuery {
  status?: ProductStatus;
  itemType?: string;
  isCommission?: boolean;
  archived?: boolean;
  priceMin?: string;
  priceMax?: string;
  q?: string;
  /** Day-9 addition: exact-match barcode lookup (USB-scanner pinpoint). */
  barcode?: string;
  /**
   * Exakter Treffer auf Artikelnummer ODER Strichcodespalte, beide über ihren
   * eindeutigen Index — der Scanweg der Kasse. Begründung im Routen-Schema
   * (`schemas/product-list.ts`).
   */
  code?: string;
  limit?: number;
  offset?: number;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/inventory-adjustment — Day 9 additive route
// ────────────────────────────────────────────────────────────────────────

export type InventoryAdjustmentReason =
  | 'LOCATION_CHANGE'
  | 'LOST'
  | 'DAMAGED'
  | 'FOUND'
  | 'OPERATOR_NOTE';

export interface InventoryAdjustmentBody {
  reason: InventoryAdjustmentReason;
  /** Mandatory operator rationale, min 8 chars. */
  notes: string;
  /** Only meaningful for reason='LOCATION_CHANGE'. */
  locationStorageUnit?: string;
  locationDrawer?: string;
  locationPosition?: string;
}

export interface InventoryAdjustmentResponse {
  productId: string;
  reason: InventoryAdjustmentReason;
  auditLogId: string;
  loggedAt: string;
  locationStorageUnit: string | null;
  locationDrawer: string | null;
  locationPosition: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/products/:id (detail — Day 7 + Day-13 extensions)
// ────────────────────────────────────────────────────────────────────────

/** One row of the product's category assignment list (Day 13). */
export interface ProductCategoryAssignment {
  id: string;
  slug: string;
  nameDe: string;
  nameEn: string | null;
  isPrimary: boolean;
}

export interface ProductDetail {
  id: string;
  sku: string;
  /** Day-13 addition: SEO slug. NULL until set. */
  slug: string | null;
  barcode: string | null;
  status: ProductStatus;
  condition: string;
  itemType: string;
  metal: Metal | null;
  karatCode: string | null;
  finenessDecimal: string | null;
  weightGrams: string | null;
  feingewichtGrams: string | null;
  /** Outer packing dimensions in cm (drive the derived S/M/L/XL size class). */
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  taxTreatmentCode: string;
  acquisitionCostEur: string;
  listPriceEur: string;
  collectorPremiumEur: string | null;
  name: string;
  descriptionDe: string | null;
  /** 0143 */
  seriennummer: string | null;
  gravur: string | null;
  /** Day-13 i18n addition for storefront EN locale. */
  descriptionEn: string | null;
  // ─── Day-13 SEO surface ────────────────────────────────────────────
  seoTitle: string | null;
  seoDescription: string | null;
  seoTitleEn: string | null;
  seoDescriptionEn: string | null;
  schemaOrgType: string | null;
  // ─── Day-13 collector metadata ─────────────────────────────────────
  yearMintedFrom: number | null;
  yearMintedTo: number | null;
  /** ISO-3166-1 alpha-2 (e.g. "DE", "CH"). */
  originCountry: string | null;
  period: string | null;
  catalogReference: string | null;
  provenanceNotes: string | null;
  // Netzverkaufs-Felder am 14.08.2026 mit der Trennung entfernt (der Motor
  // sendet sie nicht mehr): listedOnStorefront, listedOnEbay,
  // isPublishedToWeb, ebayState, ebayStateChangedAt.
  isCommission: boolean;
  acquiredFromCustomerId: string | null;
  parentProductId: string | null;
  locationStorageUnit: string | null;
  locationDrawer: string | null;
  locationPosition: string | null;
  /** Day-13 addition: every taxonomy node this product is filed under. */
  categories: ProductCategoryAssignment[];
  /**
   * WHO holds the reservation (2026-07-20). NULL unless status='RESERVED'.
   * Web reservations carry the customer's name; POS holds the staff member.
   * `name` may be NULL when the chain cannot be resolved — the channel stays.
   */
  reservedBy: {
    channel: 'POS' | 'STOREFRONT' | 'EBAY' | 'WEB_RESERVATION';
    name: string | null;
    reservedAt: string | null;
    expiresAt: string | null;
  } | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// PUT /api/products/:id (Day 13 — SEO/collector fields editable post-create)
// ────────────────────────────────────────────────────────────────────────

export interface ProductUpdateBody {
  /** 0143: auslassen = behalten, null = leeren. */
  seriennummer?: string | null;
  gravur?: string | null;
  // Existing PUT-allowed fields (intake-locked fields refused by backend).
  condition?: string;
  listPriceEur?: string;
  /** Outer packing dimensions in cm — re-measurable; `null` clears. */
  lengthCm?: string | null;
  widthCm?: string | null;
  heightCm?: string | null;
  name?: string;
  descriptionDe?: string;
  marketingAttributes?: unknown[];
  listedOnStorefront?: boolean;
  listedOnEbay?: boolean;
  /**
   * Phase 2.A / Day-14 — flip storefront visibility. Backend trigger
   * `on_products_publish_to_web` stamps `publishedAt` on the first
   * TRUE flip; subsequent toggles keep the original timestamp.
   */
  isPublishedToWeb?: boolean;
  /** DRAFT → AVAILABLE only; SOLD/RESERVED via inventory routes. */
  status?: 'DRAFT' | 'AVAILABLE';

  // ─── Day-13 SEO + collector metadata extensions ────────────────────
  // Send `null` to clear a previously-set value.
  slug?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoTitleEn?: string | null;
  seoDescriptionEn?: string | null;
  schemaOrgType?: string | null;
  yearMintedFrom?: number | null;
  yearMintedTo?: number | null;
  originCountry?: string | null;
  period?: string | null;
  catalogReference?: string | null;
  provenanceNotes?: string | null;
  descriptionEn?: string | null;
}

export interface ProductUpdateResponse {
  id: string;
  updatedAt: string;
  /** Echo of fields whose values actually changed (server-side diff). */
  changedFields: string[];
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/products (create — Owner-only full intake)
// ────────────────────────────────────────────────────────────────────────

/** Mirrors `ItemType` in apps/api-cloud/src/schemas/product.ts. */
export type ProductItemType =
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

/** Mirrors `ProductCondition` in apps/api-cloud/src/schemas/product.ts. */
export type ProductConditionCode =
  | 'NEW'
  | 'USED_EXCELLENT'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'ANTIQUE_RESTORED'
  | 'ANTIQUE_AS_FOUND';

/** Briefmarken-Erhaltung (migration 0063) — stamp items only. */
export type StampErhaltung = 'POSTFRISCH' | 'FALZ' | 'GESTEMPELT' | 'AUF_BRIEF';

/**
 * POST /api/products body. Intake-locked fields (sku, classification,
 * acquisitionCostEur, isCommission, acquiredFromCustomerId) are settable here
 * ONLY — PUT refuses them. ADMIN-only; step-up when acquisitionCostEur exceeds
 * the transaction step-up threshold (handled transparently by the middleware).
 * Money strings are decimal EUR (e.g. "1999.99"), matching the rest of the
 * products surface — NOT cents.
 */
export interface CreateProductBody {
  /** 19.08.2026: wie viele identische Stuecke entstehen (1 bis 200, je eigene Zeile mit Laufnummern-SKU). */
  stueckzahl?: number;
  // Identity (intake-locked)
  sku: string;
  barcode?: string;
  // Classification (intake-locked)
  itemType: ProductItemType;
  metal?: Metal;
  karatCode?: string;
  finenessDecimal?: string;
  weightGrams?: string;
  /** Outer packing dimensions in cm (drive the derived S/M/L/XL size class). */
  lengthCm?: string;
  widthCm?: string;
  heightCm?: string;
  /** Defaults to [] server-side. */
  hallmarkStamps?: string[];
  // Pricing (acquisitionCostEur intake-locked for §25a integrity)
  acquisitionCostEur: string;
  listPriceEur: string;
  taxTreatmentCode: TaxTreatmentCode;
  // Day-16 fields
  condition: ProductConditionCode;
  /** TRUE = Kommissionsware. Intake-locked. Defaults to false server-side. */
  isCommission?: boolean;
  /** Customer this was bought from (Ankauf). Intake-locked. */
  acquiredFromCustomerId?: string;
  // Storefront presentation
  name: string;
  descriptionDe?: string;
  marketingAttributes?: unknown[];
  // Migration 0063 — Briefmarken + primary category
  stampErhaltung?: StampErhaltung;
  stampMinr?: number;
  /** Writes a product_categories row with is_primary=TRUE in the same tx. */
  primaryCategoryId?: string;
  // Initial channel flags (default off — Owner publishes later via PUT)
  listedOnStorefront?: boolean;
  listedOnEbay?: boolean;
  // Storage location (Lagerort) — optional at intake
  locationStorageUnit?: string;
  locationDrawer?: string;
  locationPosition?: string;
}

export interface CreateProductResponse {
  id: string;
  sku: string;
  status: 'DRAFT' | 'AVAILABLE';
  createdAt: string;
  /** Bei stueckzahl > 1: alle entstandenen Stuecke (das erste zusaetzlich oben). */
  created?: Array<{ id: string; sku: string; status: 'DRAFT' | 'AVAILABLE' }>;
}

// ────────────────────────────────────────────────────────────────────────
// DELETE /api/products/:id — remove an unsold DRAFT (lifecycle clean-up)
// ────────────────────────────────────────────────────────────────────────

export interface ProductDeleteResponse {
  id: string;
  sku: string;
  deletedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/inventory/reserve / release
// ────────────────────────────────────────────────────────────────────────

export interface ReserveBody {
  productId: string;
  channel: ReservationChannel;
  sessionId: string;
}

export interface ReserveResponse {
  productId: string;
  channel: ReservationChannel;
  sessionId: string;
  userId: string | null;
  reservedAt: string;
  expiresAt: string | null;
}

export interface ReleaseBody {
  productId: string;
  sessionId: string;
  reason: ReleaseReason;
}

export interface ReleaseResponse {
  productId: string;
  releasedAt: string;
  reason: ReleaseReason;
}

export interface ReleaseBatchItem {
  productId: string;
  sessionId: string;
}

export interface ReleaseBatchBody {
  items: ReleaseBatchItem[];
  reason: ReleaseReason;
  /** Session token for navigator.sendBeacon (no Authorization header possible). */
  accessToken?: string;
}

export interface ReleaseBatchResponse {
  releasedProductIds: string[];
  failedProductIds: string[];
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

function buildQuery(query: ProductListQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const productsApi = {
  list(client: ApiClient, query: ProductListQuery = {}): Promise<ProductListResponse> {
    return client.request<ProductListResponse>('GET', `/api/products${buildQuery(query)}`);
  },
  /**
   * Owner-only full create (POST /api/products). Step-up auto-enforced by the
   * middleware when acquisitionCostEur exceeds the threshold.
   */
  create(client: ApiClient, body: CreateProductBody): Promise<CreateProductResponse> {
    return client.request<CreateProductResponse>('POST', '/api/products', body);
  },
  get(client: ApiClient, id: string): Promise<ProductDetail> {
    return client.request<ProductDetail>('GET', `/api/products/${encodeURIComponent(id)}`);
  },
  update(client: ApiClient, id: string, body: ProductUpdateBody): Promise<ProductUpdateResponse> {
    return client.request<ProductUpdateResponse>(
      'PUT',
      `/api/products/${encodeURIComponent(id)}`,
      body,
    );
  },
  /**
   * Hard-delete an unsold DRAFT product. The backend refuses anything that is
   * AVAILABLE/RESERVED/SOLD, archived, or referenced by a fiscal transaction.
   */
  remove(client: ApiClient, id: string): Promise<ProductDeleteResponse> {
    return client.request<ProductDeleteResponse>(
      'DELETE',
      `/api/products/${encodeURIComponent(id)}`,
    );
  },
  reserve(client: ApiClient, body: ReserveBody): Promise<ReserveResponse> {
    return client.request<ReserveResponse>('POST', '/api/inventory/reserve', body);
  },
  release(client: ApiClient, body: ReleaseBody): Promise<ReleaseResponse> {
    return client.request<ReleaseResponse>('POST', '/api/inventory/release', body);
  },
  /** Release many reservations in one request (also the awaited path's coalesce). */
  releaseBatch(client: ApiClient, body: ReleaseBatchBody): Promise<ReleaseBatchResponse> {
    return client.request<ReleaseBatchResponse>('POST', '/api/inventory/release/batch', body);
  },
  adjustInventory(
    client: ApiClient,
    productId: string,
    body: InventoryAdjustmentBody,
  ): Promise<InventoryAdjustmentResponse> {
    return client.request<InventoryAdjustmentResponse>(
      'POST',
      `/api/products/${encodeURIComponent(productId)}/inventory-adjustment`,
      body,
    );
  },
};
