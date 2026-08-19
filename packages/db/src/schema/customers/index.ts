/**
 * customers/ — customer records + KYC document evidence.
 *
 * Discipline (Basel Day-5):
 *   • PII columns encrypted with pgp_sym_encrypt via the encrypt_pii() helper.
 *   • Search via HMAC-SHA256 blind indexes — no decryption needed for lookup.
 *   • App role NEVER deletes. GDPR via soft_deleted_at + anonymized_at.
 *
 * See migration 0007_customers_kyc.sql + packages/db/src/pii.ts.
 */

export * from './enums.js';
export * from './customers.js';
export * from './kycDocuments.js';
