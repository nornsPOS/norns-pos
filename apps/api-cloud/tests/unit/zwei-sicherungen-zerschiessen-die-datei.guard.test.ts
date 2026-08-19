/**
 * ════════════════════════════════════════════════════════════════════════
 *  Zwei gleichzeitige Sicherungen schrieben in DIESELBE Datei
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Zwei Stücke, die zusammen einen stillen Datenverlust ergeben:
 *
 *   1. `norns-sidecar.mjs` stempelte den Dateinamen auf die MINUTE
 *      (`.slice(0, 16)`). Zwei Läufe innerhalb derselben Minute trugen
 *      denselben Namen, und `writeFileSync` kürzt.
 *   2. `sicherung.rs` hatte KEINEN Riegel gegen einen zweiten Lauf.
 *
 * Ergebnis: beide Läufe melden am Ende `NORNS_SICHERUNG_FERTIG` mit Zahlen.
 * Der Händler sieht ZWEI gelungene Sicherungen und hat EINE halbe Datei.
 *
 * ⚠️ Ein Erfolgsbericht mit Zahlen über einer zerschossenen Pflicht-
 * aufzeichnung ist schlimmer als gar keine Sicherung: er beendet die Suche.
 * § 147 AO verlangt zehn Jahre Vorlagefähigkeit.
 *
 * ── WARUM DAS `laeuft` IN DER FLÄCHE NICHT GENÜGT ──────────────────────
 *
 * Es stirbt beim Aushängen der Sektion — der Mensch wechselt den Reiter,
 * und der Riegel ist weg, während der Lauf weitergeht. Ein Riegel, der im
 * Fenster wohnt, bewacht nichts, was länger lebt als das Fenster.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');
const lies = (p: string): string => readFileSync(join(REPO, p), 'utf8');

const SIDECAR = 'apps/api-cloud/sidecar/norns-sidecar.mjs';
const RUMPF = 'apps/tauri-pos/src-tauri/src/sicherung.rs';

describe('⛔ Der Dateiname trägt die Sekunde', () => {
  it('⛔ nicht mehr die Minute', () => {
    /**
     * `.slice(0, 16)` gab ein Fenster von sechzig Sekunden, in dem zwei
     * Läufe denselben Namen tragen. Die Sekunde nimmt dem Zusammenstoss das
     * Fenster; der eigentliche Riegel sitzt im Rumpf.
     */
    const q = lies(SIDECAR);
    expect(q, 'der Minutenstempel ist zurück').not.toMatch(
      /toISOString\(\)\.slice\(0, 16\)/,
    );
    expect(q).toMatch(/toISOString\(\)\.slice\(0, 19\)/);
  });

  it('⚠️ und die ausgelieferte Kopie trägt ihn auch', () => {
    // Ausgeliefert wird die Kopie. Ein Fix nur in der Quelle wirkt auf der
    // Kasse des Händlers NIE.
    expect(lies('apps/tauri-pos/src-tauri/resources/sidecar/norns-sidecar.mjs')).toBe(lies(SIDECAR));
  });
});

describe('⛔ Ein zweiter Lauf wird abgewiesen', () => {
  it('⛔ der Riegel wohnt im RUMPF, nicht im Fenster', () => {
    /**
     * Ein `useState`-Riegel in der Fläche stirbt beim Reiterwechsel. Der
     * Riegel muss den Prozess überleben, nicht die Ansicht.
     */
    const q = lies(RUMPF);
    expect(q, 'kein Riegel im Rumpf').toContain('static LAEUFT');
    expect(q).toContain('AtomicBool');
  });

  it('⛔ und er wird mit compare_exchange genommen, nicht mit load und store', () => {
    /**
     * `if !LAEUFT.load() { LAEUFT.store(true) }` hat zwischen Lesen und
     * Schreiben ein Fenster, durch das der zweite Lauf genau dann schlüpft,
     * wenn beide gleichzeitig gedrückt werden — also im einzigen Fall, für
     * den der Riegel gebaut ist.
     */
    const q = lies(RUMPF);
    expect(q, 'der Riegel hat ein Fenster').toContain('compare_exchange');
  });

  it('⛔ und er wird beim Verlassen ZURÜCKGEGEBEN, auch bei einem frühen Abbruch', () => {
    /**
     * Ohne `Drop` bliebe der Riegel nach dem ersten Fehlschlag für immer
     * genommen: die Sicherung wäre dauerhaft gesperrt, und der Händler käme
     * nie wieder an eine. Ein Riegel, der klemmt, ist schlimmer als keiner.
     */
    const q = lies(RUMPF);
    expect(q).toMatch(/impl Drop for Einmalriegel/);
    expect(q).toMatch(/LAEUFT\.store\(false/);
  });

  it('⛔ der Riegel steht VOR allen anderen Handgriffen', () => {
    /**
     * Stünde er hinter dem Tresorzugriff, liefen zwei Läufe schon parallel,
     * bevor einer abgewiesen wird — und der Tresor würde zweimal gefragt.
     */
    const q = lies(RUMPF);
    const fn = q.slice(q.indexOf('pub fn sicherung_jetzt('));
    const riegel = fn.indexOf('Einmalriegel::nehmen()');
    const tresor = fn.indexOf('keyring::Entry::new');
    expect(riegel, 'der Riegel wird nicht genommen').toBeGreaterThan(-1);
    expect(tresor).toBeGreaterThan(-1);
    expect(riegel, 'der Riegel steht hinter dem Tresor').toBeLessThan(tresor);
  });

  it('⚠️ und der abgewiesene Lauf bekommt einen deutschen Satz mit Handgriff', () => {
    const q = lies(RUMPF);
    const i = q.indexOf('Es läuft bereits eine Sicherung');
    expect(i, 'kein Satz für den zweiten Lauf').toBeGreaterThan(-1);
    expect(q.slice(i, i + 200)).toMatch(/warten|erneut/i);
  });
});
