/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ ES GIBT KEINE GNADENFRIST OHNE SICHERUNGSEINRICHTUNG. KEINEN EINZIGEN BELEG.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ANWEISUNG VOM 15.08.2026 ────────────────────────────────────────
 *
 * Am 13.08. gab es hier das Gegenteil: ein Wächter, der VERLANGTE, dass jeder
 * Schreibweg einen Vorrat von zehn Belegen ohne TSE nimmt. Nach der
 * Rechtsprüfung hat Basel die Frist gestrichen:
 *
 *     „Wer die Kasse herunterlädt, hat bereits bezahlt und erhält ein voll
 *      provisioniertes TSE."
 *
 * ── WARUM DAS KEINE GESCHMACKSFRAGE IST ────────────────────────────────────
 *
 * § 146a Abs. 1 Satz 5 AO verbietet, kassenfähige Software, welche die
 * Anforderungen nicht erfüllt, gewerbsmässig zu BEWERBEN oder IN VERKEHR ZU
 * BRINGEN. § 379 Abs. 1 Satz 1 Nr. 6 AO macht daraus eine Ordnungswidrigkeit,
 * § 379 Abs. 6 AO setzt den Rahmen auf 25.000 Euro — als Gefährdungsdelikt,
 * also OHNE dass ein Steuerschaden nötig wäre.
 *
 * Das Risiko trifft nicht den Händler, sondern NORNS. Und es ist nicht
 * theoretisch: LG Osnabrück 2 KLs 2/19 (Haftstrafen von 7,5 und 3,5 Jahren für
 * Anbieter von Kassensoftware), 2 KLs 4/24 (drei Jahre, 2025), FG
 * Rheinland-Pfalz 5 V 2068/14 (Geschäftsführerhaftung nach § 71 AO).
 *
 * Der amtliche Trainingsmodus (DSFinV-K 2.4 Tz. 4.2.6, `BON_TYP` mit dem Wert
 * `AVTraining`) läuft ausdrücklich DURCH die TSE. Einen legalen unsignierten
 * Betriebsmodus gibt es nicht.
 *
 * ── WAS DIESER WÄCHTER MISST ───────────────────────────────────────────────
 *
 * Er misst BEIDE Richtungen, und das ist der Kern:
 *
 *   1. Die Gnadenfrist ist WEG und kommt nicht zurück — kein Vorrat, keine
 *      laufende Nummer, keine Staffel, keine Ermahnung.
 *   2. Der Riegel selbst ist NOCH DA. Ein Wächter, der nur Abwesenheit
 *      verlangt, wäre auch dann grün, wenn jemand die TSE-Prüfung komplett
 *      entfernte. Das wäre die schlimmere Wunde.
 *   3. Der AUSFALL einer eingerichteten TSE bleibt UNANGETASTET. Er ist
 *      erlaubt (AEAO 1.14.3), der Beleg trägt „TSE-Ausfall", der Vorgang
 *      wandert in die Warteschlange. Wer diesen Weg mit abräumt, hält den
 *      Laden bei jedem Netzwackler an.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const QUELLE = resolve(HIER, '../../src');

/**
 * Kommentare raus, bevor gemessen wird.
 *
 * ⚠️ Die Narbe, die diese Funktion trägt, ist an diesem Wächter besonders
 * wichtig: unten stehen die verbotenen Wörter in den Fehlermeldungen und in
 * genau diesem Kopfkommentar. Ohne das Ausblenden wäre der Wächter über sich
 * selbst rot, und über die Grabsteine im Motor, die die Löschung erklären.
 * Erwähnung ist nicht Gebrauch.
 */
function ohneKommentare(quelle: string): string {
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, (treffer) => treffer.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (_t, vor: string) => vor);
}

interface Datei {
  name: string;
  quelle: string;
}

function sammle(wurzel: string): Datei[] {
  const gefunden: Datei[] = [];
  const fege = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const pfad = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        fege(pfad);
      } else if (eintrag.name.endsWith('.ts')) {
        gefunden.push({
          name: pfad.slice(QUELLE.length + 1),
          quelle: ohneKommentare(readFileSync(pfad, 'utf8')),
        });
      }
    }
  };
  fege(wurzel);
  return gefunden;
}

/** Das Vokabular der geloeschten Gnadenfrist. Nichts davon darf wiederkommen. */
const VERBOTENES_VOKABULAR = [
  'belege-vor-der-tse',
  'VORRAT_OHNE_TSE',
  'vorratOhneTse',
  'SPERRE_OHNE_TSE_SQL',
  'NAECHSTE_NUMMER_SQL',
  'satzVorratErschoepft',
  'belegvermerkOhneTse',
  'ohneTseNr',
] as const;

describe('⛔ Keine Gnadenfrist ohne Sicherungseinrichtung', () => {
  const alle = sammle(QUELLE);
  const routen = alle.filter((d) => d.name.startsWith('routes/'));

  it('es gibt überhaupt Quelltext zu messen', () => {
    // „null ist nicht grün": fände der Fegezug nichts, wäre alles unten
    // trivial erfüllt.
    expect(alle.length).toBeGreaterThan(50);
    expect(routen.length).toBeGreaterThan(20);
  });

  it('⛔ der Fegezug misst den GEBRAUCH, nicht die Erwähnung', () => {
    /*
     * Selbstprüfung. Ohne sie wäre die Verengung eine Behauptung: sie stünde
     * in einem Kommentar und niemand wüsste, ob sie noch greift. Und gerade
     * hier trägt der Motor Grabsteine, die die verbotenen Wörter NENNEN.
     */
    const probe = [
      "import { vorratOhneTse } from '../lib/belege-vor-der-tse.js';",
      '// vorratOhneTse in einem Zeilenkommentar',
      '/* vorratOhneTse in einem Blockkommentar */',
      'const x = 1;',
    ].join('\n');
    const gesaeubert = ohneKommentare(probe);
    expect(gesaeubert).not.toContain('// vorratOhneTse');
    // Die Zeilenzahl bleibt, sonst zeigen Befunde ins Nichts.
    expect(gesaeubert.split('\n').length).toBe(probe.split('\n').length);
    // Ein echter Gebrauch überlebt.
    expect(ohneKommentare('a = vorratOhneTse(db);')).toContain('vorratOhneTse');
  });

  it('⛔ das Vokabular der Gnadenfrist ist im ganzen Motor verschwunden', () => {
    const treffer: string[] = [];
    for (const datei of alle) {
      for (const wort of VERBOTENES_VOKABULAR) {
        if (datei.quelle.includes(wort)) treffer.push(`${datei.name}: ${wort}`);
      }
    }
    expect(
      treffer,
      'Die Gnadenfrist ohne Sicherungseinrichtung ist am 15.08.2026 ersatzlos ' +
        'gestrichen worden (§ 146a Abs. 1 Satz 5 AO, § 379 Abs. 1 Satz 1 Nr. 6 AO: ' +
        'bis 25.000 Euro, und das Risiko trifft NORNS, nicht den Händler). ' +
        'Diese Stellen holen sie zurück.',
    ).toEqual([]);
  });

  it('⛔ die Datei der Gnadenfrist existiert nicht mehr', () => {
    const libs = readdirSync(join(QUELLE, 'lib'));
    expect(
      libs.filter((n) => n.includes('belege-vor-der-tse')),
      'Die Datei ist gelöscht und bleibt gelöscht.',
    ).toEqual([]);
  });

  it('⛔ ABER: jeder Weg mit dem Riegel weist SOFORT ab, und der Riegel ist noch da', () => {
    /*
     * Die Gegenrichtung, und ohne sie wäre dieser Wächter gefährlich: „nichts
     * gefunden" wäre auch dann grün, wenn jemand die TSE-Prüfung ersatzlos
     * entfernte. Dann verkaufte die Kasse fröhlich ohne jede Signatur — genau
     * die Wunde, die hier verhindert werden soll, nur schlimmer.
     *
     * Namensfrei gemessen: wer in die fiskalische Tabelle schreibt, muss den
     * Riegel rufen.
     */
    const schreibendeWege = routen.filter(
      (r) =>
        r.quelle.includes('insert(transactions)') &&
        // Storno UND Rueckgabe: beides sind wirklich geschehene Umkehrungen,
        // die aufzeichenbar bleiben MUESSEN (BFH X R 23-24/21) — sie ziehen
        // nicht vom Gnadenvorrat und stehen dafuer namentlich in der
        // AUSGENOMMEN-Liste des Nachbarwaechters (jeder-weg-in-die-
        // fiskaltabelle), mit Grund.
        !r.name.includes('storno') &&
        !r.name.includes('rueckgabe'),
    );
    expect(
      schreibendeWege.length,
      'kein schreibender Weg gefunden; misst dieser Wächter das Richtige?',
    ).toBeGreaterThanOrEqual(3);

    const ohneRiegel = schreibendeWege
      .filter((r) => !r.quelle.includes('istSicherungseinrichtungEingerichtet'))
      .map((r) => r.name);
    expect(
      ohneRiegel,
      'Diese Wege schreiben in die fiskalische Tabelle, prüfen aber die ' +
        'Sicherungseinrichtung NICHT. Sie verkaufen ohne Signatur.',
    ).toEqual([]);

    // Und die Abweisung muss die Begruendung tragen, nicht bloss werfen.
    const ohneSatz = schreibendeWege
      .filter((r) => !r.quelle.includes('satzOhneSicherungseinrichtung'))
      .map((r) => r.name);
    expect(
      ohneSatz,
      'Diese Wege prüfen den Riegel, sagen dem Menschen aber nicht, WARUM und ' +
        'WOHIN. Der Satz wohnt in lib/kassenpflicht.ts.',
    ).toEqual([]);
  });

  it('⛔ UND: der AUSFALL einer eingerichteten TSE bleibt ein erlaubter Weg', () => {
    /*
     * Der dritte Riegel, und er schützt vor Übereifer. Basels Anweisung lautet
     * ausdrücklich: „Wenn das TSE später im laufenden Betrieb ausfällt, reicht
     * es völlig, dass auf dem Beleg deutlich TSE-Ausfall gedruckt wird."
     *
     * Rechtlich ist das AEAO Nr. 1.14: der Weiterbetrieb wird nicht
     * beanstandet, der Ausfall muss auf dem Beleg ersichtlich sein, die
     * Belegausgabepflicht bleibt. Wer diesen Weg mit abräumt, weil er wie die
     * Gnadenfrist aussieht, hält den Laden bei jedem Netzwackler an.
     *
     * ⚠️ Gemessen wird der AUSFALLVERMERK im Motor, nicht die Warteschlange.
     * Der erste Entwurf suchte `tse_queue` in `src/` und war rot — die
     * Warteschlange lebt im Rust-Teil der Kasse, nicht hier. Ein Wächter, der
     * am falschen Ort sucht, meldet einen Verlust, den es nicht gibt; genau
     * dafür ist er hier einmal rot geworden und wurde nachgemessen.
     *
     * Im Motor ist `lib/tse-ausfall.ts` der Ort: er trägt den Vermerk, der in
     * den Pflichtauszug wandert, wenn ein Beleg ohne Signatur blieb.
     */
    const heimat = alle.filter((d) => d.quelle.includes('TSE_AUSFALL_VERMERK'));
    expect(
      heimat.length,
      'Der Ausfallvermerk hat seine Heimat verloren (lib/tse-ausfall.ts). Ohne ' +
        'ihn hält ein Netzwackler den Laden an, statt den Ausfall zu ' +
        'kennzeichnen (AEAO 1.14.2 und 1.14.3).',
    ).toBeGreaterThanOrEqual(1);

    /*
     * ⚠️ Und er muss GEBRAUCHT werden, nicht nur existieren. Ein Vermerk, den
     * kein Exportweg liest, wäre die Hausklasse „Schalter ohne Ausgang": der
     * Ausfall stünde nirgends im Pflichtauszug, und genau das war der Befund
     * vom 14.08.2026 an dieser Stelle schon einmal.
     *
     * Gemessen am 15.08.2026: GENAU EINE Datei ruft ihn, `lib/dsfinvk-daten.ts`.
     *
     * ⚠️ Der erste Entwurf erwartete zwei, weil eine Textsuche auch
     * `lib/dsfinvk-dateien.ts` fand. Die Kommentarbereinigung oben hat das
     * korrigiert: dort steht der Name nur in einem Kommentar. Genau dafür ist
     * sie da — Erwähnung ist nicht Gebrauch, und dieser Wächter hat es an sich
     * selbst vorgeführt.
     */
    const nutzer = alle
      .filter((d) => d.name !== 'lib/tse-ausfall.ts' && d.quelle.includes('ausfallVermerk'))
      .map((d) => d.name);
    expect(
      nutzer,
      'Der Ausfallvermerk wird von keinem Exportweg mehr gelesen. Dann steht ' +
        'der Ausfall in KEINER Zeile des Pflichtauszugs.',
    ).toEqual(['lib/dsfinvk-daten.ts']);
  });
});
