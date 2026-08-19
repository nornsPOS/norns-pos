/**
 * ⛔ WÄCHTER: Der Tagesabschluss darf keine Nachreichung versprechen, die es
 *    für einen dauerhaft vermerkten Ausfall nie geben wird.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER GEMESSENE BEFUND VOM 13.08.2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Die Zusage stand auf DERSELBEN Fläche zweimal, aus zwei Quellen:
 *
 *   1. `TagesabschlussDialog.tsx:264`, wörtlich getippt:
 *      „Die fehlenden Signaturen werden nachgeholt, sobald die
 *       Sicherungseinrichtung wieder erreichbar ist."
 *
 *   2. Dieselbe Zusage durchgereicht: `describeError` antwortet auf das
 *      Merkmal „keine TSE-Signatur" wortgetreu wie der Server, und das Fenster
 *      zeigte diese Zeile direkt über dem Kasten.
 *
 * Der Server, der das auslöst, zählt nur: jeder Beleg des Tages OHNE Zeile in
 * `tse_signatures` (`closings-finalize.ts:637` folgende). Den GRUND kennt er
 * nicht. Darunter sind Belege, deren Ausfall `vermerkeDauerhaftenAusfall`
 * endgültig festgehalten hat — für die kommt nie mehr eine Signatur
 * (`lib/tse-queue-store.ts`, begründet in `istNachreichbar`), und im
 * schlimmsten Fall ist der Ausfall nicht einmal örtlich vermerkt.
 *
 * Wer den Kasten las, bestätigte die Lücke im Glauben, sie schliesse sich von
 * allein. Der Abschluss ist unwiderruflich.
 *
 * ── WAS DIESER WÄCHTER PRÜFT ──────────────────────────────────────────────
 *
 *   1. Der Satz über dem roten Knopf verspricht NICHTS und zählt ehrlich.
 *   2. Auch die durchgereichte Fehlerzeile verspricht auf dieser Fläche
 *      nichts mehr — sonst wäre die Lüge nur verschoben.
 *   3. Die Lagen darunter kommen aus der EINEN Quelle und nennen die
 *      endgültigen Fälle beim Namen.
 *   4. Die Fläche tippt den Satz nicht selbst: kein Text ausserhalb der
 *      Quelle darf eine Nachreichung versprechen.
 *
 * ⚠️ Bewusst NICHT geprüft: dass `describeError` die Zusage noch trägt. Wird
 * sie dort eines Tages gerichtet, ist das eine Verbesserung — ein Wächter, der
 * dann rot wird, erzieht zum Rückbau.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@norns/api-client';

import { giltAlsEndgueltig, giltAlsWartend } from '../../lib/fiskalzustand-satz.js';

import {
  LAGEN_OHNE_SIGNATUR,
  anzahlOhneSignatur,
  betrifftUnsignierteBelege,
  fehlersatz,
  unsignierteBelegeSatz,
} from './TagesabschlussDialog.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLE = readFileSync(join(HIER, 'TagesabschlussDialog.tsx'), 'utf8');

/** Quelltext ohne Kommentare — eine Erklärung ist kein Bildschirmtext. */
const OHNE_KOMMENTARE = QUELLE.replace(/\/\*[\s\S]*?\*\//g, '').replace(
  /(^|[^:])\/\/.*$/gm,
  '$1',
);

/** Der Wortlaut, mit dem der Server diesen Riegel wirft. */
const SERVERSATZ =
  '3 Belege dieses Tages tragen keine TSE-Signatur. Der Tag lässt sich abschliessen, ' +
  'aber nur ausdrücklich: die fehlenden Signaturen werden nachgeholt, sobald die ' +
  'Sicherungseinrichtung wieder erreichbar ist, und der Abschluss hält fest, dass sie ' +
  'zum Abschlusszeitpunkt fehlten.';

function absage(nachricht: string): ApiError {
  return new ApiError({ code: 'CONFLICT', message: nachricht, httpStatus: 409 });
}

/** Verspricht dieser Text, dass die Signatur noch kommt? */
const VERSPRICHT = /nachgeholt|nachgereicht|nachgemeldet|nachreicht|holt die Signatur/;

describe('⛔ Der Tagesabschluss verspricht keine Nachreichung', () => {
  it('erkennt die Absage des Servers am Wortlaut, nicht am Code', () => {
    expect(betrifftUnsignierteBelege(SERVERSATZ), 'Der Riegel wird nicht erkannt.').toBe(true);
    expect(
      betrifftUnsignierteBelege('Für diesen Tag deckt keine geschlossene Schicht die Belege ab.'),
      'Ein anderer Riegel desselben Weges wird faelschlich als Signaturluecke gelesen.',
    ).toBe(false);
  });

  it('nennt die Anzahl aus dem Wortlaut und erfindet nie eine', () => {
    expect(anzahlOhneSignatur(SERVERSATZ)).toBe(3);
    expect(unsignierteBelegeSatz(SERVERSATZ)).toContain('3 Belege');

    const einer = SERVERSATZ.replace('3 Belege dieses Tages tragen', '1 Beleg dieses Tages trägt');
    expect(anzahlOhneSignatur(einer)).toBe(1);
    expect(unsignierteBelegeSatz(einer), 'Bei einem Beleg steht die Mehrzahl.').toContain(
      'Ein Beleg',
    );

    // Ändert der Server seinen Wortlaut, darf hier KEINE Zahl stehen — lieber
    // ohne Anzahl als mit einer erfundenen.
    const ohneZahl = 'Für diesen Tag tragen noch Belege keine TSE-Signatur.';
    expect(anzahlOhneSignatur(ohneZahl)).toBeNull();
    expect(unsignierteBelegeSatz(ohneZahl)).not.toMatch(/\d/);
  });

  it('⛔ der Satz über dem roten Knopf verspricht keine Nachreichung', () => {
    expect(
      unsignierteBelegeSatz(SERVERSATZ),
      'Der Satz verspricht eine Nachreichung. Für einen dauerhaft vermerkten Ausfall ' +
        'kommt nie mehr eine Signatur, und der Abschluss ist unwiderruflich.',
    ).not.toMatch(VERSPRICHT);
  });

  it('⛔ auch die durchgereichte Fehlerzeile verspricht auf dieser Fläche nichts', () => {
    // Genau hier wäre die Lüge sonst nur verschoben: der Kasten richtig, die
    // Zeile direkt darüber falsch — auf demselben Schirm, im selben Augenblick.
    expect(
      fehlersatz(absage(SERVERSATZ)),
      'Die Fehlerzeile des Abschlusses verspricht eine Nachreichung. Sie steht auf ' +
        'DERSELBEN Fläche wie der Kasten darunter.',
    ).not.toMatch(VERSPRICHT);
    expect(fehlersatz(absage(SERVERSATZ)), 'Die Zeile nennt die Lücke nicht.').toContain(
      'keine Signatur der Sicherungseinrichtung',
    );
  });

  it('die anderen Fehlerfälle des Abschlusses bleiben unberührt', () => {
    const zukunft = new ApiError({
      code: 'VALIDATION_ERROR',
      message: 'businessDay',
      httpStatus: 400,
      details: { field: 'businessDay' },
    });
    expect(fehlersatz(zukunft)).toContain('Uhr dieser Kasse');
  });

  it('⛔ die Lagen kommen aus der Quelle und nennen die endgültigen Fälle', () => {
    expect(LAGEN_OHNE_SIGNATUR.length, 'Es wird gar keine Lage gezeigt.').toBeGreaterThanOrEqual(2);

    // Die eine Lage, für die die alte Zusage stimmte — sie darf bleiben.
    expect(
      LAGEN_OHNE_SIGNATUR.some((l) => VERSPRICHT.test(l.satz)),
      'Keine Lage sagt mehr, dass die Kasse es selbst nachholt. Das ist für den ' +
        'wartenden Beleg die Wahrheit und gehört auf den Schirm.',
    ).toBe(true);

    // Und die Lagen, wegen denen die Zusage nicht allein stehen durfte.
    const endgueltig = LAGEN_OHNE_SIGNATUR.filter((l) => l.zaehlung === 'endgueltig');
    expect(
      endgueltig.length,
      'Der Kasten zeigt keine einzige Lage, für die nie mehr eine Signatur kommt — ' +
        'dann liest sich die Liste wieder wie eine Zusage.',
    ).toBeGreaterThanOrEqual(2);
    for (const lage of endgueltig) {
      expect(lage.satz, `„${lage.titel}" verspricht trotzdem eine Nachreichung.`).not.toMatch(
        VERSPRICHT,
      );
      expect(lage.satz, `„${lage.titel}" sagt nicht, dass der Beleg keine Signatur trägt.`).toMatch(
        /KEINE Signatur/,
      );
    }

    // Der Fall echten Verlusts gehört auf eine Fläche mit unwiderruflichem Knopf.
    expect(
      LAGEN_OHNE_SIGNATUR.map((l) => l.tonlage),
      'Die Lage, in der nicht einmal örtlich vermerkt wurde, fehlt.',
    ).toContain('ernst');

    // Die Zählweisen stammen wirklich aus der Quelle, nicht aus einer Kopie.
    expect(LAGEN_OHNE_SIGNATUR.filter((l) => l.zaehlung === 'wartend').length).toBeGreaterThan(0);
    expect(giltAlsWartend('wartetAufAbschluss')).toBe(true);
    expect(giltAlsEndgueltig('dauerhaftVermerkt')).toBe(true);
  });

  it('⛔ die Fläche tippt keinen eigenen Signatursatz mehr', () => {
    const eigene = OHNE_KOMMENTARE.match(/'[^']*(?:nachgeholt|nachgereicht|nachgemeldet)[^']*'/g);
    expect(
      eigene ?? [],
      'Auf dieser Fläche steht wieder ein selbst getippter Satz über die Nachreichung. ' +
        'Genau so entstanden fünf Wahrheiten, die auseinanderliefen: der Satz gehört ' +
        'nach `lib/fiskalzustand-satz.ts` und wird von dort geholt.',
    ).toEqual([]);
  });

  it('⛔ und sie holt die Lagen wirklich aus der einen Quelle', () => {
    expect(
      OHNE_KOMMENTARE,
      'Der Bezug auf `lib/fiskalzustand-satz.ts` fehlt. Gebaut ist nicht angeschlossen.',
    ).toMatch(/from\s+'\.\.\/\.\.\/lib\/fiskalzustand-satz\.js'/);
    expect(OHNE_KOMMENTARE).toMatch(/fiskalzustandSatz\('dauerhaftVermerkt'\)/);
    expect(OHNE_KOMMENTARE).toMatch(/fiskalzustandSatz\('nichtGesichert'\)/);
  });
});
