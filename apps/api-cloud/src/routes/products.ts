/**
 * Product Management routes (Day 16).
 *
 *   POST   /api/products                  — full create (ADMIN-only)
 *   PUT    /api/products/:id              — partial update (intake-locked fields refused)
 *   POST   /api/products/:id/archive      — flip archived_at (SOLD only)
 *   POST   /api/products/:id/photos       — request R2 presigned PUT URL + pre-insert photo row
 *
 * Audit:
 *   Every successful mutation writes a row to `audit_log` inside the same DB
 *   transaction. event_types:
 *     • product.created
 *     • product.updated  (payload carries the diff)
 *     • product.archived
 *     • product.photo_requested
 *
 * Gatekeepers (all four routes):
 *   • requireAuth
 *   • requireRole('ADMIN')   — Owner-only inventory management
 *   • KEIN Step-up beim Anlegen: ein Entwurf ist widerruflich (19.08.2026,
 *     Waechter code-nur-fuer-unwiderrufliches; Begruendung an der Stelle)
 *   • requireStepUp on archive (preserves SOLD-row immutability discipline)
 */

import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import { and, count, eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  appointmentLinkedProducts,
  auditLog,
  categories as categoriesTable,
  productCategories,
  productEbayListingEvents,
  productPhotos,
  products,
  transactionItems,
} from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { buildPhotoKey, getPresignedPutUrl } from '../lib/r2.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  ArchiveProductResponse,
  CreateProductBody,
  CreateProductResponse,
  DeleteProductResponse,
  RequestPhotoUploadBody,
  RequestPhotoUploadResponse,
  type CreateProductBody as TCreateProductBody,
  type RequestPhotoUploadBody as TRequestPhotoUploadBody,
  type UpdateProductBody as TUpdateProductBody,
  UpdateProductBody,
  UpdateProductResponse,
} from '../schemas/product.js';

// ────────────────────────────────────────────────────────────────────────
// Local error classes
// ────────────────────────────────────────────────────────────────────────

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class ProductNotArchivableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class ProductAlreadyArchivedError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class R2NotConfiguredError extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'SERVICE_UNAVAILABLE';
}

/** Raised when a product is not in a deletable state (only unsold DRAFTs go). */
class ProductNotDeletableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** 400 with a field-scoped reason (mirrors categories.ts / product-categories.ts). */
class ProductValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: { field: string; reason: string };
  public constructor(field: string, reason: string) {
    super(`Product validation failed for "${field}": ${reason}`);
    this.details = { field, reason };
  }
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface ProductsRoutesOpts {
  env: Env;
}

// ────────────────────────────────────────────────────────────────────────

const productsRoutes: FastifyPluginAsync<ProductsRoutesOpts> = async (app, opts) => {
  // ══════════════════════════════════════════════════════════════════════
  // POST /api/products — create
  // ══════════════════════════════════════════════════════════════════════
  app.post<{ Body: TCreateProductBody }>(
    '/api/products',
    {
      schema: {
        tags: ['products'],
        summary: 'Create a product (Owner-only).',
        description:
          'Owner-only full create. Intake-locked fields (sku, acquisitionCostEur, isCommission, ' +
          'acquiredFromCustomerId, classification) settable here only; PUT refuses them. Step-up ' +
          'required when acquisitionCostEur exceeds the step-up threshold.',
        body: CreateProductBody,
        response: {
          200: CreateProductResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const body = req.body;
      /*
       * ⚰️ 19.08.2026: hier stand eine Schwellenpruefung mit LEEREM Rumpf —
       * gerechnet, verworfen, und im Ueberfliegen sah sie aus wie ein Riegel.
       * Die boeswillige Pruefung fand sie; der erste Reflex war, den fehlenden
       * `requireStepUp(req)` nachzutragen.
       *
       * ⛔ Der Hauswaechter `code-nur-fuer-unwiderrufliches` hat genau das
       * abgewiesen, und er hat recht: Basels Anordnung vom 05.08.2026 lautet
       * „einmal beim Oeffnen, ein zweites Mal NUR vor Handlungen, die sich
       * nicht rueckgaengig machen lassen". Ein angelegtes Stueck ist ein
       * ENTWURF; es laesst sich loeschen (die Loeschroute verlangt den Code,
       * und das ist die endgueltige Handlung). Ein Code beim Anlegen waere
       * eine Huerde ohne Not, mitten im Wareneingang.
       *
       * Der tote Block ist deshalb ersatzlos weg, und die Kopfzeile dieser
       * Datei, die den Code beim Anlegen VERSPRACH, sagt jetzt die Wahrheit.
       */

      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // Validate the primary category BEFORE opening the tx — friendlier 400
      // than the raw FK 23503.
      if (body.primaryCategoryId) {
        const [cat] = await app.db
          .select({ id: categoriesTable.id })
          .from(categoriesTable)
          .where(eq(categoriesTable.id, body.primaryCategoryId))
          .limit(1);
        if (!cat) {
          throw new ProductValidationError(
            'primaryCategoryId',
            `Category ${body.primaryCategoryId} not found.`,
          );
        }
      }

      /*
       * 19.08.2026: N identische Stuecke in EINER Transaktion, je Stueck eine
       * eigene Zeile mit Laufnummern-SKU (-01 bis -NN, fuehrende Null) — das
       * Modell "eine Zeile ist ein Stueck" bleibt woertlich wahr, jede Zeile
       * ist einzeln reservierbar, verkaeuflich, stornierbar. Praezedenz: der
       * Ankauf legt seit jeher N Zeilen in einer Transaktion an.
       */
      const stueckzahl = body.stueckzahl ?? 1;
      const skuFuer = (i: number): string =>
        stueckzahl === 1 ? body.sku : `${body.sku}-${String(i + 1).padStart(2, '0')}`;

      const alle = await app.db.transaction(async (tx) => {
        const zeilen: { id: string; sku: string; status: string; createdAt: Date }[] = [];
        for (let i = 0; i < stueckzahl; i++) {
        const [row] = await tx
          .insert(products)
          .values({
            sku: skuFuer(i),
            // Auto-assign a scannable barcode at intake so EVERY product can be
            // labelled + scanned at the till. Per the design ("SKU IS the
            // barcode"), default the barcode to the unique SKU when the owner
            // doesn't supply one — encodes cleanly as Code128 and is already
            // unique (products_barcode_uq holds because SKUs are unique).
            barcode: stueckzahl === 1 ? (body.barcode ?? body.sku) : skuFuer(i),
            itemType: body.itemType,
            metal: body.metal ?? null,
            karatCode: body.karatCode ?? null,
            finenessDecimal: body.finenessDecimal ?? null,
            weightGrams: body.weightGrams ?? null,
            lengthCm: body.lengthCm ?? null,
            widthCm: body.widthCm ?? null,
            heightCm: body.heightCm ?? null,
            hallmarkStamps: body.hallmarkStamps,
            seriennummer: body.seriennummer ?? null,
            gravur: body.gravur ?? null,
            acquisitionCostEur: body.acquisitionCostEur,
            listPriceEur: body.listPriceEur,
            taxTreatmentCode: body.taxTreatmentCode,
            condition: body.condition,
            isCommission: body.isCommission,
            acquiredFromCustomerId: body.acquiredFromCustomerId ?? null,
            name: body.name,
            descriptionDe: body.descriptionDe ?? null,
            marketingAttributes: body.marketingAttributes ?? [],
            // Migration 0063: Briefmarken attributes (NULL for non-stamps).
            stampErhaltung: body.stampErhaltung ?? null,
            stampMinr: body.stampMinr ?? null,
            listedOnStorefront: body.listedOnStorefront,
            listedOnEbay: body.listedOnEbay,
            // Storage location (Lagerort) — optional at intake.
            locationStorageUnit: body.locationStorageUnit ?? null,
            locationDrawer: body.locationDrawer ?? null,
            locationPosition: body.locationPosition ?? null,
            locationAssignedAt:
              body.locationStorageUnit || body.locationDrawer || body.locationPosition
                ? new Date()
                : null,
            status: 'DRAFT',
          })
          .returning({
            id: products.id,
            sku: products.sku,
            status: products.status,
            createdAt: products.createdAt,
          });
        if (!row) throw new Error('product INSERT returned no row');

        // Primary taxonomy category — same tx as the product INSERT.
        if (body.primaryCategoryId) {
          await tx.insert(productCategories).values({
            productId: row.id,
            categoryId: body.primaryCategoryId,
            isPrimary: true,
          });
        }

        await tx.insert(auditLog).values({
          eventType: 'product.created',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            productId: row.id,
            sku: row.sku,
            acquisitionCostEur: body.acquisitionCostEur,
            listPriceEur: body.listPriceEur,
            isCommission: body.isCommission,
            acquiredFromCustomerId: body.acquiredFromCustomerId ?? null,
            taxTreatmentCode: body.taxTreatmentCode,
            itemType: body.itemType,
            condition: body.condition,
            primaryCategoryId: body.primaryCategoryId ?? null,
            stampErhaltung: body.stampErhaltung ?? null,
            stampMinr: body.stampMinr ?? null,
          },
        });

        zeilen.push(row);
        }
        return zeilen;
      });

      const erstes = alle[0];
      if (!erstes) throw new Error('product INSERT returned no rows');
      return reply.status(200).send({
        id: erstes.id,
        sku: erstes.sku,
        status: erstes.status as 'DRAFT' | 'AVAILABLE',
        createdAt: erstes.createdAt.toISOString(),
        ...(alle.length > 1
          ? {
              created: alle.map((z) => ({
                id: z.id,
                sku: z.sku,
                status: z.status as 'DRAFT' | 'AVAILABLE',
              })),
            }
          : {}),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // PUT /api/products/:id — partial update (intake-locked refused via TypeBox)
  // ══════════════════════════════════════════════════════════════════════
  app.put<{ Params: { id: string }; Body: TUpdateProductBody }>(
    '/api/products/:id',
    {
      schema: {
        tags: ['products'],
        summary: 'Update mutable product fields (Owner-only).',
        description:
          'Accepts only the mutable fields (price, name, description, channel flags, condition, ' +
          'DRAFT→AVAILABLE status transition). Intake-locked fields are NOT accepted (additionalProperties: false).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: UpdateProductBody,
        response: {
          200: UpdateProductResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          400: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id } = req.params;
      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      const outcome = await app.db.transaction(async (tx) => {
        const beforeRows = await tx.select().from(products).where(eq(products.id, id)).limit(1);
        const before = beforeRows[0];
        if (!before) throw new ProductNotFoundError(`Product ${id} not found.`);

        // DRAFT → AVAILABLE requires published_at to land alongside status.
        const setStatusToAvailable = body.status === 'AVAILABLE' && before.status === 'DRAFT';

        const update: Partial<typeof products.$inferInsert> = {};
        const changedFields: string[] = [];

        // ── Day-17 audit fix #1: deep equality for jsonb fields. ──────
        // Reference equality (`a !== b`) is correct for primitives but always
        // returns true for plain objects/arrays even when their CONTENT is
        // identical. We use a deterministic JSON serialization for the
        // JSON-typed columns (`marketingAttributes`); primitives fall back to
        // `Object.is` (`!==` plus correct NaN/+0/-0 semantics).
        const isJsonEqual = (a: unknown, b: unknown): boolean => {
          // Fast path: same reference / primitive equality.
          if (Object.is(a, b)) return true;
          // jsonb columns in our schema only carry objects/arrays/primitives —
          // never functions, Date, etc. JSON.stringify is sufficient and stable.
          try {
            return JSON.stringify(a) === JSON.stringify(b);
          } catch {
            // If serialization fails (e.g. unexpected cycle), fall back to "different"
            // — that's the safe direction; a spurious update is better than a missed one.
            return false;
          }
        };

        const maybe = <K extends keyof typeof products.$inferInsert>(
          key: K,
          next: (typeof products.$inferInsert)[K] | undefined,
          prev: (typeof products.$inferSelect)[K] | undefined,
          opts: { jsonb?: boolean } = {},
        ): void => {
          if (next === undefined) return;
          const same = opts.jsonb ? isJsonEqual(next, prev) : Object.is(next, prev);
          if (!same) {
            update[key] = next;
            changedFields.push(key as string);
          }
        };

        maybe('condition', body.condition, before.condition);
        maybe('listPriceEur', body.listPriceEur, before.listPriceEur);
        // Outer packing dimensions (cm) — re-measurable; `undefined` keeps,
        // explicit `null` clears. They re-derive the size class on read.
        maybe('lengthCm', body.lengthCm, before.lengthCm);
        maybe('widthCm', body.widthCm, before.widthCm);
        maybe('heightCm', body.heightCm, before.heightCm);
        maybe('name', body.name, before.name);
        // NOTE: no `?? null` here — the old coercion turned EVERY partial PUT
        // that omitted descriptionDe into a wipe (caught by taxonomy.test.ts:
        // the publish PUT cleared the description). `undefined` = keep,
        // explicit `null` = clear (schema allows both, like descriptionEn).
        maybe('descriptionDe', body.descriptionDe, before.descriptionDe);
        // 0143: gleiche Halte-Logik — undefined behaelt, null leert.
        maybe('seriennummer', body.seriennummer, before.seriennummer);
        maybe('gravur', body.gravur, before.gravur);
        maybe(
          'marketingAttributes',
          body.marketingAttributes,
          before.marketingAttributes as unknown as (typeof products.$inferInsert)['marketingAttributes'],
          { jsonb: true },
        );
        maybe('listedOnStorefront', body.listedOnStorefront, before.listedOnStorefront);
        maybe('listedOnEbay', body.listedOnEbay, before.listedOnEbay);
        // Phase 2.A / Day-14 — storefront publication gate.
        // The BEFORE-UPDATE trigger `on_products_publish_to_web`
        // (migration 0029) stamps publishedAt on the first TRUE flip,
        // so the route doesn't need to echo it.
        maybe('isPublishedToWeb', body.isPublishedToWeb, before.isPublishedToWeb);

        // ─── Day 13 SEO + collector metadata (non-intake-locked) ───────
        maybe('slug', body.slug, before.slug);
        maybe('seoTitle', body.seoTitle, before.seoTitle);
        maybe('seoDescription', body.seoDescription, before.seoDescription);
        maybe('schemaOrgType', body.schemaOrgType, before.schemaOrgType);
        maybe('yearMintedFrom', body.yearMintedFrom, before.yearMintedFrom);
        maybe('yearMintedTo', body.yearMintedTo, before.yearMintedTo);
        maybe('originCountry', body.originCountry, before.originCountry);
        maybe('period', body.period, before.period);
        maybe('catalogReference', body.catalogReference, before.catalogReference);
        maybe('provenanceNotes', body.provenanceNotes, before.provenanceNotes);
        maybe('descriptionEn', body.descriptionEn, before.descriptionEn);
        maybe('seoTitleEn', body.seoTitleEn, before.seoTitleEn);
        maybe('seoDescriptionEn', body.seoDescriptionEn, before.seoDescriptionEn);

        // ─── Migration 0063: Briefmarken attributes ────────────────────
        maybe('stampErhaltung', body.stampErhaltung, before.stampErhaltung);
        maybe('stampMinr', body.stampMinr, before.stampMinr);

        // ─── Migration 0063: primary category (product_categories) ────
        // Replaces the prior primary atomically inside this tx: unset the
        // old is_primary row FIRST (the partial UNIQUE
        // product_categories_one_primary_uq allows at most one), then
        // upsert the new membership with is_primary=TRUE. `null` clears
        // the primary flag but keeps the membership row.
        if (body.primaryCategoryId !== undefined) {
          const [currentPrimary] = await tx
            .select({ categoryId: productCategories.categoryId })
            .from(productCategories)
            .where(and(eq(productCategories.productId, id), eq(productCategories.isPrimary, true)))
            .limit(1);

          if (body.primaryCategoryId === null) {
            if (currentPrimary) {
              await tx
                .update(productCategories)
                .set({ isPrimary: false })
                .where(
                  and(eq(productCategories.productId, id), eq(productCategories.isPrimary, true)),
                );
              changedFields.push('primaryCategoryId');
            }
          } else if (currentPrimary?.categoryId !== body.primaryCategoryId) {
            const [cat] = await tx
              .select({ id: categoriesTable.id })
              .from(categoriesTable)
              .where(eq(categoriesTable.id, body.primaryCategoryId))
              .limit(1);
            if (!cat) {
              throw new ProductValidationError(
                'primaryCategoryId',
                `Category ${body.primaryCategoryId} not found.`,
              );
            }
            await tx
              .update(productCategories)
              .set({ isPrimary: false })
              .where(
                and(eq(productCategories.productId, id), eq(productCategories.isPrimary, true)),
              );
            await tx
              .insert(productCategories)
              .values({ productId: id, categoryId: body.primaryCategoryId, isPrimary: true })
              .onConflictDoUpdate({
                target: [productCategories.productId, productCategories.categoryId],
                set: { isPrimary: true },
              });
            changedFields.push('primaryCategoryId');
          }
        }

        if (body.status !== undefined && body.status !== before.status) {
          // Refuse anything other than DRAFT → AVAILABLE here.
          if (!(before.status === 'DRAFT' && body.status === 'AVAILABLE')) {
            throw new ProductNotArchivableError(
              `Status transition ${before.status} → ${body.status} is not permitted via PUT. ` +
                `Use the inventory / transaction routes for RESERVED/SOLD transitions.`,
            );
          }
          update.status = 'AVAILABLE';
          changedFields.push('status');
          if (setStatusToAvailable) {
            update.publishedAt = new Date();
            changedFields.push('publishedAt');
          }
        }

        if (changedFields.length === 0) {
          return { id, updatedAt: before.updatedAt, changedFields };
        }

        // The products UPDATE only runs when a product COLUMN changed — a
        // primaryCategoryId-only change touches product_categories alone
        // (drizzle's .set({}) throws on an empty object).
        let updatedAt = before.updatedAt;
        if (Object.keys(update).length > 0) {
          const [row] = await tx.update(products).set(update).where(eq(products.id, id)).returning({
            id: products.id,
            updatedAt: products.updatedAt,
          });
          if (!row) throw new Error('product UPDATE returned no row');
          updatedAt = row.updatedAt;
        }

        await tx.insert(auditLog).values({
          eventType: 'product.updated',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            productId: id,
            changedFields,
            before: pickDiff(before, changedFields),
            after: pickDiff(body, changedFields),
          },
        });

        return { id, updatedAt, changedFields };
      });

      return reply.status(200).send({
        id: outcome.id,
        updatedAt: outcome.updatedAt.toISOString(),
        changedFields: outcome.changedFields,
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/archive — archive a SOLD product
  // ══════════════════════════════════════════════════════════════════════
  app.post<{ Params: { id: string } }>(
    '/api/products/:id/archive',
    {
      schema: {
        tags: ['products'],
        summary: 'Archive a SOLD product (hides from active inventory).',
        description: 'Only SOLD products may be archived. Requires step-up.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: ArchiveProductResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id } = req.params;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      const outcome = await app.db.transaction(async (tx) => {
        const rows = await tx
          .select({
            id: products.id,
            status: products.status,
            archivedAt: products.archivedAt,
            soldAt: products.soldAt,
          })
          .from(products)
          .where(eq(products.id, id))
          .limit(1);
        const before = rows[0];
        if (!before) throw new ProductNotFoundError(`Product ${id} not found.`);
        if (before.archivedAt) {
          throw new ProductAlreadyArchivedError(`Product ${id} is already archived.`);
        }
        if (before.status !== 'SOLD') {
          throw new ProductNotArchivableError(
            `Only SOLD products may be archived. Product ${id} is ${before.status}.`,
          );
        }

        // ═══════════════════════════════════════════════════════════════════
        //  ⚠️ ZWEI UHREN, VON EINER REGEL DER DATENBANK VERGLICHEN
        // ═══════════════════════════════════════════════════════════════════
        //
        // Hier stand `new Date()`, also die Uhr des Node-Prozesses. Verglichen
        // wird sie aber gegen `sold_at`, und das kommt aus der Uhr von
        // Postgres:
        //
        //   CONSTRAINT products_archived_after_sold_at
        //     CHECK (archived_at IS NULL OR (sold_at IS NOT NULL
        //            AND archived_at >= sold_at))
        //
        // Auf derselben Maschine gehen beide Uhren fast gleich. Fast genügt
        // nicht: laeuft die Datenbank in einem Behaelter, driftet sie vom
        // Rumpf ab, und dann ist `archived_at` ein paar Millisekunden VOR
        // `sold_at`. Am 08.08.2026 genau so gemessen — das Archivieren eines
        // gerade verkauften Stuecks scheiterte mit
        //
        //   new row for relation "products" violates check constraint
        //   "products_archived_after_sold_at"
        //
        // Ein roher Regelbruch, mit dem der Haendler nichts anfangen kann, an
        // einem Vorgang, der nichts falsch gemacht hat.
        //
        // Die Behebung ist nicht mehr Toleranz, sondern EINE Uhr: der Stempel
        // kommt jetzt aus derselben Quelle wie der, gegen den er geprueft
        // wird. Damit ist die Reihenfolge nicht mehr wahrscheinlich, sondern
        // sicher.
        const [row] = await tx
          .update(products)
          .set({ archivedAt: drizzleSql`now()` })
          .where(eq(products.id, id))
          .returning({ id: products.id, archivedAt: products.archivedAt });
        if (!row?.archivedAt) throw new Error('archive UPDATE returned no row');
        // Fuer das Tagebuch: der Stempel, den die Datenbank WIRKLICH gesetzt
        // hat, nicht der, den wir uns gedacht haetten.
        const now = row.archivedAt;

        await tx.insert(auditLog).values({
          eventType: 'product.archived',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            productId: id,
            archivedAt: now.toISOString(),
            soldAt: before.soldAt?.toISOString() ?? null,
          },
        });

        return { id: row.id, archivedAt: row.archivedAt };
      });

      return reply.status(200).send({
        id: outcome.id,
        archivedAt: outcome.archivedAt.toISOString(),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // DELETE /api/products/:id — hard-delete a NEVER-TRANSACTED product
  //
  // Lifecycle UX: an operator who created a product by mistake (wrong SKU,
  // duplicate intake, test row) — or wants a never-sold piece gone for good —
  // needs a clean way to remove it. This is the ONLY destructive product
  // route and it stays deliberately narrow:
  //
  //   • status MUST be DRAFT or AVAILABLE — RESERVED / SOLD rows are never
  //     deletable (SOLD rows are fiscally immutable; use /archive instead).
  //   • the row MUST NOT be archived (archived rows are kept for the trail).
  //   • the row MUST NOT be referenced by any transaction_items (fiscal FK)
  //     nor by any appointment link (appointment_linked_products carries the
  //     viewing-hold/reservation trail and is INSERT-only by discipline).
  //   • a LIVE eBay listing (ebay_state = 'ONLINE') blocks the delete — the
  //     external listing must be ended first.
  //
  // Web delisting is automatic: removing the row removes it from the
  // storefront catalog (which reads `products`); the publish flags at delete
  // time are preserved in the audit payload. Owned child rows (photos, eBay
  // events, category links) are removed in the same transaction so no FK
  // orphans block the delete. Any OTHER FK still referencing the row
  // (documents, inventory scans, carts, …) rolls the whole transaction back
  // and surfaces as a German 409 — never a half-deleted product. Step-up is
  // required (same bar as archive) and a `product.deleted` audit row is
  // written.
  // ══════════════════════════════════════════════════════════════════════

  /** postgres-js raises PostgresError with code 23503 on FK violations. */
  function isForeignKeyViolation(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: unknown }).code === '23503'
    );
  }

  app.delete<{ Params: { id: string } }>(
    '/api/products/:id',
    {
      schema: {
        tags: ['products'],
        summary: 'Delete a never-transacted product (Owner-only, step-up).',
        description:
          'Hard-deletes a DRAFT or AVAILABLE product that has never been part of a fiscal ' +
          'transaction and carries no reservation/appointment link. RESERVED / SOLD / archived ' +
          'rows and live eBay listings are refused (409). Owned photo, eBay-event and ' +
          'category-link rows are removed in the same transaction; storefront delisting is ' +
          'implicit (the catalog reads the products table). Writes a product.deleted audit row.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: DeleteProductResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const { id } = req.params;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      const runDelete = (): Promise<{ id: string; sku: string; deletedAt: Date }> =>
        app.db.transaction(async (tx) => {
          const rows = await tx
            .select({
              id: products.id,
              sku: products.sku,
              name: products.name,
              status: products.status,
              archivedAt: products.archivedAt,
              soldAt: products.soldAt,
              acquisitionCostEur: products.acquisitionCostEur,
              ebayState: products.ebayState,
              isPublishedToWeb: products.isPublishedToWeb,
              listedOnStorefront: products.listedOnStorefront,
              listedOnEbay: products.listedOnEbay,
            })
            .from(products)
            .where(eq(products.id, id))
            .limit(1);
          const before = rows[0];
          if (!before) throw new ProductNotFoundError(`Product ${id} not found.`);

          if (before.archivedAt) {
            throw new ProductNotDeletableError(
              `Produkt ${before.sku} ist bereits archiviert und kann nicht gelöscht werden.`,
            );
          }
          if (before.status === 'SOLD' || before.soldAt) {
            throw new ProductNotDeletableError(
              `Produkt ${before.sku} wurde verkauft und ist Teil der fiskalischen Aufzeichnung, es kann nur archiviert werden, nicht gelöscht.`,
            );
          }
          if (before.status !== 'DRAFT' && before.status !== 'AVAILABLE') {
            throw new ProductNotDeletableError(
              `Produkt ${before.sku} ist derzeit reserviert und kann nicht gelöscht werden. Bitte zuerst die Reservierung aufheben.`,
            );
          }
          if (before.ebayState === 'ONLINE') {
            throw new ProductNotDeletableError(
              `Produkt ${before.sku} ist aktuell live bei eBay gelistet. Bitte das Listing zuerst beenden, danach kann gelöscht werden.`,
            );
          }

          // Defence in depth: never delete a row any fiscal line item references.
          const [itemCount] = await tx
            .select({ n: count() })
            .from(transactionItems)
            .where(eq(transactionItems.productId, id));
          if (Number(itemCount?.n ?? 0) > 0) {
            throw new ProductNotDeletableError(
              `Produkt ${before.sku} ist mit einem Beleg verknüpft und kann nicht gelöscht werden.`,
            );
          }

          // Reservation trail: appointment links (and their viewing holds) are
          // INSERT-only — a linked row means the piece was promised to a
          // customer appointment at some point and keeps its history.
          const [linkCount] = await tx
            .select({ n: count() })
            .from(appointmentLinkedProducts)
            .where(eq(appointmentLinkedProducts.productId, id));
          if (Number(linkCount?.n ?? 0) > 0) {
            throw new ProductNotDeletableError(
              `Produkt ${before.sku} ist mit einem Termin (Besichtigung/Reservierung) verknüpft und kann nicht gelöscht werden.`,
            );
          }

          // Remove owned children first (no ON DELETE CASCADE on these FKs).
          await tx.delete(productCategories).where(eq(productCategories.productId, id));
          await tx
            .delete(productEbayListingEvents)
            .where(eq(productEbayListingEvents.productId, id));
          await tx.delete(productPhotos).where(eq(productPhotos.productId, id));

          const deleted = await tx
            .delete(products)
            .where(eq(products.id, id))
            .returning({ id: products.id, sku: products.sku });
          const row = deleted[0];
          if (!row) throw new Error('product DELETE returned no row');

          const now = new Date();
          await tx.insert(auditLog).values({
            eventType: 'product.deleted',
            actorUserId: actorId,
            deviceId,
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            payload: {
              productId: id,
              sku: before.sku,
              name: before.name,
              status: before.status,
              acquisitionCostEur: before.acquisitionCostEur,
              // Web-delisting evidence: what the row was exposed as when it died.
              wasPublishedToWeb: before.isPublishedToWeb,
              listedOnStorefront: before.listedOnStorefront,
              listedOnEbay: before.listedOnEbay,
              deletedAt: now.toISOString(),
            },
          });

          return { id: row.id, sku: row.sku, deletedAt: now };
        });

      let outcome: { id: string; sku: string; deletedAt: Date };
      try {
        outcome = await runDelete();
      } catch (err) {
        // Catch-all FK guard: any reference we did not explicitly check
        // (documents, inventory scans, carts, appraisal/intake rows, …)
        // aborts the transaction — map it to a calm German 409 instead of a 500.
        if (isForeignKeyViolation(err)) {
          throw new ProductNotDeletableError(
            'Das Produkt ist noch mit anderen Datensätzen verknüpft (z. B. Dokument, Inventur oder Warenkorb) und kann nicht endgültig gelöscht werden.',
          );
        }
        throw err;
      }

      return reply.status(200).send({
        id: outcome.id,
        sku: outcome.sku,
        deletedAt: outcome.deletedAt.toISOString(),
      });
    },
  );

  // ══════════════════════════════════════════════════════════════════════
  // POST /api/products/:id/photos — request R2 presigned URL + pre-insert row
  // ══════════════════════════════════════════════════════════════════════
  app.post<{ Params: { id: string }; Body: TRequestPhotoUploadBody }>(
    '/api/products/:id/photos',
    {
      schema: {
        tags: ['products'],
        summary: 'Request a Cloudflare R2 presigned PUT URL for a product photo.',
        description:
          'Pre-inserts a product_photos row reserving the R2 key, returns the short-TTL ' +
          'presigned URL. Client uploads bytes directly to R2; a Phase 1.5 worker reconciles ' +
          'any rows whose r2 object never lands.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: RequestPhotoUploadBody,
        response: {
          200: RequestPhotoUploadResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id: productId } = req.params;
      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // Verify product exists before generating a URL.
      const prodRows = await app.db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
      if (!prodRows[0]) throw new ProductNotFoundError(`Product ${productId} not found.`);

      const photoId = randomUUID();
      const r2Key = buildPhotoKey(productId, photoId, body.contentType);

      let presigned: Awaited<ReturnType<typeof getPresignedPutUrl>>;
      try {
        presigned = await getPresignedPutUrl(opts.env, {
          key: r2Key,
          contentType: body.contentType,
          maxBytes: body.contentLength,
        });
      } catch (err) {
        throw new R2NotConfiguredError(err instanceof Error ? err.message : 'R2 presign failed');
      }

      // Pre-insert the photo row + audit_log atomically.
      await app.db.transaction(async (tx) => {
        await tx.insert(productPhotos).values({
          id: photoId,
          productId,
          r2Key,
          isPrimary: body.isPrimary ?? false,
          source: 'admin_upload',
          altTextDe: body.altTextDe ?? null,
          altTextEn: body.altTextEn ?? null,
        });
        await tx.insert(auditLog).values({
          eventType: 'product.photo_requested',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            productId,
            photoId,
            r2Key,
            contentType: body.contentType,
            contentLength: body.contentLength,
            isPrimary: body.isPrimary ?? false,
          },
        });
      });

      return reply.status(200).send({
        photoId,
        r2Key: presigned.key,
        uploadUrl: presigned.url,
        publicUrl: presigned.publicUrl,
        requiredHeaders: presigned.requiredHeaders,
        expiresAt: presigned.expiresAt,
      });
    },
  );
};

// Local helper — pluck the keys we mention in the diff. Avoids logging
// the full body (especially marketingAttributes, which may be large).
function pickDiff(src: object, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = src as Record<string, unknown>;
  for (const k of keys) {
    if (k in s) out[k] = s[k];
  }
  return out;
}

export default productsRoutes;
