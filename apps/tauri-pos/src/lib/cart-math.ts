/**
 * cart-math — pure bigint-cents math for the Verkauf cart.
 *
 * The server (`apps/api-cloud/src/lib/transaction-math.ts`) re-validates
 * every number with Decimal.js, so anything we send here must match. Rules:
 *
 *   STANDARD_19       vat = total × 19 / 119 (round HALF_EVEN to cents)
 *                     subtotal = total - vat
 *   REDUCED_7         vat = total × 7  / 107
 *                     subtotal = total - vat
 *   MARGIN_25A        margin = max(0, listPrice - acquisitionCost)
 *                     vat    = margin × 19 / 119  (NEVER negative — if cost
 *                              exceeds price, the operator priced below cost
 *                              and the §25a vat is zero by law)
 *                     subtotal = total - vat
 *   INVESTMENT_GOLD_25C  vat = 0; subtotal = total = listPrice
 *
 * Rounding: HALF_EVEN (banker's rounding) to match memory.md #41. We use
 * the "round-half-even on cents from full integer math" trick to avoid
 * Decimal.js as a client-side dep.
 */

import type { TaxTreatmentCode } from '@norns/api-client';
import { alsTag, bruttoBruch, satzAm } from '@norns/domain';
// The bigint-cents primitives live in one canonical module (money-core). They
// were previously copy-pasted here; cart-math re-exports them so its public API
// (toCents / fromCents) is unchanged for every import site.
import { centsAusEingabe, fromCents, roundHalfEven, toCents } from './money-core.js';

export { centsAusEingabe, fromCents, toCents };

// ────────────────────────────────────────────────────────────────────────
// Discount math (percent → EUR; invoice-discount distribution).
//
// Money: bigint-cents, HALF_EVEN, capped, Σ-EXACT (no rounding drift). The
// per-line TAX math (computeLineMath) is REUSED — these only produce the
// discountEur it consumes.
// ────────────────────────────────────────────────────────────────────────

/** Discount cents from a percentage of `baseCents`, HALF_EVEN, clamped to [0, base]. */
export function percentToEur(baseCents: bigint, pct: number): bigint {
  if (baseCents <= 0n || !Number.isFinite(pct) || pct <= 0) return 0n;
  const pctBp = BigInt(Math.round(pct * 100)); // basis points: 10% → 1000
  if (pctBp <= 0n) return 0n;
  let d = roundHalfEven(baseCents * pctBp, 10_000n);
  if (d < 0n) d = 0n;
  if (d > baseCents) d = baseCents;
  return d;
}

/**
 * Distribute a total invoice discount across line bases proportionally, using
 * the largest-remainder method so Σ(shares) === min(totalCents, Σbases) EXACTLY
 * (no drift) and no share exceeds its own base.
 */
export function distributeInvoiceDiscount(bases: readonly bigint[], totalCents: bigint): bigint[] {
  const n = bases.length;
  if (n === 0) return [];
  const totalBase = bases.reduce((acc, b) => acc + (b > 0n ? b : 0n), 0n);
  if (totalBase <= 0n || totalCents <= 0n) return bases.map(() => 0n);

  const target = totalCents > totalBase ? totalBase : totalCents;
  const shares = new Array<bigint>(n);
  const remainders = new Array<bigint>(n);
  let allocated = 0n;
  for (let i = 0; i < n; i++) {
    const b = (bases[i] as bigint) > 0n ? (bases[i] as bigint) : 0n;
    const num = b * target;
    const floor = num / totalBase;
    shares[i] = floor;
    remainders[i] = num - floor * totalBase;
    allocated += floor;
  }

  let leftover = target - allocated; // ∈ [0, n)
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const ra = remainders[a] as bigint;
    const rb = remainders[b] as bigint;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return a - b; // tie → lower index
  });
  for (let k = 0; k < order.length && leftover > 0n; k++) {
    const idx = order[k] as number;
    shares[idx] = (shares[idx] as bigint) + 1n;
    leftover -= 1n;
  }
  return shares;
}

// ────────────────────────────────────────────────────────────────────────
// Per-line tax breakdown
// ────────────────────────────────────────────────────────────────────────

export interface LineMath {
  /** Header line_total — what the customer pays for this row. */
  lineTotalCents: bigint;
  /** Decomposed VAT inside that total. */
  lineVatCents: bigint;
  /** lineTotal - lineVat. */
  lineSubtotalCents: bigint;
  /** For §25a: the margin component (NULL otherwise). */
  marginCents: bigint | null;
  /** The decimal VAT rate (e.g. "0.1900") or null for §25a/§25c. */
  appliedVatRate: string | null;
  /** Snapshot of acquisition cost (only for §25a). */
  acquisitionCostSnapshotCents: bigint | null;
  /** Rabatt knocked off this line (≥ 0). GoBD-reported separately. */
  lineDiscountCents: bigint;
}

export function computeLineMath(params: {
  taxTreatmentCode: TaxTreatmentCode;
  listPriceEur: string;
  acquisitionCostEur: string;
  /** Rabatt to knock off the list price before tax. Clamped to [0, listPrice]. */
  discountEur?: string | undefined;
  /**
   * Der Geschäftstag, an dem dieser Verkauf entsteht (`JJJJ-MM-TT`).
   *
   * ── WARUM ES EINEN VORGABEWERT GIBT, UND WARUM DAS HIER GEHT ────────────
   *
   * Ein stiller Vorgabewert ist meistens die Stelle, an der sich ein Fehler
   * versteckt. Hier ist er vertretbar, und zwar aus einem gemessenen Grund:
   * die Kasse rechnet NUR für Verkäufe, die gerade entstehen. Ein Storno
   * rechnet sie nicht — er spiegelt die Zeilen des Ursprungsbelegs, und der
   * Satz kommt dort aus der gebuchten Zeile (`transactions-storno.ts`).
   * Gemessen am 20.08.2026: keine Storno- oder Rückgabefläche ruft diese
   * Funktion.
   *
   * Der Vorgabewert rechnet ausserdem in DEUTSCHER Ortszeit (`alsTag`), nicht
   * über UTC — sonst fiele ein Verkauf um 00:30 Sommerzeit auf den Vortag,
   * und an einer Satzgrenze wäre das der falsche Satz.
   */
  tag?: string;
}): LineMath {
  const listTotal = toCents(params.listPriceEur);
  let discount = params.discountEur ? toCents(params.discountEur) : 0n;
  if (discount < 0n) discount = 0n;
  if (discount > listTotal) discount = listTotal;

  // Tax is computed on the NET (post-discount) price; the discount amount is
  // carried alongside for the receipt + GoBD reporting (line_discount_eur).
  const breakdown = computeTaxBreakdown(
    params.taxTreatmentCode,
    listTotal - discount,
    toCents(params.acquisitionCostEur),
    params.tag ?? alsTag(new Date()),
  );
  return { ...breakdown, lineDiscountCents: discount };
}

/**
 * Die Steuer einer Zeile.
 *
 * ── DER SATZ KOMMT VOM TAG (20.08.2026, Basels Prüfbericht) ────────────────
 *
 * Hier standen `19n/119n`, `7n/107n` und die Zeichenketten `'0.1900'`,
 * `'0.0700'` fest im Quelltext. Am Tag einer Gesetzesänderung wäre die Kasse
 * damit entweder für neue Verkäufe unbrauchbar oder für alte Belege — beides
 * Betriebsstillstand. Der Satz kommt jetzt aus `@norns/domain`, und der
 * ENGINE prüft mit demselben Verzeichnis gegen denselben Tag.
 *
 * @param tag Der Geschäftstag, an dem dieser Verkauf entsteht.
 */
function computeTaxBreakdown(
  taxTreatmentCode: TaxTreatmentCode,
  total: bigint,
  cost: bigint,
  tag: string,
): Omit<LineMath, 'lineDiscountCents'> {
  switch (taxTreatmentCode) {
    case 'STANDARD_19': {
      const satz = satzAm('REGEL', tag);
      const { zaehler, nenner } = bruttoBruch(satz);
      const vat = roundHalfEven(total * zaehler, nenner);
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: null,
        appliedVatRate: satz,
        acquisitionCostSnapshotCents: null,
      };
    }
    case 'REDUCED_7': {
      const satz = satzAm('ERMAESSIGT', tag);
      const { zaehler, nenner } = bruttoBruch(satz);
      const vat = roundHalfEven(total * zaehler, nenner);
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: null,
        appliedVatRate: satz,
        acquisitionCostSnapshotCents: null,
      };
    }
    case 'MARGIN_25A': {
      // Margin is non-negative — a below-cost sale produces zero VAT (the
      // shop took a loss; the Finanzamt doesn't pay VAT back).
      const rawMargin = total - cost;
      const margin = rawMargin < 0n ? 0n : rawMargin;
      // § 25a besteuert die MARGE mit dem REGELSATZ — also demselben Satz wie
      // ein gewöhnlicher Verkauf, nur auf einer anderen Grundlage.
      const { zaehler, nenner } = bruttoBruch(satzAm('REGEL', tag));
      const vat = roundHalfEven(margin * zaehler, nenner);
      return {
        lineTotalCents: total,
        lineVatCents: vat,
        lineSubtotalCents: total - vat,
        marginCents: margin,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: cost,
      };
    }
    case 'INVESTMENT_GOLD_25C':
      return {
        lineTotalCents: total,
        lineVatCents: 0n,
        lineSubtotalCents: total,
        marginCents: null,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: null,
      };
    case 'REVERSE_CHARGE_13B': {
      /*
       * ⛔ HIER STAND `roundHalfEven(total * 100n, 119n)` (bis 21.08.2026).
       *
       * Am 20.08. wurden die festen Sätze an vier Stellen durch `satzAm`
       * ersetzt. Diese eine Zeile hat die Umstellung übersehen — jeder
       * Nachbarfall in derselben Verzweigung fragt längst das Verzeichnis,
       * nur der Reverse-Charge rechnete weiter mit fest verdrahteten 19 %.
       *
       * ⚠️ WARUM ES AUSGERECHNET HIER AM MEISTEN WEHTUT: beim § 13b weist der
       * Verkäufer KEINE Steuer aus — der Käufer schuldet sie und rechnet sie
       * sich selbst auf das NETTO. Ist das Netto falsch, ist die Steuerschuld
       * des KÄUFERS falsch, und auf dem Beleg steht keine Steuer, an der es
       * jemandem auffallen könnte.
       *
       * Gemessen: 1.190,00 EUR brutto im Corona-Halbjahr 2020 ergaben 1.000,00
       * statt 1.025,86 EUR — 25,86 EUR zu wenig, still, auf jedem Beleg.
       */
      const { zaehler, nenner } = bruttoBruch(satzAm('REGEL', tag));
      // Netto = Brutto − Steueranteil. Derselbe Bruch wie überall sonst,
      // damit hier keine zweite Rechnung entsteht.
      const subtotal = total - roundHalfEven(total * zaehler, nenner);
      return {
        lineTotalCents: subtotal,
        lineVatCents: 0n,
        lineSubtotalCents: subtotal,
        marginCents: null,
        appliedVatRate: '0.0000',
        acquisitionCostSnapshotCents: null,
      };
    }
    default:
      return {
        lineTotalCents: total,
        lineVatCents: 0n,
        lineSubtotalCents: total,
        marginCents: null,
        appliedVatRate: null,
        acquisitionCostSnapshotCents: null,
      };
  }
}

export function classifyCartProductTax(product: {
  itemType: string;
  finenessDecimal: string | null;
  acquiredFromCustomerId: string | null;
  isCommission: boolean;
  yearMintedFrom?: number | null;
  /**
   * Der am Produkt HINTERLEGTE Steuerschlüssel.
   *
   * ⚠️ Er hat Vorrang, und der Grund ist ein gemessener Fehler, kein
   * Geschmack. Siehe unten.
   */
  taxTreatmentCode?: string | null;
}): TaxTreatmentCode {
  // ══════════════════════════════════════════════════════════════════════
  //  DER HINTERLEGTE SCHLÜSSEL GEWINNT
  // ══════════════════════════════════════════════════════════════════════
  //
  // Am 26.07.2026 an der Produktion gemessen:
  //
  //     MARGIN_25A          60 Stück   davon mit Verkäufer: 0   Kommission: 0
  //     STANDARD_19         47 Stück   davon mit Verkäufer: 0   Kommission: 0
  //     INVESTMENT_GOLD_25C  8 Stück   davon mit Verkäufer: 0   Kommission: 0
  //
  // Die Ableitung unten verlangt `acquiredFromCustomerId !== null ||
  // isCommission`. Beides ist bei ALLEN 115 Stücken leer. Also fiel jedes
  // einzelne der 60 als § 25a angelegten Stücke durch bis auf `STANDARD_19` —
  // und die Kasse berechnete 19 Prozent auf den VOLLEN Bruttopreis statt
  // 19/119 auf die Marge.
  //
  // Was das in Euro heisst, an echten Stücken gerechnet:
  //
  //     Goldmünze  VK 270,00  EK 250,00   →  43,11 € statt 3,19 €
  //     Silberschmuck VK 220,00 EK 199,00 →  35,13 € statt 3,35 €
  //
  // Bei einer Rohmarge von 21,00 EUR wäre der zweite Verkauf ein
  // Verlustgeschäft — der Händler zahlt mehr Steuer, als er verdient hat.
  //
  // Der hinterlegte Schlüssel entsteht beim ANKAUF, wo der Verkäufer bekannt
  // ist und die Entscheidung getroffen wurde. Ihn später aus Hilfsmerkmalen
  // neu zu erraten, wirft genau diese Entscheidung weg.
  //
  // Die mobile Kasse macht es längst richtig (`verkauf-flow.ts:74`); nur diese
  // hier nicht.
  const hinterlegt = product.taxTreatmentCode;
  if (
    hinterlegt === 'MARGIN_25A' ||
    hinterlegt === 'INVESTMENT_GOLD_25C' ||
    hinterlegt === 'STANDARD_19' ||
    hinterlegt === 'REDUCED_7'
  ) {
    return hinterlegt;
  }
  // Ohne hinterlegten Schlüssel wird abgeleitet — für Ware, die nie durch
  // einen Ankauf lief.
  const purity = product.finenessDecimal ? Number.parseFloat(product.finenessDecimal) : 0;

  // §25c investment gold — bars at ≥ 99.5% fineness. Checked first so an
  // investment-grade piece is NEVER mis-classified as a §25a margin item.
  if (product.itemType === 'gold_bar' && purity >= 0.995) {
    return 'INVESTMENT_GOLD_25C';
  }
  // §25c investment gold — coins at ≥ 90.0% fineness minted after 1800 (the
  // BMF "modern bullion coin" test). A second-hand investment coin is still
  // §25c, so this precedes the margin-scheme fallback below.
  if (
    product.itemType === 'gold_coin' &&
    purity >= 0.9 &&
    typeof product.yearMintedFrom === 'number' &&
    product.yearMintedFrom >= 1800
  ) {
    return 'INVESTMENT_GOLD_25C';
  }

  const isSecondHand = product.acquiredFromCustomerId !== null || product.isCommission;
  const isSecondHandEligibleType = [
    'gold_jewelry',
    'gold_coin',
    'silver_jewelry',
    'silver_coin',
    'platinum_jewelry',
    'platinum_coin',
    'antique',
    'watch',
  ].includes(product.itemType);

  if (isSecondHand && isSecondHandEligibleType) {
    return 'MARGIN_25A';
  }

  return 'STANDARD_19';
}

// ────────────────────────────────────────────────────────────────────────
// Header totals — sum of line totals (with HALF_EVEN we don't lose cents).
// ────────────────────────────────────────────────────────────────────────

export interface HeaderTotals {
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
}

// ────────────────────────────────────────────────────────────────────────
// Tender split — voucher + cash (Phase C2). A voucher covers up to the full
// total; the cash leg pays the remainder; change is computed on the remainder.
// ────────────────────────────────────────────────────────────────────────

export interface TenderSplit {
  /** Voucher amount actually applied (≤ total, ≤ balance, ≥ 0). */
  appliedVoucherCents: bigint;
  /** Amount still due after the voucher (paid in cash). */
  dueCents: bigint;
  /** Change to hand back (0 when cash doesn't yet cover the due). */
  changeCents: bigint;
  /** True once the cash received covers the post-voucher due. */
  cashCovered: boolean;
}

export function computeTender(params: {
  totalCents: bigint;
  /** null when no voucher is applied. */
  voucherBalanceCents: bigint | null;
  cashCents: bigint;
}): TenderSplit {
  const { totalCents, voucherBalanceCents, cashCents } = params;
  let applied = 0n;
  if (voucherBalanceCents !== null && voucherBalanceCents > 0n) {
    applied = voucherBalanceCents >= totalCents ? totalCents : voucherBalanceCents;
  }
  const dueCents = totalCents - applied;
  const cashCovered = cashCents >= dueCents;
  const changeCents = cashCovered ? cashCents - dueCents : 0n;
  return { appliedVoucherCents: applied, dueCents, changeCents, cashCovered };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE UMSATZSTEUER GEHÖRT AUF DEN BELEG, NICHT AUF DIE ZEILE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `computeLineMath` rundet je ZEILE. Fünf Stücke mit je 20,00 EUR Marge
 * ergeben dann fünfmal 3,19, zusammen 15,95. Der Buchungsstapel fasst dieselben
 * fünf Zeilen zu EINER Buchung über 100,00 EUR zusammen, und DATEV rechnet
 * daraus 15,97.
 *
 * Zwei Cent. Ein Prüfer stellt aber genau das gegenüber: den Buchungsstapel je
 * Erlöskonto gegen die DSFinV-K je Steuerbehandlung. Auf Romans Produktion
 * gemessen sind es 0,05 EUR über 8 Belege — klein, aber es ist eine
 * Abweichung, wo keine sein darf.
 *
 * ── Welche Zahl ist die richtige ────────────────────────────────────────
 *
 * § 14 Abs. 4 Nr. 8 UStG verlangt den Steuerbetrag für die RECHNUNG, je
 * Steuersatz. Nicht je Position. Die zusammengefasste Rechnung ist also die
 * gesetzlich massgebliche, und die Zeilenaufteilung ist eine Aufgliederung.
 *
 * Deshalb: EINMAL je Beleg und Satz runden, dann auf die Zeilen verteilen —
 * nach grössten Resten, damit die Summe der Zeilen exakt den Belegbetrag
 * ergibt. Dieselbe Regel, die schon `datev-kontierung.ts` benutzt, um Zahlarten
 * und Behandlungen zu kreuzen.
 *
 * ⚠️ Was dabei UNANGETASTET bleibt: `lineTotalCents`. Der Kunde zahlt für
 * jede Zeile genau das, was auf dem Preisschild stand. Verschoben wird nur die
 * Aufteilung INNERHALB der Zeile zwischen Netto und Steuer.
 */
function verteileNachGroesstenResten(
  gewichte: readonly bigint[],
  gewichtSumme: bigint,
  ziel: bigint,
): bigint[] {
  if (gewichtSumme === 0n) return gewichte.map(() => 0n);
  const anteile = gewichte.map((g) => (ziel * g) / gewichtSumme);
  const reste = gewichte.map((g, i) => ziel * g - (anteile[i] as bigint) * gewichtSumme);
  let offen = ziel - anteile.reduce((a, b) => a + b, 0n);
  const richtung = offen < 0n ? -1n : 1n;
  while (offen !== 0n) {
    let best = 0;
    for (let i = 1; i < reste.length; i++) {
      const besser = richtung > 0n
        ? (reste[i] as bigint) > (reste[best] as bigint)
        : (reste[i] as bigint) < (reste[best] as bigint);
      if (besser) best = i;
    }
    anteile[best] = (anteile[best] as bigint) + richtung;
    reste[best] = (reste[best] as bigint) - richtung * gewichtSumme;
    offen -= richtung;
  }
  return anteile;
}

/**
 * Die Steuer eines Warenkorbs je Steuersatz EINMAL runden und zurückverteilen.
 *
 * Rein: keine Uhr, kein Netz. Gibt eine neue Liste zurück, die Eingabe bleibt
 * unberührt.
 */
export function harmonisiereUstJeSatz(lines: readonly LineMath[]): LineMath[] {
  // Gruppen: gleicher Satz UND gleiche Bemessungsgrundlage-Art. `null` als
  // Satz heisst Sonderregelung (§ 25a, § 25c) — dort ist die Steuer entweder
  // null oder folgt der Marge, und die Marge ist die Grundlage.
  /*
   * ── ⛔ § 25a: EINZELDIFFERENZ, ENTSCHIEDEN AM 12.08.2026 ─────────────────
   *
   * Bis heute wurden die Margenzeilen eines Belegs GEBUENDELT: die Steuer
   * entstand auf der Summe der Margen und wurde zurueckverteilt. Das ist
   * weder Einzel- noch Gesamtdifferenz, sondern ein Beleg-weites Mittelding.
   *
   * § 25a Abs. 3 UStG rechnet je GEGENSTAND. Die Gesamtdifferenz nach Abs. 4
   * gilt nur fuer Gegenstaende bis 750 EUR Einkaufspreis und nur nach
   * ausgeuebtem Wahlrecht — fuer einen Goldhaendler, dessen Stuecke regelmaessig
   * darueber liegen, kommt sie nicht in Frage. Der Inhaber hat am 12.08.2026
   * die Einzeldifferenz festgelegt; die Frage an den Steuerberater bleibt als
   * Bestaetigung im Brief (docs/fiskal/fragen-an-den-steuerberater.md, Nr. 7).
   *
   * KONKRET heisst das: jede § 25a-Zeile behaelt die Steuer, die
   * `computeTaxBreakdown` je STUECK gerechnet hat — Marge auf null gedeckelt
   * (ein Verlust erzeugt keine negative Steuer und mindert KEIN anderes
   * Stueck), Steuer je Stueck einzeln gerundet. Gemessen am Unterschied:
   * zwei Stuecke mit je 3,10 EUR Marge ergeben einzeln 49 + 49 = 98 Cent;
   * gebuendelt waeren es 99. Der eine Cent ist der Unterschied zwischen
   * Einzeldifferenz und Buendelung, und er gehoert dem Gesetz, nicht der
   * Rundung.
   *
   * Harmonisiert werden nur noch die REGELSAETZE (19 und 7 Prozent), deren
   * Bemessung der Bruttobetrag ist.
   */
  const gruppen = new Map<string, number[]>();

  lines.forEach((l, i) => {
    // § 25a und § 25c tragen `appliedVatRate: null` und bleiben je STUECK
    // (Einzeldifferenz, siehe oben). Nur echte Saetze werden gebuendelt.
    if (l.appliedVatRate === null) return;
    const schluessel = l.appliedVatRate;
    const g = gruppen.get(schluessel);
    if (g) g.push(i);
    else gruppen.set(schluessel, [i]);
  });

  const raus = lines.map((l) => ({ ...l }));

  for (const [schluessel, indizes] of gruppen) {
    if (indizes.length < 2) continue; // eine Zeile: nichts zu harmonisieren

    // Die Grundlage: bei § 25a die Marge, sonst der Bruttobetrag.
    const grundlagen = indizes.map((i) => (lines[i] as LineMath).lineTotalCents);
    const summe = grundlagen.reduce((a, b) => a + b, 0n);

    /*
     * Der Satz als Bruch, aus dem BRUTTO herausgerechnet.
     *
     * ⚠️ 20.08.2026, beim Umbau auf datumsabhängige Sätze gefunden: hier
     * stand eine Fallunterscheidung auf GENAU zwei Zeichenketten, und alles
     * andere fiel auf `[0n, 1n]` — also `continue`, also gar keine
     * Harmonisierung.
     *
     * Bei 19 und 7 Prozent fiel das nie auf. Ein Beleg aus dem Corona-
     * Halbjahr 2020 trägt aber 16 oder 5 Prozent: dort wäre die Steuer je
     * Zeile einzeln gerundet geblieben, die Belegsumme hätte um einen Cent
     * danebengelegen, und der Riegel des Motors (`pruefeSteuerJeBeleg`)
     * hätte den Beleg abgewiesen — mit einem Kunden davor.
     *
     * `bruttoBruch` kann JEDEN Satz. Die Sonderregelungen ohne Satz sind
     * schon oben ausgesiebt (`appliedVatRate === null`).
     */
    const { zaehler, nenner } = bruttoBruch(schluessel);
    if (zaehler === 0n) continue;

    const zielUst = roundHalfEven(summe * zaehler, nenner);
    const verteilt = verteileNachGroesstenResten(grundlagen, summe, zielUst);

    indizes.forEach((i, k) => {
      const z = raus[i] as LineMath;
      const neueUst = verteilt[k] as bigint;
      z.lineVatCents = neueUst;
      // ⚠️ Der Bruttobetrag bleibt. Nur die Naht zwischen Netto und Steuer
      // wandert — sonst zahlte der Kunde plötzlich einen anderen Preis.
      z.lineSubtotalCents = z.lineTotalCents - neueUst;
    });
  }

  return raus;
}

export function sumHeader(lines: readonly LineMath[]): HeaderTotals {
  let sub = 0n;
  let vat = 0n;
  let tot = 0n;
  for (const l of lines) {
    sub += l.lineSubtotalCents;
    vat += l.lineVatCents;
    tot += l.lineTotalCents;
  }
  return {
    subtotalEur: fromCents(sub),
    vatEur: fromCents(vat),
    totalEur: fromCents(tot),
  };
}
