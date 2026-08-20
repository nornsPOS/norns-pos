/**
 * ════════════════════════════════════════════════════════════════════════
 *  Was die Kasse rechnet, muss der Server annehmen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM DIESER TEST ÜBER DIE PAKETGRENZE GREIFT ───────────────────────
 *
 * Die Steuerarithmetik steht an ZWEI Orten:
 *
 *   apps/tauri-pos/src/lib/cart-math.ts       rechnet den Beleg
 *   apps/api-cloud/src/lib/steuerbetrag-passt.ts  nimmt ihn an oder nicht
 *
 * Am 07.08.2026 waren beide für sich genommen richtig und miteinander
 * unvereinbar: die Kasse rundete je Beleg (§ 14 Abs. 4 Nr. 8 UStG), der Server
 * prüfte je Zeile mit einem Cent Spielraum gegen einen UNGERUNDETEN
 * Erwartungswert. Ergebnis, gemessen: **0,314 % aller Zwei-Zeilen-Belege mit
 * 19 % wurden von unserem eigenen Server abgewiesen.** Etwa jeder 320.
 *
 * Für den Händler: alle paar Tage ein gewöhnlicher Verkauf, der nicht
 * abschliesst, ohne Weg daran vorbei — derselbe Warenkorb erzeugt beim zweiten
 * Versuch dieselben Zahlen.
 *
 * Kein Test in einem der beiden Pakete konnte das sehen. Jeder prüfte seine
 * Hälfte, und beide Hälften waren grün. Deshalb greift dieser eine Test über
 * die Grenze und fährt die ECHTE Kassenrechnung gegen den ECHTEN Riegel.
 * Ein Nachbau der einen Seite hätte den Fehler mitgebaut.
 *
 * ── ⚠️ ZWEI RIEGEL, JEDER FÜR SICH AUSREICHEND — UND DAS IST ABSICHT ────
 *
 * Der Fix bestand aus zwei Teilen: gegen den GERUNDETEN Erwartungswert messen,
 * und zwei statt einem Cent je Zeile lassen. Am 07.08.2026 nachgemessen:
 *
 *     nur die Rundung zurückgedreht   → dieser Test bleibt GRÜN
 *     nur den Spielraum zurückgedreht → dieser Test bleibt GRÜN
 *     BEIDE zurückgedreht             → 299 von 40.750 Belegen abgewiesen
 *
 * Jede Hälfte allein schliesst die gemessene Lücke also schon. Wer das für
 * Verschwendung hält und eine davon entfernt, hat danach einen Riegel ohne
 * Reserve: die nächste Änderung an der Kassenrechnung landet direkt auf der
 * Grenze, und der erste, der es merkt, ist ein Kunde an der Theke.
 *
 * Deshalb bleiben beide. Und deshalb steht hier, dass dieser Test das Entfernen
 * einer einzelnen Hälfte NICHT bemerkt — damit niemand sein Grün für einen
 * Freibrief hält.
 */

import { describe, expect, it } from 'vitest';

import { harmonisiereUstJeSatz, type LineMath } from '../../../tauri-pos/src/lib/cart-math.js';
import { pruefeSteuerJeBeleg, pruefeSteuerbetrag } from '../../src/lib/steuerbetrag-passt.js';

/** Ganze Cent als Geldbetrag, ohne Gleitkomma. */
function eur(cents: bigint): string {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

const SAETZE = [
  { code: 'STANDARD_19', rate: '0.1900' },
  { code: 'REDUCED_7', rate: '0.0700' },
] as const;

/** Einen Warenkorb rechnen wie die Kasse und prüfen wie der Server. */
function durchDieKasse(
  bruttoCents: readonly number[],
  satz: (typeof SAETZE)[number],
): string | null {
  const roh = bruttoCents.map(
    (c) =>
      ({
        lineSubtotalCents: 0n,
        lineVatCents: 0n,
        lineTotalCents: BigInt(c),
        appliedVatRate: satz.rate,
        marginCents: null,
      }) as unknown as LineMath,
  );
  const gerechnet = harmonisiereUstJeSatz(roh);
  const zeilen = gerechnet.map((z) => ({
    appliedTaxTreatmentCode: satz.code,
    appliedVatRate: satz.rate,
    lineSubtotalEur: eur(z.lineSubtotalCents),
    lineVatEur: eur(z.lineVatCents),
  }));

  for (let i = 0; i < zeilen.length; i++) {
    const b = pruefeSteuerbetrag(zeilen[i]!, i, TAG);
    if (b) {
      return (
        `${satz.code} ${bruttoCents.map((c) => eur(BigInt(c))).join(' + ')} → Zeile ${i}: ` +
        `Entgelt ${zeilen[i]!.lineSubtotalEur} Steuer ${zeilen[i]!.lineVatEur}, ` +
        `Server verlangt ${b.expected}`
      );
    }
  }
  const belegbefund = pruefeSteuerJeBeleg(zeilen, TAG);
  if (belegbefund) {
    return (
      `${satz.code} ${bruttoCents.map((c) => eur(BigInt(c))).join(' + ')} → ganzer Beleg: ` +
      `${belegbefund.actual} statt ${belegbefund.expected}`
    );
  }
  return null;
}

/**
 * Der Tag, von dem diese Proben sprechen. Seit dem 20.08.2026 nimmt die
 * Prüfung den Satz vom TAG des Belegs; eine Probe muss also sagen, wann ihr
 * Beleg entsteht.
 */
const TAG = '2026-08-20';

describe('⛔ Der Server weist KEINEN Beleg ab, den die Kasse selbst gerechnet hat', () => {
  it('zwei Zeilen, 0,01 bis 500,00 EUR, 19 % und 7 %', () => {
    const abgewiesen: string[] = [];
    let geprueft = 0;
    for (const satz of SAETZE) {
      // Grobes, aber breites Raster: kleine Beträge dicht (dort schlägt die
      // Verteilung am härtesten zu), grosse gestreut.
      for (let a = 1; a <= 50_000; a += a < 200 ? 1 : 337) {
        for (let b = a; b <= 50_000; b += b < 200 ? 3 : 1013) {
          geprueft++;
          const fehler = durchDieKasse([a, b], satz);
          if (fehler && abgewiesen.length < 10) abgewiesen.push(fehler);
          else if (fehler) abgewiesen.push('…');
        }
      }
    }
    expect(geprueft, 'das Raster misst nichts').toBeGreaterThan(20_000);
    expect(
      abgewiesen.slice(0, 10),
      `${abgewiesen.length} von ${geprueft} Belegen abgewiesen:\n  ${abgewiesen.slice(0, 10).join('\n  ')}`,
    ).toEqual([]);
  });

  it('drei bis zwölf Zeilen, stark ungleiche Beträge', () => {
    // Ungleiche Beträge treiben die Verteilung nach grössten Resten am
    // weitesten auseinander — genau dort entstand der Befund.
    const abgewiesen: string[] = [];
    let geprueft = 0;
    for (const satz of SAETZE) {
      for (const anzahl of [3, 4, 5, 8, 12]) {
        for (let s = 0; s < 900; s++) {
          const korb: number[] = [];
          for (let k = 0; k < anzahl; k++) {
            // deterministisch gestreut, ohne Zufall: derselbe Lauf jedes Mal
            korb.push(1 + ((s * 7919 + k * 104729) % 50_000));
          }
          geprueft++;
          const fehler = durchDieKasse(korb, satz);
          if (fehler) abgewiesen.push(abgewiesen.length < 10 ? fehler : '…');
        }
      }
    }
    expect(geprueft).toBeGreaterThan(5_000);
    expect(
      abgewiesen.slice(0, 10),
      `${abgewiesen.length} von ${geprueft} Belegen abgewiesen:\n  ${abgewiesen.slice(0, 10).join('\n  ')}`,
    ).toEqual([]);
  });

  it('⚠️ der Beleg, an dem es zuerst auffiel: 1,28 + 38,84 EUR', () => {
    expect(durchDieKasse([128, 3884], SAETZE[0])).toBeNull();
  });
});
