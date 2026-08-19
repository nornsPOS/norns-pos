/**
 * photo-upload — shared two-step R2 upload pipeline for Day 12.
 *
 *   1. POST /api/photos/upload-url → presigned URL + R2 key
 *   2. PUT  the blob to R2 directly (never touches our API)
 *
 * The caller decides what to do with the returned `r2Key`:
 *   • orphan / product → POST /api/photos { r2Key, productId? }
 *   • KYC → POST /api/customers/:id/kyc-documents { r2Key, sha256Hex, … }
 *
 * Errors throw — the caller decides retry / discard semantics. The R2
 * PUT is fenced by the presigned URL's TTL (typically 10 min), so a
 * slow operator won't blow up; a 403 from R2 just means "presign again".
 */

import type { ApiClient } from '@norns/api-client';
import {
  type PhotoDirectUploadResponse,
  type PhotoUploadIntent,
  photosApi,
} from '@norns/api-client';

export interface UploadedPhoto {
  r2Key: string;
  publicUrl: string;
}

export type PhotoContentType = 'image/jpeg' | 'image/png' | 'image/webp';

/** Map a Blob's MIME type to the small allowlist the API accepts. Defaults to
 *  WebP, which is what CropStudio produces for product photos. */
export function photoContentTypeOf(blob: Blob): PhotoContentType {
  const t = blob.type;
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp') return t;
  return 'image/webp';
}

/** Encode a Blob to a bare base64 string (no `data:` prefix) for JSON transport. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked to stay clear of String.fromCharCode arg-count limits on big images.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Robust product-photo upload — sends the image bytes THROUGH the API, which
 * writes them to R2 server-side and binds a `product_photos` row in one call.
 *
 * This is the durable path: it has no dependency on an R2-bucket CORS policy
 * (the direct browser→R2 PUT in `uploadBlobToR2` below requires the bucket to
 * allow PUT from the Tauri webview origin, which it does not by default — that
 * was why product-photo uploads were being rejected).
 */
export async function uploadProductPhotoViaApi(input: {
  api: ApiClient;
  blob: Blob;
  productId?: string;
  intent?: PhotoUploadIntent;
  isPrimary?: boolean;
}): Promise<PhotoDirectUploadResponse> {
  const { api, blob, productId, intent, isPrimary } = input;
  const dataBase64 = await blobToBase64(blob);
  return photosApi.uploadDirect(api, {
    dataBase64,
    contentType: photoContentTypeOf(blob),
    ...(productId ? { productId } : {}),
    ...(intent ? { intent } : {}),
    ...(isPrimary !== undefined ? { isPrimary } : {}),
  });
}

export async function uploadBlobToR2(input: {
  api: ApiClient;
  blob: Blob;
  intent: PhotoUploadIntent;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<UploadedPhoto> {
  const { api, blob, intent, contentType } = input;

  // 1. Request presigned URL.
  const signed = await photosApi.requestUploadUrl(api, {
    contentType,
    contentLength: blob.size,
    intent,
  });

  // 2. PUT the blob to R2 directly. Use the headers the API insists on
  //    — they're part of the signature.
  const res = await fetch(signed.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { ...signed.requiredHeaders },
  });
  if (!res.ok) {
    throw new Error(
      `R2 PUT failed: ${res.status} ${res.statusText}. Die signierte URL ist möglicherweise abgelaufen.`,
    );
  }

  return { r2Key: signed.r2Key, publicUrl: signed.publicUrl };
}
