/**
 * kyc_documents — ID-document evidence for GwG / §259 StGB defense.
 *
 * Each row is a piece of *legal evidence* that we did good-faith due diligence
 * before an Ankauf. The encrypted document number + the SHA-256-hashed photo
 * (an AES-256-GCM-encrypted local file referenced by document_photo_storage_key;
 * migration 0074 moved it off the never-configured R2) together prove "this
 * customer presented this ID at this terminal at this time, captured by this
 * user."
 *
 * Discipline:
 *   • NEVER deleted by app role.
 *   • App can only UPDATE the verification chain + retention.
 *   • The document itself (number, photo, type, validity range) is INSERT-once.
 */

import { sql } from 'drizzle-orm';
import {
  char,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';
import { devices } from '../auth/devices.js';
import { users } from '../auth/users.js';
import { customers } from './customers.js';
import { idDocumentType } from './enums.js';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const kycDocuments = pgTable(
  'kyc_documents',
  {
    id: primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),

    documentType: idDocumentType('document_type').notNull(),
    issuingCountryIso2: char('issuing_country_iso2', { length: 2 }).notNull(),
    issuingAuthority: text('issuing_authority'),

    // Nullable since migration 0041 — NULLed when the document is purged
    // (GDPR #I-5). The purge-consistency CHECK keeps these in lock-step with
    // `purged_at` / `purged_by_user_id`.
    documentNumberEncrypted: bytea('document_number_encrypted'),

    issuedOn: date('issued_on'),
    expiresOn: date('expires_on').notNull(),

    // Storage key for the LOCAL AES-256-GCM-encrypted image file under
    // KYC_PHOTOS_DIR (migration 0074; was document_photo_r2_key). NEVER public —
    // served only via the ADMIN + step-up view route. Nulled on purge.
    documentPhotoStorageKey: text('document_photo_storage_key'),
    // sha256 of the COMPRESSED plaintext image (server-computed). Integrity
    // record verified on decrypt. NOT NULL octet_length=32 CHECK below.
    documentPhotoSha256: bytea('document_photo_sha256'),
    // Encrypted-file byte size for the separate KYC store cap. Not PII, not in
    // the all-or-nothing CHECK; nulled on purge so the SUM stays accurate.
    documentPhotoSizeBytes: integer('document_photo_size_bytes'),

    capturedByUserId: uuid('captured_by_user_id')
      .notNull()
      .references(() => users.id),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    capturedAtTerminalId: uuid('captured_at_terminal_id').references(() => devices.id),

    // 19.08.2026 (Wanderung 0149): hier lagen zwei Spalten fuer eine
    // automatische Bilderkennung, die nie gebaut wurde — die Ausweisdaten
    // liest der Rumpf lokal aus der MRZ. Ausgezogen.

    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: uuid('verified_by_user_id').references(() => users.id),

    retentionUntil: date('retention_until').notNull(),

    // GDPR #I-5 purge evidence. Set together when a row becomes a shell.
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    purgedByUserId: uuid('purged_by_user_id').references(() => users.id),

    ...timestamps(),
  },
  (table) => ({
    customerIdIdx: index('kyc_documents_customer_id_idx').on(table.customerId),
    expiresOnIdx: index('kyc_documents_expires_on_idx').on(table.expiresOn),
    retentionIdx: index('kyc_documents_retention_idx').on(table.retentionUntil),
    unverifiedIdx: index('kyc_documents_unverified_idx')
      .on(table.createdAt.desc())
      .where(sql`${table.verifiedAt} IS NULL`),

    issuingCountryFormat: check(
      'kyc_documents_issuing_country_format',
      sql`${table.issuingCountryIso2} ~ '^[A-Z]{2}$'`,
    ),
    validityRange: check(
      'kyc_documents_validity_range',
      sql`${table.issuedOn} IS NULL OR ${table.expiresOn} > ${table.issuedOn}`,
    ),
    sha256Length: check(
      'kyc_documents_sha256_length',
      sql`octet_length(${table.documentPhotoSha256}) = 32`,
    ),
    verifiedHasVerifier: check(
      'kyc_documents_verified_has_verifier',
      sql`(${table.verifiedAt} IS NULL) = (${table.verifiedByUserId} IS NULL)`,
    ),
    // GDPR #I-5 — a row is either LIVE (PII present, not purged) or a purged
    // SHELL (PII nulled, purge stamped). No in-between state is valid.
    purgedConsistency: check(
      'kyc_documents_purged_consistency',
      sql`(
        ${table.purgedAt} IS NULL
          AND ${table.documentNumberEncrypted} IS NOT NULL
          AND ${table.documentPhotoSha256} IS NOT NULL
          AND ${table.documentPhotoStorageKey} IS NOT NULL
          AND ${table.purgedByUserId} IS NULL
      ) OR (
        ${table.purgedAt} IS NOT NULL
          AND ${table.documentNumberEncrypted} IS NULL
          AND ${table.documentPhotoSha256} IS NULL
          AND ${table.documentPhotoStorageKey} IS NULL
          AND ${table.purgedByUserId} IS NOT NULL
      )`,
    ),
  }),
);

export type KycDocument = typeof kycDocuments.$inferSelect;
export type NewKycDocument = typeof kycDocuments.$inferInsert;
