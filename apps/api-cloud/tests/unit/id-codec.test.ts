/**
 * Der id-codec muss verlustfrei und präfix-streng sein: eine UUID hin und
 * zurück ergibt exakt sich selbst; ein falsches Präfix wird abgewiesen; der
 * rückwärtskompatible Eingang nimmt beide Formen.
 */
import { describe, expect, it } from 'vitest';

import { decodeId, encodeId, toUuid } from '../../src/lib/id-codec.js';

const SAMPLE = '9x'; // nur zur Lesbarkeit unten
const UUIDS = [
  '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
];

describe('id-codec Rundlauf', () => {
  it('kodiert und dekodiert jede UUID verlustfrei', () => {
    for (const u of UUIDS) {
      const enc = encodeId('customer', u);
      expect(enc.startsWith('cus_')).toBe(true);
      expect(decodeId('customer', enc)).toBe(u.toLowerCase());
    }
  });

  it('erzeugt stabile, mengen-verschweigende Kennungen (26 Zeichen)', () => {
    const enc = encodeId('order', '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(enc).toMatch(/^ord_[0-9a-hjkmnp-tv-z]{26}$/);
    // Deterministisch: zweimal dasselbe.
    expect(encodeId('order', '3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(enc);
  });
});

describe('Präfix-Strenge', () => {
  it('weist ein falsches Präfix ab (vertauschter Bezug rutscht nie durch)', () => {
    const cus = encodeId('customer', UUIDS[2]!);
    // Als Bestellung gelesen → null, obwohl die Bytes gültig wären.
    expect(decodeId('order', cus)).toBeNull();
    expect(decodeId('customer', cus)).toBe(UUIDS[2]!);
  });

  it('weist Müll und falsche Länge ab', () => {
    expect(decodeId('customer', 'cus_kurz')).toBeNull();
    expect(decodeId('customer', 'cus_iiiiiiiiiiiiiiiiiiiiiiiiii')).toBeNull(); // i ist kein Base32-Zeichen
    expect(decodeId('customer', 'nichtmalpraefix')).toBeNull();
  });
});

describe('rückwärtskompatibler Eingang (toUuid)', () => {
  it('reicht eine rohe UUID durch', () => {
    expect(toUuid('customer', UUIDS[3]!)).toBe(UUIDS[3]!);
    expect(toUuid('customer', UUIDS[3]!.toUpperCase())).toBe(UUIDS[3]!);
  });

  it('entschlüsselt die präfigierte Form der erwarteten Entität', () => {
    const enc = encodeId('product', UUIDS[3]!);
    expect(toUuid('product', enc)).toBe(UUIDS[3]!);
  });

  it('gibt null bei fremdem Präfix oder Müll', () => {
    const enc = encodeId('product', UUIDS[3]!);
    expect(toUuid('customer', enc)).toBeNull();
    expect(toUuid('customer', `unsinn_${SAMPLE}`)).toBeNull();
  });
});
