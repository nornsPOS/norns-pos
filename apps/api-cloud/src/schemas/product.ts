/**
 * TypeBox schemas for the Product Management API (Day 16).
 *
 *   POST  /api/products                 — full create
 *   PUT   /api/products/:id             — partial update (intake-locked fields refused)
 *   POST  /api/products/:id/archive     — flip archived_at (SOLD only)
 *   POST  /api/products/:id/photos      — request R2 presigned PUT URL
 *
 * Intake-lock policy (mirrors ADR-0015 §7 + ADR-0023 §3):
 *   • `sku`, `acquisitionCostEur`, `taxTreatmentCode`, `itemType`, `metal`,
 *     `karatCode`, `finenessDecimal`, `weightGrams`, `hallmarkStamps`,
 *     `isCommission`, `acquiredFromCustomerId` — settable at POST only.
 *   • `condition`, `listPriceEur`, `name`, `descriptionDe`,
 *     `marketingAttributes`, `listedOnStorefront`, `listedOnEbay`,
 *     `status` (DRAFT→AVAILABLE) — settable at PUT.
 *
 * Decimal strings use the same `^\\d{1,16}(\\.\\d{1,2})?$` rule that the
 * money + tax schemas already enforce.
 */

import { type Static, Type } from '@sinclair/typebox';

import { DecimalString, DimensionString, WeightString } from './money.js';
/**
 * ═══════════════════════════════════════════════════════════════════════
 *  DIE STEUERART EINES PRODUKTS — und warum MIXED hier NICHT hingehört
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `MIXED` ist kein Steuerschlüssel, sondern ein GERÜSTWERT am Belegkopf: er
 * sagt „dieser Beleg trägt mehrere Behandlungen". Ein einzelner Gegenstand
 * kann das nie sein — er ist entweder differenzbesteuert oder nicht.
 *
 * Bis zum 28.07.2026 stand `MIXED` trotzdem in der Artikelmaske zur Auswahl,
 * in `ProductSheet.tsx` und in `NeuesProduktDialog.tsx`. Im Monatslauf
 * gemessen, was dann passiert:
 *
 *     Ein Stück zu 119,00 EUR mit MIXED
 *       → die Kasse rechnet 0,00 EUR Steuer, der Bon weist 0,00 aus
 *       → die Buchungszeile geht auf 8400 (Erlöse 19 %) OHNE Schlüssel
 *
 * Beleg und Buchhaltung widersprechen sich um den vollen Steuerbetrag, ohne
 * eine einzige Fehlermeldung. Es braucht keinen Angreifer — ein Griff in ein
 * Auswahlfeld genügt.
 *
 * Gemessen waren am 28.07.2026 null Produkte betroffen. Das war ein
 * Zeitfenster, kein Dauerzustand: der Riegel schliesst es, BEVOR eine Kasse
 * mit dieser Auswahl bei einem Händler steht.
 */
export const ProductTaxTreatmentCode = Type.Union(
  [
    Type.Literal('MARGIN_25A'),
    Type.Literal('INVESTMENT_GOLD_25C'),
    Type.Literal('STANDARD_19'),
    Type.Literal('REDUCED_7'),
    Type.Literal('REVERSE_CHARGE_13B'),
  ],
  {
    description:
      'Die Steuerart EINES Gegenstands. MIXED fehlt mit Absicht: das ist ein ' +
      'Kopfwert des Belegs, keine Eigenschaft einer Ware.',
  },
);

// ────────────────────────────────────────────────────────────────────────
// Enums on the wire — keep parallel to migration 0006 + 0015
// ────────────────────────────────────────────────────────────────────────

export const ItemType = Type.Union([
  Type.Literal('gold_jewelry'),
  Type.Literal('gold_coin'),
  Type.Literal('gold_bar'),
  Type.Literal('silver_jewelry'),
  Type.Literal('silver_coin'),
  Type.Literal('silver_bar'),
  Type.Literal('platinum_jewelry'),
  Type.Literal('platinum_coin'),
  Type.Literal('platinum_bar'),
  Type.Literal('antique'),
  Type.Literal('watch'),
  Type.Literal('other'),
]);

export const ProductCondition = Type.Union([
  Type.Literal('NEW'),
  Type.Literal('USED_EXCELLENT'),
  Type.Literal('USED_GOOD'),
  Type.Literal('USED_FAIR'),
  Type.Literal('ANTIQUE_RESTORED'),
  Type.Literal('ANTIQUE_AS_FOUND'),
]);

export const Metal = Type.Union([
  Type.Literal('gold'),
  Type.Literal('silver'),
  Type.Literal('platinum'),
  Type.Literal('palladium'),
]);

// VAT-rate-compatible (0..1, up to 4 fractional digits).
export const FinenessString = Type.String({
  pattern: '^(0(\\.\\d{1,4})?|1(\\.0{1,4})?)$',
  examples: ['0.5850', '0.7500', '0.9999'],
  description: 'Metal fineness as a decimal 0..1 (e.g. 585/1000 → "0.5850").',
});

/**
 * Briefmarken-Erhaltung (migration 0063) — the owner's dealer notation:
 * Postfrisch = ⭐⭐ (**), Falz = ⭐ (*), Gestempelt = (,), Auf Brief.
 * Display string e.g. "MiNr. 27 · Postfrisch".
 */
export const StampErhaltung = Type.Union([
  Type.Literal('POSTFRISCH'),
  Type.Literal('FALZ'),
  Type.Literal('GESTEMPELT'),
  Type.Literal('AUF_BRIEF'),
]);

/** Michel catalog number (MiNr.) — positive integer. */
export const StampMinr = Type.Integer({ minimum: 1, maximum: 1_000_000 });

// ────────────────────────────────────────────────────────────────────────
// POST /api/products — CreateProductBody
// ────────────────────────────────────────────────────────────────────────

export const CreateProductBody = Type.Object({
  // Identity (intake-locked after this POST)
  sku: Type.String({ minLength: 1, maxLength: 64 }),
  barcode: Type.Optional(Type.String({ maxLength: 64 })),

  // Classification (intake-locked)
  itemType: ItemType,
  metal: Type.Optional(Metal),
  karatCode: Type.Optional(
    Type.String({ maxLength: 16, description: 'Reference to karat_grades.code (e.g. "K585").' }),
  ),
  finenessDecimal: Type.Optional(FinenessString),
  weightGrams: Type.Optional(WeightString),
  // Outer packing dimensions in cm. Optional; feed the derived S/M/L/XL size
  // class (@norns/domain deriveSizeClass) used to standardise cartons.
  lengthCm: Type.Optional(DimensionString),
  widthCm: Type.Optional(DimensionString),
  heightCm: Type.Optional(DimensionString),
  hallmarkStamps: Type.Array(Type.String({ maxLength: 64 }), { default: [], maxItems: 16 }),
  /**
   * 19.08.2026, Basels Frage nach grossen Stueckzahlen: WIE VIELE identische
   * Stuecke sollen entstehen? Das Datenmodell bleibt unangetastet — eine
   * Zeile IST ein Stueck (die DSFinV-K-Menge bleibt beweisbar 1,000, die
   * atomare Ein-Stueck-Reservierung bleibt wahr). Der Motor legt N Zeilen in
   * EINER Transaktion an, mit Laufnummern-SKUs (-01 bis -NN). Kappe 200 je
   * Aufruf als Schutz vor einem Tippfehler mit vier Nullen.
   */
  stueckzahl: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  /** 0143: Seriennummer, auch beim direkten Anlegen im Lager (sonst waere der Lagerweg das Flickwerk). */
  seriennummer: Type.Optional(Type.String({ maxLength: 64 })),
  /** 0143: Gravur woertlich. */
  gravur: Type.Optional(Type.String({ maxLength: 256 })),

  // Pricing (acquisitionCostEur is intake-locked for §25a integrity)
  acquisitionCostEur: DecimalString,
  listPriceEur: DecimalString,
  taxTreatmentCode: ProductTaxTreatmentCode,

  // New Day-16 fields
  condition: ProductCondition,
  /** TRUE = Kommissionsware. Intake-locked after creation. */
  isCommission: Type.Boolean({ default: false }),
  /** Customer we bought this from (Ankauf). Intake-locked. Nullable for shop-original stock. */
  acquiredFromCustomerId: Type.Optional(Type.String({ format: 'uuid' })),

  // Storefront presentation
  name: Type.String({ minLength: 1, maxLength: 256 }),
  descriptionDe: Type.Optional(Type.String({ maxLength: 8192 })),
  marketingAttributes: Type.Optional(Type.Array(Type.Any(), { default: [] })),

  // ─── Migration 0063: Briefmarken attributes + primary category ─────
  /** Briefmarken-Erhaltung (POSTFRISCH/FALZ/GESTEMPELT/AUF_BRIEF). Stamp items only. */
  stampErhaltung: Type.Optional(StampErhaltung),
  /** Michel-Katalognummer (MiNr.). Stamp items only. */
  stampMinr: Type.Optional(StampMinr),
  /**
   * Primary taxonomy category. Writes a product_categories row with
   * is_primary=TRUE in the same transaction as the product INSERT.
   */
  primaryCategoryId: Type.Optional(Type.String({ format: 'uuid' })),

  // Initial channel flags (default off — Owner publishes later via PUT)
  listedOnStorefront: Type.Boolean({ default: false }),
  listedOnEbay: Type.Boolean({ default: false }),

  // Storage location (Lagerort) — assignable at intake so every item has a
  // designated place. Three-level: unit (Tresor/Vitrine) → drawer (Fach) →
  // position (Box). All optional.
  locationStorageUnit: Type.Optional(Type.String({ maxLength: 64 })),
  locationDrawer: Type.Optional(Type.String({ maxLength: 64 })),
  locationPosition: Type.Optional(Type.String({ maxLength: 64 })),
});
export type CreateProductBody = Static<typeof CreateProductBody>;

export const CreateProductResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sku: Type.String(),
  status: Type.Union([Type.Literal('DRAFT'), Type.Literal('AVAILABLE')]),
  createdAt: Type.String({ format: 'date-time' }),
  /** Bei stueckzahl > 1: ALLE entstandenen Stuecke (das erste steht zusaetzlich oben, Altvertrag). */
  created: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String({ format: 'uuid' }),
        sku: Type.String(),
        status: Type.Union([Type.Literal('DRAFT'), Type.Literal('AVAILABLE')]),
      }),
    ),
  ),
});
export type CreateProductResponse = Static<typeof CreateProductResponse>;

// ────────────────────────────────────────────────────────────────────────
// PUT /api/products/:id — UpdateProductBody (intake-locked fields refused)
// ────────────────────────────────────────────────────────────────────────

export const UpdateProductBody = Type.Object(
  {
    // All fields optional — caller sends only what changes.
    condition: Type.Optional(ProductCondition),
    listPriceEur: Type.Optional(DecimalString),
    // Outer packing dimensions in cm — re-measurable, never intake-locked. `null`
    // clears a measurement. They re-derive the size class on read.
    lengthCm: Type.Optional(Type.Union([DimensionString, Type.Null()])),
    widthCm: Type.Optional(Type.Union([DimensionString, Type.Null()])),
    heightCm: Type.Optional(Type.Union([DimensionString, Type.Null()])),
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    /** Omit = keep current; `null` clears (matches descriptionEn). */
    descriptionDe: Type.Optional(Type.Union([Type.String({ maxLength: 8192 }), Type.Null()])),
    /**
     * 0143: nachtragbar, weil die Nummer oft erst am geoeffneten Gehaeuse
     * oder auf dem Makrofoto lesbar wird. Die Fassung des Ankauftags steht
     * unveraenderlich auf dem gedruckten Beleg. Omit = behalten, null = leeren.
     */
    seriennummer: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
    gravur: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),
    marketingAttributes: Type.Optional(Type.Array(Type.Any())),
    listedOnStorefront: Type.Optional(Type.Boolean()),
    listedOnEbay: Type.Optional(Type.Boolean()),

    /**
     * Phase 2.A storefront gate (migration 0029) — Day-14 admin surface.
     *
     * Flipping TRUE makes the row visible at warehouse14.de (assuming
     * `status = 'AVAILABLE'`). Flipping FALSE hides it instantly. The
     * `on_products_publish_to_web` trigger stamps `published_at` on the
     * first TRUE flip — operator never has to touch two fields.
     *
     * Optional in the PATCH body so callers that only edit (say) the SEO
     * title don't have to echo the current flag. To explicitly toggle,
     * send `true` or `false`.
     */
    isPublishedToWeb: Type.Optional(Type.Boolean()),

    /** DRAFT → AVAILABLE is permitted via this API. RESERVED/SOLD/back-from-SOLD use the inventory/transaction routes. */
    status: Type.Optional(Type.Union([Type.Literal('DRAFT'), Type.Literal('AVAILABLE')])),

    // ─── Day 13 (Phase 2.B) SEO + collector metadata extensions ────────
    // All NOT intake-locked — the operator can tune SEO + collector facts
    // any time post-publish. Pass `null` to clear a previously-set value.
    slug: Type.Optional(
      Type.Union([
        Type.String({ pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', minLength: 1, maxLength: 128 }),
        Type.Null(),
      ]),
    ),
    seoTitle: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),
    seoDescription: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
    schemaOrgType: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
    yearMintedFrom: Type.Optional(
      Type.Union([Type.Integer({ minimum: -3000, maximum: 9999 }), Type.Null()]),
    ),
    yearMintedTo: Type.Optional(
      Type.Union([Type.Integer({ minimum: -3000, maximum: 9999 }), Type.Null()]),
    ),
    originCountry: Type.Optional(Type.Union([Type.String({ pattern: '^[A-Z]{2}$' }), Type.Null()])),
    period: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
    catalogReference: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
    provenanceNotes: Type.Optional(Type.Union([Type.String({ maxLength: 8192 }), Type.Null()])),
    descriptionEn: Type.Optional(Type.Union([Type.String({ maxLength: 8192 }), Type.Null()])),
    seoTitleEn: Type.Optional(Type.Union([Type.String({ maxLength: 256 }), Type.Null()])),
    seoDescriptionEn: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),

    // ─── Migration 0063: Briefmarken attributes + primary category ────
    /** Briefmarken-Erhaltung. `null` clears. */
    stampErhaltung: Type.Optional(Type.Union([StampErhaltung, Type.Null()])),
    /** Michel-Katalognummer (MiNr.). `null` clears. */
    stampMinr: Type.Optional(Type.Union([StampMinr, Type.Null()])),
    /**
     * Primary taxonomy category. Replaces the prior primary atomically
     * (unsets the old is_primary row, upserts the new one). `null`
     * clears the primary flag without removing the membership.
     */
    primaryCategoryId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type UpdateProductBody = Static<typeof UpdateProductBody>;

export const UpdateProductResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  updatedAt: Type.String({ format: 'date-time' }),
  /** Echo of fields whose values actually changed (diff against pre-update row). */
  changedFields: Type.Array(Type.String()),
});
export type UpdateProductResponse = Static<typeof UpdateProductResponse>;

// ────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/archive — ArchiveProductResponse
// ────────────────────────────────────────────────────────────────────────

export const ArchiveProductResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  archivedAt: Type.String({ format: 'date-time' }),
});
export type ArchiveProductResponse = Static<typeof ArchiveProductResponse>;

// ────────────────────────────────────────────────────────────────────────
// DELETE /api/products/:id — DeleteProductResponse
//
// Hard-deletes a DRAFT product that has NEVER been part of a fiscal
// transaction. The route refuses anything else (AVAILABLE/RESERVED/SOLD,
// archived rows, or any row referenced by transaction_items). The owned
// child rows (photos, eBay events, category links) are removed inside the
// same transaction so no FK orphans remain.
// ────────────────────────────────────────────────────────────────────────

export const DeleteProductResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sku: Type.String(),
  deletedAt: Type.String({ format: 'date-time' }),
});
export type DeleteProductResponse = Static<typeof DeleteProductResponse>;

// ────────────────────────────────────────────────────────────────────────
// POST /api/products/:id/photos — RequestPhotoUploadBody
// ────────────────────────────────────────────────────────────────────────

export const RequestPhotoUploadBody = Type.Object({
  /** MIME type the client will PUT. Bound into the presigned signature. */
  contentType: Type.Union([
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('image/webp'),
  ]),
  /** Max bytes (≤ 10 MiB hard cap). Bound into the signature so a tampered upload is refused. */
  contentLength: Type.Integer({ minimum: 1, maximum: 10 * 1024 * 1024 }),
  /** TRUE if this photo should be the storefront primary thumbnail. Partial UNIQUE handles dedupe. */
  isPrimary: Type.Optional(Type.Boolean({ default: false })),
  altTextDe: Type.Optional(Type.String({ maxLength: 256 })),
  altTextEn: Type.Optional(Type.String({ maxLength: 256 })),
});
export type RequestPhotoUploadBody = Static<typeof RequestPhotoUploadBody>;

export const RequestPhotoUploadResponse = Type.Object({
  /** Newly created product_photos.id — caller persists this client-side. */
  photoId: Type.String({ format: 'uuid' }),
  /** R2 key reserved for this photo. */
  r2Key: Type.String(),
  /** Short-TTL presigned PUT URL. */
  uploadUrl: Type.String({ format: 'uri' }),
  /** Final public URL the storefront / Bridge will display. */
  publicUrl: Type.String({ format: 'uri' }),
  /** Headers the client MUST send on the PUT. */
  requiredHeaders: Type.Object({
    'content-type': Type.String(),
  }),
  /** ISO timestamp when the upload URL stops working. */
  expiresAt: Type.String({ format: 'date-time' }),
});
export type RequestPhotoUploadResponse = Static<typeof RequestPhotoUploadResponse>;
