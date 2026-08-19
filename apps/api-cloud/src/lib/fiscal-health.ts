/**
 * Die Fiskal-Ampel. Eine Funktion, ein Urteil, und ein Grundsatz:
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  UNKLAR IST NICHT GRÜN. NICHTS DA IST DAS SCHLIMMSTE, NICHT DAS BESTE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Diese Datei entstand aus einem Fehler, der in der Produktion stand. Die Ampel
 * rechnete:
 *
 *     tseDays === null ? 'ok' : tseDays < 7 ? 'alert' : …
 *
 * `tseDays` ist die Restlaufzeit des Zertifikats und genau dann NULL, wenn es
 * überhaupt KEINEN TSE-Client gibt. Der schlimmste denkbare Fiskalzustand, gar
 * keine technische Sicherheitseinrichtung, wurde damit als "in Ordnung"
 * gemeldet, während eine bloss ablaufende TSE Alarm auslöste. Gemessen an der
 * Produktion am 25.07.2026: 0 Clients, 13 unsignierte Belege in sieben Tagen,
 * Ampel grün.
 *
 * Der Händler schaut in genau dieses eine Fenster, um zu wissen, ob er ruhig
 * schlafen kann. Es darf ihn nie beruhigen, wenn es dafür keinen Grund gibt.
 *
 * ── Warum ein eingerichteter Client allein nichts beweist ──────────────────
 *
 * Ein Client in der Tabelle heisst nur, dass jemand einmal etwas eingetragen
 * hat. Erst ein SIGNIERTER Beleg beweist, dass die Kette von der Kasse bis zur
 * Sicherungseinrichtung wirklich trägt. Darum zählt diese Ampel zusätzlich die
 * unsignierten Belege der letzten Tage: eine eingerichtete, aber stumme TSE ist
 * fiskalisch dasselbe wie gar keine, nur schwerer zu bemerken.
 */

export type ComponentStatus = 'ok' | 'watch' | 'alert';

export interface FiscalSignals {
  /** Wie viele TSE-Clients eingerichtet sind. Null heisst: keine Sicherungseinrichtung. */
  clients: number;
  /** Restlaufzeit des am frühesten ablaufenden Zertifikats in Tagen. NULL heisst unbekannt. */
  certDays: number | null;
  /** Belege der letzten Tage ohne Signatur. Jeder einzelne ist ein Mangel. */
  unsignedRecent: number;
  /**
   * ⚠️ Wird die Restlaufzeit des Zertifikats auf DIESER Kasse überhaupt
   * überwacht?
   *
   * Bis zum 08.08.2026 gab es dieses Signal nicht, und `certDays === null`
   * hiess deshalb Alarm mit dem Satz „Die Laufzeit des TSE-Zertifikats ist
   * unbekannt". Diese Annahme trug nur, solange `clients` aus `tse_clients`
   * kam: dort bringt jede Zeile ein Ablaufdatum mit, also war eine Zeile ohne
   * Datum wirklich ein Widerspruch.
   *
   * Seit die Einrichtung an `system_settings` hängt (der einzige Ort, den die
   * Kasse selbst füllt), ist „eingerichtet, aber kein Wachbuch" der NORMALE
   * Zustand von Norns POS — das Wachbuch `tse_clients` beschreibt allein der
   * Arbeiter, und der reist nicht mit. Alarm wäre hier also die zweite
   * Dauerlampe an derselben Ampel.
   */
  zertifikatUeberwacht: boolean;
}

export interface FiscalVerdict {
  status: ComponentStatus;
  /** Ein Satz auf Deutsch, den die Oberfläche unverändert anzeigen kann. */
  reason: string;
}

/**
 * Beurteilt den Fiskalzustand. Reine Funktion, damit sie prüfbar ist: die
 * vorherige Fassung lag mitten in einer Route und konnte deshalb von keinem
 * Test erreicht werden, was der Grund war, dass der Fehler so lange stand.
 */
export function judgeFiscalHealth(signals: FiscalSignals): FiscalVerdict {
  const { clients, certDays, unsignedRecent, zertifikatUeberwacht } = signals;

  if (clients <= 0) {
    return {
      status: 'alert',
      reason:
        'Es ist keine technische Sicherheitseinrichtung eingerichtet. Belege werden nicht signiert, ' +
        'und die Kasse erfüllt § 146a AO nicht.',
    };
  }
  if (unsignedRecent > 0) {
    return {
      status: 'alert',
      reason:
        `${unsignedRecent} Beleg${unsignedRecent === 1 ? '' : 'e'} der letzten Tage ` +
        'wurde nicht signiert. Die Sicherungseinrichtung ist eingerichtet, aber sie trägt nicht.',
    };
  }
  if (!zertifikatUeberwacht) {
    /**
     * ⚠️ Weder Alarm noch grün.
     *
     * NICHT Alarm: die TSE ist eingerichtet, und kein Beleg der letzten Tage
     * blieb unsigniert — die Kette trägt also nachweislich. Ein Dauer-Alarm
     * hier wäre die zweite Lampe, die nie ausgeht, und nach der zweiten Woche
     * schaut niemand mehr hin.
     *
     * NICHT grün: die Restlaufzeit wird auf dieser Kasse wirklich nicht
     * überwacht. Das zu verschweigen wäre genau der Fehler, den diese Datei
     * an anderer Stelle beheben soll.
     *
     * Der Satz sagt darum schlicht, was ist.
     */
    return {
      status: 'watch',
      reason:
        'Die Restlaufzeit des TSE-Zertifikats wird auf dieser Kasse nicht überwacht. Belege ' +
        'werden signiert; ein Ablauf des Zertifikats würde hier aber nicht vorab gemeldet.',
    };
  }
  if (certDays === null) {
    // Ein überwachtes Zertifikat OHNE Gültigkeitsdatum ist ein Widerspruch.
    // Solange er ungeklärt ist, gilt die Sicherung als nicht nachgewiesen.
    return {
      status: 'alert',
      reason:
        'Die Laufzeit des TSE-Zertifikats ist unbekannt. Solange das ungeklärt ist, gilt die ' +
        'Sicherung als nicht nachgewiesen.',
    };
  }
  if (certDays < 0) {
    return {
      status: 'alert',
      reason: 'Das TSE-Zertifikat ist abgelaufen. Ab sofort entstehen unsignierte Belege.',
    };
  }
  if (certDays < 7) {
    return {
      status: 'alert',
      reason: `Das TSE-Zertifikat läuft in ${certDays} Tagen ab. Der Austausch duldet keinen Aufschub.`,
    };
  }
  if (certDays <= 30) {
    return {
      status: 'watch',
      reason: `Das TSE-Zertifikat läuft in ${certDays} Tagen ab. Den Austausch jetzt anstossen.`,
    };
  }
  return {
    status: 'ok',
    reason: `Belege werden signiert, das Zertifikat läuft noch ${certDays} Tage.`,
  };
}
