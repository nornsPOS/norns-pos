/**
 * Dashboard summary domain client. Mirrors
 * `apps/api-cloud/src/routes/dashboard.ts` exactly.
 */

import type { ApiClient } from '../client.js';

export interface DashboardSummary {
  openTasksMine: number;
  tasksDueToday: number;
  tasksOverdue: number;
  pendingAppraisals: number;
  unassignedPhotos: number;
  // 14.08.2026: ebayPipelineDepth + ebayConflictsWeek entfernt — der
  // eBay-Ausbau liess keine Schreiber zurueck, der Motor sendet sie nicht mehr.
  currentShiftId: string | null;
  /**
   * NETTOUMSATZ der offenen Schicht: Verkäufe MINUS ihre Stornierungen,
   * gleich womit bezahlt wurde. Seit dem 14.08.2026 zählt das Storno-Bein
   * mit; zuvor blieb nach einem voll stornierten Verkauf dessen Betrag als
   * angeblicher Umsatz stehen.
   */
  currentShiftRevenueEur: string;
  /**
   * Die BAR-Bewegung der offenen Schicht: Verkäufe hinein, Ankauf-
   * Auszahlungen hinaus, Einlagen hinein, Abschöpfung und Tresortransit
   * hinaus, Stornos mit ihrem eigenen Vorzeichen — dieselben Bein-Familien
   * wie der Kassensturz.
   *
   * ⚠️ `currentShiftRevenueEur` daneben ist der GESAMTE Umsatz und zählt
   * Kartenzahlung mit. Wer damit den erwarteten Ladenbestand rechnet, lässt
   * den Kassierer Geld suchen, das nie in der Lade war. Seit dem 14.08.2026
   * zählen die Ankauf-Beine mit, seit dem 15.08.2026 auch Einlagen und
   * Entnahmen; zuvor log die Tageskasse nach jeder dieser Bewegungen um
   * deren volle Höhe.
   */
  currentShiftBarEur: string;
  watchlistCustomerCount: number;
  workerJobsRunning: string[];
  lastChainVerifiedAt: string | null;
  workerDlqUnacked: number;
  currentMetalPrices: {
    gold: string | null;
    silver: string | null;
    platinum: string | null;
    palladium: string | null;
  };
  computedAt: string;
}

export const dashboard = {
  summary(client: ApiClient): Promise<DashboardSummary> {
    return client.request<DashboardSummary>('GET', '/api/dashboard/summary');
  },
};
