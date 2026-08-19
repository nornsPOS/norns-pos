/**
 * Ein grauer Knopf muss sagen, warum er grau ist.
 *
 * ── BASELS BESCHWERDE VOM 02.08.2026 ───────────────────────────────────────
 *
 * Er versuchte, ein Produkt ins Lager aufzunehmen. Es wurde nicht aufgenommen.
 * Er hielt es fuer einen Defekt.
 *
 * ⚠️ Es war keiner. Der Knopf war grau, und NICHTS sagte warum. Die Ursache
 * lag entweder in einem zugeklappten Abschnitt (Herkunftsland) oder auf einer
 * Stufe, die der Mensch schon verlassen hatte (Preise). Er stand auf der
 * letzten Stufe und sah kein einziges rotes Feld.
 *
 * ── WAS DIESER WAECHTER FESTHAELT ──────────────────────────────────────────
 *
 * 1. Zu JEDEM Grund, der den Knopf sperrt, gibt es einen Satz.
 * 2. Der Satz nennt die STUFE, sonst sucht der Mensch auf dem falschen Bild.
 * 3. Knopf und Satz kommen aus DERSELBEN Rechnung. Zwei Rechnungen driften,
 *    und dann sagt der Satz „alles vollstaendig", waehrend der Knopf grau
 *    bleibt.
 * 4. Was leer sein DARF, sperrt nicht. Ein Waechter, der leere Felder
 *    verlangt, waere schlimmer als gar keiner.
 */

import { describe, expect, it } from 'vitest';

import { isMoneyInput } from '../../lib/decimal.js';
import {
  type Entwurf,
  grundZeile,
  hinweise,
  istSpeicherbar,
  NAME_STUFE,
  wasFehltNoch,
} from './was-fehlt-noch.js';

/** Ein vollstaendiger Entwurf, so wie ein Haendler ihn tippt. */
const VOLL: Entwurf = {
  name: 'Krugerrand 1 oz 1974',
  sku: 'AU-KRU-1974',
  herkunftsland: 'ZA',
  einkaufspreis: '1899,00',
  verkaufspreis: '2149,00',
  gewichtGramm: '33,930',
};

describe('Warum der Speichern-Knopf grau ist', () => {
  it('ein vollstaendiger Entwurf ist speicherbar, mit KOMMA in jedem Betrag', () => {
    // Der Ausgangspunkt. Waere das schon rot, taugte der Rest nichts.
    expect(wasFehltNoch(VOLL, isMoneyInput)).toEqual([]);
    expect(istSpeicherbar(VOLL, isMoneyInput)).toBe(true);
    expect(grundZeile([])).toBe('');
  });

  it('⛔ zu JEDEM sperrenden Grund gibt es einen ganzen Satz', () => {
    const faelle: Array<Partial<Entwurf>> = [
      { name: '   ' },
      { sku: '' },
      { herkunftsland: 'Deutschland' },
      { einkaufspreis: '' },
      { verkaufspreis: 'abc' },
      { gewichtGramm: 'abc' },
    ];
    for (const teil of faelle) {
      const luecken = wasFehltNoch({ ...VOLL, ...teil }, isMoneyInput);
      expect(luecken.length, JSON.stringify(teil)).toBeGreaterThan(0);
      for (const l of luecken) {
        expect(l.satz.length, `${l.feld}: kein Satz`).toBeGreaterThan(30);
        expect(l.satz.endsWith('.'), `${l.feld}: kein ganzer Satz`).toBe(true);
        expect(l.feld.length).toBeGreaterThan(2);
        // Hausregel: kein Gedankenstrich in sichtbarem Text.
        expect(l.satz).not.toMatch(/[—–]/);
      }
    }
  });

  it('⛔ der Satz nennt die STUFE, sonst sucht der Mensch woanders', () => {
    // Der eigentliche Fund: das fehlende Feld liegt HINTER dem Menschen.
    const luecken = wasFehltNoch({ ...VOLL, einkaufspreis: '' }, isMoneyInput);
    expect(luecken[0]?.stufe).toBe(1);
    expect(grundZeile(luecken)).toContain(NAME_STUFE[1]);
  });

  it('⛔ bei mehreren Luecken werden ALLE genannt, nicht nur die erste', () => {
    // Sonst raeumt der Mensch eine weg, der Knopf bleibt grau, und er haelt
    // die Kasse endgueltig fuer kaputt.
    const luecken = wasFehltNoch(
      { ...VOLL, name: '', einkaufspreis: '', verkaufspreis: '' },
      isMoneyInput,
    );
    expect(luecken).toHaveLength(3);
    const zeile = grundZeile(luecken);
    expect(zeile).toContain('Einkaufspreis');
    expect(zeile).toContain('Verkaufspreis');
    expect(zeile).toContain('Ausserdem fehlt');
  });

  it('⛔ was leer sein DARF, sperrt nicht', () => {
    // Herkunftsland und Gewicht sind freiwillig. Ein Waechter, der sie
    // verlangt, waere schlimmer als gar keiner: er hielte den Tresen an.
    expect(
      wasFehltNoch({ ...VOLL, herkunftsland: '', gewichtGramm: '' }, isMoneyInput),
    ).toEqual([]);
    expect(wasFehltNoch({ ...VOLL, herkunftsland: '  ' }, isMoneyInput)).toEqual([]);
  });

  it('das Herkunftsland darf nur zwei GROSSBUCHSTABEN sein', () => {
    for (const gut of ['DE', 'CH', 'ZA', 'US']) {
      expect(wasFehltNoch({ ...VOLL, herkunftsland: gut }, isMoneyInput), gut).toEqual([]);
    }
    for (const schlecht of ['de', 'DEU', 'D', 'Deutschland', '12']) {
      expect(
        wasFehltNoch({ ...VOLL, herkunftsland: schlecht }, isMoneyInput).length,
        schlecht,
      ).toBe(1);
    }
  });

  it('⛔ das Komma im Preis ist ERLAUBT, das war Basels zweite Beschwerde', () => {
    for (const betrag of ['199,99', '1.999,99', '0,00', '2149']) {
      expect(
        wasFehltNoch({ ...VOLL, einkaufspreis: betrag }, isMoneyInput),
        betrag,
      ).toEqual([]);
    }
  });

  it('⛔ fünf Nachkommastellen im Gewicht werden nicht STILL gekürzt', () => {
    // Der Nebenfund: `isMoneyInput(x, 3)` nimmt 1,23456 an und speichert
    // 1,234. Wer den Wert von der Goldwaage kopiert, sieht fünf Stellen und
    // bekommt drei, ohne ein Wort dazu. An diesem Gewicht hängt der
    // Schmelzwert.
    expect(wasFehltNoch({ ...VOLL, gewichtGramm: '1,23456' }, isMoneyInput)).toEqual([]);
    const h = hinweise({ ...VOLL, gewichtGramm: '1,23456' });
    expect(h).toHaveLength(1);
    expect(h[0]).toContain('1,234');
    expect(h[0]).not.toMatch(/[—–]/);
    // Drei Stellen oder weniger: kein Wort noetig.
    for (const still of ['31,103', '31,1', '31', '']) {
      expect(hinweise({ ...VOLL, gewichtGramm: still }), still).toEqual([]);
    }
  });

  it('⛔ Knopf und Satz kommen aus DERSELBEN Rechnung', () => {
    // Waeren es zwei, driftete eine: der Satz saehe leer aus und der Knopf
    // bliebe grau. Genau der Zustand, den dieser Waechter beendet.
    const halb: Entwurf = { ...VOLL, sku: '' };
    const luecken = wasFehltNoch(halb, isMoneyInput);
    expect(istSpeicherbar(halb, isMoneyInput)).toBe(luecken.length === 0);
    expect(grundZeile(luecken) !== '').toBe(!istSpeicherbar(halb, isMoneyInput));
  });
});
