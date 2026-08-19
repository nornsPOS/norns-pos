/**
 * GET /api/products — unified product catalog (Day 17).
 *
 * Serves POS + Storefront SSR + Control Desktop with one filter surface.
 * Each client picks the subset of filters relevant to its UX:
 *   • POS cashier: status=AVAILABLE, archived=false, q=<barcode|sku|name>
 *   • Storefront:  status=AVAILABLE, listedOnStorefront=true, archived=false
 *   • Bridge:      no filters (default) — sees everything
 *
 * Gatekeepers: requireAuth + requireRole('ADMIN','CASHIER'). The public
 * storefront uses a separate (un-authenticated) route that lands in Phase 1.5
 * — V1 storefront is server-rendered with a long-lived ADMIN token.
 */

import {
  type SQL,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  categories as categoriesTable,
  productCategories as productCategoriesTable,
  productPhotos as productPhotosTable,
  products,
} from '@norns/db/schema';

import { kurspreiseFuerStuecke } from '../lib/kurspreise-lesen.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  ProductListQuery,
  ProductListResponse,
  type ProductListQuery as TProductListQuery,
} from '../schemas/product-list.js';

const productsListRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TProductListQuery }>(
    '/api/products',
    {
      schema: {
        tags: ['products'],
        summary: 'Catalog search + filter (paged).',
        description:
          'Unified catalog feed for POS, Storefront, and Control Desktop. ' +
          'Filters AND together. q searches name + description_de (ILIKE). ' +
          'Returns lightweight rows; use GET /api/products/:id for the full record.',
        querystring: ProductListQuery,
        response: { 200: ProductListResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;

      // Build WHERE clauses dynamically — Drizzle's `and(...preds)` ignores undefined.
      const preds: Array<SQL | undefined> = [
        q.status !== undefined ? eq(products.status, q.status) : undefined,
        q.condition !== undefined ? eq(products.condition, q.condition) : undefined,
        q.itemType !== undefined ? eq(products.itemType, q.itemType) : undefined,
        q.isCommission !== undefined ? eq(products.isCommission, q.isCommission) : undefined,
        // archived: TRUE = archived only; FALSE = active only; undefined = both.
        q.archived === true
          ? sql`${products.archivedAt} IS NOT NULL`
          : q.archived === false
            ? sql`${products.archivedAt} IS NULL`
            : undefined,
        q.priceMin !== undefined ? gte(products.listPriceEur, q.priceMin) : undefined,
        q.priceMax !== undefined ? lte(products.listPriceEur, q.priceMax) : undefined,
        // Free-text search — name OR description_de OR sku OR barcode, ILIKE.
        q.q !== undefined && q.q.length > 0
          ? or(
              ilike(products.name, `%${q.q}%`),
              ilike(products.descriptionDe, `%${q.q}%`),
              ilike(products.sku, `%${q.q}%`),
              ilike(products.barcode, `%${q.q}%`),
            )
          : undefined,
        // Exact-match barcode lookup — Day-9 USB-scanner pinpoint.
        q.barcode !== undefined && q.barcode.length > 0
          ? eq(products.barcode, q.barcode)
          : undefined,
        // Scanweg der Kasse: exakter Treffer auf Artikelnummer ODER
        // Strichcodespalte, beide über ihren eindeutigen Index. Begründung am
        // Feld `code` im Schema.
        q.code !== undefined && q.code.length > 0
          ? or(eq(products.sku, q.code), eq(products.barcode, q.code))
          : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      // Relevance ranking for the keyboard ring-up (Wave 1.2): exact SKU/barcode
      // first, then prefix matches on SKU/name, then the rest — so the cashier's
      // "type a few letters + Enter" rings the BEST match, not merely the newest.
      // Only applied when a free-text q is present; otherwise the date order stands.
      const term = q.q !== undefined && q.q.length > 0 ? q.q : null;
      const rankExpr = term
        ? sql`CASE
            WHEN lower(${products.sku}) = lower(${term}) THEN 0
            WHEN ${products.barcode} IS NOT NULL AND lower(${products.barcode}) = lower(${term}) THEN 0
            WHEN lower(${products.sku}) LIKE lower(${`${term}%`}) THEN 1
            WHEN lower(${products.name}) LIKE lower(${`${term}%`}) THEN 2
            ELSE 3 END`
        : null;
      const pageOrder = rankExpr
        ? [rankExpr, desc(products.createdAt), asc(products.id)]
        : [desc(products.createdAt), asc(products.id)];

      // Two queries: one for the page, one for the total. They are issued in
      // parallel for latency. For a single-shop catalog this is fine; storefront
      // ISR cache absorbs the count cost.
      const [rows, totalRow] = await Promise.all([
        app.db
          .select({
            id: products.id,
            sku: products.sku,
            slug: products.slug,
            barcode: products.barcode,
            status: products.status,
            condition: products.condition,
            itemType: products.itemType,
            metal: products.metal,
            weightGrams: products.weightGrams,
            // Für den gerechneten Tagespreis (Wanderung 0132).
            finenessDecimal: products.finenessDecimal,
            festerPreis: products.festerPreis,
            listPriceEur: products.listPriceEur,
            name: products.name,
            descriptionDe: products.descriptionDe,
            // Migration 0063: Briefmarken + collector facts for the POS tile.
            stampErhaltung: products.stampErhaltung,
            stampMinr: products.stampMinr,
            yearMintedFrom: products.yearMintedFrom,
            yearMintedTo: products.yearMintedTo,
            originCountry: products.originCountry,
            period: products.period,
            catalogReference: products.catalogReference,
            isCommission: products.isCommission,
            locationStorageUnit: products.locationStorageUnit,
            locationDrawer: products.locationDrawer,
            locationPosition: products.locationPosition,
            archivedAt: products.archivedAt,
            createdAt: products.createdAt,
          })
          .from(products)
          .where(whereClause as SQL | undefined)
          .orderBy(...pageOrder)
          .limit(limit)
          .offset(offset),
        app.db
          .select({ n: count() })
          .from(products)
          .where(whereClause as SQL | undefined),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);

      // Day-13: fetch primary category per product in one batched query.
      const productIds = rows.map((r) => r.id);
      const primaryByProductId = new Map<string, { id: string; slug: string; nameDe: string }>();
      if (productIds.length > 0) {
        const primaries = await app.db
          .select({
            productId: productCategoriesTable.productId,
            id: categoriesTable.id,
            slug: categoriesTable.slug,
            nameDe: categoriesTable.nameDe,
          })
          .from(productCategoriesTable)
          .innerJoin(categoriesTable, eq(productCategoriesTable.categoryId, categoriesTable.id))
          .where(
            and(
              inArray(productCategoriesTable.productId, productIds),
              eq(productCategoriesTable.isPrimary, true),
            ),
          );
        for (const p of primaries) {
          primaryByProductId.set(p.productId, { id: p.id, slug: p.slug, nameDe: p.nameDe });
        }
      }

      // Catalog image: the primary, locally-stored photo per product. We emit a
      // RELATIVE thumb path (`/api/photos/<photoId>/thumb`) — the same shape as
      // routes/photos.ts serializePhoto, minus the host. The POS prefixes it with
      // its api-client baseUrl. Only `storage_kind='local'` rows are streamable
      // by the public /thumb route, so we filter to those; legacy R2 rows resolve
      // to NULL (no catalog image rather than a broken cross-origin <img>).
      const thumbPathByProductId = new Map<string, string>();
      if (productIds.length > 0) {
        const primaryPhotos = await app.db
          .select({
            productId: productPhotosTable.productId,
            photoId: productPhotosTable.id,
          })
          .from(productPhotosTable)
          .where(
            and(
              inArray(productPhotosTable.productId, productIds),
              eq(productPhotosTable.isPrimary, true),
              eq(productPhotosTable.storageKind, 'local'),
            ),
          );
        for (const ph of primaryPhotos) {
          if (ph.productId) {
            thumbPathByProductId.set(ph.productId, `/api/photos/${ph.photoId}/thumb`);
          }
        }
      }

      // ── Der Tagespreis für die ganze Seite, in EINEM Zug ────────────────
      //
      // Kurse und Aufschlag werden einmal geholt, dann rein gerechnet. Je
      // Zeile zu fragen hiesse bei fünfzig Zeilen fünfzig Anfragen.
      const kurspreise = await kurspreiseFuerStuecke(
        app.db,
        rows.map((r) => ({
          id: r.id,
          metal: r.metal,
          weightGrams: r.weightGrams,
          finenessDecimal: r.finenessDecimal,
          festerPreis: r.festerPreis,
        })),
      );

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          sku: r.sku,
          slug: r.slug,
          primaryCategory: primaryByProductId.get(r.id) ?? null,
          barcode: r.barcode,
          primaryPhotoThumbUrl: thumbPathByProductId.get(r.id) ?? null,
          status: r.status,
          condition: r.condition,
          itemType: r.itemType,
          metal: r.metal as 'gold' | 'silver' | 'platinum' | 'palladium' | null,
          weightGrams: r.weightGrams,
          listPriceEur: r.listPriceEur,
          // ── Der Tagespreis, NEBEN dem gespeicherten, nie an seiner Stelle ──
          //
          // Basels Entscheidung vom 05.08.2026: der Preis eines Metallstücks
          // wird gerechnet, nicht eingefroren. Gerechnet wird für die ganze
          // Seite EINMAL (`kurspreiseFuerStuecke`), nicht je Zeile — sonst
          // wären es bei fünfzig Zeilen fünfzig Anfragen an die Datenbank.
          //
          // ⚠️ `listPriceEur` bleibt unangetastet. Wer verkauft, verkauft zu
          // dem Preis, den die Fläche zeigt und der Beleg bucht; was hier
          // steht, ist eine Auskunft über den Bestand, keine Buchung.
          kurspreisEur: (() => {
            const k = kurspreise.get(r.id);
            return k && k.art === 'gerechnet' ? k.preisEur : null;
          })(),
          kurspreisGrund: (() => {
            const k = kurspreise.get(r.id);
            return k && k.art === 'kein_kurspreis' ? k.grund : null;
          })(),
          festerPreis: r.festerPreis,
          name: r.name,
          descriptionDe: r.descriptionDe,
          stampErhaltung: r.stampErhaltung as
            | 'POSTFRISCH'
            | 'FALZ'
            | 'GESTEMPELT'
            | 'AUF_BRIEF'
            | null,
          stampMinr: r.stampMinr,
          yearMintedFrom: r.yearMintedFrom,
          yearMintedTo: r.yearMintedTo,
          originCountry: r.originCountry,
          period: r.period,
          catalogReference: r.catalogReference,
          isCommission: r.isCommission,
          locationStorageUnit: r.locationStorageUnit,
          locationDrawer: r.locationDrawer,
          locationPosition: r.locationPosition,
          archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );
};

export default productsListRoute;
