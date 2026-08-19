/**
 * Native PG enums for the customers/KYC schema.
 *
 * Created in migration 0007_customers_kyc.sql. The pgEnum declarations here
 * mirror the existing types — drizzle-kit does not re-create them.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const kycStatus = pgEnum('kyc_status', [
  'NOT_REQUIRED',
  'PENDING',
  'CAPTURED',
  'VERIFIED',
  'EXPIRED',
  'REJECTED',
]);

export const idDocumentType = pgEnum('id_document_type', [
  'PERSONALAUSWEIS',
  'REISEPASS',
  'EU_NATIONAL_ID',
  'AUFENTHALTSTITEL',
  'PASSPORT_NON_EU',
]);

/**
 * customer_trust_level — operator business judgement (migration 0024, Day 26).
 *
 * Distinct from kyc_status (legal document state). Promotion to VERIFIED/VIP
 * requires a physical ID check (kyc_verified_at set). SUSPICIOUS or BANNED
 * requires a non-empty price_expectation_notes (≥ 8 chars).
 */
export const customerTrustLevel = pgEnum('customer_trust_level', [
  'NEW',
  'VERIFIED',
  'VIP',
  'SUSPICIOUS',
  'BANNED',
]);
