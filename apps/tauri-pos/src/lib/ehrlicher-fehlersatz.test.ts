// @vitest-environment node
//
// Liest Quelldateien und ruft reine Helfer, darum Node, nicht jsdom.

/**
 * Der Wächter über den Satz, den eine Fläche sagt, wenn KEIN `ApiError` kam.
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Gemessen über den ganzen Baum: „Verbindung gestört" stand an ZWANZIG
 * Stellen, in zwei Fassungen mit verschiedenen Ratschlägen. Alle standen im
 * `else` von `if (err instanceof ApiError)`, und dieser Zweig heisst nicht
 * „das Netz ist weg", sondern „es kam keine geordnete Antwort".
 *
 * Von den zwanzig Flächen behandelten VIER den Fall, dass der Vorgang sicher
 * im Ausgangskorb liegt, über den Helfer; vier weitere mit einem eigenen
 * `instanceof`; und FÜNFZEHN gar nicht. Die fünfzehn sagten dem Kassierer
 * „bitte erneut versuchen", während sein Wille längst sicher lag. Bei einer
 * Fläche, die einen neuen Datensatz anlegt (Kunde, Stück, Bewertung), erzeugt
 * genau dieser zweite Versuch ein Duplikat.
 *
 * Dieselbe Klasse steht schon zweimal im Haus: einmal 07.06.2026 (nur der
 * Ankauf behoben), einmal 26.07.2026 (vier Masken behoben). Zweimal wurde der
 * Fehler an EINZELNEN Stellen behoben, nie an der Wurzel, und danach wuchsen
 * neue Stellen nach. Deshalb misst dieser Wächter den ganzen Baum.
 *
 * ── WAS ER MISST ────────────────────────────────────────────────────────────
 *
 *  1. Den Satz selbst tippt keine Fläche mehr. Er steht nur in `eingereiht.ts`.
 *  2. Wer den Fehlerzweig benutzt (`ohneApiFehlerSatz`), prüft vorher auf
 *     „sicher eingereiht" (`istSicherEingereiht`). Das Paar ist der Schutz;
 *     eine Hälfte allein ist der alte Fehler mit besserem Wortlaut.
 *  3. Die vier Lagen bilden wirklich auf vier verschiedene Sätze ab, und
 *     keiner davon rät zum Netzwerk, wenn das Netz gar nicht schuld ist.
 *
 * Gemessen wird der GEBRAUCH: Kommentare werden vor der Messung weggeschnitten,
 * sonst zählte dieser Kopfkommentar sich selbst als Verstoss.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ApiCircuitOpenError,
  ApiError,
  ApiNetworkError,
  ApiOfflineQueuedError,
} from '@norns/api-client';
import { describe, expect, it } from 'vitest';

import { fehlerlage, istSicherEingereiht, ohneApiFehlerSatz } from './eingereiht.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLBAUM = join(HIER, '..');

/** Die eine Datei, in der die Sätze stehen dürfen. */
const DIE_QUELLE = 'lib/eingereiht.ts';

function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function alleQuelldateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  const gehen = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const weg = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        if (eintrag.name === 'node_modules' || eintrag.name === 'dist') continue;
        gehen(weg);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(eintrag.name)) continue;
      if (/\.test\.tsx?$/.test(eintrag.name)) continue;
      gefunden.push(weg);
    }
  };
  gehen(wurzel);
  return gefunden;
}

const dateien = alleQuelldateien(QUELLBAUM).map((weg) => ({
  name: relative(QUELLBAUM, weg).split('\\').join('/'),
  quelle: ohneKommentare(readFileSync(weg, 'utf8')),
}));

describe('Der Satz für den Nicht-ApiError-Zweig steht an EINER Stelle', () => {
  it('der Quellbaum wurde wirklich gelesen', () => {
    // Ein Wächter ohne Messpunkt ist still grün.
    expect(dateien.length, 'Keine Quelldateien gefunden, der Weg stimmt nicht.').toBeGreaterThan(
      100,
    );
    expect(
      dateien.some((d) => d.name === DIE_QUELLE),
      `\`${DIE_QUELLE}\` wurde nicht gelesen. Wurde die Quelle verschoben?`,
    ).toBe(true);
  });

  it.each(dateien.filter((d) => d.name !== DIE_QUELLE))(
    '$name tippt den Satz nicht selbst',
    ({ name, quelle }) => {
      expect(
        /Verbindung gestört/.test(quelle),
        `\`${name}\` tippt „Verbindung gestört" selbst. Dieser Satz behauptet ` +
          'eine Ursache, die an dieser Stelle niemand gemessen hat: der ' +
          '`else`-Zweig von `instanceof ApiError` fängt auch einen sicher ' +
          'eingereihten Vorgang, eine angehaltene Übertragung und einen Fehler ' +
          'in der Kasse selbst. Bitte `ohneApiFehlerSatz(err)` aus ' +
          `\`${DIE_QUELLE}\` benutzen, und davor \`istSicherEingereiht\`.`,
      ).toBe(false);
    },
  );
});

describe('Die anlegenden Flächen behandeln „sicher eingereiht" als Erfolg', () => {
  /**
   * ── WARUM DIESE PRÜFUNG NICHT FÜR JEDE FLÄCHE GILT ────────────────────────
   *
   * Der erste Entwurf verlangte das Paar von JEDER Fläche, die den Fehlerzweig
   * benutzt. Das war zu grob: an einer Anmeldemaske kann ein eingereihter
   * Vorgang nichts Sinnvolles bewirken (eine Sitzung kommt aus dem
   * Ausgangskorb nie zurück), und ein Zweig, der nie läuft, ist selbst ein
   * Defekt, „gebaut und nie angeschlossen".
   *
   * Gemessen wird deshalb die Eigenschaft, aus der der Schaden entsteht: die
   * Fläche LEGT ETWAS AN. Nur dort erzeugt ein zweiter Versuch ein Duplikat,
   * das niemand mehr auseinanderhalten kann, ein zweiter Kunde, ein zweites
   * Stück, eine zweite Bewertung.
   *
   * Der Messpunkt ist der Aufruf selbst (`…Api.create(`), nicht eine Liste von
   * Dateinamen: eine neue anlegende Fläche wird von diesem Wächter erfasst,
   * ohne dass jemand sie hier einträgt.
   */
  const anlegend = dateien.filter(
    (d) => d.name !== DIE_QUELLE && /\b[a-zA-Z]+Api\.create\s*\(/.test(d.quelle),
  );

  it('es gibt überhaupt anlegende Flächen', () => {
    expect(
      anlegend.length,
      'Keine Fläche ruft `…Api.create(`. Entweder wurde das Anlegen ' +
        'umbenannt, dann gehört dieser Wächter mit umgestellt, oder er ' +
        'misst ins Leere und wird still grün.',
    ).toBeGreaterThan(0);
  });

  it.each(anlegend)('$name behandelt „sicher eingereiht" als Erfolg', ({ name, quelle }) => {
    expect(
      /\bistSicherEingereiht\s*\(/.test(quelle),
      `\`${name}\` legt einen Datensatz an, prüft aber nie mit ` +
        '`istSicherEingereiht`, ob der Vorgang in Wahrheit sicher im ' +
        'Ausgangskorb liegt. Genau daraus entstand am 26.07.2026 eine zweite ' +
        'Zeile im Kassenbuch: der Kassierer las einen Fehler und trug erneut ' +
        'ein. Eingereiht ist ein ERFOLG, die Fläche muss schliessen und ' +
        '`eingereihtHinweis` zeigen, nicht bloss einen anderen Text.',
    ).toBe(true);
  });
});

describe('Auch eine Fläche OHNE das Paar lädt nicht zum Wiederholen ein', () => {
  // Das Sicherungsnetz: selbst wenn eine Fläche den Erfolgsfall nie prüft,
  // bekommt sie aus der Quelle einen Satz, der ausdrücklich abrät. Ohne dieses
  // Netz wäre jede künftige Fläche wieder eine Duplikatquelle.
  it('der Satz für den eingereihten Fall rät ausdrücklich ab', () => {
    expect(ohneApiFehlerSatz(new ApiOfflineQueuedError('k', 0))).toMatch(/NICHT erneut/);
  });
});

describe('Die vier Lagen werden wirklich unterschieden', () => {
  it('jede Lage wird an ihrer Klasse erkannt, nicht an ihrem Wortlaut', () => {
    expect(fehlerlage(new ApiOfflineQueuedError('k', 0))).toBe('eingereiht');
    expect(fehlerlage(new ApiNetworkError('connect ECONNREFUSED'))).toBe('netzWeg');
    expect(fehlerlage(new ApiCircuitOpenError('kasse', 0, 5000))).toBe('uebertragungPausiert');
    expect(fehlerlage(new TypeError('x is not a function'))).toBe('fehlerInDerKasse');
    expect(fehlerlage('irgendein geworfener Text')).toBe('fehlerInDerKasse');
    expect(fehlerlage(undefined)).toBe('fehlerInDerKasse');
  });

  it('ein echter ApiError gehört NICHT hierher', () => {
    // Der Fehlerzweig ist der `else`-Zweig. Käme ein ApiError hier an, würde
    // sein Fachcode verschluckt und durch einen allgemeinen Satz ersetzt.
    const echt = new ApiError({ code: 'CONFLICT', message: 'conflict', httpStatus: 409 });
    expect(echt instanceof ApiError).toBe(true);
    expect(istSicherEingereiht(echt)).toBe(false);
  });

  it('die vier Sätze sind verschieden und keiner ist leer', () => {
    const saetze = [
      ohneApiFehlerSatz(new ApiOfflineQueuedError('k', 0)),
      ohneApiFehlerSatz(new ApiNetworkError('weg')),
      ohneApiFehlerSatz(new ApiCircuitOpenError('kasse', 0, 5000)),
      ohneApiFehlerSatz(new TypeError('kaputt')),
    ];
    expect(new Set(saetze).size, 'Zwei Lagen sagen denselben Satz.').toBe(4);
    for (const s of saetze) expect(s.trim().length).toBeGreaterThan(20);
  });

  it('nur die Lage „Netz weg" schickt den Kassierer ans Netzwerk', () => {
    // Der Kern des Befundes: die Kasse riet zum Router, während der Fehler in
    // ihr selbst sass.
    expect(ohneApiFehlerSatz(new ApiNetworkError('weg'))).toMatch(/Netzwerk/);
    expect(ohneApiFehlerSatz(new TypeError('kaputt'))).not.toMatch(/Netzwerk|Verbindung/);
    expect(ohneApiFehlerSatz(new ApiCircuitOpenError('kasse', 0, 5000))).not.toMatch(/Netzwerk/);
  });

  it('ein sicher eingereihter Vorgang lädt NIE zum Wiederholen ein', () => {
    // Der teuerste Einzelfall: Wiederholen erzeugt bei jeder anlegenden
    // Fläche ein Duplikat.
    const satz = ohneApiFehlerSatz(new ApiOfflineQueuedError('k', 0));
    expect(satz).toMatch(/NICHT erneut/);
  });

  it('die Lage „angehalten" hält vom Drücken ab, statt dazu aufzufordern', () => {
    const satz = ohneApiFehlerSatz(new ApiCircuitOpenError('kasse', 0, 5000));
    expect(satz).toMatch(/von allein|warten/i);
  });
});
