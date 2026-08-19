import { describe, expect, it } from 'vitest';

import { classifyCartProductTax, computeLineMath, computeTender, fromCents } from './cart-math.js';

/** Product shape `classifyCartProductTax` consumes, with sensible defaults. */
type ClassifyInput = Parameters<typeof classifyCartProductTax>[0];

function product(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    itemType: 'other',
    finenessDecimal: null,
    acquiredFromCustomerId: null,
    isCommission: false,
    ...overrides,
  };
}

describe('classifyCartProductTax — §25c investment gold', () => {
  it('classifies a 99.9% gold bar as INVESTMENT_GOLD_25C', () => {
    expect(
      classifyCartProductTax(product({ itemType: 'gold_bar', finenessDecimal: '0.9990' })),
    ).toBe('INVESTMENT_GOLD_25C');
  });

  it('classifies a ≥90% gold coin minted after 1800 as INVESTMENT_GOLD_25C', () => {
    expect(
      classifyCartProductTax(
        product({ itemType: 'gold_coin', finenessDecimal: '0.9170', yearMintedFrom: 1820 }),
      ),
    ).toBe('INVESTMENT_GOLD_25C');
  });

  it('keeps an investment-grade coin as §25c even when bought second-hand', () => {
    // A modern bullion coin acquired from a private seller is still §25c, not §25a.
    expect(
      classifyCartProductTax(
        product({
          itemType: 'gold_coin',
          finenessDecimal: '0.9999',
          yearMintedFrom: 2015,
          acquiredFromCustomerId: 'cust-1',
        }),
      ),
    ).toBe('INVESTMENT_GOLD_25C');
  });
});

describe('classifyCartProductTax — non-investment gold coins', () => {
  it('falls back to MARGIN_25A for a low-purity second-hand coin', () => {
    expect(
      classifyCartProductTax(
        product({
          itemType: 'gold_coin',
          finenessDecimal: '0.5850', // < 0.90 → not investment grade
          yearMintedFrom: 1900,
          acquiredFromCustomerId: 'cust-1',
        }),
      ),
    ).toBe('MARGIN_25A');
  });

  it('falls back to MARGIN_25A for a pre-1800 second-hand coin (even if pure)', () => {
    expect(
      classifyCartProductTax(
        product({
          itemType: 'gold_coin',
          finenessDecimal: '0.9170',
          yearMintedFrom: 1750, // minted before 1800 → not investment grade
          isCommission: true,
        }),
      ),
    ).toBe('MARGIN_25A');
  });

  it('falls back to STANDARD_19 for a pre-1800 coin that is NOT second-hand', () => {
    expect(
      classifyCartProductTax(
        product({ itemType: 'gold_coin', finenessDecimal: '0.9170', yearMintedFrom: 1750 }),
      ),
    ).toBe('STANDARD_19');
  });

  it('falls back to STANDARD_19 for a coin with no minting year recorded', () => {
    expect(
      classifyCartProductTax(
        product({ itemType: 'gold_coin', finenessDecimal: '0.9999', yearMintedFrom: null }),
      ),
    ).toBe('STANDARD_19');
  });
});

describe('classifyCartProductTax — §25a margin scheme', () => {
  it('classifies a second-hand watch bought from a private seller as MARGIN_25A', () => {
    expect(
      classifyCartProductTax(product({ itemType: 'watch', acquiredFromCustomerId: 'cust-1' })),
    ).toBe('MARGIN_25A');
  });

  it('classifies a commission item as MARGIN_25A', () => {
    expect(classifyCartProductTax(product({ itemType: 'antique', isCommission: true }))).toBe(
      'MARGIN_25A',
    );
  });
});

describe('computeLineMath — Rabatt (line discount)', () => {
  it('applies a discount on the net price and reports the amount (STANDARD_19)', () => {
    // 119.00 list, 19.00 off → 100.00 net; VAT = 100 × 19/119 = 15.97.
    const m = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
      discountEur: '19.00',
    });
    expect(fromCents(m.lineTotalCents)).toBe('100.00');
    expect(fromCents(m.lineVatCents)).toBe('15.97');
    expect(fromCents(m.lineDiscountCents)).toBe('19.00');
  });

  it('treats no discount as zero', () => {
    const m = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
    });
    expect(m.lineDiscountCents).toBe(0n);
    expect(fromCents(m.lineTotalCents)).toBe('119.00');
  });

  it('clamps a discount larger than the list price to the list price (net = 0)', () => {
    const m = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '50.00',
      acquisitionCostEur: '0.00',
      discountEur: '999.00',
    });
    expect(fromCents(m.lineTotalCents)).toBe('0.00');
    expect(fromCents(m.lineDiscountCents)).toBe('50.00');
  });

  it('reduces the §25a margin when the net price drops below cost (VAT floors at 0)', () => {
    // list 200, cost 180 → margin 20; with 30 off, net 170 < cost → margin 0, VAT 0.
    const m = computeLineMath({
      taxTreatmentCode: 'MARGIN_25A',
      listPriceEur: '200.00',
      acquisitionCostEur: '180.00',
      discountEur: '30.00',
    });
    expect(fromCents(m.lineTotalCents)).toBe('170.00');
    expect(m.marginCents).toBe(0n);
    expect(fromCents(m.lineVatCents)).toBe('0.00');
    expect(fromCents(m.lineDiscountCents)).toBe('30.00');
  });
});

describe('computeTender — voucher + cash split', () => {
  const T = (eur: number) => BigInt(Math.round(eur * 100));

  it('no voucher: full total due in cash, change on overpay', () => {
    const r = computeTender({ totalCents: T(50), voucherBalanceCents: null, cashCents: T(60) });
    expect(r.appliedVoucherCents).toBe(0n);
    expect(fromCents(r.dueCents)).toBe('50.00');
    expect(r.cashCovered).toBe(true);
    expect(fromCents(r.changeCents)).toBe('10.00');
  });

  it('partial voucher: cash covers the remainder', () => {
    // total 50, voucher 20 → due 30; pay 30 cash → change 0.
    const r = computeTender({ totalCents: T(50), voucherBalanceCents: T(20), cashCents: T(30) });
    expect(fromCents(r.appliedVoucherCents)).toBe('20.00');
    expect(fromCents(r.dueCents)).toBe('30.00');
    expect(r.cashCovered).toBe(true);
    expect(fromCents(r.changeCents)).toBe('0.00');
  });

  it('voucher larger than total is capped at the total (no negative cash due)', () => {
    const r = computeTender({ totalCents: T(50), voucherBalanceCents: T(80), cashCents: 0n });
    expect(fromCents(r.appliedVoucherCents)).toBe('50.00');
    expect(r.dueCents).toBe(0n);
    expect(r.cashCovered).toBe(true);
    expect(r.changeCents).toBe(0n);
  });

  it('insufficient cash after voucher is not covered', () => {
    const r = computeTender({ totalCents: T(50), voucherBalanceCents: T(20), cashCents: T(10) });
    expect(fromCents(r.dueCents)).toBe('30.00');
    expect(r.cashCovered).toBe(false);
    expect(r.changeCents).toBe(0n);
  });
});

describe('classifyCartProductTax — STANDARD_19 fallback', () => {
  it('classifies industrial/scrap gold (not second-hand, sub-investment) as STANDARD_19', () => {
    expect(
      classifyCartProductTax(product({ itemType: 'gold_bar', finenessDecimal: '0.3330' })),
    ).toBe('STANDARD_19');
  });

  it('classifies a brand-new (first-hand) eligible item as STANDARD_19', () => {
    // A watch the shop bought new from a wholesaler: eligible TYPE, but not
    // second-hand → no §25a margin scheme.
    expect(classifyCartProductTax(product({ itemType: 'watch' }))).toBe('STANDARD_19');
  });
});
