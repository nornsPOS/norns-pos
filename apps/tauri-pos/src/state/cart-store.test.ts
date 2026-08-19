/**
 * Phase 1.1 — the mixed-tax-treatment guard.
 *
 * V1 signs ONE receipt under ONE tax treatment (no split-payment fiscal path),
 * so the cart store must refuse a second line whose `taxTreatmentCode` differs
 * from the lines already held — otherwise a §25a piece and a 19 % piece would
 * be signed under a single, wrong treatment. This test locks that invariant in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaxTreatmentCode } from '@norns/api-client';

import { type CartLine, sanitizeCartLines, useCartStore } from './cart-store.js';

function stubLocalStorage(store: Map<string, string>): void {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
}

function makeLine(productId: string, treatment: TaxTreatmentCode): CartLine {
  return {
    productId,
    reservationSessionId: `sess-${productId}`,
    sku: `SKU-${productId}`,
    name: `Stück ${productId}`,
    listPriceEur: '100.00',
    acquisitionCostEur: '60.00',
    taxTreatmentCode: treatment,
    addedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('cart-store addLine — one tax treatment per receipt', () => {
  beforeEach(() => {
    stubLocalStorage(new Map());
    useCartStore.getState().clearCart();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts the first line', () => {
    expect(useCartStore.getState().addLine(makeLine('a', 'MARGIN_25A'))).toBeNull();
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('rejects a second line with a DIFFERENT tax treatment', () => {
    useCartStore.getState().addLine(makeLine('a', 'MARGIN_25A'));
    const result = useCartStore.getState().addLine(makeLine('b', 'STANDARD_19'));
    expect(result).toEqual({
      kind: 'MIXED_TAX_TREATMENT',
      existing: 'MARGIN_25A',
      incoming: 'STANDARD_19',
    });
    // The rejected line must NOT have entered the cart.
    expect(useCartStore.getState().lines).toHaveLength(1);
  });

  it('accepts a second line with the SAME tax treatment', () => {
    useCartStore.getState().addLine(makeLine('a', 'MARGIN_25A'));
    expect(useCartStore.getState().addLine(makeLine('b', 'MARGIN_25A'))).toBeNull();
    expect(useCartStore.getState().lines).toHaveLength(2);
  });

  it('still rejects a duplicate productId with ALREADY_IN_CART', () => {
    useCartStore.getState().addLine(makeLine('a', 'MARGIN_25A'));
    expect(useCartStore.getState().addLine(makeLine('a', 'MARGIN_25A'))).toEqual({
      kind: 'ALREADY_IN_CART',
    });
    expect(useCartStore.getState().lines).toHaveLength(1);
  });
});

describe('sanitizeCartLines — corrupt persisted lines are dropped, not crashed', () => {
  it('keeps a well-formed line', () => {
    expect(sanitizeCartLines([makeLine('a', 'STANDARD_19')])).toHaveLength(1);
  });

  it('drops a line missing a required field', () => {
    const { sku: _dropped, ...broken } = makeLine('a', 'STANDARD_19');
    expect(sanitizeCartLines([broken])).toHaveLength(0);
  });

  it('drops a line whose taxTreatmentCode is not a known enum', () => {
    const bad = { ...makeLine('a', 'STANDARD_19'), taxTreatmentCode: 'GARBAGE' };
    expect(sanitizeCartLines([bad])).toHaveLength(0);
  });

  it('keeps the valid lines and drops the corrupt ones from a mixed array', () => {
    const out = sanitizeCartLines([
      makeLine('a', 'MARGIN_25A'),
      { nonsense: true },
      makeLine('b', 'REDUCED_7'),
      null,
    ]);
    expect(out.map((l) => l.productId)).toEqual(['a', 'b']);
  });

  it('returns an empty array for a non-array (corrupt/absent storage)', () => {
    expect(sanitizeCartLines(undefined)).toEqual([]);
    expect(sanitizeCartLines('not-an-array')).toEqual([]);
  });
});
