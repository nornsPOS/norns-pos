/**
 * Keine Geräteflächen zeigt je wieder eine rohe Ablehnung.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * In der Druckererkennung stand dem Händler wörtlich `[object Object]` im
 * Hinweisfenster, über ein Gerät, das er in der Hand hielt.
 *
 * Die Ursache ist klein und war an VIERZEHN Stellen dieselbe:
 *
 *     err instanceof Error ? err.message : String(err)
 *     isHardwareError(err) ? describeHardwareError(err) : String(err)
 *
 * Der Rumpf lehnt nicht mit einem `Error` ab, sondern mit dem serialisierten
 * `{ kind, details }` aus `src-tauri/src/error.rs:23`. `String({…})` ergibt
 * `[object Object]`.
 *
 * Besonders tückisch am zweiten Muster: der Rückfall greift GENAU dann, wenn
 * die Form unbekannt ist — also im schlimmsten Moment, in dem man die beste
 * Auskunft bräuchte.
 *
 * ── WARUM EIN WÄCHTER UND NICHT NUR EIN FIX ────────────────────────────────
 *
 * `String(err)` ist der bequemste Ausdruck, den man in einem Fehlerzweig
 * schreiben kann. Er sieht harmlos aus, er übersetzt sich in jeder anderen
 * Sprache, und er ist auf einem Tauri-Rumpf immer falsch. Ohne diesen Wächter
 * kommt er beim nächsten Fehlerzweig zurück.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLEN = join(HIER, '../..');

/**
 * Die Flächen, die mit dem RUMPF sprechen und deshalb seine Ablehnungsform
 * abbekommen. Sie stehen namentlich da, damit ein verschobener Pfad auffällt
 * statt still aus der Prüfung zu fallen.
 */
const GERAETEFLAECHEN = [
  'screens/secondary/DruckerErkennen.tsx',
  'screens/secondary/GeraeteManager.tsx',
];

function lies(relativ: string): string {
  return readFileSync(join(QUELLEN, relativ), 'utf8');
}

/** Kommentare weg: die Erklärung dieses Fundes darf ihn nicht selbst auslösen. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Keine rohe Ablehnung auf einer Gerätefläche', () => {
  it('findet die Flächen — sonst prüft dieser Test nichts', () => {
    for (const f of GERAETEFLAECHEN) {
      expect(lies(f).length, `${f} ist leer oder fehlt`).toBeGreaterThan(1000);
    }
    expect(GERAETEFLAECHEN.length).toBe(2);
  });

  it('keine Fläche stellt eine Ablehnung mit String() dar', () => {
    const treffer: string[] = [];
    for (const f of GERAETEFLAECHEN) {
      const rumpf = ohneKommentare(lies(f));
      for (const [i, zeile] of rumpf.split('\n').entries()) {
        // `String(err)`, `String(e)`, `String(fehler)` — jede Schreibweise.
        if (/String\(\s*(err|e|fehler|error)\s*\)/.test(zeile)) {
          treffer.push(`${f}:${i + 1}`);
        }
      }
    }
    expect(
      treffer,
      `Diese Stellen zeigen dem Händler „[object Object]", sobald der Rumpf ablehnt:\n  ${treffer.join('\n  ')}`,
    ).toEqual([]);
  });

  it('beide Flächen benutzen die Druckerdiagnose', () => {
    // Der Gegenbeweis zum Satz oben: `String(err)` könnte auch dadurch
    // verschwinden, dass jemand den ganzen Fehlerzweig löscht. Dann wäre die
    // Fläche still statt falsch, und das ist nicht besser.
    for (const f of GERAETEFLAECHEN) {
      const rumpf = ohneKommentare(lies(f));
      expect(rumpf, `${f} übersetzt Ablehnungen nicht`).toMatch(/diagnoseAlsZeile/);
    }
  });

  it('findet auch neue Geräteflächen, die jemand hinzufügt', () => {
    // ⚠️ Eine namentliche Liste wird blind, sobald jemand eine dritte Fläche
    // baut. Dieser Satz sucht deshalb im GANZEN Baum nach Flächen, die den
    // Rumpf rufen UND `String(err)` benutzen.
    const verdaechtig: string[] = [];
    const suche = (ordner: string): void => {
      for (const e of readdirSync(ordner, { withFileTypes: true })) {
        const pfad = join(ordner, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === 'dist') continue;
          suche(pfad);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const roh = ohneKommentare(readFileSync(pfad, 'utf8'));
          // Spricht die Datei mit dem Rumpf?
          const ruftRumpf = /@tauri-apps\/api|invoke\(|hardware-client/.test(roh);
          if (ruftRumpf && /String\(\s*(err|e|fehler|error)\s*\)/.test(roh)) {
            verdaechtig.push(pfad.slice(QUELLEN.length + 1));
          }
        }
      }
    };
    suche(QUELLEN);
    expect(
      verdaechtig,
      `Diese Flächen rufen den Rumpf UND zeigen seine Ablehnung roh:\n  ${verdaechtig.join('\n  ')}`,
    ).toEqual([]);
  });
});
