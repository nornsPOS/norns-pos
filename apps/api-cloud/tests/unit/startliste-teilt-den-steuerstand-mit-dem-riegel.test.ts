/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Startliste liest den Steuerstand mit DERSELBEN Funktion wie der Riegel
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 11.08.2026 ──────────────────────────────────────────────
 *
 * Gemessen an einem frisch gewanderten Behälter, alle Assistentenfelder über
 * PATCH gesetzt, TSE-Kennung wie nach der Einrichtung:
 *
 *     kannVerkaufen = true
 *     steuer.modus  = "REGELBESTEUERUNG"   (eine Zeile, KEIN Datum)
 *     POST /api/transactions/finalize -> HTTP 403
 *       {"error":{"code":"VAT_CHECK_REQUIRED", …}}
 *
 * Der Riegel in `routes/transactions-finalize.ts` liest ZWEI Schlüssel und
 * reicht sie an `leseSteuerstand` weiter; diese Funktion gibt `modus: null`
 * zurück, sobald das Datum fehlt — mit gutem Grund, denn ein Modus ohne
 * Grenze macht den DATEV-Export rückwirkend falsch.
 *
 * Die Startliste dagegen prüfte nur, ob `steuer.modus` nicht leer ist. Damit
 * sagte sie dem Händler ausdrücklich, dass nichts mehr den Verkauf sperrt,
 * und die Kasse lehnte beim ersten Kunden am Tresen jeden Verkauf ab. Genau
 * der Zustand, den `lib/einrichtung.ts` in ihrem eigenen Kopf als schlimmer
 * als gar keine Liste beschreibt.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ──────────────────────────────────
 *
 * Naheliegend wäre gewesen, in `einrichtung.ts` ein zweites `leer(...)` für
 * `steuer.modus_gilt_ab` danebenzusetzen. Das ist dieselbe Wunde noch einmal:
 * zwei Stellen, die dieselbe Frage beantworten, driften wieder auseinander,
 * sobald `leseSteuerstand` seine Regel ändert (heute: „Tippfehler zählt als
 * nicht beantwortet"). Die Liste ruft deshalb DIE FUNKTION DES RIEGELS auf.
 *
 * ── WAS DIESER WÄCHTER MISST ───────────────────────────────────────────────
 *
 * Nicht die Liste gegen sich selbst, sondern gegen `leseSteuerstand`, die
 * `transactions-finalize.ts` bei jedem Verkauf aufruft: für jede Kombination
 * aus Modus und Datum muss gelten
 *
 *     leseSteuerstand(...).modus === null   ⇔   kannVerkaufen === false
 *
 * Läuft eine der beiden Seiten weg, wird dieser Satz rot — statt dass die
 * Kasse still „alles bereit" meldet.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type Bestandsaufnahme, kannVerkaufen, offeneSchritte } from '../../src/lib/einrichtung.js';
import { leseSteuerstand } from '../../src/lib/steuermodus.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const FINALIZE = join(HIER, '../../src/routes/transactions-finalize.ts');

/** Eine Kasse, an der ALLES steht — bis auf das, was der jeweilige Satz wegnimmt. */
function fertig(einstellungen: Record<string, string | null>): Bestandsaufnahme {
  return {
    einstellungen: {
      'tse.tss_id': '11111111-2222-3333-4444-555555555555',
      'steuer.modus': 'REGELBESTEUERUNG',
      'steuer.modus_gilt_ab': '2020-01-01',
      'dsfinvk.gv_typ.ankauf': 'Auszahlung',
      'shop.name': 'Goldhaus Neustadt e. K.',
      ...einstellungen,
    },
    hatArbeitszeiten: true,
    hatKassencode: true,
    fehlendeStammdaten: [],
  };
}

/** Die Fälle, die `leseSteuerstand` unterscheidet. Kein erfundener dabei. */
const FAELLE: ReadonlyArray<{ was: string; modus: string | null; ab: string | null }> = [
  { was: 'gar nichts beantwortet', modus: null, ab: null },
  { was: 'Modus ohne Datum — DER BEFUND', modus: 'REGELBESTEUERUNG', ab: null },
  { was: 'Modus mit leerem Datum', modus: 'REGELBESTEUERUNG', ab: '' },
  { was: 'Modus mit unlesbarem Datum', modus: 'REGELBESTEUERUNG', ab: 'irgendwann' },
  { was: 'Tippfehler im Modus, Datum da', modus: 'REGELBESTEURUNG', ab: '2020-01-01' },
  { was: 'Datum ohne Modus', modus: null, ab: '2020-01-01' },
  { was: 'beides vollständig', modus: 'REGELBESTEUERUNG', ab: '2020-01-01' },
  { was: '§ 19 vollständig', modus: 'KLEINUNTERNEHMER_19', ab: '2026-01-01' },
];

describe('⛔ Startliste und Verkaufsriegel teilen EINE Quelle für den Steuerstand', () => {
  it('der Verkaufsweg liest wirklich beide Schlüssel — sonst misst dieser Satz das Falsche', () => {
    // ⚠️ Kommentarzeilen weg, sonst zählte eine Erwähnung als Gebrauch.
    const code = readFileSync(FINALIZE, 'utf8')
      .split('\n')
      .filter((z) => {
        const t = z.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(code).toContain('leseSteuerstand');
    expect(code).toContain("'steuer.modus'");
    expect(code).toContain("'steuer.modus_gilt_ab'");
  });

  for (const f of FAELLE) {
    it(`⛔ ${f.was}: die Liste sagt dasselbe wie der Riegel`, () => {
      const stand = leseSteuerstand(f.modus, f.ab);
      const schritte = offeneSchritte(
        fertig({ 'steuer.modus': f.modus, 'steuer.modus_gilt_ab': f.ab }),
      );

      // Die eine Aussage, auf die es ankommt.
      expect(
        kannVerkaufen(schritte),
        stand.modus === null
          ? 'Der Riegel lehnt jeden Verkauf mit VAT_CHECK_REQUIRED ab, die Startliste ' +
            'meldet trotzdem „bereit". Der Händler erfährt es erst mit einem Kunden davor.'
          : 'Der Riegel lässt verkaufen, die Startliste hält auf — eine Sperre, die es ' +
            'gar nicht gibt.',
      ).toBe(stand.modus !== null);

      // Und wenn sie aufhält, dann mit einem Punkt, der den Steuerstand nennt.
      if (stand.modus === null) {
        const punkt = schritte.find((s) => s.schluessel === 'steuer.modus');
        expect(punkt, 'kein Punkt zum Umsatzsteuer-Status').toBeDefined();
        expect(punkt?.sperre).toBe('VERKAUF');
      }
    });
  }

  it('⚠️ der Punkt nennt BEIDE Schlüssel, nicht nur den halben', () => {
    // Der Befund war nicht „ein Schlüssel fehlt in der Prüfung", sondern
    // „ein Schlüssel fehlt im Bild". Wer die Liste liest, muss wissen, dass
    // auch das Datum eingetragen sein will.
    const schritte = offeneSchritte(
      fertig({ 'steuer.modus': 'REGELBESTEUERUNG', 'steuer.modus_gilt_ab': null }),
    );
    const punkt = schritte.find((s) => s.schluessel === 'steuer.modus');
    expect(punkt?.weitereSchluessel ?? []).toContain('steuer.modus_gilt_ab');
    expect(punkt?.erklaerung ?? '').toContain('Gilt ab');
  });
});
