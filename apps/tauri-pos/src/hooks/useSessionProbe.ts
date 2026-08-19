/**
 * useSessionProbe — cold-start session restore.
 *
 * Runs ONCE when status is 'unknown'. Calls GET /api/auth/session:
 *   • 200 → `setFromProbe(payload)`   (operator stays logged in)
 *   • 401 / other ApiError → `setUnauthenticated()`  (PIN re-login screen)
 *   • network / circuit-open → `setUnreachable()`    (the SERVER is down — we
 *                                                     must NOT imply the session
 *                                                     ended; App.tsx shows a
 *                                                     "Keine Verbindung" retry)
 *
 * Splitting the catch is the whole point of this hook for the honest-connection
 * cluster: an unreachable tunnel used to fall through to the PIN pad, which
 * looks like a silent logout. A real auth failure (`ApiError`, incl. 401) still
 * means "no session" → unauthenticated.
 *
 * Uses the RAW ApiClient (not the step-up wrapper). A 401 here must NOT
 * try to open the step-up modal; it just means there's no session.
 */

import { useEffect } from 'react';

import { ApiCircuitOpenError, ApiNetworkError, authPin } from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';
import { useSessionStore } from '../state/session-store.js';
import { useSyncStore } from '../state/sync-store.js';

export function useSessionProbe(): void {
  const api = useApiClient();
  const status = useSessionStore((s) => s.status);
  const setFromProbe = useSessionStore((s) => s.setFromProbe);
  const setUnauthenticated = useSessionStore((s) => s.setUnauthenticated);
  const setUnreachable = useSessionStore((s) => s.setUnreachable);

  useEffect(() => {
    if (status !== 'unknown') return;
    let cancelled = false;

    (async () => {
      try {
        const res = await authPin.sessionSafe(api);
        if (cancelled) return;
        useSyncStore.getState().recordRequestSuccess();
        setFromProbe(res);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiNetworkError || err instanceof ApiCircuitOpenError) {
          // The server itself is unreachable — do NOT show the PIN pad (that
          // reads as a logout). Flag reachability + show the retry screen.
          useSyncStore
            .getState()
            .recordRequestFailure(err instanceof ApiCircuitOpenError ? 'circuit' : 'network');
          setUnreachable();
          return;
        }
        // A real API response (401 / other) → genuinely no session.
        useSyncStore.getState().recordRequestSuccess();
        setUnauthenticated();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [api, status, setFromProbe, setUnauthenticated, setUnreachable]);
}
