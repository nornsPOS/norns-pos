/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Startliste fragt beim Umsatzsteuerschlüssel DENSELBEN Riegel
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * Gemessen an genau dem Stand, den der Drift-Wächter „FERTIG" nannte — TSE
 * eingetragen, Steuerstatus mit Datum, Stammdaten vollständig, alle sechs
 * DATEV-Angaben da:
 *
 *     offeneSchritte(FERTIG)                 = []      ← „alles erledigt"
 *     ustSchluesselFuer('MARGIN_25A', {})    wirft     ← 409, KEIN Paket
 *
 * `dsfinvk-daten.ts:416` ruft `ustSchluesselFuer` für JEDE Position auf. Trägt
 * eine davon die Differenzbesteuerung und ist keine eigene Nummer hinterlegt,
 * bricht der ganze Lauf mit `UstSchluesselOffenError` ab. Für einen
 * Edelmetallhändler ist § 25a der Regelfall: `NeuesProduktDialog.tsx` legt
 * jedes neue Produkt so an, `transactions-ankauf.ts` schreibt jeden Ankauf so.
 * Es scheitert also nicht ein seltener Tag, sondern fast jeder — und die
 * Startliste sagte dem Händler, es sei nichts mehr offen.
 *
 * Die Heilung ist EIN Feld und wirkt rückwirkend auf alle vergangenen Tage.
 * Genau deshalb ist das Verschweigen so teuer: wer die Fläche nie öffnet,
 * erfährt es zum ersten Mal, wenn der Prüfer im Laden steht.
 *
 * ── WAS DIESER WÄCHTER MISST, UND WARUM NICHT DER TEXT ─────────────────────
 *
 * NICHT, ob ein Punkt in einer Liste steht. Ein solcher Wächter misst die
 * ERWÄHNUNG. Gemessen wird der GEBRAUCH: für jede Kombination aus Behandlung
 * und eingetragener Nummer muss gelten
 *
 *     ustSchluesselFuer(code, eigene) wirft  ⇔  die Startliste hat den Punkt
 *
 * Ein Textvergleich könnte das hier gar nicht: `ustSchluesselFuer` bekommt die
 * Nummern als Aufzählung herein, und `closing-export.ts` baut sie über ein
 * PRÄFIX zusammen. Der Schlüsselname steht in keinem der beiden Riegel
 * wörtlich. Eine Textsuche wäre still grün und hätte nichts geprüft.
 *
 * ── UND DIE GEGENRICHTUNG ──────────────────────────────────────────────────
 *
 * Jede Behandlung aus `UST_SCHLUESSEL_OFFEN` — der Liste des Riegels selbst,
 * nicht einer Abschrift — muss einen Punkt bekommen. Kommt dort eine dritte
 * dazu, wird dieser Satz rot, statt dass sie stillschweigend durchfällt.
 */

import { describe, expect, it } from 'vitest';

import {
  UST_SCHLUESSEL_OFFEN,
  ustSchluesselFuer,
} from '../../src/lib/dsfinvk-schluessel.js';
import { type Bestandsaufnahme, kannVerkaufen, offeneSchritte } from '../../src/lib/einrichtung.js';

/** Eine Kasse, an der ALLES steht — bis auf das, was der jeweilige Satz wegnimmt. */
function fertig(einstellungen: Record<string, string | null>): Bestandsaufnahme {
  return {
    einstellungen: {
      'tse.tss_id': '11111111-2222-3333-4444-555555555555',
      'steuer.modus': 'REGELBESTEUERUNG',
      'steuer.modus_gilt_ab': '2020-01-01',
      'dsfinvk.gv_typ.ankauf': 'Auszahlung',
      'dsfinvk.ust_schluessel.margin_25a': '1001',
      'dsfinvk.ust_schluessel.reverse_charge_13b': '1002',
      'shop.name': 'Goldhaus Neustadt e. K.',
      'kasse.seriennummer': 'NORNS-0001',
      'datev.beraternummer': '29098',
      'datev.mandantennummer': '1042',
      'datev.wirtschaftsjahr_beginn': '2026-01-01',
      'datev.sachkontenlaenge': '4',
      'datev.festschreibung': 'true',
      'datev.sachkontenrahmen': 'SKR03',
      ...einstellungen,
    },
    hatArbeitszeiten: true,
    hatKassencode: true,
    fehlendeStammdaten: [],
  };
}

/** Der Einstellungsschlüssel zu einer Behandlung — gerechnet, nicht abgeschrieben. */
function schluesselFuer(code: string): string {
  return `dsfinvk.ust_schluessel.${code.toLowerCase()}`;
}

/** Die Werte, die eine Nummer haben KÖNNTE. Kein erfundener dabei. */
const WERTE: ReadonlyArray<{ was: string; wert: string | null }> = [
  { was: 'gar nicht beantwortet — DER BEFUND', wert: null },
  { was: 'leerer Eintrag', wert: '' },
  { was: 'nur Leerzeichen', wert: '   ' },
  { was: 'die Nummer des Beraters', wert: '1001' },
  { was: 'eine andere Nummer des Beraters', wert: '4711' },
];

describe('⛔ Startliste und Exportriegel teilen EINE Quelle für den Umsatzsteuerschlüssel', () => {
  it('⚠️ es gibt überhaupt offene Behandlungen zu messen', () => {
    // null ist nicht grün: eine leere Aufzählung liesse jeden Satz unten
    // durchlaufen, ohne etwas zu prüfen.
    expect(UST_SCHLUESSEL_OFFEN.length).toBeGreaterThan(0);
  });

  for (const code of UST_SCHLUESSEL_OFFEN) {
    for (const f of WERTE) {
      it(`⛔ ${code}, ${f.was}: die Liste sagt dasselbe wie der Riegel`, () => {
        const eigene: Record<string, string> =
          f.wert === null || f.wert.trim() === '' ? {} : { [code]: f.wert.trim() };

        let riegelSperrt = false;
        try {
          ustSchluesselFuer(code, eigene);
        } catch {
          riegelSperrt = true;
        }

        const schritte = offeneSchritte(fertig({ [schluesselFuer(code)]: f.wert }));
        const punkt = schritte.find((s) => s.schluessel === schluesselFuer(code));

        expect(
          punkt !== undefined,
          riegelSperrt
            ? 'Der Riegel bricht den ganzen Export mit 409 ab, die Startliste meldet ' +
              'trotzdem „erledigt". Der Händler erfährt es, wenn der Prüfer im Laden steht.'
            : 'Der Riegel lässt den Export laufen, die Startliste hält auf — eine Sperre, ' +
              'die es gar nicht gibt.',
        ).toBe(riegelSperrt);

        if (punkt !== undefined) {
          // Er sperrt den EXPORT, nicht den Tresen. Wer hier zu streng wäre,
          // hielte einen Laden an, der bloss noch nicht exportiert hat.
          expect(punkt.sperre).toBe('EXPORT');
          expect(kannVerkaufen(schritte)).toBe(true);
          // Und er sagt es auf Deutsch, nicht mit dem rohen Kennzeichen.
          expect(punkt.titel).not.toContain(code);
          expect(punkt.erklaerung).not.toContain(code);
          expect(punkt.erklaerung.length).toBeGreaterThan(60);
          // Ein Punkt ohne Weg ist ein Vorwurf.
          expect(punkt.ziel.pfad).toBe('/einstellungen');
          expect(punkt.ziel.bereich).toBe('steuer');
        }
      });
    }
  }

  it('⛔ jede offene Behandlung des Riegels hat einen eigenen Punkt', () => {
    // Die Gegenrichtung: kommt im Riegel eine dritte Behandlung dazu, darf sie
    // nicht stillschweigend an der Startliste vorbeigehen.
    const alles = offeneSchritte(
      fertig(
        Object.fromEntries(UST_SCHLUESSEL_OFFEN.map((c) => [schluesselFuer(c), ''])) as Record<
          string,
          string
        >,
      ),
    );
    for (const code of UST_SCHLUESSEL_OFFEN) {
      expect(
        alles.some((s) => s.schluessel === schluesselFuer(code)),
        `„${code}" sperrt den Export, fehlt aber in der Startliste`,
      ).toBe(true);
    }
  });

  it('⛔ und mit allen Nummern ist kein einziger dieser Punkte mehr offen', () => {
    // Gegenprobe gegen eine Liste, die schlicht immer aufhält.
    const keiner = offeneSchritte(fertig({}));
    expect(keiner.filter((s) => (s.schluessel ?? '').startsWith('dsfinvk.ust_schluessel.'))).toEqual(
      [],
    );
  });
});
