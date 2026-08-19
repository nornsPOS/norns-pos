/**
 * shoppers — B2C online accounts (Day 19, migration 0018).
 *
 * 1:1 with `customers` (the KYC + spend row). The shopper row carries the
 * online credentials, addresses, lockout state. Walk-in customers don't have
 * a shopper row.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { customers } from '../customers/customers.js';

/** PG bytea ↔ Buffer — mirrored from customers/_shared. */
export const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return 'bytea';
  },
});

export const shoppers = pgTable(
  'shoppers',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    customerId: uuid('customer_id')
      .notNull()
      .unique()
      .references(() => customers.id),

    emailEncrypted: bytea('email_encrypted').notNull(),
    emailBlindIndex: bytea('email_blind_index').notNull(),
    /** Nullable since 0066 — a Google-linked account has no password. */
    passwordHash: text('password_hash'),
    /** Google's stable subject id (`sub`); NULL for password-only accounts. */
    googleSub: text('google_sub'),
    /**
     * Guest shopper (0085): minted lazily on the first cart action, synthetic
     * email, NO credential. Upgraded in place on email sign-up (cart
     * survives); real contact lands on the customers row at reservation.
     */
    isGuest: boolean('is_guest').notNull().default(false),

    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    emailVerificationToken: text('email_verification_token'),

    phoneEncrypted: bytea('phone_encrypted'),
    phoneBlindIndex: bytea('phone_blind_index'),

    shippingRecipientNameEncrypted: bytea('shipping_recipient_name_encrypted'),
    shippingAddressLine1Encrypted: bytea('shipping_address_line1_encrypted'),
    shippingAddressLine2Encrypted: bytea('shipping_address_line2_encrypted'),
    shippingPostalCodeEncrypted: bytea('shipping_postal_code_encrypted'),
    shippingCityEncrypted: bytea('shipping_city_encrypted'),
    shippingCountry: char('shipping_country', { length: 2 }),

    billingRecipientNameEncrypted: bytea('billing_recipient_name_encrypted'),
    billingAddressLine1Encrypted: bytea('billing_address_line1_encrypted'),
    billingAddressLine2Encrypted: bytea('billing_address_line2_encrypted'),
    billingPostalCodeEncrypted: bytea('billing_postal_code_encrypted'),
    billingCityEncrypted: bytea('billing_city_encrypted'),
    billingCountry: char('billing_country', { length: 2 }),

    preferredLanguage: char('preferred_language', { length: 2 }).notNull().default('de'),
    marketingConsent: boolean('marketing_consent').notNull().default(false),
    marketingConsentAt: timestamp('marketing_consent_at', { withTimezone: true }),

    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    softDeletedAt: timestamp('soft_deleted_at', { withTimezone: true }),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    emailBlindActiveUq: uniqueIndex('shoppers_email_blind_active_uq')
      .on(table.emailBlindIndex)
      .where(sql`${table.softDeletedAt} IS NULL`),
    googleSubActiveUq: uniqueIndex('shoppers_google_sub_active_uq')
      .on(table.googleSub)
      .where(sql`${table.googleSub} IS NOT NULL AND ${table.softDeletedAt} IS NULL`),
    customerIdx: index('shoppers_customer_idx').on(table.customerId),
    lockedIdx: index('shoppers_locked_idx')
      .on(table.lockedUntil)
      .where(sql`${table.lockedUntil} IS NOT NULL`),

    shippingCountryIso2: check(
      'shoppers_country_iso2_shipping',
      sql`${table.shippingCountry} IS NULL OR ${table.shippingCountry} ~ '^[A-Z]{2}$'`,
    ),
    billingCountryIso2: check(
      'shoppers_country_iso2_billing',
      sql`${table.billingCountry} IS NULL OR ${table.billingCountry} ~ '^[A-Z]{2}$'`,
    ),
    anonymizedImpliesSoftDeleted: check(
      'shoppers_anonymized_implies_soft_deleted',
      sql`${table.anonymizedAt} IS NULL OR ${table.softDeletedAt} IS NOT NULL`,
    ),
    marketingConsentTimestamp: check(
      'shoppers_marketing_consent_has_timestamp',
      sql`${table.marketingConsent} = FALSE OR ${table.marketingConsentAt} IS NOT NULL`,
    ),
    languageDomain: check(
      'shoppers_language_domain',
      sql`${table.preferredLanguage} IN ('de', 'en', 'ar')`,
    ),
    failedAttemptsNonNeg: check(
      'shoppers_failed_attempts_nonneg',
      sql`${table.failedLoginAttempts} >= 0`,
    ),
    hasCredential: check(
      'shoppers_has_credential',
      sql`${table.passwordHash} IS NOT NULL OR ${table.googleSub} IS NOT NULL OR ${table.isGuest}`,
    ),
    guestCreatedIdx: index('shoppers_guest_created_idx')
      .on(table.createdAt)
      .where(sql`${table.isGuest}`),
  }),
);

export type Shopper = typeof shoppers.$inferSelect;
export type NewShopper = typeof shoppers.$inferInsert;
