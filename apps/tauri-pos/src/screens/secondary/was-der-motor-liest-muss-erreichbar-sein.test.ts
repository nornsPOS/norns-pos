/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ WORAN DER MOTOR HÄNGT, MUSS DER HÄNDLER ERREICHEN KÖNNEN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 14.08.2026, UND ER KOSTETE DEN GANZEN GEWINN ───────────
 *
 * Der Verkaufsaufschlag ist der Prozentsatz, den die Kasse auf den Metallkurs
 * schlägt, wenn sie einen Verkaufspreis rechnet. Vier gemessene Zeilen:
 *
 *   1. `lib/verkaufsaufschlag.ts`: `const VORGABE = '0'`, also NULL Prozent.
 *   2. `lib/kurspreise-lesen.ts` liest ihn und rechnet damit JEDEN
 *      Verkaufspreis.
 *   3. Die EINZIGE Fläche, die ihn setzen kann, ist `VerkaufsaufschlagSection`
 *      im Bereich `aufschlag`.
 *   4. `aufschlag` stand nicht in `NORNS_BEREICHE`.
 *
 * Wirkung am Tresen: jeder aus dem Kurs gerechnete Verkaufspreis trug NULL
 * Aufschlag. Der Händler verkaufte Gold zum Einkaufspreis, und es gab keinen
 * Weg, das zu ändern.
 *
 * ── UND DIE URSACHE WAR EINE GUTE ABSICHT ─────────────────────────────────
 *
 * `NORNS_BEREICHE` ist dafür da, dem Händler die Bereiche zu ersparen, die er
 * nicht braucht. Ein richtiger Gedanke, und er hat acht von sechzehn
 * Bereichen still weggeräumt. Einer davon trug den Schalter, an dem der
 * Server hängt.
 *
 * Das ist die Hausklasse „Schalter ohne Ausgang", nur umgekehrt: der Schalter
 * blieb im Motor, die HAND, die ihn dreht, verschwand aus der Fläche.
 *
 * ── WAS DIESER WÄCHTER MISST ──────────────────────────────────────────────
 *
 * Für jeden Bereich, der einen Wert setzt, den der SERVER liest, wird
 * verlangt, dass er in `NORNS_BEREICHE` steht. Die Verbindung wird an der
 * ECHTEN Lesestelle im Motor nachgewiesen, nicht behauptet: verschwindet der
 * Leser, fällt der Eintrag hier auf.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const EINSTELLUNGEN = resolve(HIER, 'Einstellungen.tsx');
const MOTOR = resolve(HIER, '../../../../api-cloud/src');

/**
 * Die Bereiche, an denen der MOTOR hängt.
 *
 * Jeder Eintrag nennt drei Dinge, und alle drei werden geprüft:
 *   `bereich`  wie er in `NORNS_BEREICHE` heissen muss
 *   `flaeche`  das Bauteil, das den Wert wirklich schreibt
 *   `leser`    die Datei im Motor, die den Wert liest, mit dem Merkmal
 *
 * ⚠️ Eine blosse Namensliste würde blind. Deshalb wird jede Zeile gegen den
 * echten Leser im Motor gehalten: wer den Leser entfernt, sieht es hier.
 */
const HAENGT_AM_MOTOR = [
  {
    bereich: 'aufschlag',
    flaeche: 'VerkaufsaufschlagSection',
    leser: 'lib/kurspreise-lesen.ts',
    merkmal: 'leseVerkaufsaufschlag',
    warum:
      'Ohne diesen Bereich bleibt der Verkaufsaufschlag auf der Vorgabe NULL ' +
      'Prozent stehen, und die Kasse verkauft Gold zum Einkaufspreis.',
  },
  {
    bereich: 'kurse',
    flaeche: 'KursquelleSection',
    leser: 'lib/kursquellen.ts',
    merkmal: 'SCHLUESSEL_METALLQUELLE',
    warum: 'An der Kursquelle hängt jeder Ankaufpreis.',
  },
  {
    bereich: 'betrieb',
    flaeche: 'BetriebSection',
    leser: 'lib/haendler-stammdaten.ts',
    merkmal: 'shop.legal_name',
    warum: 'Ohne die Stammdaten verweigert der Motor jeden Steuerexport.',
  },
] as const;

/** Kommentare weg. Ein Bereichsname in einer Erklärung ist kein Eintrag. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => davor);
}

/** Die Bereichsliste der ausgelieferten Kasse, aus der Quelle gelesen. */
function ausgelieferteBereiche(quelle: string): string[] {
  const m = /const NORNS_BEREICHE[^=]*=\s*new Set<SectionId>\(\[([\s\S]*?)\]\)/.exec(quelle);
  if (m?.[1] === undefined) return [];
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((t) => t[1] ?? '');
}

describe('⛔ Woran der Motor hängt, muss erreichbar sein', () => {
  const roh = readFileSync(EINSTELLUNGEN, 'utf8');
  const quelle = ohneKommentare(roh);
  const bereiche = ausgelieferteBereiche(quelle);

  it('die Bereichsliste lässt sich überhaupt lesen', () => {
    // „null ist nicht grün": fände die Klammer nichts, wäre unten alles leer
    // und damit trivial erfüllt.
    expect(bereiche.length, 'NORNS_BEREICHE nicht gefunden oder leer').toBeGreaterThan(4);
  });

  it.each(HAENGT_AM_MOTOR)(
    '⛔ $bereich ist erreichbar, denn der Motor liest seinen Wert',
    ({ bereich, warum }) => {
      expect(
        bereiche,
        `Der Bereich "${bereich}" fehlt in NORNS_BEREICHE und ist damit in der ` +
          `AUSGELIEFERTEN Kasse nicht erreichbar. ${warum} Der Schalter bleibt ` +
          'im Motor, die Hand, die ihn dreht, fehlt in der Fläche.',
      ).toContain(bereich);
    },
  );

  it.each(HAENGT_AM_MOTOR)(
    '⛔ $bereich rendert die Fläche, die den Wert WIRKLICH schreibt',
    ({ bereich, flaeche }) => {
      // Ein Bereich in der Liste, dessen Fläche fehlt, wäre ein leeres Fach.
      expect(quelle, `${flaeche} wird nirgends gerendert`).toContain(`<${flaeche}`);
      expect(quelle, `der Bereich ${bereich} ist nicht angelegt`).toContain(`id: '${bereich}'`);
    },
  );

  it.each(HAENGT_AM_MOTOR)(
    '⛔ und der MOTOR liest diesen Wert wirklich (sonst ist der Eintrag Altlast)',
    ({ leser, merkmal, bereich }) => {
      /*
       * Die Gegenprobe. Ohne sie wäre diese Liste eine Behauptung: jemand
       * traegt einen Bereich ein, der Leser im Motor verschwindet, und der
       * Eintrag steht für immer da und schützt nichts.
       */
      const pfad = resolve(MOTOR, leser);
      let inhalt = '';
      try {
        inhalt = readFileSync(pfad, 'utf8');
      } catch {
        inhalt = '';
      }
      expect(
        inhalt.length,
        `Der Leser ${leser} existiert nicht mehr. Dann ist der Eintrag für ` +
          `"${bereich}" Altlast und gehört geprüft, nicht blind behalten.`,
      ).toBeGreaterThan(0);
      expect(
        inhalt,
        `${leser} nennt "${merkmal}" nicht mehr. Liest der Motor den Wert ` +
          'wirklich noch?',
      ).toContain(merkmal);
    },
  );
});
