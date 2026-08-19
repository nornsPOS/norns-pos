/**
 * ⛔ KEIN ROHES LEITUNGSWORT AM TRESEN — DER GUTSCHEINZUSTAND
 *
 * ── DER BEFUND VOM 12.08.2026 ────────────────────────────────────────────
 *
 * `VoucherField.tsx` setzte den Zustand roh in den Satz und übersetzte nur
 * `REDEEMED` von Hand. Wer einen abgelaufenen Gutschein einlöste, las am
 * Tresen wörtlich „Gutschein ist EXPIRED." — englisches Schreikappen-Wort,
 * vor dem Kunden.
 *
 * Dieser Wächter misst BEIDE Hälften: dass jeder Zustand ein deutsches Wort
 * hat, und dass die Sätze wirklich frei von Leitungsvokabular sind. Ein
 * fünfter Zustand, den jemand morgen einführt, fällt hier auf.
 */

import { describe, expect, it } from 'vitest';

import { VOUCHER_STATUS_LABEL, gutscheinZustandSatz } from './german-text';

/**
 * Die Zustände, die der Motor kennt (`voucher_status` in der Wanderung).
 * ABGESCHRIEBEN, nicht importiert: eine importierte Liste stimmte immer mit
 * sich selbst überein und übersähe genau die Lücke, die hier gemeint ist.
 */
const ZUSTAENDE_DES_MOTORS = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'REVOKED'] as const;

describe('⛔ der Gutscheinzustand erreicht den Tresen auf Deutsch', () => {
  it('jeder Zustand des Motors hat ein deutsches Wort', () => {
    const ohneWort = ZUSTAENDE_DES_MOTORS.filter((z) => VOUCHER_STATUS_LABEL[z] === undefined);
    expect(
      ohneWort,
      'diese Zustände landen roh im Satz am Tresen, so wie EXPIRED es bis zum 12.08.2026 tat',
    ).toEqual([]);
  });

  it('kein Satz trägt ein Schreikappen-Wort aus der Leitung', () => {
    for (const z of ZUSTAENDE_DES_MOTORS) {
      const satz = gutscheinZustandSatz(z);
      // Zwei oder mehr Grossbuchstaben am Stück sind im deutschen Fliesstext
      // dieses Hauses immer ein Leitungswort.
      expect(satz, `„${satz}" trägt ein rohes Wort`).not.toMatch(/[A-Z]{2,}/);
      expect(satz).toMatch(/^Dieser Gutschein ist .+\.$/);
    }
  });

  it('ein UNBEKANNTER Zustand erfindet keinen Grund', () => {
    // Ehrlicher als ein geratener Grund: der Kassierer weiss, dass es nicht
    // geht, und holt den Inhaber.
    const satz = gutscheinZustandSatz('VOELLIG_NEUER_ZUSTAND');
    expect(satz).toBe('Dieser Gutschein lässt sich nicht einlösen.');
    expect(satz).not.toContain('VOELLIG');
  });
});
