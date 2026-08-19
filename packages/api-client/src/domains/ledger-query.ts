/**
 * Ledger query domain — paged + filtered read of `ledger_events`.
 *
 *   list(query)   — GET /api/ledger
 *
 * The live + reconnect-replay stream lives at /api/sse/ledger and is
 * consumed via EventSource (see `ledger.ts` for the event type union).
 * This domain is the "scroll history" companion for the Tagebuch screen.
 */

import type { ApiClient } from '../client.js';
import type { LedgerEventType } from './ledger.js';

export interface LedgerListRow {
  id: number;
  eventType: LedgerEventType | string;
  entityTable: string;
  entityId: string;
  actorUserId: string | null;
  deviceId: string | null;
  payload: unknown;
  /** Hex-encoded SHA-256 row hash, for forensic correlation. */
  rowHashHex: string;
  createdAt: string;
}

export interface LedgerListQuery {
  eventType?: string;
  actorUserId?: string;
  entityTable?: string;
  /** ISO date inclusive lower bound (e.g. "2026-05-01"). */
  fromBusinessDay?: string;
  /** ISO date inclusive upper bound (e.g. "2026-05-31"). */
  toBusinessDay?: string;
  limit?: number;
  offset?: number;
}

export interface LedgerListResponse {
  items: LedgerListRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

function buildQuery(q: LedgerListQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const ledgerQueryApi = {
  list(client: ApiClient, query: LedgerListQuery = {}): Promise<LedgerListResponse> {
    return client.request<LedgerListResponse>('GET', `/api/ledger${buildQuery(query)}`);
  },
};
