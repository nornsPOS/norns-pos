/**
 * Der Uhrenabgleich, geprüft an den Grenzen.
 *
 * Was hier festgeschrieben wird, ist die EHRLICHKEIT der Warnung: sie geht
 * erst los, wenn wirklich etwas nicht stimmt, und sie sagt die Richtung.
 * Eine Warnung, die bei jeder Netzlaufzeit anspringt, wird weggeklickt und
 * schützt dann niemanden mehr.
 */

import { describe, expect, it } from 'vitest';

import { DRIFT_SCHWELLE_MS, pruefeUhr } from './uhrenabgleich.js';

const TSE_ZEIT = '2026-08-20T10:00:00.000Z';
const alsGeraet = (versatzMs: number) => new Date(Date.parse(TSE_ZEIT) + versatzMs);

describe('Uhrenabgleich', () => {
  it('schweigt, solange die Uhren beieinander stehen', () => {
    const b = pruefeUhr(TSE_ZEIT, alsGeraet(1_500));
    expect(b?.auffaellig).toBe(false);
    expect(b?.satz).toBeNull();
  });

  it('schweigt auch knapp unter der Schwelle (Netzlaufzeit ist keine Drift)', () => {
    const b = pruefeUhr(TSE_ZEIT, alsGeraet(DRIFT_SCHWELLE_MS - 1));
    expect(b?.auffaellig).toBe(false);
  });

  it('⛔ meldet eine vorgehende Geräteuhr mit Richtung und Minuten', () => {
    const b = pruefeUhr(TSE_ZEIT, alsGeraet(5 * 60_000));
    expect(b?.auffaellig).toBe(true);
    expect(b?.satz).toContain('5 Minuten vor');
    expect(b?.satz).toContain('Zeitsynchronisierung');
  });

  it('⛔ meldet auch eine nachgehende Geräteuhr', () => {
    const b = pruefeUhr(TSE_ZEIT, alsGeraet(-7 * 60_000));
    expect(b?.auffaellig).toBe(true);
    expect(b?.satz).toContain('7 Minuten nach');
  });

  it('bleibt still, wenn es nichts zu vergleichen gibt', () => {
    // Ein Ausfallbeleg trägt keine Signaturzeit. Daraus eine Warnung zu
    // bauen wäre eine erfundene Messung.
    expect(pruefeUhr(null)).toBeNull();
    expect(pruefeUhr(undefined)).toBeNull();
    expect(pruefeUhr('kein datum')).toBeNull();
  });
});
