/**
 * Die Zwischenform einer Buchungszeile, in unseren Begriffen.
 *
 * ── WAS HIER FRÜHER STAND (bis 26.07.2026) ────────────────────────────────
 * Ein Schreiber, der eine zwölfspaltige CSV mit selbst erfundenen Spalten-
 * namen erzeugte und sie „DATEV-Buchungsstapel" nannte. Sie war es nicht: das
 * Format hat 125 Spalten an festen Positionen, und eine Datei mit zwölf
 * verschiebt jedes Feld. Sein Test schrieb den Fehler wörtlich fest
 * (`expect(csv).toContain('"1234,56";"S";"EUR"')`) und war deshalb grün.
 *
 * Geschrieben wird jetzt in `datev-format.ts`, gegen DATEVs eigene Vorlage.
 * Übrig bleibt hier nur die Zwischenform: `toDatevRows` in der Exportroute
 * denkt in Konten und Beträgen, `zuDatevZeile` übersetzt das in Feldnummern.
 * Diese Trennung ist der Grund, warum die Kontierung lesbar bleibt.
 */

/** One accounting booking line, in domain terms (pre-DATEV-formatting). */
export interface DATEVRow {
  /** Gross booking amount, positive, NUMERIC(18,2) string e.g. "123.45". */
  amountEur: string;
  /** Debit/credit indicator — DATEV "Soll/Haben-Kennzeichen". */
  debitCredit: 'S' | 'H';
  /** Posting account (DATEV "Konto"). */
  account: string;
  /** Contra account (DATEV "Gegenkonto (ohne BU-Schlüssel)"). */
  contraAccount: string;
  /** Tax key (DATEV "BU-Schlüssel"). Optional. */
  taxKey?: string;
  /** Document date, ISO `YYYY-MM-DD` — emitted as DATEV DDMM. */
  date: string;
  /** Belegfeld1 — our receipt locator / document number. */
  reference: string;
  /** Free-text Buchungstext (max 60 chars in DATEV; truncated). */
  bookingText: string;
  /**
   * Generalumkehr — DATEV-Feld 118. `true` heisst: diese Zeile MINDERT die
   * ursprüngliche Buchung, statt auf der Gegenseite neuen Umsatz zu erzeugen.
   *
   * Nur für Stornozeilen. Siehe die Begründung in `closing-export.ts` bei
   * `isStornoRow`.
   */
  generalumkehr?: boolean;
}
