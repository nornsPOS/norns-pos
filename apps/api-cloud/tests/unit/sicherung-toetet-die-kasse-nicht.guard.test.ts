/**
 * ════════════════════════════════════════════════════════════════════════
 *  Eine gescheiterte Sicherung fasst den laufenden Postgres NICHT an
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * `norns-sidecar.mjs` hat EINEN gemeinsamen Fehlerpfad für zwei völlig
 * verschiedene Aufgaben:
 *
 *     (sicherungAb === -1 ? main() : sicherung(…)).catch(async (e) => {
 *       …
 *       const pid = Number(readFileSync(join(PGORT, 'postmaster.pid')) …);
 *       process.kill(pid, 'SIGKILL');          // bzw. taskkill /F unter Windows
 *       process.exit(1);
 *     });
 *
 * Für den START ist das richtig: wer Postgres selbst hochgefahren hat und
 * dann scheitert, darf keine Waise zurücklassen, die das Datenverzeichnis
 * belegt.
 *
 * Für die SICHERUNG ist es zerstörerisch. Sie verbindet sich mit dem
 * LAUFENDEN Postgres. In `postmaster.pid` steht dann die Kennung des
 * Prozesses, der gerade Verkäufe bedient. Scheitert die Sicherung — Platte
 * voll, Zielordner weg, ein Netzlaufwerk nicht da — schiesst sie die Kasse
 * mitten im Verkauf ab, mit SIGKILL, ohne sauberes Herunterfahren.
 *
 * Die Kassiererin sieht einen Abbruch mitten im Bezahlen. Der nächste Start
 * läuft in die Wiederherstellung nach Absturz. Und ausgelöst hat es eine
 * Aufgabe, deren einziger Zweck es ist, Daten zu SCHÜTZEN.
 *
 * ── DIE REGEL ──────────────────────────────────────────────────────────
 *
 * Nur wer einen Prozess GESTARTET hat, darf ihn beenden. Die Sicherung hat
 * ihn nicht gestartet. Sie meldet laut und fasst nichts an.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const SIDECAR = join(HIER, '../../sidecar/norns-sidecar.mjs');

function quelle(): string {
  return readFileSync(SIDECAR, 'utf8');
}

/** Der Abschnitt zwischen zwei Marken, damit gezielt gemessen werden kann. */
function abschnitt(text: string, von: string, bis?: string): string {
  const i = text.indexOf(von);
  if (i < 0) return '';
  const j = bis ? text.indexOf(bis, i + von.length) : -1;
  return text.slice(i, j < 0 ? text.length : j);
}

describe('Die Notreinigung gehört zum START, nicht zur Sicherung', () => {
  it('findet den Sidecar und seine beiden Aufgaben', () => {
    const q = quelle();
    expect(q.length, 'Sidecar leer gelesen').toBeGreaterThan(5_000);
    expect(q, 'die Sicherung fehlt').toContain("'--sicherung'");
    expect(q, 'die Notreinigung fehlt').toContain('postmaster.pid');
  });

  it('⛔ der Fehlerpfad der SICHERUNG beendet keinen fremden Prozess', () => {
    /**
     * Gemessen wird der Zweig, der bei `--sicherung` läuft. Er darf weder
     * `postmaster.pid` lesen noch `SIGKILL` oder `taskkill` senden.
     */
    const q = quelle();
    const zweig = abschnitt(q, 'FEHLERPFAD DER SICHERUNG', 'FEHLERPFAD DES STARTS');
    expect(zweig.length, 'der eigene Fehlerpfad der Sicherung fehlt').toBeGreaterThan(50);

    for (const verboten of ['postmaster.pid', 'SIGKILL', 'taskkill']) {
      expect(
        zweig.includes(verboten),
        `Die gescheiterte Sicherung fasst „${verboten}" an. Sie hat den ` +
          'laufenden Postgres nicht gestartet und darf ihn nicht beenden.',
      ).toBe(false);
    }
  });

  it('✅ der Fehlerpfad des STARTS räumt weiterhin auf', () => {
    /**
     * Die Waise ist ein echtes Problem: sie hält das Datenverzeichnis, und
     * der nächste Start findet es belegt. Dieser Satz verhindert, dass die
     * Trennung oben die Notreinigung ganz wegnimmt — sonst hätte ich das
     * eine Loch mit einem anderen geschlossen.
     *
     * Gemessen wird zweierlei: der Startzweig RUFT die Reinigung, und die
     * Reinigung tut wirklich etwas. Ein Aufruf ins Leere wäre die Klasse
     * „gebaut und nie angeschlossen".
     */
    const q = quelle();
    const zweig = abschnitt(q, 'FEHLERPFAD DES STARTS', 'FEHLERPFAD DER SICHERUNG');
    expect(zweig.length, 'der Startzweig fehlt').toBeGreaterThan(50);
    expect(zweig, 'der Start ruft die Notreinigung nicht').toMatch(
      /await\s+raeumeVerwaistesPostgres\s*\(\s*\)/,
    );

    const reinigung = abschnitt(q, 'async function raeumeVerwaistesPostgres', '\n}\n');
    expect(reinigung).toContain('postmaster.pid');
    expect(reinigung.includes('SIGKILL') || reinigung.includes('taskkill')).toBe(true);
  });

  it('⛔ und die Sicherung ruft die Notreinigung auch nicht ÜBER den Namen', () => {
    // Der Verbotstest oben sucht `SIGKILL` und `postmaster.pid`. Ein Aufruf
    // von `raeumeVerwaistesPostgres()` enthält beides nicht und käme sonst
    // ungesehen durch — dieselbe Zerstörung, nur eine Ebene tiefer.
    const q = quelle();
    const zweig = abschnitt(q, 'FEHLERPFAD DER SICHERUNG', 'FEHLERPFAD DES STARTS');
    expect(zweig.includes('raeumeVerwaistesPostgres'), 'die Sicherung räumt fremdes weg').toBe(
      false,
    );
  });

  it('⚠️ und die beiden Aufgaben teilen sich KEINEN Fehlerpfad mehr', () => {
    // Der Kern des Befunds. Ein gemeinsames `.catch` hinter dem Fragezeichen
    // bedeutet: derselbe Aufräumcode für zwei Aufgaben mit entgegengesetzten
    // Rechten.
    const q = quelle();
    expect(
      /\(\s*sicherungAb\s*===\s*-1\s*\?\s*main\(\)\s*:\s*sicherung\([^)]*\)\s*\)\s*\.catch/.test(q),
      'Start und Sicherung hängen wieder an einem gemeinsamen catch',
    ).toBe(false);
  });
});
