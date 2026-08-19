/**
 * Photo workflow routes (Phase 2 Day 2 — closes the Day-24 deferred surface).
 *
 *   POST   /api/photos                       — register an R2-uploaded photo;
 *                                              defaults to FOTOGRAFIERT
 *   GET    /api/photos/unassigned            — orphan photos (productId IS NULL)
 *   PATCH  /api/photos/:id/workflow-state    — validated 5-stage transition;
 *                                              writes event log; satisfies
 *                                              the two DB CHECKs at the right
 *                                              moment (r2_key_bg_removed for
 *                                              FREIGESTELLT, productId for
 *                                              ZUGEORDNET)
 *   GET    /api/products/:id/photos          — assigned photos for a product
 *                                              (optional workflow_state filter)
 *
 * Every transition writes a `product_photo_workflow_events` row inside the
 * same TX so the Kanban "drag from column A to column B" produces one
 * atomic audit unit. ADMIN + CASHIER may both move photos; only Owner can
 * archive (covered by the existing documents route + Phase 1.5 §I-23 virus-
 * scan worker).
 */

import { Type } from '@sinclair/typebox';
import { type SQL, and, asc, count, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import { productPhotoWorkflowEvents, productPhotos } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { deleteRenditions, readRendition } from '../lib/photo-store.js';
import { buildR2PublicUrl } from '../lib/r2.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  ALLOWED_PHOTO_TRANSITIONS,
  CreatePhotoBody,
  PhotoIdParams,
  PhotoRow,
  PhotoStoreUsageResponse,
  ProductPhotosQuery,
  ProductPhotosResponse,
  type TCreatePhotoBody,
  type TPhotoIdParams,
  type TProductPhotosQuery,
  type TTransitionPhotoStateBody,
  type TUnassignedPhotosQuery,
  TransitionPhotoStateBody,
  UnassignedPhotosQuery,
  UnassignedPhotosResponse,
} from '../schemas/photos.js';

class PhotoNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class PhotoValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class IllegalPhotoTransitionError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

type PhotoRowDb = typeof productPhotos.$inferSelect;

/** API-served URL for a local-store rendition. */
function apiPhotoUrl(env: Env, id: string, rendition: 'raw' | 'thumb'): string {
  return `${env.PHOTOS_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/photos/${id}/${rendition}`;
}

function serializePhoto(row: PhotoRowDb, env: Env): Record<string, unknown> {
  // Local rows are served by THIS api (compressed WebP on disk); legacy rows
  // keep their R2 public URL. The POS reads `publicUrl` either way.
  const isLocal = row.storageKind === 'local';
  const publicUrl = isLocal ? apiPhotoUrl(env, row.id, 'raw') : buildR2PublicUrl(env, row.r2Key);
  const thumbUrl = isLocal ? apiPhotoUrl(env, row.id, 'thumb') : undefined;
  return {
    id: row.id,
    productId: row.productId,
    r2Key: row.r2Key,
    storageKind: row.storageKind,
    publicUrl,
    ...(thumbUrl ? { thumbUrl } : {}),
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    r2KeyBgRemoved: row.r2KeyBgRemoved,
    displayOrder: row.displayOrder,
    isPrimary: row.isPrimary,
    source: row.source,
    altTextDe: row.altTextDe,
    altTextEn: row.altTextEn,
    workflowState: row.workflowState,
    workflowChangedAt: row.workflowChangedAt.toISOString(),
    workflowChangedByUserId: row.workflowChangedByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface PhotosRoutesOpts {
  env: Env;
}

const photosRoutes: FastifyPluginAsync<PhotosRoutesOpts> = async (app, opts) => {
  // ────────────────────────────────────────────────────────────────────
  // POST /api/photos
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TCreatePhotoBody }>(
    '/api/photos',
    {
      schema: {
        tags: ['photos'],
        summary: 'Register an R2-uploaded photo (defaults to FOTOGRAFIERT).',
        description:
          'V1 flow: client uploads bytes to R2 via signed URL, then POSTs ' +
          'metadata here. productId may be omitted — the photo lives as an ' +
          'orphan until a PATCH /:id/workflow-state with toState=ZUGEORDNET ' +
          'attaches it.',
        body: CreatePhotoBody,
        response: { 200: PhotoRow, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const actorId = req.actor.id;

      const result = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(productPhotos)
          .values({
            r2Key: body.r2Key,
            productId: body.productId ?? null,
            source: body.source ?? 'admin_upload',
            altTextDe: body.altTextDe ?? null,
            altTextEn: body.altTextEn ?? null,
            workflowState: 'FOTOGRAFIERT',
            workflowChangedByUserId: actorId,
          })
          .returning();
        if (!row) throw new Error('product_photos INSERT returned no row');

        await tx.insert(productPhotoWorkflowEvents).values({
          productPhotoId: row.id,
          fromState: null,
          toState: 'FOTOGRAFIERT',
          changedByUserId: actorId,
          notes: 'initial registration',
        });

        return row;
      });

      return reply.status(200).send(serializePhoto(result, opts.env));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/photos/unassigned
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TUnassignedPhotosQuery }>(
    '/api/photos/unassigned',
    {
      schema: {
        tags: ['photos'],
        summary: 'Orphan photos awaiting product assignment.',
        querystring: UnassignedPhotosQuery,
        response: { 200: UnassignedPhotosResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const limit = req.query.limit ?? 50;
      const offset = req.query.offset ?? 0;

      const preds: Array<SQL | undefined> = [
        drizzleSql`${productPhotos.productId} IS NULL`,
        req.query.workflowState !== undefined
          ? eq(productPhotos.workflowState, req.query.workflowState)
          : undefined,
      ];
      const whereClause = and(...preds);

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(productPhotos)
          .where(whereClause)
          .orderBy(desc(productPhotos.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(productPhotos).where(whereClause),
      ]);

      return reply.status(200).send({
        items: rows.map((r) => serializePhoto(r, opts.env)),
        total: Number(totalRow[0]?.n ?? 0),
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/photos/:id/workflow-state
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TPhotoIdParams; Body: TTransitionPhotoStateBody }>(
    '/api/photos/:id/workflow-state',
    {
      schema: {
        tags: ['photos'],
        summary: 'Transition a photo through the 5-stage workflow.',
        description:
          'Validates that the transition is permitted by ALLOWED_PHOTO_TRANSITIONS; ' +
          'FREIGESTELLT requires r2_key_bg_removed; ZUGEORDNET requires productId. ' +
          'Writes a product_photo_workflow_events row in the same TX.',
        params: PhotoIdParams,
        body: TransitionPhotoStateBody,
        response: { 200: PhotoRow, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const { toState, r2KeyBgRemoved, productId, notes } = req.body;
      const actorId = req.actor.id;

      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(productPhotos)
          .where(eq(productPhotos.id, req.params.id))
          .limit(1);
        if (!current) throw new PhotoNotFoundError(`Photo ${req.params.id} not found`);

        // Validate transition is allowed.
        const allowed = ALLOWED_PHOTO_TRANSITIONS[current.workflowState] ?? [];
        if (!allowed.includes(toState)) {
          throw new IllegalPhotoTransitionError(
            `Illegal transition ${current.workflowState} → ${toState}`,
          );
        }

        // Validate side-condition data is present.
        const wantsBgRemoved =
          toState === 'FREIGESTELLT' || toState === 'ZUGEORDNET' || toState === 'FUER_EBAY_BEREIT';
        if (wantsBgRemoved && !current.r2KeyBgRemoved && !r2KeyBgRemoved) {
          throw new PhotoValidationError(
            `transition to ${toState} requires r2KeyBgRemoved (current row has none)`,
          );
        }
        if (toState === 'ZUGEORDNET' && !current.productId && !productId) {
          throw new PhotoValidationError(
            'transition to ZUGEORDNET requires productId (current row is an orphan)',
          );
        }

        const updates: Partial<typeof productPhotos.$inferInsert> = {
          workflowState: toState,
          workflowChangedAt: new Date(),
          workflowChangedByUserId: actorId,
        };
        if (r2KeyBgRemoved) updates.r2KeyBgRemoved = r2KeyBgRemoved;
        if (productId && !current.productId) updates.productId = productId;

        const [updated] = await tx
          .update(productPhotos)
          .set(updates)
          .where(eq(productPhotos.id, req.params.id))
          .returning();
        if (!updated) throw new Error('UPDATE returned no row');

        await tx.insert(productPhotoWorkflowEvents).values({
          productPhotoId: updated.id,
          fromState: current.workflowState,
          toState,
          changedByUserId: actorId,
          notes: notes ?? null,
        });

        return updated;
      });

      return reply.status(200).send(serializePhoto(result, opts.env));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/photos/:id/primary — promote one photo to the product's
  // Hauptbild (the single image the Kasse/Verkauf catalog tile shows and the
  // storefront gallery leads with). Exactly-one-primary-per-product is enforced
  // by the partial unique index product_photos_one_primary_per_product_uq, so
  // we unset the current primary BEFORE setting the new one, in ONE TX.
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TPhotoIdParams }>(
    '/api/photos/:id/primary',
    {
      schema: {
        tags: ['photos'],
        summary: "Set this photo as its product's primary (Hauptbild).",
        description:
          'Unsets the product\'s current primary and promotes this photo, in one ' +
          'transaction (respects the one-primary-per-product partial unique index). ' +
          'The photo must already be assigned to a product.',
        params: PhotoIdParams,
        response: { 200: PhotoRow, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(productPhotos)
          .where(eq(productPhotos.id, req.params.id))
          .limit(1);
        if (!current) throw new PhotoNotFoundError(`Photo ${req.params.id} not found`);
        if (!current.productId) {
          throw new PhotoValidationError(
            'photo is not assigned to a product, so it cannot be the primary',
          );
        }
        if (current.isPrimary) return current; // already primary — no-op

        // 1. Demote the product's current primary (if any).
        await tx
          .update(productPhotos)
          .set({ isPrimary: false })
          .where(
            and(eq(productPhotos.productId, current.productId), eq(productPhotos.isPrimary, true)),
          );

        // 2. Promote this photo.
        const [updated] = await tx
          .update(productPhotos)
          .set({ isPrimary: true })
          .where(eq(productPhotos.id, req.params.id))
          .returning();
        if (!updated) throw new Error('primary UPDATE returned no row');
        return updated;
      });

      return reply.status(200).send(serializePhoto(result, opts.env));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // DELETE /api/photos/:id — remove a photo entirely (row + both stored
  // renditions). The owner could capture but never REMOVE a bad shot — the
  // capability was simply never built. If the deleted photo was the primary,
  // the newest remaining photo of the product is promoted so the catalog tile
  // never goes blank while other photos exist. The file unlink happens AFTER
  // the DB commit (deleteRenditions is idempotent; a worst-case orphaned file
  // is reclaimed by the worker purge sweep).
  // ────────────────────────────────────────────────────────────────────
  app.delete<{ Params: TPhotoIdParams }>(
    '/api/photos/:id',
    {
      schema: {
        tags: ['photos'],
        summary: 'Delete a photo (row + stored renditions). ADMIN only.',
        description:
          'Removes the photo row and its stored WebP renditions. If it was the ' +
          "product's primary, the newest remaining photo is promoted automatically.",
        params: PhotoIdParams,
        response: {
          200: Type.Object({ id: Type.String({ format: 'uuid' }), deleted: Type.Boolean() }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const deletedId = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(productPhotos)
          .where(eq(productPhotos.id, req.params.id))
          .limit(1);
        if (!current) throw new PhotoNotFoundError(`Photo ${req.params.id} not found`);

        await tx.delete(productPhotos).where(eq(productPhotos.id, req.params.id));

        // Keep the catalog tile alive: promote the newest remaining photo when
        // the deleted one carried the primary flag.
        if (current.isPrimary && current.productId) {
          const [next] = await tx
            .select({ id: productPhotos.id })
            .from(productPhotos)
            .where(eq(productPhotos.productId, current.productId))
            .orderBy(desc(productPhotos.createdAt))
            .limit(1);
          if (next) {
            await tx
              .update(productPhotos)
              .set({ isPrimary: true })
              .where(eq(productPhotos.id, next.id));
          }
        }
        return current.id;
      });

      // Post-commit: best-effort unlink of both renditions (idempotent).
      await deleteRenditions(opts.env, deletedId).catch(() => {});

      return reply.status(200).send({ id: deletedId, deleted: true });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/products/:id/photos
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: TProductPhotosQuery }>(
    '/api/products/:id/photos',
    {
      schema: {
        tags: ['photos', 'products'],
        summary: 'List photos for a product (optional workflow_state filter).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        querystring: ProductPhotosQuery,
        response: { 200: ProductPhotosResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const preds: Array<SQL | undefined> = [
        eq(productPhotos.productId, req.params.id),
        req.query.workflowState !== undefined
          ? eq(productPhotos.workflowState, req.query.workflowState)
          : undefined,
      ];
      const rows = await app.db
        .select()
        .from(productPhotos)
        .where(and(...preds))
        .orderBy(asc(productPhotos.displayOrder), asc(productPhotos.createdAt));

      return reply.status(200).send({ items: rows.map((r) => serializePhoto(r, opts.env)) });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/photos/usage — owner's local-store gauge
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/photos/usage',
    {
      schema: {
        tags: ['photos'],
        summary: 'Local photo-store usage (bytes used, cap, count).',
        response: { 200: PhotoStoreUsageResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const [agg] = await app.db
        .select({
          used: drizzleSql<number>`COALESCE(SUM(${productPhotos.sizeBytes}), 0)`,
          n: count(),
        })
        .from(productPhotos)
        .where(drizzleSql`${productPhotos.storageKind} = 'local'`);

      return reply.status(200).send({
        usedBytes: Number(agg?.used ?? 0),
        maxBytes: opts.env.PHOTO_STORE_MAX_BYTES,
        count: Number(agg?.n ?? 0),
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/photos/:id/raw  +  /api/photos/:id/thumb — stream local WebP
  // ────────────────────────────────────────────────────────────────────
  const serveRendition = (rendition: 'main' | 'thumb') => {
    return async (
      req: FastifyRequest<{ Params: TPhotoIdParams }>,
      reply: FastifyReply,
    ): Promise<FastifyReply> => {
      // PUBLIC by design — these two paths are in PUBLIC_PATH_PATTERNS
      // (lib/public-routes.ts), so the staff-auth + mTLS preHandlers skip them.
      // An `<img src>` tag cannot send an Authorization header and its cross-site
      // session cookie is dropped by Windows WebView2, so the request always
      // arrives unauthenticated. The unguessable UUID id is the capability.
      //
      // The `storageKind === 'local'` gate below is the in-handler defense: only
      // local product-photo bytes are streamed. KYC/Ausweis evidence lives in the
      // separate `kyc_documents` table + KYC_PHOTOS_DIR (AES-256-GCM-encrypted,
      // served only via the private ADMIN + step-up route — never reachable here)
      // — these routes can never serve sensitive PII. Anything not a local
      // product photo 404s.
      const [row] = await app.db
        .select({ id: productPhotos.id, storageKind: productPhotos.storageKind })
        .from(productPhotos)
        .where(eq(productPhotos.id, req.params.id))
        .limit(1);
      if (!row || row.storageKind !== 'local') {
        throw new PhotoNotFoundError(`Foto ${req.params.id} nicht gefunden.`);
      }

      const stream = await readRendition(opts.env, row.id, rendition);
      if (!stream) throw new PhotoNotFoundError(`Foto ${req.params.id} nicht gefunden.`);

      reply.header('Content-Type', 'image/webp');
      // Bytes are immutable per id (a re-upload yields a new id) → long cache.
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      // These are public product images embedded cross-origin via <img> from the
      // Tauri webview (origin tauri://localhost). The global security-headers
      // plugin sets Cross-Origin-Resource-Policy: same-origin, which makes the
      // webview refuse to render the image. Override to cross-origin for these
      // public renditions so <img> works (KYC photos are never served here).
      reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
      return reply.send(stream);
    };
  };

  app.get<{ Params: TPhotoIdParams }>(
    '/api/photos/:id/raw',
    {
      schema: {
        tags: ['photos'],
        summary: 'Stream the MAIN compressed WebP for a local-store photo (public by UUID).',
        params: PhotoIdParams,
        response: { 404: ErrorResponse },
      },
    },
    serveRendition('main'),
  );

  app.get<{ Params: TPhotoIdParams }>(
    '/api/photos/:id/thumb',
    {
      schema: {
        tags: ['photos'],
        summary: 'Stream the THUMB compressed WebP for a local-store photo (public by UUID).',
        params: PhotoIdParams,
        response: { 404: ErrorResponse },
      },
    },
    serveRendition('thumb'),
  );
};

export default photosRoutes;
