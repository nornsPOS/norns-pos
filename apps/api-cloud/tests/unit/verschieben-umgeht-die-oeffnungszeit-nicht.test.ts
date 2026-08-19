/**
 * Verschieben darf keinen Termin in eine geschlossene Stunde legen.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * `POST /api/appointments` prüft den Wunschzeitpunkt INNERHALB der Transaktion
 * gegen `available_slots()`. Richtig und sorgfältig.
 *
 * `POST /api/appointments/:id/reschedule` prüft NICHTS dergleichen. Es liest
 * den Urtermin, prüft seinen Zustand, stellt den Ausschluss-Riegel auf
 * DEFERRED und fügt den Zwilling ein. Kein einziger Blick auf die Kapazität.
 *
 * Die Vordertür ist verschlossen, die Hintertür steht offen: derselbe Mensch,
 * der einen Termin um 03:00 Uhr am Sonntag NICHT anlegen kann, kann einen
 * bestehenden dorthin VERSCHIEBEN. Auch in einen Feiertag, auch in den Urlaub
 * des Mitarbeiters.
 *
 * ⚠️ Der Ausschluss-Riegel `appointments_no_staff_overlap` fängt das NICHT.
 * Er verhindert, dass sich zwei Termine DESSELBEN Mitarbeiters überschneiden.
 * Über Öffnungszeiten sagt er kein Wort. Ein Termin um 03:00 Uhr kollidiert
 * mit niemandem — er ist einfach nachts.
 *
 * ── WARUM NICHT EINFACH `available_slots()` AUCH HIER ─────────────────────
 *
 * Weil die Funktion belegte Zeiten ausschliesst, und beim Verschieben ist der
 * URTERMIN noch aktiv. Wer um 15 Minuten verschiebt, kollidierte mit sich
 * selbst. Einen Ausschluss-Parameter hat sie nicht: ihr sechster Parameter
 * ist `p_shop_id`, nicht „ohne diesen Termin" — nachgesehen in Wanderung 0012,
 * Zeile 441 bis 448.
 *
 * Deshalb die engere Frage, und nur sie: LIEGT DIESE STUNDE IN EINER
 * ARBEITSZEIT? Die Kollision bleibt beim Riegel, wo sie hingehört.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HIER, '../../src/routes/appointments.ts');

function quelle(): string {
  return readFileSync(ROUTE, 'utf8');
}
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Genau der Verschiebe-Block, vom Einstieg bis zum Ende der Transaktion. */
function verschiebeblock(rumpf: string): string {
  const i = rumpf.indexOf('/reschedule');
  if (i < 0) return '';
  return rumpf.slice(i, i + 4000);
}

describe('Verschieben respektiert die Öffnungszeiten', () => {
  it('findet den Verschiebe-Weg — sonst prüft dieser Test nichts', () => {
    const block = verschiebeblock(ohneKommentare(quelle()));
    expect(block.length).toBeGreaterThan(1000);
    expect(block).toMatch(/INSERT INTO appointments/);
  });

  it('der ANLEGE-Weg prüft weiterhin die Kapazität', () => {
    // Die Hälfte, die schon stimmte, darf beim Nachrüsten nicht verloren gehen.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/FROM available_slots\(/);
  });

  it('der VERSCHIEBE-Weg prüft die Arbeitszeit, bevor er einfügt', () => {
    // ⚠️ Der eigentliche Fund. Ohne diese Prüfung legt ein Verschieben den
    // Termin in jede beliebige Stunde — nachts, am Feiertag, im Urlaub.
    const block = verschiebeblock(ohneKommentare(quelle()));
    const einfuegen = block.indexOf('INSERT INTO appointments');
    const pruefung = block.indexOf('staff_working_hours');
    expect(pruefung, 'keine Arbeitszeitprüfung im Verschiebe-Weg').toBeGreaterThan(-1);
    expect(
      pruefung,
      'die Prüfung steht NACH dem Einfügen — dann ist der Termin schon gelegt',
    ).toBeLessThan(einfuegen);
  });

  it('die Prüfung benutzt dieselbe Wochentagsrechnung wie available_slots()', () => {
    // Eine zweite, eigene Rechnung würde vom Motor abdriften, und die beiden
    // Wege widersprächen sich, ohne dass jemand es merkt.
    const block = verschiebeblock(ohneKommentare(quelle()));
    expect(block).toMatch(/EXTRACT\(ISODOW/);
  });

  it('sie berücksichtigt Feiertage und Urlaub, nicht nur die Wochenstunden', () => {
    // `available_slots()` schliesst beides aus. Ein Verschiebe-Weg, der nur
    // die Wochenstunden prüft, liesse den Feiertag offen.
    const block = verschiebeblock(ohneKommentare(quelle()));
    expect(block).toMatch(/shop_holidays/);
    expect(block).toMatch(/staff_time_off/);
  });

  it('die Ablehnung sagt, WARUM — nicht nur dass es nicht geht', () => {
    const roh = quelle();
    expect(roh).toMatch(/ausserhalb der Arbeitszeit|außerhalb der Arbeitszeit/);
  });
});
