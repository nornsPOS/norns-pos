/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE ERFASSUNGSZEIT DES GERÄTS — an EINER Stelle geprüft
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Nach § 146a AO und der DSFinV-K ist die KASSE die Quelle für Vorgangsbeginn
 * und Vorgangsende, nicht der Server. Ein am nächsten Morgen aus dem
 * Offline-Speicher nachgespielter Beleg muss im Z-Bon von GESTERN landen, und
 * das geht nur, wenn er seine eigene Zeit mitbringt.
 *
 * Ein vom Klienten gelieferter Zeitstempel ist zugleich ein Angriffsweg.
 * Deshalb drei Grenzen, und alle drei gelten für JEDEN Vorgang gleich.
 *
 * ── Warum diese Datei am 28.07.2026 entstand ─────────────────────────────
 *
 * Die Prüfung stand wörtlich in `transactions-finalize.ts` und nirgends
 * sonst. Der STORNO kannte sie deshalb nicht: sein `finalized_at` kam aus
 * `DEFAULT now()`, also aus der Uhr des Servers, während der Verkauf seine
 * Zeit vom Gerät bekam. Zwei Zeitquellen für die zwei Hälften desselben
 * Vorgangs.
 *
 * Im Alltag fällt das nicht auf, weil beide Uhren dieselbe sind. Es fällt
 * genau dort auf, wofür es die Gerätezeit überhaupt gibt:
 *
 *   • Ein NACHGESPIELTER Verkauf trägt das Datum von gestern. Sein Storno
 *     bekäme das von heute — der Erlös stünde in einem Tagesabschluss, seine
 *     Aufhebung in einem anderen.
 *   • Ein Verkauf um 23:58 und sein Storno um 00:02 fielen auseinander. Und
 *     da der zweite Tag den ersten nicht mehr aufheben kann
 *     (`transactions_validate_closing_day`), bliebe der Erlös stehen.
 *
 * Die Prüfung wurde deshalb hierher gezogen, statt sie in den Storno zu
 * KOPIEREN. Zwei Kopien einer Fiskalregel laufen auseinander, sobald eine
 * geändert wird, und dann gilt für Verkauf und Storno verschiedenes Recht.
 */

/**
 * Wie weit die Kassenuhr vorgehen darf.
 *
 * Zwei Minuten, weil eine Kasse ohne Zeitabgleich um Sekunden abweicht und
 * ein Verkauf daran nicht scheitern soll. Mehr wäre eine Einladung.
 */
export const ZUKUNFT_TOLERANZ_MS = 2 * 60 * 1000;

/**
 * Wie alt ein nachgespielter Vorgang sein darf.
 *
 * Sieben Tage decken den Offline-Speicher und ein langes Wochenende. Was
 * älter ist, ist kein Nachtrag mehr, sondern ein Eingriff in eine
 * fortschreibungsgeschützte Aufzeichnung — und gehört von einem Menschen
 * angesehen, statt still angenommen zu werden.
 */
export const HOECHSTALTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface ZeitBefund {
  /** Die geprüfte Zeit, oder `null` wenn keine mitgeschickt wurde. */
  erfasstAm: Date | null;
  /** Gesetzt, wenn die Zeit ABGELEHNT wird. Dann ist `erfasstAm` bedeutungslos. */
  fehler?: {
    nachricht: string;
    einzelheiten: Record<string, unknown>;
  };
}

/**
 * Die Erfassungszeit prüfen. Rein: keine Ausnahmen, keine Datenbank.
 *
 * Der Aufrufer entscheidet, welche Fehlerklasse er wirft — `finalize` und
 * `storno` haben verschiedene. Die REGEL ist für beide dieselbe, und genau
 * darum geht es hier.
 */
export function pruefeErfassungszeit(roh: string | null | undefined, jetzt: Date): ZeitBefund {
  if (roh == null) return { erfasstAm: null };

  const kandidat = new Date(roh);
  if (Number.isNaN(kandidat.getTime())) {
    return {
      erfasstAm: null,
      fehler: {
        nachricht: 'Die Erfassungszeit ist keine gültige Zeitangabe.',
        einzelheiten: { field: 'erfasstAm', message: 'not a parseable ISO 8601 timestamp' },
      },
    };
  }

  if (kandidat.getTime() > jetzt.getTime() + ZUKUNFT_TOLERANZ_MS) {
    return {
      erfasstAm: null,
      fehler: {
        nachricht: 'Die Erfassungszeit liegt in der Zukunft. Bitte die Uhr der Kasse prüfen.',
        einzelheiten: {
          field: 'erfasstAm',
          message: 'capture time is in the future beyond the clock-skew tolerance',
          erfasstAm: kandidat.toISOString(),
          serverzeit: jetzt.toISOString(),
          toleranzMs: ZUKUNFT_TOLERANZ_MS,
        },
      },
    };
  }

  if (jetzt.getTime() - kandidat.getTime() > HOECHSTALTER_MS) {
    return {
      erfasstAm: null,
      fehler: {
        nachricht:
          'Die Erfassungszeit ist älter als sieben Tage. Ein so alter Vorgang muss vom Inhaber angesehen werden, bevor er in die Aufzeichnung geht.',
        einzelheiten: {
          field: 'erfasstAm',
          message: 'capture time older than the replay window',
          erfasstAm: kandidat.toISOString(),
          serverzeit: jetzt.toISOString(),
          hoechstalterMs: HOECHSTALTER_MS,
        },
      },
    };
  }

  return { erfasstAm: kandidat };
}
