/**
 * validateTransactionMath — per-line sign discipline (dossier D1).
 *
 * The validator's docstring promises sign discipline for "every header & line
 * money", but historically only the header total was checked, so a negative
 * line that nets back to a non-negative header (non-storno), or a positive line
 * inside a storno, slipped through. These tests pin the per-line rule:
 *   • non-storno → every line total >= 0
 *   • storno     → every line total <= 0
 * plus the two valid baselines.
 */
import { describe, expect, it } from 'vitest';

import type { FinalizeBody } from '../../src/schemas/transaction.js';
import { validateTransactionMath } from '../../src/lib/transaction-math.js';

type Line = {
  lineSubtotalEur: string;
  lineVatEur: string;
  lineTotalEur: string;
  marginEur: string | null;
  acquisitionCostEurSnapshot: string | null;
};

function body(opts: {
  storno?: boolean;
  totalEur: string;
  subtotalEur: string;
  vatEur: string;
  items: Line[];
}): FinalizeBody {
  return {
    stornoOfTransactionId: opts.storno ? '00000000-0000-0000-0000-000000000001' : null,
    totalEur: opts.totalEur,
    subtotalEur: opts.subtotalEur,
    vatEur: opts.vatEur,
    items: opts.items,
    payments: [{ amountEur: opts.totalEur }],
  } as unknown as FinalizeBody;
}

const line = (sub: string, vat: string, total: string): Line => ({
  lineSubtotalEur: sub,
  lineVatEur: vat,
  lineTotalEur: total,
  marginEur: null,
  acquisitionCostEurSnapshot: null,
});

describe('validateTransactionMath — per-line sign discipline (D1)', () => {
  it('accepts a normal non-storno sale (all lines non-negative)', () => {
    const err = validateTransactionMath(
      body({ totalEur: '30.00', subtotalEur: '25.21', vatEur: '4.79', items: [line('25.21', '4.79', '30.00')] }),
    );
    expect(err).toBeNull();
  });

  it('rejects a NEGATIVE line inside a non-storno even when the header nets non-negative', () => {
    // line0 = -10 (negative), line1 = +30 → header +20 (passes the header check),
    // but the negative line must be rejected per line.
    const err = validateTransactionMath(
      body({
        totalEur: '20.00',
        subtotalEur: '16.81',
        vatEur: '3.19',
        items: [line('-8.40', '-1.60', '-10.00'), line('25.21', '4.79', '30.00')],
      }),
    );
    expect(err?.field).toBe('items[0].lineTotalEur');
    expect(err?.expected).toBe('>= 0');
  });

  it('accepts a storno with fully negated lines', () => {
    const err = validateTransactionMath(
      body({
        storno: true,
        totalEur: '-30.00',
        subtotalEur: '-25.21',
        vatEur: '-4.79',
        items: [line('-25.21', '-4.79', '-30.00')],
      }),
    );
    expect(err).toBeNull();
  });

  it('rejects a POSITIVE line inside a storno even when the header nets non-positive', () => {
    // line0 = +10 (positive), line1 = -30 → header -20 (passes the header check),
    // but the positive line must be rejected per line.
    const err = validateTransactionMath(
      body({
        storno: true,
        totalEur: '-20.00',
        subtotalEur: '-16.81',
        vatEur: '-3.19',
        items: [line('8.40', '1.60', '10.00'), line('-25.21', '-4.79', '-30.00')],
      }),
    );
    expect(err?.field).toBe('items[0].lineTotalEur');
    expect(err?.expected).toBe('<= 0');
  });
});
