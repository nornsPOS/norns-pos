/**
 * Drizzle schema barrel.
 *
 * Modules added incrementally per ADR-0008 §8.
 *
 * Status:
 *   ✓ auth/         — migration 0004
 *   ✓ reference/    — migration 0005
 *   ✓ products/     — migration 0006 (+ 0015 Day-16 columns)
 *   ✓ customers/    — migration 0007 (+ 0016 cumulative_debt_eur)
 *   ✓ audit/        — migration 0008
 *   ✓ transactions/ — migration 0009 (Great Connection) + 0013/0016 constraint triggers
 *   ✓ tse/          — migration 0010 (Fiskaly SIGN DE V2 state machine)
 *   ✓ closing/      — migration 0011 (daily Z-report + DSFinV-K exports + system_settings)
 *   ✓ appointments/ — migration 0012 (Smart Appointment System + soft-holds + available_slots)
 *   ✓ worker/       — migration 0017 (apps/worker: worker_job_runs + DLQ)
 *   ✓ storefront/   — migration 0018 (B2C carts + payment_intents + webhook_events)
 *   ✓ shifts/       — migration 0019 (Day 21 retail core)
 *   ✓ vouchers/     — migration 0019
 *   ✓ inventory/    — migration 0019 (counting sessions + scans)
 *   (whatsapp/ und intake/ — Webshop-Kanalerbe — sind am 19.08.2026 mit
 *    Wanderung 0149 ausgezogen; siehe docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md)
 *   ✓ appraisals/   — migration 0020 (Day 22 Bewertungs-Modul)
 *   ✓ metals/       — migration 0021 (Day 23 Edelmetall-Kursmodul)
 *   ✓ products/     — Day 24 additions: photo workflow + eBay state machine
 *                     + product_photo_workflow_events + product_ebay_listing_events
 *                     (migration 0022)
 *   ✓ tasks/        — migration 0023 (Day 25 single-operator day-list)
 *   ✓ documents/    — migration 0023 (Day 25 R2-backed attachments,
 *                     6 German categories)
 *   ✓ customers/    — Day 26 extensions: trust_level + KYC verification +
 *                     price_expectation_notes (migration 0024)
 *   ✓ belegtext/    — migration 0024 (Day 26 receipt-text templates +
 *                     resolve_belegtext_for_tax_treatment helper)
 *
 *   ═══════════════════════════════════════════════════════════════════
 *   ★ PHASE 1 BACKEND FROZEN at migration 0024 (Day 26, 2026-05-26) ★
 *   ═══════════════════════════════════════════════════════════════════
 *   No new domain schemas land before Phase 1.5. Future additions go
 *   into migrations 0025+ — see memory.md decision #72.
 */

export * from './auth/index.js';
export * from './reference/index.js';
export * from './products/index.js';
export * from './customers/index.js';
export * from './audit/index.js';
export * from './transactions/index.js';
export * from './tse/index.js';
export * from './closing/index.js';
export * from './appointments/index.js';
export * from './worker/index.js';
export * from './storefront/index.js';
export * from './shifts/index.js';
export * from './vouchers/index.js';
export * from './inventory/index.js';
export * from './appraisals/index.js';
export * from './metals/index.js';
export * from './tasks/index.js';
export * from './documents/index.js';
export * from './belegtext/index.js';
// ─── Day 13 / Phase 2.B kick-off — commerce taxonomy + locations ────────
export * from './categories/index.js';
export * from './locations/index.js';
// ─── Owner OS — finance backend (migration 0075) ────────────────────────
export * from './finance/index.js';
// ─── Stripe Terminal — servergesteuerte Kartenleser (Wanderung 0121) ────
export * from './terminal/index.js';
