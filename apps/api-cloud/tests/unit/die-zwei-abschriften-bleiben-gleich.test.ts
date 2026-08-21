// @vitest-environment node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Die zwei Abschriften des Beiläufers bleiben Wort für Wort gleich
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM ES ZWEI GIBT ─────────────────────────────────────────────────────
 *
 *     apps/api-cloud/sidecar/norns-sidecar.mjs          die Quelle
 *     apps/tauri-pos/src-tauri/resources/sidecar/…      was AUSGELIEFERT wird
 *
 * Die zweite reist im Programmpaket mit; sie ist die, die beim Händler
 * wirklich startet. Die erste ist die, an der gearbeitet wird.
 *
 * ── DER BEFUND VOM 21.08.2026 ──────────────────────────────────────────────
 *
 * An EINEM Tag musste ich sie DREIMAL von Hand gleichziehen: beim Eintragen
 * der Wanderung 0151, beim Start der Kettenprüfung und beim Rollen-Riegel.
 * Jedes Mal war es dieselbe Bewegung, jedes Mal hätte ich eine vergessen
 * können — und nichts hätte es gemeldet.
 *
 * ⚠️ WAS EIN AUSEINANDERLAUFEN BEDEUTET: die Quelle bekommt eine Korrektur,
 * das ausgelieferte Bündel nicht. Alle Proben lesen dann die geheilte Datei,
 * während beim Händler die kranke läuft. Das ist die schlimmste Sorte Fehler
 * — grün im Werk, kaputt im Laden.
 *
 * ── WARUM GLEICHHEIT UND NICHT „aehnlich genug" ────────────────────────────
 *
 * Es gibt keinen Grund, warum die zwei sich unterscheiden dürften. Kein
 * Pfad, keine Fassung, keine Umgebung steht darin — der Beiläufer liest alles
 * aus der Umgebung. Also: Wort für Wort, oder ein Befund.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const QUELLE = join(WURZEL, 'apps/api-cloud/sidecar');
const AUSGELIEFERT = join(WURZEL, 'apps/tauri-pos/src-tauri/resources/sidecar');

function abdruck(pfad: string): string {
  return createHash('sha256').update(readFileSync(pfad)).digest('hex').slice(0, 16);
}

/** Alle Dateien unter einem Ordner, relativ, sortiert. */
function dateienUnter(wurzel: string): string[] {
  const raus: string[] = [];
  const gehe = (ort: string, vorsatz: string): void => {
    for (const name of readdirSync(ort).sort()) {
      const voll = join(ort, name);
      if (statSync(voll).isDirectory()) gehe(voll, `${vorsatz}${name}/`);
      else raus.push(`${vorsatz}${name}`);
    }
  };
  gehe(wurzel, '');
  return raus;
}

describe('⛔ Die zwei Abschriften des Beiläufers', () => {
  it('⛔ `norns-sidecar.mjs` ist Wort für Wort dieselbe Datei', () => {
    const a = join(QUELLE, 'norns-sidecar.mjs');
    const b = join(AUSGELIEFERT, 'norns-sidecar.mjs');
    expect(
      abdruck(b),
      'Die ausgelieferte Abschrift weicht von der Quelle ab. Alle Proben lesen ' +
        'die Quelle — beim Händler liefe dann eine andere Datei. Der Weg: die ' +
        'Änderung in BEIDE tragen, dann `node scripts/buendle-motor.mjs`.',
    ).toBe(abdruck(a));
  });

  it('⛔ die Nachzügler-Wanderungen liegen beidseitig gleich', () => {
    /*
     * Dieselbe Falle eine Ebene tiefer: eine Wanderung, die nur in der Quelle
     * liegt, erreicht KEINE ausgelieferte Kasse. Der Wächter
     * `nachzuegler-liegen-im-buendel` prüft, dass jede VERLANGTE Wanderung als
     * Datei da ist — dieser hier, dass beide Seiten dieselben Dateien führen.
     */
    const a = dateienUnter(join(QUELLE, 'erststart/nachzuegler'));
    const b = dateienUnter(join(AUSGELIEFERT, 'erststart/nachzuegler'));
    expect(b, 'die zwei Nachzügler-Ordner führen verschiedene Dateien').toEqual(a);
    for (const name of a) {
      expect(
        abdruck(join(AUSGELIEFERT, 'erststart/nachzuegler', name)),
        `${name} unterscheidet sich zwischen Quelle und Auslieferung`,
      ).toBe(abdruck(join(QUELLE, 'erststart/nachzuegler', name)));
    }
  });

  it('der Wächter greift nicht ins Leere', () => {
    // „null ist nicht grün": faende `dateienUnter` nichts, waere oben alles
    // trivial erfuellt.
    expect(dateienUnter(join(QUELLE, 'erststart/nachzuegler')).length).toBeGreaterThan(5);
  });
});
