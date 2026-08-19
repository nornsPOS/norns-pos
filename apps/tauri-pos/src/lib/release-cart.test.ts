/**
 * Phase-2 P1.4 — beaconReleaseCart sends ONE teardown-survivable batch release.
 *
 * The old `beforeunload` looped a normal fetch (cancelled on teardown). This
 * proves the replacement: a single navigator.sendBeacon to the batch route with
 * the items, reason, and token-in-body; an empty cart is a no-op; and the
 * fetch(keepalive) fallback fires when sendBeacon refuses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CartLine } from '../state/cart-store.js';
import { beaconReleaseCart } from './release-cart.js';

const lines = [
  { productId: 'p-1', reservationSessionId: 's-1' },
  { productId: 'p-2', reservationSessionId: 's-2' },
] as unknown as CartLine[];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('beaconReleaseCart', () => {
  it('sends one sendBeacon to the batch route with items + reason + token', async () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit) => true);
    vi.stubGlobal('navigator', { sendBeacon });

    const ok = beaconReleaseCart({
      baseUrl: 'http://localhost:3001/',
      lines,
      reason: 'pos_cart_cleared',
      sessionToken: 'tok-xyz',
    });

    expect(ok).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const call = sendBeacon.mock.calls[0];
    if (!call) throw new Error('sendBeacon was not called');
    const [url, blob] = call as [string, Blob];
    expect(url).toBe('http://localhost:3001/api/inventory/release/batch');
    const payload = JSON.parse(await blob.text()) as {
      items: { productId: string; sessionId: string }[];
      reason: string;
      accessToken: string;
    };
    expect(payload.items).toEqual([
      { productId: 'p-1', sessionId: 's-1' },
      { productId: 'p-2', sessionId: 's-2' },
    ]);
    expect(payload.reason).toBe('pos_cart_cleared');
    expect(payload.accessToken).toBe('tok-xyz');
  });

  it('is a no-op for an empty cart', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    expect(
      beaconReleaseCart({
        baseUrl: 'http://x',
        lines: [],
        reason: 'pos_cart_cleared',
        sessionToken: 't',
      }),
    ).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('falls back to fetch(keepalive:true) when sendBeacon returns false', () => {
    vi.stubGlobal('navigator', { sendBeacon: vi.fn((_url: string, _data?: BodyInit) => false) });
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const ok = beaconReleaseCart({
      baseUrl: 'http://x',
      lines,
      reason: 'pos_cart_cleared',
      sessionToken: 't',
    });

    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const fetchCall = fetchSpy.mock.calls[0];
    if (!fetchCall) throw new Error('fetch was not called');
    const init = fetchCall[1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe('POST');
  });
});
