/**
 * Belegtext-templates domain client — Backend Finale (Day 26).
 *
 *   list(query)            — GET  /api/belegtext-templates
 *   current(query)         — GET  /api/belegtext-templates/current
 *   resolve(query)         — GET  /api/belegtext-templates/resolve
 *   publish(body)          — POST /api/belegtext-templates  (Owner + step-up)
 *
 * On publish, the backend closes the previous CURRENT row (validTo = now())
 * and inserts a new CURRENT row in one TX.
 */

import type { ApiClient } from '../client.js';

export type BelegtextKind =
  | 'MARGIN_25A'
  | 'STANDARD_19'
  | 'REDUCED_7'
  | 'INVESTMENT_GOLD_25C'
  | 'KLEINUNTERNEHMER_19'
  | 'ANKAUFBELEG_DECLARATION'
  | 'GENERIC_HEADER'
  | 'GENERIC_FOOTER'
  | 'REVERSE_CHARGE_13B';

export type TaxTreatmentCode =
  | 'MARGIN_25A'
  | 'STANDARD_19'
  | 'REDUCED_7'
  | 'INVESTMENT_GOLD_25C'
  | 'MIXED'
  | 'REVERSE_CHARGE_13B';

export const BELEGTEXT_KIND_LABELS: Readonly<Record<BelegtextKind, string>> = {
  MARGIN_25A: 'Differenzbesteuerung (§25a)',
  STANDARD_19: 'Standard 19 %',
  REDUCED_7: 'Ermäßigt 7 %',
  INVESTMENT_GOLD_25C: 'Anlagegold (§25c)',
  KLEINUNTERNEHMER_19: 'Kleinunternehmer §19',
  ANKAUFBELEG_DECLARATION: 'Ankaufbeleg-Erklärung',
  GENERIC_HEADER: 'Beleg-Kopfzeile',
  GENERIC_FOOTER: 'Beleg-Fußzeile',
  REVERSE_CHARGE_13B: 'Steuerschuldnerschaft des Leistungsempfängers (§13b)',
};

export interface BelegtextRow {
  id: string;
  kind: BelegtextKind;
  language: string;
  bodyText: string;
  validFrom: string;
  validTo: string | null;
  createdByUserId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ListBelegtextQuery {
  kind?: BelegtextKind;
  language?: string;
  /** Defaults true server-side. Set false to receive historical versions too. */
  currentOnly?: boolean;
}

export interface ListBelegtextResponse {
  items: BelegtextRow[];
}

export interface CurrentBelegtextQuery {
  kind: BelegtextKind;
  language?: string;
}

export interface CurrentBelegtextResponse {
  kind: BelegtextKind;
  language: string;
  bodyText: string | null;
}

export interface ResolveBelegtextQuery {
  taxTreatmentCode: TaxTreatmentCode;
  language?: string;
}

export interface ResolveBelegtextResponse {
  taxTreatmentCode: TaxTreatmentCode;
  language: string;
  bodyText: string | null;
}

export interface PublishBelegtextBody {
  kind: BelegtextKind;
  language?: string;
  bodyText: string;
  notes?: string;
}

export interface PublishBelegtextResponse {
  kind: BelegtextKind;
  language: string;
  validFrom: string;
  previousBodyText: string | null;
}

function buildQuery(q: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const belegtextApi = {
  list(client: ApiClient, query: ListBelegtextQuery = {}): Promise<ListBelegtextResponse> {
    return client.request<ListBelegtextResponse>(
      'GET',
      `/api/belegtext-templates${buildQuery(query)}`,
    );
  },
  current(client: ApiClient, query: CurrentBelegtextQuery): Promise<CurrentBelegtextResponse> {
    return client.request<CurrentBelegtextResponse>(
      'GET',
      `/api/belegtext-templates/current${buildQuery(query)}`,
    );
  },
  resolve(client: ApiClient, query: ResolveBelegtextQuery): Promise<ResolveBelegtextResponse> {
    return client.request<ResolveBelegtextResponse>(
      'GET',
      `/api/belegtext-templates/resolve${buildQuery(query)}`,
    );
  },
  publish(client: ApiClient, body: PublishBelegtextBody): Promise<PublishBelegtextResponse> {
    return client.request<PublishBelegtextResponse>('POST', '/api/belegtext-templates', body);
  },
};
