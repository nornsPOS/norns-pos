/**
 * carts — der Reservierungskorb der Kasse (Day 19).
 *
 * ⚰️ 22.08.2026: hiess „carts + cart_items". Die Stuecktabelle ist mit
 * Wanderung 0153 ausgezogen; `carts` selbst traegt den Abholweg und bleibt.
 *
 * State machine: ACTIVE → CHECKOUT (15-min window) → CONVERTED (payment ok)
 *                                                    or ABANDONED (sweeper)
 */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { transactions } from '../transactions/transactions.js';
import { cartStatus } from './enums.js';
import { shoppers } from './shoppers.js';

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    shopperId: uuid('shopper_id')
      .notNull()
      .references(() => shoppers.id),
    status: cartStatus('status').notNull().default('ACTIVE'),
    reservationSessionId: uuid('reservation_session_id').unique(),
    checkoutStartedAt: timestamp('checkout_started_at', { withTimezone: true }),
    checkoutExpiresAt: timestamp('checkout_expires_at', { withTimezone: true }),
    /** When a reserve-and-pickup request was submitted (cart status RESERVED). */
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    /**
     * The number a human can say out loud: `BST-2026-000001` (0097). NULL
     * while the row is still a shopping basket — a trigger mints it the moment
     * `reserved_at` is set, so numbers are never burned on baskets that are
     * abandoned. Never write this from application code.
     */
    orderNumber: text('order_number'),
    convertedToTransactionId: uuid('converted_to_transaction_id')
      .unique()
      .references(() => transactions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    oneActivePerShopperUq: uniqueIndex('carts_one_active_per_shopper_uq')
      .on(table.shopperId)
      .where(sql`${table.status} = 'ACTIVE'`),
    checkoutExpiresIdx: index('carts_checkout_expires_idx')
      .on(table.checkoutExpiresAt)
      .where(sql`${table.status} = 'CHECKOUT'`),
    checkoutEvidence: check(
      'carts_checkout_evidence',
      sql`${table.status} <> 'CHECKOUT' OR (
        ${table.reservationSessionId} IS NOT NULL AND
        ${table.checkoutStartedAt}    IS NOT NULL AND
        ${table.checkoutExpiresAt}    IS NOT NULL AND
        ${table.checkoutExpiresAt}    > ${table.checkoutStartedAt}
      )`,
    ),
    convertedHasTransaction: check(
      'carts_converted_has_transaction',
      sql`${table.status} <> 'CONVERTED' OR ${table.convertedToTransactionId} IS NOT NULL`,
    ),
  }),
);

/*
 * ⚰️ 22.08.2026 (Wanderung 0153): hier stand `cartItems`, der Warenkorb des
 * Webshops. Gemessen ueber `apps/api-cloud/src`, `apps/tauri-pos/src` und
 * alle Pakete: NULL Aufrufer. Basels Anweisung: „اقتلعها وتخلص منها … نبي
 * قاعدة بيانات نظيفة وخفيفة تركز 100% على الكاشير بس".
 *
 * ⚠️ `carts` daneben bleibt und ist LEBENDIG — der Reservierungsweg der
 * Kasse haengt daran (`transactions-finalize.ts`, `products-detail.ts`,
 * `autoReleaseExpired.ts`). Wer hier „Webshop" liest und beide mitnimmt,
 * reisst die Abholung heraus.
 */

export type Cart = typeof carts.$inferSelect;
export type NewCart = typeof carts.$inferInsert;
