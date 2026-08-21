// @vitest-environment node
//
// Diese Prüfung rechnet nichts, sie liest Quelltext — wie der Bewegungs- und
// der Marken-Wächter, und aus demselben Grund im Node-Umfeld.

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Ein Kalendertag wird NIE aus `toISOString()` geschnitten
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 21.08.2026, VIER STELLEN AUF EINMAL ─────────────────────
 *
 *     const tag = zeitpunkt.toISOString().slice(0, 10);
 *
 * sieht harmlos aus und ist der UTC-Tag. In deutscher Sommerzeit (UTC+2)
 * fällt damit ALLES zwischen 00:00 und 02:00 Ortszeit auf den VORTAG, im
 * Winter alles zwischen 00:00 und 01:00.
 *
 * Gefunden an vier Stellen, zwei davon teuer:
 *
 *   • `belegvermerkFuerVatPruefung` druckte das Datum der EU-Abfrage AUF DEN
 *     BELEG — den Sorgfaltsnachweis nach § 6a Abs. 4 UStG, den ein Prüfer
 *     Jahre später auf dem Tisch hat. Er hätte dem `timestamptz` in der
 *     Datenbank widersprochen.
 *   • Der Einrichtungsassistent schlug `betrieb.inbetriebnahme_am` vor — das
 *     Datum, das nach § 146a Abs. 4 AO ans Finanzamt gemeldet wird, EINMAL
 *     gesetzt und nie wieder angefasst.
 *
 * Die anderen beiden (Vorfallprotokoll, Kursfenster) waren klein. Aber es ist
 * dieselbe Rechnung, und zwei Rechnungen sind zwei Wahrheiten.
 *
 * ── WARUM EIN WÄCHTER UND NICHT VIER KORREKTUREN ───────────────────────────
 *
 * Basel am selben Tag: warum findet jeder Durchgang neue Fehler. Weil eine
 * Korrektur EINE Stelle heilt und ein Wächter die KLASSE schliesst. Diese
 * Zeile ist zu bequem, um sie durch Vorsatz zu vermeiden; sie muss unmöglich
 * werden.
 *
 * ── DIE EINE ERLAUBTE AUSNAHME ─────────────────────────────────────────────
 *
 *     const d = new Date(`${tag}T00:00:00.000Z`);
 *     if (d.toISOString().slice(0, 10) !== tag) return false;
 *
 * Hier wird kein Zeitpunkt in einen Tag verwandelt, sondern eine Zeichenkette
 * gegen sich selbst geprüft (`2026-02-30` ist in JavaScript der 2. März, nicht
 * `Invalid`). Beide Seiten sind UTC, es hebt sich auf. Erkannt am
 * `T00:00:00` in der Nähe.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** Wo gesucht wird. Der gebündelte Beiläufer und Erzeugnisse bleiben aussen. */
const ORTE = ['apps/api-cloud/src', 'apps/tauri-pos/src', 'packages'];

/** Der Griff, der einen Zeitpunkt zum UTC-Tag macht. */
const UTC_TAG =
  /\.toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)|split\('T'\)\s*\[\s*0\s*\])/;

function dateien(wurzel: string): string[] {
  const raus: string[] = [];
  const gehe = (ort: string): void => {
    let namen: string[];
    try {
      namen = readdirSync(ort);
    } catch {
      return;
    }
    for (const name of namen) {
      if (name === 'node_modules' || name === 'dist' || name === 'src-tauri') continue;
      const voll = join(ort, name);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) raus.push(voll);
    }
  };
  gehe(wurzel);
  return raus;
}

/** Ist DIESE Zeile der erlaubte Rückvergleich? */
function istRueckvergleich(zeilen: readonly string[], nr: number): boolean {
  const fenster = zeilen.slice(Math.max(0, nr - 3), nr + 2).join('\n');
  return /T00:00:00/.test(fenster);
}

/**
 * Steht der Griff INNERHALB einer Erwartung?
 *
 * ⚠️ Die zweite erlaubte Ausnahme, und sie hat ein Prinzip: der Wächter
 * fragt, wohin ein Wert FLIESST. Aus einer Erwartung fliesst er nirgendwohin
 * — dort wird der falsche Weg VORGEFÜHRT, damit die Probe zeigt, was sie
 * verhindert (`umsatzsteuersaetze.test.ts` tut genau das).
 *
 * Eine Zuweisung in einer Probe bleibt dagegen bewacht: auch eine Probe kann
 * sich mit einem UTC-Tag selbst belügen.
 */
function stehtInErwartung(zeile: string): boolean {
  return /\bexpect\s*\(/.test(zeile);
}

describe('⛔ Ein Kalendertag wird nie aus toISOString geschnitten', () => {
  const alle = ORTE.flatMap((o) => dateien(join(WURZEL, o)));

  it('findet überhaupt Dateien — der Wächter darf nicht ins Leere greifen', () => {
    expect(alle.length).toBeGreaterThan(300);
  });

  it('⛔ keine Stelle macht aus einem Zeitpunkt den UTC-Tag', () => {
    const suender: string[] = [];
    for (const datei of alle) {
      const roh = readFileSync(datei, 'utf8');
      // Kommentare zählen nicht: sonst schlägt der Wächter auf die
      // Erklärungen an, die vor genau diesem Griff warnen — genau die
      // Falle, in die der Filter-Wächter am 20.08. getappt ist.
      const zeilen = roh
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .split('\n')
        .map((z) => (z.trim().startsWith('//') ? '' : z));
      zeilen.forEach((zeile, i) => {
        if (!UTC_TAG.test(zeile)) return;
        if (istRueckvergleich(zeilen, i)) return;
        if (stehtInErwartung(zeile)) return;
        suender.push(`${datei.slice(WURZEL.length + 1)}:${i + 1}`);
      });
    }
    expect(
      suender,
      'Diese Stellen machen aus einem Zeitpunkt den UTC-Tag. In deutscher ' +
        'Sommerzeit fällt damit alles zwischen 00:00 und 02:00 Ortszeit auf den ' +
        'VORTAG. Richtig ist `alsTag()` aus @norns/domain (Europe/Berlin).',
    ).toEqual([]);
  });
});
