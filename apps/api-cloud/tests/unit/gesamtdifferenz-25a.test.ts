/**
 * § 25a Abs. 4 UStG — die Gesamtdifferenz.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  WARUM SIE FÜR DIESEN HÄNDLER DIE WICHTIGERE HÄLFTE IST
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Auf der Produktion gemessen: von 115 Stücken mit hinterlegtem Einkaufspreis
 * liegen **105 unter 750 EUR** — 91 Prozent. Die Einzeldifferenz ist gebaut,
 * die Gesamtdifferenz war es nicht.
 *
 * Bei einem Konvolut ist der Einkaufspreis je Einzelstück oft gar nicht
 * bestimmbar. Die Einzeldifferenz wäre dort eine erfundene Zahl.
 */

import { describe, expect, it } from 'vitest';

import {
  berechneGesamtdifferenz,
  GRENZE_EINKAUFSPREIS_CENT,
  type Posten,
} from '../../src/lib/gesamtdifferenz-25a.js';

const p = (ueber: Partial<Posten> & { produktId: string }): Posten => ({
  einkaufCent: 10_000n,
  erloesCent: 15_000n,
  einzeldifferenzGenutzt: false,
  ...ueber,
});

describe('der Normalfall', () => {
  it('rechnet Erloese minus Einkaeufe, davon 19/119', () => {
    // 3 x (150,00 verkauft, 100,00 gekauft) → Differenz 150,00 → 23,95 Steuer
    const g = berechneGesamtdifferenz([p({ produktId: 'a' }), p({ produktId: 'b' }), p({ produktId: 'c' })]);
    expect(g.erloeseCent).toBe(45_000n);
    expect(g.einkaeufeCent).toBe(30_000n);
    expect(g.differenzCent).toBe(15_000n);
    expect(g.steuerCent).toBe(2_395n); // 15000 * 19 / 119 = 2394,95…
    expect(g.anzahl).toBe(3);
  });

  it('ein noch nicht verkauftes Stueck mindert den Zeitraum trotzdem', () => {
    // Der Einkauf zaehlt im Zeitraum des Einkaufs, der Erloes im Zeitraum des
    // Verkaufs. Genau dafuer ist die Gesamtdifferenz da.
    const g = berechneGesamtdifferenz([
      p({ produktId: 'verkauft' }),
      p({ produktId: 'liegt-noch', erloesCent: null }),
    ]);
    expect(g.erloeseCent).toBe(15_000n);
    expect(g.einkaeufeCent).toBe(20_000n);
    expect(g.differenzCent).toBe(-5_000n);
    expect(g.anzahl).toBe(2);
  });
});

describe('⛔ Regel 1: eine negative Differenz ergibt KEINE negative Steuer', () => {
  it('der Verlustzeitraum schuldet null, nicht minus', () => {
    // Abschn. 25a.1 Abs. 12 UStAE. Eine negative Steuer waere eine Erstattung,
    // die es hier nicht gibt.
    const g = berechneGesamtdifferenz([p({ produktId: 'a', einkaufCent: 50_000n, erloesCent: 10_000n })]);
    expect(g.differenzCent).toBe(-40_000n);
    expect(g.steuerCent).toBe(0n);
  });

  it('und genau null Differenz ebenso', () => {
    const g = berechneGesamtdifferenz([p({ produktId: 'a', einkaufCent: 10_000n, erloesCent: 10_000n })]);
    expect(g.differenzCent).toBe(0n);
    expect(g.steuerCent).toBe(0n);
  });
});

describe('⛔ Regel 2: kein Gegenstand in BEIDEN Stroemen', () => {
  it('ein einzeldifferenzbesteuertes Stueck wird ausgeschlossen', () => {
    // Wer ihn hier mitrechnet, zieht den Einkauf ZWEIMAL ab. Das ist keine
    // Schludrigkeit, sondern eine Steuerverkuerzung.
    const g = berechneGesamtdifferenz([
      p({ produktId: 'einzeln', einzeldifferenzGenutzt: true }),
      p({ produktId: 'gesamt' }),
    ]);
    expect(g.anzahl).toBe(1);
    expect(g.einkaeufeCent).toBe(10_000n);
    expect(g.ausgeschlossen).toHaveLength(1);
    expect(g.ausgeschlossen[0]?.grund).toContain('doppelter Abzug');
  });

  it('⚠️ und derselbe Gegenstand ZWEIMAL in der Eingabe ebenso', () => {
    // Klingt selbstverstaendlich. Ist es nicht: eine Abfrage mit einem
    // unwilligen JOIN liefert Zeilen doppelt, und die Summe waere STILL falsch.
    const g = berechneGesamtdifferenz([p({ produktId: 'x' }), p({ produktId: 'x' })]);
    expect(g.anzahl).toBe(1);
    expect(g.ausgeschlossen[0]?.grund).toBe('doppelt in der Eingabe');
  });
});

describe('⛔ Regel 3: die Grenze gilt fuer den EINKAUFSPREIS', () => {
  it('ueber 750 EUR eingekauft → gehoert in die Einzeldifferenz', () => {
    const g = berechneGesamtdifferenz([p({ produktId: 'teuer', einkaufCent: 75_001n })]);
    expect(g.anzahl).toBe(0);
    expect(g.ausgeschlossen[0]?.grund).toContain('750');
  });

  it('genau 750 EUR ist noch drin — „übersteigt nicht"', () => {
    const g = berechneGesamtdifferenz([p({ produktId: 'grenze', einkaufCent: GRENZE_EINKAUFSPREIS_CENT })]);
    expect(g.anzahl).toBe(1);
  });

  it('⚠️ ein BILLIG gekauftes, TEUER verkauftes Stueck bleibt drin', () => {
    // Der haeufigste Denkfehler: die Grenze auf den Verkaufspreis anzuwenden.
    // Fuer 400 gekauft und fuer 2.000 verkauft gehoert in die Gesamtdifferenz.
    const g = berechneGesamtdifferenz([p({ produktId: 'gut', einkaufCent: 40_000n, erloesCent: 200_000n })]);
    expect(g.anzahl).toBe(1);
    expect(g.differenzCent).toBe(160_000n);
  });
});

describe('die Rundung folgt derselben Regel wie die Einzeldifferenz', () => {
  it('bankiersgerundet, nicht kaufmaennisch aufgerundet', () => {
    // Zwei Rundungsarten im selben System erzeugen Cent-Differenzen, die
    // niemand mehr zuordnen kann.
    const g = berechneGesamtdifferenz([p({ produktId: 'a', einkaufCent: 0n, erloesCent: 119n })]);
    expect(g.steuerCent).toBe(19n);
  });

  it('und ein Cent Erloes ergibt null Steuer, nicht einen', () => {
    const g = berechneGesamtdifferenz([p({ produktId: 'a', einkaufCent: 0n, erloesCent: 1n })]);
    expect(g.steuerCent).toBe(0n);
  });
});

describe('der Nachweis', () => {
  it('das Ausgeschlossene wird BENANNT, nicht weggeworfen', () => {
    // § 25a Abs. 6 verlangt Aufzeichnungen. Ein Gegenstand, der aus der
    // Rechnung faellt, muss mit GRUND nachweisbar sein — sonst sieht ein
    // Pruefer eine Luecke und keine Begruendung.
    const g = berechneGesamtdifferenz([
      p({ produktId: 'a' }),
      p({ produktId: 'teuer', einkaufCent: 100_000n }),
      p({ produktId: 'einzeln', einzeldifferenzGenutzt: true }),
    ]);
    expect(g.anzahl).toBe(1);
    expect(g.ausgeschlossen.map((x) => x.produktId).sort()).toEqual(['einzeln', 'teuer']);
    for (const a of g.ausgeschlossen) expect(a.grund.length).toBeGreaterThan(10);
  });

  it('ein leerer Zeitraum ist null, nicht undefiniert', () => {
    const g = berechneGesamtdifferenz([]);
    expect(g.differenzCent).toBe(0n);
    expect(g.steuerCent).toBe(0n);
    expect(g.anzahl).toBe(0);
  });
});
