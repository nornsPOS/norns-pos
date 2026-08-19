/**
 * Ohne eingerichtete Sicherungseinrichtung verkauft diese Kasse nicht.
 * Bei AUSFALL einer eingerichteten verkauft sie weiter.
 *
 * ── DER FUND VOM 01.08.2026 ─────────────────────────────────────────────────
 *
 * `transactions-finalize.ts` enthielt NULL Erwähnungen der TSE. Der Vorgang
 * wurde ohne jede Signaturbedingung gebucht.
 *
 * Der Beweis lag an drei Stellen zugleich:
 *
 *   1. In der Kasse ist die TSE-Klammer ausdrücklich als bester Wille gebaut.
 *      `BezahlenDialog.tsx:661` sagt wörtlich, TSE-Fehler blockieren den
 *      Verkauf nicht.
 *   2. Die einzige Warnung hängt an der Bedingung, dass eine TSS-Kennung
 *      EINGETRAGEN ist. Bei leerem Feld, also dem Zustand eines frisch
 *      installierten Ladens, gibt es keinen Hinweis und keine Sperre. Der
 *      gedruckte Beleg trägt an allen vier Signaturstellen „TSE Ausfall".
 *   3. Der Tagesabschluss zählt die fehlenden Signaturen, hält aber nichts an.
 *
 * Damit konnte eine ausgelieferte Norns POS einen ganzen Handelstag lang
 * unsignierte Kassenbelege erzeugen, drucken und abschliessen, ohne dass
 * irgendwo etwas rot wurde. § 146a AO kennt keine Ausnahme, und die Folge
 * trifft den Händler (§ 379 AO plus Hinzuschätzung), während die Bauweise
 * belegt, dass es so gebaut wurde.
 *
 * ── DIE UNTERSCHEIDUNG, DIE DIESER WÄCHTER SCHÜTZT ─────────────────────────
 *
 * Es gibt ZWEI Zustände, und sie brauchen zwei verschiedene Antworten:
 *
 *   KEINE EINGERICHTET   Kein Ausfall, sondern eine Kasse, die § 146a AO
 *                        nicht erfüllt. Der Verkauf hält an.
 *
 *   EINGERICHTET, WEG    Der dokumentierte Ausfall nach § 6 KassenSichV. Der
 *                        Verkauf läuft, der Beleg wird gekennzeichnet, die
 *                        Signatur wird nachgeholt.
 *
 * Die zweite Hälfte ist kein Nachlassen, sondern der Kern: Norns POS ist eine
 * Kasse OHNE Netz, und der einzige gebaute TSE-Weg ist ein WOLKEN-Weg. Damit
 * ist der Ausfall der Regelfall. Ein Riegel, der auch ihn sperrt, hielte den
 * Laden an, sobald das Netz wackelt.
 *
 * Ein Wächter, der nur die erste Hälfte prüft, lädt genau dazu ein, den
 * Riegel eines Tages „sicherheitshalber" auf jeden TSE-Fehler auszuweiten.
 * Deshalb prüft dieser hier beide Hälften.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { satzOhneSicherungseinrichtung } from '../../src/lib/kassenpflicht.js';
import { judgeFiscalHealth } from '../../src/lib/fiscal-health.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const FINALIZE = join(HIER, '../../src/routes/transactions-finalize.ts');
/**
 * ⚠️ 02.08.2026: der Riegel ist aus der Route in eine gemeinsame Datei
 * gewandert, weil FÜNF weitere Wege in `transactions` schreiben und ihn nicht
 * hatten. Dieser Wächter folgt ihm dorthin, statt seine alte Adresse
 * festzuschreiben: ein Wächter, der die Umsetzung pinnt, macht jede
 * Berichtigung rot.
 */
const KASSENPFLICHT = join(HIER, '../../src/lib/kassenpflicht.ts');

/** Route UND gemeinsamer Riegel: die Eigenschaft lebt in beiden zusammen. */
function quelle(): string {
  return `${readFileSync(FINALIZE, 'utf8')}\n${readFileSync(KASSENPFLICHT, 'utf8')}`;
}

/** Kommentare weg: eine Erklärung ist kein Riegel. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Kein Verkauf ohne eingerichtete Sicherungseinrichtung', () => {
  it('findet die Datei — sonst prüft dieser Test nichts', () => {
    expect(quelle().length).toBeGreaterThan(5000);
  });

  /**
   * ⚠️ 02.08.2026 BERICHTIGT — und der Grund ist selbst eine Lehre.
   *
   * Diese drei Sätze verlangten wörtlich `count(*) FROM tse_clients`. Sie
   * waren grün, während der Riegel auf einer ausgelieferten Kasse UNAUFHEBBAR
   * war: diese Tabelle hat genau einen Schreiber, den Arbeiter-Auftrag
   * `tse-cert-checker`, und der reist mit Norns POS nicht mit.
   *
   * Ein Wächter, der die UMSETZUNG festschreibt statt der EIGENSCHAFT, hält
   * einen Fehler fest, statt ihn zu finden. Er hat hier sogar aktiv geschadet:
   * er hätte jede Berichtigung rot gemacht.
   *
   * Geprüft wird ab jetzt die Eigenschaft: der Riegel liest etwas, das die
   * Kasse SELBST setzen kann.
   */
  it('der Verkaufsweg kennt die TSE überhaupt', () => {
    // Der eigentliche Fund: vor dem 01.08.2026 war die Antwort hier null.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/tse\.tss_id/);
    // Und die Route RUFT den gemeinsamen Riegel wirklich, statt ihn nur zu
    // erwähnen. Ohne diesen Satz wäre der obige grün, sobald irgendwo im
    // gemeinsamen Modul die Zeichenkette steht.
    expect(ohneKommentare(readFileSync(FINALIZE, 'utf8'))).toMatch(
      /istSicherungseinrichtungEingerichtet\(/,
    );
  });

  it('fragt die eingerichteten Klienten ZÄHLEND ab, nicht mutmassend', () => {
    // Der Nachweis muss aus der DATENBANK kommen, nicht aus einer Vermutung
    // von Hand auf „ja" stellen könnte.
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/SELECT[\s\S]{0,80}system_settings/);
    // ⚠️ Und die Tabelle, an der es einmal hing, darf NICHT zurückkommen.
    expect(rumpf, 'tse_clients ist ein Wachbuch über Zertifikate, kein Verzeichnis').not.toMatch(
      /FROM tse_clients/,
    );
  });

  it('wirft bei null Klienten, statt nur zu warnen', () => {
    const rumpf = ohneKommentare(quelle());
    expect(rumpf).toMatch(/throw new KeineTseEingerichtetError/);
  });

  /**
   * ⚠️ DIE ZWEITE HÄLFTE, und sie ist die wichtigere.
   *
   * Der Riegel darf sich NICHT auf die Erreichbarkeit stützen. Täte er es,
   * stünde der Laden bei jedem Netzausfall.
   */
  it('sperrt NICHT bei blossem Ausfall einer eingerichteten Einrichtung', () => {
    // ⚠️ Der erste Anlauf dieses Satzes war GRÜN AUS DEM FALSCHEN GRUND: er
    // suchte ab dem ersten Vorkommen von `KeineTseEingerichtetError`, und das
    // war die KLASSENDEKLARATION, nicht die Entscheidung.
    //
    // Seit dem 02.08.2026 fällt die Entscheidung an EINER Stelle, in
    // `istSicherungseinrichtungEingerichtet`. Geprüft wird deshalb genau
    // dieser Rumpf, aufgeschnitten an seiner Signatur.
    const lib = ohneKommentare(readFileSync(KASSENPFLICHT, 'utf8'));
    const anfang = lib.indexOf('export async function istSicherungseinrichtungEingerichtet');
    expect(anfang, 'die Entscheidung ist nicht auffindbar').toBeGreaterThan(0);
    const rumpf = lib.slice(anfang).toLowerCase();
    expect(rumpf, 'die Entscheidung liest den Schlüssel nicht').toContain('schluessel_tss_id');

    // Kein Wort über Erreichbarkeit, Signaturen oder Warteschlange in der
    // ENTSCHEIDUNG. Sie darf nur lesen, was eingerichtet ist.
    for (const verboten of ['reachable', 'erreichbar', 'tse_signatures', 'queue', 'online']) {
      expect(
        rumpf,
        `Die Entscheidung darf sich nicht auf „${verboten}" stützen — sonst hält sie den Laden bei jedem Netzausfall an.`,
      ).not.toContain(verboten);
    }
  });

  it('nennt § 146a und sagt, was zu TUN ist', () => {
    /*
     * Ein Riegel, der nur „nicht erlaubt" sagt, verwandelt einen lösbaren
     * Zustand in eine Sackgasse.
     *
     * ⚠️ 13.08.2026: der Wortlaut ist von `lib/kassenpflicht.ts` nach
     * `lib/kassenpflicht.ts` gewandert, weil die Absage seither einen
     * anderen Grund hat: nicht mehr „es gibt keine TSE", sondern „die zehn
     * Belege ohne sie sind aufgebraucht". Geprüft wird jetzt der Satz, der
     * dem Kassierer WIRKLICH erscheint.
     */
    const text = satzOhneSicherungseinrichtung('Verkauf');
    expect(text).toContain('§ 146a');
    expect(text).toMatch(/Einstellungen/);
  });

  it('⛔ widerspricht der Fiskal-Ampel nicht', () => {
    /*
     * Kassierer und Inhaber dürfen für DENSELBEN Zustand nicht zwei
     * einander widersprechende Erklärungen lesen.
     *
     * ⚠️ Bis zum 13.08.2026 verlangte diese Prüfung WÖRTLICHE Gleichheit.
     * Das ging nicht mehr, und zwar zu Recht: die Ampel des Inhabers
     * beschreibt den Dauerzustand („keine TSE eingerichtet"), die Absage am
     * Tresen beschreibt den Augenblick („die zehn sind aufgebraucht"). Beide
     * sind wahr, und die zweite ist genauer. Wörtliche Gleichheit zu
     * erzwingen hiesse, die genauere Auskunft zu verbieten.
     *
     * Geprüft wird deshalb, was wirklich zählt: beide nennen dieselbe Norm,
     * und keiner behauptet, es sei alles in Ordnung.
     */
    const ampel = judgeFiscalHealth({ clients: 0, certDays: null, unsignedRecent: 0, zertifikatUeberwacht: true });
    expect(ampel.status).toBe('alert');
    expect(ampel.reason).toContain('§ 146a AO');
    expect(satzOhneSicherungseinrichtung('Verkauf')).toContain('§ 146a AO');
    // Und die Ampel verschweigt den Zustand nicht.
    expect(ampel.reason).toMatch(/keine technische Sicherheitseinrichtung/);
  });

  it('die Ampel bleibt bei EINGERICHTETER Einrichtung ohne Mängel grün', () => {
    // Die Gegenprobe zum Riegel: ein eingerichteter Klient ohne offene
    // Signaturen darf nicht als Mangel gelten, sonst wäre der gemeinsame
    // Wortlaut oben ein Zufall.
    const ampel = judgeFiscalHealth({ clients: 1, certDays: 200, unsignedRecent: 0, zertifikatUeberwacht: true });
    expect(ampel.status).not.toBe('alert');
  });
});
