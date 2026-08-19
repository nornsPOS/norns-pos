/**
 * Documents domain client — Single-Operator Assistance (Day 25).
 *
 *   list(query)              — GET  /api/documents
 *   create(body)             — POST /api/documents
 *   archive(id)              — POST /api/documents/:id/archive   (Owner)
 *
 * The R2 byte upload happens via `photosApi.requestUploadUrl()` (it is the
 * shared signed-URL endpoint); the operator then POSTs metadata here.
 */

import type { ApiClient } from '../client.js';

export type DocumentCategory =
  | 'AUSWEIS'
  | 'ANKAUFBELEG'
  | 'RECHNUNG'
  | 'EXPERTISE'
  | 'ZERTIFIKAT'
  | 'VERSANDBELEG';

export const DOCUMENT_CATEGORY_LABELS: Readonly<Record<DocumentCategory, string>> = {
  AUSWEIS: 'Ausweis',
  ANKAUFBELEG: 'Ankaufbeleg',
  RECHNUNG: 'Rechnung',
  EXPERTISE: 'Expertise',
  ZERTIFIKAT: 'Zertifikat',
  VERSANDBELEG: 'Versandbeleg',
};

export interface DocumentRow {
  id: string;
  category: DocumentCategory;
  r2Key: string;
  fileName: string;
  mimeType: string;
  /** bigint as decimal string. */
  sizeBytes: string;
  sha256Hex: string | null;
  customerId: string | null;
  productId: string | null;
  transactionId: string | null;
  appraisalId: string | null;
  uploadedByUserId: string;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface ListDocumentsQuery {
  category?: DocumentCategory;
  customerId?: string;
  productId?: string;
  transactionId?: string;
  appraisalId?: string;
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListDocumentsResponse {
  items: DocumentRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CreateDocumentBody {
  category: DocumentCategory;
  r2Key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hex?: string;
  customerId?: string;
  productId?: string;
  transactionId?: string;
  appraisalId?: string;
  notes?: string;
}

function buildQuery(q: ListDocumentsQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const documentsApi = {
  list(client: ApiClient, query: ListDocumentsQuery = {}): Promise<ListDocumentsResponse> {
    return client.request<ListDocumentsResponse>('GET', `/api/documents${buildQuery(query)}`);
  },
  create(client: ApiClient, body: CreateDocumentBody): Promise<DocumentRow> {
    return client.request<DocumentRow>('POST', '/api/documents', body);
  },
  archive(client: ApiClient, id: string): Promise<{ archivedAt: string }> {
    return client.request<{ archivedAt: string }>(
      'POST',
      `/api/documents/${encodeURIComponent(id)}/archive`,
    );
  },
};
