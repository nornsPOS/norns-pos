/**
 * Der TSE-Riegel muss von der Kasse AUS aufhebbar sein.
 *
 * ── MEIN EIGENER FEHLER VOM 01.08.2026, gefunden am 02.08. ─────────────────
 *
 * Ich habe in `transactions-finalize.ts` einen Riegel eingebaut, der vor jedem
 * Verkauf die Zeilen in `tse_clients` zählt und bei null mit 409 abbricht. Der
 * Riegel selbst ist richtig: ohne Sicherungseinrichtung darf nach § 146a AO
 * kein Verkauf abgeschlossen werden.
 *
 * Nur war er auf einer AUSGELIEFERTEN Kasse unaufhebbar. Zwei Gründe, jeder
 * für sich schon tödlich:
 *
 * 1. NIEMAND SCHREIBT DIESE TABELLE. Ihr einziger Schreiber im ganzen Baum ist
 *    der Arbeiter-Auftrag `tse-cert-checker`. Der Arbeiter reist mit Norns POS
 *    ausdrücklich NICHT mit. Die TSE-Fläche der Kasse legt den Schlüssel in den
 *    Systemtresor und die Kennungen in den örtlichen Speicher des Fensters —
 *    sie schreibt nie eine Zeile in `tse_clients`.
 *
 * 2. ES IST DIE FALSCHE TABELLE. Ihre Spalten heissen `cert_valid_to`,
 *    `alert_sent_at`, `last_alert_tier`. Das ist ein Wachbuch über ablaufende
 *    Zertifikate, kein Verzeichnis eingerichteter Kassen. Selbst wenn jemand
 *    sie füllte, wäre die Frage „ist eine TSE eingerichtet" dort falsch
 *    gestellt.
 *
 * Am Tresen: der Händler richtet die TSE ein, die Fläche meldet sogar
 * „erreichbar", er drückt Bezahlen und liest „keine Sicherungseinrichtung
 * eingerichtet". Er geht zurück in die Geräte, alles steht richtig, er drückt
 * wieder Bezahlen, derselbe Satz. Es gibt keinen Ausweg. Der erste Kunde steht
 * daneben.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Nicht nur „der Riegel ist weg" — das wäre schlimmer als der Fehler. Sondern
 * die drei Eigenschaften zusammen:
 *
 *   • Ohne eingerichtete TSE wird weiterhin abgelehnt.
 *   • MIT eingerichteter TSE lässt sich der Riegel aufheben, und zwar über
 *     etwas, das die Kasse selbst schreiben KANN.
 *   • Der Riegel prüft weiterhin NICHT die Erreichbarkeit. Auf einer Kasse
 *     ohne Netz ist ein TSE-Ausfall der Regelfall, kein Ausnahmefall.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { satzOhneSicherungseinrichtung } from '../../src/lib/kassenpflicht.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const FINALIZE = join(HIER, '../../src/routes/transactions-finalize.ts');
/**
 * ⚠️ 02.08.2026: der Riegel ist aus der Route in eine gemeinsame Datei
 * gewandert, weil FÜNF weitere Wege in `transactions` schreiben und ihn nicht
 * hatten. Diese Sätze folgen ihm, statt seine alte Adresse festzuschreiben.
 */
/*
 * Riegel UND Absagesatz wohnen seit dem 15.08.2026 wieder in derselben Datei.
 * Hier standen zwei Konstanten, weil der Satz vom 13.08. bis zum 15.08. in
 * `lib/belege-vor-der-tse.ts` ausgewandert war. Mit der geloeschten
 * Gnadenfrist ist er zurueck, und es gibt nur noch eine Adresse.
 */
const KASSENPFLICHT = join(HIER, '../../src/lib/kassenpflicht.ts');
const TSE_ROUTE = join(HIER, '../../src/routes/tse-einrichtung.ts');

function lies(pfad: string): string {
  try {
    return readFileSync(pfad, 'utf8');
  } catch {
    return '';
  }
}

/** Kommentare weg: eine Erklärung ist kein Riegel. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Genau die Stelle, an der die Entscheidung fällt.
 *
 * ⚠️ Die erste Fassung schnitt rückwärts ab `KeineTseEingerichtetError(` bis
 * zur nächsten öffnenden Klammer. Das war ein WANDERNDES Fenster: gemessen
 * begann es an der Klammer INNERHALB der Zeichenkette `value #>> '{}'`, und
 * verschob jemand die Abfrage, wanderte das Fenster lautlos mit.
 *
 * Seit dem 02.08.2026 fällt die Entscheidung an einer benannten Stelle,
 * `istSicherungseinrichtungEingerichtet` in `lib/kassenpflicht.ts`. Der
 * Schnitt an einer Funktionssignatur ist eindeutig und wandert nicht.
 */
function entscheidungsblock(): string {
  const lib = ohneKommentare(lies(KASSENPFLICHT));
  const i = lib.indexOf('export async function istSicherungseinrichtungEingerichtet');
  return i < 0 ? '' : lib.slice(i);
}

describe('Der TSE-Riegel lässt sich von der Kasse aus aufheben', () => {
  it('findet die Dateien — sonst prüft dieser Test nichts', () => {
    expect(lies(FINALIZE).length).toBeGreaterThan(5000);
    expect(lies(TSE_ROUTE).length, 'die Einrichtungsroute fehlt ganz').toBeGreaterThan(800);
  });

  it('der Riegel liest NICHT mehr die Zählung von tse_clients', () => {
    // ⚠️ Das war der Fehler. `tse_clients` ist ein Wachbuch über ablaufende
    // Zertifikate, und auf einer Norns-Kasse schreibt es niemand.
    const block = entscheidungsblock();
    expect(block.length, 'die Entscheidung ist nicht auffindbar').toBeGreaterThan(100);
    expect(block, 'der Riegel hängt weiter an einer Tabelle, die niemand füllt').not.toMatch(
      /FROM tse_clients/,
    );
  });

  it('der Riegel liest, was die KASSE selbst schreiben kann', () => {
    const block = entscheidungsblock();
    // Der Nachweis steht in den Einstellungen, unter einem Schlüssel, den die
    // Einrichtungsroute setzt.
    expect(block).toMatch(/SCHLUESSEL_TSS_ID/);
    expect(ohneKommentare(lies(KASSENPFLICHT))).toMatch(/tse\.tss_id/);
    // Und die Verkaufsroute RUFT die Entscheidung wirklich.
    expect(ohneKommentare(lies(FINALIZE))).toMatch(/istSicherungseinrichtungEingerichtet\(/);
  });

  it('der Riegel prüft weiterhin KEINE Erreichbarkeit', () => {
    // Die Begründung ist unverändert: auf einer Kasse ohne Netz ist ein
    // TSE-Ausfall der Regelfall. Ein Riegel, der bei jedem Aussetzer den
    // Betrieb anhält, wäre schlimmer als das Problem.
    const block = entscheidungsblock();
    for (const verboten of ['erreichbar', 'reachable', 'ping', 'fetch(', 'lastReachable']) {
      expect(block, `der Riegel prüft „${verboten}" — das ist eine Erreichbarkeitsprüfung`).not.toContain(
        verboten,
      );
    }
  });

  it('es gibt eine Route, mit der die Kasse die TSE eintragen kann', () => {
    const rumpf = ohneKommentare(lies(TSE_ROUTE));
    expect(rumpf).toMatch(/'\/api\/tse\/einrichten'/);
    expect(rumpf).toMatch(/tse\.tss_id/);
  });

  it('die Eintragung ist dem Inhaber vorbehalten und wird protokolliert', () => {
    // Wer die TSE einträgt, hebt einen fiskalischen Riegel auf. Das ist keine
    // Kassiererhandlung, und es darf nicht spurlos geschehen.
    const rumpf = ohneKommentare(lies(TSE_ROUTE));
    expect(rumpf).toMatch(/requireOwner/);
    expect(rumpf).toMatch(/requireStepUp/);
    expect(rumpf, 'die Eintragung schreibt keine Tagebuchzeile').toMatch(
      /audit|tagebuch|ledger/i,
    );
  });

  it('die Eintragung nimmt keinen leeren Wert an', () => {
    // Sonst wäre der Riegel mit einem Klick auf „Speichern" aufgehoben, ohne
    // dass je eine TSE eingerichtet wurde — genau die Sorte Hintertür, die
    // einen fiskalischen Riegel wertlos macht.
    const rumpf = ohneKommentare(lies(TSE_ROUTE));
    expect(rumpf).toMatch(/minLength/);
  });

  it('der Satz für den Kassierer bleibt derselbe wie in der Ampel', () => {
    // EIN Wortlaut für denselben Zustand. Zwei verschiedene Erklärungen für
    // dieselbe Lage sind für den Menschen schlimmer als eine unvollständige.
    // Der Wortlaut wohnt jetzt bei der Entscheidung, damit ALLE Wege denselben
    // Satz sprechen, nicht nur der Verkauf.
    /*
     * ⚠️ 13.08.2026: der Wortlaut wohnt jetzt in `lib/kassenpflicht.ts`.
     * Die alte Fassung suchte ihn in `kassenpflicht.ts`, wo er stand, bis der
     * Vorrat von zehn Belegen dazukam. Ein Wächter, der an der alten Stelle
     * sucht, wird blind, sobald der Satz umzieht: er bliebe grün, auch wenn
     * gar kein Satz mehr existierte. Der Fegezug nimmt deshalb ALLE drei
     * Dateien.
     */
    const roh = `${lies(FINALIZE)}\n${lies(KASSENPFLICHT)}\n${lies(KASSENPFLICHT)}`;
    expect(roh).toMatch(/technische Sicherheitseinrichtung/);
    expect(roh).toMatch(/§ 146a AO/);
    // Und der Satz existiert wirklich, statt nur irgendwo erwähnt zu sein.
    expect(satzOhneSicherungseinrichtung('Verkauf')).toMatch(/§ 146a AO/);
  });
});
