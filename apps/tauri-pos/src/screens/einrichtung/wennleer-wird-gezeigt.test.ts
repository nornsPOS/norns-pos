/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ NEUNZEHN SÄTZE, SORGFÄLTIG GESCHRIEBEN, FÜR NIEMANDEN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 14.08.2026 ─────────────────────────────────────────────
 *
 * Jedes Feld der Erstinbetriebnahme trägt ein Datenfeld `wennLeer`: die
 * FOLGE, wenn der Händler die Angabe weglässt. Etwa, dass ohne den
 * Umsatzsteuer-Status kein Verkauf möglich ist.
 *
 * Sein eigener Kommentar in `einrichtungs-schritte.ts` sagt wörtlich:
 *
 *     „Was passiert, wenn es leer bleibt. Steht direkt am Feld — der
 *      Händler soll entscheiden können, ohne zu raten."
 *
 * Gemessen stand es an KEINEM Feld. Die Fläche rendert `etikett`, `wozu`,
 * `art`, `optionen` und `form`; `wennLeer` kam im ganzen Quelltext der Kasse
 * ausser in der Datenliste nur in EINEM Test vor, der erzwingt, dass es
 * nicht leer ist.
 *
 * Neunzehn Sätze, gepflegt und von einem Wächter bewacht, und kein Mensch
 * hat je einen davon gesehen.
 *
 * ── WARUM DAS EINE WUNDE UND KEIN SCHÖNHEITSFEHLER IST ────────────────────
 *
 * Es ist die Hausklasse „Dokument verspricht, was der Code nicht tut", und
 * das Versprechen stand hier im Kommentar des Feldes SELBST. Wer die Datei
 * las, glaubte, der Händler sehe die Folge. Er sah sie nie, und liess
 * Felder leer, ohne zu wissen, was das kostet.
 *
 * Dieselbe Klasse in der anderen Richtung: „Anzeige liest eine Tabelle, die
 * niemand füllt", nur hier ist die Tabelle gefüllt und niemand liest sie.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EINRICHTUNGS_SCHRITTE } from './einrichtungs-schritte.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ASSISTENT = resolve(HIER, 'EinrichtungsAssistent.tsx');

/** Kommentare weg. Eine Erwähnung in Prosa ist kein Gebrauch. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => davor);
}

describe('⛔ Die Folge einer fehlenden Angabe erreicht den Menschen', () => {
  const quelle = ohneKommentare(readFileSync(ASSISTENT, 'utf8'));
  const felder = EINRICHTUNGS_SCHRITTE.flatMap((s) => s.felder);

  it('es gibt überhaupt Felder mit einer Folge', () => {
    // „null ist nicht grün": ohne Felder wäre alles unten trivial erfüllt.
    expect(felder.length).toBeGreaterThan(10);
    for (const f of felder) {
      expect(f.wennLeer.trim(), `${f.schluessel} trägt keine Folge`).not.toBe('');
    }
  });

  it('⛔ die Fläche RENDERT `wennLeer` wirklich', () => {
    expect(
      /\{feld\.wennLeer\}/.test(quelle),
      'Die Fläche zeigt `wennLeer` nicht. Neunzehn sorgfältig geschriebene ' +
        'Sätze über die Folge einer fehlenden Angabe, und kein Mensch sieht ' +
        'je einen. Der Kommentar des Feldes verspricht ausdrücklich, es stehe ' +
        'direkt am Feld.',
    ).toBe(true);
  });

  it('⛔ und zwar NUR, solange das Feld wirklich leer ist', () => {
    /*
     * Ein Satz über die Folge des Weglassens, der neben einer ausgefüllten
     * Angabe stehen bleibt, ist Lärm: er warnt vor etwas, das nicht mehr
     * eintritt. Wer Lärm liest, liest bald gar nicht mehr.
     */
    expect(quelle).toMatch(/const leer = wert\.trim\(\) === ''/);
    expect(quelle).toMatch(/\{leer && <span[^>]*>\{feld\.wennLeer\}<\/span>\}/);
  });

  it('jede Folge ist ein ganzer Satz und nennt keine rohe Kennung', () => {
    for (const f of felder) {
      expect(f.wennLeer.endsWith('.'), `${f.schluessel}: die Folge ist kein Satz`).toBe(true);
      // Hausregel: kein Gedankenstrich, kein Unterstrich in sichtbarem Text.
      expect(f.wennLeer, `${f.schluessel}: Gedankenstrich`).not.toMatch(/[—–]/);
      expect(f.wennLeer, `${f.schluessel}: rohe Kennung`).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });
});
