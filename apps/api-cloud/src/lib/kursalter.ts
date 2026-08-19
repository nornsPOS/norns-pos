/**
 * Wie alt darf ein Metallkurs sein, bevor er nicht mehr als Ankaufsgrundlage
 * taugt?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN EINGEFRORENER KURS WURDE ALS AKTUELLER AUSGELIEFERT, SIEBEN TAGE LANG.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `current_metal_price_eur_per_gram` (Wanderung 0021) nimmt die offene Zeile
 * OHNE jede Altersgrenze:
 *
 *     SELECT price_per_gram_eur FROM metal_prices
 *      WHERE metal = p_metal AND valid_to IS NULL LIMIT 1
 *
 * Solange der Abruf scheitert, bleibt dieselbe Zeile offen und wird weiter
 * ausgeliefert, als wäre sie von eben. Die Route gab bis zum 26.07.2026 nicht
 * einmal einen Zeitstempel zurück, der Aufrufer konnte es also gar nicht
 * merken.
 *
 * ── Was wirklich passiert ist, an der Produktion gemessen ─────────────────
 *
 * Gold stand vom 05.06. bis zum 13.06. auf EINEM Kurs: 172,8 Stunden, also
 * 7,2 Tage. Alle vier Metalle gleichzeitig. Als der Abruf zurückkam, sprang
 * Gold um −2,6 Prozent und Palladium um +5,4 Prozent.
 *
 * Das ist nicht bloss eine falsche Anzeige. **Der Ankaufsatz wird ungefragt
 * ins Preisfeld vorgeschrieben.** Wer in diesem Fenster Gold ankauft, zahlt
 * nach einem Kurs, den es nicht mehr gibt, und der Fehler geht immer zu Lasten
 * einer der beiden Seiten.
 *
 * ── Warum 48 Stunden und nicht 24 ────────────────────────────────────────
 *
 * Gemessen, nicht geschätzt: die offenen Zeilen wechseln in der Produktion im
 * Abstand von rund 24 Stunden (24,0 · 24,0 · 24,2 Stunden in Folge). Eine
 * Grenze bei 24 Stunden würde also im NORMALBETRIEB dauernd anschlagen, und
 * eine Warnung, die immer leuchtet, wird abgeschaltet. Dann wäre nichts
 * gewonnen.
 *
 * 48 Stunden schlägt im Normalbetrieb nie an und hätte den Vorfall vom Juni am
 * zweiten Tag gemeldet, also fünf Tage früher als niemand.
 *
 * Die Grenze steht in `system_settings` und ist damit eine Einstellung, kein
 * Beton: wer den Abruf engmaschiger fährt, darf sie senken.
 */

/** Die Vorgabe, wenn in `system_settings` nichts steht. Siehe Begründung oben. */
export const KURS_HOECHSTALTER_STUNDEN = 48;

export interface Kursalter {
  /** Alter in Stunden, auf eine Stelle gerundet. `null`, wenn kein Kurs da ist. */
  alterStunden: number | null;
  /**
   * Zu alt für eine Ankaufsempfehlung?
   *
   * Auch `true`, wenn gar kein Kurs vorliegt: „kein Kurs" ist nicht besser als
   * „alter Kurs", sondern schlechter, und darf erst recht nicht stillschweigend
   * zu einem Preisvorschlag führen.
   */
  veraltet: boolean;
}

export function beurteileKursalter(input: {
  /** Wann der Kurs gültig wurde. `null`, wenn es keinen gibt. */
  gueltigSeit: Date | string | null;
  jetzt: Date;
  hoechstalterStunden?: number;
}): Kursalter {
  const grenze =
    Number.isFinite(input.hoechstalterStunden) && (input.hoechstalterStunden ?? 0) > 0
      ? (input.hoechstalterStunden as number)
      : KURS_HOECHSTALTER_STUNDEN;

  if (input.gueltigSeit === null) {
    return { alterStunden: null, veraltet: true };
  }

  const seit = input.gueltigSeit instanceof Date ? input.gueltigSeit : new Date(input.gueltigSeit);
  if (Number.isNaN(seit.getTime())) {
    // Ein unlesbarer Zeitstempel ist keine Erlaubnis, ihn zu ignorieren.
    return { alterStunden: null, veraltet: true };
  }

  const stunden = (input.jetzt.getTime() - seit.getTime()) / 3_600_000;
  // Ein Kurs aus der Zukunft ist ein Uhrfehler, kein frischer Kurs. Er zählt
  // als Alter null und gilt als brauchbar; wäre er es nicht, würde eine
  // schiefe Serveruhr den Laden lahmlegen.
  const gerundet = Math.round(Math.max(0, stunden) * 10) / 10;

  return { alterStunden: gerundet, veraltet: gerundet > grenze };
}
