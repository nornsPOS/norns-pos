/**
 * release-cart — best-effort batch release for cart-line reservations.
 *
 * Three callers share this helper to keep the release semantics identical:
 *   • CartPanel "Karte leeren"           (operator-explicit clear)
 *   • AppShell sign-out cascade          (must not leak inventory)
 *   • Verkauf cold-start cleanup edge    (Phase 1.5 #I-35 candidate)
 *
 * Semantics: fire `inventoryApi.release` in parallel for every line; never
 * throw. Network / server errors are swallowed because the operator
 * decision (clear-cart, sign-out) must complete regardless. If a release
 * silently fails, the reservation will remain held server-side; for POS
 * channel that means a single item is temporarily out of catalog until
 * the Owner manually un-reserves OR the next operator who tries to use
 * it gets a 409 and refreshes (the reserve route will then re-grab the
 * row if it was actually un-held in the meantime).
 *
 * Returns the number of attempted releases — handy for log lines / future
 * telemetry. Does NOT return per-line outcomes (callers don't need them;
 * the operator UX has already moved on).
 */

import { type ReleaseReason, productsApi } from '@norns/api-client';

import type { ApiClient } from '@norns/api-client';
import type { CartLine } from '../state/cart-store.js';

export interface ReleaseCartInput {
  api: ApiClient;
  lines: readonly CartLine[];
  reason: ReleaseReason;
}

export async function releaseCart(input: ReleaseCartInput): Promise<number> {
  const { api, lines, reason } = input;
  if (lines.length === 0) return 0;

  // `allSettled` so a single network failure doesn't take down the batch.
  await Promise.allSettled(
    lines.map((line) =>
      productsApi.release(api, {
        productId: line.productId,
        sessionId: line.reservationSessionId,
        reason,
      }),
    ),
  );

  return lines.length;
}

export interface BeaconReleaseCartInput {
  /** Raw API base URL — sendBeacon bypasses the api-client, so we build the URL by hand. */
  baseUrl: string;
  lines: readonly CartLine[];
  reason: ReleaseReason;
  /** Session token — sendBeacon can't set an Authorization header, so it rides in the body. */
  sessionToken: string | null;
}

/**
 * Teardown-survivable release for the `beforeunload` path (P1.4).
 *
 * The previous handler looped `productsApi.release` (a normal async fetch that
 * the browser CANCELS on page teardown), despite a comment claiming keepalive —
 * so POS holds leaked on window close. This sends ONE `navigator.sendBeacon` to
 * the batch route, which the browser flushes even as the page unloads. Falls
 * back to `fetch(..., { keepalive: true })` when sendBeacon is unavailable or
 * refuses (its only header-capable sibling; well under its 64KB body cap given
 * the maxItems:64 server cap). Both carry the token in the body, since neither
 * can attach the session header here.
 *
 * Best-effort: returns true if the beacon was queued. The server-side
 * `pos_reservation_sweeper` is the durable backstop for the case it never
 * arrives (SIGKILL / power loss).
 */
export function beaconReleaseCart(input: BeaconReleaseCartInput): boolean {
  const { baseUrl, lines, reason, sessionToken } = input;
  if (lines.length === 0) return false;

  const url = `${baseUrl.replace(/\/+$/, '')}/api/inventory/release/batch`;
  const payload = JSON.stringify({
    items: lines.map((line) => ({
      productId: line.productId,
      sessionId: line.reservationSessionId,
    })),
    reason,
    ...(sessionToken ? { accessToken: sessionToken } : {}),
  });

  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      if (ok) return true;
    }
  } catch {
    /* fall through to keepalive fetch */
  }

  try {
    void fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
