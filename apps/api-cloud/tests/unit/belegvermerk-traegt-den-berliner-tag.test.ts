/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Belegvermerk trägt den BERLINER Tag, nicht den von Greenwich
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 21.08.2026 ──────────────────────────────────────────────
 *
 * `belegvermerkFuerVatPruefung` baute sein Datum so:
 *
 *     geprueftAm.toISOString().slice(0, 10).split('-').reverse().join('.')
 *
 * `toISOString` rechnet in UTC. In der deutschen Sommerzeit (UTC+2) bekommt
 * damit JEDE Abfrage zwischen 00:00 und 02:00 Ortszeit den VORTAG aufgedruckt;
 * im Winter (UTC+1) jede zwischen 00:00 und 01:00.
 *
 * ── WARUM DAS KEIN SCHÖNHEITSFEHLER IST ────────────────────────────────────
 *
 * Dieser Satz steht AUF DEM BELEG. Er ist der Nachweis der Sorgfalt bei einer
 * § 13b-Lieferung; § 6a Abs. 4 UStG schützt den guten Glauben nur bei BELEGTER
 * Sorgfalt. Der Kommentar über der Funktion sagt es selbst: „bei einer Prüfung
 * Jahre später ist der Beleg das, was auf dem Tisch liegt."
 *
 * Und die Datenbank speichert den Zeitpunkt als `timestamptz`, also richtig.
 * Der Beleg widerspräche damit dem eigenen Datenbestand — dieselbe Klasse wie
 * der Rechtshinweis, der 19 Prozent nannte, während die Rechnung mit 16
 * rechnete.
 *
 * Ein Händler, der um halb eins nachts ein Geschäft mit einem Gewerbekunden
 * abschliesst, ist selten. Genau für den seltenen Fall wird der Beleg
 * aufbewahrt.
 */

import { describe, expect, it } from 'vitest';

import { belegvermerkFuerVatPruefung } from '../../src/lib/reverse-charge.js';

describe('⛔ Der Belegvermerk trägt den Berliner Tag', () => {
  it('⛔ Sommerzeit, 00:30 Ortszeit: der Vermerk nennt den HEUTIGEN Tag', () => {
    // 2026-08-01T00:30 in Berlin (CEST, UTC+2) ist 2026-07-31T22:30 UTC.
    const geprueft = new Date('2026-07-31T22:30:00.000Z');
    const vermerk = belegvermerkFuerVatPruefung('DE123456789', geprueft);
    expect(vermerk).toContain('01.08.2026');
    expect(vermerk).not.toContain('31.07.2026');
  });

  it('⛔ Winterzeit, 00:30 Ortszeit: derselbe Fall, eine Stunde Versatz', () => {
    // 2026-01-15T00:30 in Berlin (CET, UTC+1) ist 2026-01-14T23:30 UTC.
    const geprueft = new Date('2026-01-14T23:30:00.000Z');
    expect(belegvermerkFuerVatPruefung('DE123456789', geprueft)).toContain('15.01.2026');
  });

  it('am Umstellungswochenende stimmt es ebenfalls', () => {
    // Die Nacht auf den 25.10.2026, Rückstellung 03:00 → 02:00 Ortszeit.
    // 00:30 MESZ ist 22:30 UTC am 24.10.
    expect(belegvermerkFuerVatPruefung('DE1', new Date('2026-10-24T22:30:00.000Z'))).toContain(
      '25.10.2026',
    );
  });

  it('mitten am Tag ändert sich nichts', () => {
    const vermerk = belegvermerkFuerVatPruefung('DE123456789', new Date('2026-08-01T12:00:00Z'));
    expect(vermerk).toContain('01.08.2026');
    expect(vermerk).toContain('DE123456789');
    expect(vermerk).toContain('gültig');
  });
});
