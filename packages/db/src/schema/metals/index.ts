/**
 * metals/ — Edelmetall pricing engine (apps/worker + manual override).
 *
 *   metal_prices : append-only daily price history; exactly one CURRENT row
 *                  per metal via partial UNIQUE on (metal) WHERE valid_to IS NULL.
 *
 * Landed in migration 0021. See memory.md decision #69.
 */

export * from './enums.js';
export * from './metalPrices.js';
