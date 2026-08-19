/**
 * Die Grenze zwischen Mensch und Maschine im Geldweg.
 *
 * ── DER FUND VOM 02.08.2026 ────────────────────────────────────────────────
 *
 * `toCents` bekam beides: kanonische Werte aus der Datenbank UND rohe
 * Tastenanschläge. Seine ganze Nachsicht war ein `replace(',', '.')`.
 * Gemessen, mit echten Eingaben:
 *
 *   getippt        toCents(roh)        richtig wäre
 *   ───────        ────────────        ────────────
 *   1.999          199 Cent            199900 Cent   ⚠️ tausendfach zu wenig
 *   1.999,99       WIRFT               199999 Cent   ⚠️ Absturz beim Zeichnen
 *   ١٩٩٫٩٩         WIRFT               19999 Cent
 *
 * Und daneben sagte das Feld in JEDEM Fall „gültig". Das Rabattfeld im
 * Warenkorb ruft die Umrechnung MITTEN IM ZEICHNEN und ohne Auffangnetz: ein
 * Tausenderpunkt mit Komma nahm dem Kassierer die Verkaufsfläche weg, während
 * der Kunde davorstand.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Die Eigenschaft, nicht die Umsetzung: was ein Feld als GÜLTIG anzeigt, muss
 * die Umrechnung auch annehmen, und sie darf dabei niemals werfen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isMoneyInput, normalizeDecimal } from './decimal.js';
import { centsAusEingabe, toCents } from './money-core.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const SCREENS = resolve(HIER, '../screens');

describe('Was der Mensch tippt, kommt als Cent an', () => {
  const FAELLE: ReadonlyArray<readonly [string, bigint, string]> = [
    ['199,99', 19999n, 'deutsches Komma'],
    ['1.999,99', 199999n, '⚠️ warf früher mitten im Zeichnen'],
    ['1.999', 199900n, '⚠️ war früher 199 Cent, also tausendfach zu wenig'],
    ['1.234.567,89', 123456789n, 'zwei Tausenderpunkte'],
    ['١٩٩٫٩٩', 19999n, '⚠️ arabische Ziffern, warf früher'],
    ['1 999,99', 199999n, 'Leerzeichen als Tausender'],
    ['199,99 €', 19999n, 'mit Währungszeichen'],
  ];

  for (const [roh, cents, was] of FAELLE) {
    it(`„${roh}" ist ${cents} Cent (${was})`, () => {
      expect(centsAusEingabe(roh)).toBe(cents);
    });
  }

  it('⛔ WIRFT NIE, sondern gibt nichts zurück', () => {
    // Der Grund für diese Funktion: das Rabattfeld ruft sie beim Zeichnen.
    // Ein Wurf dort ist ein weisser Bildschirm am Tresen.
    for (const murks of ['abc', '', '199,', ',', '.', '€', '---']) {
      expect(() => centsAusEingabe(murks)).not.toThrow();
      expect(centsAusEingabe(murks)).toBeNull();
    }
  });

  /**
   * ⚠️ DER EIGENTLICHE SATZ.
   *
   * Ein Feld, das „gültig" anzeigt, und eine Umrechnung, die denselben Wert
   * ablehnt, sind zwei Wahrheiten über dieselbe Sache. Genau daran hing der
   * Absturz.
   */
  it('⛔ was das Feld gültig NENNT, nimmt die Umrechnung auch an', () => {
    for (const [roh] of FAELLE) {
      expect(isMoneyInput(roh), `„${roh}" gilt nicht als gültig`).toBe(true);
      expect(centsAusEingabe(roh), `„${roh}" wird nicht umgerechnet`).not.toBeNull();
    }
  });

  it('der strenge Weg bleibt streng', () => {
    // `toCents` ist für MASCHINENwerte. Seine Strenge ist dort richtig: ein
    // krummer Wert aus der Datenbank wäre ein Fehler im Haus, kein Vertipper.
    expect(() => toCents('1.999,99')).toThrow();
    expect(toCents('1999.99')).toBe(199999n);
    expect(toCents(normalizeDecimal('1.999,99'))).toBe(199999n);
  });
});

describe('Kein Rohtext geht mehr an die strenge Umrechnung', () => {
  /** Felder, in die ein MENSCH tippt, und die Datei, die sie umrechnet. */
  const ROHTEXT_FELDER: ReadonlyArray<readonly [string, string]> = [
    ['verkauf/CartPanel.tsx', 'amount'],
    ['verkauf/BezahlenDialog.tsx', 'cashReceivedEur'],
    ['verkauf/split-payment.ts', 'cashTendered'],
  ];

  for (const [datei, feld] of ROHTEXT_FELDER) {
    it(`${datei}: „${feld}" geht nicht mehr roh an toCents`, () => {
      const roh = readFileSync(join(SCREENS, datei), 'utf8');
      const ohneKommentare = roh
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(
        ohneKommentare,
        `In ${datei} landet „${feld}" wieder direkt in toCents. Das wirft bei ` +
          'einem Tausenderpunkt mit Komma und nimmt dem Kassierer die Fläche weg. ' +
          'Bitte `centsAusEingabe` benutzen.',
      ).not.toMatch(new RegExp(`toCents\\(\\s*${feld}\\b`));
    });
  }
});
