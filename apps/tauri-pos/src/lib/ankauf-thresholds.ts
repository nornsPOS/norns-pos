/**
 * Ankauf compliance + step-up thresholds.
 *
 * V1 hard-codes these as module constants. Phase 1.5 #I-41 promotes them to
 * `system_settings.gwg.*` rows so the Owner can change them without a
 * deploy. The constants are intentionally CLIENT-side AND will be re-checked
 * server-side — never trust the client to enforce compliance.
 *
 * Why this lives outside the backend env: the surface needs to render
 * "über €2,000 — KYC erforderlich" BEFORE the Bezahlen click. A constant
 * baked into the client bundle is fine for V1 because (a) the server
 * re-enforces, (b) the threshold rarely changes, (c) bundle rebuilds are
 * one-line deploys.
 */

/**
 * GwG § 10 identity-recording threshold. Above this total, the seller's
 * Personalausweis must be physically inspected and `customer.kyc_verified_at`
 * stamped. Legal floor is €2,000 for cash transactions (as of 2026).
 */
export const GWG_IDENTITY_THRESHOLD_EUR = '2000.00';

/**
 * Step-up threshold for ANKAUF transactions. Mirrors the env-driven
 * `TRANSACTION_STEP_UP_THRESHOLD_EUR` value the server uses (the server
 * is authoritative; this is the UX hint). Pull from window.__env at boot
 * once we wire it; today the server re-checks and the interceptor handles
 * the actual modal open.
 */
export const ANKAUF_STEP_UP_HINT_THRESHOLD_EUR = '500.00';
