/**
 * Der Fall, den Basel am 05.08.2026 beschrieben hat, als Zahl.
 *
 * „Ich kaufe ein Gramm Gold zu einem Preis. Zwei Tage später steigt der
 * Goldkurs. Steigt der Preis des Stücks mit?"
 *
 * Vorher lautete die gemessene Antwort: nein, nie, für keines der Stücke.
 * Diese Prüfung hält fest, dass sie jetzt ja lautet — und dass die roten
 * Linien daneben stehen bleiben.
 */

import { describe, expect, it } from 'vitest';

import {
  KEIN_KURSPREIS_SATZ,
  type Tageskurs,
  kurspreisFuerStueck,
} from './metallpreis.js';

const kurse = (goldJeGramm: string): ReadonlyMap<string, Tageskurs> =>
  new Map([
    [
      'gold',
      {
        metal: 'gold',
        pricePerGramEur: goldJeGramm,
        source: 'GOLD_API',
        asOf: '2026-08-05T00:00:00Z',
      },
    ],
  ]);

/**
 * Zehn Prozent Aufschlag auf Gold, nichts auf den Rest.
 * ⚠️ ANTEIL, nicht Prozent: 0.10 sind zehn Prozent, genau wie das Haus die
 * Ankaufmarge seit jeher führt.
 */
const aufschlag = new Map([['gold', '0.10']]);

describe('Basels Frage: steigt der Preis mit dem Kurs?', () => {
  const einGrammFeingold = {
    metal: 'gold',
    weightGrams: '1.0000',
    finenessDecimal: '1.0000',
  };

  it('rechnet am Montag mit dem Montagskurs', () => {
    const p = kurspreisFuerStueck(einGrammFeingold, kurse('100.00'), aufschlag);
    expect(p.art).toBe('gerechnet');
    if (p.art !== 'gerechnet') return;
    // 1 g × 100 EUR + 10 Prozent = 110,00
    expect(p.preisEur).toBe('110.00');
  });

  it('rechnet am Mittwoch mit dem HÖHEREN Kurs, ohne dass jemand etwas anfasst', () => {
    const p = kurspreisFuerStueck(einGrammFeingold, kurse('120.00'), aufschlag);
    expect(p.art).toBe('gerechnet');
    if (p.art !== 'gerechnet') return;
    expect(p.preisEur).toBe('132.00');
  });

  it('nimmt den Feingehalt ernst: 585er Gold wiegt nicht wie Feingold', () => {
    // 10 g × 0,585 = 5,85 g fein × 100 EUR = 585,00 + 10 % = 643,50
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '10.0000', finenessDecimal: '0.5850' },
      kurse('100.00'),
      aufschlag,
    );
    expect(p.art).toBe('gerechnet');
    if (p.art !== 'gerechnet') return;
    expect(p.preisEur).toBe('643.50');
    expect(p.grundlage.feingewichtGramm).toBe('5.8500');
    expect(p.grundlage.materialwertEur).toBe('585.00');
  });

  it('rechnet eine echte Feinunze', () => {
    // 31,103 g × 0,9999 fein × 113,71 EUR/g, plus 10 %
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '31.1030', finenessDecimal: '0.9999' },
      kurse('113.7101'),
      aufschlag,
    );
    expect(p.art).toBe('gerechnet');
    if (p.art !== 'gerechnet') return;
    expect(Number(p.preisEur)).toBeGreaterThan(3800);
    expect(Number(p.preisEur)).toBeLessThan(3900);
  });
});

describe('Es wird NIE geraten', () => {
  it('ohne Gewicht: kein Preis, und ein Satz der sagt was fehlt', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: null, finenessDecimal: '0.9999' },
      kurse('100.00'),
      aufschlag,
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'kein_gewicht' });
    expect(KEIN_KURSPREIS_SATZ.kein_gewicht).toContain('Gewicht');
  });

  it('ohne Feingehalt: kein Preis', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '10.0000', finenessDecimal: null },
      kurse('100.00'),
      aufschlag,
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'kein_feingehalt' });
  });

  it('ohne Tageskurs: kein Preis, KEIN erfundener Kurs', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '10.0000', finenessDecimal: '0.9999' },
      new Map(),
      aufschlag,
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'kein_tageskurs' });
  });

  it('eine Uhr ist kein Metallstück', () => {
    const p = kurspreisFuerStueck(
      { metal: null, weightGrams: '80.0000', finenessDecimal: null },
      kurse('100.00'),
      aufschlag,
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'kein_metall' });
  });

  it('ein bewusst fest gepflegtes Stück folgt dem Kurs nicht', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '10.0000', finenessDecimal: '0.9999', festerPreis: true },
      kurse('100.00'),
      aufschlag,
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'fest_gepflegt' });
  });

  it('ein fehlender Aufschlag wird NICHT erfunden: dann eben der nackte Materialwert', () => {
    const p = kurspreisFuerStueck(
      { metal: 'silver', weightGrams: '100.0000', finenessDecimal: '0.9250' },
      new Map([
        ['silver', { metal: 'silver', pricePerGramEur: '1.00', source: 'EZB', asOf: 'x' }],
      ]),
      new Map(), // kein Aufschlag hinterlegt
    );
    expect(p.art).toBe('gerechnet');
    if (p.art !== 'gerechnet') return;
    expect(p.preisEur).toBe('92.50');
    expect(p.grundlage.aufschlagAnteil).toBe('0');
  });
});

describe('Die roten Linien', () => {
  it('ein unsinniger Feingehalt über 1 wird abgewiesen, nicht gerechnet', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '10.0000', finenessDecimal: '1.5000' },
      kurse('100.00'),
      aufschlag,
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'kein_feingehalt' });
  });

  it('ein Gewicht von null ist kein Gewicht', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '0.0000', finenessDecimal: '0.9999' },
      kurse('100.00'),
      aufschlag,
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'kein_gewicht' });
  });

  it('⚠️ „10" statt „0.10": KEIN Preis, statt des Zehnfachen', () => {
    // Der teuerste denkbare Tippfehler. Zehn Prozent Aufschlag als „10"
    // eingetragen hiesse tausend Prozent — ein Krügerrand zu 40.000 Euro.
    // Lieber gar kein Preis und ein Satz, der die Einheit erklärt.
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '1.0000', finenessDecimal: '1.0000' },
      kurse('100.00'),
      new Map([['gold', '10']]),
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'aufschlag_unplausibel' });
  });

  it('ein negativer Aufschlag ist ebenfalls kein Preis', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '1.0000', finenessDecimal: '1.0000' },
      kurse('100.00'),
      new Map([['gold', '-0.20']]),
    );
    expect(p).toEqual({ art: 'kein_kurspreis', grund: 'aufschlag_unplausibel' });
  });

  it('genau hundert Prozent Aufschlag ist noch erlaubt, die Grenze liegt darüber', () => {
    const p = kurspreisFuerStueck(
      { metal: 'gold', weightGrams: '1.0000', finenessDecimal: '1.0000' },
      kurse('100.00'),
      new Map([['gold', '1']]),
    );
    expect(p.art).toBe('gerechnet');
    if (p.art !== 'gerechnet') return;
    expect(p.preisEur).toBe('200.00');
  });

  it('jeder Grund trägt einen deutschen Satz, keiner ist leer', () => {
    for (const [grund, satz] of Object.entries(KEIN_KURSPREIS_SATZ)) {
      expect(satz.length, grund).toBeGreaterThan(20);
      expect(satz, grund).not.toMatch(/[a-z]_[a-z]/); // kein roher Kennwert
    }
  });
});
