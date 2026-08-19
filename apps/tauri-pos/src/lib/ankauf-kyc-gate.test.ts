import { describe, expect, it } from 'vitest';

import { evaluateKycGate } from './ankauf-kyc-gate.js';
import { toCents } from './intake-math.js';

/** Minimal customer shape the gate reads. */
const customer = (kycVerifiedAt: string | null) => ({ kycVerifiedAt });

describe('evaluateKycGate — ANKAUF (ID ALWAYS required, §259 StGB)', () => {
  it('€0,01 with an unverified seller → required', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('0.01'),
      customer: customer(null),
    });
    expect(r.thresholdReached).toBe(true);
    expect(r.required).toBe(true);
    expect(r.reason).toBe('single');
  });

  it('a large buy with an unverified seller → required', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('5000.00'),
      customer: customer(null),
    });
    expect(r.required).toBe(true);
  });

  it('a verified seller → not required (already ID-checked)', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('1200.00'),
      customer: customer('2026-01-01T10:00:00Z'),
    });
    expect(r.kycVerified).toBe(true);
    expect(r.required).toBe(false);
  });

  it('no customer selected → not required yet (nothing to stamp), but rule trips', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('300.00'),
      customer: null,
    });
    expect(r.thresholdReached).toBe(true);
    expect(r.required).toBe(false);
  });

  it('empty cart (0) → nothing required', () => {
    const r = evaluateKycGate({ direction: 'ANKAUF', totalCents: 0n, customer: customer(null) });
    expect(r.thresholdReached).toBe(false);
    expect(r.required).toBe(false);
  });
});

describe('evaluateKycGate — VERKAUF (ID required at ≥ €2.000, §10 GwG)', () => {
  it('€1.999,99 → not required (anonymous sale allowed below €2.000)', () => {
    const r = evaluateKycGate({
      direction: 'VERKAUF',
      totalCents: toCents('1999.99'),
      customer: customer(null),
    });
    expect(r.thresholdReached).toBe(false);
    expect(r.required).toBe(false);
  });

  it('exactly €2.000,00 with an unverified buyer → required (reason single)', () => {
    const r = evaluateKycGate({
      direction: 'VERKAUF',
      totalCents: toCents('2000.00'),
      customer: customer(null),
    });
    expect(r.thresholdReached).toBe(true);
    expect(r.required).toBe(true);
    expect(r.reason).toBe('single');
  });

  it('€2.000+ but the buyer is already verified → not required', () => {
    const r = evaluateKycGate({
      direction: 'VERKAUF',
      totalCents: toCents('5000.00'),
      customer: customer('2026-01-01T10:00:00Z'),
    });
    expect(r.required).toBe(false);
  });

  it('€2.000 with no customer → not required (nothing to stamp), threshold still reflected', () => {
    const r = evaluateKycGate({
      direction: 'VERKAUF',
      totalCents: toCents('9999.00'),
      customer: null,
    });
    expect(r.thresholdReached).toBe(true);
    expect(r.required).toBe(false);
  });
});

describe('evaluateKycGate — §10 aggregation (Ankauf linked-transaction banner, memory #101)', () => {
  const window7 = (priorEur: string) => ({
    priorWindowAnkaufCents: toCents(priorEur),
    windowDays: 30,
  });

  it('current buy under €2.000 but the rolling window crosses → aggregate flagged', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('700.00'),
      customer: customer('2026-01-01T00:00:00Z'), // verified → not required, but aggregate computed
      aggregate: window7('1500.00'),
    });
    expect(r.aggregateReached).toBe(true);
    expect(r.aggregateCents).toBe(toCents('2200.00'));
  });

  it('no aggregate supplied → aggregate path stays off', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('700.00'),
      customer: customer(null),
    });
    expect(r.aggregateReached).toBe(false);
  });
});

describe('evaluateKycGate — §15 GwG verstärkte Sorgfaltspflichten (PEP)', () => {
  const pep = (kycVerifiedAt: string | null) => ({ kycVerifiedAt, pepMatch: true });

  it('a PEP seller flags enhanced due diligence even at one cent', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('0.01'),
      customer: pep(null),
    });
    expect(r.enhancedDueDiligence).toBe(true);
  });

  it('a stamped KYC does NOT clear the PEP obligation', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('500.00'),
      customer: pep('2026-01-01T00:00:00Z'),
    });
    expect(r.kycVerified).toBe(true);
    expect(r.required).toBe(false);
    expect(r.enhancedDueDiligence).toBe(true);
  });

  it('a PEP buying below the §10 threshold on VERKAUF still flags', () => {
    const r = evaluateKycGate({
      direction: 'VERKAUF',
      totalCents: toCents('10.00'),
      customer: pep(null),
    });
    expect(r.thresholdReached).toBe(false);
    expect(r.required).toBe(false);
    expect(r.enhancedDueDiligence).toBe(true);
  });

  it('a non-PEP customer never flags', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('500.00'),
      customer: customer(null),
    });
    expect(r.enhancedDueDiligence).toBe(false);
  });

  it('no customer selected → nothing to flag', () => {
    const r = evaluateKycGate({
      direction: 'ANKAUF',
      totalCents: toCents('500.00'),
      customer: null,
    });
    expect(r.enhancedDueDiligence).toBe(false);
  });
});
