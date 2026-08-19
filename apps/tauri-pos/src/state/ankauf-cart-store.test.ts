/**
 * Phase 1.9 — schema-validated Ankauf rehydration.
 *
 * A corrupt persisted intake item must be DROPPED on rehydration, not fed into
 * the buy-in math (sumNegotiatedCents / the KYC gate) where it would throw and
 * white-screen the till.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeIntakeItems } from './ankauf-cart-store.js';

// A plausible, well-formed persisted item. The display enums (itemType, metal,
// condition) are validated as plain strings, so any string value passes.
const validItem = {
  tempId: 'a',
  sku: 'SKU-a',
  barcode: '',
  itemType: 'SCHMUCK',
  metal: 'GOLD',
  karatCode: '585',
  finenessDecimal: '0.585',
  weightGrams: '10.50',
  hallmarkStamps: [],
  condition: 'GEBRAUCHT',
  taxTreatmentCode: 'MARGIN_25A',
  name: 'Ring',
  descriptionDe: '',
  listPriceEur: '200.00',
  negotiatedPriceEur: '150.00',
  publishImmediately: false,
  addedAt: '2026-01-01T00:00:00.000Z',
};

describe('sanitizeIntakeItems — corrupt persisted items are dropped', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps a well-formed item (metal null is valid)', () => {
    expect(sanitizeIntakeItems([validItem])).toHaveLength(1);
    expect(sanitizeIntakeItems([{ ...validItem, metal: null }])).toHaveLength(1);
  });

  it('drops an item missing a required field', () => {
    const { negotiatedPriceEur: _gone, ...broken } = validItem;
    expect(sanitizeIntakeItems([broken])).toHaveLength(0);
  });

  it('drops an item whose taxTreatmentCode is not a known enum', () => {
    expect(sanitizeIntakeItems([{ ...validItem, taxTreatmentCode: 'GARBAGE' }])).toHaveLength(0);
  });

  it('drops an item with a wrong-typed field (publishImmediately not boolean)', () => {
    expect(sanitizeIntakeItems([{ ...validItem, publishImmediately: 'yes' }])).toHaveLength(0);
  });

  it('keeps the valid items and drops the corrupt ones from a mixed array', () => {
    const out = sanitizeIntakeItems([
      validItem,
      { nonsense: true },
      { ...validItem, tempId: 'b', sku: 'SKU-b' },
      null,
    ]);
    expect(out.map((i) => i.tempId)).toEqual(['a', 'b']);
  });

  it('returns an empty array for a non-array (corrupt/absent storage)', () => {
    expect(sanitizeIntakeItems(undefined)).toEqual([]);
    expect(sanitizeIntakeItems('nope')).toEqual([]);
  });
});
