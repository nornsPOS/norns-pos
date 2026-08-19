/**
 * Jede fiskalische Sperre muss einen AUSGANG haben.
 *
 * ── DER FUND VOM 02.08.2026 ────────────────────────────────────────────────
 *
 * Drei Einstellungen entscheiden, ob ein Prüferpaket überhaupt entsteht. Für
 * KEINE gab es ein Eingabefeld, während der Server sie las und den Export
 * ohne sie abbrach:
 *
 *   dsfinvk.gv_typ.ankauf                      ohne ihn bricht das Paket beim
 *                                              ERSTEN Ankaufbeleg ab
 *   dsfinvk.ust_schluessel.margin_25a          ohne ihn bei der ersten
 *                                              Differenzbesteuerung
 *   dsfinvk.ust_schluessel.reverse_charge_13b  ohne ihn bei § 13b
 *
 * Für einen Edelmetallhändler sind § 25a und der Ankauf von Privat der
 * REGELFALL. Der Prüferknopf war damit dauerhaft zu — mit einer Absage, die
 * einen Ausweg VERSPRACH: „bitte unter Einstellungen, Steuer eintragen".
 *
 * Am Tresen zeigt sich das im teuersten Augenblick: der Prüfer steht im Laden.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Die Eigenschaft: jeder Schlüssel, der eine fiskalische Sperre öffnet, ist
 * über die Einstellungsroute SCHREIBBAR. Ein neuer Riegel an einem neuen
 * Schlüssel wird hier rot, bis sein Ausgang gebaut ist.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HIER, '../../src');
const FENSTER = resolve(HIER, '../../../tauri-pos/src');

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function alleQuellen(wurzel: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(wurzel)) {
    if (name === 'node_modules') continue;
    const p = join(wurzel, name);
    if (statSync(p).isDirectory()) out.push(...alleQuellen(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** Die Positivliste der Einstellungsroute, als Text. */
const SETTINGS = ohneKommentare(readFileSync(join(SERVER, 'routes/settings.ts'), 'utf8'));

/**
 * Schlüssel, die eine fiskalische Sperre öffnen.
 *
 * Namentlich, weil ein neuer hier bewusst eingetragen werden soll: eine
 * automatische Suche würde auch Schlüssel finden, die nur gelesen und nie
 * erzwungen werden, und der Wächter bekäme Fehlalarme.
 */
interface Sperrschluessel {
  schluessel: string;
  warum: string;
  /**
   * Woran man in der KASSE erkennt, dass es einen Weg dorthin gibt.
   *
   * ⚠️ Meist ist das der Schlüssel selbst, weil die Fläche ihn an
   * `PATCH /api/settings/:key` schickt. Für die Sicherungseinrichtung nicht:
   * sie hat eine EIGENE Route, und die Fläche ruft `/api/tse/einrichten`.
   * Der erste Anlauf dieses Wächters suchte stur den Schlüssel und meldete
   * deshalb eine Lücke, die keine mehr war.
   */
  spurInDerKasse: string;
}

const SPERRSCHLUESSEL: readonly Sperrschluessel[] = [
  {
    schluessel: 'tse.tss_id',
    warum: '§ 146a AO: ohne ihn kein Verkauf und kein Ankauf',
    spurInDerKasse: '/api/tse/einrichten',
  },
  {
    schluessel: 'steuer.modus',
    warum: '§ 19 UStG: ohne ihn kein Verkauf',
    spurInDerKasse: 'steuer.modus',
  },
  {
    schluessel: 'dsfinvk.gv_typ.ankauf',
    warum: 'DSFinV-K Anhang C: ohne ihn kein Export mit Ankaufbeleg',
    spurInDerKasse: 'dsfinvk.gv_typ.ankauf',
  },
  {
    schluessel: 'dsfinvk.ust_schluessel.margin_25a',
    warum: '§ 25a: ohne ihn kein Export mit Differenzbesteuerung',
    spurInDerKasse: 'dsfinvk.ust_schluessel.margin_25a',
  },
  {
    schluessel: 'dsfinvk.ust_schluessel.reverse_charge_13b',
    warum: '§ 13b: ohne ihn kein Export mit Reverse-Charge',
    spurInDerKasse: 'dsfinvk.ust_schluessel.reverse_charge_13b',
  },
];

describe('Jede fiskalische Sperre hat einen Ausgang', () => {
  for (const { schluessel, warum } of SPERRSCHLUESSEL) {
    it(`„${schluessel}" ist eintragbar (${warum})`, () => {
      // Entweder in der Positivliste der Einstellungen ODER über eine eigene
      // Route, die ihn schreibt (die TSE-Einrichtung tut das).
      const inListe = SETTINGS.includes(`'${schluessel}'`);
      const eigeneRoute = alleQuellen(join(SERVER, 'routes')).some((p) => {
        if (p.endsWith('settings.ts')) return false;
        const q = ohneKommentare(readFileSync(p, 'utf8'));
        return q.includes(schluessel) && /INSERT INTO system_settings/.test(q);
      });
      expect(
        inListe || eigeneRoute,
        `Der Schlüssel „${schluessel}" hält einen fiskalischen Vorgang an, lässt ` +
          'sich aber nirgends setzen. Das ist eine Sperre ohne Ausgang: der ' +
          'Mensch liest eine Absage, die einen Weg nennt, den es nicht gibt.',
      ).toBe(true);
    });
  }

  /**
   * ⚠️ DER ZWEITE SATZ, und er ist der wichtigere.
   *
   * Schreibbar allein genügt nicht: ohne FELD kommt der Händler nicht an die
   * Route. Genau das war der Zustand — die Schlüssel waren teils in der
   * Positivliste und trotzdem unerreichbar.
   */
  it('⛔ und jeder hat ein FELD in der Kasse, nicht nur eine Route', () => {
    const fensterQuellen = alleQuellen(FENSTER).map((p) => ohneKommentare(readFileSync(p, 'utf8')));
    const ohneFeld: string[] = [];
    for (const { schluessel, spurInDerKasse } of SPERRSCHLUESSEL) {
      if (!fensterQuellen.some((q) => q.includes(spurInDerKasse))) ohneFeld.push(schluessel);
    }
    expect(
      ohneFeld,
      'Diese Schlüssel halten einen fiskalischen Vorgang an, und die Kasse hat ' +
        'kein einziges Feld dafür. Der Händler steht neben dem Prüfer und ' +
        'findet den Ort nicht, den die Absage nennt.',
    ).toEqual([]);
  });

  it('die Suche findet überhaupt Dateien', () => {
    // Ohne diesen Satz wären die obigen auf leeren Listen grün.
    expect(SETTINGS.length).toBeGreaterThan(1000);
    expect(alleQuellen(FENSTER).length).toBeGreaterThan(100);
  });
});
