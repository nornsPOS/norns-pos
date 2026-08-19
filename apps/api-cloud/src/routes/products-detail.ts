/**
 * GET /api/products/:id — single-product detail.
 *
 * Why this exists separately from the list endpoint (Day 17):
 *   • The list endpoint omits `acquisitionCostEur` for a small response
 *     and to keep purchase-cost out of catalog projections.
 *   • The Verkauf cart needs `acquisitionCostEur` to compute §25a margin
 *     math client-side (memory.md #76 + Day 7 audit).
 *
 * Day 13 (Phase 2.B) additions:
 *   • SEO + collector metadata fields (slug, seoTitle, schemaOrgType, …)
 *     so the Owner-facing detail screen can edit them in one shot.
 *   • categories[] — every taxonomy node the product is filed under,
 *     with `isPrimary` flag so the breadcrumb hint is unambiguous.
 *
 * Pure-read route. No migration impact — the Day-13 fields are NULL-able
 * additions; the new categories[] is fetched via a batched JOIN.
 * ADMIN + CASHIER may read.
 */

import { Type } from '@sinclair/typebox';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  categories as categoriesTable,
  productCategories as productCategoriesTable,
  products,
  users,
} from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const Params = Type.Object({ id: Type.String({ format: 'uuid' }) });

const CategoryAssignment = Type.Object({
  id: Type.String({ format: 'uuid' }),
  slug: Type.String(),
  nameDe: Type.String(),
  nameEn: Type.Union([Type.String(), Type.Null()]),
  isPrimary: Type.Boolean(),
});

export const ProductDetail = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sku: Type.String(),
  /** Day-13 addition: SEO-friendly slug. NULL until set. */
  slug: Type.Union([Type.String(), Type.Null()]),
  barcode: Type.Union([Type.String(), Type.Null()]),
  status: Type.Union([
    Type.Literal('DRAFT'),
    Type.Literal('AVAILABLE'),
    Type.Literal('RESERVED'),
    Type.Literal('SOLD'),
  ]),
  condition: Type.String(),
  itemType: Type.String(),
  metal: Type.Union([
    Type.Literal('gold'),
    Type.Literal('silver'),
    Type.Literal('platinum'),
    Type.Literal('palladium'),
    Type.Null(),
  ]),
  karatCode: Type.Union([Type.String(), Type.Null()]),
  finenessDecimal: Type.Union([Type.String(), Type.Null()]),
  weightGrams: Type.Union([Type.String(), Type.Null()]),
  feingewichtGrams: Type.Union([Type.String(), Type.Null()]),
  lengthCm: Type.Union([Type.String(), Type.Null()]),
  widthCm: Type.Union([Type.String(), Type.Null()]),
  heightCm: Type.Union([Type.String(), Type.Null()]),
  taxTreatmentCode: Type.String(),
  acquisitionCostEur: Type.String(),
  listPriceEur: Type.String(),
  collectorPremiumEur: Type.Union([Type.String(), Type.Null()]),
  name: Type.String(),
  descriptionDe: Type.Union([Type.String(), Type.Null()]),
  /** 0143: Seriennummer (GwG). Null: traegt keine. */
  seriennummer: Type.Union([Type.String(), Type.Null()]),
  /** 0143: Gravur woertlich. */
  gravur: Type.Union([Type.String(), Type.Null()]),
  /** Day-13 addition: English narrative (storefront i18n hook). */
  descriptionEn: Type.Union([Type.String(), Type.Null()]),
  // ─── Day-13 SEO surface ────────────────────────────────────────────
  seoTitle: Type.Union([Type.String(), Type.Null()]),
  seoDescription: Type.Union([Type.String(), Type.Null()]),
  seoTitleEn: Type.Union([Type.String(), Type.Null()]),
  seoDescriptionEn: Type.Union([Type.String(), Type.Null()]),
  schemaOrgType: Type.Union([Type.String(), Type.Null()]),
  // ─── Day-13 collector metadata ─────────────────────────────────────
  yearMintedFrom: Type.Union([Type.Integer(), Type.Null()]),
  yearMintedTo: Type.Union([Type.Integer(), Type.Null()]),
  originCountry: Type.Union([Type.String(), Type.Null()]),
  period: Type.Union([Type.String(), Type.Null()]),
  catalogReference: Type.Union([Type.String(), Type.Null()]),
  provenanceNotes: Type.Union([Type.String(), Type.Null()]),
  // ─── Migration 0063: Briefmarken attributes ────────────────────────
  /** Erhaltung: POSTFRISCH (**), FALZ (*), GESTEMPELT (,), AUF_BRIEF. NULL für Nicht-Briefmarken. */
  stampErhaltung: Type.Union([
    Type.Literal('POSTFRISCH'),
    Type.Literal('FALZ'),
    Type.Literal('GESTEMPELT'),
    Type.Literal('AUF_BRIEF'),
    Type.Null(),
  ]),
  /** Michel-Katalognummer (MiNr.). NULL für Nicht-Briefmarken. */
  stampMinr: Type.Union([Type.Integer(), Type.Null()]),
  // Die Netzverkaufs-Felder (listedOnStorefront, listedOnEbay,
  // isPublishedToWeb, ebayState, ebayStateChangedAt) wurden am 14.08.2026 mit
  // der Trennung von warehouse14 ausgetragen; die Spalten bleiben
  // gespeicherter Zustand und warten auf ihre eigene Wanderung.
  isCommission: Type.Boolean(),
  parentProductId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  locationStorageUnit: Type.Union([Type.String(), Type.Null()]),
  locationDrawer: Type.Union([Type.String(), Type.Null()]),
  locationPosition: Type.Union([Type.String(), Type.Null()]),
  // ─── Day-13 categories — primary first, then alphabetical ──────────
  categories: Type.Array(CategoryAssignment),
  /**
   * WHO holds the reservation (owner directive 2026-07-20). NULL unless
   * `status='RESERVED'`. For web reservations the name is the customer the
   * reserving shopper belongs to (decrypted inside withPii); for POS holds it
   * is the staff member. `name` stays NULL when the chain cannot be resolved
   * (e.g. an expired cart) — the channel is still honest.
   */
  reservedBy: Type.Union([
    Type.Object({
      channel: Type.Union([
        Type.Literal('POS'),
        Type.Literal('STOREFRONT'),
        Type.Literal('EBAY'),
        Type.Literal('WEB_RESERVATION'),
      ]),
      name: Type.Union([Type.String(), Type.Null()]),
      reservedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
      expiresAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    }),
    Type.Null(),
  ]),
  archivedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const productsDetailRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>(
    '/api/products/:id',
    {
      schema: {
        tags: ['products'],
        summary: 'Full product detail — used by Verkauf cart for §25a math.',
        description:
          'Returns the product row plus its category assignments. The Day-13 ' +
          'SEO + collector fields are NULL-able and may be edited via PUT.',
        params: Params,
        response: {
          200: ProductDetail,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // Two parallel queries — product row + its category assignments.
      // Independent, so issue both at once for round-trip latency.
      const [productRows, categoryRows] = await Promise.all([
        app.db.select().from(products).where(eq(products.id, req.params.id)).limit(1),
        app.db
          .select({
            id: categoriesTable.id,
            slug: categoriesTable.slug,
            nameDe: categoriesTable.nameDe,
            nameEn: categoriesTable.nameEn,
            isPrimary: productCategoriesTable.isPrimary,
          })
          .from(productCategoriesTable)
          .innerJoin(categoriesTable, eq(productCategoriesTable.categoryId, categoriesTable.id))
          .where(eq(productCategoriesTable.productId, req.params.id))
          .orderBy(asc(categoriesTable.nameDe)),
      ]);

      const row = productRows[0];
      if (!row) throw new ProductNotFoundError(`Product ${req.params.id} not found`);

      // WHO reserved it (owner directive): resolve the holder identity for a
      // RESERVED row. POS holds point at a staff user; web/storefront holds
      // walk reservation session → cart → shopper → customer and decrypt the
      // customer name inside the PII transaction. Best-effort: a broken chain
      // yields name NULL, never an error on the read path.
      let reservedBy: {
        channel: 'POS' | 'STOREFRONT' | 'EBAY' | 'WEB_RESERVATION';
        name: string | null;
        reservedAt: string | null;
        expiresAt: string | null;
      } | null = null;
      if (row.status === 'RESERVED' && row.reservedByChannel) {
        const channel = row.reservedByChannel as 'POS' | 'STOREFRONT' | 'EBAY' | 'WEB_RESERVATION';
        let holderName: string | null = null;
        try {
          if (channel === 'POS' && row.reservedByUserId) {
            const staff = await app.db
              .select({ name: users.name })
              .from(users)
              .where(eq(users.id, row.reservedByUserId))
              .limit(1);
            holderName = staff[0]?.name ?? null;
          } else if (row.reservedBySessionId) {
            const rows = await app.withPii(async (tx) => {
              const result = await tx.execute(sql`
                SELECT decrypt_pii(c.full_name_encrypted) AS full_name
                FROM carts ca
                JOIN shoppers s ON s.id = ca.shopper_id
                JOIN customers c ON c.id = s.customer_id
                WHERE ca.reservation_session_id = ${row.reservedBySessionId}
                LIMIT 1
              `);
              return result as unknown as { full_name: string | null }[];
            });
            holderName = rows[0]?.full_name ?? null;
          }
        } catch (err) {
          req.log.warn({ err, productId: row.id }, 'reservedBy resolution failed (kept NULL)');
        }
        reservedBy = {
          channel,
          name: holderName,
          reservedAt: row.reservedAt ? row.reservedAt.toISOString() : null,
          expiresAt: row.reservationExpiresAt ? row.reservationExpiresAt.toISOString() : null,
        };
      }

      // Primary first, then alphabetical — keeps the breadcrumb hint stable.
      const categories = [...categoryRows].sort((a, b) => {
        if (a.isPrimary && !b.isPrimary) return -1;
        if (!a.isPrimary && b.isPrimary) return 1;
        return a.nameDe.localeCompare(b.nameDe, 'de');
      });

      return reply.status(200).send({
        id: row.id,
        sku: row.sku,
        slug: row.slug,
        barcode: row.barcode,
        status: row.status,
        condition: row.condition,
        itemType: row.itemType,
        metal: row.metal as 'gold' | 'silver' | 'platinum' | 'palladium' | null,
        karatCode: row.karatCode,
        finenessDecimal: row.finenessDecimal,
        weightGrams: row.weightGrams,
        feingewichtGrams: row.feingewichtGrams,
        lengthCm: row.lengthCm,
        widthCm: row.widthCm,
        heightCm: row.heightCm,
        taxTreatmentCode: row.taxTreatmentCode,
        acquisitionCostEur: row.acquisitionCostEur,
        listPriceEur: row.listPriceEur,
        collectorPremiumEur: row.collectorPremiumEur,
        name: row.name,
        descriptionDe: row.descriptionDe,
        seriennummer: row.seriennummer,
        gravur: row.gravur,
        descriptionEn: row.descriptionEn,
        seoTitle: row.seoTitle,
        seoDescription: row.seoDescription,
        seoTitleEn: row.seoTitleEn,
        seoDescriptionEn: row.seoDescriptionEn,
        schemaOrgType: row.schemaOrgType,
        yearMintedFrom: row.yearMintedFrom,
        yearMintedTo: row.yearMintedTo,
        originCountry: row.originCountry,
        period: row.period,
        catalogReference: row.catalogReference,
        provenanceNotes: row.provenanceNotes,
        stampErhaltung: row.stampErhaltung as
          | 'POSTFRISCH'
          | 'FALZ'
          | 'GESTEMPELT'
          | 'AUF_BRIEF'
          | null,
        stampMinr: row.stampMinr,
        isCommission: row.isCommission,
        parentProductId: row.parentProductId,
        locationStorageUnit: row.locationStorageUnit,
        locationDrawer: row.locationDrawer,
        locationPosition: row.locationPosition,
        categories,
        reservedBy,
        archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    },
  );
};

export default productsDetailRoute;
