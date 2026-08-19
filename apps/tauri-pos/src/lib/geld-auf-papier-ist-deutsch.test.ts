// @vitest-environment node

/**
 * ════════════════════════════════════════════════════════════════════════
 *  GELD AUF PAPIER IST DEUTSCH, UND IM SENDEKÖRPER IST ES DAS NICHT
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Aus DERSELBEN Kasse kamen zwei Geldschreibweisen:
 *
 *     Ankaufbeleg   1.512,50 €     (eigener kleiner Formatierer)
 *     Verkaufsbeleg 1512.50 €      (`fromCents` unveraendert aufs Papier)
 *
 * Auf einem deutschen Kassenbeleg ist der Punkt der TAUSENDERTRENNER.
 * „1512.50" ist dort nicht bloss ungewohnt, es ist eine andere Zahl. Und der
 * Beleg ist das Papier, das der Kunde mitnimmt und der Pruefer ansieht.
 *
 * Die Wurzel ist dieselbe wie ueberall in diesem Baum: der Ankaufweg bekam
 * seinen Fix, der Verkaufsweg blieb stehen, „der halbe Fix an derselben
 * Ampel".
 *
 * ── DIE GEGENRICHTUNG IST GENAUSO TEUER ────────────────────────────────────
 *
 * `fromCents` liefert den Punkt mit ABSICHT: derselbe Wert geht so an den
 * Server. Waehrend dieser Reparatur wurde `dezimalAlsDeutsch` versehentlich
 * auch in einen `FinalizeBody` geschrieben, mit Komma haette der Server
 * einen Betrag abgewiesen oder, schlimmer, anders gelesen.
 *
 * Deshalb misst dieser Waechter BEIDE Richtungen:
 *   · der Belegbau formatiert deutsch,
 *   · KEIN Sendekoerper tut es.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { dezimalAlsDeutsch } from '@norns/i18n-de';
import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const BEZAHLWEG = join(HIER, '../screens/verkauf/BezahlenDialog.tsx');

function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('Die eine Quelle rechnet richtig', () => {
  it('macht aus dem Punkt ein Komma und setzt den Tausendertrenner', () => {
    expect(dezimalAlsDeutsch('1512.50')).toBe('1.512,50');
    expect(dezimalAlsDeutsch('119.00')).toBe('119,00');
    expect(dezimalAlsDeutsch('0.05')).toBe('0,05');
    expect(dezimalAlsDeutsch('-42.10')).toBe('-42,10');
  });

  it('zwei Nachkommastellen, immer', () => {
    // Ein Betrag ohne Nachkommastellen sieht auf einem Beleg aus wie ein
    // abgeschnittener Betrag.
    expect(dezimalAlsDeutsch('7')).toBe('7,00');
    expect(dezimalAlsDeutsch('7.5')).toBe('7,50');
  });

  it('gibt Unlesbares unveraendert zurueck, statt eine Zahl zu erfinden', () => {
    // Lieber sichtbar falsch als still zu „0,00" gemacht: eine erfundene Null
    // auf einem Beleg ist schlimmer als ein sichtbarer Fehler.
    expect(dezimalAlsDeutsch('')).toBe('');
    expect(dezimalAlsDeutsch('keine Zahl')).toBe('keine Zahl');
  });
});

describe('Der Verkaufsbeleg traegt deutsche Betraege', () => {
  const quelle = ohneKommentare(readFileSync(BEZAHLWEG, 'utf8'));

  /** Die Felder, die auf dem Papier und in der Vorschau stehen. */
  const PAPIERFELDER = [
    'subtotalEur',
    'vatEur',
    'totalEur',
    'cashReceivedEur',
    'changeEur',
    'unitPriceEur',
    'lineTotalEur',
  ];

  /**
   * Der Belegbau, herausgeschnitten am einzigen Anker, den es dort gibt:
   * `tseSignatureValue` steht NUR im Beleg, nie in einem Sendekoerper.
   */
  function belegbau(): string {
    const anker = quelle.indexOf('tseSignatureValue:');
    expect(anker, 'Der Belegbau wurde nicht gefunden, ist er umgebaut?').toBeGreaterThan(0);
    const start = quelle.lastIndexOf('items:', anker);
    return quelle.slice(start, anker);
  }

  it.each(PAPIERFELDER)('%s wird im Belegbau deutsch formatiert', (feld) => {
    const bau = belegbau();
    const zeile = bau.split('\n').find((z) => z.trimStart().startsWith(`${feld}:`));
    expect(zeile, `\`${feld}\` steht nicht im Belegbau.`).toBeDefined();
    expect(
      /dezimalAlsDeutsch\s*\(/.test(zeile ?? ''),
      `\`${feld}\` geht ungefiltert aufs Papier: \`${(zeile ?? '').trim()}\`. ` +
        '`fromCents` liefert den Punkt (fuer den Server richtig, auf einem ' +
        'deutschen Beleg falsch, dort ist der Punkt der Tausendertrenner). ' +
        'Bitte `dezimalAlsDeutsch` aus `@norns/i18n-de` benutzen.',
    ).toBe(true);
  });
});

describe('⛔ KEIN Sendekoerper traegt ein Komma', () => {
  const quelle = ohneKommentare(readFileSync(BEZAHLWEG, 'utf8'));

  it('der FinalizeBody bleibt beim Punkt', () => {
    // Die Gegenrichtung, und sie ist die gefaehrlichere: der Server liest
    // Betraege als Dezimalzeichenketten mit Punkt. Ein Komma dort ist im
    // besten Fall eine Ablehnung und im schlechtesten eine andere Zahl.
    const i = quelle.indexOf('const body: FinalizeBody = {');
    expect(i, 'Kein `FinalizeBody` mehr im Bezahlweg gefunden.').toBeGreaterThan(0);
    const ende = quelle.indexOf('idempotencyKey:', i);
    const koerper = quelle.slice(i, ende);
    expect(
      /dezimalAlsDeutsch\s*\(/.test(koerper),
      'Im `FinalizeBody` steht `dezimalAlsDeutsch`. Der Server erwartet den ' +
        'Punkt; ein deutsches Komma verfaelscht den Betrag oder wird ' +
        'abgewiesen. Deutsch wird NUR fuer Papier und Anzeige formatiert.',
    ).toBe(false);
  });

  it('auch der Sendekoerper des Trockenlaufs bleibt beim Punkt', () => {
    // Der Trockenlauf prueft mit DENSELBEN Betraegen wie der echte Aufruf.
    // Waere er anders formatiert, prueften Probe und Ernstfall verschiedene
    // Dinge, und der GwG-Riegel haenge an der falschen Zahl.
    const i = quelle.indexOf("await api.request('POST', '/api/transactions/finalize'");
    if (i < 0) return; // kein eigener Trockenlauf mehr, dann ist nichts zu messen
    const koerper = quelle.slice(i, i + 1500);
    expect(
      /dezimalAlsDeutsch\s*\(/.test(koerper),
      'Der Trockenlauf sendet einen deutsch formatierten Betrag.',
    ).toBe(false);
  });
});
