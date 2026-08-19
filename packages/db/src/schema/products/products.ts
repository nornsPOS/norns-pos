/**
 * products — the inventory authority.
 *
 * One row per unique item. State machine: DRAFT → AVAILABLE → RESERVED → SOLD
 * (back to AVAILABLE on reservation cancel/timeout). Atomic reservation lives
 * in @norns/inventory-lock — never write to `status` from outside that
 * package.
 *
 * Updatable from the app role (per migration 0006 §4):
 *   • state machine + reservation envelope (5 cols)
 *   • lifecycle markers (published_at, sold_at)
 *   • channel projections (listed_on_*, ebay_listing_id)
 *   • admin fields (name, description_de, marketing_attributes, list_price_eur)
 *
 * NOT updatable (intake-locked / fiscal integrity):
 *   • sku, barcode (identity)
 *   • tax_treatment_code, item_type, metal, karat_code, fineness_decimal,
 *     weight_grams, hallmark_stamps (classification)
 *   • acquisition_cost_eur (§25a margin tax — must be immutable)
 *   • intake_session_id, created_at
 *
 * NEVER DELETE: full audit trail of inventory.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { customers } from '../customers/customers.js';
import { karatGrades } from '../reference/karatGrades.js';
import { taxTreatmentCodes } from '../reference/taxTreatmentCodes.js';
import {
  ebayListingState,
  itemType,
  productCondition,
  productStatus,
  reservationChannel,
} from './enums.js';

export const products = pgTable(
  'products',
  {
    id: primaryKey(),

    // Identity
    sku: text('sku').notNull(),
    barcode: text('barcode'),

    // State machine
    status: productStatus('status').notNull().default('DRAFT'),

    // Reservation envelope — populated when status = 'RESERVED'.
    reservedByChannel: reservationChannel('reserved_by_channel'),
    reservedBySessionId: uuid('reserved_by_session_id'),
    reservedByUserId: uuid('reserved_by_user_id').references(() => users.id),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    reservationExpiresAt: timestamp('reservation_expires_at', { withTimezone: true }),

    // Classification (intake-locked)
    taxTreatmentCode: text('tax_treatment_code')
      .notNull()
      .references(() => taxTreatmentCodes.code),
    itemType: itemType('item_type').notNull(),
    metal: text('metal'),
    karatCode: text('karat_code').references(() => karatGrades.code),
    finenessDecimal: numeric('fineness_decimal', { precision: 5, scale: 4 }),
    weightGrams: numeric('weight_grams', { precision: 10, scale: 4 }),
    // Outer packing dimensions in centimetres. Nullable — only set when the
    // owner measures the item. They feed the derived packing size class
    // (S/M/L/XL via @norns/domain `deriveSizeClass`) so cartons can be
    // standardised for packing + shipping. Not stored as a column: the class is
    // derived on read from these three so the rule lives in exactly one place.
    lengthCm: numeric('length_cm', { precision: 7, scale: 1 }),
    widthCm: numeric('width_cm', { precision: 7, scale: 1 }),
    heightCm: numeric('height_cm', { precision: 7, scale: 1 }),
    hallmarkStamps: text('hallmark_stamps').array().notNull().default(sql`'{}'::text[]`),

    /** 0143: Seriennummer des Stuecks (GwG-Zuordnung, kein Schluessel). NULL: traegt keine. */
    seriennummer: text('seriennummer'),
    /** 0143: Gravur woertlich. Beschreibung, keine Identitaet; nie in der DSFinV-K-Ausfuhr. */
    gravur: text('gravur'),

    // Pricing
    acquisitionCostEur: numeric('acquisition_cost_eur', { precision: 18, scale: 2 }).notNull(),
    listPriceEur: numeric('list_price_eur', { precision: 18, scale: 2 }).notNull(),

    // Storefront presentation
    name: text('name').notNull(),
    descriptionDe: text('description_de'),
    marketingAttributes: jsonb('marketing_attributes').notNull().default(sql`'[]'::jsonb`),

    // 19.08.2026: hier lag eine Aehnlichkeits-Spalte (embedding) aus dem
    // Webshop-Erbe — nie von einem Weg dieser Kasse gelesen oder gefuellt.
    // Ausgezogen mit Wanderung 0149.

    // Channel projections
    listedOnStorefront: boolean('listed_on_storefront').notNull().default(false),
    listedOnEbay: boolean('listed_on_ebay').notNull().default(false),
    ebayListingId: text('ebay_listing_id'),

    /**
     * Folgt dieses Stück dem Metall-Tageskurs, oder behält es seinen festen
     * Preis? (Wanderung 0132, Basels Entscheidung 05.08.2026.)
     *
     * `false` heisst: der Preis wird gerechnet, Feingewicht × Tageskurs +
     * Aufschlag. Das ist die Vorgabe, denn genau darum ging es Basel: sein
     * Bestand soll mit dem Kurs mitgehen statt eingefroren zu bleiben.
     *
     * `true` ist der seltene Fall — eine Uhr, eine Antiquität, ein
     * Sammlerstück, dessen Wert nicht am Materialwert hängt. Das Metall
     * bleibt am Stück (es gehört zur Beschreibung und zum Ankaufbeleg), nur
     * der Preis folgt ihm nicht.
     *
     * ⚠️ Gilt NUR für Lagerware. Ein abgeschlossener Beleg trägt für immer
     * die gebuchte Zahl.
     */
    festerPreis: boolean('fester_preis').notNull().default(false),

    // Provenance
    intakeSessionId: uuid('intake_session_id'),

    // Day-16 fields (migration 0015)
    condition: productCondition('condition').notNull().default('USED_GOOD'),
    isCommission: boolean('is_commission').notNull().default(false),
    acquiredFromCustomerId: uuid('acquired_from_customer_id').references(() => customers.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    // Day-22 fields (migration 0020): Konvolut + Lagerort
    parentProductId: uuid('parent_product_id'),
    locationStorageUnit: text('location_storage_unit'),
    locationDrawer: text('location_drawer'),
    locationPosition: text('location_position'),
    locationAssignedAt: timestamp('location_assigned_at', { withTimezone: true }),

    // Day-23 fields (migration 0021): Edelmetall-Kursmodul
    /**
     * GENERATED ALWAYS AS (weight_grams × fineness_decimal) STORED.
     * NULL when either operand is NULL. NEVER settable directly — Postgres
     * rejects any INSERT/UPDATE that targets this column.
     */
    feingewichtGrams: numeric('feingewicht_grams', { precision: 10, scale: 4 }).generatedAlwaysAs(
      sql`CASE WHEN weight_grams IS NULL OR fineness_decimal IS NULL THEN NULL ELSE weight_grams * fineness_decimal END`,
    ),
    /** Sammleraufschlag — operator-set premium over scrap value. NULL = "use list_price − schmelzwert". */
    collectorPremiumEur: numeric('collector_premium_eur', { precision: 18, scale: 2 }),

    // Day-24 fields (migration 0022): eBay listing state machine
    /**
     * Realized eBay listing lifecycle (9 states). NULL = the product has
     * never been listed. The legacy `listedOnEbay` boolean survives as the
     * operator-intent flag — to be folded into a GENERATED column in
     * Phase 1.5 #I-19.
     */
    ebayState: ebayListingState('ebay_state'),
    ebayStateChangedAt: timestamp('ebay_state_changed_at', { withTimezone: true }),

    // ───────────────────────────────────────────────────────────────
    // Day-13 fields (migration 0026): SEO + collector metadata.
    // Closes audit §11 W-2/W-3/W-4. All NULL-able; existing rows
    // backfilled with slug = `p-<sanitised-sku>`. Not intake-locked —
    // operator may tune SEO + collector facts post-publish.
    // ───────────────────────────────────────────────────────────────
    slug: text('slug'),
    seoTitle: text('seo_title'),
    seoDescription: text('seo_description'),
    schemaOrgType: text('schema_org_type'),
    yearMintedFrom: integer('year_minted_from'),
    yearMintedTo: integer('year_minted_to'),
    originCountry: text('origin_country'),
    period: text('period'),
    catalogReference: text('catalog_reference'),
    provenanceNotes: text('provenance_notes'),
    descriptionEn: text('description_en'),
    seoTitleEn: text('seo_title_en'),
    seoDescriptionEn: text('seo_description_en'),

    // Lifecycle
    publishedAt: timestamp('published_at', { withTimezone: true }),
    soldAt: timestamp('sold_at', { withTimezone: true }),

    // ───────────────────────────────────────────────────────────────
    // Migration 0063: Briefmarken stamp attributes. Both NULL-able —
    // only stamp products carry them. Erhaltung uses the dealer
    // notation: POSTFRISCH (**), FALZ (*), GESTEMPELT (,), AUF_BRIEF.
    // stamp_minr = Michel catalog number ("MiNr. 27").
    // ───────────────────────────────────────────────────────────────
    stampErhaltung: text('stamp_erhaltung'),
    stampMinr: integer('stamp_minr'),

    // ───────────────────────────────────────────────────────────────
    // Phase 2.A storefront gate (migration 0029).
    //
    // SINGLE source-of-truth flag for "show this SKU on warehouse14.de".
    // The storefront catalog route's WHERE clause is exactly this column
    // + `status = 'AVAILABLE'`. The BEFORE-UPDATE trigger
    // `on_products_publish_to_web` stamps `publishedAt` on the first
    // TRUE flip so the sitemap.lastmod stays stable across re-publishes.
    // ───────────────────────────────────────────────────────────────
    isPublishedToWeb: boolean('is_published_to_web').notNull().default(false),

    ...timestamps(),
  },
  (table) => ({
    skuUq: uniqueIndex('products_sku_uq').on(table.sku),
    barcodeUq: uniqueIndex('products_barcode_uq').on(table.barcode),

    statusAvailableIdx: index('products_status_available_idx')
      .on(table.createdAt.desc())
      .where(sql`${table.status} = 'AVAILABLE'`),

    reservationExpiresIdx: index('products_reservation_expires_idx')
      .on(table.reservationExpiresAt)
      .where(sql`${table.status} = 'RESERVED' AND ${table.reservationExpiresAt} IS NOT NULL`),

    // Migration 0072: backs the stale-POS-hold reclaim sweep (autoReleaseStalePos)
    // — POS holds are TTL-less, so they are reclaimed by `reserved_at` age.
    posReservedAtIdx: index('products_pos_reserved_at_idx')
      .on(table.reservedAt)
      .where(sql`${table.status} = 'RESERVED' AND ${table.reservedByChannel} = 'POS'`),

    taxTreatmentIdx: index('products_tax_treatment_idx').on(table.taxTreatmentCode),

    listedOnEbayIdx: index('products_listed_on_ebay_idx')
      .on(table.listedOnEbay)
      .where(sql`${table.listedOnEbay} = TRUE`),

    // State-machine invariants (DB-enforced, bypass-proof)
    availableNoReservation: check(
      'products_available_no_reservation',
      sql`${table.status} <> 'AVAILABLE' OR (
        ${table.reservedByChannel}    IS NULL AND
        ${table.reservedBySessionId}  IS NULL AND
        ${table.reservedAt}           IS NULL AND
        ${table.reservationExpiresAt} IS NULL
      )`,
    ),
    reservedHasEnvelope: check(
      'products_reserved_has_envelope',
      sql`${table.status} <> 'RESERVED' OR (
        ${table.reservedByChannel} IS NOT NULL AND
        ${table.reservedAt}        IS NOT NULL
      )`,
    ),
    reservationTtlPerChannel: check(
      'products_reservation_ttl_per_channel',
      sql`${table.status} <> 'RESERVED' OR (
        (${table.reservedByChannel} = 'POS'             AND ${table.reservationExpiresAt} IS NULL) OR
        (${table.reservedByChannel} = 'STOREFRONT'      AND ${table.reservationExpiresAt} IS NOT NULL) OR
        (${table.reservedByChannel} = 'EBAY'            AND ${table.reservationExpiresAt} IS NOT NULL) OR
        (${table.reservedByChannel} = 'WEB_RESERVATION' AND ${table.reservationExpiresAt} IS NOT NULL)
      )`,
    ),
    soldHasSoldAt: check(
      'products_sold_has_sold_at',
      sql`${table.status} <> 'SOLD' OR ${table.soldAt} IS NOT NULL`,
    ),
    draftUnpublished: check(
      'products_draft_unpublished',
      sql`${table.status} <> 'DRAFT' OR ${table.publishedAt} IS NULL`,
    ),
    nonDraftPublished: check(
      'products_non_draft_is_published',
      sql`${table.status} = 'DRAFT' OR ${table.publishedAt} IS NOT NULL`,
    ),

    // Domain CHECKs
    metalDomain: check(
      'products_metal_check',
      sql`${table.metal} IS NULL OR ${table.metal} IN ('gold','silver','platinum','palladium')`,
    ),
    finenessRange: check(
      'products_fineness_range',
      sql`${table.finenessDecimal} IS NULL OR (${table.finenessDecimal} > 0 AND ${table.finenessDecimal} <= 1.0000)`,
    ),
    weightPositive: check(
      'products_weight_positive',
      sql`${table.weightGrams} IS NULL OR ${table.weightGrams} > 0`,
    ),
    acquisitionNonNegative: check(
      'products_acquisition_non_negative',
      sql`${table.acquisitionCostEur} >= 0`,
    ),
    listPriceNonNegative: check(
      'products_list_price_non_negative',
      sql`${table.listPriceEur} >= 0`,
    ),
    collectorPremiumNonNeg: check(
      'products_collector_premium_nonneg',
      sql`${table.collectorPremiumEur} IS NULL OR ${table.collectorPremiumEur} >= 0`,
    ),
    stampErhaltungDomain: check(
      'products_stamp_erhaltung_check',
      sql`${table.stampErhaltung} IS NULL OR ${table.stampErhaltung} IN ('POSTFRISCH','FALZ','GESTEMPELT','AUF_BRIEF')`,
    ),
    stampMinrPositive: check(
      'products_stamp_minr_positive',
      sql`${table.stampMinr} IS NULL OR ${table.stampMinr} > 0`,
    ),
  }),
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
