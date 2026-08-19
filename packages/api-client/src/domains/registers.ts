/**
 * registersApi — the An-/Verkaufsbuch (GwG §10 / §38 GewO purchase/sale register)
 * export. An inspector (Polizei / Gewerbeamt / Finanzamt) asks for exactly this:
 * who the shop bought from (ID-verified) and what.
 *
 * The CSV variant is a file download, so it goes through `responseType: 'text'`
 * (mirroring `closingsApi.datevCsv`) — without it the client would try to
 * JSON-parse the file body. ADMIN + step-up: a 403 STEP_UP_REQUIRED flows through
 * the step-up middleware and replays.
 */

import type { ApiClient } from '../client.js';

export interface AnVerkaufsbuchCsvQuery {
  /** ANKAUF (Ankäufe) or VERKAUF (Verkäufe). */
  direction: 'ANKAUF' | 'VERKAUF';
  /** Berlin business day (inclusive), YYYY-MM-DD. */
  from: string;
  /** Berlin business day (inclusive), YYYY-MM-DD. */
  to: string;
}

export const registersApi = {
  /**
   * GET /api/registers/an-verkaufsbuch?format=csv — the register as a CSV file
   * (ADMIN + step-up). Returns the CSV text; the caller wraps it in a Blob.
   */
  anVerkaufsbuchCsv(client: ApiClient, query: AnVerkaufsbuchCsvQuery): Promise<string> {
    const qs = new URLSearchParams({
      direction: query.direction,
      from: query.from,
      to: query.to,
      format: 'csv',
    });
    return client.request<string>(
      'GET',
      `/api/registers/an-verkaufsbuch?${qs.toString()}`,
      undefined,
      { responseType: 'text' },
    );
  },
};
