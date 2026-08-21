/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Notfallschlüssel sperrt niemanden aus — und öffnet niemandem die Tür
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Befund steht in `notfallschluessel.ts`: vergisst der Inhaber seinen
 * Kassencode, kommt niemand mehr in die Kasse. Diese Proben halten die zwei
 * Seiten der Abwägung fest — er muss ABTIPPBAR sein (sonst hilft er nicht)
 * und er darf NICHT zu erraten sein (sonst ist er eine offene Tür).
 */

import { describe, expect, it } from 'vitest';

import {
  SCHLUESSEL_BITS,
  erzeugeNotfallschluessel,
  normiereSchluessel,
  schluesselAbdruck,
  schluesselFormStimmt,
  schluesselStimmt,
} from '../src/notfallschluessel.js';

describe('Die Form des Schlüssels', () => {
  it('vier Gruppen zu vier Zeichen, mit Vorwort', () => {
    expect(erzeugeNotfallschluessel(() => 0)).toBe('NORNS-AAAA-AAAA-AAAA-AAAA');
    expect(erzeugeNotfallschluessel()).toMatch(/^NORNS(-[A-Z2-9]{4}){4}$/);
  });

  it('⛔ enthält KEINE verwechselbaren Zeichen', () => {
    /*
     * Er wird von Hand auf Papier notiert und Monate später abgetippt. `I`
     * gegen `1` und `O` gegen `0` sind in Handschrift dasselbe — und ein
     * Schlüssel, den man falsch abliest, sperrt genau den Menschen aus, dem
     * er helfen soll.
     */
    let i = 0;
    const durchlauf = (): number => (i++ % 32) / 32;
    for (let n = 0; n < 40; n++) {
      // Nur der KERN; das Vorwort „NORNS" trägt selbst ein O und gehört
      // nicht zum Geheimnis.
      const kern = erzeugeNotfallschluessel(durchlauf).replace(/^NORNS-/, '');
      expect(kern).not.toMatch(/[IO01]/);
    }
  });

  it('⛔ steckt genug Rateaufwand darin', () => {
    // Achtzig Bit. Der sechsstellige Kassencode hat rund zwanzig und lebt von
    // der Sperre nach zehn Fehlversuchen; dieser Schlüssel wäre auch ohne sie
    // sicher.
    expect(SCHLUESSEL_BITS).toBeGreaterThanOrEqual(80);
  });
});

describe('⛔ Abtippen darf nicht scheitern', () => {
  it('nimmt Kleinbuchstaben, fehlende Bindestriche und Leerzeichen an', () => {
    /*
     * Eine Kasse, die einen richtig abgeschriebenen Schlüssel wegen der
     * Schreibweise ablehnt, ist die Kasse, die den Händler aussperrt — genau
     * das, was dieser Schlüssel verhindern soll.
     */
    const echt = 'NORNS-4K7M-9PQR-2XYZ-JHTF';
    for (const wie of [
      'norns-4k7m-9pqr-2xyz-jhtf',
      'NORNS4K7M9PQR2XYZJHTF',
      '  NORNS 4K7M 9PQR 2XYZ JHTF  ',
      'NORNS–4K7M–9PQR–2XYZ–JHTF',
    ]) {
      expect(normiereSchluessel(wie), wie).toBe(normiereSchluessel(echt));
    }
  });

  it('erkennt, was gar kein Schlüssel ist', () => {
    expect(schluesselFormStimmt('NORNS-4K7M-9PQR-2XYZ-JHTF')).toBe(true);
    expect(schluesselFormStimmt('4K7M9PQR2XYZJHTF')).toBe(true);
    expect(schluesselFormStimmt('zu kurz')).toBe(false);
    expect(schluesselFormStimmt('')).toBe(false);
    // `I` und `O` gehören nicht zum Vorrat — wer sie tippt, hat sich verlesen.
    expect(schluesselFormStimmt('NORNS-IIII-OOOO-2XYZ-JHTF')).toBe(false);
  });
});

describe('⛔ Der Klartext wird nie gespeichert', () => {
  it('der Abdruck ist nicht der Schlüssel', async () => {
    const s = erzeugeNotfallschluessel();
    const abdruck = await schluesselAbdruck(s);
    expect(abdruck).not.toContain(normiereSchluessel(s));
    expect(abdruck.startsWith('$argon2'), 'kein argon2-Abdruck').toBe(true);
  });

  it('⛔ der richtige Schlüssel passt, ein falscher nicht', async () => {
    const s = erzeugeNotfallschluessel();
    const abdruck = await schluesselAbdruck(s);
    expect(await schluesselStimmt(s, abdruck)).toBe(true);
    expect(await schluesselStimmt(s.toLowerCase(), abdruck), 'Kleinschreibung').toBe(true);
    expect(await schluesselStimmt(erzeugeNotfallschluessel(), abdruck)).toBe(false);
    expect(await schluesselStimmt('', abdruck)).toBe(false);
  });

  it('⛔ mit und ohne Vorwort ergeben DENSELBEN Abdruck', async () => {
    /*
     * Das Vorwort steht auf jedem Zettel gleich und gehört nicht zum
     * Geheimnis. Zählte es mit, käme ein Händler, der es beim Abtippen
     * weglässt, nicht in seine eigene Kasse — genau der Fall, den dieser
     * Schlüssel verhindern soll.
     */
    const s = erzeugeNotfallschluessel();
    const abdruck = await schluesselAbdruck(s);
    expect(await schluesselStimmt(s.replace(/^NORNS-/, ''), abdruck)).toBe(true);
    expect(await schluesselStimmt(s, abdruck)).toBe(true);
  });

  it('zwei Schlüssel sind verschieden', () => {
    const viele = new Set(Array.from({ length: 200 }, () => erzeugeNotfallschluessel()));
    expect(viele.size).toBe(200);
  });
});
