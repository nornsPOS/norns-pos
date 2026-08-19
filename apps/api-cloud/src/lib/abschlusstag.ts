/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER ABSCHLUSSTAG DARF NICHT IN DER ZUKUNFT LIEGEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────────────
 *
 * `POST /api/closings/finalize` nahm den `businessDay` aus dem Rumpf und
 * benutzte ihn ungeprüft. Der Verkauf hat den Riegel gegen die Zukunft seit
 * langem (`erfassungszeit.ts`), der Abschluss hatte keinen.
 *
 * Ein Zahlendreher genügte: wer am 08.08. statt `2026-08-08` versehentlich
 * `2026-08-09` schreibt, versiegelt MORGEN. Danach weist der Auslöser
 * `transactions_validate_closing_day` jeden Beleg dieses Tages ab, und es gibt
 * keinen Weg zurück — ein festgeschriebener Abschluss ist unantastbar, das ist
 * der Sinn von § 146 Abs. 4 AO. Der Laden stünde still, bis jemand von Hand in
 * die Datenbank greift, und genau das liest ein Prüfer als Manipulation.
 *
 * ── ⚠️ WARUM HIER BERLINER ZEIT GERECHNET WIRD, NICHT UTC ─────────────────
 *
 * Die Datenbank bestimmt den Geschäftstag mit
 * `berlin_business_day(ts) = (ts AT TIME ZONE 'Europe/Berlin')::date`.
 *
 * Wer hier naiv gegen UTC prüft, weist abends zwischen 22:00 und 24:00 UTC den
 * RICHTIGEN Tag ab — im Sommer zwei Stunden lang, im Winter eine. Das ist
 * genau die Zeit, in der ein Laden abschliesst. Ein Riegel, der den Feierabend
 * blockiert, wird abgeschaltet, und ein abgeschalteter Riegel schützt nichts.
 *
 * Deshalb wird der heutige Tag mit derselben Zeitzone bestimmt wie in der
 * Datenbank, über `Intl.DateTimeFormat` mit `Europe/Berlin`. Die Sommerzeit
 * kommt damit aus den Zeitzonendaten und nicht aus einer Faustregel.
 *
 * ── WAS ERLAUBT BLEIBT ───────────────────────────────────────────────────
 *
 * HEUTE, weil das der Feierabend ist. Und jeder VERGANGENE Tag, weil ein
 * vergessener Abschluss nachgeholt werden muss — § 146 Abs. 1 Satz 2 AO
 * verlangt es sogar.
 */

export interface AbschlusstagBefund {
  /** Ein Satz für den Menschen an der Kasse. */
  nachricht: string;
  /** Der abgewiesene Wert, für das Protokoll. */
  tag: string;
  /** Der Tag, den der Server für heute hält. */
  heute: string;
}

/** Der Berliner Geschäftstag zu einem Zeitpunkt, als `JJJJ-MM-TT`. */
export function berlinerGeschaeftstag(zeitpunkt: Date): string {
  // `en-CA` liefert genau `JJJJ-MM-TT`. Die Zeitzonendaten der Laufzeit
  // tragen die Sommerzeit, also stimmt es auch am Umstellungswochenende.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(zeitpunkt);
}

/**
 * Ist `JJJJ-MM-TT` ein Datum, das es wirklich gibt?
 *
 * `new Date('2026-02-30')` ist in JavaScript nicht `Invalid`, sondern der
 * 2. März. Ohne diesen Rückvergleich ginge ein unmöglicher Tag durch und
 * Postgres quittierte ihn später mit einem Fehler, den niemand versteht.
 */
function istEchtesDatum(tag: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tag)) return false;
  const d = new Date(`${tag}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === tag;
}

/**
 * Darf dieser Tag festgeschrieben werden?
 *
 * `null` heisst: in Ordnung. Rein, ohne Netz und ohne Datenbank; die Uhr
 * kommt als Argument herein, damit der Test sie festhalten kann.
 *
 * Fehlt der Tag (`null`/`undefined`), entscheidet der Server selbst — dann
 * gibt es nichts zu prüfen.
 */
export function pruefeAbschlusstag(
  gewuenschterTag: string | null | undefined,
  jetzt: Date,
): AbschlusstagBefund | null {
  if (gewuenschterTag == null) return null;

  const heute = berlinerGeschaeftstag(jetzt);

  if (!istEchtesDatum(gewuenschterTag)) {
    return {
      nachricht:
        `„${gewuenschterTag}" ist kein gültiges Datum. Erwartet wird ein Tag ` +
        `in der Form JJJJ-MM-TT, zum Beispiel ${heute}.`,
      tag: gewuenschterTag,
      heute,
    };
  }

  // Zeichenweiser Vergleich reicht und ist exakt: `JJJJ-MM-TT` sortiert
  // lexikographisch wie chronologisch, ohne Zeitzonen- oder Sommerzeitfalle.
  if (gewuenschterTag > heute) {
    return {
      nachricht:
        `Der ${gewuenschterTag} liegt in der Zukunft. Ein Tagesabschluss ` +
        `schreibt den Tag unwiderruflich fest, und danach nimmt die Kasse an ` +
        `diesem Tag keinen Verkauf mehr an. Heute ist der ${heute}.`,
      tag: gewuenschterTag,
      heute,
    };
  }

  return null;
}
