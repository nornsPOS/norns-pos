/**
 * Shifts domain client. Mirrors `apps/api-cloud/src/routes/shifts.ts`
 * exactly — Kassensturz / Blindsturz lifecycle.
 *
 *   getCurrent()             — GET  /api/shifts/current        (null when none)
 *   open(body)               — POST /api/shifts/open
 *   recordCashMovement(id,…) — POST /api/shifts/:id/cash-movements
 *   close(id, body)          — POST /api/shifts/:id/close      (step-up required)
 */

import type { ApiClient } from '../client.js';

export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface ShiftView {
  id: string;
  deviceId: string;
  openedByUserId: string;
  openedAt: string;
  openingFloatEur: string;
  status: ShiftStatus;
  blindCountEur: string | null;
  systemExpectedEur: string | null;
  varianceEur: string | null;
  closedAt: string | null;
}

export interface OpenShiftRequest {
  openingFloatEur: string;
  notes?: string;
}

export type CashMovementDirection = 'INJECTION' | 'BANK_DROP' | 'SAFE_TRANSIT';

export interface CashMovementRequest {
  direction: CashMovementDirection;
  amountEur: string;
  reason: string;
  witnessUserId?: string;
  externalRef?: string;
}

export interface CashMovementResponse {
  id: string;
}

export interface CloseShiftRequest {
  blindCountEur: string;
  notes?: string;
}

export const shifts = {
  getCurrent(client: ApiClient): Promise<ShiftView | null> {
    return client.request<ShiftView | null>('GET', '/api/shifts/current');
  },
  open(client: ApiClient, body: OpenShiftRequest): Promise<ShiftView> {
    return client.request<ShiftView>('POST', '/api/shifts/open', body);
  },
  recordCashMovement(
    client: ApiClient,
    shiftId: string,
    body: CashMovementRequest,
  ): Promise<CashMovementResponse> {
    return client.request<CashMovementResponse>(
      'POST',
      `/api/shifts/${encodeURIComponent(shiftId)}/cash-movements`,
      body,
    );
  },
  close(client: ApiClient, shiftId: string, body: CloseShiftRequest): Promise<ShiftView> {
    return client.request<ShiftView>(
      'POST',
      `/api/shifts/${encodeURIComponent(shiftId)}/close`,
      body,
    );
  },
};
