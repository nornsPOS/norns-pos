/**
 * business_locations — the shop's own canonical address (migration 0027).
 *
 * Powers Local SEO JSON-LD, Google Business Profile binding, future
 * `/goldankauf/<city>` landing pages, multi-location growth.
 *
 * Updatable from the app role; no DELETE (soft-deactivate via
 * `active = FALSE` so historical receipt-footer references survive).
 *
 * Partial UNIQUE `business_locations_one_primary_uq WHERE is_primary AND
 * active` enforces exactly one primary location at a time.
 */

import { sql } from 'drizzle-orm';
import { boolean, char, check, index, jsonb, numeric, pgTable, text } from 'drizzle-orm/pg-core';

import { primaryKey, timestamps } from '../_shared/columns.js';

export const businessLocations = pgTable(
  'business_locations',
  {
    id: primaryKey(),
    name: text('name').notNull(),

    street: text('street').notNull(),
    postalCode: text('postal_code').notNull(),
    city: text('city').notNull(),
    region: text('region'),
    countryCode: char('country_code', { length: 2 }).notNull().default('DE'),

    lat: numeric('lat', { precision: 9, scale: 6 }),
    lng: numeric('lng', { precision: 9, scale: 6 }),

    phone: text('phone'),
    email: text('email'),

    googlePlaceId: text('google_place_id'),

    openingHours: jsonb('opening_hours').notNull().default(sql`'{}'::jsonb`),
    serviceAreaPostalCodes: text('service_area_postal_codes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    schemaOrgBusinessType: text('schema_org_business_type').notNull().default('JewelryStore'),

    isPrimary: boolean('is_primary').notNull().default(false),
    active: boolean('active').notNull().default(true),

    ...timestamps(),
  },
  (table) => ({
    activeIdx: index('business_locations_active_idx').on(table.active),
    cityIdx: index('business_locations_city_idx').on(table.city).where(sql`active = TRUE`),

    countryFormat: check(
      'business_locations_country_format',
      sql`${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    latRange: check(
      'business_locations_lat_range',
      sql`${table.lat} IS NULL OR (${table.lat} >= -90 AND ${table.lat} <= 90)`,
    ),
    lngRange: check(
      'business_locations_lng_range',
      sql`${table.lng} IS NULL OR (${table.lng} >= -180 AND ${table.lng} <= 180)`,
    ),
    latLngTogether: check(
      'business_locations_lat_lng_together',
      sql`(${table.lat} IS NULL AND ${table.lng} IS NULL) OR (${table.lat} IS NOT NULL AND ${table.lng} IS NOT NULL)`,
    ),
  }),
);

export type BusinessLocation = typeof businessLocations.$inferSelect;
export type NewBusinessLocation = typeof businessLocations.$inferInsert;
