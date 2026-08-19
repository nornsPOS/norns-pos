/**
 * TypeBox schemas for POST /api/photos/upload — the API-proxied direct upload.
 *
 * Unlike `/api/photos/upload-url` (which hands the client a presigned PUT URL
 * for a DIRECT browser→R2 upload, and therefore depends on the R2 bucket's
 * CORS policy allowing PUT from the Tauri webview origin), this route takes the
 * image BYTES (base64) in the request body, uploads them to R2 server-side, and
 * binds the resulting object to a `product_photos` row in one call.
 *
 * Trade-off: the bytes traverse the API (memory + bandwidth). For shop-floor
 * product photos that are cropped + WebP-compressed to ≤ ~300 KB before upload
 * this is negligible, and it removes the CORS dependency entirely — the durable
 * fix so the owner can add photos without any Cloudflare bucket-policy change.
 */

import { type Static, Type } from '@sinclair/typebox';

export const PhotoDirectUploadBody = Type.Object({
  /** Image payload, base64-encoded (no data: URI prefix). */
  dataBase64: Type.String({ minLength: 1 }),
  contentType: Type.Union([
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('image/webp'),
  ]),
  /** Optional product to bind the photo to immediately (creates an orphan if omitted). */
  productId: Type.Optional(Type.String({ format: 'uuid' })),
  intent: Type.Optional(
    Type.Union([Type.Literal('product'), Type.Literal('kyc'), Type.Literal('orphan')]),
  ),
  isPrimary: Type.Optional(Type.Boolean()),
  altTextDe: Type.Optional(Type.String({ maxLength: 500 })),
  altTextEn: Type.Optional(Type.String({ maxLength: 500 })),
});
export type PhotoDirectUploadBody = Static<typeof PhotoDirectUploadBody>;

export const PhotoDirectUploadResponse = Type.Object({
  id: Type.String(),
  productId: Type.Union([Type.String(), Type.Null()]),
  /** Storage key — for local rows this is the photo id (the on-disk base name). */
  r2Key: Type.String(),
  /** API-served MAIN webp URL (<base>/api/photos/<id>/raw). */
  publicUrl: Type.String({ format: 'uri' }),
  /** API-served THUMB webp URL (<base>/api/photos/<id>/thumb). */
  thumbUrl: Type.String({ format: 'uri' }),
  workflowState: Type.String(),
  createdAt: Type.String({ format: 'date-time' }),
});
export type PhotoDirectUploadResponse = Static<typeof PhotoDirectUploadResponse>;
