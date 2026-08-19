/**
 * ════════════════════════════════════════════════════════════════════════
 *  Null ist nicht grün — zwei Anzeigen, zwei Richtungen, dieselbe Klasse
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DIE BEIDEN BEFUNDE VOM 08.08.2026 ───────────────────────────────────
 *
 * In DERSELBEN Abfrage, achtzig Zeilen auseinander:
 *
 *   system-health.ts:149  clients aus `tse_clients`
 *                         → Tabelle ohne Schreiber in Norns POS
 *                         → clients immer 0 → Ampel dauerhaft ROT
 *
 *   system-health.ts:227  chainStale = chainLastOk ? … : false
 *                         → nie geprüft wird zu „nicht veraltet"
 *                         → Anzeige dauerhaft GRÜN „Läuft"
 *
 * Zwei Lügen in entgegengesetzte Richtungen aus derselben Ursache: eine
 * fehlende Zahl wurde als Aussage gelesen.
 *
 * Beide Lampen sind gleich wertlos. Eine, die immer leuchtet, wird
 * weggeschaut; eine, die nie leuchtet, wird geglaubt.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  KETTEN_TAKT_MS,
  KETTE_VERALTET_MS,
  beurteileKette,
  kettenSatz,
} from '../../src/lib/kettenpruefung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');
const lies = (p: string): string => readFileSync(join(REPO, p), 'utf8');

describe('⛔ Nie geprüft ist ein eigener Zustand', () => {
  it('⛔ null ist NICHT „frisch"', () => {
    // Der Kern des Befunds. Vorher las die Route genau hier ein `false` und
    // meldete grün.
    expect(beurteileKette(null, Date.parse('2026-08-08T12:00:00Z'))).toBe('nie');
  });

  it('ein Lauf von heute früh ist frisch', () => {
    const jetzt = Date.parse('2026-08-08T12:00:00Z');
    expect(beurteileKette(new Date(jetzt - 60 * 60 * 1000), jetzt)).toBe('frisch');
  });

  it('ein Lauf von vorgestern ist alt', () => {
    const jetzt = Date.parse('2026-08-08T12:00:00Z');
    expect(beurteileKette(new Date(jetzt - 48 * 60 * 60 * 1000), jetzt)).toBe('alt');
  });

  it('⚠️ die Grenze liegt ÜBER dem Takt, nicht darauf', () => {
    /**
     * Läge sie genau auf dem Takt, würde jeder Rechner, der über Nacht aus
     * war, beim Einschalten warnen. Eine Warnung, die jeden Morgen kommt,
     * ist keine Warnung.
     */
    expect(KETTE_VERALTET_MS).toBeGreaterThan(KETTEN_TAKT_MS);
  });

  it('jeder Zustand hat einen deutschen Satz, und die drei sind verschieden', () => {
    const saetze = (['nie', 'frisch', 'alt'] as const).map(kettenSatz);
    expect(new Set(saetze).size).toBe(3);
    for (const s of saetze) expect(s.length).toBeGreaterThan(20);
  });
});

describe('⛔ Die Anzeigen lesen Quellen, die diese Kasse wirklich füllt', () => {
  it('⛔ die Fiskal-Ampel liest NICHT mehr die tote Tabelle tse_clients', () => {
    /**
     * Gemessen am 08.08.2026: `tse_clients` wird ausschliesslich von
     * `apps/worker/src/jobs/tse-cert-checker.ts` beschrieben, und der
     * Arbeiter reist mit Norns POS nicht mit. Auf einer ausgelieferten Kasse
     * ist die Zahl deshalb für immer 0, und `judgeFiscalHealth` nimmt sofort
     * den Alarmzweig — auch wenn die TSE sauber eingerichtet ist und jeder
     * Beleg signiert wird.
     *
     * Dieselbe Berichtigung hat `transactions-finalize.ts` am 02.08.2026
     * schon bekommen; die Ampel blieb zurück.
     */
    const q = lies('apps/api-cloud/src/routes/system-health.ts');
    /**
     * ⚠️ Gemessen wird die SACHE, nicht das Wort. `tse_clients` darf sehr wohl
     * noch gelesen werden — als Wachbuch über ablaufende Zertifikate ist sie
     * genau das. Verboten ist allein, aus ihrer ZEILENZAHL abzuleiten, ob
     * eine Sicherungseinrichtung eingerichtet ist.
     *
     * Ein Wächter, der schlicht das Wort `tse_clients` verbietet, wäre beim
     * ersten berechtigten Gebrauch rot geworden — und ein roter Wächter wird
     * abgeschaltet.
     */
    expect(q).toMatch(/AS clients[\s\S]{0,80}FROM system_settings|FROM system_settings[\s\S]{0,120}AS clients/);
    expect(q).not.toMatch(/COUNT\(\*\)::int\s+AS clients/);
  });

  it('⛔ sie liest stattdessen dieselbe Quelle wie der Riegel im Verkauf', () => {
    // EIN Ort für diese Entscheidung. Zwei Wahrheiten für denselben Zustand
    // waren der Grund, dass die eine jahrelang falsch sein konnte.
    const q = lies('apps/api-cloud/src/routes/system-health.ts');
    expect(q).toMatch(/istSicherungseinrichtungEingerichtet|SCHLUESSEL_TSS_ID/);
  });

  it('⛔ die Kettenanzeige behandelt „noch nie" ausdrücklich', () => {
    const q = lies('apps/api-cloud/src/routes/system-health.ts');
    expect(q).toContain('beurteileKette');
  });

  it('⛔ und die Kasse prüft ihre Kette SELBST, weil es sonst niemand tut', () => {
    /**
     * Eine Anzeige, die dauerhaft „nie geprüft" sagt, ist genauso wertlos
     * wie eine dauerhaft grüne. Norns POS ist für immer offline und hat
     * keinen Arbeiter — prüft die Kasse nicht selbst, prüft es NIEMAND.
     */
    /**
     * ⚠️ Gemessen wird der AUFRUF, nicht die Erwähnung.
     *
     * Die erste Fassung dieser Prüfung suchte schlicht das Wort
     * `starteKettenpruefung` in `server.ts`. Die Sabotage „Aufruf auskommentiert"
     * blieb damit GRÜN — die Einfuhrzeile oben trägt dasselbe Wort. Ein Wächter,
     * der die Einfuhr misst, prüft, dass jemand die Datei kennt, nicht dass er
     * sie benutzt.
     */
    const server = lies('apps/api-cloud/src/server.ts');
    const ohneEinfuhr = server
      .split('\n')
      .filter((z) => !z.trimStart().startsWith('import'))
      .filter((z) => !z.trimStart().startsWith('//'))
      .join('\n');
    expect(ohneEinfuhr, 'der Takt wird nirgends gestartet').toMatch(/starteKettenpruefung\(/);
  });

  it('⚠️ und sie zeichnet den Lauf mit EINER Einfügung auf, nie mit einem UPDATE', () => {
    /**
     * Gemessen in `sidecar/erststart/schema.sql`:
     *
     *     GRANT SELECT,INSERT ON worker_job_runs TO warehouse14_app;
     *
     * Der Rumpf darf NICHT UPDATE. Der Weg des Arbeiters — RUNNING einfügen,
     * danach ändern — scheitert hier erst zur Laufzeit auf der Kasse des
     * Händlers. Klasse „Spaltenrechte, die still sperren".
     */
    const q = lies('apps/api-cloud/src/lib/kettenpruefung.ts');
    const ohneKommentare = q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(ohneKommentare).not.toMatch(/UPDATE\s+worker_job_runs/i);
    expect(ohneKommentare).toMatch(/INSERT INTO worker_job_runs/);
  });

  it('⚠️ ein Bruch wird als FAILED aufgezeichnet, nicht als bestandener Lauf', () => {
    /**
     * Sonst zählt die Ampel den Lauf als Erfolg und die Kette gilt als heil,
     * obwohl die Funktion gerade einen Bruch gemeldet hat.
     */
    const q = lies('apps/api-cloud/src/lib/kettenpruefung.ts');
    expect(q).toMatch(/heil \? 'SUCCESS' : 'FAILED'/);
  });
});
