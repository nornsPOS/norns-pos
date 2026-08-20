/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein ganz gewöhnlicher Verkauf, den unser eigener Server abweist
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 07.08.2026 ───────────────────────────────────────────
 *
 * Die Kasse rundet die Umsatzsteuer EINMAL je Beleg und Satz und verteilt sie
 * danach auf die Zeilen — so, wie § 14 Abs. 4 Nr. 8 UStG es verlangt: der
 * Steuerbetrag gehört zur RECHNUNG, je Steuersatz, nicht zur Position.
 * (`harmonisiereUstJeSatz` in `apps/tauri-pos/src/lib/cart-math.ts`.)
 *
 * Der Server prüfte danach jede Zeile EINZELN gegen `Entgelt × Satz` und liess
 * einen Cent Spielraum. Zwei Dinge stiessen dabei zusammen:
 *
 *   1. Die Verteilung verschiebt eine Zeile um bis zu einem ganzen Cent.
 *   2. Der Spielraum galt gegen den UNGERUNDETEN Erwartungswert. Die Meldung
 *      nannte „erwartet 6,20", verglich aber gegen 6,1997 — und wies 6,21 ab,
 *      obwohl das genau ein Cent Unterschied zur genannten Zahl ist.
 *
 * ── GEMESSEN, NICHT GESCHÄTZT ──────────────────────────────────────────
 *
 * Über alle Zwei-Zeilen-Belege von 1,00 bis 500,00 EUR (571.897 Belege):
 *
 *     1.793 abgewiesen  =  0,314 %   ·  etwa jeder 320. Beleg
 *     drei Zeilen, gestreut: 173 von 65.860  =  0,263 %
 *
 * Der erste gemessene Fall, und der Beleg, den dieser Test festhält:
 *
 *     1,28 EUR + 38,84 EUR, beide 19 %
 *     → Zeile 2: Entgelt 32,63  Steuer 6,21
 *     → Server: „Der ausgewiesene Steuerbetrag passt nicht zu STANDARD_19"
 *
 * Für den Händler heisst das: die Kasse verweigert etwa alle zehn Tage einen
 * gewöhnlichen Verkauf, und der Kassierer hat keinen Weg daran vorbei — jeder
 * neue Versuch mit denselben Waren erzeugt dieselben Zahlen.
 *
 * ── WIE WEIT DARF EINE ZEILE ABWEICHEN ─────────────────────────────────
 *
 * Auch das gemessen, nicht angenommen: über 2 bis 40 Zeilen, Beträge von
 * 0,01 bis 500,00 EUR, 19 % und 7 %, verschiebt die Verteilung eine Zeile
 * NIEMALS um mehr als einen ganzen Cent gegen `round(Entgelt × Satz)`.
 *
 * Der Riegel bekommt deshalb zwei Cent je Zeile — ein Cent Luft über dem
 * gemessenen Höchstwert — und dafür einen ZWEITEN, engen Riegel auf
 * Belegebene. Der ist der eigentlich massgebliche: er prüft die Zahl, die im
 * Gesetz steht.
 */

import { describe, expect, it } from 'vitest';

import {
  pruefeSteuerJeBeleg,
  pruefeSteuerbetrag,
  type Steuerzeile,
} from '../../src/lib/steuerbetrag-passt.js';

const z = (u: Partial<Steuerzeile>): Steuerzeile => ({
  appliedTaxTreatmentCode: 'STANDARD_19',
  appliedVatRate: '0.1900',
  lineSubtotalEur: '100.00',
  lineVatEur: '19.00',
  ...u,
});

/**
 * Der Tag, von dem diese Proben sprechen.
 *
 * ⚠️ 20.08.2026: die Prüfung nimmt den Satz seither vom TAG des Belegs, statt
 * ihn als feste Zahl zu tragen. Eine Probe muss deshalb sagen, WANN ihr Beleg
 * entsteht — ein Beleg vom 01.09.2020 trüge 16 Prozent, und die Zahlen unten
 * gingen nicht auf.
 */
const TAG = '2026-08-20';

describe('⚠️ DER GEMESSENE BELEG: 1,28 + 38,84 EUR, beide 19 Prozent', () => {
  /**
   * Die Zahlen stammen aus dem echten Lauf von `harmonisiereUstJeSatz`:
   *
   *     Brutto gesamt 40,12  →  Ziel-USt round(40,12 × 19/119) = 6,41
   *     verteilt nach grössten Resten:  0,20  und  6,21
   *     Entgelte:                       1,08  und 32,63
   *
   * `32,63 × 0,19 = 6,1997`. Auf Cent gerundet 6,20. Ausgewiesen 6,21.
   */
  const zeilen = [
    z({ lineSubtotalEur: '1.08', lineVatEur: '0.20' }),
    z({ lineSubtotalEur: '32.63', lineVatEur: '6.21' }),
  ];

  it('geht Zeile für Zeile durch', () => {
    for (let i = 0; i < zeilen.length; i++) {
      expect(pruefeSteuerbetrag(zeilen[i] as Steuerzeile, i, TAG), `Zeile ${i}`).toBeNull();
    }
  });

  it('und geht auch als ganzer Beleg durch', () => {
    // 1,08 + 32,63 = 33,71 · × 0,19 = 6,4049 → 6,40
    // 0,20 + 6,21  = 6,41 · ein Cent Unterschied, und das ist die Rundung
    // des Belegs selbst, nicht ein versteckter Betrag.
    expect(pruefeSteuerJeBeleg(zeilen, TAG)).toBeNull();
  });
});

describe('⛔ Was der Belegriegel FÄNGT', () => {
  it('die alte Tür: 19 Prozent ausgewiesen, null Steuer gezahlt', () => {
    const zeilen = [z({ lineSubtotalEur: '100.00', lineVatEur: '0.00' })];
    expect(pruefeSteuerbetrag(zeilen[0] as Steuerzeile, 0, TAG)).not.toBeNull();
    expect(pruefeSteuerJeBeleg(zeilen, TAG)).not.toBeNull();
  });

  it('⚠️ die NEUE Tür: zwei Cent je Zeile, über viele Zeilen verteilt', () => {
    /**
     * Genau der Angriff, den der Zeilenriegel allein nicht mehr sieht, seit er
     * zwei Cent lässt. Zwanzig Zeilen à 100,00 EUR, jede um zwei Cent zu
     * niedrig: je Zeile im Rahmen, zusammen 0,40 EUR verschwundene Steuer.
     *
     * Auf ein Jahr mit dreissig Belegen am Tag sind das über 4.000 EUR, die
     * niemand sieht — und genau die Art Betrag, die eine Kassennachschau
     * findet.
     */
    const zeilen = Array.from({ length: 20 }, () =>
      z({ lineSubtotalEur: '100.00', lineVatEur: '18.98' }),
    );
    for (let i = 0; i < zeilen.length; i++) {
      expect(pruefeSteuerbetrag(zeilen[i] as Steuerzeile, i, TAG), 'je Zeile im Rahmen').toBeNull();
    }
    const befund = pruefeSteuerJeBeleg(zeilen, TAG);
    expect(befund, 'der Beleg als Ganzes muss auffallen').not.toBeNull();
    expect(befund?.expected).toBe('380.00');
    expect(befund?.actual).toBe('379.60');
  });

  it('mischt die Sätze nicht: 19 und 7 Prozent werden getrennt gerechnet', () => {
    // Sonst könnte zu viel Steuer im einen Satz zu wenig im anderen decken.
    const zeilen = [
      z({ lineSubtotalEur: '100.00', lineVatEur: '19.00' }),
      z({
        appliedTaxTreatmentCode: 'REDUCED_7',
        appliedVatRate: '0.0700',
        lineSubtotalEur: '100.00',
        lineVatEur: '5.00', // 2,00 zu wenig
      }),
    ];
    const befund = pruefeSteuerJeBeleg(zeilen, TAG);
    expect(befund).not.toBeNull();
    expect(befund?.message).toContain('REDUCED_7');
  });

  it('⚠️ § 25a und § 25c bleiben aussen vor: dort liegt die Steuer nicht auf dem Entgelt', () => {
    // Bei der Differenzbesteuerung liegt sie auf der MARGE. Eine Rechnung
    // gegen das Entgelt wäre hier immer falsch — auf Romans Produktion
    // gemessen bei 63 von 92 Zeilen.
    expect(
      pruefeSteuerJeBeleg([
        z({
          appliedTaxTreatmentCode: 'MARGIN_25A',
          appliedVatRate: null,
          lineSubtotalEur: '500.00',
          lineVatEur: '15.97',
        }, TAG),
      ]),
    ).toBeNull();
  });

  it('ein leerer Beleg ist kein Befund', () => {
    expect(pruefeSteuerJeBeleg([], TAG)).toBeNull();
  });

  it('ältere Aufrufer ohne Zeilenschlüssel gehen unverändert durch', () => {
    expect(
      pruefeSteuerJeBeleg([z({ appliedTaxTreatmentCode: null, lineVatEur: '0.00' })], TAG),
    ).toBeNull();
  });

  it('⛔ ein Storno wird mit denselben Augen gemessen', () => {
    // Negative Beträge, dieselbe Regel. Ohne diesen Satz wäre der Storno der
    // bequemste Weg an der Prüfung vorbei.
    expect(
      pruefeSteuerJeBeleg([z({ lineSubtotalEur: '-100.00', lineVatEur: '-19.00' })], TAG),
    ).toBeNull();
    expect(
      pruefeSteuerJeBeleg([z({ lineSubtotalEur: '-100.00', lineVatEur: '0.00' })], TAG),
    ).not.toBeNull();
  });
});

describe('Der Zeilenriegel misst gegen die Zahl, die er NENNT', () => {
  it('⚠️ die RUNDUNG entscheidet den Vergleich, nicht nur die Anzeige', () => {
    /**
     * Vorher nannte die Meldung „erwartet 6,20" und verglich gegen 6,1997.
     * Ein Kassierer, der beide Zahlen liest, sah einen Cent Unterschied und
     * eine Abweisung, und konnte nichts daran ändern.
     *
     * Dieser Fall trennt beide Lesarten sauber:
     *
     *     Entgelt 0,03 × 0,19 = 0,0057   →  auf Cent gerundet 0,01
     *     ausgewiesen         = 0,03
     *
     *     gegen die GERUNDETE Zahl:   |0,03 − 0,01|    = 0,02  → im Rahmen
     *     gegen die ROHE Zahl:        |0,03 − 0,0057| = 0,0243 → abgewiesen
     *
     * Wird hier wieder gegen die rohe Zahl gemessen, ist dieser Satz rot.
     */
    expect(pruefeSteuerbetrag(z({ lineSubtotalEur: '0.03', lineVatEur: '0.03' }), 0, TAG)).toBeNull();

    const befund = pruefeSteuerbetrag(z({ lineSubtotalEur: '32.63', lineVatEur: '9.00' }), 0, TAG);
    expect(befund).not.toBeNull();
    expect(befund?.expected, 'die genannte Zahl muss ein Geldbetrag sein').toMatch(/^-?\d+\.\d{2}$/);
  });

  it('zwei Cent gehen durch, drei nicht', () => {
    // Die gemessene Höchstverschiebung der Harmonisierung ist EIN Cent. Zwei
    // ist die Grenze mit einem Cent Luft; bei drei ist es keine Rundung mehr.
    expect(pruefeSteuerbetrag(z({ lineVatEur: '19.02' }), 0, TAG)).toBeNull();
    expect(pruefeSteuerbetrag(z({ lineVatEur: '18.98' }), 0, TAG)).toBeNull();
    expect(pruefeSteuerbetrag(z({ lineVatEur: '19.03' }), 0, TAG)).not.toBeNull();
    expect(pruefeSteuerbetrag(z({ lineVatEur: '18.97' }), 0, TAG)).not.toBeNull();
  });
});
