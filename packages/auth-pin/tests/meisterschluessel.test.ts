import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type Aufgabe,
  antwortStimmt,
  aufgabeAusText,
  aufgabeAlsText,
  aufgabenText,
  erzeugeAufgabe,
} from '../src/meisterschluessel.js';

/** Ein eigenes Schlüsselpaar für die Probe — nie der echte des Hauses. */
function paar() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privB64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    pubB64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

function unterschreibe(aufgabe: Aufgabe, privB64: string): string {
  const key = { key: Buffer.from(privB64, 'base64'), format: 'der' as const, type: 'pkcs8' as const };
  const { createPrivateKey } = require('node:crypto');
  return sign(null, Buffer.from(aufgabenText(aufgabe), 'utf8'), createPrivateKey(key)).toString(
    'base64',
  );
}

describe('⛔ Der Herstellercode', () => {
  const T0 = 1_800_000_000_000;

  it('eine richtige Unterschrift auf einer frischen Aufgabe stimmt', () => {
    const { privB64, pubB64 } = paar();
    const a = erzeugeAufgabe('DEVICE01', T0);
    const antwort = unterschreibe(a, privB64);
    expect(antwortStimmt(a, antwort, T0, pubB64)).toBe(true);
  });

  it('⛔ eine abgelaufene Aufgabe wird abgewiesen, auch mit richtiger Unterschrift', () => {
    const { privB64, pubB64 } = paar();
    const a = erzeugeAufgabe('DEVICE01', T0);
    const antwort = unterschreibe(a, privB64);
    expect(antwortStimmt(a, antwort, a.gueltigBis + 1, pubB64)).toBe(false);
  });

  it('⛔ ein FREMDER Schlüssel öffnet nichts', () => {
    const echt = paar();
    const fremd = paar();
    const a = erzeugeAufgabe('DEVICE01', T0);
    const antwort = unterschreibe(a, fremd.privB64);
    expect(antwortStimmt(a, antwort, T0, echt.pubB64)).toBe(false);
  });

  it('⛔ eine Unterschrift für eine ANDERE Aufgabe passt nicht', () => {
    const { privB64, pubB64 } = paar();
    const a1 = erzeugeAufgabe('DEVICE01', T0);
    const a2 = erzeugeAufgabe('DEVICE02', T0);
    const antwortFuerA1 = unterschreibe(a1, privB64);
    expect(antwortStimmt(a2, antwortFuerA1, T0, pubB64)).toBe(false);
  });

  it('Aufgabe geht durch Text und zurück ohne Verlust', () => {
    const a = erzeugeAufgabe('KASSE123', T0);
    const zurueck = aufgabeAusText(aufgabeAlsText(a));
    expect(zurueck).toEqual(a);
  });

  it('Unfug als Antwort wirft nicht, sondern ist einfach falsch', () => {
    const { pubB64 } = paar();
    const a = erzeugeAufgabe('DEVICE01', T0);
    expect(antwortStimmt(a, 'kein-base64!!!', T0, pubB64)).toBe(false);
    expect(antwortStimmt(a, '', T0, pubB64)).toBe(false);
  });
});
