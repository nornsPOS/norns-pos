/**
 * ⛔ EIN GUTSCHEIN LÄSST SICH OHNE NETZ NICHT EINLÖSEN
 *
 * ── DER BEFUND VOM 12.08.2026 ──────────────────────────────────────────────
 *
 * Fiel das Netz beim Bezahlen aus, während ein Gutschein angewandt war, ging
 * der Beleg samt VOUCHER-Zahlungsbein in den Ausgangskorb, und die Fläche
 * meldete: „Gutschein wird erst beim Synchronisieren verbucht. Bitte später
 * prüfen."
 *
 * Dieser Satz war FALSCH. Gemessen:
 *   · Der Abzug geschieht ausschliesslich in `POST /api/vouchers/:code/redeem`
 *     (`vouchers.ts`, die einzige Stelle, die `current_balance_eur` setzt).
 *   · Dieser Aufruf steht NUR im Online-Erfolgszweig und wurde offline weder
 *     ausgeführt noch eingereiht.
 *   · `transactions-finalize.ts` enthält NULL Gutschein-Logik (gezählt: 0
 *     Treffer), und kein Auslöser bucht ein VOUCHER-Zahlungsbein ab.
 *
 * Folge: der Kunde bezahlte mit dem Gutschein (der Barbetrag wurde um seinen
 * Wert gesenkt), das Guthaben blieb aber unangetastet und voll einlösbar.
 * Echter Geldverlust in Gutscheinhöhe, bei jedem Netzausfall.
 *
 * ── WARUM HIER NICHT NACHGEREICHT WIRD ─────────────────────────────────────
 *
 * Die naheliegende Idee wäre, den Einlöse-Aufruf mit einzureihen. Sie geht
 * nicht: `redeem` verlangt eine ECHTE `transactionId`, und die vergibt der
 * SERVER erst beim Abspielen. Offline gibt es sie nicht, und eine erfundene
 * verletzt den Fremdschlüssel.
 *
 * Die saubere Lösung ist serverseitig (finalize löst das VOUCHER-Bein in
 * derselben Transaktion ein) und ist eine fiskalische Änderung, die ihre
 * eigene Runde verdient. Bis dahin gilt die Hausregel: was nicht sicher
 * gebucht werden kann, wird nicht angenommen. Die Kasse verkauft weiter —
 * nur eben bar oder mit Karte.
 */

export interface GutscheinLage {
  /** Ist ein Gutschein auf diesen Beleg angewandt? */
  readonly gutscheinAngewandt: boolean;
  /** Der Anteil, den der Gutschein tragen soll, in ganzen Cent. */
  readonly gutscheinCents: bigint;
  /** Ist die Kasse gerade am Netz? */
  readonly amNetz: boolean;
}

export interface GutscheinUrteil {
  /** Darf der Beleg so abgeschlossen werden? */
  readonly erlaubt: boolean;
  /** Was der Kassierer liest. Leer, wenn erlaubt. */
  readonly satz: string;
}

/**
 * Das Urteil vor dem Abschluss.
 *
 * Nur die Kombination „Gutschein trägt wirklich etwas" UND „kein Netz" wird
 * abgewiesen. Ein Gutschein über 0,00 EUR ist kein Zahlungsmittel, und ohne
 * Gutschein ist der Offline-Verkauf ausdrücklich erwünscht: er ist der
 * ganze Sinn des Ausgangskorbs.
 */
export function pruefeGutscheinBrauchtNetz(lage: GutscheinLage): GutscheinUrteil {
  const traegtEtwas = lage.gutscheinAngewandt && lage.gutscheinCents > 0n;
  if (!traegtEtwas || lage.amNetz) {
    return { erlaubt: true, satz: '' };
  }
  return {
    erlaubt: false,
    satz:
      'Ohne Netz lässt sich ein Gutschein nicht einlösen: das Guthaben wird erst beim ' +
      'Server abgebucht, und der Beleg würde ohne diese Abbuchung stehen bleiben. ' +
      'Bitte den Gutschein entfernen und bar oder mit Karte kassieren, oder warten, ' +
      'bis die Verbindung wieder steht.',
  };
}

/** Ist die Kasse am Netz? Eine Stelle, damit die Antwort nicht driftet. */
export function amNetz(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
