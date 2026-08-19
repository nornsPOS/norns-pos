/**
 * Native PG enums for the transactions schema.
 *
 * Created in migration 0009_transactions.sql.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const transactionDirection = pgEnum('transaction_direction', ['VERKAUF', 'ANKAUF']);

export const paymentMethod = pgEnum('payment_method', [
  'CASH',
  'ZVT_CARD',
  'SUMUP',
  'MOLLIE',
  'STRIPE',
  'EBAY',
  'BANK_TRANSFER',
  'VOUCHER',
  // ── Day 17 (migration 0016): debt payment ─────────────────────────
  'DEBT',
  // ── Day 21 (migration 0019): trade-in / Inzahlungnahme ────────────
  'TRADE_IN',
  // ── 26.07.2026 (migration 0120): Stripe Terminal am Ladentisch. ───
  // Eigener Wert, weil ZVT_CARD daneben bestehen bleibt und STRIPE dem
  // Web-Shop gehoert — ein geteilter Wert waere in jedem Export
  // ununterscheidbar.
  'STRIPE_TERMINAL',
]);
