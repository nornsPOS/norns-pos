/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Szenario Stripe Terminal — die neue Zahlart durch ALLE Exporte hindurch
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM ES DIESE ZAHLART GIBT (26.07.2026, Koordination §9) ──────────────
 * Kartenzahlung im Laden laeuft heute ueber ZVT und beruehrt Stripe nie — auf
 * diesem Weg verdient Norns KEINE Vermittlungsgebuehr. Der neue Weg (Stripe
 * Terminal, Leser S700, servergesteuert) steht NEBEN dem ZVT-Weg, ersetzt ihn
 * nicht, und darf den Wert `STRIPE` nicht mitbenutzen: der ist vom Web-Shop
 * belegt, und zwei Kanaele auf einem Enum-Wert waeren in jedem Export
 * ununterscheidbar.
 *
 * ── WARUM EIN EIGENES DURCHGANGSKONTO ──────────────────────────────────────
 * Das Geld fliesst zwar wie beim Web-Shop ueber Stripe, aber der Berater
 * stimmt je AKZEPTANZWEG gegen den Bankauszug ab: Terminal-Auszahlungen und
 * Shop-Auszahlungen sind getrennte Stroeme desselben Anbieters. Ein
 * gemeinsames Konto 1364 machte diese Abstimmung unmoeglich. Deshalb 1366
 * (SKR03) bzw. 1466 (SKR04) — die fortgefuehrte Reihe der frei
 * beschriftbaren Transitkonten 1361 ff. / 1461 ff.
 *
 * ── DIE ENTSCHEIDENDE ENTSCHEIDUNG DIESER DATEI ────────────────────────────
 * Alle Kontonummern und Betraege unten sind VON HAND geschrieben und werden
 * ABSICHTLICH NICHT aus `datev-kontierung.ts` oder `kontenrahmen.ts`
 * eingelesen. Eine importierte Tafel haette jeden Fehler mitimportiert.
 *
 * Gefahren wird gegen ein ECHTES Postgres im Behaelter, mit JEDER
 * Produktionswanderung, ueber die ECHTE Fastify-Anwendung mit der App-Rolle —
 * inklusive des echten `POST /api/transactions/finalize`, damit der TypeBox-
 * Riegel des Servers die neue Zahlart WIRKLICH annimmt und nicht nur die
 * Datenbank sie kennt.
 */

import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type ZahlungAngabe, baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

/** Der Geschaeftstag dieser Datei (Sommerzeit, wie die Geldweg-Datei). */
const TAG = '2026-05-04';

// ── Die Kontentafel, von Hand ──────────────────────────────────────────────

/** SKR03: die fortgefuehrte Reihe 1361 ff., naechste freie Nummer. */
const KONTO_TERMINAL_SKR03 = '1366';
/** SKR04: die Entsprechung in der Reihe 1461 ff. */
const KONTO_TERMINAL_SKR04 = '1466';
/** Der Web-Shop-Stripe — das Konto, das der Terminal-Weg NICHT beruehren darf. */
const KONTO_STRIPE_SHOP = '1364';
const KONTO_KASSE = '1000';
const KONTO_ZVT = '1361';
const KONTO_ERLOESE_19_SKR03 = '8400';
const KONTO_ERLOESE_19_SKR04 = '4400';

// ── Der DATEV-Satz, Feld fuer Feld nachgezaehlt (wie in szenario-geldweg) ──

const SPALTE = {
  UMSATZ: 0, // Feld 1
  SOLL_HABEN: 1, // Feld 2
  KONTO: 6, // Feld 7
  GEGENKONTO: 7, // Feld 8
  BU_SCHLUESSEL: 8, // Feld 9
  BELEGFELD_1: 10, // Feld 11 — traegt den receipt_locator
  BUCHUNGSTEXT: 13, // Feld 14
} as const;

interface Buchungszeile {
  umsatz: string;
  cents: bigint;
  sollHaben: string;
  konto: string;
  gegenkonto: string;
  buSchluessel: string;
  belegfeld1: string;
  buchungstext: string;
}

/** '119,00' → 11900n. Ganze Cent, niemals Fliesskomma. */
function centsAusDatev(betrag: string): bigint {
  const treffer = /^(\d+),(\d{2})$/.exec(betrag.trim());
  if (treffer === null) throw new Error(`Kein DATEV-Betrag: „${betrag}"`);
  return BigInt(treffer[1] ?? '0') * 100n + BigInt(treffer[2] ?? '0');
}

/** Die DATEV-Antwort in Buchungszeilen zerlegen (ANSI, deshalb latin1). */
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
      belegfeld1: f[SPALTE.BELEGFELD_1] ?? '',
      buchungstext: f[SPALTE.BUCHUNGSTEXT] ?? '',
    };
  });
}

// ── Ein minimaler ZIP-Leser fuer das DSFinV-K-Buendel (wie fiscal-export) ──

interface EntpackteDatei {
  name: string;
  content: string;
}

function liesZip(buf: Buffer): EntpackteDatei[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('liesZip: kein EOCD gefunden — kein ZIP');
  const gesamt = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const dateien: EntpackteDatei[] = [];
  for (let n = 0; n < gesamt; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error('liesZip: kaputtes Verzeichnis');
    const methode = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + nameLen);
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const datenStart = localOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.subarray(datenStart, datenStart + compSize);
    const roh = methode === 8 ? inflateRawSync(comp) : Buffer.from(comp);
    dateien.push({ name, content: roh.toString('utf8') });
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return dateien;
}

/** Semikolon-CSV in Zeilen zerlegen (DSFinV-K-Konvention). */
function liesCsv(text: string): string[][] {
  return text
    .split(/\r\n|\n/)
    .filter((z) => z.length > 0)
    .map((z) => z.split(';'));
}

/** Netto, Steuer, Brutto zu 19 Prozent aus ganzen Euro — im Kopf nachrechenbar. */
function betraege19(nettoEuro: number): {
  subtotal: string;
  vat: string;
  total: string;
  totalCents: bigint;
} {
  const netto = BigInt(nettoEuro) * 100n;
  const ust = (netto * 19n) / 100n;
  const brutto = netto + ust;
  const zuEuro = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
  return { subtotal: zuEuro(netto), vat: zuEuro(ust), total: zuEuro(brutto), totalCents: brutto };
}

describe('Szenario Stripe Terminal — die neue Zahlart durch alle Exporte', () => {
  const buehne = baueFiskalBuehne({ geschaeftstag: TAG });

  beforeAll(async () => {
    await buehne.starten();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
  });

  /** Ein Verkauf zu 19 Prozent auf dem Buehnentag, mit frei gewaehlten Beinen. */
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
   * Ein festgeschriebener Tagesabschluss — mit den ZWEI Pflichtangaben, die
   * die Buehne noch nicht kennt.
   *
   * ── WARUM DIESE FUNKTION HIER STEHT (04.08.2026) ──────────────────────────
   *
   * `buehne.legeAbschlussAn()` schreibt seit den Wanderungen 0124 und 0125
   * nicht mehr durch. Zwei Riegel an `daily_closings` verlangen bei FINALIZED:
   *
   *   • `z_nr`               die fortlaufende Nummer des Abschlusses. Sie ist
   *     eine FOLGE, kein Datum — deshalb `max(z_nr)+1` und nie der Kalendertag
   *     (ein Datum als Nummer verbarg zehn fehlende Abschlusstage).
   *   • `kassensturz_quelle` die Herkunft des Kassenbestands. 'EIGENER_STURZ'
   *     heisst: an diesem Tag wurde wirklich gezaehlt, und dann MUESSEN
   *     gezaehlter Betrag und Abweichung dastehen.
   *
   * Beide Riegel sind richtig und bleiben scharf. Die gemeinsame Buehne wird
   * hier bewusst NICHT angefasst — an ihr arbeiten andere gleichzeitig. Der
   * Bedarf ist gemeldet; faellt er dort nach, kann diese Funktion ersatzlos
   * wieder verschwinden.
   */
  async function legeFestenAbschlussAn(geschaeftstag: string): Promise<string> {
    // Der Anker ist der jeweilige Kopf der Beweiskette, genau wie in der Buehne.
    const [kopf] = await buehne.migratorSql<{ id: string; row_hash: Buffer }[]>`
      SELECT id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`;
    if (kopf === undefined) {
      throw new Error('legeFestenAbschlussAn: die Beweiskette ist leer, es gibt nichts zu verankern.');
    }

    const [naechste] = await buehne.migratorSql<{ z_nr: string }[]>`
      SELECT (COALESCE(MAX(z_nr), 0) + 1)::text AS z_nr FROM daily_closings`;

    const [zeile] = await buehne.migratorSql<{ id: string }[]>`
      INSERT INTO daily_closings (
        business_day, state, z_nr,
        verkauf_count, ankauf_count, storno_count,
        gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
        vat_by_treatment, payments_by_method,
        cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
        kassensturz_quelle,
        tse_finished_count, tse_pending_count, tse_failed_count,
        ledger_anchor_id, ledger_anchor_hash,
        counted_by_user_id, counted_at, finalized_by_user_id, finalized_at
      ) VALUES (
        ${geschaeftstag}::date, 'FINALIZED'::closing_state, ${naechste?.z_nr ?? '1'}::bigint,
        0, 0, 0,
        '0.00', '0.00', '0.00', '0.00',
        ${buehne.migratorSql.json({})}, ${buehne.migratorSql.json({})},
        '0.00', '0.00', '0.00',
        'EIGENER_STURZ'::kassensturz_quelle,
        0, 0, 0,
        ${kopf.id}, ${kopf.row_hash},
        ${buehne.akteure.inhaberId}, now(), ${buehne.akteure.inhaberId}, now()
      ) RETURNING id`;
    return zeile!.id;
  }

  /** Den Buehnentag abschliessen und den DATEV-Stapel ziehen. */
  async function holeStapel(rahmen?: string): Promise<LightMyRequestResponse> {
    const abschlussId = await legeFestenAbschlussAn(buehne.geschaeftstag);
    const anhang = rahmen === undefined ? '' : `?kontenrahmen=${encodeURIComponent(rahmen)}`;
    return buehne.hol(`/api/closings/${abschlussId}/export/datev${anhang}`);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. Der ECHTE finalize-Weg nimmt die neue Zahlart an
  // ────────────────────────────────────────────────────────────────────────

  it('nimmt STRIPE_TERMINAL ueber POST /api/transactions/finalize an und bucht den Tag auf 1366', async () => {
    // Der Kassentag von HEUTE, weil finalize selbst stempelt.
    const [heuteZeile] = await buehne.migratorSql<{ tag: string }[]>`
      SELECT berlin_business_day(now())::text AS tag`;
    const heute = heuteZeile?.tag ?? '';
    expect(heute).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Ein reserviertes Produkt, wie es die Kasse vor dem finalize hinterlaesst.
    const produktId = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    const sessionId = randomUUID();
    await buehne.migratorSql`
      UPDATE products
         SET status = 'RESERVED'::product_status,
             reserved_at = now(),
             reserved_by_session_id = ${sessionId},
             reserved_by_channel = 'POS'::reservation_channel,
             reserved_by_user_id = ${buehne.akteure.kassiererId}
       WHERE id = ${produktId}`;

    const res = await buehne.sende(
      '/api/transactions/finalize',
      {
        direction: 'VERKAUF',
        customerId: null,
        subtotalEur: '100.00',
        vatEur: '19.00',
        totalEur: '119.00',
        taxTreatmentCode: 'STANDARD_19',
        items: [
          {
            productId: produktId,
            reservationSessionId: sessionId,
            lineSubtotalEur: '100.00',
            lineVatEur: '19.00',
            lineTotalEur: '119.00',
            appliedTaxTreatmentCode: 'STANDARD_19',
            appliedVatRate: '0.1900',
            acquisitionCostEurSnapshot: null,
            marginEur: null,
          },
        ],
        payments: [{ paymentMethod: 'STRIPE_TERMINAL', amountEur: '119.00' }],
        idempotencyKey: randomUUID(),
      },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(200);

    // Das Zahlungsbein steht wirklich in der Datenbank — als STRIPE_TERMINAL.
    const [bein] = await buehne.migratorSql<{ method: string; amount: string }[]>`
      SELECT payment_method::text AS method, amount_eur::text AS amount
        FROM transaction_payments`;
    expect(bein?.method).toBe('STRIPE_TERMINAL');
    expect(bein?.amount).toBe('119.00');

    // Und der DATEV-Stapel des HEUTIGEN Tages bucht auf das Terminal-Konto.
    const abschlussId = await legeFestenAbschlussAn(heute);
    const stapel = await buehne.hol(`/api/closings/${abschlussId}/export/datev`);
    expect(stapel.statusCode).toBe(200);
    const zeilen = zerlege(stapel);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0]?.konto).toBe(KONTO_TERMINAL_SKR03);
    expect(zeilen[0]?.gegenkonto).toBe(KONTO_ERLOESE_19_SKR03);
    expect(zeilen[0]?.sollHaben).toBe('S');
    expect(zeilen[0]?.buSchluessel).toBe(''); // 19.08.2026: leer — Automatikkonto
    expect(zeilen[0]?.umsatz).toBe('119,00');
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Eigenes Konto in BEIDEN Rahmen, getrennt vom Web-Shop-Stripe
  // ────────────────────────────────────────────────────────────────────────

  it('bucht in SKR03 auf 1366 und in SKR04 auf 1466 — nie auf das Shop-Konto 1364/1464', async () => {
    // Zwei Belege: einer ueber den Leser, einer ueber den Web-Shop-Stripe.
    // Verschiedene Betraege, damit keine Zeile mit der anderen verwechselbar ist.
    const terminal = await legeVerkaufAn(100, [{ method: 'STRIPE_TERMINAL', amount: '119.00' }], 9);
    const shop = await legeVerkaufAn(200, [{ method: 'STRIPE', amount: '238.00' }], 10);

    // EIN Abschluss, ZWEI Abrufe — ein Tag hat genau einen Abschluss, der
    // Rahmen ist eine Eigenschaft des Abrufs, nicht des Tages.
    const abschlussId = await legeFestenAbschlussAn(buehne.geschaeftstag);
    const res03 = await buehne.hol(`/api/closings/${abschlussId}/export/datev`);
    expect(res03.statusCode).toBe(200);
    const zeilen03 = zerlege(res03);
    expect(zeilen03).toHaveLength(2);

    const terminal03 = zeilen03.find((z) => z.belegfeld1 === terminal.locator);
    const shop03 = zeilen03.find((z) => z.belegfeld1 === shop.locator);
    expect(terminal03?.konto).toBe(KONTO_TERMINAL_SKR03);
    expect(terminal03?.gegenkonto).toBe(KONTO_ERLOESE_19_SKR03);
    expect(terminal03?.umsatz).toBe('119,00');
    expect(shop03?.konto).toBe(KONTO_STRIPE_SHOP);
    // Getrennte Stroeme desselben Anbieters — sonst ist die Abstimmung
    // Terminal gegen Shop beim Bankauszug unmoeglich.
    expect(terminal03?.konto).not.toBe(shop03?.konto);

    // Derselbe Tag in SKR04: gleiche Betraege, andere Konten.
    const res04 = await buehne.hol(`/api/closings/${abschlussId}/export/datev?kontenrahmen=SKR04`);
    expect(res04.statusCode).toBe(200);
    const zeilen04 = zerlege(res04);
    expect(zeilen04).toHaveLength(2);
    const terminal04 = zeilen04.find((z) => z.belegfeld1 === terminal.locator);
    expect(terminal04?.konto).toBe(KONTO_TERMINAL_SKR04);
    expect(terminal04?.gegenkonto).toBe(KONTO_ERLOESE_19_SKR04);
    expect(terminal04?.umsatz).toBe('119,00');
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Geteilte Zahlung, auf den Cent
  // ────────────────────────────────────────────────────────────────────────

  it('teilt einen Beleg mit Bar, ZVT und Stripe Terminal auf drei Konten auf und geht auf den Cent auf', async () => {
    // 400 netto → 476,00 brutto = 47600 Cent.
    // Von Hand: 100,00 bar + 200,00 ZVT + 176,00 Terminal = 47600 Cent.
    const beleg = await legeVerkaufAn(
      400,
      [
        { method: 'CASH', amount: '100.00' },
        { method: 'ZVT_CARD', amount: '200.00' },
        { method: 'STRIPE_TERMINAL', amount: '176.00' },
      ],
      9,
    );
    expect(beleg.totalCents).toBe(47600n);

    const res = await holeStapel();
    expect(res.statusCode).toBe(200);
    const zeilen = zerlege(res);
    expect(zeilen).toHaveLength(3);
    for (const z of zeilen) expect(z.belegfeld1).toBe(beleg.locator);

    const nachKonto = new Map(zeilen.map((z) => [z.konto, z]));
    expect(nachKonto.get(KONTO_KASSE)?.umsatz).toBe('100,00');
    expect(nachKonto.get(KONTO_ZVT)?.umsatz).toBe('200,00');
    expect(nachKonto.get(KONTO_TERMINAL_SKR03)?.umsatz).toBe('176,00');

    const summe = zeilen.reduce((s, z) => s + z.cents, 0n);
    expect(summe).toBe(47600n);

    // Bei mehreren Zahlarten benennt der Buchungstext die Zahlart, sonst
    // muesste der Berater bei drei Zeilen desselben Belegs raten.
    expect(nachKonto.get(KONTO_TERMINAL_SKR03)?.buchungstext).toContain('Stripe Terminal');
    expect(nachKonto.get(KONTO_ZVT)?.buchungstext).toContain('Karte');
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. DSFinV-K: unbar mit eigener Bezeichnung, Bargeld bleibt Bar
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Die Spalten von `datapayment.csv`, gezaehlt am gemessenen Kopf.
   *
   * ── WARUM DIESE LISTE ANDERS AUSSIEHT ALS FRUEHER (04.08.2026) ───────────
   *
   * Bis heute erwartete diese Datei sechs Spalten mit `BETRAG` am Ende. Der
   * Erzeuger nimmt die Spaltenliste inzwischen aus der amtlichen `index.xml`
   * der DSFinV-K, und die kennt je Tabelle DREI Schluesselspalten
   * (Z_KASSE_ID, Z_ERSTELLUNG, Z_NR) und fuehrt den Betrag zweimal: in der
   * Zahlungswaehrung und in der Basiswaehrung.
   *
   * Die Erwartung wurde also nicht an die Ausgabe angepasst, sondern an die
   * NORM — die Ausgabe stimmt mit ihr ueberein, die alte Erwartung nicht.
   */
  const ZAHL_SPALTE = {
    BON_ID: 3,
    TYP: 4,
    NAME: 5,
    WAEHRUNG: 6,
    BETRAG: 7,
    BASIS_BETRAG: 8,
  } as const;

  it('fuehrt den Leser in datapayment.csv als elektronischen Zahlungsdienstleister mit eigener Bezeichnung, Bargeld bleibt Bar', async () => {
    const bar = await legeVerkaufAn(100, [{ method: 'CASH', amount: '119.00' }], 9);
    const terminal = await legeVerkaufAn(200, [{ method: 'STRIPE_TERMINAL', amount: '238.00' }], 10);

    const abschlussId = await legeFestenAbschlussAn(buehne.geschaeftstag);
    const res = await buehne.hol(`/api/closings/${abschlussId}/export/dsfinvk`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');

    const dateien = liesZip(res.rawPayload);
    const zahlarten = liesCsv(dateien.find((d) => d.name === 'datapayment.csv')?.content ?? '');
    expect(zahlarten[0]).toEqual([
      'Z_KASSE_ID',
      'Z_ERSTELLUNG',
      'Z_NR',
      'BON_ID',
      'ZAHLART_TYP',
      'ZAHLART_NAME',
      'ZAHLWAEH_CODE',
      'ZAHLWAEH_BETRAG',
      'BASISWAEH_BETRAG',
    ]);
    const daten = zahlarten.slice(1);
    expect(daten).toHaveLength(2);

    const terminalZeile = daten.find((z) => z[ZAHL_SPALTE.BON_ID] === terminal.locator);
    // ZAHLART_TYP kommt aus der geschlossenen Liste in Anhang D. Der Leser
    // laeuft ueber einen Zahlungsdienstleister, also traegt er genau diesen
    // Wert — und keinesfalls 'Bar'.
    expect(terminalZeile?.[ZAHL_SPALTE.TYP]).toBe('ElZahlungsdienstleister');
    expect(terminalZeile?.[ZAHL_SPALTE.NAME]).toBe('STRIPE_TERMINAL'); // eigene Bezeichnung, nicht 'STRIPE'
    expect(terminalZeile?.[ZAHL_SPALTE.WAEHRUNG]).toBe('EUR');
    expect(terminalZeile?.[ZAHL_SPALTE.BETRAG]).toBe('238,00');
    expect(terminalZeile?.[ZAHL_SPALTE.BASIS_BETRAG]).toBe('238,00');

    const barZeile = daten.find((z) => z[ZAHL_SPALTE.BON_ID] === bar.locator);
    expect(barZeile?.[ZAHL_SPALTE.TYP]).toBe('Bar');
    expect(barZeile?.[ZAHL_SPALTE.BETRAG]).toBe('119,00');

    // Der eigentliche Streitpunkt dieser Datei: der Leser faellt NICHT mit dem
    // Bargeld in denselben Topf. Sonst waere die Schublade beim Kassensturz um
    // den Leserumsatz zu hoch.
    expect(terminalZeile?.[ZAHL_SPALTE.TYP]).not.toBe(barZeile?.[ZAHL_SPALTE.TYP]);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Kassenbericht (Z-Bon): unbarer Weg, die drei Barzahlen unberuehrt
  // ────────────────────────────────────────────────────────────────────────

  it('weist den Leser im Kassenbericht als eigenen unbaren Weg aus und laesst die drei Barzahlen unberuehrt', async () => {
    // Der ECHTE Weg: Schicht oeffnen, Belege auf heute, Kassensturz,
    // Tagesabschluss — alles ueber HTTP, gerechnet von der Anwendung.
    const [heuteZeile] = await buehne.migratorSql<{ tag: string }[]>`
      SELECT berlin_business_day(now())::text AS tag`;
    const heute = heuteZeile?.tag ?? '';

    const schicht = await buehne.sende('/api/shifts/open', { openingFloatEur: '100.00' });
    expect(schicht.statusCode).toBe(200);
    const schichtId = (schicht.json() as { id: string }).id;

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
        /**
         * ⚠️ MIT Signatur, und das ist keine Bequemlichkeit.
         *
         * Seit dem 02.08.2026 verweigert `POST /api/closings/finalize` den Tag,
         * wenn ein Beleg ohne TSE-Signatur darin liegt — es sei denn, ein Mensch
         * bestaetigt die Luecke ausdruecklich, und dann steht sie unveraenderlich
         * in der Notiz des Abschlusses. Gemessen ohne Signaturen:
         *   409 „3 Belege dieses Tages tragen keine TSE-Signatur."
         *
         * Diese Pruefung misst den KASSENBERICHT eines normalen Tages, nicht den
         * Ausnahmefall. Ein normaler Tag hat signierte Belege. Deshalb bekommen
         * sie hier Signaturen — und nicht etwa die Bestaetigung gesetzt, die den
         * Riegel weich machen wuerde.
         */
        tse: true,
      });
    }
    // 119,00 bar; 595,00 Leser; 119,00 geteilt (50,00 bar + 69,00 Leser).
    await legeTagesbelegAn(100, [{ method: 'CASH', amount: '119.00' }]);
    await legeTagesbelegAn(500, [{ method: 'STRIPE_TERMINAL', amount: '595.00' }]);
    await legeTagesbelegAn(100, [
      { method: 'CASH', amount: '50.00' },
      { method: 'STRIPE_TERMINAL', amount: '69.00' },
    ]);
    await buehne.migratorSql`UPDATE transactions SET shift_id = ${schichtId}`;

    // Kassensturz von Hand: Wechselgeld 10000 + bar 11900 + bar 5000 = 26900
    // Cent. Die 66400 Cent Leserumsatz duerfen NICHT in der Schublade liegen.
    const sturz = await buehne.sende(`/api/shifts/${schichtId}/close`, {
      blindCountEur: '269.00',
    });
    expect(sturz.statusCode).toBe(200);
    const geschlossen = sturz.json() as { systemExpectedEur: string; varianceEur: string | null };
    expect(geschlossen.systemExpectedEur).toBe('269.00');
    expect(geschlossen.varianceEur).toBe('0.00');

    const abschluss = await buehne.sende('/api/closings/finalize', { businessDay: heute });
    expect(abschluss.statusCode).toBe(200);
    const zbon = abschluss.json() as { id: string; grossVerkaufEur: string; cashExpectedEur: string };
    // Tagesumsatz: 11900 + 59500 + 11900 = 83300 Cent.
    expect(zbon.grossVerkaufEur).toBe('833.00');
    // DIE DREI BARZAHLEN: der Leserumsatz liegt NICHT in der Schublade.
    expect(zbon.cashExpectedEur).toBe('269.00');

    const bericht = await buehne.hol(`/api/closings/${zbon.id}/export/kassenbericht`);
    expect(bericht.statusCode).toBe(200);
    const csv = bericht.body;

    // Der neue Weg erscheint unter den unbaren Wegen, deutsch beschriftet …
    expect(csv).toContain('Zahlungsart;Bar;169,00 EUR');
    expect(csv).toContain('Zahlungsart;Kartenzahlung Stripe Terminal;664,00 EUR');
    expect(csv).toContain('Zahlungsart;Summe;833,00 EUR');
    // … ohne Rohbezeichner und ohne die Notmarkierung fuer Unbekanntes.
    expect(csv).not.toContain('STRIPE_TERMINAL');
    expect(csv).not.toContain('unbekannter Schl');

    // ⚠️ Die alte Zusage (07.08.2026 ersetzt): „Kasse;Erwartet bar;269,00 EUR"
    // / „Kasse;Gezählt bar;269,00 EUR" / „Kasse;Differenz;0,00 EUR". Seit
    // `baueKassenrechnung` angeschlossen ist (`lib/kassenrechnung.ts`),
    // rechnet der Abschnitt „Kasse" den erwarteten Bestand selbst aus
    // Anfangsbestand + Bareinnahmen − Barankauf her, und `POST
    // /api/shifts/open` schreibt den Anfangsbestand (100,00) NIRGENDS als
    // `cash_movements`-Zeile (nur auf `shifts.opening_float_eur`) — ein
    // gemessener, echter Befund, kein Fehler dieses Tests. Die Rechnung
    // kommt deshalb auf 0 + 169,00 Bareinnahmen − 0 Barankauf = 169,00; die
    // beim Abschluss festgeschriebene Zahl (269,00, MIT Anfangsbestand)
    // steht daneben, und die Differenz (100,00) ist genau der fehlende
    // Anfangsbestand — der Leserumsatz liegt weiterhin NICHT darin.
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
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. Die Verweigerung bleibt scharf
  // ────────────────────────────────────────────────────────────────────────

  it('bricht den ganzen Stapel weiter ab, wenn NEBEN dem Leser eine unkontierte Zahlart liegt', async () => {
    // Ein kontierter Leser-Beleg macht eine unkontierte Zahlart nicht
    // exportierbar: EINE Zahlart ohne Konto verweigert die GANZE Datei, statt
    // still auf die Kasse zu buchen.
    //
    // ⚠️ 12.08.2026: hier stand der GUTSCHEIN. Der hat seit heute ein amtlich
    // geprueftes Konto (SKR03 1796 / SKR04 3786) und ist damit kein Beispiel
    // fuer „unkontiert" mehr — der Satz waere still gruen geworden, weil seine
    // Voraussetzung weggefallen ist, nicht weil der Riegel noch haelt.
    // Gemessen wird jetzt das KUNDENKONTO, das weiterhin keines hat.
    await legeVerkaufAn(100, [{ method: 'STRIPE_TERMINAL', amount: '119.00' }], 9);
    // ⚠️ Das Kundenkonto verlangt einen Kunden an der Zeile (Pruefbedingung
    // `transaction_payments_debt_requires_customer`), deshalb hier von Hand
    // statt ueber den Helfer, der bewusst ohne Kunden anlegt.
    const b = betraege19(200);
    const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: b.subtotal,
      vat: b.vat,
      total: b.total,
      customerId: buehne.akteure.kundeId,
      finalizedAt: buehne.ts(10),
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
      payments: [{ method: 'DEBT', amount: b.total }],
    });

    const res = await holeStapel();
    expect(res.statusCode).toBe(409);
    const koerper = res.json() as { error: { code: string; message: string } };
    expect(koerper.error.code).toBe('CONFLICT');
    expect(koerper.error.message).toContain('Kundenkonto');
    expect(koerper.error.message).toContain('KEINE DATEV-Datei');
    expect(res.headers['content-disposition']).toBeUndefined();
  });
});
