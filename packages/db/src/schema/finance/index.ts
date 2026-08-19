/**
 * finance/ — Owner OS finance backend (migration 0075).
 *
 *   • fixed_costs        — recurring monthly Fixkosten
 *   • operating_expenses — one-off Betriebsausgaben booked per business day
 *
 * The profit / revenue / inventory-value / metal-weight READ endpoints compute
 * directly from `transactions` + `products` (no new table) — see
 * apps/api-cloud/src/routes/finance.ts.
 */

export * from './enums.js';
export * from './fixedCosts.js';
export * from './operatingExpenses.js';
