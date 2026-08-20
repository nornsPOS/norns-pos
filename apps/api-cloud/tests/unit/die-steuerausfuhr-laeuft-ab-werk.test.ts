/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Eine frische Kasse kann am ERSTEN Tag einen Steuerexport erzeugen
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Der DATEV-Buchungsstapel verlangt sechs Ordnungsbegriffe in seiner
 * Kopfzeile, und der Export weist jede leere Pflichtangabe ab — zu Recht: ein
 * Stapel mit leeren Ordnungsbegriffen sieht aus wie ein Export und ist keiner.
 *
 * Vier der sechs hatten längst Vorgabewerte. ZWEI waren leer: Berater- und
 * Mandantennummer. Eine frische Kasse konnte damit KEINEN Steuerexport
 * erzeugen, bevor der Händler seinen Steuerberater angerufen hatte.
 *
 * Basel: die kennt kein Händler, und keiner ruft dafür vorher an. Er hat
 * recht — eine Kasse, die am ersten Tag keinen Export kann, ist am ersten Tag
 * nicht fertig.
 *
 * ── WAS DIESER WÄCHTER HÄLT ────────────────────────────────────────────────
 *
 * Zweierlei, und das zweite ist so wichtig wie das erste:
 *
 *   1. Die Saat trägt ALLE sechs Angaben, keine leer.
 *   2. Jede geratene Angabe steht in `datev.platzhalter`. Eine Vorgabe, die
 *      sich als bestätigte Angabe ausgibt, wäre die gefährlichere Variante
 *      des alten Defekts: der Händler hielte eine Zahl für abgestimmt, die
 *      niemand je gesehen hat.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const SAAT = resolve(HIER, '../../sidecar/erststart/referenz.sql');

/** Die sechs Angaben, ohne die DATEV keine Datei annimmt. */
const PFLICHT = [
  'datev.beraternummer',
  'datev.mandantennummer',
  'datev.wirtschaftsjahr_beginn',
  'datev.sachkontenlaenge',
  'datev.festschreibung',
  'datev.sachkontenrahmen',
] as const;

/** Der gesäte Wert eines Schlüssels, roh wie er in der Saat steht. */
function saatwert(saat: string, schluessel: string): string | null {
  const m = new RegExp(`\\('${schluessel.replace('.', '\\.')}',\\s*('[^']*')`).exec(saat);
  return m?.[1] ?? null;
}

describe('Die Steuerausfuhr einer frischen Kasse', () => {
  const saat = readFileSync(SAAT, 'utf8');

  it('findet die Saat überhaupt', () => {
    // Ein Wächter, der eine leere Datei liest, ist grün aus dem falschen Grund.
    expect(saat.length).toBeGreaterThan(1000);
    expect(saat).toContain('datev.');
  });

  it.each(PFLICHT)('⛔ %s ist gesät und NICHT leer', (schluessel) => {
    const wert = saatwert(saat, schluessel);
    expect(wert, `${schluessel} fehlt in der Saat`).not.toBeNull();
    expect(wert, `${schluessel} ist leer gesät — der Export bliebe blockiert`).not.toBe("''");
    expect(wert, `${schluessel} ist leer gesät — der Export bliebe blockiert`).not.toBe('\'""\'');
    expect(wert).not.toBe("'null'");
  });

  it('⛔ jede geratene Angabe steht in datev.platzhalter', () => {
    // Sonst hielte der Händler eine Vorgabe für eine abgestimmte Zahl.
    const liste = saatwert(saat, 'datev.platzhalter') ?? '';
    for (const schluessel of PFLICHT) {
      expect(liste, `${schluessel} ist gesät, aber nicht als Platzhalter ausgewiesen`).toContain(
        schluessel,
      );
    }
  });

  it('die Platzhalter der zwei Kanzleizahlen sind die üblichen', () => {
    // Recherchiert am 20.08.2026: 1001 und 99999 sind die verbreiteten
    // Platzhalter; der Steuerberater biegt den Stapel beim Import um.
    expect(saatwert(saat, 'datev.beraternummer')).toContain('1001');
    expect(saatwert(saat, 'datev.mandantennummer')).toContain('99999');
  });

  it('die Ausfuhrfläche bittet um den Blick des Steuerberaters', () => {
    // Eine Vorgabe ohne diesen Satz wäre eine stille Annahme.
    const flaeche = readFileSync(
      resolve(HIER, '../../../tauri-pos/src/screens/secondary/SteuerExport.tsx'),
      'utf8',
    );
    expect(flaeche).toContain('Steuerberater');
    expect(flaeche).toContain('Einstellungen, Steuer und Buchhaltung');
  });
});
