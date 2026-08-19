/**
 * kassensturz — the pure close-out classification (UX §4.3). No facade: the
 * Differenz = counted − expected (a math identity equal to the server's
 * varianceEur); a real shortage is NEVER hidden; bigint-cents, comma-tolerant.
 */
import { describe, expect, it } from 'vitest';

import { classifyDifferenz } from './kassensturz.js';

describe('classifyDifferenz (counted − expected vs tolerance)', () => {
  it('exact match → 0,00 and tone ok (within tolerance)', () => {
    const r = classifyDifferenz({ countedEur: '545.50', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('0.00');
    expect(r.tone).toBe('ok');
    expect(r.withinTolerance).toBe(true);
  });

  it('over beyond tolerance → 9,50, tone over, flagged', () => {
    const r = classifyDifferenz({ countedEur: '555.00', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('9.50');
    expect(r.tone).toBe('over');
    expect(r.withinTolerance).toBe(false);
  });

  it('short beyond tolerance → −10,50, tone short, flagged (never hidden)', () => {
    const r = classifyDifferenz({ countedEur: '535.00', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('-10.50');
    expect(r.tone).toBe('short');
    expect(r.withinTolerance).toBe(false);
  });

  it('exactly at the threshold is within (inclusive)', () => {
    const r = classifyDifferenz({ countedEur: '550.50', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('5.00');
    expect(r.withinTolerance).toBe(true);
    expect(r.tone).toBe('ok');
  });

  it('tolerates the German comma', () => {
    const r = classifyDifferenz({ countedEur: '535,00', expectedEur: '545,50', toleranceEur: '5,00' });
    expect(r.differenzEur).toBe('-10.50');
    expect(r.tone).toBe('short');
  });

  it('missing expected → no classification (null), tone ok, no fake shortage', () => {
    const r = classifyDifferenz({ countedEur: '100.00', expectedEur: null, toleranceEur: '5.00' });
    expect(r.differenzEur).toBeNull();
    expect(r.tone).toBe('ok');
    expect(r.withinTolerance).toBe(true);
  });
});
