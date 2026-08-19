/**
 * Composes a caller-supplied AbortSignal with a request timeout into a single
 * downstream signal. Returns a `cleanup()` the caller MUST invoke on
 * request settle (success or failure) to:
 *   1. Cancel the timeout timer.
 *   2. Detach the parent-signal listener — fixes the prior leak where every
 *      request added a permanent listener to a long-lived caller signal
 *      (e.g. a react-query cache signal), accumulating across requests.
 *
 * The `TimeoutError` class is the abort reason when the timeout fires, so
 * downstream middleware can distinguish "user cancelled" from "request took
 * too long". The retry middleware uses this distinction (see middleware/
 * retry.ts) — caller-aborts are never retried.
 */

export class TimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`request timeout after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export interface ComposedSignal {
  signal: AbortSignal;
  cleanup: () => void;
}

export function composeSignals(parent: AbortSignal | undefined, timeoutMs: number): ComposedSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TimeoutError(timeoutMs)), timeoutMs);

  if (!parent) {
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
    };
  }

  if (parent.aborted) {
    controller.abort(parent.reason);
    return {
      signal: controller.signal,
      cleanup: () => clearTimeout(timer),
    };
  }

  const onParentAbort = (): void => controller.abort(parent.reason);
  parent.addEventListener('abort', onParentAbort, { once: true });

  return {
    signal: controller.signal,
    cleanup: (): void => {
      clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
  };
}
