/**
 * ⛔ WÄCHTER: Die Sicherungsmeldung des Schichtschlusses darf den
 * Tagesabschluss nicht für gebucht erklären.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER NACHGEMESSENE BEFUND VOM 13.08.2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `ZBonDialog.tsx` schliesst die SCHICHT (`shiftsApi.close`) und stösst danach
 * die Sicherung an (`lib/sichere-nach-abschluss.ts:35`). Scheitert sie, lautet
 * ihr Satz (`lib/sicherung-nach-abschluss.ts:78`):
 *
 *     „Der Tagesabschluss ist gebucht. Nur die automatische Sicherung danach
 *      hat nicht geklappt: …"
 *
 * Zu diesem Zeitpunkt ist KEIN Tagesabschluss gelaufen: `closingsApi.finalize`
 * wird von dieser Fläche nie gerufen. Der Händler liest, der Tag sei durch, und
 * geht nach Hause — ohne Zeile in `daily_closings` und damit ohne
 * Kassenbericht, DATEV und DSFinV-K für diesen Tag (§ 146 Abs. 1 Satz 2 AO).
 *
 * ── WAS DIESER WÄCHTER MISST ──────────────────────────────────────────────
 *
 * Nicht eine Abschrift des Satzes, sondern den ECHTEN Satz: `gescheitertSatz`
 * wird hier wirklich gerufen und durch den Umschreiber geschickt, den
 * `ZBonDialog.tsx` benutzt. Wird der Wortlaut in `lib/` geändert, greift der
 * Umschreiber womöglich nicht mehr — und genau dann wird dieser Wächter rot,
 * statt still eine wieder falsche Meldung durchzulassen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gelungenSatz, gescheitertSatz } from '../../lib/sicherung-nach-abschluss.js';

import {
  grundAusSicherungssatz,
  meldungNachSchichtschluss,
  sicherungssatzNachSchichtschluss,
} from './sicherungsmeldung-schichtschluss.js';

const GRUND = 'Der Ordner ist nicht beschreibbar.';

describe('⛔ Die Sicherungsmeldung nach dem Schichtschluss lügt nicht', () => {
  it('der ECHTE Satz aus lib behauptet den gebuchten Tagesabschluss (der Befund)', () => {
    // Kein Fix, sondern die Messung: solange dieser Satz so lautet, MUSS ihn
    // der Schichtschluss umschreiben.
    expect(gescheitertSatz(GRUND)).toContain('Der Tagesabschluss ist gebucht');
  });

  it('nach dem Umschreiben steht die Behauptung nicht mehr da', () => {
    const satz = sicherungssatzNachSchichtschluss(gescheitertSatz(GRUND));
    expect(
      satz,
      'Der Schichtschluss erklärt den Tagesabschluss weiterhin für gebucht. ' +
        'Er hat nicht stattgefunden — genau dieser Satz liess den Händler mit ' +
        'einem offenen Kassentag nach Hause gehen.',
    ).not.toContain('Tagesabschluss ist gebucht');
  });

  it('und sagt stattdessen, was wirklich gilt', () => {
    const satz = sicherungssatzNachSchichtschluss(gescheitertSatz(GRUND));
    expect(satz).toContain('Die Schicht ist abgeschlossen');
    expect(satz, 'Der offene Rest des Tages wird nicht genannt.').toMatch(
      /Tagesabschluss steht noch aus/,
    );
  });

  it('⛔ und verliert den GRUND der Ablehnung nicht', () => {
    const satz = sicherungssatzNachSchichtschluss(gescheitertSatz(GRUND));
    expect(
      satz,
      'Ohne den Grund liest der Händler nur „hat nicht geklappt" und weiss ' +
        'nicht, ob ein Ordner fehlt oder die Platte voll ist.',
    ).toContain(GRUND);
    expect(satz, 'Der Weg zum Nachholen fehlt.').toContain('von Hand nachholen');
  });

  it('⛔ der Umschreiber greift wirklich — er ist keine stille Attrappe', () => {
    expect(
      grundAusSicherungssatz(gescheitertSatz(GRUND)),
      'Die Form von `gescheitertSatz` passt nicht mehr zur Schablone in ' +
        '`sicherungsmeldung-schichtschluss.ts`. Der Umschreiber fällt dann auf ' +
        'seinen Notsatz zurück und der GRUND geht verloren. Hier nachsehen, ' +
        'bevor jemand den Notsatz für das normale Verhalten hält.',
    ).toBe(GRUND);
  });

  it('lässt die Erfolgsmeldung unangetastet (sie behauptet nichts Falsches)', () => {
    const erfolg = {
      tone: 'success' as const,
      title: 'Sicherung angelegt',
      body: gelungenSatz('norns-sicherung-2026-08-13.sql.gz', 12_345),
    };
    expect(meldungNachSchichtschluss(erfolg)).toEqual(erfolg);
  });

  it('schreibt fremde Meldungen ohne falsche Zusage nicht um', () => {
    const fremd = {
      tone: 'alert' as const,
      title: 'Sicherung ausgefallen',
      body: 'Der Zielordner wurde entfernt.',
    };
    expect(meldungNachSchichtschluss(fremd)).toEqual(fremd);
  });

  it('⛔ und der Schichtschluss benutzt den Umschreiber auch wirklich', () => {
    // „Gebaut ist nicht angeschlossen": ein Umschreiber, den niemand ruft,
    // hätte die Lüge nur in eine zweite Datei verschoben.
    const quelle = leseDialog();
    expect(
      quelle,
      'Der Schichtschluss reicht die Sicherungsmeldung wieder ungefiltert an ' +
        '`addToast` weiter. Dann steht „Der Tagesabschluss ist gebucht" erneut ' +
        'auf dem Schirm.',
    ).not.toMatch(/sichereNachAbschluss\s*\(\s*addToast\s*\)/);
    expect(quelle).toMatch(/sichereNachAbschluss\s*\(\s*meldeSicherung\s*\)/);
    expect(quelle).toMatch(/meldungNachSchichtschluss\s*\(/);
  });
});

/** Der Quelltext des Schichtschlussfensters ohne Kommentare. */
function leseDialog(): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ZBonDialog.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}
