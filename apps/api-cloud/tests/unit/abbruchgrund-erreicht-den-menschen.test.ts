/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein gesperrter Pflichtexport sagt WARUM, nicht „Internal server error"
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Drei sorgfältig geschriebene deutsche Abbruchmeldungen erreichen den
 * Bediener NIE:
 *
 *     closing-export.ts:289   MargeOhneEinkaufspreisError   extends Error
 *     closing-export.ts:325   UnbekannteSteuerbehandlungError extends Error
 *     dsfinvk-export.ts:314   ZNummerFehltError             extends Error
 *
 * Wer nicht von `DomainError` erbt, hat kein `httpStatus` und keinen `code`.
 * Der Fehlerbehandler kennt ihn nicht, bucht ihn als unerwartet, und der
 * Mensch liest „Internal server error".
 *
 * ── WARUM DAS MEHR IST ALS EIN HÄSSLICHER SATZ ─────────────────────────
 *
 * Alle drei sind RIEGEL vor einem Steuerexport: eine Marge ohne
 * Einkaufspreis, ein Steuerschlüssel ohne Konto, ein Abschluss ohne
 * Z-Nummer. Sie halten den Export an, weil die Ausgabe sonst falsch wäre.
 *
 * Ein Riegel, dessen Grund niemand erfährt, sieht aus wie ein Programmfehler.
 * Und ein Programmfehler wird irgendwann umgangen oder abgeschaltet — das
 * ist die eigentliche Folgegefahr, nicht der eine misslungene Export.
 *
 * ── ⚠️ DER SATZ DARF KEINEN UNMÖGLICHEN HANDGRIFF NENNEN ───────────────
 *
 * Gemessen: `transaction_items` ist unveränderlich, es gibt kein
 * `GRANT UPDATE`, und `acquisition_cost_eur_snapshot` hat ausserhalb des
 * Verkaufs keinen Schreiber. „Bitte den Einkaufspreis nachtragen" zeigt in
 * eine Wand. Wer einem Menschen einen Weg nennt, den es nicht gibt, kostet
 * ihn eine Stunde und danach das Vertrauen in jede weitere Meldung.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  MargeOhneEinkaufspreisError,
  UnbekannteSteuerbehandlungError,
} from '../../src/routes/closing-export.js';
import { ZNummerFehltError } from '../../src/lib/dsfinvk-export.js';
import { DomainError } from '../../src/plugins/error-handler.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');
const lies = (p: string): string => readFileSync(join(REPO, p), 'utf8');

const FAELLE = [
  { name: 'MargeOhneEinkaufspreisError', mach: () => new MargeOhneEinkaufspreisError('RCP-2026-000049') },
  { name: 'UnbekannteSteuerbehandlungError', mach: () => new UnbekannteSteuerbehandlungError('EXOTISCH') },
  { name: 'ZNummerFehltError', mach: () => new ZNummerFehltError('2026-06-01') },
] as const;

describe('⛔ Jeder Abbruchgrund trägt Rang und Kennung', () => {
  for (const f of FAELLE) {
    it(`⛔ ${f.name} ist ein DomainError`, () => {
      // Ohne das kennt der Fehlerbehandler ihn nicht und macht daraus 500.
      expect(f.mach()).toBeInstanceOf(DomainError);
    });

    it(`⛔ ${f.name} antwortet mit einem Rang unter 500`, () => {
      /**
       * 5xx heisst „wir haben einen Fehler". Diese drei sind aber KEIN
       * Programmfehler, sondern eine Lage, die der Mensch auflösen muss.
       * Ein 500 ruft den Entwickler; ein 409 ruft den Steuerberater.
       */
      const e = f.mach() as unknown as { httpStatus: number };
      expect(e.httpStatus, 'ein 5xx ruft den Falschen').toBeLessThan(500);
      expect(e.httpStatus).toBeGreaterThanOrEqual(400);
    });

    it(`⚠️ ${f.name} sagt den Satz auf Deutsch`, () => {
      const m = f.mach().message;
      expect(m.length, 'kein Satz').toBeGreaterThan(40);
      // Kein englischer Rest, der auf dem Bildschirm des Händlers landet.
      expect(m).not.toMatch(/\b(error|failed|invalid|missing)\b/i);
    });
  }
});

describe('⚠️ Der Satz nennt die Belegnummer und keinen unmöglichen Weg', () => {
  it('⛔ die Belegnummer steht in `details`, nicht nur im Fliesstext', () => {
    /**
     * Bei einem Zeitraumexport über hunderte Belege ist die Nummer die
     * einzige Angabe, mit der jemand die Stelle findet. Sie gehört an ein
     * Feld, das die Oberfläche gezielt anzeigen kann — so wie `lockedUntil`
     * bei der PIN-Sperre.
     */
    const e = new MargeOhneEinkaufspreisError('RCP-2026-000049') as unknown as {
      details?: { beleg?: string };
    };
    expect(e.details?.beleg).toBe('RCP-2026-000049');
  });

  it('⛔ er verspricht NICHT, den Einkaufspreis nachtragen zu können', () => {
    /**
     * ⚠️ Gemessen: `transaction_items` ist unveränderlich, kein
     * `GRANT UPDATE`, und `acquisition_cost_eur_snapshot` hat ausserhalb des
     * Verkaufs keinen Schreiber. Ein solcher Rat zeigt in eine Wand.
     */
    const m = new MargeOhneEinkaufspreisError('RCP-2026-000049').message;
    expect(m).not.toMatch(/nachtrag|nachzutragen|ergänzen|eintragen/i);
  });

  it('⚠️ und er nennt den Weg, den es WIRKLICH gibt', () => {
    // Die Belegzeile ist fiskal versiegelt. Was bleibt, ist der Steuerberater.
    const m = new MargeOhneEinkaufspreisError('RCP-2026-000049').message;
    expect(m).toMatch(/Steuerberater/);
  });
});

describe('⛔ Und `details` erreicht wirklich die Leitung', () => {
  it('⛔ der Fehlerbehandler reicht ein eigenes `details` durch', () => {
    /**
     * ⛔ 08.08.2026: er reichte NUR den einen Sonderfall `lockedUntil` durch.
     * Jede andere Klasse konnte ein `details` tragen, so viel sie wollte —
     * der Behandler warf es weg. Das Feld war gebaut, benannt, gefüllt, und
     * erreichte den Menschen nie.
     *
     * Dieselbe Klasse wie „das Antwortschema entfernt das ehrliche Feld",
     * nur eine Ebene höher.
     */
    const q = lies('apps/api-cloud/src/plugins/error-handler.ts');
    const zweig = q.slice(q.indexOf('err instanceof DomainError'), q.indexOf('3. Known PG triggers'));
    expect(zweig, 'das eigene details wird nicht gelesen').toMatch(
      /\(err as \{ details\?: unknown \}\)\.details/,
    );
  });

  it('⚠️ aber nur ein OBJEKT, keine formlose Zeichenkette', () => {
    // Eine Zeichenkette hier wäre eine zweite Fassung der Meldung; die
    // Oberfläche könnte damit nichts anfangen ausser sie anzuzeigen.
    const q = lies('apps/api-cloud/src/plugins/error-handler.ts');
    const zweig = q.slice(q.indexOf('err instanceof DomainError'), q.indexOf('3. Known PG triggers'));
    expect(zweig).toContain("typeof eigene === 'object'");
    expect(zweig).toContain('!Array.isArray(eigene)');
  });
});

describe('⚠️ Kein zweiter Weg, der die Klasse zurückbringt', () => {
  it('⛔ keine dieser Klassen erbt mehr direkt von Error', () => {
    /**
     * Gemessen an der Quelle, damit eine vierte Klasse derselben Bauart nicht
     * unbemerkt dazukommt. `extends Error` ist hier immer der Fehler: der
     * Fehlerbehandler kennt sie dann nicht.
     */
    for (const datei of [
      'apps/api-cloud/src/routes/closing-export.ts',
      'apps/api-cloud/src/lib/dsfinvk-export.ts',
    ]) {
      const q = lies(datei).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const roh = [...q.matchAll(/export class (\w+Error) extends Error\b/g)].map((m) => m[1]);
      expect(roh, `${datei}: erbt direkt von Error`).toEqual([]);
    }
  });

  it('⚠️ und keine setzt `this.name` noch von Hand', () => {
    // `DomainError` setzt ihn aus `new.target.name`. Eine handgetippte Zeile
    // daneben driftet beim ersten Umbenennen.
    for (const datei of [
      'apps/api-cloud/src/routes/closing-export.ts',
      'apps/api-cloud/src/lib/dsfinvk-export.ts',
    ]) {
      const q = lies(datei);
      expect(q, `${datei}`).not.toMatch(/this\.name = '\w+Error'/);
    }
  });
});
