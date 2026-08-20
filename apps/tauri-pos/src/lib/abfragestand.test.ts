/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Keine Fläche bleibt stumm, weil eine Abfrage schläft
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Befund steht in `abfragestand.ts`: die Ankaufsfläche zeigte eine leere
 * linke Spalte, weil ihre Abfrage in `fetchStatus: 'paused'` hing — nicht
 * ladend, nicht gescheitert, ohne Daten. Zehn Flächen trugen dasselbe Muster,
 * keine einzige kannte diesen Fall.
 */

import { describe, expect, it } from 'vitest';

import { type Abfrageblick, abfragestand, standSatz } from './abfragestand.js';

const blick = (teil: Partial<Abfrageblick>): Abfrageblick => ({
  isPending: false,
  isPaused: false,
  isError: false,
  data: undefined,
  ...teil,
});

describe('Welchen Stand eine Abfrage hat', () => {
  it('⛔ die schlafende Abfrage hat einen EIGENEN Stand', () => {
    // Genau die Lage vom 20.08.2026: einmal gescheitert, dann pausiert.
    // Vorher fiel sie durch alle drei Zweige und die Fläche blieb leer.
    const s = abfragestand(blick({ isPending: true, isPaused: true }), () => 'x');
    expect(s.art).toBe('wartet');
  });

  it('vorhandene Daten schlagen jeden laufenden Versuch', () => {
    // Sonst fiele eine Fläche beim Nachladen auf den Ladehinweis zurück,
    // obwohl sie schon etwas Richtiges zeigt.
    expect(abfragestand(blick({ data: { a: 1 }, isPending: true }), () => 'x').art).toBe('da');
    expect(abfragestand(blick({ data: { a: 1 }, isPaused: true }), () => 'x').art).toBe('da');
    expect(abfragestand(blick({ data: { a: 1 }, isError: true }), () => 'x').art).toBe('da');
  });

  it('⛔ pausiert schlägt ladend — die genauere Aussage gewinnt', () => {
    expect(abfragestand(blick({ isPending: true, isPaused: true }), () => 'x').art).toBe('wartet');
  });

  it('ein Fehler verdeckt nicht den Wiederholungslauf', () => {
    const s = abfragestand(blick({ isError: true, isPending: true }), () => 'Motor schweigt');
    expect(s.art).toBe('fehler');
    expect(s).toMatchObject({ satz: 'Motor schweigt' });
  });

  it('das erste Laden heisst laedt', () => {
    expect(abfragestand(blick({ isPending: true }), () => 'x').art).toBe('laedt');
  });

  it('⛔ fertig und nichts gefunden ist NICHT dasselbe wie fertig mit Daten', () => {
    // `null` ist eine Antwort („diesen Kunden gibt es nicht"), keine Daten.
    expect(abfragestand(blick({ data: null }), () => 'x').art).toBe('leer');
    expect(abfragestand(blick({}), () => 'x').art).toBe('leer');
  });

  it('⛔ es gibt KEINE Kombination, die gar keinen Stand ergibt', () => {
    // Der eigentliche Punkt dieser Datei: die Vereinigung ist vollständig.
    // Alle 16 Kombinationen der vier Merkmale durchgespielt.
    for (const isPending of [true, false]) {
      for (const isPaused of [true, false]) {
        for (const isError of [true, false]) {
          for (const data of [undefined, { a: 1 }]) {
            const s = abfragestand(blick({ isPending, isPaused, isError, data }), () => 'x');
            expect(
              ['laedt', 'wartet', 'fehler', 'leer', 'da'],
              `pending=${isPending} paused=${isPaused} error=${isError} data=${String(data)}`,
            ).toContain(s.art);
          }
        }
      }
    }
  });
});

describe('Was die Kasse dazu sagt', () => {
  it('⛔ jeder Stand ausser „da" hat einen Satz — eine stumme Fläche ist der Fehler', () => {
    const staende = [
      abfragestand(blick({ isPending: true }), () => 'x'),
      abfragestand(blick({ isPaused: true }), () => 'x'),
      abfragestand(blick({ isError: true }), () => 'Motor schweigt'),
      abfragestand(blick({}), () => 'x'),
    ];
    for (const s of staende) {
      expect(standSatz(s, 'Der Verkäufer').length, `„${s.art}" sagt nichts`).toBeGreaterThan(10);
    }
  });

  it('der Wartesatz nennt KEINEN Fehler — die Kasse gibt ja nicht auf', () => {
    const satz = standSatz(abfragestand(blick({ isPaused: true }), () => 'x'), 'Der Verkäufer');
    expect(satz.toLowerCase()).not.toContain('fehler');
    expect(satz).toContain('Verbindung');
  });

  it('wer Daten hat, bekommt keinen Satz', () => {
    expect(standSatz(abfragestand(blick({ data: { a: 1 } }), () => 'x'), 'Der Verkäufer')).toBe('');
  });
});
