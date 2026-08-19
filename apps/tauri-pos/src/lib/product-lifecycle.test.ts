/**
 * product-lifecycle — the pure derivation behind the ProductSheet status chip.
 * One object, visible stages (UX-REDESIGN §4.1): Entwurf → Fotos → Bepreist →
 * Veröffentlicht → Reserviert → Verkauft, derived purely from product state.
 */
import { describe, expect, it } from 'vitest';

import { deriveLifecycleStage } from './product-lifecycle.js';

const base = { status: 'DRAFT' as const, listPriceEur: '0.00', photoCount: 0 };

describe('deriveLifecycleStage', () => {
  it('maps SOLD / RESERVED / AVAILABLE first, regardless of price or photos', () => {
    expect(deriveLifecycleStage({ ...base, status: 'SOLD', listPriceEur: '99.00' })).toBe('Verkauft');
    expect(deriveLifecycleStage({ ...base, status: 'RESERVED', photoCount: 5 })).toBe('Reserviert');
    expect(deriveLifecycleStage({ ...base, status: 'AVAILABLE' })).toBe('Veröffentlicht');
  });

  it('DRAFT with a positive price is Bepreist (price wins over photos)', () => {
    expect(deriveLifecycleStage({ ...base, listPriceEur: '12.50' })).toBe('Bepreist');
    expect(deriveLifecycleStage({ ...base, listPriceEur: '0,01', photoCount: 3 })).toBe('Bepreist');
  });

  it('DRAFT, no price, with photos is Fotos', () => {
    expect(deriveLifecycleStage({ ...base, photoCount: 2 })).toBe('Fotos');
  });

  it('DRAFT, no price, no photos is Entwurf; 0,00 / 0.00 / empty are not positive', () => {
    expect(deriveLifecycleStage(base)).toBe('Entwurf');
    expect(deriveLifecycleStage({ ...base, listPriceEur: '0,00' })).toBe('Entwurf');
    expect(deriveLifecycleStage({ ...base, listPriceEur: '' })).toBe('Entwurf');
    expect(deriveLifecycleStage({ status: 'DRAFT', listPriceEur: '0.00' })).toBe('Entwurf'); // photoCount optional
  });
});
