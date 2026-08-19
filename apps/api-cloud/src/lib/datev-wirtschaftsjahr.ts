/**
 * ════════════════════════════════════════════════════════════════════════
 *  Das Wirtschaftsjahr wird GERECHNET, nicht gespeichert
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 05.08.2026 ───────────────────────────────────────────
 *
 * DATEV wörtlich (`docs/fiskal/recherche/datev-format.md`, Zeile 203):
 * „Das Jahr wird immer aus dem Feld #13 des Headers ermittelt."
 *
 * Das Belegdatum einer Buchungszeile ist vierstellig, `TTMM`. Welches JAHR
 * gemeint ist, entscheidet allein Kopf-Feld 13, der Wirtschaftsjahresbeginn.
 * Der kam aus einer festen Einstellung und wurde nie gegen den Buchungstag
 * gehalten.
 *
 * Gemessen: Einstellung 2026-01-01, Ausfuhr eines Abschlusses vom 15.03.2027.
 * DATEV las daraus den 15.03.2026 — ein Jahr, das beim Berater längst
 * festgeschrieben ist. Der eigene Prüfer meldete null Befunde. Ab dem
 * 1. Januar des zweiten Betriebsjahres wäre JEDE Ausfuhr um ein Jahr
 * verschoben gewesen, ohne dass jemand etwas anfasst.
 *
 * ── WARUM RECHNEN HIER SICHER IST ───────────────────────────────────────
 *
 * Es gibt genau EINEN Stapelerzeuger — die Route je Abschluss — und ein
 * Stapel trägt genau EINEN Geschäftstag. Eine Datei kann also nie eine
 * Wirtschaftsjahresgrenze überspannen. Der Händler stellt damit nur noch
 * MONAT und TAG seines Wirtschaftsjahresbeginns ein; das Jahr folgt dem
 * Buchungstag.
 *
 * ── WAS AUSDRÜCKLICH NICHT PASSIERT ─────────────────────────────────────
 *
 * Ein Beginn am 29. Februar wird in einem Nicht-Schaltjahr ABGEWIESEN statt
 * still auf den 28. gerückt. Eine erfundene Angabe im Kopf einer Steuerdatei
 * ist schlimmer als eine verweigerte Ausfuhr, die den Menschen zur
 * Einstellung schickt.
 */

/** Wie viele Tage der Monat im gegebenen Jahr hat. */
function tageImMonat(jahr: number, monat: number): number {
  return new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
}

function zweiStellen(n: number): string {
  return String(n).padStart(2, '0');
}

export interface WirtschaftsjahrOptionen {
  /**
   * Nimmt auch die ALTE Schreibweise `JJJJ-MM-TT` an und verwirft deren Jahr.
   *
   * Auf jedem bestehenden Gerät steht in `datev.wirtschaftsjahr_beginn` heute
   * ein volles Datum. Die Umstellung darf keine Ausfuhr blockieren — aber der
   * Aufrufer muss sie ausdrücklich zulassen, damit ein volles Datum nicht
   * versehentlich als neue Schreibweise durchgeht.
   */
  altesDatumErlauben?: boolean;
}

/**
 * Der Beginn des Wirtschaftsjahres, in dem `buchungstag` liegt.
 *
 * @param beginnMonatTag `MM-TT` (Regelfall `01-01`, abweichend etwa `07-01`).
 *   Mit `altesDatumErlauben` auch `JJJJ-MM-TT`; das Jahr wird dann verworfen.
 * @param buchungstag `JJJJ-MM-TT`, der Geschäftstag des Abschlusses.
 * @returns `JJJJ-MM-TT` für Kopf-Feld 13.
 */
export function wirtschaftsjahrFuer(
  beginnMonatTag: string,
  buchungstag: string,
  optionen: WirtschaftsjahrOptionen = {},
): string {
  const roh = (beginnMonatTag ?? '').trim();

  let monat: number;
  let tag: number;

  const kurz = /^(\d{2})-(\d{2})$/.exec(roh);
  const lang = /^\d{4}-(\d{2})-(\d{2})$/.exec(roh);

  if (kurz) {
    monat = Number(kurz[1]);
    tag = Number(kurz[2]);
  } else if (lang && optionen.altesDatumErlauben === true) {
    monat = Number(lang[1]);
    tag = Number(lang[2]);
  } else {
    throw new Error(
      `Der Beginn des Wirtschaftsjahres muss als MM-TT eingetragen sein (Regelfall 01-01); eingetragen ist „${roh}".`,
    );
  }

  if (monat < 1 || monat > 12 || tag < 1 || tag > 31) {
    throw new Error(
      `Der Beginn des Wirtschaftsjahres „${roh}" ist kein gültiger Monat mit Tag.`,
    );
  }

  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec((buchungstag ?? '').trim());
  if (!t) {
    throw new Error(`Der Buchungstag muss als JJJJ-MM-TT vorliegen; übergeben wurde „${buchungstag}".`);
  }
  const bJahr = Number(t[1]);
  const bMonat = Number(t[2]);
  const bTag = Number(t[3]);

  // Liegt der Buchungstag VOR dem Beginn im selben Kalenderjahr, gehört er
  // noch zum Wirtschaftsjahr, das im VORJAHR begonnen hat.
  const vorDemBeginn = bMonat < monat || (bMonat === monat && bTag < tag);
  const jahr = vorDemBeginn ? bJahr - 1 : bJahr;

  // ⚠️ Der 29. Februar. In drei von vier Jahren gibt es ihn nicht, und ein
  // still auf den 28. gerückter Beginn wäre eine erfundene Angabe im Kopf
  // einer Steuerdatei.
  if (tag > tageImMonat(jahr, monat)) {
    if (monat === 2 && tag === 29) {
      throw new Error(
        `Das Wirtschaftsjahr kann nicht am 29. Februar beginnen: ${jahr} ist kein Schaltjahr. ` +
          'Bitte den Beginn in den Einstellungen berichtigen.',
      );
    }
    throw new Error(
      `Den ${tag}. im Monat ${monat} gibt es nicht. Bitte den Beginn des Wirtschaftsjahres berichtigen.`,
    );
  }

  return `${jahr}-${zweiStellen(monat)}-${zweiStellen(tag)}`;
}
