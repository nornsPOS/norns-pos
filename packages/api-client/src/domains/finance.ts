/**
 * Finance domain clients — Owner OS P&L + expenses + fixed costs.
 *
 * Mirrors apps/api-cloud/src/routes/{finance,expenses,fixed-costs}.ts and the
 * shared schema apps/api-cloud/src/schemas/finance.ts.
 *
 *   financeApi.profit({ period })        — GET  /api/finance/profit
 *   financeApi.monthRevenue()            — GET  /api/finance/revenue?period=month
 *   financeApi.inventoryValue()          — GET  /api/inventory/value
 *   financeApi.metalWeights()            — GET  /api/inventory/metal-weights
 *
 *   expensesApi.list(query)              — GET   /api/expenses
 *   expensesApi.create(body)             — POST  /api/expenses      (ADMIN + step-up)
 *   expensesApi.update(id, body)         — PATCH /api/expenses/:id   (ADMIN + step-up)
 *
 *   fixedCostsApi.list(query)            — GET   /api/fixed-costs
 *   fixedCostsApi.create(body)           — POST  /api/fixed-costs    (ADMIN + step-up)
 *   fixedCostsApi.update(id, body)       — PATCH /api/fixed-costs/:id (ADMIN + step-up)
 *
 * IMPORTANT: every money field on this surface is an INTEGER number of EUR
 * CENTS (NOT a decimal string). Format with the consumer's de-DE Money helper.
 * Step-up 403s (STEP_UP_REQUIRED) are handled transparently by the host's
 * step-up flow — callers do not special-case them.
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// Shared
// ────────────────────────────────────────────────────────────────────────

export type FinancePeriod = 'day' | 'month';

export type ExpenseCategory =
  | 'WARENEINKAUF'
  | 'MIETE'
  | 'MARKETING'
  | 'VERSAND'
  | 'BUEROMATERIAL'
  | 'REPARATUR'
  | 'GEBUEHREN'
  | 'REISEKOSTEN'
  | 'SONSTIGES';

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  'WARENEINKAUF',
  'MIETE',
  'MARKETING',
  'VERSAND',
  'BUEROMATERIAL',
  'REPARATUR',
  'GEBUEHREN',
  'REISEKOSTEN',
  'SONSTIGES',
];

/**
 * Womit eine Betriebsausgabe bezahlt wurde (migration 0133). Eigenes
 * Vokabular, getrennt von der Zahlart einer Einnahme. NUR `BAR` bewegt den
 * Kassenbestand. `UNBEKANNT` ist ein Zustand alter Zeilen aus der Zeit vor
 * dem 06.08.2026, keine Wahl beim Anlegen oder Ändern.
 */
export type AusgabeZahlweg = 'BAR' | 'BANK' | 'KARTE' | 'UNBEKANNT';

/** Der waehlbare Ausschnitt — ohne `UNBEKANNT` (siehe `AusgabeZahlweg`). */
export type AusgabeZahlwegWaehlbar = Exclude<AusgabeZahlweg, 'UNBEKANNT'>;

export const AUSGABE_ZAHLWEGE_WAEHLBAR: readonly AusgabeZahlwegWaehlbar[] = [
  'BAR',
  'BANK',
  'KARTE',
];

function buildQuery(query: object): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// ────────────────────────────────────────────────────────────────────────
// financeApi — read aggregates
// ────────────────────────────────────────────────────────────────────────

export interface ProfitResponse {
  period: FinancePeriod;
  grossRevenueCents: number;
  grossAnkaufCents: number;
  expensesCents: number;
  fixedCostsAllocatedCents: number;
  netProfitCents: number;
}

export interface MonthRevenueResponse {
  monthToDateRevenueCents: number;
}

export interface InventoryValueResponse {
  listValueCents: number;
  acquisitionValueCents: number;
  availableCount: number;
}

export interface MetalWeightsResponse {
  goldGrams: number;
  silverGrams: number;
  platinumGrams: number;
  palladiumGrams: number;
}

export const financeApi = {
  profit(client: ApiClient, opts: { period?: FinancePeriod } = {}): Promise<ProfitResponse> {
    return client.request<ProfitResponse>(
      'GET',
      `/api/finance/profit${buildQuery({ period: opts.period })}`,
    );
  },
  monthRevenue(client: ApiClient): Promise<MonthRevenueResponse> {
    return client.request<MonthRevenueResponse>('GET', '/api/finance/revenue?period=month');
  },
  inventoryValue(client: ApiClient): Promise<InventoryValueResponse> {
    return client.request<InventoryValueResponse>('GET', '/api/inventory/value');
  },
  metalWeights(client: ApiClient): Promise<MetalWeightsResponse> {
    return client.request<MetalWeightsResponse>('GET', '/api/inventory/metal-weights');
  },
};

// ────────────────────────────────────────────────────────────────────────
// expensesApi — one-off operating expenses
// ────────────────────────────────────────────────────────────────────────

export interface ExpenseRow {
  id: string;
  /** ISO date (YYYY-MM-DD) the expense is booked against. */
  date: string;
  category: ExpenseCategory;
  amountCents: number;
  zahlweg: AusgabeZahlweg;
  note: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListExpensesQuery {
  from?: string;
  to?: string;
  category?: ExpenseCategory;
  limit?: number;
  offset?: number;
}

export interface ListExpensesResponse {
  items: ExpenseRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CreateExpenseBody {
  date: string;
  category: ExpenseCategory;
  amountCents: number;
  /** Pflicht: wer heute eine Ausgabe erfasst, weiss, womit er bezahlt hat. */
  zahlweg: AusgabeZahlwegWaehlbar;
  note?: string;
}

export interface UpdateExpenseBody {
  date?: string;
  category?: ExpenseCategory;
  amountCents?: number;
  zahlweg?: AusgabeZahlwegWaehlbar;
  note?: string | null;
}

export const expensesApi = {
  /**
   * GET /api/expenses/export/datev — unbare Ausgaben (Bank, Karte) eines
   * Zeitraums als EXTF-Buchungsstapel (ADMIN|READONLY + step-up). Bytes,
   * weil der Server Windows-1252 sendet; der Name kommt aus dem Kopf.
   */
  datevDatei(
    client: ApiClient,
    von: string,
    bis: string,
    kontenrahmen?: string,
  ): Promise<{ inhalt: ArrayBuffer; dateiname: string | null }> {
    const rahmen = kontenrahmen ? `&kontenrahmen=${encodeURIComponent(kontenrahmen)}` : '';
    return client.requestMitDateiname<ArrayBuffer>(
      'GET',
      `/api/expenses/export/datev?von=${encodeURIComponent(von)}&bis=${encodeURIComponent(bis)}${rahmen}`,
      undefined,
      { responseType: 'arraybuffer' },
    );
  },
  list(client: ApiClient, query: ListExpensesQuery = {}): Promise<ListExpensesResponse> {
    return client.request<ListExpensesResponse>('GET', `/api/expenses${buildQuery(query)}`);
  },
  create(client: ApiClient, body: CreateExpenseBody): Promise<ExpenseRow> {
    return client.request<ExpenseRow>('POST', '/api/expenses', body);
  },
  update(client: ApiClient, id: string, body: UpdateExpenseBody): Promise<ExpenseRow> {
    return client.request<ExpenseRow>('PATCH', `/api/expenses/${encodeURIComponent(id)}`, body);
  },
};

// ────────────────────────────────────────────────────────────────────────
// fixedCostsApi — recurring monthly fixed costs
// ────────────────────────────────────────────────────────────────────────

export interface FixedCostRow {
  id: string;
  label: string;
  monthlyAmountCents: number;
  activeFrom: string;
  activeTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListFixedCostsQuery {
  activeOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface ListFixedCostsResponse {
  items: FixedCostRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CreateFixedCostBody {
  label: string;
  monthlyAmountCents: number;
  activeFrom: string;
  activeTo?: string | null;
}

export interface UpdateFixedCostBody {
  label?: string;
  monthlyAmountCents?: number;
  activeFrom?: string;
  activeTo?: string | null;
}

export const fixedCostsApi = {
  list(client: ApiClient, query: ListFixedCostsQuery = {}): Promise<ListFixedCostsResponse> {
    return client.request<ListFixedCostsResponse>('GET', `/api/fixed-costs${buildQuery(query)}`);
  },
  create(client: ApiClient, body: CreateFixedCostBody): Promise<FixedCostRow> {
    return client.request<FixedCostRow>('POST', '/api/fixed-costs', body);
  },
  update(client: ApiClient, id: string, body: UpdateFixedCostBody): Promise<FixedCostRow> {
    return client.request<FixedCostRow>(
      'PATCH',
      `/api/fixed-costs/${encodeURIComponent(id)}`,
      body,
    );
  },
};
