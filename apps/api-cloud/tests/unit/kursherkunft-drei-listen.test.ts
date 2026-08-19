/**
 * Die Herkunft einer Kurszeile steht an DREI Stellen, und sie müssen gleich
 * sein. Am 31.07.2026 waren sie es nicht, und die Kasse antwortete mit 500.
 *
 * Der Hergang, am laufenden Motor gemessen:
 *
 *   1. Wanderung 0129 fügte dem Datenbanktyp `metal_price_source` den Wert
 *      `SPOT_VENDOR` hinzu.
 *   2. Der Kursdienst schrieb ihn in jede geholte Zeile.
 *   3. Das Antwortschema von `GET /api/metal-prices/current` kannte ihn nicht.
 *      Fastify brach beim VERPACKEN ab:
 *        „The value of '#/properties/prices/items/properties/source' does not
 *         match schema definition."
 *   4. Jede frische Kasse zeigte statt des Goldpreises einen Fehler.
 *
 * Nichts davon wurde rot. Rohes SQL ist für die Typprüfung unsichtbar, und
 * `/api/metal-prices/rates` daneben lief weiter, weil sein Schema die Herkunft
 * gar nicht mitschickt — die halbe Grünfärbung war der Grund, warum es
 * niemandem auffiel.
 *
 * Dieser Wächter liest deshalb NICHT drei Meinungen, sondern die MESSUNG: die
 * Leiter kommt aus den Wanderungen (dem, was in der Datenbank wirklich
 * erlaubt ist), die Tabellen aus den beiden Quelldateien. Wer einen Wert per
 * SQL hinzufügt und die Oberfläche vergisst, bekommt hier Rot statt eines
 * Händlers ohne Goldpreis.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = join(HIER, '../../../..');

const WANDERUNGEN = join(WURZEL, 'packages/db/migrations');
const DRIZZLE = join(WURZEL, 'packages/db/src/schema/metals/enums.ts');
const FASTIFY = join(WURZEL, 'apps/api-cloud/src/schemas/metal-prices.ts');
const KLIENT = join(WURZEL, 'packages/api-client/src/domains/metal-prices.ts');

/** Kommentare weg: sonst zählt ausgerechnet die Erklärung als Wert mit. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * DIE MESSUNG: welche Werte lässt die Datenbank wirklich zu?
 *
 * `CREATE TYPE ... AS ENUM (...)` legt die Leiter an, jedes spätere
 * `ALTER TYPE ... ADD VALUE '...'` hängt eine Sprosse dran. Beides wird
 * gelesen, in der Reihenfolge der Wanderungen.
 */
function ausDenWanderungen(): Set<string> {
  const werte = new Set<string>();
  const dateien = readdirSync(WANDERUNGEN)
    .filter((n) => n.endsWith('.sql'))
    .sort();

  for (const name of dateien) {
    const sql = readFileSync(join(WANDERUNGEN, name), 'utf8')
      // Zeilenkommentare in SQL weg — 0129 NENNT 'SPOT_VENDOR' in seiner
      // Begründung, und ohne diese Zeile wäre der Wächter aus dem falschen
      // Grund grün.
      .replace(/--.*$/gm, '');

    const anlage = /CREATE\s+TYPE\s+"?metal_price_source"?\s+AS\s+ENUM\s*\(([^)]*)\)/is.exec(sql);
    if (anlage) {
      for (const t of (anlage[1] ?? '').matchAll(/'([^']+)'/g)) {
        if (t[1] !== undefined) werte.add(t[1]);
      }
    }
    for (const t of sql.matchAll(
      /ALTER\s+TYPE\s+"?metal_price_source"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gis,
    )) {
      if (t[1] !== undefined) werte.add(t[1]);
    }
  }
  return werte;
}

/** Die Werte, die eine Quelldatei als Zeichenketten führt. */
function ausQuelle(pfad: string, ausschnitt: RegExp): Set<string> {
  const text = ohneKommentare(readFileSync(pfad, 'utf8'));
  const block = ausschnitt.exec(text);
  if (!block) return new Set();
  return new Set(
    [...(block[1] ?? '').matchAll(/'([A-Z_]+)'/g)]
      .map((m) => m[1])
      .filter((w): w is string => w !== undefined),
  );
}

describe('Die Kursherkunft steht an drei Stellen gleich', () => {
  const gemessen = ausDenWanderungen();

  it('findet die Leiter überhaupt in den Wanderungen', () => {
    // Ohne diesen Satz wäre ein verschobener Ordner eine leere Menge, und
    // gegen eine leere Menge ist jeder Vergleich unten grün.
    expect(gemessen.size, `keine Werte gefunden in ${WANDERUNGEN}`).toBeGreaterThanOrEqual(4);
    expect(gemessen).toContain('LBMA');
    expect(gemessen).toContain('SPOT_VENDOR');
  });

  it('das Drizzle-Schema kennt jeden Wert, den die Datenbank erlaubt', () => {
    const drizzle = ausQuelle(DRIZZLE, /pgEnum\(\s*'metal_price_source'\s*,\s*\[([\s\S]*?)\]/);
    expect([...gemessen].filter((w) => !drizzle.has(w))).toEqual([]);
  });

  it('das Antwortschema des Servers kennt jeden Wert — sonst 500 beim Verpacken', () => {
    const fastify = ausQuelle(FASTIFY, /SOURCE_ENUM\s*=\s*Type\.Union\(\[([\s\S]*?)\]\)/);
    expect([...gemessen].filter((w) => !fastify.has(w))).toEqual([]);
  });

  it('der Klient kennt jeden Wert — sonst zeigt die Kasse eine Herkunft ohne Namen', () => {
    const klient = ausQuelle(KLIENT, /MetalPriceSource\s*=([\s\S]*?);/);
    expect([...gemessen].filter((w) => !klient.has(w))).toEqual([]);
  });
});
