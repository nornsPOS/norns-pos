/**
 * Money-arithmetic validators for POST /transactions/finalize.
 *
 * Pure functions over the validated TypeBox body. Returns `null` on success
 * or a typed `TransactionMathError` on the first failure (Decimal.js, NOT
 * float). The route handler converts the error to HTTP 400 VALIDATION_ERROR
 * with the offending field path.
 *
 * Invariants we check before touching the DB (defensive; the DB CHECK
 * `subtotal + vat = total` is the last line — but failing fast here gives a
 * better error to the client):
 *
 *   1. For each line: line_subtotal + line_vat = line_total.
 *   2. Σ line_total           = header_total.
 *   3. Σ line_subtotal        = header_subtotal.
 *   4. Σ line_vat             = header_vat.
 *   5. Σ payment.amount       = header_total.
 *   6. Sign discipline matches the storno flag:
 *        • no storno_of  → every header & line money ≥ 0.
 *        • storno_of set → every header & line money ≤ 0.
 *   7. For each MARGIN_25A line: acquisition_cost_snapshot + margin must be
 *      consistent with the line totals (Phase 1.5 — V1 just checks both fields
 *      are present together since the DB CHECK enforces that).
 */

import { Money } from '@norns/domain';

import type { FinalizeBody } from '../schemas/transaction.js';
import { pruefeSteuerJeBeleg, pruefeSteuerbetrag } from './steuerbetrag-passt.js';

export interface TransactionMathError {
  field: string;
  message: string;
  expected: string;
  actual: string;
}

const ZERO = Money.zero('EUR');

function add(a: Money, str: string): Money {
  return a.add(Money.of(str));
}

/**
 * Walk the body, return `null` on full agreement, the first error otherwise.
 */
export function validateTransactionMath(body: FinalizeBody): TransactionMathError | null {
  const isStorno = body.stornoOfTransactionId != null;

  const headerTotal = Money.of(body.totalEur);
  const headerSubtotal = Money.of(body.subtotalEur);
  const headerVat = Money.of(body.vatEur);

  // 1 — header invariant (DB CHECK redundancy, but we surface the field path).
  if (!headerSubtotal.add(headerVat).equals(headerTotal)) {
    return {
      field: 'totalEur',
      message: 'subtotal + vat ≠ total',
      expected: headerSubtotal.add(headerVat).toString(),
      actual: headerTotal.toString(),
    };
  }

  // 6 — sign discipline. The DB CHECK `transactions_sign_discipline`
  // enforces the same rule; we duplicate it here so the client sees a
  // field-specific error instead of a generic check_violation.
  const totalRaw = body.totalEur;
  const totalSignNonNeg = !totalRaw.startsWith('-');
  if (!isStorno && !totalSignNonNeg) {
    return {
      field: 'totalEur',
      message: 'Original transaction (no stornoOfTransactionId) must carry non-negative amounts',
      expected: '>= 0',
      actual: totalRaw,
    };
  }
  if (isStorno && totalSignNonNeg && !headerTotal.isZero()) {
    return {
      field: 'totalEur',
      message: 'Storno transaction must carry non-positive amounts',
      expected: '<= 0',
      actual: totalRaw,
    };
  }

  // 2-4 — line sums match header.
  let lineSubtotalSum = ZERO;
  let lineVatSum = ZERO;
  let lineTotalSum = ZERO;
  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i]!;
    const lineSub = Money.of(item.lineSubtotalEur);
    const lineVat = Money.of(item.lineVatEur);
    const lineTotal = Money.of(item.lineTotalEur);

    // ⚠️ Der Betrag muss zum Steuerschluessel passen. Ohne diese Zeilen konnte
    // man `STANDARD_19` mit Satz 0,19 und Steuer 0,00 senden — Kopf und Zeilen
    // stimmten ueberein, die Summe ging auf, und der § 13b-Riegel feuerte nie,
    // weil er nur auf ein WORT hoert. Siehe steuerbetrag-passt.ts.
    const steuerbefund = pruefeSteuerbetrag(item, i);
    if (steuerbefund) return steuerbefund;

    // 1 — per-line invariant (DB CHECK on transaction_items mirrors).
    if (!lineSub.add(lineVat).equals(lineTotal)) {
      return {
        field: `items[${i}].lineTotalEur`,
        message: 'line_subtotal + line_vat ≠ line_total',
        expected: lineSub.add(lineVat).toString(),
        actual: lineTotal.toString(),
      };
    }

    // 6 (per line) — sign discipline, mirroring the header rule (and this
    // validator's docstring, which promises it for every LINE too). The DB
    // CHECK `transactions_sign_discipline` only guards the header, so a negative
    // line that nets back to a non-negative header would otherwise slip through
    // on a non-storno (and vice versa). V1 has no discount/negative-line concept,
    // so this rejects only anomalous input.
    const lineTotalNonNeg = !item.lineTotalEur.startsWith('-');
    if (!isStorno && !lineTotalNonNeg) {
      return {
        field: `items[${i}].lineTotalEur`,
        message: 'Original transaction line must carry a non-negative amount',
        expected: '>= 0',
        actual: item.lineTotalEur,
      };
    }
    if (isStorno && lineTotalNonNeg && !lineTotal.isZero()) {
      return {
        field: `items[${i}].lineTotalEur`,
        message: 'Storno transaction line must carry a non-positive amount',
        expected: '<= 0',
        actual: item.lineTotalEur,
      };
    }

    // 7 — §25a integrity: margin and acquisition_cost must land together
    // (the DB CHECK `transaction_items_margin_implies_acquisition` mirrors).
    const hasCost = item.acquisitionCostEurSnapshot !== null;
    const hasMargin = item.marginEur !== null;
    if (hasCost !== hasMargin) {
      return {
        field: `items[${i}].marginEur`,
        message:
          'margin_eur and acquisition_cost_eur_snapshot must be present together (both NULL or both set)',
        expected: 'both null or both set',
        actual: `acquisitionCostEurSnapshot=${item.acquisitionCostEurSnapshot} marginEur=${item.marginEur}`,
      };
    }

    lineSubtotalSum = lineSubtotalSum.add(lineSub);
    lineVatSum = lineVatSum.add(lineVat);
    lineTotalSum = lineTotalSum.add(lineTotal);
  }

  // ⚠️ Und der massgebliche Riegel: die Steuer des ganzen BELEGS je Satz.
  // § 14 Abs. 4 Nr. 8 UStG meint die Rechnung, nicht die Position — die Kasse
  // rundet deshalb einmal je Beleg und verteilt. Der Zeilenriegel oben lässt
  // dafür zwei Cent; diese Zeile schliesst die Tür, die das offenliesse.
  const belegbefund = pruefeSteuerJeBeleg(body.items);
  if (belegbefund) return belegbefund;

  if (!lineTotalSum.equals(headerTotal)) {
    return {
      field: 'items',
      message: 'Σ items[*].lineTotalEur ≠ totalEur',
      expected: headerTotal.toString(),
      actual: lineTotalSum.toString(),
    };
  }
  if (!lineSubtotalSum.equals(headerSubtotal)) {
    return {
      field: 'items',
      message: 'Σ items[*].lineSubtotalEur ≠ subtotalEur',
      expected: headerSubtotal.toString(),
      actual: lineSubtotalSum.toString(),
    };
  }
  if (!lineVatSum.equals(headerVat)) {
    return {
      field: 'items',
      message: 'Σ items[*].lineVatEur ≠ vatEur',
      expected: headerVat.toString(),
      actual: lineVatSum.toString(),
    };
  }

  // 5 — payments sum match.
  const paymentSum = body.payments.reduce((acc, p) => add(acc, p.amountEur), ZERO);
  if (!paymentSum.equals(headerTotal)) {
    return {
      field: 'payments',
      message: 'Σ payments[*].amountEur ≠ totalEur (split-payment must sum exactly)',
      expected: headerTotal.toString(),
      actual: paymentSum.toString(),
    };
  }

  return null;
}

/**
 * Compare a transaction total against the configured step-up threshold.
 * Returns TRUE when |total| ≥ threshold — the route requires step-up.
 *
 * The absolute value is what matters for storno too: a €5,000 storno is just
 * as sensitive as a €5,000 sale (it impacts the same revenue line).
 */
export function totalExceedsStepUpThreshold(totalEur: string, thresholdEur: string): boolean {
  const total = Money.of(totalEur).abs();
  const threshold = Money.of(thresholdEur);
  return total.greaterThanOrEqual(threshold);
}
