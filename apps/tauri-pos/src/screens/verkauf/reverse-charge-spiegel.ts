/**
 * reverse-charge-spiegel — die Regel des Servers, wortgleich auf der Fläche.
 *
 * ── WARUM ES DIESE DATEI GIBT (30.07.2026) ──────────────────────────────────
 *
 * Der Bezahlen-Dialog entschied bis heute selbst, wann § 13b gilt, und er
 * entschied es ANDERS als der Server:
 *
 *     isB2b && (viesStatus === 'valid' || 'unavailable' || 'timeout')
 *
 * „Die EU war nicht erreichbar" galt der Fläche also als bestätigte
 * USt-IdNr. Der Server sieht das genau umgekehrt (`darfReverseCharge` in
 * `apps/api-cloud/src/lib/reverse-charge.ts`): bei `NICHT_ERREICHBAR` gibt er
 * `erlaubt: false` zurück, weil eine Nummer, die niemand prüfen konnte, keine
 * geprüfte Nummer ist.
 *
 * ── WAS DAS IM LADEN ANRICHTETE ─────────────────────────────────────────────
 *
 * Der Kassierer hakt § 13b an, tippt die Nummer, drückt „Prüfen". Die EU
 * antwortet nicht. Die Fläche sagt ehrlich „VIES-Dienst nicht erreichbar" —
 * und schaltet im selben Moment die Umsatzsteuer ab. Die Summe fällt sichtbar
 * um 19 %, und der Kassierer nennt dem Kunden DIESEN Betrag.
 *
 * Dann drückt er auf Bezahlen, und der Server weist den ganzen Vorgang zurück.
 * Der Kunde hat einen Preis gehört, den das Haus nicht halten kann, und der
 * Kassierer steht davor.
 *
 * ── DIE ENTSCHEIDUNG ────────────────────────────────────────────────────────
 *
 * NUR `valid` schaltet § 13b. Alles andere lässt den Regelsatz stehen.
 *
 * Das ist die unbequemere Richtung, und sie ist die richtige: eine Kasse, die
 * bei ausgefallener Prüfung die Steuer abschaltet, rechnet im Zweifel zu
 * Lasten des Finanzamts. Bleibt der Regelsatz stehen, zahlt im schlimmsten
 * Fall ein berechtigter Geschäftskunde heute 19 % und holt sie sich zurück,
 * sobald die Prüfung durchgeht. Der Fehler geht damit in die Richtung, die
 * heilbar ist.
 *
 * Diese Datei ist bewusst winzig und rein, damit die Regel prüfbar ist und an
 * BEIDEN Stellen im Dialog dieselbe ist: die Anzeige der Summe und die Frage,
 * ob abgeschickt werden darf, dürfen niemals auseinanderlaufen.
 */

/** Die Zustände, die die VIES-Abfrage auf der Fläche annehmen kann. */
export type ViesStand = 'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable' | 'timeout';

/**
 * Gilt § 13b für diesen Vorgang?
 *
 * Spiegelt `darfReverseCharge` auf dem Server. Ändert sich die Regel dort,
 * gehört sie HIER nachgezogen, nicht ein zweites Mal erfunden.
 */
export function reverseChargeGiltJetzt(istB2b: boolean, stand: ViesStand): boolean {
  return istB2b && stand === 'valid';
}

/**
 * Warum § 13b gerade NICHT gilt, in einem Satz für den Kassierer.
 *
 * `null` heisst: es gilt, oder der Kassierer hat § 13b gar nicht angehakt.
 * Der Satz sagt jeweils, was der Kassierer TUN kann — „nicht erreichbar" ohne
 * nächsten Schritt lässt ihn ratlos vor dem Kunden stehen.
 */
export function warumKeinReverseCharge(istB2b: boolean, stand: ViesStand): string | null {
  if (!istB2b || stand === 'valid') return null;
  switch (stand) {
    case 'idle':
      return 'Die USt-IdNr. ist noch nicht geprüft. Bitte auf „Prüfen" tippen.';
    case 'checking':
      return 'Die USt-IdNr. wird gerade bei der EU geprüft.';
    case 'invalid':
      return 'Die EU kennt diese USt-IdNr. nicht. Der Verkauf läuft mit dem Regelsatz.';
    case 'unavailable':
    case 'timeout':
      return (
        'Die EU-Abfrage war nicht erreichbar, die USt-IdNr. gilt damit als ungeprüft. ' +
        'Der Verkauf läuft mit dem Regelsatz. Sobald die Prüfung durchgeht, ist ' +
        'eine Rechnungskorrektur möglich.'
      );
    default:
      return 'Die USt-IdNr. ist nicht geprüft. Der Verkauf läuft mit dem Regelsatz.';
  }
}
