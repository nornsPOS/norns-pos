/**
 * Der Wächter über den DATEV-Bytes.
 *
 * ── WARUM ES IHN GIBT (30.07.2026) ──────────────────────────────────────────
 *
 * Der Server sendet den Buchungsstapel absichtlich als rohe Windows-1252-Bytes
 * (`closing-export.ts`: `reply.type('text/csv; charset=windows-1252')` plus
 * `kodiereAnsi(csv)`), weil DATEV genau das erwartet. Der Klient las ihn mit
 * `responseType: 'text'`, und `Response.text()` dekodiert laut Spezifikation
 * IMMER als UTF-8 und ignoriert den Zeichensatz im Kopf.
 *
 * Gemessen, bevor es behoben wurde:
 *
 *     Server sendet : 53 63 68 6c fc 73 73 65 6c   "Schlüssel"
 *     Kasse liest   : "Schl<Ersatzzeichen>ssel"
 *     Auf der Platte: 53 63 68 6c ef bf bd 73 73 65 6c
 *
 * Aus einem Byte wurden drei, unumkehrbar. Jede Buchung mit Umlaut kam beim
 * Steuerberater verstümmelt an, und niemand sah es: die Datei öffnet sich,
 * sie sieht nur falsch aus.
 *
 * Dieser Wächter ist ein TEXTWÄCHTER über der Quelle, und das ist Absicht: der
 * Schaden entsteht in einer einzigen Zeichenkette in der Aufrufkette, und ein
 * Verhaltenstest würde ihn nur mit einem echten Server sichtbar machen. Wer
 * `arraybuffer` je wieder auf `text` stellt, wird hier ROT.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const KLIENT = join(HIER, '../../../packages/api-client/src/domains/closings.ts');

/**
 * Kommentare entfernen, bevor geprüft wird.
 *
 * Beim ersten Lauf war dieser Wächter ROT, und zwar zu Recht auf seine eigene
 * Weise: der Kommentar ÜBER der Zeile erklärt den behobenen Fehler und nennt
 * dabei wörtlich `responseType: 'text'`. Ein Wächter, der Prosa liest, misst
 * die Erzählung statt das Verhalten. Er liest ab jetzt nur Code.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** Den Rumpf einer benannten Funktion aus der Quelle schneiden. */
function rumpfVon(quelle: string, name: string): string {
  const start = quelle.indexOf(`  ${name}(`);
  expect(start, `${name} steht nicht mehr in closings.ts`).toBeGreaterThan(-1);
  const ende = quelle.indexOf('\n  },', start);
  expect(ende, `${name} hat kein erkennbares Ende`).toBeGreaterThan(start);
  return quelle.slice(start, ende);
}

describe('DATEV verlässt den Server als Bytes und kommt als Bytes an', () => {
  const quelle = ohneKommentare(readFileSync(KLIENT, 'utf8'));

  for (const name of ['datevCsv', 'datevDatei']) {
    it(`${name} holt den Stapel als arraybuffer, niemals als text`, () => {
      const rumpf = rumpfVon(quelle, name);
      expect(
        rumpf,
        `${name} muss responseType: 'arraybuffer' benutzen — 'text' zerstört ` +
          'jedes Windows-1252-Umlautbyte still und unumkehrbar',
      ).toContain("responseType: 'arraybuffer'");
      expect(
        rumpf.includes("responseType: 'text'"),
        `${name} darf NICHT auf 'text' stehen`,
      ).toBe(false);
    });
  }

  it('beweist die Zerstörung, damit die Regel nicht nur behauptet ist', () => {
    // Genau das, was `res.text()` tut: den Körper als UTF-8 dekodieren.
    const w1252 = new Uint8Array([0x53, 0x63, 0x68, 0x6c, 0xfc, 0x73, 0x73, 0x65, 0x6c]);
    const alsText = new TextDecoder('utf-8').decode(w1252);
    const zurueck = new TextEncoder().encode(alsText);

    expect(alsText).not.toContain('ü');
    expect(zurueck.length).toBe(11); // aus 9 Bytes wurden 11
    // Das Ersatzzeichen, drei Bytes, wo eines war.
    expect(Array.from(zurueck.slice(4, 7))).toEqual([0xef, 0xbf, 0xbd]);

    // Und die Gegenprobe: richtig dekodiert bleibt der Umlaut stehen.
    expect(new TextDecoder('windows-1252').decode(w1252)).toBe('Schlüssel');
  });
});
