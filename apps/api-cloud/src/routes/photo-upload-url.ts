/**
 * POST /api/photos/upload-url — Day 12 additive.
 *
 * Returns a short-TTL presigned PUT URL for direct R2 upload. Distinct
 * from `POST /api/products/:id/photos` (which pre-inserts a product_photos
 * row) — this route is **product-agnostic**: it only signs the URL +
 * audit-logs the request. The client uploads the blob, then calls either
 * `POST /api/photos` (orphan registration → product_photos with
 * productId=null) or `POST /api/customers/:id/kyc-documents` (KYC binding)
 * to actually create the DB row.
 *
 * Audit: every request lands an `photo.upload_url_requested` row so we can
 * later reconcile signed-but-unused URLs (a Phase 1.5 worker scans for
 * R2 keys that never landed a row OR R2 objects that never got bound).
 */

import { randomUUID } from 'node:crypto';

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { getPresignedPutUrl } from '../lib/r2.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  PhotoUploadUrlBody,
  PhotoUploadUrlResponse,
  type PhotoUploadUrlBody as TBody,
} from '../schemas/photo-upload-url.js';

class R2NotConfiguredError extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'SERVICE_UNAVAILABLE';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

function extForMime(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'bin';
}

function buildOrphanKey(intent: 'product' | 'kyc' | 'orphan', mime: string): string {
  const photoId = randomUUID();
  const prefix =
    intent === 'kyc' ? 'kyc' : intent === 'product' ? 'uploads/product' : 'uploads/orphan';
  return `${prefix}/${photoId}.${extForMime(mime)}`;
}

export interface PhotoUploadUrlOpts {
  env: Env;
}

const photoUploadUrlRoute: FastifyPluginAsync<PhotoUploadUrlOpts> = async (app, opts) => {
  app.post<{ Body: TBody }>(
    '/api/photos/upload-url',
    {
      schema: {
        tags: ['photos'],
        summary: 'Request a product-agnostic R2 presigned PUT URL (Foto-Werkstatt).',
        description:
          'Returns an R2 presigned PUT URL with a fresh orphan key. The client uploads ' +
          'the blob to R2, then calls POST /api/photos (orphan) OR ' +
          'POST /api/customers/:id/kyc-documents (KYC) to bind the R2 object to a row.',
        body: PhotoUploadUrlBody,
        response: {
          200: PhotoUploadUrlResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const intent = body.intent ?? 'orphan';
      const r2Key = buildOrphanKey(intent, body.contentType);

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

      await app.db.insert(auditLog).values({
        eventType: 'photo.upload_url_requested',
        actorUserId: req.actor.id,
        deviceId: req.deviceId ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: {
          r2Key,
          intent,
          contentType: body.contentType,
          contentLength: body.contentLength,
        },
      });

      return reply.status(200).send({
        r2Key: presigned.key,
        uploadUrl: presigned.url,
        publicUrl: presigned.publicUrl,
        requiredHeaders: presigned.requiredHeaders,
        expiresAt: presigned.expiresAt,
      });
    },
  );
};

export default photoUploadUrlRoute;
