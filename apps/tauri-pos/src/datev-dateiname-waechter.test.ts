/**
 * Der Wächter über dem NAMEN der DATEV-Datei (Kasse, Steuer-Export).
 *
 * ── WAS DER BEFUND WAR (11.08.2026) ─────────────────────────────────────────
 *
 * Der Server sendet im Kopf `content-disposition` bereits den richtigen Namen
 * nach DATEV-Schema, gebaut aus Beraternummer, Mandantennummer und Zeitraum
 * (`closing-export.ts`, `datevDateiname`). Die Fläche `SteuerExport.tsx`
 * warf diesen Namen weg und ERFAND einen eigenen, etwa den Stapel mit
 * vorangestelltem Wort DATEV und Datum. DATEVs Stapelverarbeitung zeigt eine
 * Datei ohne `EXTF`-Anfang GAR NICHT AN (Meldung REW04506): die Datei wirkt
 * beim Steuerberater verschwunden. Und weil jede Oberfläche anders erfand,
 * hiess derselbe Tag je Gerät anders.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ───────────────────────────────────
 *
 * Ein "sprechender" Name mit Datum sieht hilfreicher aus als die Nummernkette
 * des Servers. Aber der Name ist bei DATEV Teil des Vertrags, keine Kosmetik,
 * und nur der Server kennt Berater- und Mandantennummer. Jede lokale Erfindung
 * ist darum zwangsläufig falsch oder doppelt gepflegt.
 *
 * ── WAS DIESER WÄCHTER MISST ────────────────────────────────────────────────
 *
 * Den GEBRAUCH im Downloadweg, nicht eine Erwähnung: Kommentare werden vor dem
 * Messen weggeschnitten. Er verlangt, dass der DATEV-Zweig die Antwort MIT
 * Namen holt (`closingsApi.datevDatei`), dass der Name aus dem Antwortkopf
 * die Datei benennt und der Rückfall das `EXTF`-Schema achtet, und dass kein
 * erfundenes DATEV-Namensmuster mehr im Quelltext steht.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));

/** Kommentare entfernen, bevor gemessen wird. Ein Wächter, der Prosa liest,
 *  misst die Erzählung statt das Verhalten. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * ⚠️ GEFEGT, NICHT AUFGEZÄHLT. BEFUND VOM 13.08.2026.
 *
 * Hier stand `const FLAECHE = join(HIER, 'screens/secondary/SteuerExport.tsx')`,
 * also EINE Datei, namentlich. Gemessen gibt es zwei Stellen, die einen
 * DATEV-Dateinamen erzeugen:
 *
 *   screens/secondary/SteuerExport.tsx:210
 *   screens/secondary/SteuerComplianceSection.tsx:607
 *
 * Die zweite hat der Wächter nie gesehen. Sie ist heute in Ordnung, und genau
 * deshalb faellt es niemandem auf, wenn sie es einmal nicht mehr ist: sie
 * wurde noch nie geprüft.
 *
 * Ein Waechter, der über echte Dateien fegt, waechst mit dem Programm. Eine
 * Namensliste bleibt stehen, wo sie geschrieben wurde.
 *
 * ── ⚠️ UND DAS FEGEKRITERIUM DARF NICHT DAS SEIN, WAS GEPRÜFT WIRD ─────────
 *
 * Im ersten Entwurf fegte ich nach `EXTF_Buchungsstapel`, also nach genau der
 * Zeichenkette, deren Vorhandensein die Sätze unten verlangen. Beim Rot-Grün
 * fiel es auf: ich ersetzte den Namen in einer Fläche durch ein erfundenes
 * `DATEV_…`, und statt rot zu werden, sank die Satzzahl von 6 auf 4 und der
 * Lauf meldete GRÜN. Die Fläche war aus der Menge gefallen.
 *
 * Wer den schlimmsten Fehler macht, naemlich den Normnamen ganz wegzuwerfen,
 * wird damit unsichtbar. Ein Fegekriterium muss beschreiben, was der Code TUT,
 * nicht ob er es richtig tut. `closingsApi.datevDatei` ist der Griff, mit dem
 * ein DATEV-Stapel geholt wird; gemessen trifft er genau dieselben zwei
 * Flächen, ueberlebt aber jede Sabotage am Dateinamen.
 */
function datevAusgabestellen(): Array<{ name: string; quelle: string }> {
  const gefunden: Array<{ name: string; quelle: string }> = [];

  const durchsuche = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const pfad = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        durchsuche(pfad);
        continue;
      }
      if (!/\.tsx?$/.test(eintrag.name) || /\.test\.tsx?$/.test(eintrag.name)) continue;
      const quelle = ohneKommentare(readFileSync(pfad, 'utf8'));
      // Eine Ausgabestelle ist, wer einen DATEV-Stapel HOLT. Das ist eine
      // Aussage ueber die Handlung und ueberlebt jede Sabotage am Dateinamen.
      if (/closingsApi\.datevDatei\s*\(/.test(quelle)) {
        gefunden.push({ name: pfad.slice(HIER.length + 1), quelle });
      }
    }
  };
  durchsuche(HIER);
  return gefunden;
}

describe('Der Name der DATEV-Datei kommt vom Server, nicht aus der Fläche', () => {
  const stellen = datevAusgabestellen();

  it('⛔ es gibt überhaupt Ausgabestellen zu messen', () => {
    // „null ist nicht grün": fände die Suche nichts, wäre alles unten trivial
    // erfüllt. Am 13.08.2026 waren es zwei.
    expect(
      stellen.map((s) => s.name),
      'Keine einzige Fläche erzeugt einen DATEV-Dateinamen. Entweder wurde der ' +
        'Weg gekapselt, dann gehört dieser Wächter umgestellt, oder er misst ' +
        'ins Leere.',
    ).not.toEqual([]);
  });

  it.each(datevAusgabestellen().map((s) => ({ name: s.name, quelle: s.quelle })))(
    '⛔ $name: Name aus dem Antwortkopf, Rückfall achtet EXTF',
    ({ name, quelle }) => {
      expect(
        /dateiname\s*\?\?\s*`EXTF_Buchungsstapel_/.test(quelle),
        `In \`${name}\` muss der Downloadweg \`dateiname\` aus der Antwort ` +
          'nehmen und darf nur bei fehlendem Kopf auf einen Namen zurückfallen, ' +
          'der mit `EXTF_Buchungsstapel_` beginnt. Alles andere zeigt DATEVs ' +
          'Stapelverarbeitung nicht an, die Datei scheint dem Steuerberater ' +
          'schlicht zu fehlen.',
      ).toBe(true);
    },
  );

  it.each(datevAusgabestellen().map((s) => ({ name: s.name, quelle: s.quelle })))(
    '⛔ $name: kein erfundenes DATEV-Namensmuster',
    ({ name, quelle }) => {
      // Erfundene Dateinamen gehen nach dem Anfang DATEV mit `${...}` oder einer
      // Ziffer weiter (etwa der Rahmen oder das Datum). Echte Fehlercodes wie
      // `DATEV_MANDANT_FEHLT` gehen mit Grossbuchstaben weiter und bleiben
      // erlaubt; beim ersten Lauf traf die breite Fassung genau diesen Code.
      expect(
        /DATEV_(?![A-Z_])/.test(quelle),
        `In \`${name}\` steht noch ein selbstgebautes Dateinamen-Muster mit dem ` +
          'Anfang DATEV und Unterstrich. Solche Namen zeigt DATEVs ' +
          'Stapelverarbeitung gar nicht an, die Datei scheint verschwunden.',
      ).toBe(false);
    },
  );

  it('der DATEV-Zweig holt Inhalt UND Namen in einem Griff (datevDatei)', () => {
    // Diese Frage gilt der Fläche, die den Zeitraum-Export anbietet; nur dort
    // gibt es den Griff. Deshalb hier NICHT über alle Stellen.
    const haupt = stellen.find((s) => s.name.endsWith('SteuerExport.tsx'));
    expect(haupt, 'SteuerExport.tsx erzeugt keinen DATEV-Namen mehr.').toBeDefined();
    expect(
      /await closingsApi\.datevDatei\(/.test(haupt?.quelle ?? ''),
      'SteuerExport.tsx muss `closingsApi.datevDatei` aufrufen, die Fassung ' +
        'mit dem Dateinamen aus dem Antwortkopf. `datevCsv` allein wirft den ' +
        'Namen des Servers weg.',
    ).toBe(true);
  });
});
