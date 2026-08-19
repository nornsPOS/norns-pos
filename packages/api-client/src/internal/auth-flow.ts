/**
 * Auth-flow coordinator — the reliability core behind PIN login + the session
 * probe, shared by BOTH the Owner app and the cashier POS (one api-client).
 *
 * The production logs showed three intertwined failure modes on the auth path:
 *
 *   1. "aborted" + many retries: a committed pin-login was torn down by a
 *      parent/cache AbortSignal when the screen re-rendered (StrictMode, theme
 *      flip, keyboard inset, a react-query cache signal). A login the operator
 *      has committed to must RUN TO COMPLETION — a re-render must never cancel
 *      it. So login deliberately runs DETACHED from any caller signal.
 *   2. double-submit: two identical pin-login POSTs fired (auto-submit racing a
 *      re-render), halving the backend's 10/min budget and spuriously tripping
 *      RATE_LIMITED. We coalesce concurrent identical attempts onto ONE promise.
 *   3. the /api/auth/session 401 storm: the cold-start probe re-fired in a
 *      tight loop. We coalesce concurrent probes AND hold a short cooldown after
 *      one settles, so a 401 cannot immediately re-loop.
 *
 * On top of that, a transient transport hiccup (network blip / timeout) on an
 * auth call that never reached the server is safe to re-issue exactly once —
 * silently, so the operator never sees a flash of error for a recovered blip.
 * A REAL answer from the server (any ApiError — 401, PIN_LOCKED, VALIDATION,
 * RATE_LIMITED, …) is never retried: it is the truth and is surfaced as-is.
 *
 * This module is pure + dependency-free (no React, no Tauri, no fetch). It is
 * keyed per logical intent, so the same intent in flight is shared; different
 * intents (a different PIN) are independent.
 */

import { ApiError, ApiNetworkError } from '../errors.js';
import { TimeoutError } from './abort.js';

/** A transient transport failure is safe to silently re-issue once. A real
 *  server answer (ApiError) never is. */
function isTransientTransportError(err: unknown): boolean {
  if (err instanceof ApiNetworkError) return true;
  if (err instanceof TimeoutError) return true;
  // The terminal wraps a timeout abort as ApiNetworkError(cause: TimeoutError);
  // ApiNetworkError already covers it, but guard the bare cause too.
  if (err instanceof ApiError) return false;
  return false;
}

export interface AuthFlowOptions {
  /** Silent auto-retries on a transient transport failure (default 1). */
  maxTransientRetries?: number;
  /** Backoff before a transient re-issue, in ms (default 350). */
  retryDelayMs?: number;
  /**
   * After a coalesced call SETTLES, ignore a new call with the same key for
   * this long and replay the just-settled outcome instead. Stops a probe/login
   * from re-looping on a tight render cycle. Default 0 (no cooldown) — the
   * session probe opts in with a small window.
   */
  cooldownMs?: number;
  /** Injectable for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface Settled<T> {
  at: number;
  result: { ok: true; value: T } | { ok: false; error: unknown };
}

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

/**
 * A single-flight, transient-retrying coordinator for one family of auth calls
 * (login, or session). Concurrent calls with the same key share one underlying
 * promise; a fresh key after settle starts a new one.
 */
export class AuthFlowCoordinator {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly recent = new Map<string, Settled<unknown>>();
  private readonly maxTransientRetries: number;
  private readonly retryDelayMs: number;
  private readonly cooldownMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: AuthFlowOptions = {}) {
    this.maxTransientRetries = Math.max(0, opts.maxTransientRetries ?? 1);
    this.retryDelayMs = Math.max(0, opts.retryDelayMs ?? 350);
    this.cooldownMs = Math.max(0, opts.cooldownMs ?? 0);
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /**
   * Run `attempt` under single-flight coalescing keyed by `key`:
   *   • a call already in flight for `key` → join its promise (no 2nd request).
   *   • a call that settled within `cooldownMs` for `key` → replay its outcome
   *     (don't re-issue — this is the anti-loop guard for the session probe).
   *   • otherwise → run `attempt`, with up to N silent transient re-issues.
   *
   * `attempt` is the raw request thunk; it must run DETACHED from any caller
   * AbortSignal (the caller passes none) so a re-render can't cancel it.
   */
  run<T>(key: string, attempt: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    if (this.cooldownMs > 0) {
      const last = this.recent.get(key);
      if (last && Date.now() - last.at < this.cooldownMs) {
        return last.result.ok
          ? Promise.resolve(last.result.value as T)
          : Promise.reject(last.result.error);
      }
    }

    const promise = this.execute(key, attempt).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  private async execute<T>(key: string, attempt: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= this.maxTransientRetries; i++) {
      try {
        const value = await attempt();
        this.remember(key, { ok: true, value });
        return value;
      } catch (err) {
        lastErr = err;
        // A real server answer (401, PIN_LOCKED, RATE_LIMITED, …) is the truth:
        // never retried, surfaced as-is.
        if (!isTransientTransportError(err) || i >= this.maxTransientRetries) {
          this.remember(key, { ok: false, error: err });
          throw err;
        }
        await this.sleep(this.retryDelayMs);
      }
    }
    // Unreachable (loop either returns or throws), but satisfies the type.
    throw lastErr;
  }

  private remember(key: string, result: Settled<unknown>['result']): void {
    if (this.cooldownMs > 0) this.recent.set(key, { at: Date.now(), result });
  }
}
