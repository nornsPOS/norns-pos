/**
 * customers — Warehouse14 customer records with encrypted PII.
 *
 * Encrypted columns (BYTEA): full_name, date_of_birth, email, phone, address, notes.
 * These are written/read via the `encrypt_pii()` / `decrypt_pii()` SQL helpers
 * (migration 0007). Blind indexes (HMAC-SHA256 over normalized email/phone)
 * enable exact-match lookup without decryption.
 *
 * Discipline (Basel Day-5 directive):
 *   • NEVER deleted by the app role. GDPR via soft_deleted_at + anonymized_at.
 *   • date_of_birth_encrypted is IMMUTABLE after first capture (set once at KYC).
 *   • cumulative_spend_eur + cumulative_ankauf_eur are written ONLY by the
 *     trigger from migration 0009. App role has no UPDATE on them.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { timestamps } from '../_shared/columns.js';
import { users } from '../auth/users.js';
import { customerTrustLevel, kycStatus } from './enums.js';

/**
 * Locally-defined `bytea` custom type — encrypted PII columns surface as
 * `Uint8Array` in TS. The actual encryption / decryption happens via
 * `encrypt_pii()` / `decrypt_pii()` SQL functions wrapped by the
 * application layer (see packages/db/src/pii.ts).
 */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType() {
    return 'bytea';
  },
});

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shopId: uuid('shop_id'),

    customerNumber: text('customer_number')
      .notNull()
      .default(
        sql`'CUST-' || to_char(now() AT TIME ZONE 'Europe/Berlin', 'YYYY') || '-' || lpad(nextval('customer_number_seq')::text, 6, '0')`,
      ),

    // Encrypted PII
    fullNameEncrypted: bytea('full_name_encrypted').notNull(),
    dateOfBirthEncrypted: bytea('date_of_birth_encrypted'),
    emailEncrypted: bytea('email_encrypted'),
    phoneEncrypted: bytea('phone_encrypted'),
    addressEncrypted: bytea('address_encrypted'),
    notesEncrypted: bytea('notes_encrypted'),

    // Blind indexes
    emailBlindIndex: bytea('email_blind_index'),
    phoneBlindIndex: bytea('phone_blind_index'),

    // Non-PII metadata
    preferredLanguage: char('preferred_language', { length: 2 }).notNull().default('de'),
    vatId: text('vat_id'),
    customerTags: text('customer_tags').array().notNull().default(sql`'{}'::text[]`),

    // KYC state
    kycStatus: kycStatus('kyc_status').notNull().default('NOT_REQUIRED'),
    kycCompletedAt: timestamp('kyc_completed_at', { withTimezone: true }),
    kycExpiresAt: timestamp('kyc_expires_at', { withTimezone: true }),

    // Day-26 fields (migration 0024): operator-stamped trust + verification
    /**
     * Operator's business judgement. Default NEW. Promotion to VERIFIED/VIP
     * requires kyc_verified_at to be set; SUSPICIOUS/BANNED requires a
     * non-empty price_expectation_notes (≥ 8 chars).
     */
    trustLevel: customerTrustLevel('trust_level').notNull().default('NEW'),
    /** When the operator personally inspected the physical ID. */
    kycVerifiedAt: timestamp('kyc_verified_at', { withTimezone: true }),
    /** Which operator stamped the verification. */
    kycVerifiedByUserId: uuid('kyc_verified_by_user_id').references(() => users.id),
    /** Free-text notes about haggling or AML rationale. */
    priceExpectationNotes: text('price_expectation_notes'),

    // Sanctions screening (ADR-0018 §6)
    sanctionsScreenedAt: timestamp('sanctions_screened_at', { withTimezone: true }),
    sanctionsMatch: boolean('sanctions_match').notNull().default(false),
    pepMatch: boolean('pep_match').notNull().default(false),

    // Cumulative spend (trigger-maintained from migration 0009)
    cumulativeSpendEur: numeric('cumulative_spend_eur', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    cumulativeAnkaufEur: numeric('cumulative_ankauf_eur', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),
    /** Outstanding debt — trigger-maintained from migration 0016 (DEBT payments). */
    cumulativeDebtEur: numeric('cumulative_debt_eur', { precision: 18, scale: 2 })
      .notNull()
      .default('0'),

    // GDPR retention
    retentionUntil: date('retention_until').notNull(),
    softDeletedAt: timestamp('soft_deleted_at', { withTimezone: true }),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),

    ...timestamps(),
  },
  (table) => ({
    customerNumberUq: uniqueIndex('customers_customer_number_uq').on(table.customerNumber),

    emailBlindActiveUq: uniqueIndex('customers_email_blind_index_active_uq')
      .on(table.emailBlindIndex)
      .where(sql`${table.emailBlindIndex} IS NOT NULL AND ${table.softDeletedAt} IS NULL`),
    phoneBlindActiveUq: uniqueIndex('customers_phone_blind_index_active_uq')
      .on(table.phoneBlindIndex)
      .where(sql`${table.phoneBlindIndex} IS NOT NULL AND ${table.softDeletedAt} IS NULL`),

    kycExpiringIdx: index('customers_kyc_expiring_idx')
      .on(table.kycExpiresAt)
      .where(sql`${table.kycStatus} = 'VERIFIED' AND ${table.softDeletedAt} IS NULL`),

    // 0145 (19.08.2026): die Kundenliste schliesst mit ORDER BY created_at
    // DESC — ohne diesen Index sortierte sie die ganze Trefferliste, deren
    // Zeilen je einzeln durch decrypt_pii gelaufen sind. Hier deklariert,
    // damit ein Drizzle-Abgleich ihn nicht als Streichkandidaten meldet.
    createdAtIdx: index('customers_created_at_idx')
      .on(sql`${table.createdAt} DESC`)
      .where(sql`${table.softDeletedAt} IS NULL`),

    sanctionsFlagsIdx: index('customers_sanctions_flags_idx')
      .on(table.sanctionsMatch, table.pepMatch)
      .where(
        sql`(${table.sanctionsMatch} = TRUE OR ${table.pepMatch} = TRUE) AND ${table.softDeletedAt} IS NULL`,
      ),

    retentionIdx: index('customers_retention_idx')
      .on(table.retentionUntil)
      .where(sql`${table.softDeletedAt} IS NULL`),

    shopIdIdx: index('customers_shop_id_idx')
      .on(table.shopId)
      .where(sql`${table.shopId} IS NOT NULL`),

    preferredLanguageChk: check(
      'customers_preferred_language_chk',
      sql`${table.preferredLanguage} IN ('de', 'en', 'ar')`,
    ),
    anonymizedImpliesSoftDeleted: check(
      'customers_anonymized_implies_soft_deleted',
      sql`${table.anonymizedAt} IS NULL OR ${table.softDeletedAt} IS NOT NULL`,
    ),
    anonymizedAfterSoftDeleted: check(
      'customers_anonymized_after_soft_deleted',
      sql`${table.anonymizedAt} IS NULL OR ${table.anonymizedAt} >= ${table.softDeletedAt}`,
    ),
    verifiedHasKycDates: check(
      'customers_verified_has_kyc_dates',
      sql`${table.kycStatus} NOT IN ('VERIFIED','EXPIRED') OR (${table.kycCompletedAt} IS NOT NULL AND ${table.kycExpiresAt} IS NOT NULL)`,
    ),
    cumulativeSpendNonNegative: check(
      'customers_cumulative_spend_non_negative',
      sql`${table.cumulativeSpendEur} >= 0`,
    ),
    cumulativeAnkaufNonNegative: check(
      'customers_cumulative_ankauf_non_negative',
      sql`${table.cumulativeAnkaufEur} >= 0`,
    ),

    // Day-26 CHECKs (migration 0024)
    kycVerifiedEvidence: check(
      'customers_kyc_verified_evidence',
      sql`(${table.kycVerifiedAt} IS NULL) = (${table.kycVerifiedByUserId} IS NULL)`,
    ),
    verifiedTrustRequiresKyc: check(
      'customers_verified_trust_requires_kyc',
      sql`${table.trustLevel} NOT IN ('VERIFIED', 'VIP')
          OR ${table.kycVerifiedAt} IS NOT NULL`,
    ),
    bannedOrSuspiciousHasNote: check(
      'customers_banned_or_suspicious_has_note',
      sql`${table.trustLevel} NOT IN ('SUSPICIOUS', 'BANNED')
          OR (${table.priceExpectationNotes} IS NOT NULL
              AND length(${table.priceExpectationNotes}) >= 8)`,
    ),

    // Watch-list partial index (Day 26)
    trustActiveIdx: index('customers_trust_active_idx')
      .on(table.trustLevel, table.updatedAt.desc())
      .where(sql`${table.softDeletedAt} IS NULL
                 AND ${table.trustLevel} IN ('VIP', 'SUSPICIOUS', 'BANNED')`),
  }),
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
