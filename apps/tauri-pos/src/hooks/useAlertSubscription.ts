/**
 * useAlertSubscription — bridge from the SSE ledger feed to the toast queue.
 *
 * Mounted INSIDE the authenticated AppShell. Watches for new `alert.*`
 * events in the ledger-feed-store and dispatches them as wax-red toasts —
 * visible from any screen, NOT just the Werkstatt Tagebuch (memory.md #76 ⑦).
 *
 * Each event is de-duped by its bigserial id so:
 *   • the same alert never fires twice
 *   • toasts opened on Werkstatt survive when the operator switches surfaces
 *   • after sign-out (when the ledger buffer clears) the de-dupe set
 *     resets so future sessions can re-show prior alert types
 */

import { useEffect, useRef } from 'react';

import { isAlertEvent } from '@norns/api-client';

import { selectEvents, useLedgerFeed } from '../state/ledger-feed-store.js';
import { useToastStore } from '../state/toast-store.js';

/** Maps an alert event_type to a short German title for the toast. */
const TITLES: Record<string, string> = {
  'alert.suspicious_aml_flagged': 'AML-Verdachtsmeldung',
  'alert.worker_job_dead_letter': 'Hintergrund-Job ausgefallen',
  'alert.hash_chain_verification_failed': 'Hash-Kette verletzt',
  'alert.anomaly_detected': 'Ungewöhnliches Verhalten',
  'alert.ebay_sale_conflict': 'eBay-Konflikt erkannt',
  'alert.ebay_double_sale_attempt': 'eBay-Doppelverkauf abgewehrt',
  'alert.customer_marked_suspicious': 'Kunde als verdächtig markiert',
  'alert.customer_banned': 'Kunde gesperrt',
};

/** Maps an alert event_type to the surface the operator should jump to. */
const TARGET_PATHS: Record<string, string> = {
  'alert.suspicious_aml_flagged': '/kunden',
  'alert.worker_job_dead_letter': '/einstellungen',
  'alert.hash_chain_verification_failed': '/tagebuch',
  'alert.anomaly_detected': '/tagebuch',
  'alert.ebay_sale_conflict': '/ebay',
  'alert.ebay_double_sale_attempt': '/ebay',
  'alert.customer_marked_suspicious': '/kunden',
  'alert.customer_banned': '/kunden',
};

export function useAlertSubscription(): void {
  const events = useLedgerFeed(selectEvents);
  const addToast = useToastStore((s) => s.addToast);

  // `seen` lives in a ref so unrelated re-renders don't reset it.
  const seenRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    for (const event of events) {
      if (!isAlertEvent(event)) continue;
      if (seenRef.current.has(event.id)) continue;
      seenRef.current.add(event.id);

      const typeKey = String(event.event_type);
      const title = TITLES[typeKey] ?? 'Hinweis';
      const path = TARGET_PATHS[typeKey];
      const subtitle = buildSubtitle(event);
      addToast({
        id: `alert-${event.id}`,
        tone: 'alert',
        title,
        ...(subtitle !== undefined ? { body: subtitle } : {}),
        ...(path !== undefined ? { onClickPath: path } : {}),
      });
    }
  }, [events, addToast]);

  // Trim the de-dupe set when the buffer shrinks (e.g. sign-out → clear()).
  useEffect(() => {
    if (events.length === 0) seenRef.current.clear();
  }, [events.length]);
}

function buildSubtitle(event: { entity_table: string; entity_id: string }): string {
  return `${event.entity_table} · ${event.entity_id.slice(0, 8)}…`;
}
