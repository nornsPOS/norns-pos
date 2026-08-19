/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN TAKT, DER IMMER SCHEITERT, SOLL NICHT IMMER SCHREIEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Am 26.07.2026 gemessen: der Kalendertakt schlug alle 15 Sekunden fehl, jedes
 * Mal mit vollem Stapelabzug. Daraus wurden **9141 Bytes je Minute, also rund
 * 12 MB je Tag** — aus EINEM Behälter, der gerade erst gestartet war. Und die
 * Behälter schreiben ohne Grössengrenze.
 *
 * Der Fehler dahinter war echt und lag seit Tagen an: das Google-Projekt des
 * Dienstkontos war **gelöscht**. Ein Zustand, der sich in 15 Sekunden mit
 * Sicherheit nicht ändert.
 *
 * ── Warum das mehr ist als eine grosse Datei ─────────────────────────────
 *
 * Ein Protokoll, in dem dieselbe Zeile 5760 Mal am Tag steht, ist kein
 * Protokoll mehr. Wer darin nach einem ANDEREN Fehler sucht, findet ihn nicht.
 * Der Dauerfehler verdeckt genau das, wofür das Protokoll da ist — und niemand
 * merkt es, weil ja „nur" eine bekannte Meldung wiederholt wird.
 *
 * ── Was hier NICHT passiert ──────────────────────────────────────────────
 *
 * Der Fehler wird **nicht verschluckt**. Er wird beim ersten Mal voll gemeldet
 * und danach in wachsenden Abständen wiederholt, mit der Zahl der
 * unterdrückten Versuche dabei. Wer die Zeile liest, weiss also, dass es
 * weiterging und wie oft. Ein stiller Rückzug wäre die andere, schlimmere
 * Hälfte desselben Fehlers.
 *
 * Und der ERFOLG setzt alles zurück: sobald ein Takt durchgeht, ist der
 * nächste Fehler wieder ein voller.
 */

export interface RueckzugStand {
  /** Wie viele Fehlversuche seit dem letzten Erfolg. */
  fehler: number;
  /** Wie viele Meldungen seit dem letzten Ausdruck unterdrückt wurden. */
  unterdrueckt: number;
  /** Beim wievielten Fehler wird das nächste Mal gemeldet? */
  naechsteMeldungBei: number;
}

export function neuerStand(): RueckzugStand {
  return { fehler: 0, unterdrueckt: 0, naechsteMeldungBei: 1 };
}

/**
 * Meldet dieser Fehlversuch, oder wird er unterdrückt?
 *
 * Die Folge ist 1, 2, 4, 8 … bis zur Obergrenze. Bei 15 Sekunden Takt heisst
 * das: die ersten Fehler sofort, danach höchstens alle 240 Takte, also rund
 * einmal je Stunde. Aus 5760 Zeilen am Tag werden knapp 30.
 */
export const RUECKZUG_HOECHSTABSTAND = 240;

export interface Entscheidung {
  melden: boolean;
  /** Wie viele Versuche seit der letzten Meldung geschluckt wurden. */
  unterdrueckt: number;
  fehlerGesamt: number;
}

export function zaehleFehler(stand: RueckzugStand): Entscheidung {
  stand.fehler += 1;

  if (stand.fehler >= stand.naechsteMeldungBei) {
    const unterdrueckt = stand.unterdrueckt;
    stand.unterdrueckt = 0;
    // Verdoppeln, aber gedeckelt: sonst stünde nach einem Tag Ausfall die
    // nächste Meldung erst in einer Woche an, und dann wäre der Rückzug
    // faktisch ein Verschlucken.
    stand.naechsteMeldungBei = Math.min(
      stand.fehler + Math.min(stand.fehler, RUECKZUG_HOECHSTABSTAND),
      stand.fehler + RUECKZUG_HOECHSTABSTAND,
    );
    return { melden: true, unterdrueckt, fehlerGesamt: stand.fehler };
  }

  stand.unterdrueckt += 1;
  return { melden: false, unterdrueckt: stand.unterdrueckt, fehlerGesamt: stand.fehler };
}

/**
 * Ein gelungener Takt setzt zurück.
 *
 * Gibt zurück, ob vorher etwas kaputt war — dann gehört eine Erholungsmeldung
 * ins Protokoll. Ohne sie stünde dort ein Ausfall ohne Ende, und niemand
 * wüsste, wann er vorbei war.
 */
export function zaehleErfolg(stand: RueckzugStand): { warKaputt: boolean; fehlerWaren: number } {
  const warKaputt = stand.fehler > 0;
  const fehlerWaren = stand.fehler;
  stand.fehler = 0;
  stand.unterdrueckt = 0;
  stand.naechsteMeldungBei = 1;
  return { warKaputt, fehlerWaren };
}
