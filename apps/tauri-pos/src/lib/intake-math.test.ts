/**
 * intake-math — the Ankauf Schmelzwert valuation (UX §4.2). No facade: a
 * missing rate yields NO suggestion (null, never NaN/fake-0); decimal-safe
 * bigint-cents; German comma tolerated. The buy-rate decision is explicit.
 */
import { describe, expect, it } from 'vitest';

import {
  type KursZeile,
  ankaufSchaetzung,
  computeSchmelzwertEur,
  finenessDecimalForPerMille,
  formatKursalter,
  metalFromItemType,
  suggestedBuyEur,
} from './intake-math.js';

describe('computeSchmelzwertEur', () => {
  it('gold 10 g × 585/1000 × 60 €/g = 351,00 €', () => {
    expect(
      computeSchmelzwertEur({
        metal: 'gold',
        weightGrams: '10',
        finenessDecimal: '0.585',
        pricePerGramEur: '60.00',
      }),
    ).toBe('351.00');
  });

  it('tolerates the German comma in weight + fineness', () => {
    expect(
      computeSchmelzwertEur({
        metal: 'gold',
        weightGrams: '10,0',
        finenessDecimal: '0,585',
        pricePerGramEur: '60.00',
      }),
    ).toBe('351.00');
  });

  it('missing rate / metal / weight → null (no NaN, no fake 0)', () => {
    expect(
      computeSchmelzwertEur({ metal: 'gold', weightGrams: '10', finenessDecimal: '0.585', pricePerGramEur: null }),
    ).toBeNull();
    expect(
      computeSchmelzwertEur({ metal: null, weightGrams: '10', finenessDecimal: '0.585', pricePerGramEur: '60' }),
    ).toBeNull();
    expect(
      computeSchmelzwertEur({ metal: 'gold', weightGrams: '', finenessDecimal: '0.585', pricePerGramEur: '60' }),
    ).toBeNull();
  });
});

describe('metalFromItemType', () => {
  it('infers the metal from the prefix; non-metal → null', () => {
    expect(metalFromItemType('gold_coin')).toBe('gold');
    expect(metalFromItemType('silver_jewelry')).toBe('silver');
    expect(metalFromItemType('platinum_bar')).toBe('platinum');
    expect(metalFromItemType('palladium_bar')).toBe('palladium');
    expect(metalFromItemType('watch')).toBeNull();
    expect(metalFromItemType('antique')).toBeNull();
    expect(metalFromItemType('other')).toBeNull();
  });
});

describe('finenessDecimalForPerMille', () => {
  it('585 → "0.585", 999 → "0.999"', () => {
    expect(finenessDecimalForPerMille(585)).toBe('0.585');
    expect(finenessDecimalForPerMille(999)).toBe('0.999');
    expect(finenessDecimalForPerMille(925)).toBe('0.925');
  });
});

describe('suggestedBuyEur (buy-rate decision)', () => {
  const base = { metal: 'gold' as const, weightGrams: '10', finenessDecimal: '0.585' };

  it('uses the ankauf rate when present (basis ankauf)', () => {
    const r = suggestedBuyEur({
      ...base,
      ankaufRatePerGramEur: '54.00',
      currentRatePerGramEur: '60.00',
      safetyMarginPct: 0.1,
      kursVeraltet: false,
    });
    expect(r.basis).toBe('ankauf');
    expect(r.value).toBe('315.90'); // 10 × 0.585 × 54
  });

  it('falls back to current × (1 − margin) when no ankauf rate (basis margin)', () => {
    const r = suggestedBuyEur({
      ...base,
      ankaufRatePerGramEur: null,
      currentRatePerGramEur: '60.00',
      safetyMarginPct: 0.1,
      kursVeraltet: false,
    });
    expect(r.basis).toBe('margin');
    expect(r.value).toBe('315.90'); // melt 351,00 × 0,9
  });

  it('no rate at all → none / null', () => {
    const r = suggestedBuyEur({
      ...base,
      ankaufRatePerGramEur: null,
      currentRatePerGramEur: null,
      safetyMarginPct: 0.1,
      kursVeraltet: false,
    });
    expect(r.basis).toBe('none');
    expect(r.value).toBeNull();
  });

  it('veralteter Kurs: KEIN Vorschlag, obwohl der Spot noch geliefert wird', () => {
    const r = suggestedBuyEur({
      ...base,
      ankaufRatePerGramEur: null,
      currentRatePerGramEur: '60.00',
      safetyMarginPct: 0.1,
      kursVeraltet: true,
    });
    expect(r.basis).toBe('veraltet');
    expect(r.value).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// WÄCHTER (11.08.2026) — die Ankauffläche liest KEIN einzelnes Feld mehr
//
// BEFUND: bei einem zu alten Kurs setzt der Server `ankaufRatePerGramEur`
// bewusst auf null (`routes/metal-prices.ts` mit `lib/kursalter.ts`). Die
// Kasse rechnete dann SELBST Spot mal (1 minus Marge) und schrieb das
// Ergebnis ungefragt ins Auszahlungsfeld — gemessen am Juni-Vorfall: 3287,99
// EUR aus einem 172,8 Stunden alten Kurs, während die Kopfleiste wörtlich
// „kein Ankaufvorschlag" sagte. Die Fläche las WEDER `stale` NOCH `ageHours`
// NOCH `asOf`; sie zog sich zwei Einzelfelder aus der Kurszeile.
//
// WARUM DER NAHELIEGENDE WEG FALSCH IST: nur `suggestedBuyEur` zu reparieren.
// Der angezeigte Schmelzwert kam aus DEMSELBEN toten Spot und trug kein
// Alter — und eine Fläche, die sich Einzelfelder herausgreift, kann `stale`
// beim nächsten Umbau wieder vergessen. Deshalb gibt es EINE Auskunft, die
// die GANZE Kurszeile nimmt: `ankaufSchaetzung`.
//
// WAS DER WÄCHTER MISST: den Rückgabewert dieser einen Auskunft, mit der
// echten Kurszeile des Juni-Vorfalls. Kein Text, keine Erwähnung.
// ══════════════════════════════════════════════════════════════════════════

describe('ankaufSchaetzung — die EINE Auskunft der Ankauffläche', () => {
  const stueck = {
    metal: 'gold' as const,
    weightGrams: '100',
    finenessDecimal: '0.585',
  };

  /** Der Juni-Vorfall: 172,8 Stunden ein Kurs, Server verweigert den Satz. */
  const goldVeraltet: KursZeile = {
    ankaufRatePerGramEur: null,
    currentPricePerGramEur: '62.4500',
    safetyMarginPct: 0.1,
    ageHours: 172.8,
    stale: true,
  };

  const goldFrisch: KursZeile = {
    ankaufRatePerGramEur: '56.2050',
    currentPricePerGramEur: '62.4500',
    safetyMarginPct: 0.1,
    ageHours: 2.5,
    stale: false,
  };

  it('veralteter Kurs: kein Vorschlag — der Klient baut den Satz NICHT nach', () => {
    const s = ankaufSchaetzung({ ...stueck, rate: goldVeraltet });
    expect(s.suggestion.value).toBeNull();
    expect(s.suggestion.basis).toBe('veraltet');
  });

  it('veralteter Kurs: der Schmelzwert bleibt sichtbar, trägt aber sein Alter', () => {
    const s = ankaufSchaetzung({ ...stueck, rate: goldVeraltet });
    expect(s.grossMeltEur).toBe('3653.32');
    expect(s.kursVeraltet).toBe(true);
    expect(s.kursalterSatz).toBe('Kurs 7 Tage alt');
  });

  it('frischer Kurs: der Satz des Servers trägt den Vorschlag', () => {
    const s = ankaufSchaetzung({ ...stueck, rate: goldFrisch });
    expect(s.suggestion.basis).toBe('ankauf');
    expect(s.suggestion.value).toBe('3287.99');
    expect(s.kursVeraltet).toBe(false);
    expect(s.kursalterSatz).toBe('Kurs 3 Std alt');
  });

  it('frischer Kurs ohne Zehntagesschnitt: der Rückfall auf Spot bleibt erlaubt', () => {
    const s = ankaufSchaetzung({
      ...stueck,
      rate: { ...goldFrisch, ankaufRatePerGramEur: null },
    });
    expect(s.suggestion.basis).toBe('margin');
    expect(s.suggestion.value).toBe('3287.99');
  });

  it('gar keine Kurszeile: alles leer, keine erfundene Null', () => {
    const s = ankaufSchaetzung({ ...stueck, rate: null });
    expect(s.grossMeltEur).toBeNull();
    expect(s.suggestion.value).toBeNull();
    expect(s.suggestion.basis).toBe('none');
    expect(s.kursalterSatz).toBeNull();
    expect(s.kursVeraltet).toBe(false);
  });
});

describe('formatKursalter', () => {
  it('nennt Minuten, Stunden und Tage — und behauptet ohne Alter nichts', () => {
    expect(formatKursalter(0.2)).toBe('Kurs 12 Min. alt');
    expect(formatKursalter(2.5)).toBe('Kurs 3 Std alt');
    expect(formatKursalter(172.8)).toBe('Kurs 7 Tage alt');
    expect(formatKursalter(null)).toBeNull();
  });
});
