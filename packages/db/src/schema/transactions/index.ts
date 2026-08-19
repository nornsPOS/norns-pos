/**
 * transactions/ — fiscal transactions + items + payments.
 *
 * The "Great Connection" wires:
 *   • products RESERVED → SOLD (via @norns/inventory-lock.finalize)
 *   • customers cumulative spend (DB trigger from migration 0009)
 *   • ledger_events chain extension (DB trigger from migration 0009 → 0008)
 *
 * Storno via negative-amount row referencing the original. See ADR-0016 §1.
 */

export * from './enums.js';
export * from './transactions.js';
export * from './transactionItems.js';
export * from './transactionPayments.js';
