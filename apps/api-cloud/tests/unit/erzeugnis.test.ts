/**
 * ════════════════════════════════════════════════════════════════════════
 *  DIE KASSE NENNT SICH GEGENUEBER DEM FINANZAMT NUR AUS EINER QUELLE
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 01.08.2026 ──────────────────────────────────────────────
 *
 * In der amtlichen Ausfuhr standen zwei fest eingetippte Marken, und beide
 * nannten den falschen Namen:
 *
 *     routes/closing-export.ts   brand:   'Warehouse14'
 *     lib/dsfinvk-daten.ts       swBrand: 'warehouse14'
 *
 * Beide landen in `cashregister.csv` der DSFinV-K, in `KASSE_BRAND` und
 * `KASSE_SW_BRAND`. Die amtliche Beschreibung nennt sie „Marke der Kasse" und
 * „Markenbezeichnung der Software": das ist die Aussage der Kasse ueber sich
 * selbst gegenueber dem Finanzamt. Der Haendler zog seinen Steuerexport und
 * meldete dem Pruefer die Marke einer fremden Firma.
 *
 * ── ⚠️ WARUM ES DIESE DATEI GIBT ───────────────────────────────────────────
 *
 * `src/lib/erzeugnis.ts` verspricht seit dem 01.08.2026 in seinem eigenen
 * Kopf woertlich:
 *
 *     „Der Waechter `erzeugnis.test.ts` haelt die Namen fest und geht rot,
 *      sobald irgendwo wieder eine Marke von Hand danebengeschrieben wird."
 *
 * Gemessen am 13.08.2026: **diese Datei gab es nicht.** Der Riegel stand in
 * einem Kommentar und nirgends sonst. Hausklasse „ein Kommentar ist kein
 * Riegel", und die teuerste Sorte davon: einer, der einem sagt, man koenne
 * aufhoeren zu suchen.
 *
 * ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
 *
 * 1. Die Groessen tragen wirklich den Namen dieses Hauses.
 * 2. NIEMAND schreibt daneben eine Marke von Hand. Gemessen wird die
 *    Zuweisung an die amtlichen Felder, nicht die blosse Erwaehnung eines
 *    Wortes: ein Kommentar, der den alten Namen erklaert, ist erlaubt und
 *    soll es bleiben.
 * 3. Der Baum kennt den fremden Namen nirgends mehr in einer Zuweisung an
 *    diese Felder.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ERZEUGNIS_MARKE,
  ERZEUGNIS_MODELL,
  ERZEUGNIS_SOFTWARE_MARKE,
} from '../../src/lib/erzeugnis.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLE = join(HIER, '../../src');

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
      if (eintrag.name.endsWith('.ts')) gefunden.push(weg);
    }
  };
  gehen(wurzel);
  return gefunden;
}

function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** Die Felder, die beim Finanzamt landen. */
const AMTLICHE_FELDER = ['brand', 'swBrand', 'model', 'KASSE_BRAND', 'KASSE_SW_BRAND'] as const;

describe('⛔ Die Kasse nennt sich nur aus einer Quelle', () => {
  it('die Groessen tragen den Namen dieses Hauses', () => {
    expect(ERZEUGNIS_MARKE).toBe('Norns');
    expect(ERZEUGNIS_SOFTWARE_MARKE).toBe('Norns');
    expect(ERZEUGNIS_MODELL).toBe('Norns POS');
  });

  it('⚠️ und keine der Groessen ist leer', () => {
    // Eine leere Marke waere schlimmer als eine falsche: sie sieht im
    // Ausfuhrblatt aus wie eine fehlende Angabe und wird zur Rueckfrage.
    for (const [name, wert] of Object.entries({
      ERZEUGNIS_MARKE,
      ERZEUGNIS_SOFTWARE_MARKE,
      ERZEUGNIS_MODELL,
    })) {
      expect(wert.trim().length, `${name} ist leer`).toBeGreaterThan(0);
    }
  });

  const dateien = alleQuelldateien(QUELLE)
    .filter((d) => !d.endsWith('erzeugnis.ts'))
    .map((d) => ({ name: relative(QUELLE, d), quelle: ohneKommentare(readFileSync(d, 'utf8')) }));

  it('der Messpunkt existiert ueberhaupt', () => {
    // Ein Waechter ohne Messpunkt ist still gruen.
    expect(dateien.length, 'Keine Quelldateien gefunden.').toBeGreaterThan(50);
  });

  it('⛔ niemand schreibt eine Marke von Hand an ein amtliches Feld', () => {
    const verstoesse: string[] = [];
    for (const { name, quelle } of dateien) {
      for (const feld of AMTLICHE_FELDER) {
        // `brand: 'irgendwas'` mit einer ZEICHENKETTE statt einer Groesse.
        const muster = new RegExp(`\\b${feld}\\s*:\\s*(['"\`])([^'"\`]{1,60})\\1`, 'g');
        for (const treffer of quelle.matchAll(muster)) {
          verstoesse.push(`${name}: ${feld}: '${treffer[2]}'`);
        }
      }
    }
    expect(
      verstoesse,
      'Hier steht eine Marke als feste Zeichenkette an einem Feld, das in der ' +
        'DSFinV-K beim Finanzamt landet (`KASSE_BRAND`, `KASSE_SW_BRAND`). Genau ' +
        'so meldete die Kasse am 01.08.2026 die Marke einer FREMDEN Firma. Die ' +
        'Werte gehoeren aus `src/lib/erzeugnis.ts`, damit es eine einzige ' +
        'Wahrheit gibt.',
    ).toEqual([]);
  });

  it('⛔ und der fremde Name steht in keiner solchen Zuweisung mehr', () => {
    // Die Gegenprobe zum Befund selbst. Gemessen wird die ZUWEISUNG, nicht das
    // Wort: `warehouse14` kommt als Paketname („@norns/db") ueberall vor
    // und ist dort voellig richtig.
    const verstoesse: string[] = [];
    for (const { name, quelle } of dateien) {
      for (const treffer of quelle.matchAll(
        /\b(brand|swBrand|model|KASSE_BRAND|KASSE_SW_BRAND)\s*:\s*(['"`])([^'"`]*[Ww]arehouse\s*14[^'"`]*)\2/g,
      )) {
        verstoesse.push(`${name}: ${treffer[1]}: '${treffer[3]}'`);
      }
    }
    expect(
      verstoesse,
      'Der Name einer fremden Firma steht wieder an einem amtlichen Feld.',
    ).toEqual([]);
  });
});
