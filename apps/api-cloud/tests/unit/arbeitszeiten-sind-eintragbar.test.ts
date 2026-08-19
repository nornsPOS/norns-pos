/**
 * Öffnungszeiten lassen sich eintragen — sonst gibt es NIE einen Termin.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * `POST /api/appointments` prüft den gewünschten Zeitpunkt gegen die
 * SQL-Funktion `available_slots()`. Die baut ihre Kapazität aus einem
 * CROSS JOIN auf `staff_working_hours`.
 *
 * Diese Tabelle hat im ganzen Server KEINEN Schreibweg. Kein INSERT, kein
 * UPDATE, keine Route — nachgesehen, nicht vermutet. Und die Erstsaat füllt
 * sie nicht: `referenz.sql` hat sechs INSERT-Ziele, keines davon ist diese
 * Tabelle.
 *
 * Ein CROSS JOIN auf eine leere Tabelle ergibt null Zeilen. Null Zeilen heisst
 * null freie Zeitfenster. Null Zeitfenster heisst 409 — bei JEDEM Versuch, für
 * IMMER.
 *
 * Am Tresen: der Inhaber öffnet die Terminfläche, wählt einen Kunden, eine
 * Uhrzeit, drückt Anlegen und liest „Dieser Zeitpunkt ist nicht mehr frei".
 * Er versucht eine andere Uhrzeit. Denselben Satz. Einen anderen Tag.
 * Denselben Satz. Es gibt keine Uhrzeit, die je frei wäre.
 *
 * ⚠️ WARUM DAS NIEMAND BEMERKT HAT: der Integrationstest sät sich die
 * Arbeitszeiten in seiner eigenen Vorbereitung SELBST (sieben Zeilen, Mo bis
 * So, 08:00 bis 20:00). Er ist grün und beweist genau deshalb nichts über eine
 * ausgelieferte Kasse. Dieselbe Klasse wie der TSE-Riegel: der Test baut sich
 * die Welt, in der er funktioniert.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Nicht „irgendein Schreibweg existiert", sondern die Eigenschaften, ohne die
 * er wertlos wäre: er gehört dem Inhaber, er lässt keine unmöglichen Zeiten zu,
 * und er ersetzt die Woche eines Menschen als GANZES statt Zeilen anzuhäufen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pruefeWoche, WOCHENTAGE, wochentagFuerDatum } from '../../src/lib/arbeitszeiten.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTE = join(HIER, '../../src/routes/arbeitszeiten.ts');

function lies(pfad: string): string {
  try {
    return readFileSync(pfad, 'utf8');
  } catch {
    return '';
  }
}

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Die Arbeitszeiten lassen sich eintragen', () => {
  it('es gibt überhaupt eine Route dafür', () => {
    const rumpf = ohneKommentare(lies(ROUTE));
    expect(rumpf.length, 'die Route fehlt ganz').toBeGreaterThan(800);
    expect(rumpf).toMatch(/'\/api\/arbeitszeiten'/);
    expect(rumpf, 'ohne PUT lässt sich nichts setzen').toMatch(/app\.put/);
  });

  it('die Route schreibt WIRKLICH in staff_working_hours', () => {
    // Eine Route, die nur liest, wäre die höflichere Fassung desselben Fehlers.
    const rumpf = ohneKommentare(lies(ROUTE));
    expect(rumpf).toMatch(/INSERT INTO staff_working_hours/);
  });

  it('sie ersetzt die Woche als GANZES, statt Zeilen anzuhäufen', () => {
    // ⚠️ Ohne das Löschen wüchse die Tabelle bei jedem Speichern, und
    // `available_slots()` zählte dieselbe Stunde mehrfach. Der CROSS JOIN
    // multipliziert; aus zwei gleichen Zeilen würden zwei Plätze zur selben
    // Zeit, und die Kasse verspräche Termine, die es nicht gibt.
    const rumpf = ohneKommentare(lies(ROUTE));
    expect(rumpf).toMatch(/DELETE FROM staff_working_hours/);
  });

  it('sie gehört dem Inhaber', () => {
    const rumpf = ohneKommentare(lies(ROUTE));
    expect(rumpf).toMatch(/requireOwner/);
  });

  // ── Die reine Prüfung, unabhängig von der Route ────────────────────────

  it('nimmt eine gewöhnliche Woche an', () => {
    const woche = WOCHENTAGE.filter((t) => t.nummer >= 1 && t.nummer <= 5).map((t) => ({
      wochentag: t.nummer,
      von: '09:00',
      bis: '18:00',
    }));
    expect(pruefeWoche(woche).fehler).toEqual([]);
  });

  it('weist eine Zeit zurück, die vor ihrem Anfang endet', () => {
    const f = pruefeWoche([{ wochentag: 1, von: '18:00', bis: '09:00' }]).fehler;
    expect(f.length).toBe(1);
    expect(f[0]).toMatch(/nach/);
  });

  it('weist zwei Zeiten zurück, die sich am selben Tag überschneiden', () => {
    // ⚠️ Der teuerste Fall, und der unauffälligste. Zwei überlappende Zeilen
    // ergeben im CROSS JOIN doppelte Plätze zur selben Stunde: die Kasse
    // verspricht zwei Kunden denselben Termin, und beide stehen da.
    const f = pruefeWoche([
      { wochentag: 2, von: '09:00', bis: '13:00' },
      { wochentag: 2, von: '12:00', bis: '17:00' },
    ]).fehler;
    expect(f.length).toBe(1);
    expect(f[0]).toMatch(/überschneid/i);
  });

  it('lässt zwei Zeiten am selben Tag zu, wenn sie sich NICHT berühren', () => {
    // Die Mittagspause ist der Normalfall eines Ladengeschäfts, nicht die
    // Ausnahme. Ein Prüfer, der sie verbietet, wäre schlimmer als keiner.
    expect(
      pruefeWoche([
        { wochentag: 2, von: '09:00', bis: '13:00' },
        { wochentag: 2, von: '14:00', bis: '18:00' },
      ]).fehler,
    ).toEqual([]);
  });

  it('lässt zwei Zeiten zu, die sich exakt berühren', () => {
    // 13:00 bis 13:00 ist keine Überschneidung, sondern eine Grenze. Wer hier
    // zu streng prüft, macht aus einer Schichtübergabe einen Fehler.
    expect(
      pruefeWoche([
        { wochentag: 3, von: '09:00', bis: '13:00' },
        { wochentag: 3, von: '13:00', bis: '18:00' },
      ]).fehler,
    ).toEqual([]);
  });

  it('weist unmögliche Uhrzeiten und Wochentage zurück', () => {
    for (const schlecht of [
      { wochentag: 7, von: '09:00', bis: '10:00' },
      { wochentag: -1, von: '09:00', bis: '10:00' },
      { wochentag: 1, von: '25:00', bis: '26:00' },
      { wochentag: 1, von: '9:00', bis: '10:00' },
      { wochentag: 1, von: '', bis: '10:00' },
    ]) {
      expect(
        pruefeWoche([schlecht]).fehler.length,
        `${JSON.stringify(schlecht)} muss abgewiesen werden`,
      ).toBeGreaterThan(0);
    }
  });

  it('eine leere Woche ist erlaubt und heisst: dieser Mensch nimmt keine Termine', () => {
    // Nicht jeder Mitarbeiter macht Termine. Eine leere Woche zu verbieten
    // hiesse, den Inhaber zu zwingen, etwas Unwahres einzutragen.
    expect(pruefeWoche([]).fehler).toEqual([]);
  });

  /**
   * ⚠️ DER SATZ, DER MEINEN EIGENEN FEHLER GEFANGEN HAT.
   *
   * Ich hatte die übliche SQL-Zählung angenommen (Sonntag = 0, `DOW`) und
   * Montag als 1 geschrieben. `available_slots()` vergleicht aber mit
   * `EXTRACT(ISODOW FROM tag) - 1`, und ISODOW zählt Montag = 1 bis
   * Sonntag = 7. Richtig ist also MONTAG = 0.
   *
   * Mit meiner ersten Fassung wäre jede Öffnungszeit um genau einen Tag nach
   * hinten gerutscht: eingetragen Montag bis Freitag, offen Dienstag bis
   * Samstag. Der Integrationstest hätte es nie gezeigt — er sät stumpf 0 bis
   * 6 und trifft immer.
   *
   * Deshalb prüft dieser Satz gegen die SQL-QUELLE, nicht gegen meine
   * Erinnerung: die Zeile aus der Wanderung wird gelesen und die Rechnung
   * daraus nachvollzogen.
   */
  it('die Nummern stimmen mit der Rechnung in available_slots() überein', () => {
    const wanderung = readFileSync(
      join(HIER, '../../../../packages/db/migrations/0012_appointments.sql'),
      'utf8',
    );
    // Die Regel steht wörtlich so in der Wanderung. Ändert sie sich, wird
    // dieser Satz rot, statt dass die Kasse still einen Tag verschiebt.
    expect(wanderung).toMatch(/wh\.weekday = \(EXTRACT\(ISODOW FROM d\.d\)::int - 1\)/);

    // Und jetzt die Probe an echten Tagen. 03.08.2026 ist ein Montag,
    // 09.08.2026 ein Sonntag.
    const montag = new Date('2026-08-03T12:00:00');
    const sonntag = new Date('2026-08-09T12:00:00');
    expect(wochentagFuerDatum(montag)).toBe(0);
    expect(wochentagFuerDatum(sonntag)).toBe(6);

    // Die Namensliste muss dieselben Nummern tragen.
    expect(WOCHENTAGE.find((t) => t.name === 'Montag')?.nummer).toBe(
      wochentagFuerDatum(montag),
    );
    expect(WOCHENTAGE.find((t) => t.name === 'Sonntag')?.nummer).toBe(
      wochentagFuerDatum(sonntag),
    );
    expect(WOCHENTAGE.length).toBe(7);
    // Und die Reihenfolge bleibt die deutsche: Montag zuerst.
    expect(WOCHENTAGE[0]?.name).toBe('Montag');
  });
});
