/**
 * Jede Herkunft, die der Server schicken kann, muss auf dem Schirm einen
 * deutschen NAMEN haben — kein Wort aus der Datenbank.
 *
 * ⚠️ 31.07.2026 auf dem Schirm gesehen: die Kursfläche druckte den rohen Wert.
 * Der Händler las `SPOT_VENDOR` — Grossbuchstaben, Unterstrich, englisch — auf
 * genau der Fläche, die sein Vertrauen in den Goldpreis tragen soll.
 *
 * Der Wächter erfindet die Liste nicht, er liest sie aus dem Klienten
 * (`MetalPriceSource`), und der wiederum wird vom Wächter in api-cloud gegen
 * die WANDERUNGEN geprüft. Damit hängt diese Prüfung am Ende an dem, was die
 * Datenbank wirklich erlaubt, und nicht an einer Meinung.
 *
 * Gelesen wird die QUELLE, nicht das gebaute Paket: eine Kopie unter `dist/`
 * kann abweichen, und dann prüfte der Wächter das Falsche.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const FLAECHE = join(HIER, 'Kurse.tsx');
const KLIENT = join(HIER, '../../../../../packages/api-client/src/domains/metal-prices.ts');

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Jede Kursherkunft trägt auf dem Schirm einen Namen', () => {
  it('findet beide Quellen', () => {
    expect(existsSync(FLAECHE), FLAECHE).toBe(true);
    expect(existsSync(KLIENT), KLIENT).toBe(true);
  });

  const klientText = ohneKommentare(readFileSync(KLIENT, 'utf8'));
  const union = /MetalPriceSource\s*=([\s\S]*?);/.exec(klientText);
  const herkuenfte = [...(union?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] ?? '');

  const flaeche = ohneKommentare(readFileSync(FLAECHE, 'utf8'));
  const tabelle = /const HERKUNFT[\s\S]*?=\s*\{([\s\S]*?)\n\};/.exec(flaeche);
  const benannt = [...(tabelle?.[1] ?? '').matchAll(/^\s{2}([A-Z_]+):/gm)].map((m) => m[1] ?? '');

  it('liest überhaupt eine Liste aus dem Klienten', () => {
    // Ohne diesen Satz wäre eine umbenannte Union eine leere Liste, und gegen
    // eine leere Liste ist jede Prüfung unten grün.
    expect(herkuenfte.length).toBeGreaterThanOrEqual(4);
    expect(herkuenfte).toContain('SPOT_VENDOR');
  });

  it('gibt jeder Herkunft einen Namen', () => {
    expect(herkuenfte.filter((h) => !benannt.includes(h))).toEqual([]);
  });

  it('benennt nichts, was es gar nicht gibt', () => {
    // Die Gegenrichtung: eine Zeile für einen Wert, den der Server nie schickt,
    // ist toter Text, der beim nächsten Lesen für echt gehalten wird.
    expect(benannt.filter((b) => !herkuenfte.includes(b))).toEqual([]);
  });

  it('druckt den rohen Wert nicht mehr als Beschriftung', () => {
    // Der eigentliche Fehler: `{source}` als Inhalt des Abzeichens. Erlaubt
    // bleibt der Rückfall `?? source`, denn eine unbekannte Herkunft soll
    // sichtbar bleiben statt still zu verschwinden.
    expect(flaeche).not.toMatch(/>\s*\{source\}\s*</);
    expect(flaeche).toMatch(/\?\?\s*source/);
  });
});
