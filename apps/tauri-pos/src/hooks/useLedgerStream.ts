/**
 * useLedgerStream — wraps a long-lived EventSource for /api/sse/ledger.
 *
 * Responsibilities:
 *   1. Open the SSE connection (with credentials → session cookie auth).
 *   2. Parse each `event: ledger` payload into a typed `LedgerEvent`.
 *   3. Push it onto the Zustand `ledger-feed-store` (atomic, per-row UI).
 *   4. Debounce-invalidate the `dashboard.summary` TanStack Query when
 *      the event affects any dashboard tile (`shouldInvalidateDashboard`).
 *   5. Reconnect on close / error with exponential backoff (1s → 30s),
 *      letting the browser's EventSource auto-resume via `Last-Event-ID`.
 *   6. Surface `status` + `lastError` so the UI can show a small
 *      "Verbindung wird wiederhergestellt..." banner if needed.
 *
 * The hook owns the EventSource for its lifetime. Mount it ONCE at the
 * top of the authenticated tree (App.tsx after the session gate).
 *
 * Why NOT TanStack Query mutation: SSE is not idempotent — re-running it
 * would open a second stream. TanStack lifecycle (refetch, focus) is wrong
 * here. We use a hand-written hook + Zustand.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  ApiError,
  ApiNetworkError,
  type LedgerEvent,
  authPin,
  parseLedgerEvent,
  shouldInvalidateDashboard,
} from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';
import { useLedgerFeed } from '../state/ledger-feed-store.js';
import { useSessionStore } from '../state/session-store.js';
import { useSyncStore } from '../state/sync-store.js';
import { dashboardQueryKey } from './useDashboardSummary.js';

export type SseStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

interface UseLedgerStreamResult {
  status: SseStatus;
  /** Last error from the EventSource — useful for a thin debug strip. */
  lastError: string | null;
}

const RECONNECT_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];
/** Coalesce multiple dashboard invalidations within this window into one. */
const DASHBOARD_INVALIDATE_DEBOUNCE_MS = 400;
/**
 * After this many consecutive SSE failures we stop blindly reconnecting and
 * probe the session: EventSource cannot read the 401 body, so an expired
 * session would otherwise loop forever with the operator still "logged in".
 */
const SESSION_PROBE_AFTER_FAILURES = 3;

export function useLedgerStream(enabled: boolean): UseLedgerStreamResult {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const push = useLedgerFeed((s) => s.push);

  const [status, setStatus] = useState<SseStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const invalidateTimerRef = useRef<number | null>(null);
  /** Consecutive SSE failures with no intervening open — gates the auth probe. */
  const consecutiveFailuresRef = useRef(0);
  /** True while a session probe is in flight, so we only fire one at a time. */
  const probingRef = useRef(false);
  // Hold the client in a ref so the `enabled`-only effect can probe the session
  // without taking a new dependency on `apiClient` (it's a stable singleton).
  const apiClientRef = useRef(apiClient);
  apiClientRef.current = apiClient;

  useEffect(() => {
    if (!enabled) {
      // Caller turned the stream off (sign-out). Tear down cleanly.
      closeEverything();
      setStatus('closed');
      return;
    }

    let cancelled = false;

    // After repeated SSE failures, find out WHY: EventSource swallows the
    // status code, so a hard 401 (expired/killed session) is indistinguishable
    // from a transient network blip — it would just reconnect forever while the
    // operator still appears logged in. Probe the session once; a 401 drives the
    // store to unauthenticated (→ PIN pad) instead of looping silently. A
    // network error means the SERVER is down, not the session — leave the
    // backoff loop running and only mark reachability.
    async function probeSessionAfterFailures() {
      if (probingRef.current) return;
      probingRef.current = true;
      try {
        await authPin.sessionSafe(apiClientRef.current);
        // Session is alive — the SSE failure was transient/proxy-side. Reset the
        // counter so a later genuine 401 still gets its own probe.
        if (!cancelled) {
          consecutiveFailuresRef.current = 0;
          useSyncStore.getState().recordRequestSuccess();
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.httpStatus === 401) {
          // Genuinely logged out — stop the reconnect loop by flipping the gate.
          useSessionStore.getState().setUnauthenticated();
        } else if (err instanceof ApiNetworkError) {
          // Server unreachable — keep retrying the stream; just report health.
          useSyncStore.getState().recordRequestFailure('network');
        }
        // Any other ApiError (e.g. 5xx) — leave the backoff loop to retry.
      } finally {
        probingRef.current = false;
      }
    }

    function scheduleReconnect() {
      const attempt = reconnectAttemptRef.current;
      const delay = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!;
      reconnectAttemptRef.current = attempt + 1;
      setStatus('reconnecting');
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!cancelled) connect();
      }, delay);
    }

    function dispatchEvent(event: LedgerEvent) {
      push(event);
      if (shouldInvalidateDashboard(event)) {
        // Coalesce many close-together dashboard-affecting events into one
        // invalidation, so we don't hammer the API during a busy minute.
        if (invalidateTimerRef.current !== null) {
          window.clearTimeout(invalidateTimerRef.current);
        }
        invalidateTimerRef.current = window.setTimeout(() => {
          invalidateTimerRef.current = null;
          // Fire-and-forget — TanStack handles the actual refetch.
          void queryClient.invalidateQueries({ queryKey: dashboardQueryKey });
        }, DASHBOARD_INVALIDATE_DEBOUNCE_MS);
      }
    }

    async function connect() {
      setStatus('connecting');
      setLastError(null);

      // ⚠️ HIER STAND DER SITZUNGSSCHLUESSEL.
      //
      // `EventSource` kann keine Kopfzeilen setzen, und auf Windows verwirft
      // WebView2 den seitenuebergreifenden Keks — es MUSS also etwas in der
      // Adresse stehen. Es stand aber der volle Anmeldeschluessel, und der
      // landete im Tunnelprotokoll UND in den Zugriffsprotokollen von
      // Cloudflare, also ausserhalb jeder eigenen Kontrolle. Am 26.07.2026
      // nachgemessen: einer war noch 4,7 Stunden gueltig.
      //
      // Jetzt eine Eintrittskarte: 30 Sekunden, EINMALIG, und aus ihr laesst
      // sich die Sitzung nicht ableiten. Sie wird ueber einen normalen POST
      // geholt, dessen Anmeldung in keinem Zugriffsprotokoll erscheint.
      const sseBase = `${apiClient.baseUrl.replace(/\/+$/, '')}/api/sse/ledger`;
      let url = sseBase;
      try {
        const { ticket } = await apiClient.request<{ ticket: string }>(
          'POST',
          '/api/sse/ticket',
        );
        url = `${sseBase}?ticket=${encodeURIComponent(ticket)}`;
      } catch {
        // Ohne Karte wird es ueber den Keks versucht. Das traegt im Browser und
        // auf macOS; auf Windows bleibt der Strom dann aus, bis der naechste
        // Versuch eine Karte bekommt. Der ALTE Weg wird bewusst NICHT als
        // Rueckfall benutzt — er war ja der Befund.
      }
      if (cancelled) return;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.addEventListener('open', () => {
        if (cancelled) return;
        reconnectAttemptRef.current = 0;
        consecutiveFailuresRef.current = 0;
        // A live SSE stream is the strongest reachability heartbeat we have.
        useSyncStore.getState().recordRequestSuccess();
        setStatus('open');
      });

      es.addEventListener('ledger', (msg) => {
        if (cancelled) return;
        const data = (msg as MessageEvent<string>).data;
        const parsed = parseLedgerEvent(data);
        if (parsed) dispatchEvent(parsed);
      });

      // Some SSE servers (and curl tests) emit messages without the `event:`
      // line — they default to `event: message`. Cover both paths.
      es.addEventListener('message', (msg) => {
        if (cancelled) return;
        const data = (msg as MessageEvent<string>).data;
        const parsed = parseLedgerEvent(data);
        if (parsed) dispatchEvent(parsed);
      });

      es.addEventListener('error', () => {
        if (cancelled) return;
        // EventSource auto-reconnects on transient errors, but it will not
        // resurrect after a hard close (401/403). We schedule manual retry
        // — if a retry succeeds, the backoff resets in the open handler.
        setLastError('connection_interrupted');
        useSyncStore.getState().recordRequestFailure('network');
        consecutiveFailuresRef.current += 1;
        try {
          es.close();
        } catch {
          /* ignore */
        }
        esRef.current = null;
        // After N straight failures, stop guessing: probe the session so a real
        // 401 ends the silent loop and shows the PIN pad.
        if (consecutiveFailuresRef.current >= SESSION_PROBE_AFTER_FAILURES) {
          void probeSessionAfterFailures();
        }
        scheduleReconnect();
      });
    }

    function closeEverything() {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (invalidateTimerRef.current !== null) {
        window.clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
      if (esRef.current) {
        try {
          esRef.current.close();
        } catch {
          /* ignore */
        }
        esRef.current = null;
      }
    }

    connect();
    return closeEverything;
    // The effect intentionally depends on `enabled` only; apiClient + queryClient
    // are stable singletons within the app lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status, lastError };
}
