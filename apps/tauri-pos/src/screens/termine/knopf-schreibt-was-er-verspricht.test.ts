/**
 * Der Knopf muss schreiben, was auf ihm steht.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * Die Karte baute ihren Vorschlag aus `[1, 2, 3, 4, 5]`, also der üblichen
 * SQL-Zählung `DOW` mit Sonntag = 0. Der Server rechnet aber mit
 * `EXTRACT(ISODOW FROM tag) - 1`, also MONTAG = 0.
 *
 * Der Knopf hiess „Montag bis Freitag" und schrieb Dienstag bis Samstag.
 *
 * Am Tresen: der Händler richtet sonntagabends ein, drückt den einzigen Knopf,
 * liest „Zeiten gespeichert". Montagfrüh wird jeder Termin abgelehnt. Am
 * Samstag, wenn zu ist, nimmt die Kasse bereitwillig welche an, und ein Kunde
 * steht vor verschlossener Tür.
 *
 * ⚠️ Dieselbe Verwechslung hatte ich eine Stunde vorher im Server berichtigt
 * und die Fläche darüber vergessen. Eine Berichtigung, die nur eine von zwei
 * Seiten trifft, ist keine.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Nicht die Zahlen 0 bis 4. Die EIGENSCHAFT: der Vorschlag enthält genau die
 * Tage, die die Beschriftung nennt, mit den Nummern, die der SERVER für sie
 * vergibt. Ändert der Server seine Zählung, folgt die Karte, und dieser Satz
 * bleibt grün. Kehrt jemand zu festen Zahlen zurück, wird er rot.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { vorschlagAus, WERKTAGE } from './ArbeitszeitenCard.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const KARTE = resolve(HIER, 'ArbeitszeitenCard.tsx');
const SERVER_LIB = resolve(HIER, '../../../../api-cloud/src/lib/arbeitszeiten.ts');
const WANDERUNG = resolve(HIER, '../../../../../packages/db/migrations/0012_appointments.sql');

/**
 * Die Wochentagsliste, wie der SERVER sie liefert, aus seiner Quelle gelesen.
 *
 * Bewusst gelesen und nicht abgeschrieben: eine Kopie hier wäre genau die
 * zweite Wahrheit, die den Fehler erst möglich gemacht hat.
 */
function serverWochentage(): { nummer: number; name: string }[] {
  const quelle = readFileSync(SERVER_LIB, 'utf8');
  const block = /export const WOCHENTAGE[\s\S]*?\n\];/.exec(quelle)?.[0] ?? '';
  const tage: { nummer: number; name: string }[] = [];
  for (const t of block.matchAll(/\{\s*nummer:\s*(\d+),\s*name:\s*'([^']+)'\s*\}/g)) {
    tage.push({ nummer: Number(t[1]), name: t[2] as string });
  }
  return tage;
}

describe('Der Knopf schreibt, was er verspricht', () => {
  const tage = serverWochentage();

  it('die Wochentagsliste des Servers ist überhaupt lesbar', () => {
    // Ohne diesen Satz wäre jeder folgende auf einer leeren Liste grün.
    expect(tage.length, 'die Liste WOCHENTAGE des Servers wurde nicht gefunden').toBe(7);
    expect(tage.map((t) => t.name)).toContain('Montag');
  });

  it('der Vorschlag trägt GENAU die Tage, die auf dem Knopf stehen', () => {
    const vorschlag = vorschlagAus(tage);
    const nummerFuer = new Map(tage.map((t) => [t.name, t.nummer]));
    expect(vorschlag.map((f) => f.wochentag)).toEqual(
      WERKTAGE.map((n) => nummerFuer.get(n)),
    );
    expect(vorschlag).toHaveLength(WERKTAGE.length);
  });

  it('⛔ und mit der ECHTEN Zählung des Servers ist das Montag bis Freitag, also 0 bis 4', () => {
    // Die Probe an konkreten Zahlen. Sie ist die Umkehrung des Fehlers: mit
    // der alten Fassung stünde hier [1,2,3,4,5], also Dienstag bis Samstag.
    expect(vorschlagAus(tage).map((f) => f.wochentag)).toEqual([0, 1, 2, 3, 4]);
    expect(WERKTAGE[0]).toBe('Montag');
    expect(WERKTAGE[WERKTAGE.length - 1]).toBe('Freitag');
  });

  it('die Zählung des Servers stimmt mit der SQL-Regel überein', () => {
    // Der letzte Anker: die Regel steht wörtlich in der Wanderung. Ändert sie
    // sich, wird dieser Satz rot, statt dass die Kasse still einen Tag rutscht.
    const wanderung = readFileSync(WANDERUNG, 'utf8');
    expect(wanderung).toMatch(/wh\.weekday = \(EXTRACT\(ISODOW FROM d\.d\)::int - 1\)/);
    expect(tage.find((t) => t.name === 'Montag')?.nummer).toBe(0);
    expect(tage.find((t) => t.name === 'Sonntag')?.nummer).toBe(6);
  });

  it('die Karte trägt KEINE festen Wochentagsnummern mehr', () => {
    // Die eigentliche Behebung war nicht „1 wird zu 0", sondern „die Karte
    // kennt die Nummern gar nicht". Wer zu festen Zahlen zurückkehrt, holt
    // sich dieselbe Klasse Fehler zurück, und zwar lautlos.
    const roh = readFileSync(KARTE, 'utf8');
    const ohneKommentare = roh
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(
      ohneKommentare,
      'eine feste Zahlenreihe für Wochentage ist zurück in der Karte',
    ).not.toMatch(/\[\s*\d\s*,\s*\d\s*,\s*\d\s*,\s*\d\s*,\s*\d\s*\]/);
  });

  it('kennt der Server einen Werktag nicht, wird er ausgelassen statt geraten', () => {
    const ohneMittwoch = tage.filter((t) => t.name !== 'Mittwoch');
    const vorschlag = vorschlagAus(ohneMittwoch);
    expect(vorschlag).toHaveLength(WERKTAGE.length - 1);
    // Und ganz ohne Liste entsteht KEIN Vorschlag, statt einer erfundenen Woche.
    expect(vorschlagAus([])).toEqual([]);
  });
});
