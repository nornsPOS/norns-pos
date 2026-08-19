/**
 * ankauf-kyc-gate — the pure, DIRECTION-AWARE GwG KYC-gate decision (Roman
 * Grützner go-live sign-off, binding):
 *   • ANKAUF  — ID required for EVERY buy from €0,01 (hard §259 StGB Hehlerei).
 *   • VERKAUF — ID required when the sale total ≥ €2.000 (§10 GwG); below it,
 *     anonymous sale allowed.
 *
 * UI-SURFACING ONLY. The server BEFORE INSERT trigger (transactions_validate_kyc)
 * is the authoritative, un-bypassable gate; this shares the same rule so the
 * Ankauf banner + the Verkauf BezahlenDialog can never drift from the server, and
 * the logic is unit-testable without a DOM. The §10 aggregate context (memory
 * #101) is preserved for the Ankauf linked-transaction banner.
 */

import { GWG_IDENTITY_THRESHOLD_EUR } from './ankauf-thresholds.js';
import { toCents } from './intake-math.js';

export interface KycGateCustomer {
  /** ISO timestamp KYC was stamped, or null if never verified. */
  kycVerifiedAt: string | null;
  /**
   * §15 GwG — the customer is a politically exposed person. This is NOT a block:
   * the buy may proceed under verstärkte Sorgfaltspflichten (enhanced due
   * diligence), which the operator must consciously acknowledge. Absent on
   * callers that have only a list row; treated as false.
   */
  pepMatch?: boolean;
}

/**
 * §10 GwG aggregation context for the selected customer: the sum of their PRIOR
 * in-window ANKAUF buys (excluding the current cart), as the server computed it
 * over the configured rolling window. Supplied by `GET /api/customers/:id`.
 */
export interface KycGateAggregate {
  /** Σ of the customer's prior in-window ANKAUF buys, in cents. */
  priorWindowAnkaufCents: bigint;
  /** Rolling window length (days) — for the banner copy. */
  windowDays: number;
}

export type KycGateDirection = 'ANKAUF' | 'VERKAUF';

export interface KycGateParams {
  /** ANKAUF → always; VERKAUF → ≥ €2.000. */
  direction: KycGateDirection;
  totalCents: bigint;
  customer: KycGateCustomer | null;
  /** §10 windowed aggregate (Ankauf linked-transaction banner). */
  aggregate?: KycGateAggregate;
}

export interface KycGateDecision {
  /**
   * This transaction ALONE triggers its direction's identity rule:
   *   ANKAUF → any buy from €0,01; VERKAUF → total ≥ €2.000.
   */
  thresholdReached: boolean;
  /**
   * §10 aggregation: the customer's rolling-window ANKAUF sum (prior + current)
   * reaches the threshold — even when the current buy alone is under it. This is
   * the linked-transaction rule that smurfing exploits.
   */
  aggregateReached: boolean;
  /** prior-window + current, in cents (current clamped at ≥0). */
  aggregateCents: bigint;
  /** The selected customer already carries a KYC stamp. */
  kycVerified: boolean;
  /**
   * KYC must be stamped before payout: EITHER the single-tx threshold OR the §10
   * aggregate is reached, a customer is selected, and they are not yet verified.
   * (False when no customer is selected — there is nothing to stamp yet.)
   */
  required: boolean;
  /** Which rule made it required, for the banner wording. Null when not required. */
  reason: 'single' | 'aggregate' | null;
  /**
   * §15 GwG: a politically exposed person is selected, so the payout demands
   * verstärkte Sorgfaltspflichten. Unlike a sanctions hit this does not forbid
   * the buy; the UI must make the operator acknowledge it before paying out.
   * False when no customer is selected.
   */
  enhancedDueDiligence: boolean;
}

/** GwG threshold in integer cents, computed once. */
const GWG_THRESHOLD_CENTS = toCents(GWG_IDENTITY_THRESHOLD_EUR);

export function evaluateKycGate(params: KycGateParams): KycGateDecision {
  const { direction, totalCents, customer, aggregate } = params;

  const current = totalCents > 0n ? totalCents : 0n;
  // Direction-aware single-tx identity rule:
  //   ANKAUF  → ANY buy from €0,01 (hard §259 StGB — no threshold).
  //   VERKAUF → total ≥ €2.000 (§10 GwG).
  const thresholdReached = direction === 'ANKAUF' ? current > 0n : current >= GWG_THRESHOLD_CENTS;

  const aggregateCents = (aggregate?.priorWindowAnkaufCents ?? 0n) + current;
  // Only assert the §10 linked-transaction rule when the server supplied a window
  // aggregate (Ankauf banner). For Ankauf the single rule already always trips.
  const aggregateReached = aggregate != null && aggregateCents >= GWG_THRESHOLD_CENTS;

  const kycVerified = customer != null && customer.kycVerifiedAt != null;
  const trips = thresholdReached || aggregateReached;
  const required = trips && customer != null && !kycVerified;
  const reason = !required ? null : thresholdReached ? 'single' : 'aggregate';

  // §15 GwG stands on its own: it applies to a PEP at any amount, whether or not
  // the §10 identity threshold trips and whether or not KYC is already stamped.
  const enhancedDueDiligence = customer != null && customer.pepMatch === true;

  return {
    thresholdReached,
    aggregateReached,
    aggregateCents,
    kycVerified,
    required,
    reason,
    enhancedDueDiligence,
  };
}
