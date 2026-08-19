/**
 * Der Wächter über der § 13b-Regel auf der Fläche.
 *
 * Der wichtigste Test ist der über „nicht erreichbar": genau dort stand der
 * Fehler, der dem Kunden einen um 19 % niedrigeren Preis nannte, den das Haus
 * danach nicht halten konnte.
 */

import { describe, expect, it } from 'vitest';

import {
  reverseChargeGiltJetzt,
  warumKeinReverseCharge,
  type ViesStand,
} from './reverse-charge-spiegel.js';

describe('§ 13b auf der Fläche', () => {
  it('gilt NUR bei geprüfter USt-IdNr.', () => {
    expect(reverseChargeGiltJetzt(true, 'valid')).toBe(true);
  });

  it('gilt NICHT, wenn die EU nicht erreichbar war', () => {
    // DER Test dieser Datei. Fällt er weg, fällt die Summe im Laden um 19 %,
    // der Kassierer nennt dem Kunden den Betrag, und der Server weist den
    // Vorgang danach zurück.
    expect(reverseChargeGiltJetzt(true, 'unavailable')).toBe(false);
    expect(reverseChargeGiltJetzt(true, 'timeout')).toBe(false);
  });

  it('gilt NICHT bei ungeprüfter oder abgelehnter Nummer', () => {
    const nie: ViesStand[] = ['idle', 'checking', 'invalid'];
    for (const stand of nie) {
      expect(reverseChargeGiltJetzt(true, stand), `Stand ${stand}`).toBe(false);
    }
  });

  it('gilt nie ohne angehakten Geschäftskunden', () => {
    const alle: ViesStand[] = ['idle', 'checking', 'valid', 'invalid', 'unavailable', 'timeout'];
    for (const stand of alle) {
      expect(reverseChargeGiltJetzt(false, stand), `Stand ${stand}`).toBe(false);
    }
  });

  it('spiegelt die Regel des Servers: nur ein Zustand von sechs schaltet', () => {
    // Gegenprobe gegen `darfReverseCharge` in apps/api-cloud/src/lib/
    // reverse-charge.ts. Wer hier einen zweiten Zustand aufnimmt, hat den
    // Server nicht gefragt.
    const alle: ViesStand[] = ['idle', 'checking', 'valid', 'invalid', 'unavailable', 'timeout'];
    const schaltend = alle.filter((s) => reverseChargeGiltJetzt(true, s));
    expect(schaltend).toEqual(['valid']);
  });

  it('sagt bei jedem Nein, was der Kassierer tun kann', () => {
    const nein: ViesStand[] = ['idle', 'checking', 'invalid', 'unavailable', 'timeout'];
    for (const stand of nein) {
      const satz = warumKeinReverseCharge(true, stand);
      expect(satz, `Stand ${stand} braucht einen Satz`).toBeTruthy();
      // Kein roher Zustandsname auf dem Bildschirm.
      expect(satz).not.toContain(stand);
    }
    expect(warumKeinReverseCharge(true, 'valid')).toBeNull();
    expect(warumKeinReverseCharge(false, 'idle')).toBeNull();
  });

  it('nennt bei nicht erreichbarer EU den Weg zurück', () => {
    // Ein „geht nicht" ohne nächsten Schritt lässt den Kassierer vor dem
    // Kunden stehen. Der Satz muss sagen, dass später korrigiert werden kann.
    const satz = warumKeinReverseCharge(true, 'unavailable') ?? '';
    expect(satz).toContain('Regelsatz');
    expect(satz.toLowerCase()).toContain('korrektur');
  });
});
