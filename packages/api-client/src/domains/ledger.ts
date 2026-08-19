/**
 * Ledger domain types.
 *
 * Mirrors `apps/api-cloud/src/routes/sse-ledger.ts` — the SSE wire
 * shape. The route itself emits text/event-stream, not JSON, so there is
 * no fetch method here — the front-end opens an EventSource directly.
 * These types are the parsed `data:` JSON payload.
 *
 * The exhaustive `LedgerEventType` union mirrors `ledger_events.event_type`
 * literals emitted by triggers + Phase 1 code paths. Keep this list in
 * sync — a backend PR that introduces a new event type adds the literal
 * here in the same diff (Phase 1.5 CI guard candidate, #I-30).
 */

export type LedgerEventType =
  // Transactions
  | 'transaction.finalized'
  | 'transaction.stornoed'
  | 'transaction.returned'
  // Inventory
  | 'product.reserved'
  | 'product.released'
  | 'product.sold'
  | 'product.archived'
  // Shifts / cash
  | 'shift.opened'
  | 'shift.closed_with_variance'
  | 'cash.movement_recorded'
  // Customers
  | 'customer.kyc_verified'
  | 'customer.trust_changed'
  // Appraisals
  | 'appraisal.accepted'
  | 'appraisal.rejected'
  // Metal prices / belegtexts (Day 23/26)
  | 'metal_price.recorded'
  | 'metal_price.manual_override'
  | 'belegtext.published'
  // Inventory annual session
  | 'inventory.session_opened'
  | 'inventory.session_closed_with_shrinkage'
  // ── ALERTS (the 7+ critical events from memory.md #45 + Day 24) ──
  | 'alert.suspicious_aml_flagged'
  | 'alert.worker_job_dead_letter'
  | 'alert.hash_chain_verification_failed'
  | 'alert.anomaly_detected'
  | 'alert.ebay_sale_conflict'
  | 'alert.ebay_double_sale_attempt'
  | 'alert.customer_marked_suspicious'
  | 'alert.customer_banned'
  // TSE/KassenSichV criticals — ALREADY emitted by the worker (tse-cert-checker
  // / tse-archive-exporter); declared here for type-safety, NOT new alert types.
  | 'alert.tse_cert_expiry'
  | 'alert.tse_critical_failure';

export interface LedgerEvent {
  /** bigserial as a JS number (route normalizes via Number(bigint)). */
  id: number;
  event_type: LedgerEventType | string; // future-proof: accept unknown strings too
  entity_table: string;
  entity_id: string;
  actor_user_id: string | null;
  device_id: string | null;
  payload: Record<string, unknown> | unknown;
  /** ISO-8601 timestamp. */
  created_at: string;
}

/**
 * Predicate — `true` when the event is one of the alert.* class. The Werkstatt
 * uses this to render with wax-red accent and bump the badge counter.
 */
export function isAlertEvent(e: Pick<LedgerEvent, 'event_type'>): boolean {
  return typeof e.event_type === 'string' && e.event_type.startsWith('alert.');
}

/**
 * Predicate — `true` when the event class invalidates the dashboard summary
 * aggregator. The SSE hook debounces invalidations across many of these.
 *
 * Kept conservative: the summary is cheap to recompute, but we still want to
 * skip clearly-orthogonal events (e.g. `customer.kyc_verified` does not move
 * any tile on the dashboard).
 */
const DASHBOARD_INVALIDATING_EVENTS: readonly string[] = [
  'transaction.finalized',
  'transaction.stornoed',
  'transaction.returned',
  'product.reserved',
  'product.released',
  'product.sold',
  'shift.opened',
  'shift.closed_with_variance',
  'cash.movement_recorded',
  'metal_price.recorded',
  'metal_price.manual_override',
  'appraisal.accepted',
  'appraisal.rejected',
  'alert.ebay_sale_conflict',
  'alert.worker_job_dead_letter',
];

export function shouldInvalidateDashboard(e: Pick<LedgerEvent, 'event_type'>): boolean {
  return DASHBOARD_INVALIDATING_EVENTS.includes(String(e.event_type));
}

/**
 * Parse the `data:` field of an SSE message into a typed LedgerEvent.
 * Returns null on malformed JSON (we tolerate the heartbeat comment).
 */
export function parseLedgerEvent(jsonText: string): LedgerEvent | null {
  try {
    const obj = JSON.parse(jsonText) as Partial<LedgerEvent>;
    if (
      typeof obj.id !== 'number' ||
      typeof obj.event_type !== 'string' ||
      typeof obj.entity_table !== 'string' ||
      typeof obj.entity_id !== 'string' ||
      typeof obj.created_at !== 'string'
    ) {
      return null;
    }
    return {
      id: obj.id,
      event_type: obj.event_type,
      entity_table: obj.entity_table,
      entity_id: obj.entity_id,
      actor_user_id: obj.actor_user_id ?? null,
      device_id: obj.device_id ?? null,
      payload: obj.payload ?? {},
      created_at: obj.created_at,
    };
  } catch {
    return null;
  }
}
