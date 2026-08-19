/**
 * Photos domain client. Mirrors `apps/api-cloud/src/routes/photos.ts`
 * + the Day-12 additive `photo-upload-url.ts`.
 *
 *   requestUploadUrl(body) — POST /api/photos/upload-url     (Day 12; product-agnostic)
 *   register(body)         — POST /api/photos                (Day 24; bind r2_key → row)
 *   listUnassigned(query)  — GET  /api/photos/unassigned
 *   transitionState(id,…)  — PATCH /api/photos/:id/workflow-state
 *
 * Product-bound upload URL stays on the products domain:
 *   productsApi.requestPhotoUpload(productId, body) — POST /api/products/:id/photos
 */

import type { ApiClient } from '../client.js';

export type PhotoSource =
  | 'intake'
  | 'admin_upload'
  | 'storefront_user'
  | 'photographer'
  | 'phone_intake';
export type PhotoWorkflowState =
  | 'FOTOGRAFIERT'
  | 'BEARBEITET'
  | 'FREIGESTELLT'
  | 'ZUGEORDNET'
  | 'FUER_EBAY_BEREIT';

// ────────────────────────────────────────────────────────────────────────
// POST /api/photos/upload-url
// ────────────────────────────────────────────────────────────────────────

export type PhotoUploadIntent = 'product' | 'kyc' | 'orphan';

export interface PhotoUploadUrlBody {
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  contentLength: number;
  intent?: PhotoUploadIntent;
}

export interface PhotoUploadUrlResponse {
  r2Key: string;
  uploadUrl: string;
  publicUrl: string;
  requiredHeaders: { 'content-type': string };
  expiresAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/photos
// ────────────────────────────────────────────────────────────────────────

export interface PhotoRegisterBody {
  r2Key: string;
  productId?: string;
  source?: PhotoSource;
  /** Optional initial display metadata. */
  isPrimary?: boolean;
  altTextDe?: string;
  altTextEn?: string;
}

export type PhotoStorageKind = 'local' | 'r2';

export interface PhotoRow {
  id: string;
  productId: string | null;
  r2Key: string;
  /** 'local' = served by the api from disk; 'r2' = legacy Cloudflare R2. */
  storageKind?: PhotoStorageKind;
  /** Public URL to render the photo from (present on read endpoints). */
  publicUrl?: string;
  /** Compressed thumbnail URL (local-store rows). */
  thumbUrl?: string;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  r2KeyBgRemoved: string | null;
  displayOrder: number;
  isPrimary: boolean;
  source: PhotoSource;
  altTextDe: string | null;
  altTextEn: string | null;
  workflowState: PhotoWorkflowState;
  workflowChangedAt: string;
  workflowChangedByUserId: string | null;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/photos/upload — API-proxied direct upload (no R2 CORS dependency)
// ────────────────────────────────────────────────────────────────────────

export interface PhotoDirectUploadBody {
  /** Base64-encoded image bytes (no data: URI prefix). */
  dataBase64: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  productId?: string;
  intent?: PhotoUploadIntent;
  isPrimary?: boolean;
  altTextDe?: string;
  altTextEn?: string;
}

export interface PhotoDirectUploadResponse {
  id: string;
  productId: string | null;
  r2Key: string;
  publicUrl: string;
  /** Compressed thumbnail URL (local-store rows). */
  thumbUrl: string;
  workflowState: string;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/photos/:id/primary — choose the product's primary photo
// ────────────────────────────────────────────────────────────────────────

/**
 * Response of the set-primary mutation. The chosen photo becomes the ONE
 * `is_primary = true` row for its product (the previous primary is cleared in
 * the same transaction, honouring the `product_photos_one_primary_per_product_uq`
 * partial-unique index). The product's `primaryPhotoThumbUrl` in the Verkauf /
 * Kasse catalog then resolves to this photo.
 */
export interface PhotoSetPrimaryResponse {
  /** The photo now flagged primary. */
  id: string;
  /** Its product (never null — orphans cannot be primary). */
  productId: string;
  isPrimary: true;
  /** The previously-primary photo id that was cleared, if any. */
  previousPrimaryPhotoId: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/photos/usage
// ────────────────────────────────────────────────────────────────────────

export interface PhotoStoreUsage {
  usedBytes: number;
  maxBytes: number;
  count: number;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export const photosApi = {
  requestUploadUrl(client: ApiClient, body: PhotoUploadUrlBody): Promise<PhotoUploadUrlResponse> {
    return client.request<PhotoUploadUrlResponse>('POST', '/api/photos/upload-url', body);
  },
  register(client: ApiClient, body: PhotoRegisterBody): Promise<PhotoRow> {
    return client.request<PhotoRow>('POST', '/api/photos', body);
  },
  /**
   * Upload image bytes THROUGH the API (server writes to R2). This is the
   * robust path — it avoids the R2-bucket CORS requirement of the direct
   * presigned-PUT flow (`requestUploadUrl` + a browser PUT). The photo row is
   * created (and optionally product-bound) in the same call.
   */
  uploadDirect(client: ApiClient, body: PhotoDirectUploadBody): Promise<PhotoDirectUploadResponse> {
    // Uploads carry a real image payload — give them their own generous window
    // instead of the client's (deliberately short) default read timeout, so a
    // slow mobile uplink finishes instead of wrongly aborting.
    return client.request<PhotoDirectUploadResponse>('POST', '/api/photos/upload', body, {
      timeoutMs: 60_000,
    });
  },
  /** List the photos bound to a product (each row carries a `publicUrl`). */
  listForProduct(client: ApiClient, productId: string): Promise<{ items: PhotoRow[] }> {
    return client.request<{ items: PhotoRow[] }>(
      'GET',
      `/api/products/${encodeURIComponent(productId)}/photos`,
    );
  },
  /**
   * Promote one of a product's photos to be its PRIMARY (the single image the
   * Verkauf/Kasse catalog tile shows and the storefront gallery leads with).
   * The backend clears the old primary + sets this one in one transaction so
   * the exactly-one-primary-per-product invariant never breaks.
   */
  setPrimary(client: ApiClient, photoId: string): Promise<PhotoSetPrimaryResponse> {
    return client.request<PhotoSetPrimaryResponse>(
      'PATCH',
      `/api/photos/${encodeURIComponent(photoId)}/primary`,
    );
  },
  /**
   * Delete a photo entirely (row + stored renditions). ADMIN only. If it was
   * the product's primary, the server promotes the newest remaining photo so
   * the catalog tile never goes blank while other photos exist.
   */
  remove(client: ApiClient, photoId: string): Promise<{ id: string; deleted: boolean }> {
    return client.request<{ id: string; deleted: boolean }>(
      'DELETE',
      `/api/photos/${encodeURIComponent(photoId)}`,
    );
  },
  /** Local photo-store usage gauge (bytes used vs the cap, + count). */
  usage(client: ApiClient): Promise<PhotoStoreUsage> {
    return client.request<PhotoStoreUsage>('GET', '/api/photos/usage');
  },
};
