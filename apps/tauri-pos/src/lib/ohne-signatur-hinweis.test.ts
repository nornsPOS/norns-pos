/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Beleg ohne Signatur darf den Kassierer nicht unbemerkt verlassen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 *     BezahlenDialog.tsx:1031        } else if (hardwareCfg.tse.tssId.length > 0) {
 *     AnkaufBezahlenDialog.tsx:479   } else if (hardwareCfg.tse.tssId.length > 0) {
 *
 * Der Hinweis „ohne Signatur abgeschlossen" hing daran, dass ÖRTLICH etwas
 * eingetragen war. War das Feld leer, gab es keinen Zweig und KEINEN Hinweis.
 *
 * Und leer kann es sein, ohne dass jemand etwas falsch macht: Zweitkasse,
 * geleerter Webview-Speicher, oder `validateSection` wirft das ganze
 * `tse`-Teilobjekt auf die Vorgabe zurück. `hydrateFromLocal` fängt das still
 * ab, und der Speicher fragt den Server NIE nach.
 *
 * Ein Arbeitsplatz konnte so einen ganzen Handelstag lang unsignierte Belege
 * erzeugen, ohne dass irgendwo etwas rot wird.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { fiskalzustandSatz } from './fiskalzustand-satz.js';
import { grundOhneSignatur, hinweisOhneSignatur } from './ohne-signatur-hinweis.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const lies = (p: string): string => readFileSync(join(HIER, '../..', p), 'utf8');

/** Blockkommentare und Zeilenkommentare weg, damit Prosa nichts auslöst. */
const ohneKommentare = (q: string): string =>
  q.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Der Grund wird am örtlichen Feld erkannt', () => {
  it('⛔ ein LEERES Feld heisst: diese Kasse hat gar keine TSE', () => {
    // Genau dieser Fall hatte vorher keinen Zweig und blieb stumm.
    expect(grundOhneSignatur('')).toBe('keine_tse_hinterlegt');
    expect(grundOhneSignatur('   ')).toBe('keine_tse_hinterlegt');
    expect(grundOhneSignatur(null)).toBe('keine_tse_hinterlegt');
    expect(grundOhneSignatur(undefined)).toBe('keine_tse_hinterlegt');
  });

  it('ein gefülltes Feld heisst: eingerichtet, aber gerade nicht erreichbar', () => {
    expect(grundOhneSignatur('tss-4711')).toBe('tse_nicht_erreichbar');
  });
});

describe('⛔ Der Satz sagt ausdrücklich, dass die Signatur FEHLT', () => {
  it('der Wortlaut nennt es beim Namen, für beide Vorgänge', () => {
    /**
     * Ein Hinweis, der nur „nicht erreichbar" sagt, klingt nach einer Störung,
     * die von selbst vergeht. Hier vergeht sie nie, weil niemand etwas
     * eingerichtet hat.
     */
    for (const vorgang of ['Verkauf', 'Ankauf'] as const) {
      const h = hinweisOhneSignatur('keine_tse_hinterlegt', vorgang);
      expect(h.body, vorgang).toContain('KEINE Signatur');
      expect(h.body).toContain(vorgang);
      expect(h.title.length).toBeGreaterThan(10);
    }
  });

  it('⚠️ der fehlenden Einrichtung liegt ein Handgriff bei', () => {
    // Ohne ihn weiss der Kassierer, dass etwas fehlt, aber nicht, wohin er
    // gehen soll.
    expect(hinweisOhneSignatur('keine_tse_hinterlegt', 'Verkauf').body).toMatch(/Einstellungen/);
  });

  it('⛔ der Wortlaut ist Zeichen für Zeichen der aus der EINEN Quelle', () => {
    /**
     * Diese Brücke darf nichts Eigenes sagen. Driftet sie, lesen Verkaufs- und
     * Ankaufweg wieder zwei Erklärungen für denselben Zustand — genau der
     * Zerfall, an dem der Satz einmal an fünf Stellen auseinanderlief.
     */
    for (const vorgang of ['Verkauf', 'Ankauf'] as const) {
      const quelle = fiskalzustandSatz('ohneSicherungseinrichtung', vorgang);
      const h = hinweisOhneSignatur('keine_tse_hinterlegt', vorgang);
      expect(h.title).toBe(quelle.titel);
      expect(h.body).toBe(`${quelle.satz} ${quelle.naechsterSchritt.text}`);
    }
  });
});

describe('⛔ DER BEFUND VOM 13.08.2026 — diese Datei verspricht nichts mehr', () => {
  /**
   * ── WAS HIER STAND UND WARUM ES EINE LÜGE WAR ────────────────────────────
   *
   * Der zweite Fall antwortete auf `tse_nicht_erreichbar` mit „Die Signatur
   * wird nachgeholt, sobald die Sicherungseinrichtung wieder antwortet."
   *
   * Der Satz kam aus einer Angabe über den ÖRTLICHEN Speicher und behauptete
   * daraus etwas über einen fiskalischen Vorgang. Scheitert schon die
   * Eröffnung, hat die Sicherungseinrichtung den Vorgang nie gesehen und kann
   * ihn nie nachträglich signieren. Nachgeholt wurde nichts.
   *
   * ⚠️ Und diese Prüfdatei hielt den Defekt FEST: sie verlangte den Wortlaut
   * mit `toMatch(/nachgeholt/)`. Ein Wächter, der eine Lüge einfordert, macht
   * ihre Behebung zum roten Test. Deshalb steht hier jetzt das Gegenteil.
   */
  it('kein Zweig dieser Datei verspricht eine Nachreichung', () => {
    // ⚠️ OHNE Kommentare gemessen: der Kopf dieser Datei ZITIERT den alten
    // Satz, damit er nicht vergessen wird. Ein Wächter, der an einer
    // Erklärung anschlägt, wird beim nächsten Mal abgeschaltet.
    const q = ohneKommentare(lies('src/lib/ohne-signatur-hinweis.ts'));
    expect(q).not.toMatch(/nachgeholt|nachgereicht|nachgemeldet/);
  });

  it('⛔ ein zweiter Grund kommt an der Typprüfung nicht mehr vorbei', () => {
    /**
     * Die eigentliche Abhilfe ist die Verengung des ersten Wertes auf
     * `'keine_tse_hinterlegt'`. Sie ist kein Kommentar, sondern ein Riegel:
     * wer `tse_nicht_erreichbar` hier hineinreichen will, muss stattdessen
     * messen. Gemessen wird die Verengung selbst — ein `OhneSignaturGrund` an
     * dieser Stelle liesse den alten Fall wieder herein.
     */
    const q = ohneKommentare(lies('src/lib/ohne-signatur-hinweis.ts'));
    const kopf = /export function hinweisOhneSignatur\(\s*grund:\s*([^,]+),/.exec(q);
    expect(kopf?.[1]?.trim(), 'die Verengung ist weg — der zweite Grund kommt zurück').toBe(
      "'keine_tse_hinterlegt'",
    );
  });
});

describe('⛔ Der Zweig in beiden Masken ist BEDINGUNGSLOS', () => {
  const MASKEN = [
    'src/screens/verkauf/BezahlenDialog.tsx',
    'src/screens/ankauf/AnkaufBezahlenDialog.tsx',
  ] as const;

  for (const maske of MASKEN) {
    it(`⛔ ${maske} hängt den Hinweis nicht mehr am örtlichen Feld`, () => {
      /**
       * ⚠️ Gemessen wird die SACHE: kein `else if` auf der Länge der örtlichen
       * Kennung mehr. Wer diese Bedingung wieder einführt, macht die Maske
       * erneut stumm — und zwar genau für den Arbeitsplatz, der gar keine TSE
       * hat, also für den gefährlichsten Fall.
       */
      /**
       * ⚠️ Gemessen wird der CODE, nicht die Prosa. Die erste Fassung dieser
       * Prüfung suchte den Satz im ganzen Text — und wurde rot an dem
       * Kommentar, der den behobenen Fehler ZITIERT. Ein Wächter, der auf eine
       * Erklärung anspringt, wird beim nächsten Mal abgeschaltet.
       */
      const q = ohneKommentare(lies(maske));
      expect(q).not.toMatch(/else if \(hardwareCfg\.tse\.tssId\.length > 0\)/);
    });

    it(`⛔ ${maske} nimmt den Wortlaut aus der EINEN Quelle`, () => {
      // Zwei Masken, ein Wortlaut. Sonst driften sie, und der Kassierer liest
      // für denselben Zustand zwei Erklärungen.
      const q = lies(maske);
      expect(q).toContain('hinweisOhneSignatur');
      expect(q).toContain('grundOhneSignatur');
    });
  }
});
