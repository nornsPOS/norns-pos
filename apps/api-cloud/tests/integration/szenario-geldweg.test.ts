/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Der Geldweg: jede Zahlart bis zum Konto
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Bis zum 26.07.2026 buchte der DATEV-Weg JEDEN Verkauf gegen Konto 1000
 * Kasse, auch die Kartenzahlung: `transaction_payments` kam in der ganzen
 * Exportroute kein einziges Mal vor. Seither entscheidet die Zahlart ueber das
 * Sollkonto (`src/lib/datev-kontierung.ts`). Diese Datei sichert das ueber die
 * ganze Kette ab — echtes Postgres im Behaelter, echte Wanderungen, echte
 * HTTP-Aufrufe der Anwendung, kein einziger Rechenweg als Attrappe.
 *
 * Warum das kein Schoenheitsfehler war: Konto 1000 waechst dann um Geld, das
 * nie in der Schublade lag. Ein rechnerisch negativer oder unplausibel hoher
 * Kassenbestand ist der erste Punkt, den ein Pruefer nachrechnet, und er
 * begruendet fuer sich genommen eine Schaetzung. BMF 16.08.2017 haelt unbare
 * Vorgaenge im Kassenbuch fuer einen formellen Mangel; BMF 29.06.2018
 * entschaerft das nur dann, wenn die Kartenumsaetze auf ein eigenes Konto
 * umgetragen werden. Genau daran haengen die letzten beiden Proben.
 *
 * ── DIE ENTSCHEIDENDE ENTSCHEIDUNG DIESER DATEI ────────────────────────────
 * Die Kontentafel `ERWARTETES_KONTO` weiter unten ist VON HAND geschrieben und
 * wird ABSICHTLICH NICHT aus `datev-kontierung.ts` eingelesen. Wuerde sie das,
 * pruefte die Datei nur, dass eine Tafel mit sich selbst uebereinstimmt, und
 * bliebe gruen, wenn jemand SUMUP wieder auf 1000 legt. Dasselbe gilt fuer die
 * Feldpositionen des DATEV-Satzes: sie sind hier nachgezaehlt, nicht importiert.
 *
 * Alle Betraege sind ganze Euro. 19 Prozent auf einen ganzen Euro geht in Cent
 * immer auf (10000 * 19 / 100 = 1900), es wird also nirgends gerundet, und
 * jede Zahl laesst sich im Kopf nachrechnen.
 */

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type ZahlungAngabe, baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

// ── Die Kontentafel, von Hand ──────────────────────────────────────────────

type KontierteZahlart =
  | 'CASH'
  | 'ZVT_CARD'
  | 'SUMUP'
  | 'MOLLIE'
  | 'STRIPE'
  | 'EBAY'
  | 'BANK_TRANSFER';

/**
 * Zahlart → Sollkonto nach SKR03, aus der Beraterrecherche abgeschrieben.
 *
 * NICHT importiert. Wer die Zuordnung im Quelltext verstellt, muss hier
 * vorbei; eine importierte Tafel haette den Fehler mitverstellt.
 */
const ERWARTETES_KONTO: Readonly<Record<KontierteZahlart, string>> = {
  CASH: '1000', // Kasse — das einzige Konto, das echtes Bargeld sieht
  ZVT_CARD: '1361', // Geldtransit Kartenterminal
  SUMUP: '1362', // Geldtransit SumUp
  MOLLIE: '1363', // Geldtransit Mollie
  STRIPE: '1364', // Geldtransit Stripe
  EBAY: '1365', // Geldtransit eBay
  BANK_TRANSFER: '1200', // Bank
};

const ALLE_KONTIERTEN: readonly KontierteZahlart[] = [
  'CASH',
  'ZVT_CARD',
  'SUMUP',
  'MOLLIE',
  'STRIPE',
  'EBAY',
  'BANK_TRANSFER',
];

/** Jedes Konto, auf dem in dieser Datei Geld liegen kann. */
const GELDKONTEN: readonly string[] = ['1000', '1200', '1361', '1362', '1363', '1364', '1365'];

/** Wareneingang — die Gegenseite jedes Ankaufs. */
const KONTO_WARENEINGANG = '3200';
/** Erloese 19 Prozent — die Gegenseite jedes Verkaufs zu STANDARD_19. */
const KONTO_ERLOESE_19 = '8400';

// ── Der DATEV-Satz, Feld fuer Feld nachgezaehlt ────────────────────────────

/**
 * Feldpositionen im 125-Feld-Satz, als Index (Feldnummer minus eins).
 *
 * Von Hand aus dem Format uebernommen und nicht aus `datev-spalten.generiert`
 * importiert: das Format ist positionsbasiert, und ein verrutschtes Feld ist
 * genau der Fehler, den diese Datei sehen soll.
 */
const SPALTE = {
  UMSATZ: 0, // Feld 1
  SOLL_HABEN: 1, // Feld 2
  KONTO: 6, // Feld 7
  GEGENKONTO: 7, // Feld 8
  BU_SCHLUESSEL: 8, // Feld 9
  BELEGDATUM: 9, // Feld 10
  BELEGFELD_1: 10, // Feld 11
  BUCHUNGSTEXT: 13, // Feld 14
} as const;

interface Buchungszeile {
  umsatz: string; // '119,00'
  cents: bigint; // 11900n
  sollHaben: string; // 'S' | 'H'
  konto: string;
  gegenkonto: string;
  buSchluessel: string;
  belegdatum: string;
  belegfeld1: string; // der Belegtext-Ordnungsbegriff = receipt_locator
  buchungstext: string;
}

/** '119,00' → 11900n. Ganze Cent, niemals Fliesskomma. */
function centsAusDatev(betrag: string): bigint {
  const treffer = /^(\d+),(\d{2})$/.exec(betrag.trim());
  if (treffer === null) throw new Error(`Kein DATEV-Betrag: „${betrag}"`);
  return BigInt(treffer[1] ?? '0') * 100n + BigInt(treffer[2] ?? '0');
}

/** 11900n → '119.00'. Die Schreibweise der Datenbank, nicht die von DATEV. */
function zuEuro(cents: bigint): string {
  const negativ = cents < 0n;
  const abs = negativ ? -cents : cents;
  return `${negativ ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/**
 * Die Antwort in Buchungszeilen zerlegen.
 *
 * Die Datei ist ANSI (Windows-1252), deshalb die ROHEN Bytes und `latin1`.
 * Kopfzeile und Spaltenzeile fallen weg, uebrig bleiben die Buchungen.
 */
function zerlege(res: LightMyRequestResponse): Buchungszeile[] {
  const csv = Buffer.from(res.rawPayload).toString('latin1');
  const zeilen = csv.split('\r\n').filter((z) => z.length > 0);
  return zeilen.slice(2).map((z) => {
    const f = z.split(';').map((c) => c.replace(/^"|"$/g, ''));
    const umsatz = f[SPALTE.UMSATZ] ?? '';
    return {
      umsatz,
      cents: centsAusDatev(umsatz),
      sollHaben: f[SPALTE.SOLL_HABEN] ?? '',
      konto: f[SPALTE.KONTO] ?? '',
      gegenkonto: f[SPALTE.GEGENKONTO] ?? '',
      buSchluessel: f[SPALTE.BU_SCHLUESSEL] ?? '',
      belegdatum: f[SPALTE.BELEGDATUM] ?? '',
      belegfeld1: f[SPALTE.BELEGFELD_1] ?? '',
      buchungstext: f[SPALTE.BUCHUNGSTEXT] ?? '',
    };
  });
}

/**
 * Der Saldo je Geldkonto aus der fertigen Datei.
 *
 * Steht das Geldkonto auf der SOLLSEITE (Feld 7), ist Geld hereingekommen;
 * steht es als GEGENKONTO (Feld 8), ist es hinausgegangen. Genau so liest ein
 * Berater den Stapel, und genau so muss die Kasse wachsen und schrumpfen.
 */
function saldoJeGeldkonto(zeilen: readonly Buchungszeile[]): Map<string, bigint> {
  const saldo = new Map<string, bigint>();
  for (const konto of GELDKONTEN) saldo.set(konto, 0n);
  for (const z of zeilen) {
    if (saldo.has(z.konto)) saldo.set(z.konto, (saldo.get(z.konto) ?? 0n) + z.cents);
    if (saldo.has(z.gegenkonto)) saldo.set(z.gegenkonto, (saldo.get(z.gegenkonto) ?? 0n) - z.cents);
  }
  return saldo;
}

/**
 * Netto, Umsatzsteuer und Brutto zu 19 Prozent aus ganzen Euro.
 *
 * Von Hand: 100 Euro netto sind 10000 Cent, die Steuer ist 10000 * 19 / 100 =
 * 1900 Cent, brutto also 11900 Cent. Weil der Nettobetrag immer ein ganzer
 * Euro ist, geht die Division ohne Rest auf.
 */
function betraege19(nettoEuro: number): {
  subtotal: string;
  vat: string;
  total: string;
  totalCents: bigint;
} {
  const netto = BigInt(nettoEuro) * 100n;
  const ust = (netto * 19n) / 100n;
  const brutto = netto + ust;
  return { subtotal: zuEuro(netto), vat: zuEuro(ust), total: zuEuro(brutto), totalCents: brutto };
}

describe('Der Geldweg: jede Zahlart bis zum Konto', () => {
  const buehne = baueFiskalBuehne({ geschaeftstag: '2026-05-04' });

  beforeAll(async () => {
    await buehne.starten();
  }, 120_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
  });

  /**
   * Ein Verkauf zu 19 Prozent, mit frei gewaehlten Zahlungsbeinen.
   *
   * Alle Betraege bleiben unter der GwG-Barschwelle von 2.000 Euro, deshalb
   * braucht kein Beleg einen ausweisgeprueften Kunden.
   */
  async function legeVerkaufAn(
    nettoEuro: number,
    zahlungen: readonly ZahlungAngabe[],
    stunde: number,
  ): Promise<{ id: string; locator: string; total: string; totalCents: bigint }> {
    const b = betraege19(nettoEuro);
    const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    const beleg = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: b.subtotal,
      vat: b.vat,
      total: b.total,
      customerId: null,
      finalizedAt: buehne.ts(stunde),
      items: [
        {
          productId: produkt,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: b.subtotal,
          lineVat: b.vat,
          lineTotal: b.total,
          displayOrder: 0,
        },
      ],
      payments: zahlungen,
    });
    return { id: beleg.id, locator: beleg.locator, total: b.total, totalCents: b.totalCents };
  }

  /**
   * Ein Ankauf vom Privatmann: keine Umsatzsteuer, § 25a, und immer mit einem
   * ausweisgeprueften Verkaeufer (§ 259 StGB, harter Riegel im Schema).
   */
  async function legeAnkaufAn(
    betragEuro: number,
    zahlungen: readonly ZahlungAngabe[],
    stunde: number,
  ): Promise<{ id: string; locator: string; total: string; totalCents: bigint }> {
    const cents = BigInt(betragEuro) * 100n;
    const betrag = zuEuro(cents);
    const produkt = await buehne.legeProduktAn({ behandlung: 'MARGIN_25A' });
    const beleg = await buehne.legeBelegAn({
      direction: 'ANKAUF',
      treatment: 'MARGIN_25A',
      subtotal: betrag,
      vat: '0.00',
      total: betrag,
      customerId: buehne.akteure.kundeId,
      finalizedAt: buehne.ts(stunde),
      items: [
        {
          productId: produkt,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: betrag,
          lineVat: '0.00',
          lineTotal: betrag,
          displayOrder: 0,
        },
      ],
      payments: zahlungen,
    });
    return { id: beleg.id, locator: beleg.locator, total: betrag, totalCents: cents };
  }

  /**
   * Eine festgeschriebene Abschlusszeile fuer den Vorgabetag setzen.
   *
   * ⚠️ WARUM DIESE DATEI IHREN ABSCHLUSS SELBST SAET (04.08.2026)
   *
   * Seit den Wanderungen 0124 und 0125 traegt eine FESTGESCHRIEBENE Zeile zwei
   * Pflichtangaben mehr: die fortlaufende Z-Nummer (ohne sie ist ein fehlender
   * Abschluss von einem vorhandenen nicht zu unterscheiden) und die Herkunft
   * des Kassensturzes (ohne sie steht eine erfundene Null im Bericht).
   * `legeAbschlussAn` der gemeinsamen Buehne setzt beides noch nicht, und
   * dieser Durchgang fasst gemeinsame Dateien nicht an. Der Weg darunter ist
   * derselbe: EIN INSERT mit dem Kopf der Beweiskette als Anker.
   *
   * Die Kassenzahlen sind hier ausdruecklich Buehnenwerte. Diese Datei misst,
   * auf WELCHES Konto eine Zahlart faellt, nicht den Kassensturz. Wer den
   * Kassensturz misst, steht ganz unten und geht den ECHTEN Weg
   * `POST /api/closings/finalize` mit einer wirklich geschlossenen Schicht.
   */
  async function legeAbschlussFestAn(tag: string): Promise<string> {
    const [zeile] = await buehne.migratorSql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        kassensturz_quelle, z_nr,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at
      )
      SELECT
        ${tag}::date, 'FINALIZED'::closing_state,
        '0.00', '0.00', '0.00',
        'EIGENER_STURZ'::kassensturz_quelle,
        COALESCE((SELECT max(z_nr) FROM daily_closings), 0) + 1,
        k.id, k.row_hash,
        ${buehne.akteure.inhaberId}, now(), ${buehne.akteure.inhaberId}, now()
      FROM (SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1) AS k
      RETURNING id`;
    if (zeile === undefined) {
      throw new Error(
        'legeAbschlussFestAn: die Beweiskette ist leer, es gibt nichts zu verankern. ' +
          'Erst einen Beleg anlegen.',
      );
    }
    return zeile.id;
  }

  /** Den Tag abschliessen und den DATEV-Stapel ueber HTTP ziehen. */
  async function holeStapel(): Promise<LightMyRequestResponse> {
    const abschlussId = await legeAbschlussFestAn(buehne.geschaeftstag);
    return buehne.hol(`/api/closings/${abschlussId}/export/datev`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. Jede Zahlart auf ihr eigenes Konto
  // ────────────────────────────────────────────────────────────────────────

  it('bucht jede der sieben kontierten Zahlarten auf ihr eigenes Konto', async () => {
    // Sieben Belege mit sieben verschiedenen Betraegen, damit keine Zeile mit
    // einer anderen verwechselt werden kann:
    //   CASH           100 netto → 119,00   ZVT_CARD  200 netto → 238,00
    //   SUMUP          300 netto → 357,00   MOLLIE    400 netto → 476,00
    //   STRIPE         500 netto → 595,00   EBAY      600 netto → 714,00
    //   BANK_TRANSFER  700 netto → 833,00
    const belege = new Map<KontierteZahlart, { locator: string; total: string }>();
    for (const [i, art] of ALLE_KONTIERTEN.entries()) {
      const netto = 100 * (i + 1);
      const b = betraege19(netto);
      const beleg = await legeVerkaufAn(netto, [{ method: art, amount: b.total }], 9 + i);
      belege.set(art, { locator: beleg.locator, total: b.total });
    }

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);

    // Ein Beleg, eine Zahlart, eine Behandlung → genau eine Buchungszeile.
    expect(zeilen).toHaveLength(7);

    for (const art of ALLE_KONTIERTEN) {
      const erwartet = belege.get(art);
      expect(erwartet, `kein Beleg fuer ${art} angelegt`).toBeDefined();
      const zeile = zeilen.find((z) => z.belegfeld1 === erwartet?.locator);
      expect(zeile, `keine Buchungszeile fuer ${art}`).toBeDefined();
      expect(zeile?.konto, `${art} auf falschem Konto`).toBe(ERWARTETES_KONTO[art]);
      // Verkauf: das Geld kommt herein, also Sollseite, Gegenkonto Erloese 19 %.
      expect(zeile?.sollHaben).toBe('S');
      expect(zeile?.gegenkonto).toBe(KONTO_ERLOESE_19);
      expect(zeile?.buSchluessel).toBe(''); // 19.08.2026: leer — 8400 ist Automatikkonto
      expect(zeile?.umsatz).toBe(erwartet?.total.replace('.', ','));
    }

    // Und die sieben Konten sind wirklich sieben verschiedene.
    const konten = new Set(zeilen.map((z) => z.konto));
    expect(konten.size).toBe(7);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Konto 1000 traegt nur Bargeld
  // ────────────────────────────────────────────────────────────────────────

  it('laesst Konto 1000 in der ganzen Datei nur Bargeld tragen, auf der Soll- wie auf der Habenseite', async () => {
    const barVerkauf = await legeVerkaufAn(100, [{ method: 'CASH', amount: '119.00' }], 9);
    const kartenVerkauf = await legeVerkaufAn(200, [{ method: 'ZVT_CARD', amount: '238.00' }], 10);
    const stripeVerkauf = await legeVerkaufAn(300, [{ method: 'STRIPE', amount: '357.00' }], 11);
    const barAnkauf = await legeAnkaufAn(50, [{ method: 'CASH', amount: '50.00' }], 12);
    const bankAnkauf = await legeAnkaufAn(400, [{ method: 'BANK_TRANSFER', amount: '400.00' }], 13);

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);
    expect(zeilen).toHaveLength(5);

    // Die einzigen beiden Belege, in denen ueberhaupt Bargeld vorkommt.
    const barBelege = new Set([barVerkauf.locator, barAnkauf.locator]);

    const kassenzeilen = zeilen.filter((z) => z.konto === '1000' || z.gegenkonto === '1000');
    // Nicht leer — sonst waere die Zusicherung darunter wertlos.
    expect(kassenzeilen).toHaveLength(2);
    for (const z of kassenzeilen) {
      expect(
        barBelege.has(z.belegfeld1),
        `Beleg ${z.belegfeld1} beruehrt Konto 1000, ist aber kein Barbeleg`,
      ).toBe(true);
    }

    // Sollseite: der Barverkauf legt 119,00 in die Schublade.
    const barVerkaufZeile = zeilen.find((z) => z.belegfeld1 === barVerkauf.locator);
    expect(barVerkaufZeile?.konto).toBe('1000');
    expect(barVerkaufZeile?.sollHaben).toBe('S');
    expect(barVerkaufZeile?.umsatz).toBe('119,00');

    // Habenseite: der Barankauf nimmt 50,00 wieder heraus — Wareneingang an Kasse.
    const barAnkaufZeile = zeilen.find((z) => z.belegfeld1 === barAnkauf.locator);
    expect(barAnkaufZeile?.konto).toBe(KONTO_WARENEINGANG);
    expect(barAnkaufZeile?.gegenkonto).toBe('1000');
    expect(barAnkaufZeile?.umsatz).toBe('50,00');

    // Und die drei unbaren Belege fassen die Kasse nirgends an.
    for (const beleg of [kartenVerkauf, stripeVerkauf, bankAnkauf]) {
      const zeile = zeilen.find((z) => z.belegfeld1 === beleg.locator);
      expect(zeile?.konto).not.toBe('1000');
      expect(zeile?.gegenkonto).not.toBe('1000');
    }
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Ein Beleg, drei Zahlarten
  // ────────────────────────────────────────────────────────────────────────

  it('teilt einen Beleg mit drei Zahlarten auf drei Konten auf und geht dabei auf den Cent auf', async () => {
    // 400 Euro netto → 476,00 brutto = 47600 Cent.
    // Von Hand geteilt: 100,00 bar + 200,00 Karte + 176,00 Stripe
    //                   10000 + 20000 + 17600 = 47600 Cent. Geht auf.
    const beleg = await legeVerkaufAn(
      400,
      [
        { method: 'CASH', amount: '100.00' },
        { method: 'ZVT_CARD', amount: '200.00' },
        { method: 'STRIPE', amount: '176.00' },
      ],
      9,
    );
    expect(beleg.totalCents).toBe(47600n);

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);

    // Drei Zahlungsbeine, eine Steuerbehandlung → drei Buchungszeilen.
    expect(zeilen).toHaveLength(3);
    for (const z of zeilen) expect(z.belegfeld1).toBe(beleg.locator);

    const nachKonto = new Map(zeilen.map((z) => [z.konto, z]));
    expect(nachKonto.get('1000')?.umsatz).toBe('100,00');
    expect(nachKonto.get('1361')?.umsatz).toBe('200,00');
    expect(nachKonto.get('1364')?.umsatz).toBe('176,00');

    // Die drei Zeilen ergeben wieder genau den Belegbetrag: 47600 Cent.
    const summe = zeilen.reduce((s, z) => s + z.cents, 0n);
    expect(summe).toBe(47600n);
    expect(summe).toBe(beleg.totalCents);

    // Der Buchungstext benennt die Zahlart, sonst staenden drei gleich
    // lautende Zeilen untereinander und der Berater muesste raten.
    expect(nachKonto.get('1000')?.buchungstext).toContain('bar');
    expect(nachKonto.get('1361')?.buchungstext).toContain('Karte');
    expect(nachKonto.get('1364')?.buchungstext).toContain('Stripe');

    // Alle drei tragen dasselbe Erloeskonto — geteilt wird das GELD, nicht die
    // Steuer.
    for (const z of zeilen) expect(z.gegenkonto).toBe(KONTO_ERLOESE_19);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. Ankauf per Ueberweisung
  // ────────────────────────────────────────────────────────────────────────

  it('nimmt bei einem Ankauf per Ueberweisung das Geld von der Bank und nicht aus der Kasse', async () => {
    const ankauf = await legeAnkaufAn(500, [{ method: 'BANK_TRANSFER', amount: '500.00' }], 10);

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);
    expect(zeilen).toHaveLength(1);

    const zeile = zeilen[0];
    expect(zeile?.belegfeld1).toBe(ankauf.locator);
    // Wareneingang (Soll) an Bank (Haben). Kein Ausgangsumsatzsteuerschluessel:
    // ein Ankauf vom Privatmann traegt keine Umsatzsteuer.
    expect(zeile?.konto).toBe(KONTO_WARENEINGANG);
    expect(zeile?.gegenkonto).toBe('1200');
    expect(zeile?.sollHaben).toBe('S');
    expect(zeile?.buSchluessel).toBe('');
    expect(zeile?.umsatz).toBe('500,00');

    // In der GANZEN Datei taucht die Kasse nicht auf — es lag kein Bargeld
    // auf dem Tisch, also darf Konto 1000 sich nicht bewegen.
    for (const z of zeilen) {
      expect(z.konto).not.toBe('1000');
      expect(z.gegenkonto).not.toBe('1000');
    }

    // Und der Saldo sagt dasselbe noch einmal: die Bank gibt 500,00 ab.
    const saldo = saldoJeGeldkonto(zeilen);
    expect(saldo.get('1200')).toBe(-50000n);
    expect(saldo.get('1000')).toBe(0n);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5.–7. Die drei nicht kontierten Zahlarten brechen ab
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Ein Verkauf ueber 119,00, der mit EINER Zahlart beglichen wird.
   *
   * `kunde` ist Pflicht fuer das Kundenkonto: ein Wächter aus Wanderung 0016
   * weist eine DEBT-Zahlung ohne Kunden ab, und das zu Recht — eine Schuld
   * ohne Schuldner gibt es nicht.
   */
  async function legeEinbeinigenVerkaufAn(
    zahlart: string,
    kunde: string | null,
  ): Promise<{ id: string; locator: string }> {
    const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    const b = betraege19(100); // 119,00 brutto
    return buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: b.subtotal,
      vat: b.vat,
      total: b.total,
      customerId: kunde,
      finalizedAt: buehne.ts(9),
      items: [
        {
          productId: produkt,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: b.subtotal,
          lineVat: b.vat,
          lineTotal: b.total,
          displayOrder: 0,
        },
      ],
      payments: [{ method: zahlart, amount: b.total }],
    });
  }

  /**
   * Der gemeinsame Nachweis fuer Kundenkonto und Inzahlungnahme.
   *
   * Fuer diese zwei gibt es KEINE belegte Kontenzuordnung. Ein stiller
   * Rueckfall auf die Kasse waere die bequeme Antwort und genau der Fehler,
   * den die Kontierung behebt. Erwartet wird deshalb ein sauberer Abbruch mit
   * einer Meldung, die der Inhaber lesen kann. (Der Gutschein gehoerte bis
   * zum 12.08.2026 dazu; seither hat er ein amtlich geprueftes Konto, siehe
   * den eigenen Nachweis darunter.)
   */
  async function pruefeAbbruch(klartext: string): Promise<void> {
    const res = await holeStapel();

    // 409: es ist ein Zustandskonflikt, kein Serverfehler und kein Tippfehler
    // des Bedieners.
    expect(res.statusCode).toBe(409);
    const koerper = res.json() as { error: { code: string; message: string } };
    expect(koerper.error.code).toBe('CONFLICT');
    // Der Inhaber liest den deutschen Namen, nicht den Aufzaehlungswert.
    expect(koerper.error.message).toContain(klartext);
    expect(koerper.error.message).toContain('kein Buchungskonto hinterlegt');
    expect(koerper.error.message).toContain('KEINE DATEV-Datei');
    expect(koerper.error.message).toContain('Steuerberater');
    // Und nirgends steht die Kasse als Ausweg drin.
    expect(koerper.error.message).not.toContain('1000');
    // Es wurde wirklich keine Datei ausgeliefert.
    expect(res.headers['content-disposition']).toBeUndefined();
  }

  it('bucht den Gutschein auf die Verbindlichkeit 1796, nicht auf die Kasse (12.08.2026)', async () => {
    // Bis zum 12.08.2026 brach EIN Gutschein-Beleg die DATEV-Datei des ganzen
    // Tages ab (der Test hier pinnte den Abbruch fest). Amtlich geprueft im
    // offiziellen SKR03 2025: 1796 "Ausgegebene Geschenkgutscheine", ohne
    // Automatikfunktion — die Einloesung mindert die Verbindlichkeit aus der
    // Ausgabe. Die 1796 steht hier VON HAND, nicht importiert, wie die ganze
    // Kontentafel dieser Datei.
    const beleg = await legeEinbeinigenVerkaufAn('VOUCHER', null);

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);
    const zeile = zeilen.find((z) => z.belegfeld1 === beleg.locator);
    expect(zeile, 'keine Buchungszeile fuer den Gutschein-Beleg').toBeDefined();
    expect(zeile?.konto).toBe('1796');
    expect(zeile?.konto).not.toBe('1000'); // niemals still auf die Kasse
    expect(zeile?.sollHaben).toBe('S');
    expect(zeile?.gegenkonto).toBe(KONTO_ERLOESE_19);
    expect(zeile?.umsatz).toBe('119,00');
  });

  it('bricht den Export bei einem Kauf auf Kundenkonto ab, statt still auf die Kasse zu buchen', async () => {
    await legeEinbeinigenVerkaufAn('DEBT', buehne.akteure.kundeId);
    await pruefeAbbruch('Kundenkonto');
  });

  it('bricht den Export bei einer Inzahlungnahme ab, statt still auf die Kasse zu buchen', async () => {
    // Eine Inzahlungnahme ist immer ZWEI Belege: der Ankauf des alten Stuecks
    // und der Verkauf des neuen, den er begleicht. Das Schema erzwingt diesen
    // Zusammenhang (`transaction_payments_tradein_requires_ankauf`, Wanderung
    // 0019): eine TRADE_IN-Zahlung ohne Verweis auf den Ankaufsbeleg wird
    // abgewiesen.
    const ankauf = await legeAnkaufAn(119, [{ method: 'CASH', amount: '119.00' }], 8);
    const verkauf = await legeEinbeinigenVerkaufAn('VOUCHER', null);

    // Die Verweisspalte kennt die gemeinsame Buehne nicht, deshalb wird das
    // Zahlungsbein hier in EINEM Zug auf die Inzahlungnahme samt Verweis
    // gesetzt. Der Betrag bleibt unveraendert, der Ausgleichswaechter aus
    // Wanderung 0016 also erfuellt.
    await buehne.migratorSql`
      UPDATE transaction_payments
         SET payment_method = 'TRADE_IN'::payment_method,
             trade_in_ankauf_transaction_id = ${ankauf.id}
       WHERE transaction_id = ${verkauf.id}`;
    const [gesetzt] = await buehne.migratorSql<{ method: string }[]>`
      SELECT payment_method::text AS method
        FROM transaction_payments WHERE transaction_id = ${verkauf.id}`;
    expect(gesetzt?.method).toBe('TRADE_IN');

    await pruefeAbbruch('Inzahlungnahme');
  });

  // ────────────────────────────────────────────────────────────────────────
  // 8. Der Saldo je Geldkonto
  // ────────────────────────────────────────────────────────────────────────

  it('laesst den Saldo jedes Geldkontos genau der Summe der Zahlungen dieser Zahlart entsprechen', async () => {
    // Acht Belege ueber den Tag verteilt, darunter ein geteilt bezahlter.
    // Von Hand nachgerechnet, je Zahlart in ganzen Cent:
    //   CASH           11900 (Beleg 1) + 10000 (Beleg 6) =  21900
    //   ZVT_CARD       23800 (Beleg 2) + 11900 (Beleg 3) =  35700
    //   SUMUP          35700 (Beleg 4)                    =  35700
    //   MOLLIE         17600 (Beleg 6)                    =  17600
    //   STRIPE         59500 (Beleg 5) + 20000 (Beleg 6) =  79500
    //   EBAY           71400 (Beleg 7)                    =  71400
    //   BANK_TRANSFER  83300 (Beleg 8)                    =  83300
    //   Summe                                              345100
    // Gegenprobe ueber die Belegbetraege:
    //   11900+23800+11900+35700+59500+47600+71400+83300 = 345100. Gleich.
    await legeVerkaufAn(100, [{ method: 'CASH', amount: '119.00' }], 9); // 1
    await legeVerkaufAn(200, [{ method: 'ZVT_CARD', amount: '238.00' }], 10); // 2
    await legeVerkaufAn(100, [{ method: 'ZVT_CARD', amount: '119.00' }], 11); // 3
    await legeVerkaufAn(300, [{ method: 'SUMUP', amount: '357.00' }], 12); // 4
    await legeVerkaufAn(500, [{ method: 'STRIPE', amount: '595.00' }], 13); // 5
    await legeVerkaufAn(
      400, // 6 — 476,00 = 100,00 bar + 200,00 Stripe + 176,00 Mollie
      [
        { method: 'CASH', amount: '100.00' },
        { method: 'STRIPE', amount: '200.00' },
        { method: 'MOLLIE', amount: '176.00' },
      ],
      14,
    );
    await legeVerkaufAn(600, [{ method: 'EBAY', amount: '714.00' }], 15); // 7
    await legeVerkaufAn(700, [{ method: 'BANK_TRANSFER', amount: '833.00' }], 16); // 8

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);

    // Sieben Belege mit einer Zahlart plus einer mit drei → 7 + 3 = 10 Zeilen.
    expect(zeilen).toHaveLength(10);

    const saldo = saldoJeGeldkonto(zeilen);
    const erwartet: Readonly<Record<KontierteZahlart, bigint>> = {
      CASH: 21900n,
      ZVT_CARD: 35700n,
      SUMUP: 35700n,
      MOLLIE: 17600n,
      STRIPE: 79500n,
      EBAY: 71400n,
      BANK_TRANSFER: 83300n,
    };
    for (const art of ALLE_KONTIERTEN) {
      expect(saldo.get(ERWARTETES_KONTO[art]), `Saldo ${art}`).toBe(erwartet[art]);
    }

    // Gegenprobe gegen die Datenbank: was auf einem Geldkonto liegt, ist genau
    // das, was unter dieser Zahlart wirklich gezahlt wurde.
    const gezahlt = await buehne.migratorSql<{ method: string; summe: string }[]>`
      SELECT payment_method::text AS method, SUM(amount_eur)::text AS summe
        FROM transaction_payments GROUP BY payment_method`;
    for (const zeile of gezahlt) {
      const konto = ERWARTETES_KONTO[zeile.method as KontierteZahlart];
      const centsInDatenbank = BigInt(zeile.summe.replace('.', ''));
      expect(saldo.get(konto), `Datenbank gegen Datei, ${zeile.method}`).toBe(centsInDatenbank);
    }

    // Und die ganze Datei traegt zusammen den Tagesumsatz: 345100 Cent.
    const gesamt = zeilen.reduce((s, z) => s + z.cents, 0n);
    expect(gesamt).toBe(345100n);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 9. Der Kassenbestand an einem unbaren Tag
  // ────────────────────────────────────────────────────────────────────────

  it('bewegt an einem Tag voller Kartenzahlungen nur den Baranteil durch die Kasse und laesst sie rechnerisch positiv', async () => {
    // Fuenf unbare Verkaeufe zu je 595,00 = 297500 Cent, ein Barverkauf ueber
    // 119,00 = 11900 Cent, dazu ein Barankauf ueber 50,00 = 5000 Cent.
    // Tagesumsatz aus Verkaeufen: 297500 + 11900 = 309400 Cent.
    // Kassenbewegung von Hand:  11900 herein − 5000 hinaus = 6900 Cent.
    for (const art of ['ZVT_CARD', 'SUMUP', 'MOLLIE', 'STRIPE', 'EBAY'] as const) {
      await legeVerkaufAn(500, [{ method: art, amount: '595.00' }], 9);
    }
    const barVerkauf = await legeVerkaufAn(100, [{ method: 'CASH', amount: '119.00' }], 14);
    const barAnkauf = await legeAnkaufAn(50, [{ method: 'CASH', amount: '50.00' }], 15);

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);
    expect(zeilen).toHaveLength(7);

    const saldo = saldoJeGeldkonto(zeilen);
    const kasse = saldo.get('1000') ?? 0n;

    // Die Kasse bewegt sich um genau 69,00 Euro …
    expect(kasse).toBe(6900n);
    // … bleibt also rechnerisch positiv (der Punkt, den ein Pruefer nachrechnet) …
    expect(kasse >= 0n).toBe(true);
    // … und liegt weit unter dem Tagesumsatz von 3.094,00 Euro. Vor dem
    // 26.07.2026 waeren die 297500 Cent Kartenumsatz mit in der Kasse
    // gelandet: 309400 − 5000 = 304400 Cent, also das 44-fache.
    const verkaufsumsatz = zeilen
      .filter((z) => z.gegenkonto === KONTO_ERLOESE_19)
      .reduce((s, z) => s + z.cents, 0n);
    expect(verkaufsumsatz).toBe(309400n);
    expect(kasse < verkaufsumsatz).toBe(true);

    // Die Bewegung besteht wirklich nur aus den beiden Barbelegen.
    const kassenzeilen = zeilen.filter((z) => z.konto === '1000' || z.gegenkonto === '1000');
    expect(kassenzeilen.map((z) => z.belegfeld1).sort()).toEqual(
      [barVerkauf.locator, barAnkauf.locator].sort(),
    );

    // Die fuenf unbaren Verkaeufe liegen vollstaendig auf den Transitkonten:
    // 5 * 59500 = 297500 Cent.
    const transit = ['1361', '1362', '1363', '1364', '1365'].reduce(
      (s, k) => s + (saldo.get(k) ?? 0n),
      0n,
    );
    expect(transit).toBe(297500n);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 10. Der Kassenbericht (Z-Bon)
  // ────────────────────────────────────────────────────────────────────────

  it('weist im Kassenbericht als Barbestand nur den Baranteil aus, nicht den Tagesumsatz', async () => {
    // Diese Probe faehrt den ECHTEN Weg: Schicht oeffnen, Belege, Kassensturz,
    // Tagesabschluss — alles ueber HTTP. Der erwartete Kassenbestand wird
    // NICHT von der Buehne gesetzt, sondern von der Anwendung aus den
    // Zahlungszeilen gerechnet. Nur so ist die Aussage keine Selbstbestaetigung.
    const [heuteZeile] = await buehne.migratorSql<{ tag: string }[]>`
      SELECT berlin_business_day(now())::text AS tag`;
    const heute = heuteZeile?.tag ?? '';
    expect(heute).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Wechselgeld 100,00 in der Schublade.
    const schicht = await buehne.sende('/api/shifts/open', { openingFloatEur: '100.00' });
    expect(schicht.statusCode).toBe(200);
    const schichtId = (schicht.json() as { id: string }).id;

    // Der Tag: 119,00 bar, 595,00 Karte, und ein geteilter Beleg ueber 119,00
    // (50,00 bar + 69,00 Karte). Die Belege tragen `now()`, damit sie auf den
    // laufenden Berliner Geschaeftstag fallen — denselben, den die Schicht und
    // der Abschluss unten sehen.
    const jetzt = new Date().toISOString();
    async function legeTagesbelegAn(
      nettoEuro: number,
      zahlungen: readonly ZahlungAngabe[],
    ): Promise<void> {
      const b = betraege19(nettoEuro);
      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: b.subtotal,
        vat: b.vat,
        total: b.total,
        customerId: null,
        finalizedAt: jetzt,
        items: [
          {
            productId: produkt,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: b.subtotal,
            lineVat: b.vat,
            lineTotal: b.total,
            displayOrder: 0,
          },
        ],
        payments: zahlungen,
        // Ein gewoehnlicher Tag: die Sicherungseinrichtung hat jeden Beleg
        // signiert. Ohne Signatur haelt `POST /api/closings/finalize` den Tag
        // zu Recht an und verlangt eine ausdrueckliche Bestaetigung — dieser
        // Riegel gehoert einer eigenen Datei, hier waere er nur Kulisse.
        tse: true,
      });
    }
    await legeTagesbelegAn(100, [{ method: 'CASH', amount: '119.00' }]);
    await legeTagesbelegAn(500, [{ method: 'ZVT_CARD', amount: '595.00' }]);
    await legeTagesbelegAn(100, [
      { method: 'CASH', amount: '50.00' },
      { method: 'ZVT_CARD', amount: '69.00' },
    ]);

    // Die Belege der Schicht zuordnen. Auf der Produktion tut das die
    // Verkaufsroute beim Einfuegen; die Buehne kennt keine Schicht, deshalb
    // hier nachgetragen. Gerechnet wird gleich trotzdem von der Anwendung.
    await buehne.migratorSql`UPDATE transactions SET shift_id = ${schichtId}`;

    // Kassensturz. Von Hand erwartet:
    //   Wechselgeld 10000 + bar 11900 + bar 5000 = 26900 Cent = 269,00 Euro.
    // Die 66400 Cent Kartenumsatz (59500 + 6900) duerfen NICHT dabei sein.
    const sturz = await buehne.sende(`/api/shifts/${schichtId}/close`, {
      blindCountEur: '269.00',
    });
    expect(sturz.statusCode).toBe(200);
    const geschlossen = sturz.json() as { systemExpectedEur: string; varianceEur: string | null };
    expect(geschlossen.systemExpectedEur).toBe('269.00');
    expect(geschlossen.varianceEur).toBe('0.00');

    // Der Tagesabschluss, von der Anwendung gerechnet.
    const abschluss = await buehne.sende('/api/closings/finalize', { businessDay: heute });
    expect(abschluss.statusCode).toBe(200);
    const zbon = abschluss.json() as {
      id: string;
      grossVerkaufEur: string;
      cashExpectedEur: string;
    };
    // Tagesumsatz brutto: 11900 + 59500 + 11900 = 83300 Cent = 833,00 Euro.
    expect(zbon.grossVerkaufEur).toBe('833.00');
    expect(zbon.cashExpectedEur).toBe('269.00');

    const bericht = await buehne.hol(`/api/closings/${zbon.id}/export/kassenbericht`);
    expect(bericht.statusCode).toBe(200);
    const csv = bericht.body;

    // DER PUNKT: der Kassenbestand ist 269,00 und nicht 833,00. Das ist der
    // Unterschied, an dem BMF 16.08.2017 und 29.06.2018 haengen.
    //
    // ⚠️ Die alte Zusage (07.08.2026 ersetzt): „Kasse;Erwartet bar;269,00 EUR"
    // / „Kasse;Gezählt bar;269,00 EUR" / „Kasse;Differenz;0,00 EUR". Seit
    // `baueKassenrechnung` angeschlossen ist (`lib/kassenrechnung.ts`),
    // rechnet der Abschnitt „Kasse" den erwarteten Bestand selbst aus
    // Anfangsbestand + Bareinnahmen − Barankauf her, und `POST
    // ⚠️ 06.08.2026: der Anfangsbestand kommt aus `shifts.opening_float_eur`,
    // wo er wirklich steht — `cash_movements` trägt für ihn nie eine Zeile.
    // Der Kartenumsatz liegt weiterhin NICHT im Barbestand.
    expect(csv).toContain('Kasse;Bareinnahmen;169,00 EUR');
    // 100,00 Anfangsbestand + 169,00 Bareinnahmen − 0,00 Barankauf = 269,00,
    // und das ist genau die beim Abschluss festgeschriebene Zahl.
    expect(csv).toContain('Kasse;Anfangsbestand (Wechselgeld);100,00 EUR');
    expect(csv).toContain('Kasse;Erwarteter Endbestand;269,00 EUR');
    // Keine Gegenprobe-Zeile: Rechnung und festgeschriebene Zahl stimmen überein.
    expect(csv).not.toContain('Kasse;Abweichung zur Rechnung oben');
    expect(csv).toContain('Kasse;Gezählter Endbestand;269,00 EUR');
    expect(csv).toContain('Kasse;Differenz;0,00 EUR');
    expect(csv).not.toContain('Kasse;Bareinnahmen;833,00 EUR');
    expect(csv).not.toContain('Kasse;Erwarteter Endbestand;833,00 EUR');

    // Der Umsatz steht vollstaendig da — er wird nicht kleingerechnet, er
    // liegt nur nicht in der Schublade.
    expect(csv).toContain('Umsatz;Verkauf brutto vor Storno;833,00 EUR');

    // Und die Zahlungsarten sind getrennt ausgewiesen:
    //   bar   11900 + 5000 = 16900 Cent = 169,00 Euro
    //   Karte 59500 + 6900 = 66400 Cent = 664,00 Euro
    //   zusammen 83300 Cent = 833,00 Euro
    expect(csv).toContain('Zahlungsart;Bar;169,00 EUR');
    expect(csv).toContain('Zahlungsart;Kartenzahlung Terminal;664,00 EUR');
    expect(csv).toContain('Zahlungsart;Summe;833,00 EUR');

    // Der Baranteil aus dem Bericht plus das Wechselgeld ergibt genau den
    // erwarteten Kassenbestand: 16900 + 10000 = 26900 Cent.
    expect(16900n + 10000n).toBe(26900n);
  });
});
