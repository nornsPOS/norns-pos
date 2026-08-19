/**
 * Telemetry init — GlitchTip via the Sentry-compatible `@sentry/node` SDK.
 *
 * Optional + fail-safe (Decision #23 / telemetry constraint): when no DSN is
 * configured the SDK is never initialized and the app boots + runs normally.
 * A failure inside `Sentry.init` is swallowed so telemetry can never block the
 * server from starting.
 */

import * as Sentry from '@sentry/node';

let initialized = false;

export interface InitSentryOptions {
  /** GlitchTip/Sentry DSN. Empty/undefined → telemetry stays disabled. */
  dsn?: string | undefined;
  /** Reported as the Sentry environment tag (defaults to 'production'). */
  environment?: string | undefined;
  /** Release identifier, if available. */
  release?: string | undefined;
}

/**
 * Initialize telemetry if a DSN is present. Returns true when the SDK was
 * activated, false when disabled (no DSN) or on a swallowed init failure.
 * Idempotent — safe to call more than once.
 */
export function initSentry(opts: InitSentryOptions): boolean {
  const dsn = opts.dsn?.trim();
  if (!dsn) return false;
  if (initialized) return true;
  try {
    Sentry.init({
      dsn,
      environment: opts.environment ?? 'production',
      ...(opts.release ? { release: opts.release } : {}),
      // GlitchTip is error-focused; keep tracing off by default (opt-in later).
      tracesSampleRate: 0,
    });
    initialized = true;
    return true;
  } catch {
    // Telemetry must never prevent the app from booting.
    return false;
  }
}

/** True once telemetry has been activated this process. */
export function isSentryEnabled(): boolean {
  return initialized;
}

export { Sentry };
