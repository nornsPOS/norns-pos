/**
 * POST /api/photos/upload — API-proxied product-photo upload (LOCAL store).
 *
 * The DURABLE replacement for the direct browser→R2 PUT path. R2 is unset in
 * production (R2_BUCKET empty) and a poor fit for the shop's handful of photos,
 * so the bytes now live on the API server's local disk:
 *
 *   1. decode + validate the base64 image bytes (any jpeg/png/webp/heic input),
 *   2. COMPRESS to two WebP renditions (main ≤1600px q80, thumb ≤400px q70),
 *      stripping EXIF — the raw upload is never stored,
 *   3. enforce the PHOTO_STORE_MAX_BYTES cap against SUM(size_bytes),
 *   4. insert the `product_photos` row (storage_kind='local') + workflow event
 *      + audit row in ONE transaction, then
 *   5. write the WebP bytes under PHOTOS_DIR (sharded by id). If the disk write
 *      fails after commit we delete the row so disk + DB never drift.
 *
 * The client contract is unchanged — it still POSTs base64 + contentType and
 * reads back `{ id, publicUrl, … }`. publicUrl now points at the API
 * (`<PHOTOS_PUBLIC_BASE_URL>/api/photos/<id>/raw`), which the Tauri CSP allows.
 *
 * ADMIN + CASHIER gated. Size-limited at the Fastify route (`bodyLimit`) and
 * again after base64-decode (defensive).
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  auditLog,
  productPhotoWorkflowEvents,
  productPhotos,
  products,
} from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  PHOTO_CONTENT_TYPE,
  checkCapacity,
  compressPhoto,
  deleteRenditions,
  writeRenditions,
} from '../lib/photo-store.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  PhotoDirectUploadBody,
  PhotoDirectUploadResponse,
  type PhotoDirectUploadBody as TBody,
} from '../schemas/photo-direct-upload.js';

/** Hard cap on the DECODED upload (bytes) BEFORE compression. We accept large
 *  phone captures (heic/jpeg) and shrink them — generous headroom, then sharp
 *  brings the stored bytes down to ~120 KB main. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function publicUrlFor(env: Env, id: string): string {
  return `${env.PHOTOS_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/photos/${id}/raw`;
}
function thumbUrlFor(env: Env, id: string): string {
  return `${env.PHOTOS_PUBLIC_BASE_URL.replace(/\/$/, '')}/api/photos/${id}/thumb`;
}

class PhotoUploadValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
/** 409 — the local store is at the owner-imposed cap. */
class PhotoStoreFullError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class PhotoCompressionError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface PhotoDirectUploadOpts {
  env: Env;
}

const photoDirectUploadRoute: FastifyPluginAsync<PhotoDirectUploadOpts> = async (app, opts) => {
  app.post<{ Body: TBody }>(
    '/api/photos/upload',
    {
      // Allow base64-inflated bodies up to ~34 MB (25 MB decoded × 1.34).
      bodyLimit: 34 * 1024 * 1024,
      schema: {
        tags: ['photos'],
        summary: 'Upload a product photo through the API (compress + local-disk store).',
        description:
          'Accepts base64 image bytes, compresses them to two WebP renditions ' +
          '(main ≤1600px, thumb ≤400px), enforces the PHOTO_STORE_MAX_BYTES cap, ' +
          'writes them under PHOTOS_DIR, and binds a product_photos row. No R2.',
        body: PhotoDirectUploadBody,
        response: {
          200: PhotoDirectUploadResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const env = opts.env;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // 1. Decode + validate the raw upload.
      let raw: Buffer;
      try {
        raw = Buffer.from(body.dataBase64, 'base64');
      } catch {
        throw new PhotoUploadValidationError('dataBase64 ist kein gültiges Base64.');
      }
      if (raw.length === 0) {
        throw new PhotoUploadValidationError('Bilddaten sind leer.');
      }
      if (raw.length > MAX_UPLOAD_BYTES) {
        throw new PhotoUploadValidationError(
          `Bild ist zu groß (${Math.round(raw.length / 1024 / 1024)} MB, max ${Math.round(
            MAX_UPLOAD_BYTES / 1024 / 1024,
          )} MB).`,
        );
      }

      // 2. If binding to a product, confirm it exists before we do any work.
      if (body.productId) {
        const [prod] = await app.db
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, body.productId))
          .limit(1);
        if (!prod) throw new ProductNotFoundError(`Produkt ${body.productId} nicht gefunden.`);
      }

      // 3. Compress to MAIN + THUMB WebP (strips EXIF; never stores the raw).
      let compressed: Awaited<ReturnType<typeof compressPhoto>>;
      try {
        compressed = await compressPhoto(raw);
      } catch {
        throw new PhotoCompressionError(
          'Bild konnte nicht verarbeitet werden (kein gültiges Bildformat).',
        );
      }
      const storedBytes = compressed.main.length + compressed.thumb.length;

      // 4. Enforce the disk cap against the live running total
      //    (SUM of local rows' size_bytes).
      const [usageRow] = await app.db
        .select({ total: drizzleSql<number>`COALESCE(SUM(${productPhotos.sizeBytes}), 0)` })
        .from(productPhotos)
        .where(drizzleSql`${productPhotos.storageKind} = 'local'`);
      const used = Number(usageRow?.total ?? 0);
      const capacity = checkCapacity(env, used, storedBytes);
      if (!capacity.ok) {
        throw new PhotoStoreFullError(
          'Fotospeicher voll — alte/verkaufte Artikel-Fotos werden automatisch entfernt.',
        );
      }

      // 5a. Persist the row (+ workflow event + audit) atomically. r2_key is a
      //     NOT NULL legacy column; for local rows it carries the id (the on-disk
      //     base name), so key-based code keeps working and storage_kind routes
      //     reads to disk instead of R2.
      const row = await app.db.transaction(async (tx) => {
        // Defense in depth for the cashier thumbnail: the FIRST photo of a
        // product becomes its primary automatically when none exists yet.
        // Previously every upload defaulted isPrimary=false (the client never
        // sent the flag), and products-list joins ONLY isPrimary=true for
        // primaryPhotoThumbUrl — so a freshly-photographed product showed a
        // placeholder in the Verkauf/Kasse catalog instead of its image.
        let makePrimary = body.isPrimary ?? false;
        if (!makePrimary && body.productId != null) {
          const existingPrimary = await tx
            .select({ id: productPhotos.id })
            .from(productPhotos)
            .where(
              drizzleSql`${productPhotos.productId} = ${body.productId} AND ${productPhotos.isPrimary} = true`,
            )
            .limit(1);
          if (existingPrimary.length === 0) makePrimary = true;
        }
        const [inserted] = await tx
          .insert(productPhotos)
          .values({
            // Placeholder — backfilled to the generated id below in the same TX.
            r2Key: '',
            storageKind: 'local',
            contentType: PHOTO_CONTENT_TYPE,
            sizeBytes: compressed.main.length,
            thumbBytes: compressed.thumb.length,
            width: compressed.width,
            height: compressed.height,
            productId: body.productId ?? null,
            isPrimary: makePrimary,
            source: 'admin_upload',
            altTextDe: body.altTextDe ?? null,
            altTextEn: body.altTextEn ?? null,
            workflowState: 'FOTOGRAFIERT',
            workflowChangedByUserId: actorId,
          })
          .returning();
        if (!inserted) throw new Error('product_photos INSERT returned no row');

        // r2_key := id (the on-disk base name) now that we have the generated id.
        const [withKey] = await tx
          .update(productPhotos)
          .set({ r2Key: inserted.id })
          .where(eq(productPhotos.id, inserted.id))
          .returning();
        if (!withKey) throw new Error('product_photos key-backfill returned no row');

        await tx.insert(productPhotoWorkflowEvents).values({
          productPhotoId: withKey.id,
          fromState: null,
          toState: 'FOTOGRAFIERT',
          changedByUserId: actorId,
          notes: 'API upload (local store)',
        });

        await tx.insert(auditLog).values({
          eventType: 'photo.uploaded_via_api',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            photoId: withKey.id,
            storageKind: 'local',
            productId: body.productId ?? null,
            contentType: PHOTO_CONTENT_TYPE,
            sizeBytes: compressed.main.length,
            thumbBytes: compressed.thumb.length,
            sourceBytes: raw.length,
            width: compressed.width,
            height: compressed.height,
          },
        });

        return withKey;
      });

      // 5b. Write the bytes AFTER commit. If the disk write fails, delete the
      //     row + any partial files so the cap counter never counts phantom
      //     bytes the disk doesn't hold.
      try {
        await writeRenditions(env, row.id, compressed);
      } catch (err) {
        await deleteRenditions(env, row.id).catch(() => {});
        await app.db
          .delete(productPhotos)
          .where(eq(productPhotos.id, row.id))
          .catch(() => {});
        throw new PhotoUploadValidationError(
          `Foto konnte nicht gespeichert werden: ${err instanceof Error ? err.message : 'I/O-Fehler'}`,
        );
      }

      return reply.status(200).send({
        id: row.id,
        productId: row.productId,
        r2Key: row.r2Key,
        publicUrl: publicUrlFor(env, row.id),
        thumbUrl: thumbUrlFor(env, row.id),
        workflowState: row.workflowState,
        createdAt: row.createdAt.toISOString(),
      });
    },
  );
};

export default photoDirectUploadRoute;
