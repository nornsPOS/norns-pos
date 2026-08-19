/**
 * TypeBox schemas for the unified catalog: GET /api/products (Day 17).
 *
 * Shared query surface for:
 *   • POS (Tauri) — filter by status=AVAILABLE, search by SKU/name.
 *   • Storefront (Next.js) — filter by listed_on_storefront=TRUE + status=AVAILABLE.
 *   • Control Desktop (Bridge) — full filter surface, including archived rows.
 *
 * Pagination: limit (max 200) + offset. cursor pagination is a Phase 1.5
 * optimization; for single-shop volumes limit/offset is fine.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString, WeightString } from './money.js';
import { ItemType, ProductCondition, StampErhaltung } from './product.js';

export const ProductStatus = Type.Union([
  Type.Literal('DRAFT'),
  Type.Literal('AVAILABLE'),
  Type.Literal('RESERVED'),
  Type.Literal('SOLD'),
]);

export const ProductListQuery = Type.Object({
  // Filters — all optional, ANDed together.
  status: Type.Optional(ProductStatus),
  condition: Type.Optional(ProductCondition),
  itemType: Type.Optional(ItemType),
  isCommission: Type.Optional(Type.Boolean()),
  /** TRUE = only archived; FALSE = only active; omitted = both. */
  archived: Type.Optional(Type.Boolean()),
  /** EUR price range (inclusive). NUMERIC(18,2) strings. */
  priceMin: Type.Optional(DecimalString),
  priceMax: Type.Optional(DecimalString),
  /** Free-text search over name + description_de + sku + barcode (ILIKE). */
  q: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  /**
   * Exact match against `products.barcode` — used by the Lager surface's
   * USB-barcode-scanner integration (Day 9). Distinct from `q` which is
   * substring-ILIKE; barcode scans need exact-match semantics so the
   * scanner pinpoints a single row.
   */
  barcode: Type.Optional(Type.String({ maxLength: 64 })),
  /**
   * Exakter Treffer auf Artikelnummer ODER Strichcodespalte — der Scanweg der
   * Kasse (19.08.2026).
   *
   * Warum `barcode` oben nicht genügt: das gedruckte Etikett trägt einen
   * Code128 der ARTIKELNUMMER, nicht der Strichcodespalte. Ein Scan über
   * `barcode` ginge fast immer leer aus, und deshalb schickte die Kasse den
   * Scan bisher als `q` — vier ILIKE mit führendem Prozentzeichen, die kein
   * Index tragen kann, zweimal ausgeführt (Liste und Zählung). Je PIEPS zwei
   * volle Durchläufe über den Bestand; bei 20.000 Stücken spürbar, und es
   * wächst linear.
   *
   * Dieses Feld trifft beide eindeutigen Indizes (`products_sku_uq`,
   * `products_barcode_uq`) — zwei Indexzugriffe statt zwei Bestandsläufen.
   */
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),

  // Pagination
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});
export type ProductListQuery = Static<typeof ProductListQuery>;

/** Lightweight product summary — what the catalog list returns per row. */
export const ProductListItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sku: Type.String(),
  /** Day-13 addition: SEO-friendly slug for URL routing. NULL until set. */
  slug: Type.Union([Type.String(), Type.Null()]),
  /** Day-13 addition: primary category ref (storefront breadcrumb hint). */
  primaryCategory: Type.Union([
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      slug: Type.String(),
      nameDe: Type.String(),
    }),
    Type.Null(),
  ]),
  /** Day-9 addition: surfaced so the Lager table column + scanner UI can show. */
  barcode: Type.Union([Type.String(), Type.Null()]),
  /**
   * Primary product photo THUMB rendition, as a relative API path
   * (`/api/photos/<id>/thumb`) — same shape as routes/photos.ts serializePhoto,
   * minus the host. Only emitted for `storage_kind='local'` rows that are
   * flagged `is_primary`; NULL when the product has no local primary photo.
   * The POS prefixes it with its api-client baseUrl to render the catalog tile
   * image (the /thumb route is public-by-UUID, so an `<img>` can load it).
   */
  primaryPhotoThumbUrl: Type.Union([Type.String(), Type.Null()]),
  status: ProductStatus,
  condition: ProductCondition,
  itemType: ItemType,
  metal: Type.Union([
    Type.Literal('gold'),
    Type.Literal('silver'),
    Type.Literal('platinum'),
    Type.Literal('palladium'),
    Type.Null(),
  ]),
  weightGrams: Type.Union([WeightString, Type.Null()]),
  listPriceEur: DecimalString,

  /**
   * Der aus dem TAGESKURS gerechnete Verkaufspreis, wenn es einen gibt.
   *
   * ⚠️ Er ERSETZT `listPriceEur` nicht, er steht DANEBEN. Der gespeicherte
   * Preis bleibt, was er ist; die Fläche entscheidet, was sie zeigt, und
   * kann beide nebeneinander stellen. Ein stilles Überschreiben hätte
   * niemand mehr nachvollziehen können.
   *
   * `null` heisst: für dieses Stück wird nicht gerechnet. Warum, sagt
   * `kurspreisGrund` — nie geraten, nie erfunden.
   */
  kurspreisEur: Type.Union([DecimalString, Type.Null()]),

  /**
   * Der Grund, wenn kein Kurspreis gerechnet wurde. Ein Kennwort, zu dem
   * `KEIN_KURSPREIS_SATZ` den deutschen Satz führt; die Fläche zeigt nie
   * das Kennwort selbst.
   */
  kurspreisGrund: Type.Union([
    Type.Literal('kein_metall'),
    Type.Literal('kein_gewicht'),
    Type.Literal('kein_feingehalt'),
    Type.Literal('kein_tageskurs'),
    Type.Literal('aufschlag_unplausibel'),
    Type.Literal('fest_gepflegt'),
    Type.Null(),
  ]),

  /** Folgt dieses Stück dem Kurs? (Wanderung 0132.) */
  festerPreis: Type.Boolean(),
  name: Type.String(),
  descriptionDe: Type.Union([Type.String(), Type.Null()]),
  // ─── Migration 0063: Briefmarken + collector facts for the POS tile ──
  /** Erhaltung: POSTFRISCH (**), FALZ (*), GESTEMPELT (,), AUF_BRIEF. NULL für Nicht-Briefmarken. */
  stampErhaltung: Type.Union([StampErhaltung, Type.Null()]),
  /** Michel-Katalognummer (MiNr.) — display "MiNr. 27 · Postfrisch". */
  stampMinr: Type.Union([Type.Integer(), Type.Null()]),
  yearMintedFrom: Type.Union([Type.Integer(), Type.Null()]),
  yearMintedTo: Type.Union([Type.Integer(), Type.Null()]),
  originCountry: Type.Union([Type.String(), Type.Null()]),
  period: Type.Union([Type.String(), Type.Null()]),
  catalogReference: Type.Union([Type.String(), Type.Null()]),
  // Die Netzverkaufs-Felder der Zeile (listedOnStorefront, listedOnEbay,
  // isPublishedToWeb, ebayState, ebayStateChangedAt) wurden am 14.08.2026 mit
  // der Trennung von warehouse14 ausgetragen: die Kanaele existieren nicht
  // mehr, keine Flaeche der Kasse las sie. Die SPALTEN in `products` bleiben
  // gespeicherter Zustand und warten auf ihre eigene Wanderung.
  isCommission: Type.Boolean(),
  /** Day-9 additions: location fields for the Lager Lagerort column. */
  locationStorageUnit: Type.Union([Type.String(), Type.Null()]),
  locationDrawer: Type.Union([Type.String(), Type.Null()]),
  locationPosition: Type.Union([Type.String(), Type.Null()]),
  archivedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});
export type ProductListItem = Static<typeof ProductListItem>;

export const ProductListResponse = Type.Object({
  items: Type.Array(ProductListItem),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});
export type ProductListResponse = Static<typeof ProductListResponse>;
