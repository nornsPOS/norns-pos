/**
 * Custom column types not in drizzle-orm's stock pg-core.
 *
 * Each helper preserves the column's native semantics on the wire (so e.g.
 * citext comparisons are case-insensitive at the DB level) while presenting
 * a familiar TypeScript surface (string for citext, etc.).
 *
 * These are the ONLY non-built-in column types we use. Resist adding more
 * unless a new extension genuinely requires it (e.g. vector for ADR-0016 §6.bis
 * will get its helper here when migration 0006_products lands).
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * citext — case-insensitive text. Backed by the `citext` extension
 * (enabled in migration 0001_extensions.sql).
 *
 * Use for any user-facing identifier where casing should not matter:
 *   • users.email
 *   • lookup keys typed by humans
 *
 * Comparisons (=, IN, indexed lookups) ignore case; storage preserves the
 * original casing for display.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});

// 19.08.2026: hier stand der Spaltentyp fuer Aehnlichkeitsvektoren
// (Webshop-Erbe). Sein letzter Traeger (products.embedding) ist mit
// Wanderung 0149 ausgezogen; der Typ ging mit.
