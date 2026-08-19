/**
 * Die Spalten-Momentaufnahme darf nicht still veralten.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * `pnpm check:sql` hält jedes rohe SQL gegen eine Liste echter Spalten. Es ist
 * der einzige Wächter für eine ganze Fehlerklasse: rohes SQL ist für den
 * Typprüfer unsichtbar, ein falscher Spaltenname übersetzt grün und stirbt
 * erst im Betrieb. Genau so lag die Reservierung im Kundenshop am 22.07.2026
 * einen Tag lang tot.
 *
 * Die Liste stammte per `ssh` aus der laufenden Datenbank von Warehouse14 und
 * war seit dem Abzweig am 30.07. nicht mehr aufgefrischt worden. Ihr fehlten
 * fünf ganze Tabellen und einundzwanzig Spalten. Der Wächter meldete deshalb
 * DREI Fehlalarme, war seit dem 31.07. rot, und niemand las ihn mehr.
 *
 * ⚠️ Und darunter lag ein ECHTER Treffer: `arbeitszeiten.ts` fragte
 * `u.deleted_at` ab. Diese Spalte heisst `soft_deleted_at`. Lesen und
 * Schreiben der Arbeitszeiten hätten beide 500 geworfen — also genau die
 * Sperre, gegen die die Fläche gebaut wurde, wäre geblieben, und der Händler
 * hätte nie einen Termin annehmen können.
 *
 * Das ist die teuerste Bauart eines Wächters: einer, der so laut falsch
 * meldet, dass sein einziger richtiger Ruf mit untergeht.
 *
 * ── WAS DIESER SATZ SCHÜTZT ────────────────────────────────────────────────
 *
 * Nicht die Richtigkeit jeder einzelnen Spalte — das tut `check:sql` selbst.
 * Sondern die Frische: jede Tabelle, die eine Wanderung ANLEGT, muss in der
 * Momentaufnahme stehen. Wer eine Wanderung schreibt und
 * `pnpm schema:snapshot` vergisst, wird hier rot, statt dass der Wächter
 * langsam blind wird.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WANDERUNGEN = resolve(HIER, '../../../../packages/db/migrations');
const MOMENTAUFNAHME = resolve(HIER, '../../../../packages/db/schema-snapshot/columns.json');

/**
 * Tabellen, die eine Wanderung anlegt und eine spätere wieder entfernt.
 *
 * Namentlich, nicht geraten: eine Namensliste ist hier vertretbar, weil ein
 * vergessener Eintrag ROT wird (die Tabelle fehlt dann in der Momentaufnahme)
 * und nicht still durchrutscht. Das ist die Umkehrung der gefährlichen
 * Namensliste, die einen Prüfpunkt weglässt.
 */
const WIEDER_ENTFERNT: ReadonlySet<string> = new Set<string>();

function angelegteTabellen(): Map<string, string> {
  const namen = new Map<string, string>();
  const dateien = readdirSync(WANDERUNGEN)
    .filter((n) => /^\d{4}_.+\.sql$/.test(n))
    .sort();

  for (const datei of dateien) {
    const roh = readFileSync(join(WANDERUNGEN, datei), 'utf8');
    // Kommentare weg, bevor gesucht wird. Sonst zählt ein erklärender Satz
    // wie „hier stand einmal CREATE TABLE alte_kasse" als echte Tabelle, und
    // der Wächter verlangt etwas, das es nie gab.
    const ohneKommentare = roh
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*--.*$/gm, '');

    const treffer = ohneKommentare.matchAll(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi,
    );
    for (const t of treffer) {
      const name = t[1];
      if (name !== undefined && !namen.has(name)) namen.set(name, datei);
    }

    for (const t of ohneKommentare.matchAll(
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi,
    )) {
      const name = t[1];
      if (name !== undefined) namen.delete(name);
    }
  }
  return namen;
}

describe('Die Spalten-Momentaufnahme ist frisch', () => {
  const momentaufnahme = JSON.parse(readFileSync(MOMENTAUFNAHME, 'utf8')) as Record<
    string,
    string[]
  >;

  it('jede Tabelle, die eine Wanderung anlegt, steht darin', () => {
    const fehlend: string[] = [];
    for (const [tabelle, datei] of angelegteTabellen()) {
      if (WIEDER_ENTFERNT.has(tabelle)) continue;
      if (!(tabelle in momentaufnahme)) fehlend.push(`${tabelle} (aus ${datei})`);
    }
    expect(
      fehlend,
      'Diese Tabellen legt eine Wanderung an, die Momentaufnahme kennt sie aber nicht. ' +
        'Damit prüft `pnpm check:sql` jedes SQL gegen sie NICHT mehr. ' +
        'Auffrischen mit: pnpm schema:snapshot',
    ).toEqual([]);
  });

  it('sie ist nicht leer und trägt die Kerntabellen des Betriebs', () => {
    // Ein leerer oder halb geschriebener Zustand würde den ersten Satz
    // ebenfalls bestehen lassen, wenn die Wanderungen unlesbar wären.
    expect(Object.keys(momentaufnahme).length).toBeGreaterThan(60);
    for (const kern of ['transactions', 'products', 'customers', 'daily_closings', 'users']) {
      expect(momentaufnahme[kern], `${kern} fehlt in der Momentaufnahme`).toBeDefined();
      expect((momentaufnahme[kern] ?? []).length).toBeGreaterThan(3);
    }
  });

  it('sie wird aus DIESEM Baum gebaut, nicht aus einer fremden Produktion', () => {
    // ⚠️ Der eigentliche Grund des Fundes. Solange der Handgriff per `ssh` an
    // der Datenbank von Warehouse14 hing, konnte die Momentaufnahme für Norns
    // gar nicht stimmen: dort laufen andere Wanderungen. Und ein Bauwerkzeug
    // dieses Baums darf die Produktion eines Kunden nicht anfassen.
    const wurzelPaket = JSON.parse(
      readFileSync(resolve(HIER, '../../../../package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const handgriff = wurzelPaket.scripts['schema:snapshot'] ?? '';
    expect(handgriff, 'der Handgriff schema:snapshot fehlt').not.toBe('');
    expect(handgriff, 'die Momentaufnahme darf nicht per ssh von einem Server kommen').not.toMatch(
      /\bssh\b/,
    );
    expect(handgriff).toMatch(/schema-momentaufnahme/);
  });
});
