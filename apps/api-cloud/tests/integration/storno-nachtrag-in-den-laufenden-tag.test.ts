/**
 * ════════════════════════════════════════════════════════════════════════════
 *  BEFUND 12: der VERKAUF kennt den Nachtrag, der STORNO kannte ihn nicht
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── WAS WAR DER BEFUND (11.08.2026, nachgemessen) ──────────────────────────
 *
 * `transactions-finalize.ts` misst VOR der Tagessperre, ob der Geschaeftstag
 * der Erfassungszeit bereits FINALIZED ist. Wenn ja, wird der Vorgang als
 * Nachtrag im LAUFENDEN Tag gebucht: `finalized_at` faellt auf jetzt,
 * `nachtrag_bezugstag` traegt den alten Tag, und der Datenbank-Ausloeser
 * `transactions_validate_closing_day` bleibt zufrieden.
 *
 * `transactions-storno.ts` hatte diesen ganzen Zweig nicht. Er nahm die
 * Tagessperre auf die rohe Erfassungszeit und schrieb `finalized_at` stur auf
 * genau diese Zeit. Lag der Tag des Urbelegs schon versiegelt, wies der
 * Ausloeser den Storno mit `CLOSING_DAY_FINALIZED` ab. Ein Vorgang, der im
 * Laden WIRKLICH rueckgaengig gemacht wurde, konnte nicht aufgezeichnet
 * werden. Der Haendler behilft sich dann ausserhalb des Systems, und genau
 * danach sucht ein Pruefer: BFH, 29.07.2025, X R 23-24/21, nicht ausgewiesene
 * Stornierungen begruenden die Schaetzung.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH WAERE ────────────────────────────────
 *
 * Naheliegend waere, den Storno einfach in den versiegelten Tag zu schreiben
 * oder den Ausloeser fuer Stornos zu lockern. Beides verletzt § 146 Abs. 4 AO:
 * ein festgeschriebener Z-Bon ist fest. Richtig ist der Weg des Rechnungswesens
 * fuer den nachtraeglichen Geschaeftsvorfall: der geschlossene Zeitraum bleibt
 * unberuehrt, gebucht wird im laufenden, mit ausdruecklichem Verweis auf den
 * Urtag. Genauso falsch waere es, die Regel vom 28.07. zu opfern, nach der der
 * Storno die Geraetezeit des Vorgangs teilt; bei OFFENEM Tag muss er weiterhin
 * auf dem Tag des Verkaufs landen.
 *
 * ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
 *
 *   a) Tag des Urbelegs FINALIZED, Storno ueber HTTP: wird ANGENOMMEN,
 *      faellt in den LAUFENDEN Tag, traegt `nachtrag_bezugstag` des Urtags,
 *      die Verweiskette `storno_of_transaction_id` steht, der versiegelte Tag
 *      bekommt KEINE neue Zeile, der Inhaber wird gemeldet.
 *   b) Die Signatur des Stornos ist ein EIGENER Vorgang; am Urbeleg und an
 *      seiner Signatur aendert sich kein Byte.
 *   c) Bei OFFENEM Tag teilt der Storno weiter den Geschaeftstag des
 *      Verkaufs (Regel vom 28.07., darf nicht brechen).
 *   d) Eine aeltere Kasse ohne `erfasstAm` storniert weiter; dann gilt die
 *      Serverzeit.
 *
 * Alles laeuft gegen ein ECHTES Postgres im Behaelter und ueber die ECHTEN
 * HTTP-Wege. NUR FUER TESTS.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne, berlinerZeitpunkt } from '../helfer/fiskal-buehne.js';

describe('Befund 12: der Storno eines versiegelten Tages wird als Nachtrag gebucht', () => {
  const buehne = baueFiskalBuehne();

  /** Monoton wie eine echte TSE; wird nie zurueckgesetzt. */
  let signaturZaehler = 1;

  beforeAll(async () => {
    await buehne.starten();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
  });

  // ── Helfer ───────────────────────────────────────────────────────────────

  /** Heutiger und gestriger Berliner Geschaeftstag, aus der Datenbankuhr. */
  async function tage(): Promise<{ heute: string; gestern: string }> {
    const [zeile] = await buehne.migratorSql<{ heute: string; gestern: string }[]>`
      SELECT berlin_business_day(now())::text AS heute,
             (berlin_business_day(now()) - 1)::text AS gestern`;
    return zeile!;
  }

  interface Urbeleg {
    belegId: string;
    heute: string;
    gestern: string;
    /** Die Geraetezeit des Vorgangs: gestern 17:50 Berliner Zeit, als ISO. */
    erfasstAm: string;
  }

  /**
   * Ein Barverkauf von GESTERN 17:50, mit Signatur. Gestern und nicht ein
   * fester Maitag, weil die Erfassungszeit des Stornos hoechstens sieben Tage
   * alt sein darf und gegen die echte Serveruhr geprueft wird.
   */
  async function verkaufVonGestern(): Promise<Urbeleg> {
    const { heute, gestern } = await tage();
    const zeitpunkt = berlinerZeitpunkt(gestern, 17, 50);
    const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    const beleg = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '100.00',
      vat: '19.00',
      total: '119.00',
      customerId: null,
      finalizedAt: zeitpunkt,
      items: [
        {
          productId: produkt,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 1,
        },
      ],
      payment: { method: 'CASH', amount: '119.00' },
      tse: true,
    });
    return { belegId: beleg.id, heute, gestern, erfasstAm: new Date(zeitpunkt).toISOString() };
  }

  /** Den gestrigen Tag echt FINALIZED festschreiben (ein Beleg, 119,00 bar). */
  async function gesternVersiegeln(gestern: string): Promise<void> {
    await buehne.legeAbschlussAn({
      geschaeftstag: gestern,
      verkaufAnzahl: 1,
      bruttoVerkauf: '119.00',
      nettoVerkauf: '100.00',
    });
  }

  /** Der ganze Beleg samt Signaturen als JSON, fuer den Unveraendert-Nachweis. */
  async function schnappschuss(id: string): Promise<unknown> {
    const [zeile] = await buehne.migratorSql<{ beleg: unknown; signaturen: unknown }[]>`
      SELECT to_jsonb(t) AS beleg,
             (SELECT jsonb_agg(to_jsonb(s))
                FROM tse_signatures s WHERE s.transaction_id = t.id) AS signaturen
        FROM transactions t WHERE t.id = ${id}::uuid`;
    return zeile!;
  }

  /** Die fiskalisch tragenden Spalten der Stornozeile. */
  async function stornoZeile(id: string): Promise<{
    buchungstag: string;
    erfassungszeit: Date | null;
    nachtrag_bezugstag: string | null;
    storno_of: string | null;
    total: string;
  }> {
    const [zeile] = await buehne.migratorSql<
      {
        buchungstag: string;
        erfassungszeit: Date | null;
        nachtrag_bezugstag: string | null;
        storno_of: string | null;
        total: string;
      }[]
    >`
      SELECT berlin_business_day(finalized_at)::text AS buchungstag,
             erfasst_am                              AS erfassungszeit,
             nachtrag_bezugstag::text                AS nachtrag_bezugstag,
             storno_of_transaction_id::text          AS storno_of,
             total_eur::text                         AS total
        FROM transactions WHERE id = ${id}::uuid`;
    return zeile!;
  }

  async function storniere(belegId: string, erfasstAm?: string) {
    // ⚠️ 11.08.2026: eine Barrueckgabe verlangt eine offene Schicht.
    // Siehe `mitOffenerSchicht` in der Buehne.
    return await buehne.mitOffenerSchichtFuerStorno(belegId, () =>
      buehne.sende('/api/transactions/storno', {
        originalTransactionId: belegId,
        reason: 'Kundin hat den Kauf widerrufen, Ware liegt wieder im Laden',
        ...(erfasstAm ? { erfasstAm } : {}),
      }),
    );
  }

  async function signiereUeberHttp(belegId: string): Promise<void> {
    const res = await buehne.sende(`/api/transactions/${belegId}/tse-signature`, {
      fiskalyTssId: '11111111-2222-3333-4444-555555555555',
      fiskalyClientId: '66666666-7777-8888-9999-000000000000',
      fiskalyTransactionNumber: String(signaturZaehler),
      signatureValue: `sig-${signaturZaehler}`,
      signatureCounter: String(signaturZaehler),
      signatureAlgorithm: 'ecdsa-plain-SHA256',
      processType: 'Kassenbeleg-V1',
    });
    signaturZaehler += 1;
    expect(res.statusCode, res.body).toBe(200);
  }

  // ── a) Der Kern des Befunds ──────────────────────────────────────────────

  it('a) Tag des Urbelegs FINALIZED: der Storno wird angenommen und als Nachtrag im LAUFENDEN Tag gebucht', async () => {
    const { belegId, heute, gestern, erfasstAm } = await verkaufVonGestern();
    await gesternVersiegeln(gestern);

    const vorher = await schnappschuss(belegId);

    const res = await storniere(belegId, erfasstAm);
    // Heute bricht genau hier `CLOSING_DAY_FINALIZED` durch; der Laden kann den
    // wirklich geschehenen Storno nicht aufzeichnen.
    expect(res.statusCode, res.body).toBe(200);

    const antwort = res.json() as {
      id: string;
      stornoOfTransactionId: string;
      totalEur: string;
      nachtragBezugstag: string | null;
    };
    expect(antwort.stornoOfTransactionId).toBe(belegId);
    expect(antwort.totalEur).toBe('-119.00');

    /*
     * ⚠️ DIE ANTWORT MUSS DEN NACHTRAG NACH DRAUSSEN TRAGEN.
     *
     * Bis zum 11.08.2026 stand er nur in der Datenbank: das Antwortschema
     * kannte das Feld nicht, und Fastify streift jedes nicht deklarierte
     * Feld ab. Der Beleg war vollstaendig aufgezeichnet, aber der Kassierer
     * sah einen gewoehnlichen Storno und wusste NICHT, dass er im heutigen
     * Abschluss landet statt im gestrigen.
     *
     * Dieser Satz misst die HTTP-Antwort, nicht die Zeile: nur er faellt um,
     * wenn jemand das Schemafeld wieder entfernt.
     */
    expect(
      antwort.nachtragBezugstag,
      'die Antwort verschweigt den Nachtrag; das Schemafeld fehlt und Fastify streift es ab',
    ).toBe(gestern);

    const zeile = await stornoZeile(antwort.id);
    // Gebucht im LAUFENDEN Tag, nicht im versiegelten.
    expect(zeile.buchungstag).toBe(heute);
    // Der Verweis auf den Urtag ist ausgewiesen, nicht still.
    expect(zeile.nachtrag_bezugstag).toBe(gestern);
    // Die Geraetezeit des Vorgangs bleibt feststellbar (§ 146 Abs. 4 AO).
    expect(zeile.erfassungszeit).not.toBeNull();
    expect(new Date(zeile.erfassungszeit as Date).toISOString()).toBe(erfasstAm);
    // Die Verweiskette steht.
    expect(zeile.storno_of).toBe(belegId);
    expect(zeile.total).toBe('-119.00');

    // Der versiegelte Tag hat KEINE neue Zeile bekommen: dort liegt weiter
    // genau der eine Urbeleg.
    const [zaehler] = await buehne.migratorSql<{ n: string; einzige: string }[]>`
      SELECT count(*)::text AS n, min(id::text) AS einzige FROM transactions
       WHERE berlin_business_day(finalized_at) = ${gestern}::date`;
    expect(zaehler!.n).toBe('1');
    expect(zaehler!.einzige).toBe(belegId);

    // Am Urbeleg hat sich kein Byte geaendert.
    expect(await schnappschuss(belegId)).toEqual(vorher);

    // Und der Inhaber wird GEMELDET, wie beim nachgetragenen Verkauf.
    const meldungen = await buehne.migratorSql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM ledger_events
       WHERE event_type = 'alert.nachtrag_eingang' AND entity_id::text = ${antwort.id}`;
    expect(meldungen.length).toBe(1);
    expect(meldungen[0]!.payload.nachtragBezugstag).toBe(gestern);
  });

  // ── b) Die Signatur des Stornos ist ein eigener Vorgang ──────────────────

  it('b) die Signatur des Stornos ist ein EIGENER Vorgang; Urbeleg und Ursignatur bleiben unberuehrt', async () => {
    const { belegId, gestern, erfasstAm } = await verkaufVonGestern();
    await gesternVersiegeln(gestern);

    const vorher = await schnappschuss(belegId);

    const res = await storniere(belegId, erfasstAm);
    expect(res.statusCode, res.body).toBe(200);
    const stornoId = (res.json() as { id: string }).id;

    // Die Kasse signiert den Storno und traegt die Signatur nach, derselbe
    // Weg wie bei jedem Beleg.
    await signiereUeberHttp(stornoId);

    // Genau EINE Signatur, und sie haengt am STORNO.
    const [eigene] = await buehne.migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM tse_signatures
       WHERE transaction_id = ${stornoId}::uuid`;
    expect(eigene!.n).toBe('1');

    // Der Urbeleg samt SEINER Signatur: kein Byte anders.
    expect(await schnappschuss(belegId)).toEqual(vorher);
  });

  // ── c) Die Regel vom 28.07. bleibt ───────────────────────────────────────

  it('c) ist der Tag OFFEN, teilt der Storno weiter den Geschaeftstag des Verkaufs', async () => {
    const { belegId, gestern } = await verkaufVonGestern();
    // KEIN Abschluss: der Tag ist offen.

    const stornoZeit = new Date(berlinerZeitpunkt(gestern, 17, 55)).toISOString();
    const res = await storniere(belegId, stornoZeit);
    expect(res.statusCode, res.body).toBe(200);

    const zeile = await stornoZeile((res.json() as { id: string }).id);
    expect(zeile.buchungstag).toBe(gestern);
    // Kein Nachtrag: es gibt nichts nachzutragen.
    expect(zeile.nachtrag_bezugstag).toBeNull();
  });

  // ── d) Die aeltere Kasse ohne Geraetezeit ────────────────────────────────

  it('d) ohne erfasstAm storniert eine aeltere Kasse weiter; dann gilt die Serverzeit', async () => {
    const { belegId, heute } = await verkaufVonGestern();
    // KEIN Abschluss, KEINE Geraetezeit im Rumpf.

    const res = await storniere(belegId);
    expect(res.statusCode, res.body).toBe(200);

    const zeile = await stornoZeile((res.json() as { id: string }).id);
    expect(zeile.buchungstag).toBe(heute);
    expect(zeile.nachtrag_bezugstag).toBeNull();
  });
});
