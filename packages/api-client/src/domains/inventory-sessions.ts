/**
 * Stichtagsinventur — the physical stock count (§240 HGB).
 *
 * One wrapper for both staff apps. The counting itself belongs at the counter
 * where the scanner is; opening and closing a session is the owner's call, and
 * closing carries step-up because the closing numbers become a document a
 * Betriebsprüfer may read.
 *
 * Only ONE session may be open at a time (a partial unique index enforces it
 * server-side), so `current` is a single object or null, never a list.
 */

import type { ApiClient } from '../client.js';

export type InventorySessionStatus = 'OPEN' | 'CLOSED';

export interface InventorySessionView {
  id: string;
  status: InventorySessionStatus;
  openedAt: string;
  closedAt: string | null;
  /** Countable stock at the moment the session was opened. */
  expectedCount: number;
  /** Null while the session is open — these are the CLOSING verdict. */
  matchedCount: number | null;
  missingCount: number | null;
  unexpectedCount: number | null;
}

/**
 * Live counts while the count is still running. Deliberately a different shape
 * from the closed session: `openCount` is "not found YET", which is a running
 * number, whereas `missingCount` on a closed session is a verdict — Schwund.
 */
export interface InventoryProgress {
  expectedCount: number;
  matchedCount: number;
  /** Countable pieces not yet found. Not Schwund until the session closes. */
  openCount: number;
  unexpectedCount: number;
  scanCount: number;
}

/**
 * How one scan was classified. The server decides; the client never guesses.
 *
 *   MATCHED           the piece is here and was expected
 *   DUPLICATE         already counted in this session
 *   UNKNOWN_BARCODE   no piece carries this code, by barcode or by SKU
 *   EXPECTED_BUT_SOLD sold or archived, so it should not be on the shelf
 *   UNEXPECTED        a draft piece that stock does not count yet
 */
export type InventoryMatchStatus =
  | 'MATCHED'
  | 'DUPLICATE'
  | 'UNKNOWN_BARCODE'
  | 'EXPECTED_BUT_SOLD'
  | 'UNEXPECTED';

export interface InventoryScanResult {
  id: string;
  matchStatus: string;
  productId: string | null;
  /** The recognised piece, so the counter sees WHAT it just confirmed. */
  sku: string | null;
}

export const inventorySessionsApi = {
  /** The open session, or null when no count is running. */
  current(client: ApiClient): Promise<InventorySessionView | null> {
    return client.request<InventorySessionView | null>('GET', '/api/inventory-sessions/current');
  },

  /** Open a count. ADMIN only; 409 when one is already open. */
  open(client: ApiClient): Promise<InventorySessionView> {
    return client.request<InventorySessionView>('POST', '/api/inventory-sessions');
  },

  progress(client: ApiClient, sessionId: string): Promise<InventoryProgress> {
    return client.request<InventoryProgress>(
      'GET',
      `/api/inventory-sessions/${encodeURIComponent(sessionId)}/progress`,
    );
  },

  /**
   * Record one scan. `rawBarcode` is whatever the scanner (or the keyboard)
   * produced — the server matches it against the barcode first and the SKU
   * second, because most pieces here are labelled with their own SKU.
   */
  scan(client: ApiClient, sessionId: string, rawBarcode: string): Promise<InventoryScanResult> {
    return client.request<InventoryScanResult>(
      'POST',
      `/api/inventory-sessions/${encodeURIComponent(sessionId)}/scans`,
      { body: { rawBarcode } },
    );
  },

  /** Close and compute the Schwund. ADMIN + step-up. */
  close(client: ApiClient, sessionId: string, notes?: string): Promise<InventorySessionView> {
    return client.request<InventorySessionView>(
      'POST',
      `/api/inventory-sessions/${encodeURIComponent(sessionId)}/close`,
      { body: notes != null && notes.length > 0 ? { notes } : {} },
    );
  },
};
