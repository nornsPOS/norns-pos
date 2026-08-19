import { describe, expect, it } from 'vitest';
import {
  classifyCartProductTax,
  computeLineMath,
  sumHeader,
  toCents,
  fromCents,
} from '../../../tauri-pos/src/lib/cart-math.js';

describe('cart-math — toCents & fromCents', () => {
  it('converts decimal strings to cents correctly', () => {
    expect(toCents('100.00')).toBe(10000n);
    expect(toCents('1.99')).toBe(199n);
    expect(toCents('0.00')).toBe(0n);
    expect(toCents('-19.99')).toBe(-1999n);
  });

  it('converts cents back to decimal strings correctly', () => {
    expect(fromCents(10000n)).toBe('100.00');
    expect(fromCents(199n)).toBe('1.99');
    expect(fromCents(0n)).toBe('0.00');
    expect(fromCents(-1999n)).toBe('-19.99');
  });
});

describe('cart-math — classifyCartProductTax', () => {
  it('classifies investment gold (bar >= 99.5% purity) as INVESTMENT_GOLD_25C', () => {
    expect(
      classifyCartProductTax({
        itemType: 'gold_bar',
        finenessDecimal: '0.995',
        acquiredFromCustomerId: null,
        isCommission: false,
      })
    ).toBe('INVESTMENT_GOLD_25C');

    expect(
      classifyCartProductTax({
        itemType: 'gold_bar',
        finenessDecimal: '0.9999',
        acquiredFromCustomerId: 'cust-123',
        isCommission: false,
      })
    ).toBe('INVESTMENT_GOLD_25C');
  });

  it('classifies other gold bars as STANDARD_19', () => {
    expect(
      classifyCartProductTax({
        itemType: 'gold_bar',
        finenessDecimal: '0.900',
        acquiredFromCustomerId: null,
        isCommission: false,
      })
    ).toBe('STANDARD_19');
  });

  it('classifies second-hand watches/antiques/jewelry as MARGIN_25A', () => {
    expect(
      classifyCartProductTax({
        itemType: 'watch',
        finenessDecimal: null,
        acquiredFromCustomerId: 'cust-123',
        isCommission: false,
      })
    ).toBe('MARGIN_25A');

    expect(
      classifyCartProductTax({
        itemType: 'gold_jewelry',
        finenessDecimal: null,
        acquiredFromCustomerId: null,
        isCommission: true,
      })
    ).toBe('MARGIN_25A');
  });

  it('classifies new items or raw materials as STANDARD_19', () => {
    expect(
      classifyCartProductTax({
        itemType: 'watch',
        finenessDecimal: null,
        acquiredFromCustomerId: null,
        isCommission: false,
      })
    ).toBe('STANDARD_19');
  });
});

describe('cart-math — computeLineMath', () => {
  it('computes STANDARD_19 correctly', () => {
    const math = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
    });
    expect(math.lineTotalCents).toBe(11900n);
    expect(math.lineVatCents).toBe(1900n);
    expect(math.lineSubtotalCents).toBe(10000n);
    expect(math.appliedVatRate).toBe('0.1900');
  });

  it('computes REDUCED_7 correctly', () => {
    const math = computeLineMath({
      taxTreatmentCode: 'REDUCED_7',
      listPriceEur: '107.00',
      acquisitionCostEur: '0.00',
    });
    expect(math.lineTotalCents).toBe(10700n);
    expect(math.lineVatCents).toBe(700n);
    expect(math.lineSubtotalCents).toBe(10000n);
    expect(math.appliedVatRate).toBe('0.0700');
  });

  it('computes MARGIN_25A correctly', () => {
    const math = computeLineMath({
      taxTreatmentCode: 'MARGIN_25A',
      listPriceEur: '150.00',
      acquisitionCostEur: '100.00',
    });
    expect(math.lineTotalCents).toBe(15000n);
    expect(math.marginCents).toBe(5000n);
    expect(math.lineVatCents).toBe(798n); // 5000 * 19 / 119 = 798.319... -> 798 cents (banker's rounding)
    expect(math.lineSubtotalCents).toBe(14202n);
    expect(math.appliedVatRate).toBeNull();
  });

  it('computes INVESTMENT_GOLD_25C correctly', () => {
    const math = computeLineMath({
      taxTreatmentCode: 'INVESTMENT_GOLD_25C',
      listPriceEur: '100.00',
      acquisitionCostEur: '0.00',
    });
    expect(math.lineTotalCents).toBe(10000n);
    expect(math.lineVatCents).toBe(0n);
    expect(math.lineSubtotalCents).toBe(10000n);
    expect(math.appliedVatRate).toBeNull();
  });

  it('computes REVERSE_CHARGE_13B (extract net price and 0% VAT) correctly', () => {
    const math = computeLineMath({
      taxTreatmentCode: 'REVERSE_CHARGE_13B',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
    });
    // Customer pays net price: 119 / 1.19 = 100.00
    expect(math.lineTotalCents).toBe(10000n);
    expect(math.lineVatCents).toBe(0n);
    expect(math.lineSubtotalCents).toBe(10000n);
    expect(math.appliedVatRate).toBe('0.0000');
  });
});

describe('cart-math — sumHeader', () => {
  it('sums line totals correctly', () => {
    const line1 = computeLineMath({
      taxTreatmentCode: 'STANDARD_19',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
    });
    const line2 = computeLineMath({
      taxTreatmentCode: 'REVERSE_CHARGE_13B',
      listPriceEur: '119.00',
      acquisitionCostEur: '0.00',
    });

    const sum = sumHeader([line1, line2]);
    expect(sum.totalEur).toBe('219.00'); // 119.00 + 100.00
    expect(sum.subtotalEur).toBe('200.00'); // 100.00 + 100.00
    expect(sum.vatEur).toBe('19.00'); // 19.00 + 0.00
  });
});
