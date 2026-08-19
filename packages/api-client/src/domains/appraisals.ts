/**
 * Appraisals domain client. Mirrors `apps/api-cloud/src/routes/appraisals.ts`
 * (Day-22 routes + Day-11 accept-handler fix #I-38).
 *
 *   open(body)         — POST   /api/appraisals
 *   get(id)            — GET    /api/appraisals/:id
 *   addItem(id, body)  — POST   /api/appraisals/:id/items
 *   removeItem(id,iid) — DELETE /api/appraisals/:id/items/:itemId
 *   complete(id, body) — POST   /api/appraisals/:id/complete
 *   accept(id)         — POST   /api/appraisals/:id/accept  (step-up + Owner-only)
 *   reject(id, body)   — POST   /api/appraisals/:id/reject
 */

import type { ApiClient } from '../client.js';
import type { AnkaufCondition, AnkaufItemType, AnkaufMetal } from './transactions.js';

export type AppraisalStatus = 'DRAFT' | 'COMPLETED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';

export interface AppraisalItemView {
  id: string;
  sequenceInLot: number;
  productId: string | null;
  name: string;
  description?: string;
  itemType: AnkaufItemType;
  metal?: AnkaufMetal;
  karatCode?: string;
  finenessDecimal?: string;
  weightGrams?: string;
  condition?: AnkaufCondition;
  hallmarkStamps: string[];
  /** 0143 */
  seriennummer?: string;
  gravur?: string;
  individualAppraisedEur: string;
  photoR2Keys: string[];
  notes?: string;
}

export interface AppraisalView {
  id: string;
  customerId: string;
  appraisedByUserId: string;
  status: AppraisalStatus;
  totalAppraisedEur: string;
  totalOfferedEur: string | null;
  customerExpectationEur: string | null;
  ankaufTransactionId: string | null;
  notes: string | null;
  openedAt: string;
  completedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  items: AppraisalItemView[];
}

// ────────────────────────────────────────────────────────────────────────
// Bodies
// ────────────────────────────────────────────────────────────────────────

export interface AppraisalOpenBody {
  customerId: string;
  notes?: string;
  customerExpectationEur?: string;
}

export interface AppraisalItemBody {
  name: string;
  description?: string;
  itemType: AnkaufItemType;
  metal?: AnkaufMetal;
  karatCode?: string;
  finenessDecimal?: string;
  weightGrams?: string;
  condition?: AnkaufCondition;
  hallmarkStamps?: string[];
  /** 0143 */
  seriennummer?: string;
  gravur?: string;
  individualAppraisedEur: string;
  photoR2Keys?: string[];
  notes?: string;
}

export interface AppraisalCompleteBody {
  totalOfferedEur: string;
}

export interface AppraisalRejectBody {
  reason: string;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export const appraisalsApi = {
  open(client: ApiClient, body: AppraisalOpenBody): Promise<AppraisalView> {
    return client.request<AppraisalView>('POST', '/api/appraisals', body);
  },
  get(client: ApiClient, id: string): Promise<AppraisalView> {
    return client.request<AppraisalView>('GET', `/api/appraisals/${encodeURIComponent(id)}`);
  },
  addItem(client: ApiClient, id: string, body: AppraisalItemBody): Promise<AppraisalView> {
    return client.request<AppraisalView>(
      'POST',
      `/api/appraisals/${encodeURIComponent(id)}/items`,
      body,
    );
  },
  removeItem(client: ApiClient, id: string, itemId: string): Promise<AppraisalView> {
    return client.request<AppraisalView>(
      'DELETE',
      `/api/appraisals/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`,
    );
  },
  complete(client: ApiClient, id: string, body: AppraisalCompleteBody): Promise<AppraisalView> {
    return client.request<AppraisalView>(
      'POST',
      `/api/appraisals/${encodeURIComponent(id)}/complete`,
      body,
    );
  },
  accept(client: ApiClient, id: string): Promise<AppraisalView> {
    return client.request<AppraisalView>(
      'POST',
      `/api/appraisals/${encodeURIComponent(id)}/accept`,
    );
  },
  reject(client: ApiClient, id: string, body: AppraisalRejectBody): Promise<AppraisalView> {
    return client.request<AppraisalView>(
      'POST',
      `/api/appraisals/${encodeURIComponent(id)}/reject`,
      body,
    );
  },
};
