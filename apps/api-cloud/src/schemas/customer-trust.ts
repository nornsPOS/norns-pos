/**
 * TypeBox schemas for customer KYC verification + trust routes (Day 26).
 */

import { type Static, Type } from '@sinclair/typebox';

const TRUST_LEVEL = Type.Union([
  Type.Literal('NEW'),
  Type.Literal('VERIFIED'),
  Type.Literal('VIP'),
  Type.Literal('SUSPICIOUS'),
  Type.Literal('BANNED'),
]);

export const CustomerIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/customers/:id/kyc
//
// Owner stamps the physical-ID verification. Optionally promotes
// trust_level to VERIFIED (or higher).
// ────────────────────────────────────────────────────────────────────────

export const KycStampBody = Type.Object({
  /** Document type physically inspected. Audit-relevant. */
  documentType: Type.Union([
    Type.Literal('PERSONALAUSWEIS'),
    Type.Literal('REISEPASS'),
    Type.Literal('EU_NATIONAL_ID'),
    Type.Literal('AUFENTHALTSTITEL'),
    Type.Literal('PASSPORT_NON_EU'),
  ]),
  /**
   * Optional promotion. Defaults to leaving trust_level alone — Owner may
   * choose to stamp KYC without promoting (e.g. customer's relationship is
   * still being assessed).
   */
  promoteTrustLevelTo: Type.Optional(Type.Union([Type.Literal('VERIFIED'), Type.Literal('VIP')])),
  /** Free-text note saved as audit_log payload context. */
  notes: Type.Optional(Type.String({ maxLength: 1000 })),
});

export const KycStampResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  trustLevel: TRUST_LEVEL,
  kycVerifiedAt: Type.String({ format: 'date-time' }),
  kycVerifiedByUserId: Type.String({ format: 'uuid' }),
});

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/customers/:id/trust
//
// Set trust_level directly. SUSPICIOUS / BANNED require a reason.
// VERIFIED / VIP require a prior KYC stamp (enforced by DB CHECK; we
// surface a clean 409 here so the operator sees what's missing).
// ────────────────────────────────────────────────────────────────────────

export const SetTrustBody = Type.Object({
  trustLevel: TRUST_LEVEL,
  /** Required when trust_level IN ('SUSPICIOUS', 'BANNED') — ≥ 8 chars. */
  reason: Type.Optional(Type.String({ minLength: 8, maxLength: 2000 })),
});

export const SetTrustResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  trustLevel: TRUST_LEVEL,
  priceExpectationNotes: Type.Union([Type.String(), Type.Null()]),
});

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/customers/:id/price-expectation-notes
// ────────────────────────────────────────────────────────────────────────

export const PriceNotesBody = Type.Object({
  notes: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
});

export type TCustomerIdParams = Static<typeof CustomerIdParams>;
export type TKycStampBody = Static<typeof KycStampBody>;
export type TSetTrustBody = Static<typeof SetTrustBody>;
export type TPriceNotesBody = Static<typeof PriceNotesBody>;
