/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Zeichen, das DATEV nicht kennt, muss FINDBAR sein
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * `kodiereAnsi` wird EINMAL auf die fertige CSV angewandt
 * (`closing-export.ts:1153`). Trifft es auf ein Zeichen, das Windows-1252
 * nicht kennt, wirft es:
 *
 *     Das Zeichen „ş" (U+15F) lässt sich nicht nach Windows-1252 schreiben,
 *     das DATEV verlangt.
 *
 * Der Satz nennt das Zeichen und sonst nichts. Nicht die Zeile, nicht das
 * Feld, nicht den Beleg. Der Händler hat einen Monat mit vierhundert
 * Buchungen und die Auskunft, dass irgendwo ein „ş" steht.
 *
 * Ein einziger türkischer oder polnischer Kundenname genügt, ein „№" aus
 * einer eingefügten Beschreibung, ein Gedankenstrich aus einer kopierten
 * Zeile. Die Ausfuhr scheitert, und sie scheitert bei jedem weiteren
 * Versuch gleich, weil sich am Bestand nichts ändert.
 *
 * ── WAS ABSICHTLICH SO BLEIBT ──────────────────────────────────────────
 *
 * Der Abbruch selbst. Das stille Ersetzen durch ein Fragezeichen wäre ein
 * falscher Buchungstext beim Steuerberater, und die Entscheidung dagegen
 * steht seit jeher im Quelltext. Ein lautes Nein ist richtig.
 *
 * Falsch war nur, dass das Nein nicht sagt, WO.
 */

import { describe, expect, it } from 'vitest';

import {
  DatevFormatFehler,
  findeNichtKodierbare,
  kodiereAnsi,
} from '../../src/lib/datev-format.js';

/** Zwei Kopfzeilen, dann Buchungen — grob der Aufbau einer echten Datei. */
const CSV = [
  '"EXTF";700;21;"Buchungsstapel";13;',
  'Umsatz;Soll/Haben;Konto;Gegenkonto;Belegfeld 1;Buchungstext',
  '119,00;S;1000;8400;"RE-1";"Verkauf Meier"',
  '107,00;S;1000;8300;"RE-2";"Verkauf Şahin"',
  '10,00;S;1000;8400;"RE-3";"Verkauf Kowalczyk"',
].join('\r\n');

describe('⛔ Der Abbruch bleibt — aber er nennt den Ort', () => {
  it('wirft weiterhin, statt ein Fragezeichen zu schreiben', () => {
    expect(() => kodiereAnsi(CSV)).toThrow(DatevFormatFehler);
  });

  it('⚠️ nennt die ZEILE, in der das Zeichen steht', () => {
    try {
      kodiereAnsi(CSV);
      expect.unreachable('hätte werfen müssen');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // Zeile 4 ist die mit „Şahin".
      expect(m, m).toMatch(/Zeile 4\b/);
    }
  });

  it('zeigt den TEXT drumherum, damit man ihn wiedererkennt', () => {
    try {
      kodiereAnsi(CSV);
      expect.unreachable('hätte werfen müssen');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      expect(m, m).toContain('ahin');
      expect(m, m).toContain('Verkauf');
    }
  });

  it('nennt das Zeichen weiterhin, mit seiner Nummer', () => {
    try {
      kodiereAnsi(CSV);
      expect.unreachable('hätte werfen müssen');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      expect(m, m).toContain('Ş');
      expect(m, m).toContain('U+15E');
    }
  });

  it('⚠️ nennt ALLE Stellen, nicht nur die erste', () => {
    /**
     * Sonst wird aus einem Fund eine Kette: der Händler bessert eine Stelle
     * aus, startet neu, wartet, und bekommt die nächste. Bei fünf Stellen
     * sind das fünf Läufe über einen ganzen Monat.
     */
    const mehrere = [
      'Kopf',
      '"Verkauf Şahin"',
      '"Verkauf Łukasz"',
      '"Ring ♥ 750"',
    ].join('\r\n');
    try {
      kodiereAnsi(mehrere);
      expect.unreachable('hätte werfen müssen');
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      expect(m, m).toMatch(/Zeile 2\b/);
      expect(m, m).toMatch(/Zeile 3\b/);
      expect(m, m).toMatch(/Zeile 4\b/);
    }
  });
});

describe('Was weiterhin durchgeht', () => {
  it('deutsche Umlaute und das scharfe S', () => {
    expect(kodiereAnsi('Schlüssel Größe Öl Ähre')).toBeInstanceOf(Buffer);
  });

  it('das Eurozeichen, an seiner Windows-1252-Stelle', () => {
    expect(kodiereAnsi('€')[0]).toBe(0x80);
  });

  it('die französischen und skandinavischen Zeichen aus Latin-1', () => {
    for (const t of ['Café', 'Åström', 'Señor', 'Ærø']) {
      expect(() => kodiereAnsi(t), t).not.toThrow();
    }
  });

  it('eine leere Zeichenkette', () => {
    expect(kodiereAnsi('')).toHaveLength(0);
  });
});

describe('findeNichtKodierbare — dieselbe Messung, ohne zu werfen', () => {
  it('gibt eine leere Liste für einen sauberen Text', () => {
    expect(findeNichtKodierbare('Verkauf Müller 119,00 €')).toEqual([]);
  });

  it('nennt Zeile, Spalte und Zeichen', () => {
    const funde = findeNichtKodierbare('sauber\r\nmit Ş drin');
    expect(funde).toHaveLength(1);
    expect(funde[0]).toMatchObject({ zeile: 2, zeichen: 'Ş', codepoint: 0x15e });
    // Spalte 1-basiert: „mit " sind vier Zeichen, das Ş ist das fünfte.
    expect(funde[0]?.spalte).toBe(5);
  });

  it('⚠️ zählt Zeilen über CRLF UND über LF', () => {
    // Die DATEV-Datei nutzt CRLF. Ein Test, der nur LF kennt, zählt in der
    // echten Datei jede Zeile falsch — und die falsche Zeilennummer ist
    // schlimmer als keine, weil der Händler an der falschen Stelle sucht.
    expect(findeNichtKodierbare('a\r\nb\r\nŞ')[0]?.zeile).toBe(3);
    expect(findeNichtKodierbare('a\nb\nŞ')[0]?.zeile).toBe(3);
  });

  it('findet mehrere Stellen in derselben Zeile', () => {
    const funde = findeNichtKodierbare('Ş und Ł');
    expect(funde.map((f) => f.zeichen)).toEqual(['Ş', 'Ł']);
  });

  it('behandelt ein Zeichen ausserhalb der Grundebene als EIN Fund', () => {
    // Ein Emoji besteht aus zwei UTF-16-Einheiten. Wer über `length` läuft
    // statt über die Zeichen, meldet es zweimal und an der falschen Spalte.
    const funde = findeNichtKodierbare('Gold 🥇 999');
    expect(funde).toHaveLength(1);
    expect(funde[0]?.zeichen).toBe('🥇');
  });
});
