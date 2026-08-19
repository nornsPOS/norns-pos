/**
 * useSafeRetry — TanStack `useMutation` that re-fires a SAFE write once we're
 * back online, and refuses to touch a fiscal / non-idempotent one.
 *
 * The absolute line (from retry-policy): a fiscal / money-movement mutation is
 * NEVER auto-retried or held here — those go through the api-client offline queue
 * + step-up + explicit confirm. What IS auto-retried is an idempotent, non-fiscal
 * write (mark a task done, set an appointment status) that failed purely because
 * the wire was down. On a webview, `navigator.onLine` + the online/offline events
 * are the transport truth (no separate connection store needed).
 */
import { type UseMutationOptions, type UseMutationResult, useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { HttpMethod } from '@norns/api-client';

import {
  classifyRetry,
  describeRetryDecision,
  isTransientTransportError,
  type RetryDecision,
} from './retry-policy.js';

// Intersections, not `interface extends`: TanStack's UseMutationOptions/Result
// are unions, which an interface cannot extend.
export type SafeRetryOptions<T, V> = Omit<UseMutationOptions<T, Error, V>, 'mutationFn'> & {
  /** Describes the request so the policy can classify it (fiscal → never retried). */
  request: { method: HttpMethod; path: string; idempotent?: boolean };
  /** Max automatic re-fires before surfacing the error for a manual retry. Default 3. */
  maxAutoRetries?: number;
};

export type SafeRetryResult<T, V> = UseMutationResult<T, Error, V> & {
  /** The policy's verdict for this write (stable for the hook's life). */
  decision: RetryDecision;
  /** A calm German line explaining what will (or won't) happen on reconnect. */
  retryHint: string;
  /** True while we're holding a failed safe write to re-fire on reconnect. */
  willAutoRetry: boolean;
  /** Fire the mutation through the safe-retry path (awaitable). */
  safeMutate: (vars: V) => Promise<T>;
};

function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(
    typeof navigator === 'undefined' || navigator.onLine !== false,
  );
  useEffect(() => {
    const on = (): void => setOnline(true);
    const off = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function useSafeRetry<T, V>(
  mutator: (vars: V) => Promise<T>,
  options: SafeRetryOptions<T, V>,
): SafeRetryResult<T, V> {
  const { request, maxAutoRetries = 3, ...mutationOptions } = options;
  const decision = classifyRetry(request);
  const retryHint = describeRetryDecision(decision);

  const m = useMutation<T, Error, V>({ mutationFn: mutator, ...mutationOptions });
  const online = useOnline();

  // The last vars of a SAFE write that failed on transport — held to re-fire.
  const [pendingVars, setPendingVars] = useState<V | null>(null);
  const attemptsRef = useRef(0);
  const mutateAsyncRef = useRef(m.mutateAsync);
  mutateAsyncRef.current = m.mutateAsync;

  const safeMutate = useCallback(
    async (vars: V): Promise<T> => {
      try {
        const out = await mutateAsyncRef.current(vars);
        setPendingVars(null);
        attemptsRef.current = 0;
        return out;
      } catch (err) {
        // Only a SAFE write that died because the wire was down is remembered. A
        // real server refusal (validation/conflict) is a genuine answer, never
        // re-fired; a fiscal / non-idempotent write is never remembered at all.
        if (decision.safe && isTransientTransportError(err)) setPendingVars(vars);
        throw err;
      }
    },
    [decision.safe],
  );

  // Re-fire a held safe write once we're back online, up to the cap. Keyed on
  // BOTH online AND pendingVars so arming while already-online still schedules.
  useEffect(() => {
    if (!online || pendingVars == null) return;
    if (attemptsRef.current >= maxAutoRetries) {
      setPendingVars(null); // out of auto attempts — the surface shows the error
      return;
    }
    attemptsRef.current += 1;
    const vars = pendingVars;
    setPendingVars(null); // clear before firing; a failure re-arms via safeMutate
    void safeMutate(vars).catch(() => {
      /* already surfaced onto the mutation state + (if transient) re-armed */
    });
  }, [online, pendingVars, maxAutoRetries, safeMutate]);

  return {
    ...m,
    decision,
    retryHint,
    willAutoRetry: decision.safe && pendingVars != null,
    safeMutate,
  };
}
