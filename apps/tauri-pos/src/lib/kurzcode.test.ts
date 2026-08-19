/**
 * Prüfungen für den Kurzcode.
 *
 * Zwei davon prüfen nicht die Datei selbst, sondern die Entscheidung dahinter:
 * die Geometrie-Prüfung rechnet die Zahlen des Entwurfspanels mit dem ECHTEN
 * Code-128-Kodierer und den ECHTEN Werten aus der Treiberdatei des
 * angeschlossenen Druckers nach. Eine Zahl, die nur im Kommentar steht, ist
 * eine Behauptung; eine Zahl, die eine Prüfung nachrechnet, ist ein Fakt.
 */
import { describe, expect, it } from 'vitest';

import { code128BalkenBreiten } from './code128';
import {
  istKurzcode,
  kollisionswahrscheinlichkeit,
  kurzcodeAlphabet,
  kurzcodeAnzeige,
  kurzcodeAusArtikelnummer,
  kurzcodeLaenge,
  normalisiereKurzcode,
} from './kurzcode';

// ────────────────────────────────────────────────────────────────────────────
// Die Werte des angeschlossenen DYMO LabelWriter 450, gelesen aus
// /etc/cups/ppd/Warehouse14-Etikett.ppd:
//   *ImageableArea w54h144/Return Address: "2 14.89999961853 52 129.100006103516"
//   *PaperDimension w54h144/Return Address: "54 144"
// Alles in PostScript-Punkten zu 1/72 Zoll.
// ────────────────────────────────────────────────────────────────────────────
const PUNKT_ZU_MM = 25.4 / 72;
const BEDRUCKBAR_LAENGE_MM = (129.100006103516 - 14.89999961853) * PUNKT_ZU_MM; // 40,287
const PAPIERRAND_LAENGE_MM = 14.89999961853 * PUNKT_ZU_MM; // 5,256
const DRUCKPUNKT_MM = 25.4 / 300; // 300 dpi
const MODUL_MM = 4 * DRUCKPUNKT_MM; // die Entscheidung des Panels: 4 Punkte je Modul

/** Eine Handvoll Artikelnummern in den beiden Formaten, die wirklich vergeben werden. */
const ECHTE_NUMMERN = [
  'JV-A1B2C3D4E5',
  'JV-0000000001',
  'JV-ZZZZZZZZZZ',
  'AN-P4X-7K2M',
  'AN-P4X-7K2N',
  'AN-000-0000',
];

/** Viele erfundene, aber realistisch geformte Nummern für die Verteilungsprüfungen. */
function vieleNummern(anzahl: number): string[] {
  const nummern: string[] = [];
  for (let i = 0; i < anzahl; i += 1) {
    const stelle = i.toString(36).toUpperCase().padStart(10, '0');
    nummern.push(`JV-${stelle}`);
  }
  return nummern;
}

describe('Alphabet', () => {
  it('hat 32 Zeichen, jedes genau einmal', () => {
    expect(kurzcodeAlphabet).toHaveLength(32);
    expect(new Set(kurzcodeAlphabet).size).toBe(32);
  });

  it('schliesst die verwechselbaren Zeichen I, L, O und U aus', () => {
    for (const zeichen of ['I', 'L', 'O', 'U']) {
      expect(kurzcodeAlphabet.includes(zeichen)).toBe(false);
    }
  });

  it('ist eine Zweierpotenz, damit die Bits ohne Rest aufgehen', () => {
    expect(Math.log2(kurzcodeAlphabet.length) % 1).toBe(0);
  });

  it('enthält nur Ziffern und Grossbuchstaben', () => {
    expect(kurzcodeAlphabet).toMatch(/^[0-9A-Z]+$/);
  });
});

describe('Ableitung', () => {
  it('liefert für jede echte Artikelnummer einen Code aus dem Alphabet', () => {
    for (const nummer of ECHTE_NUMMERN) {
      const code = kurzcodeAusArtikelnummer(nummer);
      expect(code).toHaveLength(kurzcodeLaenge);
      for (const zeichen of code) {
        expect(kurzcodeAlphabet.includes(zeichen)).toBe(true);
      }
    }
  });

  it('ist stabil: derselbe Aufruf ergibt immer denselben Code', () => {
    for (const nummer of ECHTE_NUMMERN) {
      expect(kurzcodeAusArtikelnummer(nummer)).toBe(kurzcodeAusArtikelnummer(nummer));
    }
  });

  it('ist gegen Schreibweise der Artikelnummer unempfindlich', () => {
    const erwartet = kurzcodeAusArtikelnummer('JV-A1B2C3D4E5');
    expect(kurzcodeAusArtikelnummer('  JV-A1B2C3D4E5  ')).toBe(erwartet);
    expect(kurzcodeAusArtikelnummer('jv-a1b2c3d4e5')).toBe(erwartet);
  });

  it('trennt Nummern, die sich nur in einem Zeichen unterscheiden', () => {
    expect(kurzcodeAusArtikelnummer('AN-P4X-7K2M')).not.toBe(
      kurzcodeAusArtikelnummer('AN-P4X-7K2N'),
    );
    expect(kurzcodeAusArtikelnummer('JV-0000000001')).not.toBe(
      kurzcodeAusArtikelnummer('JV-0000000002'),
    );
  });

  it('gibt je Versuch einen anderen Code — der Ausweg aus einer Kollision', () => {
    const nummer = 'JV-A1B2C3D4E5';
    const codes = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => kurzcodeAusArtikelnummer(nummer, v)));
    expect(codes.size).toBe(10);
    // und jeder Versuch bleibt für sich wiederholbar
    expect(kurzcodeAusArtikelnummer(nummer, 3)).toBe(kurzcodeAusArtikelnummer(nummer, 3));
  });

  it('weist eine leere Artikelnummer zurück statt einen Sammelcode zu erfinden', () => {
    expect(() => kurzcodeAusArtikelnummer('')).toThrow(/Artikelnummer/);
    expect(() => kurzcodeAusArtikelnummer('   ')).toThrow(/Artikelnummer/);
  });

  it('weist einen unsinnigen Versuch zurück', () => {
    expect(() => kurzcodeAusArtikelnummer('JV-A1B2C3D4E5', -1)).toThrow(/Versuch/);
    expect(() => kurzcodeAusArtikelnummer('JV-A1B2C3D4E5', 1.5)).toThrow(/Versuch/);
  });
});

describe('Verteilung — dass der Streuwert wirklich streut', () => {
  const codes = vieleNummern(20_000).map((n) => kurzcodeAusArtikelnummer(n));

  it('nutzt an jeder der sechs Stellen alle 32 Zeichen', () => {
    for (let stelle = 0; stelle < kurzcodeLaenge; stelle += 1) {
      const gesehen = new Set(codes.map((c) => c[stelle]!));
      expect(gesehen.size).toBe(32);
    }
  });

  it('verteilt die Zeichen an jeder Stelle annähernd gleich', () => {
    // 20.000 Codes auf 32 Zeichen: 625 je Zeichen im Mittel, Streuung rund 25.
    // Der Rahmen 450 bis 800 lässt reichlich Zufall zu und schlägt trotzdem an,
    // wenn eine Ecke des Alphabets bevorzugt wird — genau das, was ein Modulo
    // auf einem Alphabet ungleich einer Zweierpotenz anrichten würde.
    for (let stelle = 0; stelle < kurzcodeLaenge; stelle += 1) {
      for (const zeichen of kurzcodeAlphabet) {
        const anzahl = codes.filter((c) => c[stelle] === zeichen).length;
        expect(anzahl).toBeGreaterThan(450);
        expect(anzahl).toBeLessThan(800);
      }
    }
  });

  it('erzeugt aus 20.000 Nummern fast durchweg verschiedene Codes', () => {
    // Erwartete Kollisionen bei 20.000 Stücken in 32^6 Plätzen: rund 0,19.
    // Fünf zuzulassen ist grosszügig und fällt trotzdem sofort auf, wenn der
    // Streuwert tote Bits hat.
    expect(new Set(codes).size).toBeGreaterThanOrEqual(codes.length - 5);
  });
});

describe('Zurücklesen eines abgetippten Codes', () => {
  const code = kurzcodeAusArtikelnummer('JV-A1B2C3D4E5');

  it('nimmt den eigenen Code unverändert an', () => {
    const lesung = normalisiereKurzcode(code);
    expect(lesung).toEqual({ art: 'ok', kurzcode: code });
    expect(istKurzcode(code)).toBe(true);
  });

  it('macht klein zu gross', () => {
    expect(normalisiereKurzcode(code.toLowerCase())).toEqual({ art: 'ok', kurzcode: code });
  });

  it('bildet O auf die Null und I sowie L auf die Eins ab', () => {
    expect(normalisiereKurzcode('OOOOOO')).toEqual({ art: 'ok', kurzcode: '000000' });
    expect(normalisiereKurzcode('oooooo')).toEqual({ art: 'ok', kurzcode: '000000' });
    expect(normalisiereKurzcode('IIIIII')).toEqual({ art: 'ok', kurzcode: '111111' });
    expect(normalisiereKurzcode('llllll')).toEqual({ art: 'ok', kurzcode: '111111' });
    expect(normalisiereKurzcode('LOL2K9')).toEqual({ art: 'ok', kurzcode: '1012K9' });
  });

  it('lässt 0 und 1 in Ruhe — die Abbildung geht nur in eine Richtung', () => {
    expect(normalisiereKurzcode('012345')).toEqual({ art: 'ok', kurzcode: '012345' });
  });

  it('wirft Trennzeichen weg', () => {
    expect(normalisiereKurzcode('K7B 3M9')).toEqual({ art: 'ok', kurzcode: 'K7B3M9' });
    expect(normalisiereKurzcode('K7B-3M9')).toEqual({ art: 'ok', kurzcode: 'K7B3M9' });
    expect(normalisiereKurzcode(' k7b . 3m9 ')).toEqual({ art: 'ok', kurzcode: 'K7B3M9' });
  });

  it('rät ein U nicht zu einem V, sondern sagt es', () => {
    const lesung = normalisiereKurzcode('K7BUM9');
    expect(lesung.art).toBe('zeichen');
    if (lesung.art === 'zeichen') {
      expect(lesung.zeichen).toBe('U');
      expect(lesung.hinweis).toContain('U');
    }
  });

  it('meldet ein unmögliches Zeichen mit dem Zeichen selbst', () => {
    const lesung = normalisiereKurzcode('K7B#M9');
    expect(lesung.art).toBe('zeichen');
    if (lesung.art === 'zeichen') expect(lesung.zeichen).toBe('#');
  });

  it('meldet eine falsche Länge mit der gelesenen Länge', () => {
    const kurz = normalisiereKurzcode('K7B3M');
    expect(kurz.art).toBe('laenge');
    if (kurz.art === 'laenge') expect(kurz.gelesen).toBe(5);

    const lang = normalisiereKurzcode('K7B3M99');
    expect(lang.art).toBe('laenge');
    if (lang.art === 'laenge') expect(lang.gelesen).toBe(7);
  });

  it('meldet eine leere Eingabe als leer, nicht als Längenfehler', () => {
    expect(normalisiereKurzcode('').art).toBe('leer');
    expect(normalisiereKurzcode('  -- ').art).toBe('leer');
    expect(istKurzcode('')).toBe(false);
  });

  it('zeigt den Code in zwei Gruppen und liest ihn danach wieder ein', () => {
    const anzeige = kurzcodeAnzeige(code);
    expect(anzeige).toBe(`${code.slice(0, 3)} ${code.slice(3)}`);
    expect(normalisiereKurzcode(anzeige)).toEqual({ art: 'ok', kurzcode: code });
  });

  it('liest jeden abgeleiteten Code der Stichprobe wieder ein', () => {
    for (const nummer of vieleNummern(2000)) {
      const abgeleitet = kurzcodeAusArtikelnummer(nummer);
      expect(normalisiereKurzcode(kurzcodeAnzeige(abgeleitet))).toEqual({
        art: 'ok',
        kurzcode: abgeleitet,
      });
    }
  });
});

describe('Kollisionsrechnung', () => {
  const coderaum = kurzcodeAlphabet.length ** kurzcodeLaenge;

  it('kennt den Coderaum: 32 hoch 6 sind 1.073.741.824 Plätze', () => {
    expect(coderaum).toBe(1_073_741_824);
  });

  it('stimmt mit dem exakten Produkt überein', () => {
    // Die exakte Form: 1 minus dem Produkt der Wahrscheinlichkeiten, dass jedes
    // weitere Stück einen noch freien Platz trifft. Zu langsam für 10.000, aber
    // für 2.000 gut zu rechnen — und damit ist die Näherung belegt statt geglaubt.
    const k = 2000;
    let frei = 1;
    for (let i = 0; i < k; i += 1) frei *= (coderaum - i) / coderaum;
    const exakt = 1 - frei;
    expect(kollisionswahrscheinlichkeit(k, coderaum)).toBeCloseTo(exakt, 6);
  });

  it('liegt bei 10.000 Stücken bei rund 4,5 Prozent', () => {
    const p = kollisionswahrscheinlichkeit(10_000);
    expect(p).toBeGreaterThan(0.045);
    expect(p).toBeLessThan(0.046);
  });

  it('zeigt, was eine Prüfziffer kosten würde: 4,5 gegen 77 Prozent', () => {
    // Eine Prüfziffer nähme eines von sechs Zeichen; es blieben 32^5 Plätze.
    const mitPruefziffer = kollisionswahrscheinlichkeit(10_000, kurzcodeAlphabet.length ** 5);
    expect(mitPruefziffer).toBeGreaterThan(0.77);
    expect(mitPruefziffer).toBeLessThan(0.78);
    expect(mitPruefziffer / kollisionswahrscheinlichkeit(10_000)).toBeGreaterThan(15);
  });

  it('bleibt bei 1.000 Stücken unter einem Zehntel Prozent', () => {
    expect(kollisionswahrscheinlichkeit(1000)).toBeLessThan(0.001);
  });

  it('ist bei 100.000 Stücken praktisch sicher — die Grenze des Verfahrens', () => {
    expect(kollisionswahrscheinlichkeit(100_000)).toBeGreaterThan(0.99);
  });

  it('ist null für weniger als zwei Stücke und eins über dem Coderaum', () => {
    expect(kollisionswahrscheinlichkeit(0)).toBe(0);
    expect(kollisionswahrscheinlichkeit(1)).toBe(0);
    expect(kollisionswahrscheinlichkeit(coderaum + 1)).toBe(1);
  });
});

describe('Geometrie — die Länge sechs gegen den echten Drucker gerechnet', () => {
  it('bestätigt die Werte der Treiberdatei in Millimetern', () => {
    expect(BEDRUCKBAR_LAENGE_MM).toBeCloseTo(40.287, 3);
    expect(PAPIERRAND_LAENGE_MM).toBeCloseTo(5.256, 3);
    expect(DRUCKPUNKT_MM).toBeCloseTo(0.08467, 5);
    expect(MODUL_MM).toBeCloseTo(0.33867, 5);
  });

  it('ergibt mit dem echten Kodierer genau 101 Module', () => {
    // 11 Module je Zeichen plus 35 für Start, Prüfsumme und Schluss.
    const erwartet = 11 * kurzcodeLaenge + 35;
    for (const nummer of ECHTE_NUMMERN) {
      const module = code128BalkenBreiten(kurzcodeAusArtikelnummer(nummer)).reduce(
        (a, b) => a + b,
        0,
      );
      expect(module).toBe(erwartet);
    }
    expect(erwartet).toBe(101);
  });

  it('passt auf die bedruckbaren 40,287 mm und lässt 3,041 mm Weiss je Seite', () => {
    const module = 11 * kurzcodeLaenge + 35;
    const breiteMm = module * MODUL_MM;
    expect(breiteMm).toBeCloseTo(34.205, 3);
    expect(breiteMm).toBeLessThan(BEDRUCKBAR_LAENGE_MM);

    const weissJeSeiteMm = (BEDRUCKBAR_LAENGE_MM - breiteMm) / 2;
    expect(weissJeSeiteMm).toBeCloseTo(3.041, 3);
  });

  it('hält die Ruhezone mit Faktor 2,45 — die Reserve für das gebogene Fähnchen', () => {
    // Die Ruhezone verlangt WEISS, nicht Druckfläche. Die 5,256 mm jenseits des
    // Druckkopfs sind weisses Etikettenpapier vor dem Stanzschnitt und zählen
    // deshalb voll mit. Gefordert sind 10 Module.
    const module = 11 * kurzcodeLaenge + 35;
    const weissJeSeiteMm = (BEDRUCKBAR_LAENGE_MM - module * MODUL_MM) / 2 + PAPIERRAND_LAENGE_MM;
    const gefordertMm = 10 * MODUL_MM;
    expect(gefordertMm).toBeCloseTo(3.387, 3);

    const faktor = weissJeSeiteMm / gefordertMm;
    expect(faktor).toBeCloseTo(2.45, 2);
    // Sieben Zeichen drückten den Faktor auf 1,90 und ässen die Reserve auf.
    // Diese Schranke hält die Entscheidung des Entwurfspanels fest.
    expect(faktor).toBeGreaterThanOrEqual(2.4);
  });
});
