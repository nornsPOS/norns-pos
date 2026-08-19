/**
 * Der Verkaufsaufschlag, den der Händler in den Einstellungen führt.
 *
 * Geprüft wird der Leser gegen eine Attrappe der Datenbank, die GENAU das
 * zurückgibt, was Postgres zurückgäbe: Zeichenketten aus `system_settings`.
 * Zahlen wären eine schmeichelnde Attrappe und würden den einen Fehler
 * verdecken, um den es hier geht.
 */

import { describe, expect, it } from 'vitest';

import {
  VERKAUFSAUFSCHLAG_KEY,
  aufschlagKeyFuer,
  leseVerkaufsaufschlag,
} from '../../src/lib/verkaufsaufschlag.js';

/** Eine Attrappe, die sich wie Drizzles Kette verhält und Zeilen liefert. */
function datenbankMit(zeilen: Array<{ key: string; value: string | null }>): never {
  const kette = {
    select: () => kette,
    from: () => kette,
    where: () => Promise.resolve(zeilen),
  };
  return kette as never;
}

describe('Verkaufsaufschlag aus den Einstellungen', () => {
  it('ohne jede Zeile: null Aufschlag, kein erfundener Händlerzuschlag', async () => {
    const k = await leseVerkaufsaufschlag(datenbankMit([]));
    expect(k.get('gold')).toBe('0');
    expect(k.get('silver')).toBe('0');
    expect(k.get('platinum')).toBe('0');
    expect(k.get('palladium')).toBe('0');
  });

  it('ein globaler Wert gilt für alle vier Metalle', async () => {
    const k = await leseVerkaufsaufschlag(
      datenbankMit([{ key: VERKAUFSAUFSCHLAG_KEY, value: '0.12' }]),
    );
    for (const m of ['gold', 'silver', 'platinum', 'palladium']) {
      expect(k.get(m), m).toBe('0.12');
    }
  });

  it('eine Ausnahme je Metall schlägt den globalen Wert', async () => {
    const k = await leseVerkaufsaufschlag(
      datenbankMit([
        { key: VERKAUFSAUFSCHLAG_KEY, value: '0.10' },
        { key: aufschlagKeyFuer('gold'), value: '0.18' },
      ]),
    );
    expect(k.get('gold')).toBe('0.18');
    expect(k.get('silver')).toBe('0.10');
  });

  it('⚠️ „10" statt „0.10" wird VERWORFEN, nicht übernommen', async () => {
    // Genau die Einheitenverwechslung, die einen Krügerrand auf 40.000 Euro
    // heben würde. Der Leser reicht sie gar nicht erst weiter.
    const k = await leseVerkaufsaufschlag(
      datenbankMit([{ key: aufschlagKeyFuer('gold'), value: '10' }]),
    );
    expect(k.get('gold')).toBe('0');
  });

  it('ein negativer Aufschlag wird verworfen', async () => {
    const k = await leseVerkaufsaufschlag(
      datenbankMit([{ key: aufschlagKeyFuer('gold'), value: '-0.30' }]),
    );
    expect(k.get('gold')).toBe('0');
  });

  it('Unsinn und leere Werte fallen auf die Vorgabe zurück, statt zu werfen', async () => {
    const k = await leseVerkaufsaufschlag(
      datenbankMit([
        { key: aufschlagKeyFuer('gold'), value: 'viel' },
        { key: aufschlagKeyFuer('silver'), value: null },
      ]),
    );
    expect(k.get('gold')).toBe('0');
    expect(k.get('silver')).toBe('0');
  });

  it('ein in Anführungszeichen abgelegter Wert wird trotzdem gelesen', async () => {
    // system_settings.value ist Text; manche Zeilen tragen JSON-Anführungs-
    // zeichen. Daran ist in diesem Haus schon einmal eine Einstellung
    // gescheitert, ohne dass irgendwo etwas rot wurde.
    const k = await leseVerkaufsaufschlag(
      datenbankMit([{ key: aufschlagKeyFuer('gold'), value: '"0.15"' }]),
    );
    expect(k.get('gold')).toBe('0.15');
  });

  it('genau hundert Prozent ist die Grenze und noch gültig', async () => {
    const k = await leseVerkaufsaufschlag(
      datenbankMit([{ key: aufschlagKeyFuer('gold'), value: '1' }]),
    );
    expect(k.get('gold')).toBe('1');
  });
});
