// @vitest-environment node

/**
 * ════════════════════════════════════════════════════════════════════════
 *  EINE LISTE MIT OBERGRENZE MUSS SAGEN, DASS SIE EINE HAT
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DIE FEHLERKLASSE ───────────────────────────────────────────────────────
 *
 * Wer eine Liste mit `limit: N` holt und die Gesamtzahl nie liest, kann
 * „steht nicht auf dieser Seite" nicht von „gibt es nicht" unterscheiden. Auf
 * dem Schirm wird daraus eine unsichtbare Wand: der Bediener sucht ein Stueck,
 * findet es nicht, und schliesst, dass es keins gibt.
 *
 * ── WAS DIE MESSUNG AM 13.08.2026 FAND ─────────────────────────────────────
 *
 * Sechs Flaechen holten mit fester Obergrenze und lasen keine Gesamtzahl:
 *
 *   zielkarte-data.ts        Fixkosten, limit 50, und sie werden SUMMIERT.
 *                            Ein Betrieb mit mehr als fuenfzig laufenden
 *                            Fixkosten bekam eine zu KLEINE Summe und damit
 *                            eine Gewinnschwelle, die zu leicht aussieht.
 *                            Das ist kein kurzer Ausschnitt, das ist eine
 *                            falsche Zahl.
 *   QuickCreateDialog.tsx    Verfuegbare Stuecke, limit 200 (Servermaximum).
 *                            Ein Juwelier mit mehr sah die restlichen nicht.
 *   Spotlight.tsx            Kunden und Stuecke, je limit 5. Wer nach „Ring"
 *                            sucht und dreiundzwanzig hat, sah fuenf.
 *   Finanzen.tsx             „Laufende Fixkosten" las sich vollstaendig,
 *                            holte aber 25.
 *   TagesabschlussDialog.tsx limit 1 MIT `from`/`to`, in Ordnung, der
 *                            Zeitraum pinnt die Menge auf einen Tag.
 *   Verkauf.tsx              Suche nach einem Code, limit 10, in Ordnung,
 *                            ein Code trifft eins.
 *
 * ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
 *
 * Das ehrliche PAAR, nicht eine Dateiliste: wer mit fester Obergrenze holt,
 * muss ENTWEDER einen Zeitraum mitgeben (`from`/`to` pinnt die Menge)
 * ODER die Gesamtzahl lesen (`total`, `hasMore`, `gesamt`, `weitere`).
 *
 * So erfasst er jede kuenftige Flaeche, ohne dass sie jemand eintraegt,
 * anders als ein Waechter mit Namensliste, der beim naechsten neuen Bildschirm
 * still blind wird.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));

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

/**
 * Die Aufrufe mit fester Obergrenze, samt der Frage, ob ein Zeitraum
 * danebensteht. Absichtlich ueber die ARGUMENTLISTE, nicht ueber die ganze
 * Zeile: `limit` und `from` koennen auf verschiedenen Zeilen stehen.
 */
function aufrufeMitObergrenze(quelle: string): Array<{ args: string; hatZeitraum: boolean }> {
  const treffer: Array<{ args: string; hatZeitraum: boolean }> = [];
  const muster = /\b\w+Api\.list\(/g;
  let m = muster.exec(quelle);
  while (m !== null) {
    let i = m.index + m[0].length;
    let tiefe = 1;
    while (i < quelle.length && tiefe > 0) {
      const z = quelle[i];
      if (z === '(') tiefe += 1;
      else if (z === ')') tiefe -= 1;
      i += 1;
    }
    const args = quelle.slice(m.index + m[0].length, i - 1);
    if (/\blimit\s*:\s*(\d+|[A-Z_]{3,})/.test(args)) {
      treffer.push({ args, hatZeitraum: /\bfrom\s*:/.test(args) && /\bto\s*:/.test(args) });
    }
    muster.lastIndex = i;
    m = muster.exec(quelle);
  }
  return treffer;
}

const dateien = alleQuelldateien(HIER)
  .map((weg) => ({ name: relative(HIER, weg).split('\\').join('/'), quelle: ohneKommentare(readFileSync(weg, 'utf8')) }))
  .map((d) => ({ ...d, aufrufe: aufrufeMitObergrenze(d.quelle) }))
  .filter((d) => d.aufrufe.length > 0);

describe('Jede Liste mit fester Obergrenze nennt entweder den Zeitraum oder die Gesamtzahl', () => {
  it('der Messpunkt existiert ueberhaupt noch', () => {
    // Ein Waechter ohne Messpunkt ist still gruen.
    expect(
      dateien.length,
      'Keine einzige Flaeche holt mehr mit `limit:`. Entweder wurde der ' +
        'Zugriff gekapselt, dann gehoert dieser Waechter umgestellt, oder ' +
        'er misst ins Leere.',
    ).toBeGreaterThan(0);
  });

  it.each(dateien)('$name', ({ name, quelle, aufrufe }) => {
    const liestGesamtzahl = /\.(total|hasMore|gesamt|weitere)\b/.test(quelle);
    const ohneZeitraum = aufrufe.filter((a) => !a.hatZeitraum);
    if (ohneZeitraum.length === 0) return; // jeder Aufruf pinnt seine Menge

    expect(
      liestGesamtzahl,
      `\`${name}\` holt mit fester Obergrenze ` +
        `(${ohneZeitraum.map((a) => a.args.replace(/\s+/g, ' ').trim().slice(0, 60)).join(' | ')}) ` +
        'und liest weder `total` noch `hasMore`. Damit kann die Flaeche ' +
        '„steht nicht auf dieser Seite" nicht von „gibt es nicht" ' +
        'unterscheiden, und genau daraus wird auf dem Schirm eine ' +
        'unsichtbare Wand. Entweder einen Zeitraum (`from`/`to`) mitgeben, ' +
        'der die Menge pinnt, oder die Gesamtzahl lesen UND zeigen.',
    ).toBe(true);
  });
});
