/**
 * Customers domain client — Day 8 additive.
 *
 * Wraps the Day-17 customer surface (create + by-id detail) PLUS the
 * Day-8 additive list/search endpoint. Trust + KYC PATCH routes from
 * Day-26 are exposed here so the Ankauf surface can stamp inline.
 *
 *   list(q?)          — GET    /api/customers              (Day 8)
 *   get(id)           — GET    /api/customers/:id          (Day 17)
 *   create(body)      — POST   /api/customers              (Day 17)
 *   stampKyc(id, ...) — PATCH  /api/customers/:id/kyc      (Day 26, step-up required)
 *   setTrust(id, ...) — PATCH  /api/customers/:id/trust    (Day 26, step-up required)
 *
 * The list endpoint returns a minimal projection (no DOB, no address).
 * Decrypted full_name is included for the matched rows so the operator can
 * visually confirm "yes that's the person standing at the counter".
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// Common types
// ────────────────────────────────────────────────────────────────────────

/**
 * KYC (GwG) document status — mirrors the live `kyc_status` Postgres enum and the
 * route response schemas (customer-list.ts, customer.ts). The earlier
 * COMPLETED/FAILED pair never existed in the backend: the real lifecycle is
 * PENDING → CAPTURED (Ausweis erfasst) → VERIFIED (geprüft), with EXPIRED/REJECTED
 * as terminal states. Keeping this out of sync silently blanked the badge for
 * VERIFIED/CAPTURED customers, so this MUST track the DB enum exactly.
 */
export type CustomerKycStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'CAPTURED'
  | 'VERIFIED'
  | 'EXPIRED'
  | 'REJECTED';
export type CustomerTrustLevel = 'NEW' | 'VERIFIED' | 'VIP' | 'SUSPICIOUS' | 'BANNED';
export type CustomerLanguage = 'de' | 'en' | 'ar';

/** German display labels for the KYC (GwG) status. Operator-facing surfaces
 *  MUST render these — never the raw SCREAMING_CASE enum value. */
export const CUSTOMER_KYC_STATUS_LABELS: Readonly<Record<CustomerKycStatus, string>> = {
  NOT_REQUIRED: 'Nicht erforderlich',
  PENDING: 'Ausstehend',
  CAPTURED: 'Ausweis erfasst',
  VERIFIED: 'Geprüft',
  EXPIRED: 'Abgelaufen',
  REJECTED: 'Abgelehnt',
};

/** German display labels for the customer trust level. */
export const CUSTOMER_TRUST_LEVEL_LABELS: Readonly<Record<CustomerTrustLevel, string>> = {
  NEW: 'Neu',
  VERIFIED: 'Verifiziert',
  VIP: 'VIP',
  SUSPICIOUS: 'Beobachten',
  BANNED: 'Gesperrt',
};

// ────────────────────────────────────────────────────────────────────────
// GET /api/customers
// ────────────────────────────────────────────────────────────────────────

export interface CustomerListQuery {
  q?: string;
  kycVerifiedOnly?: boolean;
  excludeBlocked?: boolean;
  /**
   * Gelöschte Konten mitliefern, damit die Kundenliste sie DURCHGESTRICHEN
   * zeigen kann statt sie verschwinden zu lassen. Standard `false`, damit die
   * Kundenauswahl beim Verkauf und Ankauf keinen anonymisierten Menschen
   * anbietet.
   */
  includeErased?: boolean;
  limit?: number;
  offset?: number;
}

export interface CustomerListRow {
  id: string;
  customerNumber: string;
  fullName: string;
  kycStatus: CustomerKycStatus;
  kycVerifiedAt: string | null;
  trustLevel: CustomerTrustLevel;
  sanctionsMatch: boolean;
  /**
   * §15 GwG — politically exposed person. Surfaced on the list row so a picker
   * can flag the enhanced-due-diligence signal before the customer is chosen,
   * not only on the detail file. Distinct from `sanctionsMatch`, which blocks.
   */
  pepMatch: boolean;
  cumulativeAnkaufEur: string;
  cumulativeSpendEur: string;
  createdAt: string;
  /** Last fiscal activity (any direction), or null if the customer never transacted. */
  lastOrderAt: string | null;
  /**
   * Wann das Konto gelöscht wurde, sonst null. Die Zeile bleibt bestehen: die
   * Löschung ist eine Anonymisierung, damit Kundennummer und Umsätze für §147
   * AO erhalten bleiben. Die Fläche streicht die Zeile durch.
   */
  deletedAt: string | null;
  /**
   * WER gelöscht hat. CUSTOMER heisst: der Mensch hat es selbst getan, und
   * genau das gehört sichtbar dazu, damit niemand im Laden rätselt, ob wir
   * dieses Konto entfernt haben.
   */
  erasureInitiatedBy: 'CUSTOMER' | 'STAFF' | null;
}

export interface CustomerListResponse {
  items: CustomerListRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/customers
// ────────────────────────────────────────────────────────────────────────

export interface CustomerCreateBody {
  fullName: string;
  dateOfBirth?: string; // ISO date or readable string — server stores encrypted
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  vatId?: string | null;
  preferredLanguage?: CustomerLanguage;
  customerTags?: string[];
  retentionYears?: number;
}

export interface CustomerCreateResponse {
  id: string;
  customerNumber: string;
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/customers/:id
// ────────────────────────────────────────────────────────────────────────

export interface CustomerDetail {
  id: string;
  customerNumber: string;
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  vatId: string | null;
  preferredLanguage: CustomerLanguage;
  customerTags: string[];
  kycStatus: CustomerKycStatus;
  kycCompletedAt: string | null;
  /** Day-26 column. Operator's eyeball-verification stamp. */
  kycVerifiedAt: string | null;
  trustLevel: CustomerTrustLevel;
  sanctionsMatch: boolean;
  pepMatch: boolean;
  cumulativeSpendEur: string;
  cumulativeAnkaufEur: string;
  cumulativeDebtEur: string;
  /**
   * §10 GwG aggregation context — the sum of this customer's ANKAUF buys inside
   * the configured rolling window (prior buys only, excluding the cart being
   * built now). The POS KYC gate adds the current cart and requires ID when the
   * running window crosses the threshold even if the current buy is under it.
   */
  gwgRollingAnkauf: {
    windowDays: number;
    priorAnkaufEur: string;
  };
  retentionUntil: string;
  createdAt: string;
  /**
   * How the customer came to exist, derived from the linked storefront account:
   * GOOGLE (Google sign-in), EMAIL (online e-mail sign-up), or IN_STORE (created
   * at the counter). `online` is true whenever a self-service webshop account
   * exists — this is how a Google/online customer is recognised in the file.
   * Optional so an older server (that predates this field) never crashes the UI.
   */
  registration?: {
    method: 'GOOGLE' | 'EMAIL' | 'IN_STORE';
    online: boolean;
  };
}

// ────────────────────────────────────────────────────────────────────────
// PUT /api/customers/:id (Day 10) — update PII; step-up when kyc_verified
// ────────────────────────────────────────────────────────────────────────

export interface CustomerUpdateBody {
  fullName?: string;
  dateOfBirth?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  vatId?: string | null;
  preferredLanguage?: CustomerLanguage;
  customerTags?: string[];
}

export interface CustomerUpdateResponse {
  id: string;
  changedFields: string[];
  stepUpEnforced: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/customers/:id/kyc-documents (Day 12 — closes #I-47)
// ⚰️ 22.08.2026: hier stand „step-up". Der Motor verlangt ihn hier NICHT und
// soll es nicht — der Gerätecode steht nur vor Unwiderruflichem (Basels
// Entscheidung vom 05.08.2026). Der Vermerk ließ das Gegenteil vermuten.
// ────────────────────────────────────────────────────────────────────────

export type KycDocumentType =
  | 'PERSONALAUSWEIS'
  | 'REISEPASS'
  | 'ID_CARD_EU'
  | 'PASSPORT_EU'
  | 'PASSPORT_NON_EU';

export interface CustomerKycDocumentBody {
  documentType: KycDocumentType;
  /** ISO 3166-1 alpha-2, uppercase. */
  issuingCountryIso2: string;
  issuingAuthority?: string;
  documentNumber: string;
  issuedOn?: string;
  expiresOn: string;
  /**
   * Image payload, base64-encoded (no `data:` prefix). The server compresses,
   * EXIF-strips, AES-256-GCM-encrypts to a LOCAL file (migration 0074) and
   * computes the sha256 — the client no longer supplies an r2Key or hash.
   */
  dataBase64: string;
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
  retentionYears?: number;
}

export interface CustomerKycDocumentResponse {
  id: string;
  customerId: string;
  documentType: KycDocumentType;
  capturedAt: string;
  expiresOn: string;
  retentionUntil: string;
}

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/customers/:id/kyc + /trust  (Day 26 — step-up required)
// ────────────────────────────────────────────────────────────────────────

/**
 * Document type physically inspected at the KYC stamp. This is a SEPARATE enum
 * from {@link KycDocumentType} (the capture/upload route): the trust/stamp route
 * (PATCH /api/customers/:id/kyc) validates its own audit enum, so it MUST track
 * `KycStampBody.documentType` in apps/api-cloud/src/schemas/customer-trust.ts
 * exactly — a mismatch is a 400 VALIDATION_ERROR.
 */
export type CustomerKycStampDocumentType =
  | 'PERSONALAUSWEIS'
  | 'REISEPASS'
  | 'EU_NATIONAL_ID'
  | 'AUFENTHALTSTITEL'
  | 'PASSPORT_NON_EU';

export interface CustomerKycStampBody {
  /**
   * Document type physically inspected — REQUIRED by the backend (non-optional
   * enum). Omitting it 400s before any DB write, so it is required here too.
   */
  documentType: CustomerKycStampDocumentType;
  promoteTrustLevelTo?: 'VERIFIED' | 'VIP';
  notes?: string;
}

export interface CustomerKycStampResponse {
  id: string;
  kycVerifiedAt: string;
  trustLevel: CustomerTrustLevel;
}

export interface CustomerTrustChangeBody {
  trustLevel: CustomerTrustLevel;
  /**
   * Required (≥ 8 chars) when trustLevel ∈ {SUSPICIOUS, BANNED}; saved to
   * `price_expectation_notes`. The wire field is `reason` — the backend
   * SetTrustBody validates/persists `req.body.reason`, so this MUST be `reason`
   * (an earlier `priceExpectationNotes` key was silently dropped → 400).
   */
  reason?: string;
}

export interface CustomerTrustChangeResponse {
  id: string;
  trustLevel: CustomerTrustLevel;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/customers/:id/check-sanctions  (Epic J — GwG PEP/EU/OFAC)
// ────────────────────────────────────────────────────────────────────────

export interface SanctionsCheckResult {
  customerId: string;
  /** Best match score in [0, 1]. */
  score: number;
  /** True iff a real watchlist hit at/above the configured threshold. */
  matched: boolean;
  /** True when the OpenSanctions API was unreachable (fail-safe, not a hit). */
  apiUnavailable?: boolean;
  /** True when no API key is configured and screening was skipped. */
  skipped?: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Querystring helper
// ────────────────────────────────────────────────────────────────────────

function buildQuery(query: CustomerListQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export interface CustomerVatLookupResult {
  id: string;
  customerNumber: string;
  fullName: string;
  vatId: string | null;
}

// 15.08.2026 (0.6.0 Spur E): hier standen CustomerWebOrder + webOrders(),
// der Blick auf die Webshop-Bestellungen der carts/shoppers-Welt. Seit dem
// 0.4.0-Kahlschlag schreibt nichts mehr in diese Welt; Route und Kachel
// sind mit entfernt.

export const customersApi = {
  list(client: ApiClient, query: CustomerListQuery = {}): Promise<CustomerListResponse> {
    return client.request<CustomerListResponse>('GET', `/api/customers${buildQuery(query)}`);
  },
  get(client: ApiClient, id: string): Promise<CustomerDetail> {
    return client.request<CustomerDetail>('GET', `/api/customers/${encodeURIComponent(id)}`);
  },
  /**
   * Resolve at most ONE customer by VAT id in a single bounded request (the POS
   * B2B checkout). Returns null when no customer matches. CASHIER-allowed (the
   * by-id `get` is ADMIN-only), so this is safe to call from a cashier till.
   */
  findByVatId(client: ApiClient, vatId: string): Promise<CustomerVatLookupResult | null> {
    return client
      .request<{ customer: CustomerVatLookupResult | null }>(
        'GET',
        `/api/customers/by-vat-id?vatId=${encodeURIComponent(vatId)}`,
      )
      .then((r) => r.customer);
  },
  create(client: ApiClient, body: CustomerCreateBody): Promise<CustomerCreateResponse> {
    return client.request<CustomerCreateResponse>('POST', '/api/customers', body);
  },
  update(client: ApiClient, id: string, body: CustomerUpdateBody): Promise<CustomerUpdateResponse> {
    return client.request<CustomerUpdateResponse>(
      'PUT',
      `/api/customers/${encodeURIComponent(id)}`,
      body,
    );
  },
  /**
   * GDPR Art.17 (Recht auf Löschung) — anonymize this customer IN PLACE + delete
   * their KYC images. ADMIN + step-up (a 403 STEP_UP_REQUIRED drives the PIN
   * dialog + retry). IRREVERSIBLE: PII is scrubbed everywhere; fiscal/GoBD/GwG
   * records are kept with PII redacted; `customer_number` survives as a pseudonym.
   */
  erase(client: ApiClient, id: string): Promise<{ ok: boolean; erasedAt: string }> {
    return client.request<{ ok: boolean; erasedAt: string }>(
      'POST',
      `/api/customers/${encodeURIComponent(id)}/erase`,
    );
  },
  stampKyc(
    client: ApiClient,
    id: string,
    body: CustomerKycStampBody,
  ): Promise<CustomerKycStampResponse> {
    return client.request<CustomerKycStampResponse>(
      'PATCH',
      `/api/customers/${encodeURIComponent(id)}/kyc`,
      body,
    );
  },
  addKycDocument(
    client: ApiClient,
    customerId: string,
    body: CustomerKycDocumentBody,
  ): Promise<CustomerKycDocumentResponse> {
    return client.request<CustomerKycDocumentResponse>(
      'POST',
      `/api/customers/${encodeURIComponent(customerId)}/kyc-documents`,
      body,
      // ID-image upload — its own generous window (see photosApi.uploadDirect).
      { timeoutMs: 60_000 },
    );
  },
  /**
   * Purge ALL live KYC ID documents of a customer (C4 — the owner can finally
   * delete / replace a saved Ausweis). Each row becomes a redacted GwG evidence
   * shell and its encrypted image file is unlinked. ADMIN + step-up; idempotent
   * (purgedCount 0 when nothing was live). To REPLACE: delete, then re-capture.
   */
  deleteKycDocuments(client: ApiClient, customerId: string): Promise<{ purgedCount: number }> {
    return client.request<{ purgedCount: number }>(
      'DELETE',
      `/api/customers/${encodeURIComponent(customerId)}/kyc-documents`,
    );
  },
  /**
   * Fetch the private KYC ID-document image bytes (WebP). The route is ADMIN +
   * step-up + `Cache-Control: no-store` and is NEVER public, so this goes
   * through the authenticated client (a 403 STEP_UP_REQUIRED triggers the
   * step-up middleware). The cashier/mobile render is a FOLLOW-UP and MUST show
   * the bytes WITHOUT persisting them (e.g. an in-memory data URI, then drop) —
   * inheriting the no-persist contract.
   */
  getKycDocumentImage(client: ApiClient, customerId: string, docId: string): Promise<ArrayBuffer> {
    return client.request<ArrayBuffer>(
      'GET',
      `/api/customers/${encodeURIComponent(customerId)}/kyc-documents/${encodeURIComponent(docId)}/image`,
      undefined,
      { responseType: 'arraybuffer' },
    );
  },
  setTrust(
    client: ApiClient,
    id: string,
    body: CustomerTrustChangeBody,
  ): Promise<CustomerTrustChangeResponse> {
    return client.request<CustomerTrustChangeResponse>(
      'PATCH',
      `/api/customers/${encodeURIComponent(id)}/trust`,
      body,
    );
  },
  checkSanctions(client: ApiClient, customerId: string): Promise<SanctionsCheckResult> {
    return client.request<SanctionsCheckResult>(
      'POST',
      `/api/customers/${encodeURIComponent(customerId)}/check-sanctions`,
    );
  },
};
