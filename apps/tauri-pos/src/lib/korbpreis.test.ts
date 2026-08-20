/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Korb bucht den Preis, den die Kasse WEISS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Die Kasse rechnete den Tagespreis aus dem laufenden Metallkurs, zeigte ihn
 * auf der Katalogkachel — und buchte den gespeicherten Preis. Die Fläche sagte
 * dem Händler wörtlich, er möge den Tagespreis von Hand ins Lager übertragen.
 * Jeden Morgen, für jedes Stück.
 *
 * Was hier festgeschrieben wird, ist die Regel, die das beendet, samt ihrer
 * Ausnahmen — denn beide sind gleich wichtig: der Tagespreis gilt, WENN es
 * einen gibt, und niemals rät die Kasse einen herbei.
 */

import { describe, expect, it } from 'vitest';

import {
  geltenderPreis,
  KURSTAKT_SEKUNDEN,
  type Preisauskunft,
  sekundenBisZumNaechstenKurs,
} from './korbpreis.js';

const auskunft = (teil: Partial<Preisauskunft>): Preisauskunft => ({
  productId: 'p1',
  listPriceEur: '100.00',
  kurspreisEur: null,
  kurspreisGrund: null,
  festerPreis: false,
  ...teil,
});

describe('Welcher Preis gilt', () => {
  it('⛔ der TAGESPREIS gilt, sobald es einen gibt', () => {
    const p = geltenderPreis('100.00', auskunft({ kurspreisEur: '123.45' }));
    expect(p.preisEur).toBe('123.45');
    expect(p.herkunft).toBe('tagespreis');
  });

  it('ohne Tagespreis gilt der gespeicherte — mit dem Grund im Klartext', () => {
    const p = geltenderPreis('100.00', auskunft({ kurspreisGrund: 'kein Feingewicht' }));
    expect(p.preisEur).toBe('100.00');
    expect(p.herkunft).toBe('gespeichert');
    expect(p.grund).toBe('kein Feingewicht');
  });

  it('ein Stück mit FESTEM Preis behält ihn (der Motor gibt keinen Kurspreis)', () => {
    const p = geltenderPreis('890.00', auskunft({ festerPreis: true, listPriceEur: '890.00' }));
    expect(p.preisEur).toBe('890.00');
    expect(p.herkunft).toBe('gespeichert');
  });

  it('⛔ ohne jede Auskunft wird NICHT geraten: der gespeicherte Preis gilt', () => {
    // Solange der Motor noch nicht geantwortet hat, verkauft die Kasse
    // weiter — zum bekannten Preis. Ein leerer Korb wäre schlimmer.
    const p = geltenderPreis('55.50', undefined);
    expect(p.preisEur).toBe('55.50');
    expect(p.herkunft).toBe('gespeichert');
    expect(p.grund).toBeNull();
  });

  it('die Auskunft des Motors schlägt den mitgeführten Preis, auch ohne Kurs', () => {
    // Der Korb trägt eine Momentaufnahme von vorhin; der Motor hat den
    // aktuellen Bestand. Ändert der Inhaber den Preis im Lager, gilt seiner.
    const p = geltenderPreis('100.00', auskunft({ listPriceEur: '111.00' }));
    expect(p.preisEur).toBe('111.00');
  });
});

describe('Wie lange der gezeigte Preis noch gilt', () => {
  const geholt = '2026-08-20T10:00:00.000Z';
  const spaeter = (s: number) => new Date(Date.parse(geholt) + s * 1000);

  it('zählt vom letzten Abruf herunter', () => {
    expect(sekundenBisZumNaechstenKurs(geholt, spaeter(60))).toBe(KURSTAKT_SEKUNDEN - 60);
  });

  it('⛔ läuft nie ins Minus — ein überfälliger Abruf zeigt null', () => {
    expect(sekundenBisZumNaechstenKurs(geholt, spaeter(9999))).toBe(0);
  });

  it('⛔ steht nie über dem Takt — eine Uhr, die zurückspringt, verwirrt nur', () => {
    expect(sekundenBisZumNaechstenKurs(geholt, spaeter(-500))).toBe(KURSTAKT_SEKUNDEN);
  });

  it('ohne Abrufzeit gibt es keinen Countdown (und keine erfundene Zahl)', () => {
    expect(sekundenBisZumNaechstenKurs(null)).toBeNull();
    expect(sekundenBisZumNaechstenKurs('kein datum')).toBeNull();
  });
});

describe('Der Takt steht nur EINMAL im Haus', () => {
  it('⛔ die Kasse zählt in demselben Takt, in dem der Motor holt', async () => {
    // Zwei Zahlen für dieselbe Sache driften. Der Motor tickt in
    // `norns-sidecar.mjs`; steht dort eine andere Zahl, zeigt der Countdown
    // am Tresen eine Frist, die es nicht gibt.
    const { readFileSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const hier = dirname(fileURLToPath(import.meta.url));
    const motor = readFileSync(
      resolve(hier, '../../../api-cloud/sidecar/norns-sidecar.mjs'),
      'utf8',
    );
    const treffer = /setInterval\(kursLauf,\s*(\d+)\s*\*\s*60\s*\*\s*1000\)/.exec(motor);
    expect(treffer, 'der Kurstakt ist im Motor nicht mehr auffindbar').not.toBeNull();
    expect(Number(treffer![1]) * 60).toBe(KURSTAKT_SEKUNDEN);
  });
});
