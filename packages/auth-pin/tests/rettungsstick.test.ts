import { describe, expect, it } from 'vitest';

import {
  GEHEIMNIS_BYTES,
  alsGeheimnis,
  leseStickDatei,
  stickAbdruck,
  stickDateiInhalt,
  stickStimmt,
} from '../src/rettungsstick.js';

describe('⛔ Der Rettungsstick', () => {
  const bytes = new Uint8Array(GEHEIMNIS_BYTES).map((_, i) => (i * 7 + 3) % 256);

  it('ein geschriebener Stick lässt sich zurücklesen', () => {
    const g = alsGeheimnis(bytes);
    const datei = stickDateiInhalt(g, '2026-08-21T12:00:00.000Z');
    const zurueck = leseStickDatei(datei);
    expect(zurueck?.geheimnis).toBe(g);
    expect(zurueck?.fassung).toBe(1);
  });

  it('das Geheimnis stimmt gegen seinen eigenen Abdruck, ein anderes nicht', async () => {
    const g = alsGeheimnis(bytes);
    const abdruck = await stickAbdruck(g);
    expect(await stickStimmt(g, abdruck)).toBe(true);
    const anderes = alsGeheimnis(new Uint8Array(GEHEIMNIS_BYTES).fill(9));
    expect(await stickStimmt(anderes, abdruck)).toBe(false);
  });

  it('⛔ der Klartext taucht NICHT im Abdruck auf', async () => {
    const g = alsGeheimnis(bytes);
    const abdruck = await stickAbdruck(g);
    expect(abdruck).toMatch(/^\$argon2/);
    expect(abdruck).not.toContain(g);
  });

  it('⛔ kaputte oder fremde Dateien sind kein Stick (null, kein Wurf)', () => {
    expect(leseStickDatei('kein json')).toBeNull();
    expect(leseStickDatei('{}')).toBeNull();
    expect(leseStickDatei(JSON.stringify({ fassung: 2, geheimnis: 'x' }))).toBeNull();
    expect(leseStickDatei(JSON.stringify({ fassung: 1, geheimnis: 'zu-kurz' }))).toBeNull();
  });

  it('ein falsch langes Geheimnis wird gar nicht erst gebildet', () => {
    expect(() => alsGeheimnis(new Uint8Array(10))).toThrow();
  });
});
