/**
 * TypeBox schemas for POST /api/photos/upload-url — Day 12 additive.
 *
 * Product-agnostic presigned-PUT-URL request. Used by Foto-Werkstatt's
 * "shoot first, bind later" mode where the operator captures a photo
 * before knowing which product (or kyc_document) it belongs to.
 *
 * The returned R2 key follows the orphan-photo namespace
 *   uploads/orphan/<photoId>.<ext>
 * which lets the Phase 1.5 photo-reconciler worker find unbound R2
 * objects older than N days for cleanup.
 */

import { type Static, Type } from '@sinclair/typebox';

export const PhotoUploadUrlBody = Type.Object({
  contentType: Type.Union([
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('image/webp'),
  ]),
  contentLength: Type.Integer({ minimum: 1, maximum: 10 * 1024 * 1024 }),
  /**
   * Optional hint about the intended use so the namespace can pre-segment
   * by purpose. Defaults to "product". KYC capture lands under "kyc/".
   */
  intent: Type.Optional(
    Type.Union([Type.Literal('product'), Type.Literal('kyc'), Type.Literal('orphan')]),
  ),
});
export type PhotoUploadUrlBody = Static<typeof PhotoUploadUrlBody>;

export const PhotoUploadUrlResponse = Type.Object({
  r2Key: Type.String(),
  uploadUrl: Type.String({ format: 'uri' }),
  publicUrl: Type.String({ format: 'uri' }),
  requiredHeaders: Type.Object({ 'content-type': Type.String() }),
  expiresAt: Type.String({ format: 'date-time' }),
});
export type PhotoUploadUrlResponse = Static<typeof PhotoUploadUrlResponse>;
