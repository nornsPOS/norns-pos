import { Type } from '@sinclair/typebox';
import { describe, expect, it, vi } from 'vitest';

import { Cents, DecimalMoney, parseResponse } from '../src/validation.js';

const Summary = Type.Object({ cents: Cents, name: Type.String() });

describe('parseResponse — runtime trust boundary', () => {
  it('returns the typed value on a valid payload', () => {
    expect(parseResponse(Summary, { cents: 1500, name: 'x' }, 'test')).toEqual({
      cents: 1500,
      name: 'x',
    });
  });

  it('returns null (+ logs) on a NON-INTEGER cents — the centsToEur crash case', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseResponse(Summary, { cents: 15.5, name: 'x' }, 'test')).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('returns null on a missing field', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseResponse(Summary, { cents: 1500 }, 'test')).toBeNull();
    spy.mockRestore();
  });

  it('returns null on a wrong-typed field', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseResponse(Summary, { cents: '1500', name: 'x' }, 'test')).toBeNull();
    spy.mockRestore();
  });
});

describe('DecimalMoney atom', () => {
  const M = Type.Object({ m: DecimalMoney });
  it('accepts a 2-dp decimal string', () => {
    expect(parseResponse(M, { m: '1234.50' }, 't')).toEqual({ m: '1234.50' });
    expect(parseResponse(M, { m: '-0.05' }, 't')).toEqual({ m: '-0.05' });
  });
  it('rejects 1-dp, no-dp, and numeric money', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseResponse(M, { m: '1234.5' }, 't')).toBeNull();
    expect(parseResponse(M, { m: '1234' }, 't')).toBeNull();
    expect(parseResponse(M, { m: 1234.5 }, 't')).toBeNull();
    spy.mockRestore();
  });
});
