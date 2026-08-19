import { describe, expect, it } from 'vitest';

import { decidePublish, isPositivePrice } from './product-publish.js';

describe('isPositivePrice', () => {
  it('accepts a normal dot price', () => {
    expect(isPositivePrice('150.00')).toBe(true);
  });

  it('accepts a German comma price', () => {
    expect(isPositivePrice('150,00')).toBe(true);
  });

  it('accepts the smallest positive cent amount', () => {
    expect(isPositivePrice('0,01')).toBe(true);
  });

  it('rejects a bare zero', () => {
    expect(isPositivePrice('0')).toBe(false);
  });

  it('rejects a zero with cents (comma)', () => {
    expect(isPositivePrice('0,00')).toBe(false);
  });

  it('rejects a zero with cents (dot)', () => {
    expect(isPositivePrice('0.00')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isPositivePrice('')).toBe(false);
  });
});

describe('decidePublish', () => {
  it('publishes when requested and the price is positive', () => {
    expect(decidePublish({ publishNow: true, listPriceEur: '150,00' })).toEqual({
      kind: 'publish',
    });
  });

  it('keeps a draft when publish is not requested', () => {
    expect(decidePublish({ publishNow: false, listPriceEur: '150,00' })).toEqual({ kind: 'draft' });
  });

  it('refuses to publish a non-positive price — keeps it a draft with a distinct reason', () => {
    expect(decidePublish({ publishNow: true, listPriceEur: '0,00' })).toEqual({
      kind: 'draft-no-price',
    });
  });

  it('treats an empty price as a non-positive draft when publish is requested', () => {
    expect(decidePublish({ publishNow: true, listPriceEur: '' })).toEqual({
      kind: 'draft-no-price',
    });
  });

  it('a non-publish request with a zero price is still just a draft (not the no-price branch)', () => {
    expect(decidePublish({ publishNow: false, listPriceEur: '0,00' })).toEqual({ kind: 'draft' });
  });
});
