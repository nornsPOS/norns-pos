/**
 * Bridge KPI snapshot domain client. Mirrors
 * `apps/api-cloud/src/routes/bridge.ts` (`GET /api/bridge/summary`) exactly.
 *
 * A compact, cents-based owner snapshot computed from the SAME real columns the
 * rest of the app uses (transactions, appointments, tse_clients, worker_job_dlq).
 * ADMIN only. All money fields are in CENTS — convert/format at the edge.
 */

import type { ApiClient } from '../client.js';

export interface BridgeSummary {
  todayRevenueCents: number;
  todaySalesCount: number;
  todayAnkaufCount: number;
  todayAnkaufValueCents: number;
  approvalsPending: number;
  nextAppointmentAt: string | null;
  todayAppointmentCount: number;
  tseCertDaysRemaining: number | null;
  workerDlqUnacked: number;
  systemStatus: 'ok' | 'watch' | 'alert';
  computedAt: string;
}

export const bridgeApi = {
  /** GET /api/bridge/summary — compact owner KPI snapshot (ADMIN only). */
  summary(client: ApiClient): Promise<BridgeSummary> {
    return client.request<BridgeSummary>('GET', '/api/bridge/summary');
  },
};
