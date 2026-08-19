/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Szenario Steuerarten — § 25a, § 25c und der gemischte Beleg
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Gebrauchtes Gold heisst Differenzbesteuerung. Das ist der Kern dieses
 * Ladens, und es ist genau die Stelle, an der ein Steuerexport am leisesten
 * falsch sein kann: die Datei sieht vollstaendig aus, die Summen gehen auf,
 * und trotzdem steht die Steuer auf der falschen Bemessungsgrundlage.
 *
 * Gefahren wird gegen ein ECHTES Postgres im Behaelter, mit JEDER
 * Produktionswanderung, ueber die ECHTE Fastify-Anwendung. Keine Attrappe
 * rechnet hier irgendetwas.
 *
 * ── WAS HIER BEWUSST NICHT GESCHIEHT ───────────────────────────────────────
 * Der Tagesabschluss wird NICHT von Hand gefuellt. Er entsteht ueber den
 * echten Weg `POST /api/closings/finalize`, der `vat_by_treatment` aus den
 * Belegpositionen SELBST zusammenrechnet. Haette der Test die Steuerzahlen
 * eingetragen und danach wieder ausgelesen, waere jede Zusicherung ein
 * Selbstgespraech.
 *
 * ── DIE RECHENREGEL, gegen die hier von Hand geprueft wird ─────────────────
 *   § 25a  Marge = Verkaufspreis - Einkaufspreis, NIE kleiner als null.
 *          Steuer = Marge x 19 / 119, kaufmaennisch auf ganze Cent.
 *   § 25c  Anlagegold ist steuerfrei. Steuer = 0.
 *   19 %   Steuer = Brutto x 19 / 119.
 *    7 %   Steuer = Brutto x  7 / 107.
 * Keine der Zahlen unten liegt genau auf einer halben Einheit, deshalb
 * unterscheiden sich kaufmaennisches Runden und Bankrundung hier nirgends.
 *
 * ── DIE ZWEI FUNDE SIND BEHOBEN, DIE PRUEFUNGEN UMGESTELLT (04.08.2026) ────
 * Zwei Pruefungen hiessen frueher `FUND:` und hielten fest, was das System
 * damals TAT: der Ankaufspreis stand in keiner Steuerdatei, und § 13b fiel
 * still auf das 19-Prozent-Konto. Beides ist behoben — der § 25a-Verkauf
 * zerfaellt seit dem 27.07.2026 in Einkaufsanteil und Marge, § 13b hat seit
 * dem 26.07.2026 sein eigenes Konto 8337. Beide Pruefungen sind deshalb auf
 * die RICHTIGE Erwartung umgestellt und nicht weggeworfen; jede traegt in
 * ihrem Kopf, was vorher dort stand und warum.
 *
 * ⚠️ Diese Mappe lief monatelang NIRGENDS (`pnpm test` schliesst sie aus).
 * Deshalb standen hier Erwartungen, die den behobenen Fehler weiter
 * verlangten. Ein Test, der einen Fehler als Sollzustand festschreibt, ist
 * schlimmer als ein roter Test.
 */

import { inflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

// ── Der Geschaeftstag dieser Datei ─────────────────────────────────────────
//    Ein Montag in der Sommerzeit; `buehne.ts()` bestimmt den Zonenversatz
//    selbst, die Angabe hier legt nur den Tag fest.
const TAG = '2026-06-15';

// ── Spaltennummern der DATEV-Buchungszeile (0-basiert im zerlegten Array) ──
//    Aus `datev-spalten.generiert.ts`, das DATEVs eigene Musterdatei
//    abschreibt: 1 Umsatz, 2 Soll/Haben, 7 Konto, 8 Gegenkonto,
//    9 BU-Schluessel, 11 Belegfeld 1, 14 Buchungstext.
const SP_UMSATZ = 0;
const SP_SOLL_HABEN = 1;
const SP_KONTO = 6;
const SP_GEGENKONTO = 7;
const SP_BU = 8;
const SP_BELEGFELD1 = 10;
const SP_BUCHUNGSTEXT = 13;

interface Buchungszeile {
  umsatz: string;
  sollHaben: string;
  konto: string;
  gegenkonto: string;
  bu: string;
  belegfeld1: string;
  buchungstext: string;
}

/** "1234.50" bzw. "1.234,50" → 123450n. Nur fuer Summenproben im Test. */
function zuCents(betrag: string): bigint {
  const t = betrag.trim().replace(',', '.');
  const neg = t.startsWith('-');
  const [ganz = '0', bruch = ''] = (neg ? t.slice(1) : t).split('.');
  const wert = BigInt(ganz || '0') * 100n + BigInt(`${bruch}00`.slice(0, 2));
  return neg ? -wert : wert;
}

// ── Ein sehr kleiner ZIP-Leser (Zentralverzeichnis, STORE + DEFLATE) ───────
//    Der Erzeuger (`dsfinvk-export.ts`) schreibt ein bestimmtes ZIP; hier
//    wird es wirklich ausgepackt, statt nur "sieht aus wie ein ZIP" zu
//    pruefen.
function packeAus(puffer: Buffer): Map<string, string> {
  let eocd = -1;
  for (let i = puffer.length - 22; i >= 0; i--) {
    if (puffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('packeAus: kein Ende-Satz gefunden — kein ZIP');

  const anzahl = puffer.readUInt16LE(eocd + 10);
  let zv = puffer.readUInt32LE(eocd + 16);
  const dateien = new Map<string, string>();
  for (let n = 0; n < anzahl; n++) {
    if (puffer.readUInt32LE(zv) !== 0x02014b50) {
      throw new Error('packeAus: falsche Kennung im Zentralverzeichnis');
    }
    const verfahren = puffer.readUInt16LE(zv + 10);
    const komprimiert = puffer.readUInt32LE(zv + 20);
    const namensLaenge = puffer.readUInt16LE(zv + 28);
    const extraLaenge = puffer.readUInt16LE(zv + 30);
    const kommentarLaenge = puffer.readUInt16LE(zv + 32);
    const lokal = puffer.readUInt32LE(zv + 42);
    const name = puffer.toString('utf8', zv + 46, zv + 46 + namensLaenge);

    const lNamensLaenge = puffer.readUInt16LE(lokal + 26);
    const lExtraLaenge = puffer.readUInt16LE(lokal + 28);
    const start = lokal + 30 + lNamensLaenge + lExtraLaenge;
    const roh = puffer.subarray(start, start + komprimiert);
    const inhalt = verfahren === 8 ? inflateRawSync(roh) : Buffer.from(roh);
    dateien.set(name, inhalt.toString('utf8'));

    zv += 46 + namensLaenge + extraLaenge + kommentarLaenge;
  }
  return dateien;
}

/** Eine DSFinV-K-Datei (Semikolon, CRLF) in Zeilen und Felder zerlegen. */
function zerlege(inhalt: string): string[][] {
  return inhalt
    .split(/\r\n|\n/)
    .filter((z) => z.length > 0)
    .map((z) => z.split(';').map((f) => f.replace(/^"|"$/g, '')));
}

/**
 * Eine DSFinV-K-Datei nach SPALTENNAMEN lesen.
 *
 * ⚠️ NICHT nach Spaltennummer. Bis zum 28.07.2026 las diese Datei feste
 * Positionen in frei erfundenen Dateien (`bon_pos_ust.csv` und Geschwister),
 * die die Norm gar nicht kennt. Die amtliche `index.xml` bestimmt Dateinamen,
 * Spalten UND ihre Reihenfolge; wer nach Namen liest, faellt bei einer neuen
 * Spalte nicht auf die falsche Zahl herein.
 */
function tabelle(buendel: Map<string, string>, datei: string): Record<string, string>[] {
  const inhalt = buendel.get(datei);
  if (inhalt === undefined) {
    throw new Error(
      `Die Datei ${datei} liegt nicht im Buendel. Enthalten sind: ${[...buendel.keys()].join(', ')}`,
    );
  }
  const zeilen = zerlege(inhalt);
  const kopf = zeilen[0] ?? [];
  return zeilen.slice(1).map((z) => {
    const satz: Record<string, string> = {};
    for (const [i, name] of kopf.entries()) satz[name] = z[i] ?? '';
    return satz;
  });
}

describe('Szenario Steuerarten — § 25a, § 25c und der gemischte Beleg', () => {
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

  // ── Handreichungen dieser Datei ─────────────────────────────────────────

  /**
   * Eine GESCHLOSSENE Schicht fuer den Tag.
   *
   * Ohne sie verweigert `POST /api/closings/finalize` einen Tag mit Belegen
   * (409): eine Kasse ohne Kassensturz hat keinen bekannten Bestand, und ein
   * Abschluss wuerde eine Null hineinschreiben, die niemand gezaehlt hat.
   */
  async function schliesseSchicht(barErwartet: string, barGezaehlt: string): Promise<void> {
    const wer = buehne.akteure;
    await buehne.migratorSql`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status,
                          blind_count_eur, system_expected_eur, closed_by_user_id,
                          opened_at, closed_at)
      VALUES (${wer.geraetId}, ${wer.inhaberId}, '0.00', 'CLOSED'::shift_status,
              ${barGezaehlt}, ${barErwartet}, ${wer.inhaberId},
              ${buehne.ts(8, 0)}::timestamptz, ${buehne.ts(20, 0)}::timestamptz)`;
  }

  interface AbschlussAntwort {
    id: string;
    businessDay: string;
    state: string;
    verkaufCount: number;
    grossVerkaufEur: string;
    netVerkaufEur: string;
  }

  /** Den Tag ueber den ECHTEN Weg abschliessen. Er rechnet selbst. */
  async function schliesseTagAb(): Promise<AbschlussAntwort> {
    const res = await buehne.sende('/api/closings/finalize', { businessDay: TAG });
    expect(res.statusCode).toBe(200);
    return res.json() as AbschlussAntwort;
  }

  /** Die vom Abschluss SELBST gerechnete Umsatzsteuer je Behandlung. */
  async function holeUstJeBehandlung(abschlussId: string): Promise<Record<string, string>> {
    const zeilen = await buehne.sql<{ vat_by_treatment: Record<string, string> }[]>`
      SELECT vat_by_treatment FROM daily_closings WHERE id = ${abschlussId}`;
    return zeilen[0]?.vat_by_treatment ?? {};
  }

  /** Die DATEV-Datei holen und in Buchungszeilen zerlegen. */
  async function holeBuchungen(abschlussId: string): Promise<Buchungszeile[]> {
    const res = await buehne.hol(`/api/closings/${abschlussId}/export/datev`);
    expect(res.statusCode).toBe(200);
    // Die Datei ist ANSI (Windows-1252) — deshalb die ROHEN Bytes lesen.
    const text = Buffer.from(res.rawPayload).toString('latin1');
    const zeilen = text.split('\r\n').filter((z) => z.length > 0);
    // Zeile 1 ist der Kopf, Zeile 2 die Spaltenzeile, ab Zeile 3 die Buchungen.
    return zeilen.slice(2).map((z) => {
      const f = z.split(';').map((c) => c.replace(/^"|"$/g, ''));
      return {
        umsatz: f[SP_UMSATZ] ?? '',
        sollHaben: f[SP_SOLL_HABEN] ?? '',
        konto: f[SP_KONTO] ?? '',
        gegenkonto: f[SP_GEGENKONTO] ?? '',
        bu: f[SP_BU] ?? '',
        belegfeld1: f[SP_BELEGFELD1] ?? '',
        buchungstext: f[SP_BUCHUNGSTEXT] ?? '',
      };
    });
  }

  /** Die rohe DATEV-Datei als Text (fuer Suchproben). */
  /** Das DSFinV-K-Buendel holen und auspacken. */
  async function holeDsfinvk(abschlussId: string): Promise<Map<string, string>> {
    const res = await buehne.hol(`/api/closings/${abschlussId}/export/dsfinvk`);
    expect(res.statusCode).toBe(200);
    return packeAus(Buffer.from(res.rawPayload));
  }

  /**
   * Den Umsatzsteuerschluessel holen, den der Steuerberater hinterlegt hat.
   *
   * ⚠️ GELESEN, nicht abgeschrieben. Die DSFinV-K reserviert die Schluessel
   * unter 1000 fuer sich; welche Nummer § 25a und § 13b bekommen, entscheidet
   * die Kanzlei, und die Datei MUSS genau diese Nummer tragen. Eine im Test
   * festgeschriebene Zahl pruefte nur den Test.
   */
  async function ustSchluessel(einstellung: string): Promise<string> {
    const zeilen = await buehne.sql<{ wert: string | null }[]>`
      SELECT (value #>> '{}') AS wert FROM system_settings WHERE key = ${einstellung}`;
    const wert = zeilen[0]?.wert;
    if (wert === undefined || wert === null || wert === '') {
      throw new Error(`Die Einstellung ${einstellung} ist nicht gesetzt.`);
    }
    return wert;
  }

  /** Den Kassenbericht als Text holen. */
  async function holeKassenbericht(abschlussId: string): Promise<string> {
    const res = await buehne.hol(`/api/closings/${abschlussId}/export/kassenbericht`);
    expect(res.statusCode).toBe(200);
    return res.payload;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  § 25a — die Steuer haengt an der Marge, nicht am Umsatz
  // ══════════════════════════════════════════════════════════════════════

  it('Die Steuer nach § 25a bemisst sich an der Marge, nicht am Umsatz', async () => {
    // Beleg 1 — Goldring: Einkauf 600,00, Verkauf 1.000,00.
    //   Marge  = 100000 - 60000 = 40000 Cent
    //   Steuer = 40000 x 19 / 119 = 760.000 / 119 = 6386,55 → 6387 Cent
    //            (119 x 6386 = 759.934, Rest 66; 2 x 66 = 132 > 119 → aufwaerts)
    //   Netto  = 100000 - 6387 = 93613 Cent
    const ring = await buehne.legeProduktAn({
      name: 'Goldring gebraucht',
      behandlung: 'MARGIN_25A',
      einkaufspreis: '600.00',
      listenpreis: '1000.00',
    });
    const belegRing = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '936.13',
      vat: '63.87',
      total: '1000.00',
      customerId: null,
      finalizedAt: buehne.ts(9, 30),
      items: [
        {
          productId: ring,
          treatment: 'MARGIN_25A',
          vatRate: null, // § 25a kennt keinen Satz auf den Umsatz
          lineSubtotal: '936.13',
          lineVat: '63.87',
          lineTotal: '1000.00',
          acquisition: '600.00',
          margin: '400.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '1000.00' },
      tse: true,
    });

    // Beleg 2 — Silberkette: Einkauf 300,00, Verkauf 480,00.
    //   Marge  = 48000 - 30000 = 18000 Cent
    //   Steuer = 18000 x 19 / 119 = 342.000 / 119 = 2873,95 → 2874 Cent
    //            (119 x 2873 = 341.887, Rest 113; 2 x 113 = 226 > 119 → aufwaerts)
    //   Netto  = 48000 - 2874 = 45126 Cent
    const kette = await buehne.legeProduktAn({
      name: 'Silberkette gebraucht',
      behandlung: 'MARGIN_25A',
      einkaufspreis: '300.00',
      listenpreis: '480.00',
    });
    await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '451.26',
      vat: '28.74',
      total: '480.00',
      customerId: null,
      finalizedAt: buehne.ts(11, 0),
      items: [
        {
          productId: kette,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '451.26',
          lineVat: '28.74',
          lineTotal: '480.00',
          acquisition: '300.00',
          margin: '180.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '480.00' },
      tse: true,
    });

    // Bar vereinnahmt: 100000 + 48000 = 148000 Cent.
    await schliesseSchicht('1480.00', '1480.00');
    const abschluss = await schliesseTagAb();

    // Der Abschluss rechnet selbst: 100000 + 48000 = 148000 Cent brutto,
    // 93613 + 45126 = 138739 Cent netto.
    expect(abschluss.verkaufCount).toBe(2);
    expect(abschluss.grossVerkaufEur).toBe('1480.00');
    expect(abschluss.netVerkaufEur).toBe('1387.39');

    // DIE Zahl, um die es geht: 6387 + 2874 = 9261 Cent.
    const ust = await holeUstJeBehandlung(abschluss.id);
    expect(ust.MARGIN_25A).toBe('92.61');

    // Die Gegenprobe. Waere die Steuer faelschlich am UMSATZ bemessen:
    //   148000 x 19 / 119 = 2.812.000 / 119 = 23630,25 → 23630 Cent.
    // Der Unterschied ist 23630 - 9261 = 14369 Cent, also 143,69 EUR an
    // einem einzigen Tag mit zwei Belegen.
    expect(ust.MARGIN_25A).not.toBe('236.30');

    // Der Kassenbericht nennt die Behandlung beim juristischen Namen und
    // traegt dieselbe Zahl.
    const bericht = await holeKassenbericht(abschluss.id);
    expect(bericht).toContain('Differenzbesteuerung § 25a UStG');
    expect(bericht).toContain('92,61 EUR');
    expect(bericht).not.toContain('236,30 EUR');

    // DSFinV-K: die Position traegt den Schluessel des Steuerberaters fuer die
    // Differenzbesteuerung, und die Positionssteuer ist die MARGENSTEUER.
    const buendel = await holeDsfinvk(abschluss.id);
    const schluessel25a = await ustSchluessel('dsfinvk.ust_schluessel.margin_25a');
    const posUst = tabelle(buendel, 'lines_vat.csv');
    const zeileRing = posUst.find((z) => z.BON_ID === belegRing.locator);
    expect(zeileRing?.UST_SCHLUESSEL).toBe(schluessel25a);
    // Die Norm schreibt deutsche Dezimalzahlen mit fuenf Nachkommastellen
    // ('1000,00000'); verglichen wird deshalb der WERT, nicht die Schreibweise.
    expect(zuCents(zeileRing?.POS_BRUTTO ?? '')).toBe(100000n);
    expect(zuCents(zeileRing?.POS_NETTO ?? '')).toBe(93613n);
    expect(zuCents(zeileRing?.POS_UST ?? '')).toBe(6387n);

    // ── DATEV: JEDER § 25a-Verkauf zerfaellt in ZWEI Zeilen ───────────────
    //
    // ⚠️ Hier stand bis heute: beide Belege auf EIN Konto (8200), ohne
    // Buchungsschluessel. Genau so hat der Export es bis zum 27.07.2026
    // getan, und genau so fehlten auf der Produktion 5.393,19 EUR
    // Umsatzsteuer in JEDER Buchungszeile — der Berater sah einen durchweg
    // steuerfreien Erloes.
    //
    // Richtig ist: der Einkaufsanteil geht ohne Steuer auf 8193, die Marge
    // mit 19 Prozent (Schluessel 3) auf 8191.
    //   Ring   Einkauf 60000, Marge 40000 Cent
    //   Kette  Einkauf 30000, Marge 18000 Cent
    const buchungen = await holeBuchungen(abschluss.id);
    expect(buchungen).toHaveLength(4);
    for (const b of buchungen) {
      expect(b.konto).toBe('1000'); // bar vereinnahmt
      expect(b.sollHaben).toBe('S');
    }

    const einkaufsanteile = buchungen.filter((b) => b.gegenkonto === '8193');
    const margen = buchungen.filter((b) => b.gegenkonto === '8191');
    expect(einkaufsanteile).toHaveLength(2);
    expect(margen).toHaveLength(2);
    for (const b of einkaufsanteile) expect(b.bu).toBe('');
    // 19.08.2026: Feld 9 leer — Automatikkonto rechnet die Steuer selbst (SKR03-Marke AM; DATEV-Musterdatei bucht 8400 nie mit BU 3).
    for (const b of margen) expect(b.bu).toBe('');

    expect(einkaufsanteile.map((b) => zuCents(b.umsatz)).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      30000n,
      60000n,
    ]);
    expect(margen.map((b) => zuCents(b.umsatz)).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      18000n,
      40000n,
    ]);

    // Und die vier Zeilen ergeben zusammen genau die beiden Belegbetraege:
    // 60000 + 40000 + 30000 + 18000 = 148000 Cent.
    expect(buchungen.reduce((sum, b) => sum + zuCents(b.umsatz), 0n)).toBe(148000n);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Marge null und NEGATIVE Marge — die Steuer darf nicht unter null
  // ══════════════════════════════════════════════════════════════════════

  it('Marge null und Verlustverkauf ergeben Steuer null, niemals eine negative Steuer', async () => {
    // Beleg 1 — zum Einstandspreis verkauft: 500,00 gekauft, 500,00 verkauft.
    //   Marge = 50000 - 50000 = 0 → Steuer 0 Cent, Netto 50000 Cent.
    const zumEinstand = await buehne.legeProduktAn({
      name: 'Muenze zum Einstand',
      behandlung: 'MARGIN_25A',
      einkaufspreis: '500.00',
      listenpreis: '500.00',
    });
    const belegNull = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '500.00',
      vat: '0.00',
      total: '500.00',
      customerId: null,
      finalizedAt: buehne.ts(10, 0),
      items: [
        {
          productId: zumEinstand,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '500.00',
          lineVat: '0.00',
          lineTotal: '500.00',
          acquisition: '500.00',
          margin: '0.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '500.00' },
      tse: true,
    });

    // Beleg 2 — UNTER Einstand verkauft: 700,00 gekauft, 400,00 verkauft.
    //   Rohe Marge = 40000 - 70000 = -30000 Cent.
    //   Die Marge wird bei null gekappt (der Laden hat verloren; das
    //   Finanzamt zahlt keine Umsatzsteuer zurueck), also Steuer 0 Cent.
    //   OHNE die Kappung waere es -30000 x 19 / 119 = -570.000 / 119
    //   = -4789,92 → -4790 Cent, also -47,90 EUR. Genau diese Zahl darf
    //   nirgends erscheinen.
    const unterEinstand = await buehne.legeProduktAn({
      name: 'Ring unter Einstand',
      behandlung: 'MARGIN_25A',
      einkaufspreis: '700.00',
      listenpreis: '400.00',
    });
    const belegVerlust = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '400.00',
      vat: '0.00',
      total: '400.00',
      customerId: null,
      finalizedAt: buehne.ts(12, 0),
      items: [
        {
          productId: unterEinstand,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '400.00',
          lineVat: '0.00',
          lineTotal: '400.00',
          acquisition: '700.00',
          margin: '0.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '400.00' },
      tse: true,
    });

    await schliesseSchicht('900.00', '900.00');
    const abschluss = await schliesseTagAb();

    // 50000 + 40000 = 90000 Cent brutto, und weil keine Steuer anfaellt,
    // ist der Nettobetrag derselbe.
    expect(abschluss.grossVerkaufEur).toBe('900.00');
    expect(abschluss.netVerkaufEur).toBe('900.00');

    const ust = await holeUstJeBehandlung(abschluss.id);
    expect(ust.MARGIN_25A).toBe('0.00');
    expect(zuCents(ust.MARGIN_25A ?? '0.00') >= 0n).toBe(true);

    // Der Kassenbericht darf keine Steuerzahl mit Minuszeichen tragen.
    const bericht = await holeKassenbericht(abschluss.id);
    expect(bericht).toContain('Differenzbesteuerung § 25a UStG');
    expect(bericht).toContain('0,00 EUR');
    expect(bericht).not.toContain('-47,90');

    // DSFinV-K: beide Positionen mit Steuer 0,00 und ohne Minuszeichen.
    const buendel = await holeDsfinvk(abschluss.id);
    const posUst = tabelle(buendel, 'lines_vat.csv');
    for (const locator of [belegNull.locator, belegVerlust.locator]) {
      const zeile = posUst.find((z) => z.BON_ID === locator);
      expect(zuCents(zeile?.POS_UST ?? '')).toBe(0n);
    }
    // Kein Minuszeichen in einer GELDSPALTE. Auf den ganzen Dateitext zu
    // pruefen waere untauglich: Geschaeftstag (2026-06-15) und Belegnummer
    // (RCP-2026-000003) tragen selbst Bindestriche.
    const bonUst = tabelle(buendel, 'transactions_vat.csv');
    expect(bonUst).toHaveLength(2); // je Beleg eine Zeile
    for (const z of bonUst) {
      for (const spalte of ['BON_BRUTTO', 'BON_NETTO', 'BON_UST']) {
        expect(z[spalte]?.startsWith('-')).toBe(false);
      }
      expect(zuCents(z.BON_UST ?? '')).toBe(0n);
    }
    expect(buendel.get('transactions_vat.csv') ?? '').not.toContain('47,90');

    // DATEV: zwei positive Umsaetze auf der Sollseite, kein Vorzeichen.
    //
    // Beide Belege tragen NUR einen Einkaufsanteil und KEINE Marge: einmal
    // zum Einstand (500 gegen 500), einmal darunter (400 gegen 700). Der
    // Anteil ist gedeckelt auf den Belegbetrag, sonst stuende im Verlustfall
    // ein erfundener Erloes von 700,00 in der Datei. Eine Margenzeile
    // entsteht nicht, weil eine Zeile ueber null Cent nichts aussagt.
    const buchungen = await holeBuchungen(abschluss.id);
    expect(buchungen).toHaveLength(2);
    expect(buchungen.map((b) => zuCents(b.umsatz)).sort((a, b) => (a < b ? -1 : 1))).toEqual([
      40000n,
      50000n,
    ]);
    for (const b of buchungen) {
      expect(b.sollHaben).toBe('S');
      expect(b.umsatz.startsWith('-')).toBe(false);
      expect(b.gegenkonto).toBe('8193');
      expect(b.bu).toBe('');
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  § 25c Anlagegold — steuerfrei, Konto 8150, KEIN Buchungsschluessel
  // ══════════════════════════════════════════════════════════════════════

  it('Anlagegold nach § 25c bleibt steuerfrei und bucht auf 8150 ohne Buchungsschluessel', async () => {
    // Ein 50-g-Barren fuer 1.800,00. Anlagegold ist steuerbefreit:
    //   Steuer = 0 Cent, Netto = Brutto = 180000 Cent.
    // 1.800,00 liegt unter der GwG-Schwelle von 2.000,00, deshalb ohne Kunde.
    const barren = await buehne.legeProduktAn({
      name: 'Goldbarren 50 g',
      behandlung: 'INVESTMENT_GOLD_25C',
      einkaufspreis: '1500.00',
      listenpreis: '1800.00',
    });
    const beleg = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'INVESTMENT_GOLD_25C',
      subtotal: '1800.00',
      vat: '0.00',
      total: '1800.00',
      customerId: null,
      finalizedAt: buehne.ts(14, 0),
      items: [
        {
          productId: barren,
          treatment: 'INVESTMENT_GOLD_25C',
          vatRate: null,
          lineSubtotal: '1800.00',
          lineVat: '0.00',
          lineTotal: '1800.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '1800.00' },
      tse: true,
    });

    await schliesseSchicht('1800.00', '1800.00');
    const abschluss = await schliesseTagAb();

    expect(abschluss.grossVerkaufEur).toBe('1800.00');
    expect(abschluss.netVerkaufEur).toBe('1800.00');

    const ust = await holeUstJeBehandlung(abschluss.id);
    expect(ust.INVESTMENT_GOLD_25C).toBe('0.00');

    // DATEV: Kasse an 8150 (steuerfreie Erloese § 25c), Feld 9 LEER.
    // Ein Buchungsschluessel waere hier falsch: das Konto traegt die
    // Steuerbefreiung, ein Schluessel wuerde einen Satz behaupten.
    const buchungen = await holeBuchungen(abschluss.id);
    expect(buchungen).toHaveLength(1);
    expect(buchungen[0]?.konto).toBe('1000');
    // 19.08.2026: 8150 → 8165 (§ 25c ist keine § 4-Befreiung; DATEV Dok.-Nr. 5361613).
    expect(buchungen[0]?.gegenkonto).toBe('8165');
    expect(buchungen[0]?.bu).toBe('');
    expect(buchungen[0]?.umsatz).toBe('1800,00');
    expect(buchungen[0]?.belegfeld1).toBe(beleg.locator);

    // ── DSFinV-K: Schluessel 6, NICHT 5 ──────────────────────────────────
    //
    // Anlage 2 zur DSFinV-K trennt beides:
    //     5  0,00 %  Nicht Steuerbar
    //     6  0,00 %  Umsatzsteuerfrei
    // § 25c Abs. 1 UStG sagt „steuerfrei", also steuerbar UND befreit — das
    // ist die 6. Die 5 stammt aus dem Steuercontainer der Signatur
    // (Kassenbeleg-V1), einem ANDEREN Feld derselben Anlage. Hier stand bis
    // heute die 5, und damit haette das Prueferpaket Anlagegold als „nicht
    // steuerbar" gemeldet. Der Schluessel steht in der Norm selbst und nicht
    // in einer Einstellung, deshalb hier als Zahl.
    const buendel = await holeDsfinvk(abschluss.id);
    const posUst = tabelle(buendel, 'lines_vat.csv');
    const zeile = posUst.find((z) => z.BON_ID === beleg.locator);
    expect(zeile?.UST_SCHLUESSEL).toBe('6');
    expect(zeile?.UST_SCHLUESSEL).not.toBe('5');
    expect(zuCents(zeile?.POS_UST ?? '')).toBe(0n);

    // Der Kassenbericht nennt die Befreiung ausdruecklich.
    const bericht = await holeKassenbericht(abschluss.id);
    expect(bericht).toContain('Anlagegold, steuerfrei § 25c UStG');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  19 % auf 8400 mit Schluessel 3, 7 % auf 8300 mit Schluessel 2
  // ══════════════════════════════════════════════════════════════════════

  it('Der Regelsatz bucht auf 8400 mit Schluessel 3, der ermaessigte auf 8300 mit Schluessel 2', async () => {
    // Beleg 1 — Regelsatz, 119,00 brutto, bar.
    //   Steuer = 11900 x 19 / 119 = 226.100 / 119 = 1900 Cent, GENAU.
    //   Netto  = 11900 - 1900 = 10000 Cent.
    const neuware = await buehne.legeProduktAn({
      name: 'Etui neu',
      behandlung: 'STANDARD_19',
      einkaufspreis: '40.00',
      listenpreis: '119.00',
    });
    const beleg19 = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '100.00',
      vat: '19.00',
      total: '119.00',
      customerId: null,
      finalizedAt: buehne.ts(9, 0),
      items: [
        {
          productId: neuware,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '119.00' },
      tse: true,
    });

    // Beleg 2 — ermaessigter Satz, 107,00 brutto, mit Karte.
    //   Steuer = 10700 x 7 / 107 = 74.900 / 107 = 700 Cent, GENAU.
    //   Netto  = 10700 - 700 = 10000 Cent.
    const katalog = await buehne.legeProduktAn({
      name: 'Muenzkatalog Buch',
      behandlung: 'REDUCED_7',
      einkaufspreis: '30.00',
      listenpreis: '107.00',
    });
    const beleg7 = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'REDUCED_7',
      subtotal: '100.00',
      vat: '7.00',
      total: '107.00',
      customerId: null,
      finalizedAt: buehne.ts(10, 0),
      items: [
        {
          productId: katalog,
          treatment: 'REDUCED_7',
          vatRate: '0.0700',
          lineSubtotal: '100.00',
          lineVat: '7.00',
          lineTotal: '107.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'ZVT_CARD', amount: '107.00' },
      tse: true,
    });

    // Nur der erste Beleg war bar: 11900 Cent in der Schublade.
    await schliesseSchicht('119.00', '119.00');
    const abschluss = await schliesseTagAb();

    // 11900 + 10700 = 22600 Cent brutto, 10000 + 10000 = 20000 Cent netto.
    expect(abschluss.grossVerkaufEur).toBe('226.00');
    expect(abschluss.netVerkaufEur).toBe('200.00');

    const ust = await holeUstJeBehandlung(abschluss.id);
    expect(ust.STANDARD_19).toBe('19.00');
    expect(ust.REDUCED_7).toBe('7.00');

    const buchungen = await holeBuchungen(abschluss.id);
    expect(buchungen).toHaveLength(2);

    const zeile19 = buchungen.find((b) => b.belegfeld1 === beleg19.locator);
    expect(zeile19?.konto).toBe('1000'); // bar → Kasse
    expect(zeile19?.gegenkonto).toBe('8400');
    expect(zeile19?.bu).toBe('');
    expect(zeile19?.umsatz).toBe('119,00');

    const zeile7 = buchungen.find((b) => b.belegfeld1 === beleg7.locator);
    expect(zeile7?.konto).toBe('1361'); // Karte → Geldtransit, NICHT die Kasse
    expect(zeile7?.gegenkonto).toBe('8300');
    expect(zeile7?.bu).toBe('');
    expect(zeile7?.umsatz).toBe('107,00');

    // DSFinV-K: Schluessel 1 = 19 %, Schluessel 2 = 7 %.
    const buendel = await holeDsfinvk(abschluss.id);
    const posUst = tabelle(buendel, 'lines_vat.csv');
    expect(posUst.find((z) => z.BON_ID === beleg19.locator)?.UST_SCHLUESSEL).toBe('1');
    expect(posUst.find((z) => z.BON_ID === beleg7.locator)?.UST_SCHLUESSEL).toBe('2');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Ein Beleg mit ALLEN VIER Behandlungen
  // ══════════════════════════════════════════════════════════════════════

  it('Ein Beleg mit allen vier Behandlungen ergibt fuenf Buchungszeilen, deren Summe genau der Belegbetrag ist', async () => {
    // Vier Positionen auf EINEM Beleg, von Hand nachgerechnet:
    //
    //   1  Regelsatz 19 %   brutto 11900  Steuer 1900   netto 10000
    //        11900 x 19 / 119 = 226.100 / 119 = 1900, GENAU.
    //   2  ermaessigt 7 %   brutto 10700  Steuer  700   netto 10000
    //        10700 x 7 / 107 = 74.900 / 107 = 700, GENAU.
    //   3  § 25a Marge      brutto 30000  Steuer 1916   netto 28084
    //        Einkauf 18000 → Marge 12000; 12000 x 19 / 119 = 228.000 / 119
    //        = 1915,97 → 1916 (119 x 1915 = 227.885, Rest 115, 2 x 115 > 119).
    //   4  § 25c Anlagegold brutto 25000  Steuer    0   netto 25000
    //
    //   Kopf: 11900 + 10700 + 30000 + 25000 = 77600 Cent brutto
    //         1900  +   700 +  1916 +     0 =  4516 Cent Steuer
    //         10000 + 10000 + 28084 + 25000 = 73084 Cent netto
    //   Probe: 73084 + 4516 = 77600 ✓
    const pEtui = await buehne.legeProduktAn({
      name: 'Etui neu',
      behandlung: 'STANDARD_19',
      einkaufspreis: '40.00',
      listenpreis: '119.00',
    });
    const pBuch = await buehne.legeProduktAn({
      name: 'Muenzkatalog Buch',
      behandlung: 'REDUCED_7',
      einkaufspreis: '30.00',
      listenpreis: '107.00',
    });
    const pRing = await buehne.legeProduktAn({
      name: 'Ring gebraucht',
      behandlung: 'MARGIN_25A',
      einkaufspreis: '180.00',
      listenpreis: '300.00',
    });
    const pBarren = await buehne.legeProduktAn({
      name: 'Goldbarren 10 g',
      behandlung: 'INVESTMENT_GOLD_25C',
      einkaufspreis: '210.00',
      listenpreis: '250.00',
    });

    const beleg = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'MIXED',
      subtotal: '730.84',
      vat: '45.16',
      total: '776.00',
      customerId: null,
      finalizedAt: buehne.ts(15, 0),
      items: [
        {
          productId: pEtui,
          treatment: 'STANDARD_19',
          vatRate: '0.1900',
          lineSubtotal: '100.00',
          lineVat: '19.00',
          lineTotal: '119.00',
          displayOrder: 0,
        },
        {
          productId: pBuch,
          treatment: 'REDUCED_7',
          vatRate: '0.0700',
          lineSubtotal: '100.00',
          lineVat: '7.00',
          lineTotal: '107.00',
          displayOrder: 1,
        },
        {
          productId: pRing,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '280.84',
          lineVat: '19.16',
          lineTotal: '300.00',
          acquisition: '180.00',
          margin: '120.00',
          displayOrder: 2,
        },
        {
          productId: pBarren,
          treatment: 'INVESTMENT_GOLD_25C',
          vatRate: null,
          lineSubtotal: '250.00',
          lineVat: '0.00',
          lineTotal: '250.00',
          displayOrder: 3,
        },
      ],
      payment: { method: 'CASH', amount: '776.00' },
      tse: true,
    });

    await schliesseSchicht('776.00', '776.00');
    const abschluss = await schliesseTagAb();

    expect(abschluss.grossVerkaufEur).toBe('776.00');
    expect(abschluss.netVerkaufEur).toBe('730.84');

    // Der Abschluss zerlegt den gemischten Beleg auf die vier Behandlungen.
    // Ein Eimer namens MIXED waere fuer eine Voranmeldung unbrauchbar: dort
    // gehoert jeder Betrag in ein Feld mit einem Steuersatz.
    const ust = await holeUstJeBehandlung(abschluss.id);
    expect(ust.STANDARD_19).toBe('19.00');
    expect(ust.REDUCED_7).toBe('7.00');
    expect(ust.MARGIN_25A).toBe('19.16');
    expect(ust.INVESTMENT_GOLD_25C).toBe('0.00');
    expect(ust.MIXED).toBeUndefined();
    // Summenprobe von Hand: 1900 + 700 + 1916 + 0 = 4516 Cent.
    const summeUst = Object.values(ust).reduce((s, w) => s + zuCents(w), 0n);
    expect(summeUst).toBe(4516n);

    // DATEV: FUENF Zeilen, jede auf ihrem Konto.
    //
    // ⚠️ Vier Behandlungen, aber fuenf Zeilen: der § 25a-Ring zerfaellt in
    // Einkaufsanteil (18000 Cent, 8193, ohne Schluessel) und Marge (12000
    // Cent, 8191, Schluessel 3). Wer hier wieder EINE Zeile ueber 30000 Cent
    // erwartet, verlangt genau den Fehler zurueck, der auf der Produktion
    // 5.393,19 EUR Umsatzsteuer unsichtbar gemacht hat.
    const buchungen = await holeBuchungen(abschluss.id);
    expect(buchungen).toHaveLength(5);

    const nachGegenkonto = new Map(buchungen.map((b) => [b.gegenkonto, b]));
    expect(zuCents(nachGegenkonto.get('8400')?.umsatz ?? '')).toBe(11900n);
    expect(nachGegenkonto.get('8400')?.bu).toBe('');
    expect(zuCents(nachGegenkonto.get('8300')?.umsatz ?? '')).toBe(10700n);
    expect(nachGegenkonto.get('8300')?.bu).toBe('');
    expect(zuCents(nachGegenkonto.get('8193')?.umsatz ?? '')).toBe(18000n);
    expect(nachGegenkonto.get('8193')?.bu).toBe('');
    expect(zuCents(nachGegenkonto.get('8191')?.umsatz ?? '')).toBe(12000n);
    expect(nachGegenkonto.get('8191')?.bu).toBe('');
    expect(zuCents(nachGegenkonto.get('8165')?.umsatz ?? '')).toBe(25000n);
    expect(nachGegenkonto.get('8165')?.bu).toBe('');
    // Einkaufsanteil und Marge ergeben zusammen wieder den Ring: 30000 Cent.
    expect(
      zuCents(nachGegenkonto.get('8193')?.umsatz ?? '') +
        zuCents(nachGegenkonto.get('8191')?.umsatz ?? ''),
    ).toBe(30000n);

    // Alles bar, also alles gegen die Kasse — und alle vier Zeilen tragen
    // dieselbe Belegnummer, sonst waere der Beleg in der Buchhaltung nicht
    // mehr als EIN Vorgang erkennbar.
    for (const b of buchungen) {
      expect(b.konto).toBe('1000');
      expect(b.belegfeld1).toBe(beleg.locator);
    }

    // Die Summe der fuenf Zeilen ist auf den Cent der Belegbetrag:
    //   11900 + 10700 + 18000 + 12000 + 25000 = 77600 Cent.
    const summeBuchungen = buchungen.reduce((s, b) => s + zuCents(b.umsatz), 0n);
    expect(summeBuchungen).toBe(77600n);

    // DSFinV-K: der Beleg zerfaellt in vier USt-Zeilen, nicht in eine.
    // Anders als in DATEV bleibt § 25a hier EINE Zeile: die Norm fragt nach
    // dem Umsatzsteuerschluessel des Vorgangs, nicht nach der Buchung.
    const buendel = await holeDsfinvk(abschluss.id);
    const schluessel25a = await ustSchluessel('dsfinvk.ust_schluessel.margin_25a');
    const bonUst = tabelle(buendel, 'transactions_vat.csv');
    const belegZeilen = bonUst.filter((z) => z.BON_ID === beleg.locator);
    expect(belegZeilen).toHaveLength(4);
    // 1 = 19 %, 2 = 7 %, 6 = umsatzsteuerfrei (§ 25c), dazu der Schluessel
    // des Steuerberaters fuer § 25a.
    expect(belegZeilen.map((z) => z.UST_SCHLUESSEL).sort()).toEqual(
      ['1', '2', '6', schluessel25a].sort(),
    );
    const summeDsfinvk = belegZeilen.reduce((s, z) => s + zuCents(z.BON_BRUTTO ?? ''), 0n);
    expect(summeDsfinvk).toBe(77600n);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Der Ankaufspreis — er treibt die Steuer, aber steht er auch im Export?
  // ══════════════════════════════════════════════════════════════════════

  it('Der Ankaufspreis treibt die Margensteuer nachweisbar an', async () => {
    // Bewusst krumme Zahlen, damit sie in keiner Datei zufaellig entstehen.
    // Einkauf 613,00, Verkauf 1.000,00.
    //   Marge  = 100000 - 61300 = 38700 Cent
    //   Steuer = 38700 x 19 / 119 = 735.300 / 119 = 6178,99 → 6179 Cent
    //            (119 x 6178 = 735.182, Rest 118; 2 x 118 = 236 > 119 → auf)
    //   Netto  = 100000 - 6179 = 93821 Cent
    const stueck = await buehne.legeProduktAn({
      name: 'Armband gebraucht',
      behandlung: 'MARGIN_25A',
      einkaufspreis: '613.00',
      listenpreis: '1000.00',
    });
    await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '938.21',
      vat: '61.79',
      total: '1000.00',
      customerId: null,
      finalizedAt: buehne.ts(16, 0),
      items: [
        {
          productId: stueck,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '938.21',
          lineVat: '61.79',
          lineTotal: '1000.00',
          acquisition: '613.00',
          margin: '387.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '1000.00' },
      tse: true,
    });

    // Der Schnappschuss liegt wirklich an der Position, gelesen mit den
    // Rechten der Anwendung — nicht mit denen des Wanderers.
    const positionen = await buehne.sql<
      {
        acquisition_cost_eur_snapshot: string | null;
        margin_eur: string | null;
        line_total_eur: string;
        line_vat_eur: string;
      }[]
    >`
      SELECT acquisition_cost_eur_snapshot::text AS acquisition_cost_eur_snapshot,
             margin_eur::text                    AS margin_eur,
             line_total_eur::text                AS line_total_eur,
             line_vat_eur::text                  AS line_vat_eur
        FROM transaction_items`;
    expect(positionen).toHaveLength(1);
    const pos = positionen[0]!;
    expect(pos.acquisition_cost_eur_snapshot).toBe('613.00');
    expect(pos.margin_eur).toBe('387.00');

    // Die Kette schliesst sich von Hand: Verkauf minus Einkauf ist die
    // Marge, und aus der Marge folgt genau die gespeicherte Steuer.
    expect(zuCents(pos.line_total_eur) - zuCents(pos.acquisition_cost_eur_snapshot ?? '0.00')).toBe(
      zuCents(pos.margin_eur ?? '0.00'),
    );
    expect(zuCents(pos.line_vat_eur)).toBe(6179n);

    await schliesseSchicht('1000.00', '1000.00');
    const abschluss = await schliesseTagAb();
    const ust = await holeUstJeBehandlung(abschluss.id);
    expect(ust.MARGIN_25A).toBe('61.79');
  });

  it('Der Ankaufspreis steht als EIGENE Buchungszeile im DATEV-Stapel', async () => {
    // Derselbe Beleg wie oben: Einkauf 613,00, Marge 387,00, Steuer 61,79.
    //
    // ⚠️ WAS HIER FRUEHER STAND, UND WARUM ES JETZT ANDERS LAUTET
    //
    // Diese Pruefung hiess „FUND: der Ankaufspreis fehlt in JEDER
    // ausgelieferten Steuerdatei" und schrieb fest, dass 613,00 und 387,00
    // nirgends vorkommen. Das war am 04.08.2026 nicht mehr wahr: seit dem
    // 27.07.2026 zerlegt der DATEV-Weg jeden § 25a-Verkauf in Einkaufsanteil
    // und Marge, und damit steht die Bemessungsgrundlage im Stapel. Ein Test,
    // der den behobenen Mangel weiter verlangt, waere schlimmer als kein Test.
    //
    // GEMESSEN am 04.08.2026, damit der naechste Leser es nicht neu suchen
    // muss: der KASSENBERICHT und das DSFinV-K-Buendel tragen den
    // Einkaufspreis weiterhin nicht. Der Kassenbericht ist eine Uebersicht und
    // keine Steuerdatei, und die amtliche Taxonomie kennt fuer den
    // Einkaufspreis kein Feld — deshalb steht hier keine Erwartung darauf,
    // sondern nur diese Messung.
    const stueck = await buehne.legeProduktAn({
      name: 'Armband gebraucht',
      behandlung: 'MARGIN_25A',
      einkaufspreis: '613.00',
      listenpreis: '1000.00',
    });
    const beleg = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '938.21',
      vat: '61.79',
      total: '1000.00',
      customerId: null,
      finalizedAt: buehne.ts(16, 0),
      items: [
        {
          productId: stueck,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '938.21',
          lineVat: '61.79',
          lineTotal: '1000.00',
          acquisition: '613.00',
          margin: '387.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '1000.00' },
      tse: true,
    });
    await schliesseSchicht('1000.00', '1000.00');
    const abschluss = await schliesseTagAb();

    const buchungen = await holeBuchungen(abschluss.id);
    expect(buchungen).toHaveLength(2);

    // Der Einkaufsanteil: 61300 Cent, steuerfrei auf 8193, ohne Schluessel.
    const einkauf = buchungen.find((b) => b.gegenkonto === '8193');
    expect(einkauf).toBeDefined();
    expect(zuCents(einkauf?.umsatz ?? '')).toBe(61300n);
    expect(einkauf?.bu).toBe('');

    // Die Marge: 38700 Cent auf 8191 mit Schluessel 3 — DAS ist die
    // Bemessungsgrundlage der 61,79 EUR Umsatzsteuer, und ein Pruefer kann
    // sie aus der Datei selbst nachrechnen: 38700 x 19 / 119 = 6179 Cent.
    const marge = buchungen.find((b) => b.gegenkonto === '8191');
    expect(marge).toBeDefined();
    expect(zuCents(marge?.umsatz ?? '')).toBe(38700n);
    expect(marge?.bu).toBe(''); // 19.08.2026: leer — 8191 ist Automatikkonto

    // Beide Zeilen tragen dieselbe Belegnummer und ergeben zusammen genau
    // den Belegbetrag: 61300 + 38700 = 100000 Cent.
    for (const b of buchungen) {
      expect(b.belegfeld1).toBe(beleg.locator);
      expect(b.konto).toBe('1000');
      expect(b.sollHaben).toBe('S');
    }
    expect(buchungen.reduce((sum, b) => sum + zuCents(b.umsatz), 0n)).toBe(100000n);

    // Die Steuer selbst steht weiterhin im Kassenbericht — die Zahl, die der
    // Haendler liest.
    const bericht = await holeKassenbericht(abschluss.id);
    expect(bericht).toContain('61,79 EUR');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Eine dem Kontenplan UNBEKANNTE Behandlung
  // ══════════════════════════════════════════════════════════════════════

  it('§ 13b bucht auf sein EIGENES Konto, nicht auf das 19-Prozent-Konto', async () => {
    // ⚠️ WAS HIER FRUEHER STAND, UND WARUM ES JETZT ANDERS LAUTET
    //
    // Diese Pruefung hiess „FUND: eine unbekannte Steuerbehandlung faellt
    // still auf das 19-Prozent-Konto zurueck" und schrieb fest, dass
    // `REVERSE_CHARGE_13B` auf 8400 landet. Am 04.08.2026 gemessen: er landet
    // auf 8337, dem SKR03-Konto fuer Erloese, bei denen der
    // Leistungsempfaenger die Steuer schuldet. Der Rueckfall wurde am
    // 26.07.2026 behoben, und die Datei traegt jetzt die Wahrheit.
    //
    // `REVERSE_CHARGE_13B` steht seit Wanderung 0039 in
    // `tax_treatment_codes` mit einem Satz von 0,0000, er ist im Schema von
    // `POST /api/transactions/finalize` zugelassen, das Kassenprogramm rechnet
    // ihn (`cart-math.ts`), und es gibt eine eigene Belegtextvorlage dafuer.
    //
    // Bei § 13b schuldet der LEISTUNGSEMPFAENGER die Steuer; der Verkaeufer
    // weist keine aus. Verkauf 1.000,00 per Ueberweisung, Steuer 0 Cent.
    const posten = await buehne.legeProduktAn({
      name: 'Feingold Lieferung B2B',
      behandlung: 'REVERSE_CHARGE_13B',
      einkaufspreis: '800.00',
      listenpreis: '1000.00',
    });
    const beleg = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'REVERSE_CHARGE_13B',
      subtotal: '1000.00',
      vat: '0.00',
      total: '1000.00',
      customerId: null,
      finalizedAt: buehne.ts(13, 0),
      items: [
        {
          productId: posten,
          treatment: 'REVERSE_CHARGE_13B',
          vatRate: '0.0000',
          lineSubtotal: '1000.00',
          lineVat: '0.00',
          lineTotal: '1000.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'BANK_TRANSFER', amount: '1000.00' },
      tse: true,
    });

    // Kein Bargeld an diesem Tag.
    await schliesseSchicht('0.00', '0.00');
    const abschluss = await schliesseTagAb();

    // Der Abschluss selbst ist EHRLICH: er fuehrt einen eigenen Eimer mit
    // 0,00 Steuer. Von Hand: 0 Cent, weil § 13b keine Ausgangssteuer kennt.
    const ust = await holeUstJeBehandlung(abschluss.id);
    expect(ust.REVERSE_CHARGE_13B).toBe('0.00');

    // Der Kassenbericht ist EHRLICH: er markiert den Code als unbekannt,
    // statt ihn huebsch zu machen oder wegzulassen.
    const bericht = await holeKassenbericht(abschluss.id);
    expect(bericht).toContain('REVERSE_CHARGE_13B (unbekannter Schlüssel)');

    // DATEV auch: Gegenkonto 8337, Feld 9 LEER. Der leere Schluessel ist hier
    // richtig — 8337 ist kein Automatikkonto, das Konto selbst traegt die
    // Aussage. Auf 8400 mit leerem Feld waere es falsch gewesen: dort setzt
    // DATEV den Satz des Kontos an, also 19 Prozent, und auf 1.000,00 waeren
    // das 1.000,00 x 19 / 119 = 15966 Cent, also 159,66 EUR Umsatzsteuer, die
    // der Verkaeufer nach § 13b gar nicht schuldet.
    const buchungen = await holeBuchungen(abschluss.id);
    expect(buchungen).toHaveLength(1);
    expect(buchungen[0]?.gegenkonto).toBe('8337');
    expect(buchungen[0]?.bu).toBe('');
    expect(buchungen[0]?.konto).toBe('1200'); // Ueberweisung → Bank
    expect(buchungen[0]?.buchungstext).toContain('REVERSE_CHARGE_13B');
    // Und ausdruecklich NICHT auf dem Erloeskonto des Regelsatzes: dort
    // waeren § 13b und ein echter 19-Prozent-Verkauf nur noch am Freitext
    // auseinanderzuhalten gewesen.
    expect(buchungen[0]?.gegenkonto).not.toBe('8400');

    // DSFinV-K: der Beleg traegt den Schluessel, den der Steuerberater fuer
    // § 13b vergeben hat — nicht den der Differenzbesteuerung. Die Norm
    // reserviert die Nummern unter 1000 fuer sich; eigene Sachverhalte
    // bekommen eine eigene Nummer, und welche, entscheidet die Kanzlei.
    const buendel = await holeDsfinvk(abschluss.id);
    const schluessel13b = await ustSchluessel('dsfinvk.ust_schluessel.reverse_charge_13b');
    const schluessel25a = await ustSchluessel('dsfinvk.ust_schluessel.margin_25a');
    const posUst = tabelle(buendel, 'lines_vat.csv');
    const zeile = posUst.find((z) => z.BON_ID === beleg.locator);
    expect(zeile?.UST_SCHLUESSEL).toBe(schluessel13b);
    expect(zeile?.UST_SCHLUESSEL).not.toBe(schluessel25a);
    expect(zuCents(zeile?.POS_UST ?? '')).toBe(0n);
  });
});
