/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Tagespreis erreicht AUCH den B2B-Weg
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER FUND VOM 20.08.2026 (bei der Nachprüfung der eigenen Arbeit) ───────
 *
 * Am selben Tag hatte ich den Korb auf den Tagespreis umgestellt: die Karte
 * rechnet die Preise kursgebundener Stücke aus dem laufenden Metallkurs,
 * statt den Lagerpreis zu buchen, den vorher niemand täglich nachtrug.
 *
 * Die Umstellung sass an EINER Naht (`CartPanel`): `geltendeZeilen` trägt den
 * Tagespreis, `perLine` rechnet daraus, und der Bezahlen-Weg bekommt die
 * fertigen Beträge über `perLineMath`. Auf dem gewöhnlichen Weg stimmte
 * damit alles.
 *
 * ⚠️ Der Bezahlen-Weg nimmt aber NICHT immer die fertigen Beträge. Wechselt
 * die Steuerart — B2B, § 13b Reverse Charge —, rechnet er die Zeile NEU:
 *
 *     computeLineMath({ taxTreatmentCode: actualTaxCode,
 *                       listPriceEur: line.listPriceEur, … })
 *
 * und dieses `line` kam aus der Angabe `lines`. `CartPanel` reichte dort die
 * ROHEN Zeilen durch — mit dem GESPEICHERTEN Preis.
 *
 * Ein B2B-Verkauf eines kursgebundenen Stücks hätte also weiter zum alten
 * Lagerpreis gebucht. Genau der Fehler, den der Tagespreis beseitigen
 * sollte, nur auf einem selteneren Weg versteckt — und darum umso länger
 * unentdeckt. Beim gefundenen Beispiel lagen 1158,16 € gespeichert gegen
 * 160,93 € Tageswert; das ist kein Rundungsfehler.
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 * Dass der Bezahlen-Weg DIESELBEN Zeilen bekommt, aus denen auch gerechnet
 * wurde. Eine Naht, die nur die Beträge umstellt und die Zeilen vergisst,
 * lässt jeden Weg zurückfallen, der aus den Zeilen NEU rechnet.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const KORB = readFileSync(join(HIER, 'CartPanel.tsx'), 'utf8');
const BEZAHLEN = readFileSync(join(HIER, 'BezahlenDialog.tsx'), 'utf8');

/** Der Quelltext ohne Kommentare — sonst misst der Wächter seine Begründung. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('⛔ Der Tagespreis erreicht auch den B2B-Weg', () => {
  const korb = ohneKommentare(KORB);

  it('die Bühne steht — sonst prüft der Wächter Luft', () => {
    expect(korb).toContain('geltendeZeilen');
    expect(korb).toContain('<BezahlenDialog');
  });

  it('⛔ der Bezahlen-Weg bekommt die Zeilen MIT Tagespreis', () => {
    const naht = korb.slice(korb.indexOf('<BezahlenDialog'));
    expect(
      /lines=\{geltendeZeilen\}/.test(naht),
      'Der Bezahlen-Weg bekommt die rohen Zeilen mit dem GESPEICHERTEN Preis. ' +
        'Wechselt die Steuerart (B2B, § 13b), rechnet er die Zeile daraus NEU ' +
        'und bucht den alten Lagerpreis.',
    ).toBe(true);
    expect(/lines=\{lines\}/.test(naht)).toBe(false);
  });

  it('⛔ KEINE Geldstelle bekommt die rohen Zeilen', () => {
    /*
     * ── DER ZWEITE FUND, DURCH EINEN VERSEHEN GEFUNDEN ───────────────────
     *
     * Beim Rot-Beweis habe ich versehentlich die falsche Stelle
     * zurückgestellt — und dabei gesehen, dass `InvoiceDiscount` DIESELBE
     * Angabe roh bekam. Der rechnet aus `listPriceEur` die Grundlage, auf
     * die ein Rabatt für den ganzen Korb verteilt wird.
     *
     * Mit dem gespeicherten Preis (1158,16) statt dem Tageswert (160,93)
     * bekäme diese eine Zeile das Siebenfache des Rabatts, den ihr zusteht,
     * und alle anderen entsprechend zu wenig.
     *
     * Es reicht also NICHT, die eine Naht zu kennen. Jede Stelle, die
     * Zeilen für eine Geldrechnung weiterreicht, muss die geltenden
     * bekommen — dieser Satz zählt sie.
     */
    const uebergaben = [...korb.matchAll(/lines=\{(\w+)\}/g)].map((m) => m[1]);
    expect(uebergaben.length, 'keine Übergabe gefunden — der Wächter misst Luft').toBeGreaterThan(
      1,
    );
    expect(
      uebergaben.filter((u) => u !== 'geltendeZeilen'),
      'Eine Stelle bekommt die rohen Zeilen. Rechnet sie mit Geld, rechnet ' +
        'sie mit dem gespeicherten Preis.',
    ).toEqual([]);
  });

  it('⛔ und die Beträge stammen aus derselben Rechnung wie die Zeilen', () => {
    // `perLine` wird aus `geltendeZeilen` gebildet. Käme es aus `lines`,
    // stimmten Zeilen und Beträge wieder nicht überein.
    expect(/perLine[\s\S]{0,200}?geltendeZeilen\.map/.test(korb)).toBe(true);
  });

  it('der B2B-Weg rechnet wirklich NEU — sonst wäre der Fund harmlos', () => {
    /*
     * Der Satz oben trägt nur, solange der Bezahlen-Weg die Zeile bei einem
     * Steuerartwechsel tatsächlich aus `line.listPriceEur` neu rechnet.
     * Fiele das eines Tages weg, wäre die Angabe `lines` keine Geldstelle
     * mehr — dann darf dieser Wächter ruhig umgeschrieben werden, aber
     * NICHT, ohne dass jemand hier nachgesehen hat.
     */
    const bezahlen = ohneKommentare(BEZAHLEN);
    expect(bezahlen).toContain('computeLineMath({');
    expect(/computeLineMath\(\{[\s\S]{0,200}?listPriceEur: line\.listPriceEur/.test(bezahlen)).toBe(
      true,
    );
  });
});
