/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Szenario STORNO — die Umkehr, und die Wuerde des Tagesabschlusses
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Ein Storno ist der Punkt, an dem Kassensysteme reihenweise scheitern: der
 * Betrag verschwindet, oder er verschwindet NICHT und macht den Tag negativ,
 * oder er erscheint zweimal. Diese Datei faehrt die ganze Kette gegen ein
 * ECHTES Postgres im Behaelter und ueber die ECHTEN HTTP-Wege der Anwendung:
 *
 *   POST /api/transactions/storno       — die fiskalische Umkehr
 *   POST /api/transactions/return       — die Retoure (Fernabsatz, Ware zurueck)
 *   POST /api/closings/finalize         — der Z-Bon, der die Betraege trennt
 *   GET  /api/closings/:id/export/datev — der Buchungsstapel
 *   GET  /api/closings/:id/export/kassenbericht
 *   GET  /api/closings/:id/export/dsfinvk
 *
 * Keine Attrappe steht in einem Rechenweg. Was hier gruen ist, hat wirklich
 * eine Datenbank, eine Zahlungszeile und eine Datei angefasst.
 *
 * ── DER RECHTLICHE ANKER ───────────────────────────────────────────────────
 * BFH, Urteil vom 29.07.2025, X R 23-24/21, Leitsatz 1: ein Kassensystem, das
 * Stornierungen zulaesst und sie in den Tagesabschluessen NICHT MIT BETRAG
 * ausweist, begruendet eine Schaetzungsbefugnis. Die blosse Stueckzahl genuegt
 * nicht. Wanderung 0112 hat dafuer `storno_verkauf_eur` und `storno_ankauf_eur`
 * angelegt; hier wird nachgewiesen, dass die Spalten wirklich gefuellt werden,
 * positiv, und dass der Umsatz sie nicht mitzaehlt.
 *
 * ── WARUM DER GESCHAEFTSTAG HIER `now()` IST, nicht ein fester Tag ─────────
 * `POST /api/transactions/storno` setzt `finalized_at` NICHT — die Datenbank
 * vergibt ihren Vorgabewert `now()`. Ein ueber HTTP erzeugter Storno faellt
 * damit IMMER auf den heutigen Berliner Geschaeftstag. Wer den Beleg auf einen
 * erfundenen Maitag legt, prueft eine Kette, die es so nie gibt: Beleg und
 * Storno lägen auf zwei Tagen. Deshalb liest jeder Aufbau hier den Tag aus der
 * Datenbank (`berlin_business_day(now())`) und legt den Beleg auf denselben.
 *
 * NUR FUER TESTS. Kein Produktionsquelltext wird angefasst; die Datenbank lebt
 * in einem Wegwerf-Behaelter.
 */

import { inflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

// ── Geld: immer ganze Cent, niemals Fliesskomma ────────────────────────────

/** '119.00' → 11900n. Auch negativ: '-60.00' → -6000n. */
function zuCent(eur: string): bigint {
  const t = eur.trim();
  const negativ = t.startsWith('-');
  const [ganz = '0', bruch = ''] = (negativ ? t.slice(1) : t).split('.');
  const wert = BigInt(ganz) * 100n + BigInt((bruch + '00').slice(0, 2));
  return negativ ? -wert : wert;
}

/** DATEV schreibt deutsch: '60,00' → 6000n. */
function datevZuCent(betrag: string): bigint {
  return zuCent(betrag.replace('.', '').replace(',', '.'));
}

// ── DATEV: die 125-Feld-Zeile, an ihren Feldnummern gelesen ────────────────
//
// Die Feldnummern sind 1-basiert (FELD.UMSATZ = 1), der Spaltenindex also
// eins kleiner. Nur die Felder, um die es hier geht.

interface DatevBuchung {
  umsatz: string;
  sollHaben: string;
  konto: string;
  gegenkonto: string;
  buSchluessel: string;
  belegdatum: string;
  belegfeld1: string;
  buchungstext: string;
  /** Feld 118 — '1' auf einer Generalumkehr, sonst leer. */
  generalumkehr: string;
}

/**
 * Den ausgelieferten Buchungsstapel in seine Buchungszeilen zerlegen.
 *
 * Die Datei ist ANSI (Windows-1252), deshalb werden die ROHEN Bytes als
 * latin1 gelesen — `res.payload` waere UTF-8 und verfaelschte jedes Sonderzeichen.
 * Zeile 1 ist der EXTF-Kopf, Zeile 2 die Spaltenueberschrift.
 */
function datevBuchungen(rohe: Buffer): DatevBuchung[] {
  const csv = rohe.toString('latin1');
  const zeilen = csv.split('\r\n').filter((z) => z.length > 0);
  return zeilen.slice(2).map((z) => {
    const f = z.split(';').map((c) => c.replace(/^"|"$/g, ''));
    return {
      umsatz: f[0] ?? '',
      sollHaben: f[1] ?? '',
      konto: f[6] ?? '',
      gegenkonto: f[7] ?? '',
      buSchluessel: f[8] ?? '',
      belegdatum: f[9] ?? '',
      belegfeld1: f[10] ?? '',
      buchungstext: f[13] ?? '',
      generalumkehr: f[117] ?? '',
    };
  });
}

/**
 * Die WIRKUNG einer Buchungszeile auf ihr Konto, in ganzen Cent.
 *
 * DATEV traegt die Richtung im Soll/Haben-Kennzeichen, nicht im Vorzeichen des
 * Umsatzes — und seit dem 19.08.2026 traegt Feld 118 das Minus des Stornos:
 * eine Generalumkehr bucht „mit Minuszeichen auf der GLEICHEN Soll-/Haben-
 * Seite" (DATEV Dok.-Nr. 1070379, Kap. 3.2). Ein Storno-Paar hebt sich also
 * genau dann auf, wenn die Summe dieser Wirkungen je Konto null ist.
 */
function wirkungAufKonto(b: DatevBuchung): bigint {
  const betrag = datevZuCent(b.umsatz);
  const richtung = b.sollHaben === 'S' ? betrag : -betrag;
  return b.generalumkehr === '1' ? -richtung : richtung;
}

// ── DSFinV-K: ein Mindest-Entpacker (STORE + roher DEFLATE) ────────────────
//
// `zipDsfinvkBundle` schreibt je Datei einen lokalen Kopf, danach das
// Inhaltsverzeichnis und den EOCD-Satz. Hier wird ueber das Inhaltsverzeichnis
// gelaufen, damit der Nachweis wirklich „das Buendel entpackt" heisst und nicht
// „die Bytes sehen aus wie ein Archiv".

function entpacke(buf: Buffer): Map<string, string> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('entpacke: kein EOCD-Satz gefunden — das ist kein ZIP');

  const anzahl = buf.readUInt16LE(eocd + 10);
  let vz = buf.readUInt32LE(eocd + 16);
  const dateien = new Map<string, string>();

  for (let n = 0; n < anzahl; n++) {
    if (buf.readUInt32LE(vz) !== 0x02014b50) {
      throw new Error('entpacke: falsche Kennung im Inhaltsverzeichnis');
    }
    const verfahren = buf.readUInt16LE(vz + 10);
    const komprimiert = buf.readUInt32LE(vz + 20);
    const namensLaenge = buf.readUInt16LE(vz + 28);
    const extraLaenge = buf.readUInt16LE(vz + 30);
    const kommentarLaenge = buf.readUInt16LE(vz + 32);
    const lokal = buf.readUInt32LE(vz + 42);
    const name = buf.toString('utf8', vz + 46, vz + 46 + namensLaenge);

    const lNamensLaenge = buf.readUInt16LE(lokal + 26);
    const lExtraLaenge = buf.readUInt16LE(lokal + 28);
    const beginn = lokal + 30 + lNamensLaenge + lExtraLaenge;
    const roh = buf.subarray(beginn, beginn + komprimiert);
    dateien.set(name, (verfahren === 8 ? inflateRawSync(roh) : Buffer.from(roh)).toString('utf8'));

    vz += 46 + namensLaenge + extraLaenge + kommentarLaenge;
  }
  return dateien;
}

/** Eine DSFinV-K-Datei in Zeilen aus Feldern zerlegen (Semikolon, CRLF). */
function csvZeilen(inhalt: string): string[][] {
  return inhalt
    .split(/\r\n|\n/)
    .filter((z) => z.length > 0)
    .map((z) => z.split(';'));
}

// ════════════════════════════════════════════════════════════════════════════

describe('Szenario: Storno, Retoure und die Wuerde des Tagesabschlusses', () => {
  const buehne = baueFiskalBuehne();

  /**
   * Der Signaturzaehler der Sicherungseinrichtung. Er laeuft ueber die ganze
   * Datei weiter und wird nie zurueckgesetzt: eine echte TSE zaehlt monoton,
   * und zwei Belege mit derselben Nummer gaebe es dort nie.
   */
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

  /**
   * Der heutige Berliner Geschaeftstag und der zugehoerige Zeitpunkt — beides
   * aus DERSELBEN Datenbankuhr, die auch den Storno stempelt. Ein in JavaScript
   * gerechneter Tag koennte um eine Zone danebenliegen, und genau eine Stunde
   * entscheidet an der Tagesgrenze ueber den Geschaeftstag.
   */
  async function heute(): Promise<{ tag: string; jetzt: string }> {
    const [zeile] = await buehne.migratorSql<{ tag: string; jetzt: Date }[]>`
      SELECT berlin_business_day(now())::text AS tag, now() AS jetzt`;
    return { tag: zeile!.tag, jetzt: zeile!.jetzt.toISOString() };
  }

  /**
   * Eine abgeschlossene Schicht fuer heute. Ohne sie verweigert
   * `POST /api/closings/finalize` jeden Tag, der Belege traegt — zu Recht: ohne
   * Kassensturz ist der Bargeldbestand unbekannt.
   */
  async function legeGeschlosseneSchichtAn(erwartet: string, gezaehlt: string): Promise<void> {
    await buehne.migratorSql`
      INSERT INTO shifts (device_id, opened_by_user_id, opened_at, opening_float_eur,
                          status, blind_count_eur, system_expected_eur,
                          closed_by_user_id, closed_at)
      VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.inhaberId}, now(), '0.00',
              'CLOSED'::shift_status, ${gezaehlt}, ${erwartet},
              ${buehne.akteure.inhaberId}, now())`;
  }

  /** Die gespeicherte Abschlusszeile — die Spalten, die 0112 angelegt hat. */
  async function abschlusszeile(tag: string): Promise<{
    verkauf_count: number;
    ankauf_count: number;
    storno_count: number;
    gross_verkauf_eur: string;
    gross_ankauf_eur: string;
    net_verkauf_eur: string;
    net_ankauf_eur: string;
    storno_verkauf_eur: string;
    storno_ankauf_eur: string;
    payments_by_method: Record<string, string>;
  }> {
    const [zeile] = await buehne.migratorSql<
      {
        verkauf_count: number;
        ankauf_count: number;
        storno_count: number;
        gross_verkauf_eur: string;
        gross_ankauf_eur: string;
        net_verkauf_eur: string;
        net_ankauf_eur: string;
        storno_verkauf_eur: string;
        storno_ankauf_eur: string;
        payments_by_method: Record<string, string>;
      }[]
    >`
      SELECT verkauf_count, ankauf_count, storno_count,
             gross_verkauf_eur::text  AS gross_verkauf_eur,
             gross_ankauf_eur::text   AS gross_ankauf_eur,
             net_verkauf_eur::text    AS net_verkauf_eur,
             net_ankauf_eur::text     AS net_ankauf_eur,
             storno_verkauf_eur::text AS storno_verkauf_eur,
             storno_ankauf_eur::text  AS storno_ankauf_eur,
             payments_by_method
        FROM daily_closings WHERE business_day = ${tag}::date`;
    return zeile!;
  }

  /**
   * Die Signatur der Sicherungseinrichtung nachtragen — auf DEMSELBEN Weg wie
   * die Kasse.
   *
   * Die Kasse signiert jeden Beleg und schickt die Signatur anschliessend an
   * `POST /api/transactions/:id/tse-signature`; beim Storno tut sie es genauso
   * (`apps/tauri-pos/src/screens/verkauf/StornoDialog.tsx`, Zeile 227). Ein
   * Storno ohne Signatur ist kein gewoehnlicher Tag, sondern der Ausfall der
   * Sicherungseinrichtung, und den prueft eine eigene Datei.
   *
   * Die Werte sind Testwerte. Diese Buehne signiert nichts, sie zeichnet die
   * Signatur nur so auf, wie die Kasse sie liefert.
   */
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

  /**
   * Ueber HTTP stornieren, die Antwort als 200 nachweisen und den Stornobeleg
   * signieren lassen — genau die Reihenfolge, die die Kasse geht.
   */
  async function storniereUeberHttp(belegId: string, grund: string): Promise<{
    id: string;
    receiptLocator: string;
    totalEur: string;
  }> {
    // ⚠️ 11.08.2026: die Lade muss offen sein, wenn Bargeld sie verlaesst.
    // Der Storno weist eine Barrueckgabe ohne Schicht ab, genau wie der
    // Verkauf. Siehe `mitOffenerSchicht` in der Buehne fuer den ganzen Grund.
    const res = await buehne.mitOffenerSchichtFuerStorno(belegId, () =>
      buehne.sende('/api/transactions/storno', {
        originalTransactionId: belegId,
        reason: grund,
      }),
    );
    expect(res.statusCode, res.body).toBe(200);
    const storno = res.json() as { id: string; receiptLocator: string; totalEur: string };
    await signiereUeberHttp(storno.id);
    return storno;
  }

  /**
   * Ueber HTTP den Z-Bon setzen und die Kennung des Abschlusses liefern.
   *
   * `unsignierteBelege`: nur fuer Tage, an denen ein Beleg BEWUSST ohne
   * Signatur liegt. Der Abschluss haelt einen solchen Tag an und verlangt eine
   * ausdrueckliche Bestaetigung; das ist der Riegel und nicht sein Umgehen —
   * die Bestaetigung landet unveraenderlich in der Notiz der Abschlusszeile.
   */
  async function schliesseTagAbUeberHttp(
    tag: string,
    unsignierteBelege = false,
  ): Promise<{ id: string; nutzlast: unknown }> {
    const res = await buehne.sende('/api/closings/finalize', {
      businessDay: tag,
      ...(unsignierteBelege ? { unsignierteBelegeBestaetigt: true } : {}),
    });
    // Die Antwort mit in die Meldung: ein 409 des Abschlusses nennt seinen
    // Grund im Rumpf, und ohne ihn sucht der naechste Leser eine Stunde.
    expect(res.statusCode, res.body).toBe(200);
    const nutzlast = res.json() as { id: string };
    return { id: nutzlast.id, nutzlast };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Ein Verkauf und sein Vollstorno
  // ══════════════════════════════════════════════════════════════════════════

  describe('Ein Verkauf und sein Vollstorno', () => {
    /**
     * 119,00 brutto = 100,00 netto + 19,00 USt, bar bezahlt.
     * Von Hand: 10000 Cent + 1900 Cent = 11900 Cent.
     */
    async function baueVerkaufUndStorno(): Promise<{ tag: string; belegId: string; stornoId: string }> {
      const { tag, jetzt } = await heute();
      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: jetzt,
        items: [
          {
            productId: produkt,
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
      const storno = await storniereUeberHttp(beleg.id, 'Kundin hat es sich anders ueberlegt');
      return { tag, belegId: beleg.id, stornoId: storno.id };
    }

    it('der Tag steht netto auf null, aber der Abschluss weist den Stornobetrag GETRENNT und POSITIV aus', async () => {
      const { tag } = await baueVerkaufUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      await schliesseTagAbUeberHttp(tag);

      const z = await abschlusszeile(tag);

      // Von Hand: der Verkauf zaehlt einmal, der Storno zaehlt NICHT als
      // Verkauf, sondern als Storno.
      expect(Number(z.verkauf_count)).toBe(1);
      expect(Number(z.storno_count)).toBe(1);

      // Brutto VOR Storno = 11900 Cent, Storno = 11900 Cent als POSITIVE
      // Groesse (nicht −11900, nicht 0).
      expect(zuCent(z.gross_verkauf_eur)).toBe(11900n);
      expect(zuCent(z.storno_verkauf_eur)).toBe(11900n);
      expect(zuCent(z.storno_verkauf_eur) > 0n).toBe(true);

      // Und erst die Differenz ist der Tagesumsatz: 11900 − 11900 = 0 Cent.
      expect(zuCent(z.gross_verkauf_eur) - zuCent(z.storno_verkauf_eur)).toBe(0n);
    });

    it('die Netto-Summe des Abschlusses zaehlt den Storno NICHT als Umsatz mit', async () => {
      const { tag } = await baueVerkaufUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      await schliesseTagAbUeberHttp(tag);

      const z = await abschlusszeile(tag);

      // Von Hand: netto ist NUR der Beleg, 10000 Cent. Zaehlte die Summe die
      // Stornozeile mit, staende hier 0; zaehlte sie sie doppelt, −10000.
      expect(zuCent(z.net_verkauf_eur)).toBe(10000n);
    });

    it('die Kasse gibt das Bargeld zurueck: die Barsumme des Tages steht auf null', async () => {
      const { tag } = await baueVerkaufUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      await schliesseTagAbUeberHttp(tag);

      const z = await abschlusszeile(tag);
      // Von Hand: +11900 Cent eingenommen, −11900 Cent zurueckgegeben.
      expect(zuCent(z.payments_by_method.CASH ?? '0.00')).toBe(0n);
    });

    it('der Kassenbericht nennt den stornierten Betrag und den Umsatz nach Storno', async () => {
      const { tag } = await baueVerkaufUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      const { id } = await schliesseTagAbUeberHttp(tag);

      const res = await buehne.hol(`/api/closings/${id}/export/kassenbericht`);
      expect(res.statusCode).toBe(200);

      // Aufbau der Datei: Abschnitt;Feld;Wert.
      const zeilen = csvZeilen(res.payload);
      const feld = (name: string): string | undefined =>
        zeilen.find((z) => z[1] === name)?.[2];

      expect(feld('Verkauf brutto vor Storno')).toBe('119,00 EUR');
      expect(feld('davon storniert')).toBe('119,00 EUR');
      expect(feld('Verkauf brutto nach Storno und Rücknahme')).toBe('0,00 EUR');
      expect(feld('Stornos')).toBe('1');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Der Storno eines GEMISCHTEN Belegs
  // ══════════════════════════════════════════════════════════════════════════

  describe('Der Storno eines gemischten Belegs', () => {
    /**
     * Ein Ring zu 19 Prozent (119,00) und eine Muenze nach § 25a (100,00).
     *
     * ⚠️ DIE MUENZE TRAEGT IHREN EINKAUFSPREIS (60,00), und das ist keine
     * Beigabe: bei der Differenzbesteuerung steckt die Umsatzsteuer in der
     * MARGE. Verkauf 10000 − Einkauf 6000 = 4000 Cent Marge, darin
     * 4000 * 19 / 119 = 638,65… Cent, gerundet 639 Cent Umsatzsteuer; netto
     * bleiben 10000 − 639 = 9361 Cent.
     *
     * Von Hand fuer den ganzen Beleg:
     *   brutto  11900 + 10000 = 21900 Cent
     *   netto   10000 +  9361 = 19361 Cent
     *   Steuer   1900 +   639 =  2539 Cent
     *   Probe   19361 + 2539  = 21900 ✓
     *
     * Ohne Einkaufspreis waere die Marge nach § 25a Abs. 6 UStG nicht belegbar,
     * und der DATEV-Weg bricht dann ab, statt eine steuerfreie Zeile zu
     * erfinden. Genau diese erfundene steuerfreie Zeile hat auf der Produktion
     * 5.393,19 EUR Umsatzsteuer in KEINER Buchungszeile auftauchen lassen.
     */
    async function baueGemischtenBelegUndStorno(): Promise<{ tag: string; stornoId: string }> {
      const { tag, jetzt } = await heute();
      const ring = await buehne.legeProduktAn({ behandlung: 'STANDARD_19', name: 'Ring' });
      const muenze = await buehne.legeProduktAn({ behandlung: 'MARGIN_25A', name: 'Muenze' });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'MIXED',
        subtotal: '193.61',
        vat: '25.39',
        total: '219.00',
        customerId: null,
        finalizedAt: jetzt,
        items: [
          {
            productId: ring,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
          {
            productId: muenze,
            treatment: 'MARGIN_25A',
            vatRate: null,
            lineSubtotal: '93.61',
            lineVat: '6.39',
            lineTotal: '100.00',
            acquisition: '60.00',
            margin: '40.00',
            displayOrder: 1,
          },
        ],
        payment: { method: 'CASH', amount: '219.00' },
        // Ein gewoehnlicher Tag: die Sicherungseinrichtung hat jeden Beleg
        // signiert. Ein Beleg OHNE Signatur ist ein Ausfall, kein Alltag.
        tse: true,
      });
      const storno = await storniereUeberHttp(beleg.id, 'Beide Stuecke zurueckgegeben');
      return { tag, stornoId: storno.id };
    }

    it('jede Steuerbehandlung kehrt EINZELN um, keine wird zu einer Summe verschmolzen', async () => {
      const { stornoId } = await baueGemischtenBelegUndStorno();

      const zeilen = await buehne.migratorSql<
        { applied_tax_treatment_code: string; line_total_eur: string; line_vat_eur: string }[]
      >`
        SELECT applied_tax_treatment_code, line_total_eur::text AS line_total_eur,
               line_vat_eur::text AS line_vat_eur
          FROM transaction_items WHERE transaction_id = ${stornoId}
         ORDER BY display_order`;

      // Zwei Positionen, nicht eine verschmolzene ueber 21900 Cent.
      expect(zeilen).toHaveLength(2);
      expect(zeilen.map((z) => z.applied_tax_treatment_code)).toEqual(['STANDARD_19', 'MARGIN_25A']);

      // Von Hand: jede Zeile kehrt fuer sich um. −11900 und −10000 Cent.
      expect(zuCent(zeilen[0]!.line_total_eur)).toBe(-11900n);
      expect(zuCent(zeilen[1]!.line_total_eur)).toBe(-10000n);
      // Die Steuer kehrt mit: −1900 Cent auf der 19er Zeile, und auf der
      // § 25a-Zeile −639 Cent — die Steuer, die in der Marge steckte. Eine
      // Null stuende dort nur, wenn die Muenze ohne Aufschlag weggegangen
      // waere; hier lagen 4000 Cent Marge dazwischen.
      expect(zuCent(zeilen[0]!.line_vat_eur)).toBe(-1900n);
      expect(zuCent(zeilen[1]!.line_vat_eur)).toBe(-639n);
    });

    it('in DATEV bekommt jede Behandlung ihre eigene Umkehr auf ihrem eigenen Erloeskonto', async () => {
      const { tag } = await baueGemischtenBelegUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      const { id } = await schliesseTagAbUeberHttp(tag);

      const res = await buehne.hol(`/api/closings/${id}/export/datev`);
      expect(res.statusCode).toBe(200);
      const buchungen = datevBuchungen(Buffer.from(res.rawPayload));

      // DREI Zeilen fuer den Beleg, drei fuer den Storno.
      //
      // ⚠️ Es sind nicht zwei: ein differenzbesteuerter Verkauf zerfaellt seit
      // dem 27.07.2026 in ZWEI Buchungszeilen — den Einkaufsanteil ohne
      // Umsatzsteuer (SKR03 8193) und die Marge mit 19 Prozent (8191). Bis
      // dahin ging der volle Verkaufspreis steuerfrei auf ein Sammelkonto;
      // auf der Produktion fehlten dadurch 5.393,19 EUR Umsatzsteuer in jeder
      // einzelnen Zeile. Wer diese Erwartung auf zwei Zeilen zuruecksetzt,
      // setzt genau diesen Fehler wieder ein.
      expect(buchungen).toHaveLength(6);
      const stornoZeilen = buchungen.filter((b) => b.buchungstext.startsWith('STORNO '));
      expect(stornoZeilen).toHaveLength(3);

      // 19.08.2026: alle Erloeskonten hier sind Automatikkonten oder fuehren
      // keinen Schluessel — Feld 9 bleibt auf JEDER Zeile leer, und der Storno
      // traegt sein Minus in Feld 118 statt in einer gekippten Seite.
      const auf8400 = stornoZeilen.find((b) => b.gegenkonto === '8400');
      const auf8193 = stornoZeilen.find((b) => b.gegenkonto === '8193');
      const auf8191 = stornoZeilen.find((b) => b.gegenkonto === '8191');
      expect(auf8400).toBeDefined();
      expect(auf8193).toBeDefined();
      expect(auf8191).toBeDefined();
      expect(auf8400!.buSchluessel).toBe('');
      expect(auf8193!.buSchluessel).toBe('');
      expect(auf8191!.buSchluessel).toBe('');

      // Von Hand: 11900 Cent auf dem 19er Konto, 6000 Cent Einkaufsanteil,
      // 4000 Cent Marge. Einkaufsanteil und Marge ergeben zusammen genau die
      // 10000 Cent der Muenze.
      expect(datevZuCent(auf8400!.umsatz)).toBe(11900n);
      expect(datevZuCent(auf8193!.umsatz)).toBe(6000n);
      expect(datevZuCent(auf8191!.umsatz)).toBe(4000n);
      expect(datevZuCent(auf8193!.umsatz) + datevZuCent(auf8191!.umsatz)).toBe(10000n);
      // Alle drei auf DERSELBEN Seite wie der Beleg (S) — das Minus liefert
      // die Generalumkehr-Marke, nicht die Seite.
      for (const z of [auf8400!, auf8193!, auf8191!]) {
        expect(z.sollHaben).toBe('S');
        expect(z.generalumkehr).toBe('1');
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Der Storno einer GETEILTEN Zahlung
  // ══════════════════════════════════════════════════════════════════════════

  describe('Der Storno einer geteilten Zahlung', () => {
    /**
     * 119,00 brutto, bezahlt mit 60,00 bar und 59,00 mit Karte.
     * Von Hand: 6000 + 5900 = 11900 Cent.
     */
    async function baueGeteilteZahlungUndStorno(): Promise<{
      tag: string;
      stornoId: string;
    }> {
      const { tag, jetzt } = await heute();
      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: jetzt,
        items: [
          {
            productId: produkt,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payments: [
          { method: 'CASH', amount: '60.00' },
          { method: 'ZVT_CARD', amount: '59.00' },
        ],
        // Ein gewoehnlicher Tag: die Sicherungseinrichtung hat jeden Beleg
        // signiert. Ein Beleg OHNE Signatur ist ein Ausfall, kein Alltag.
        tse: true,
      });
      const storno = await storniereUeberHttp(beleg.id, 'Umtausch am selben Tag');
      return { tag, stornoId: storno.id };
    }

    it('JEDE Zahlart kehrt einzeln um, und die Kasse bekommt genau den Baranteil zurueck', async () => {
      const { stornoId } = await baueGeteilteZahlungUndStorno();

      const beine = await buehne.migratorSql<{ payment_method: string; amount_eur: string }[]>`
        SELECT payment_method::text AS payment_method, amount_eur::text AS amount_eur
          FROM transaction_payments WHERE transaction_id = ${stornoId}
         ORDER BY created_at, id`;

      // Zwei Beine, nicht ein zusammengefasstes ueber 11900 Cent.
      expect(beine).toHaveLength(2);
      const barBein = beine.find((b) => b.payment_method === 'CASH');
      const kartenBein = beine.find((b) => b.payment_method === 'ZVT_CARD');

      // Von Hand: die Schublade gibt 6000 Cent zurueck, NICHT 11900. Die
      // restlichen 5900 Cent lagen nie in ihr — sie gehen ueber den Geldtransit
      // zurueck.
      expect(zuCent(barBein!.amount_eur)).toBe(-6000n);
      expect(zuCent(kartenBein!.amount_eur)).toBe(-5900n);
    });

    it('in DATEV kehrt jede Zahlart auf IHREM Konto um — die Kasse nur um den Baranteil', async () => {
      const { tag } = await baueGeteilteZahlungUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      const { id } = await schliesseTagAbUeberHttp(tag);

      const res = await buehne.hol(`/api/closings/${id}/export/datev`);
      expect(res.statusCode).toBe(200);
      const buchungen = datevBuchungen(Buffer.from(res.rawPayload));

      // Zwei Zeilen fuer den Beleg (bar + Karte), zwei fuer den Storno.
      expect(buchungen).toHaveLength(4);
      const stornoZeilen = buchungen.filter((b) => b.buchungstext.startsWith('STORNO '));
      expect(stornoZeilen).toHaveLength(2);

      const kasse = stornoZeilen.find((b) => b.konto === '1000');
      const geldtransit = stornoZeilen.find((b) => b.konto === '1361');
      expect(kasse).toBeDefined();
      expect(geldtransit).toBeDefined();

      // Von Hand: 6000 Cent aus der Kasse, 5900 Cent aus dem Geldtransit
      // Kartenterminal. Beide auf der Soll-Seite wie das Original, beide
      // POSITIV geschrieben — das Minus traegt Feld 118.
      expect(datevZuCent(kasse!.umsatz)).toBe(6000n);
      expect(datevZuCent(geldtransit!.umsatz)).toBe(5900n);
      for (const z of [kasse!, geldtransit!]) {
        expect(z.sollHaben).toBe('S');
        expect(z.generalumkehr).toBe('1');
      }

      // Und die Wirkung auf das Konto Kasse ueber den ganzen Tag ist null:
      // +6000 aus dem Beleg, −6000 aus dem Storno.
      const wirkungKasse = buchungen
        .filter((b) => b.konto === '1000')
        .reduce((s, b) => s + wirkungAufKonto(b), 0n);
      expect(wirkungKasse).toBe(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Der Storno eines ANKAUFs
  // ══════════════════════════════════════════════════════════════════════════

  describe('Der Storno eines Ankaufs', () => {
    /**
     * Ankauf ueber 500,00 von einem ausweisgeprueften Verkaeufer, bar
     * ausgezahlt. Ohne Umsatzsteuer (Privatankauf): 50000 + 0 = 50000 Cent.
     */
    async function baueAnkaufUndStorno(): Promise<{ tag: string; stornoId: string }> {
      const { tag, jetzt } = await heute();
      const produkt = await buehne.legeProduktAn({ behandlung: 'MARGIN_25A' });
      const beleg = await buehne.legeBelegAn({
        direction: 'ANKAUF',
        treatment: 'MARGIN_25A',
        subtotal: '500.00',
        vat: '0.00',
        total: '500.00',
        customerId: buehne.akteure.kundeId,
        finalizedAt: jetzt,
        items: [
          {
            productId: produkt,
            treatment: 'MARGIN_25A',
            vatRate: null,
            lineSubtotal: '500.00',
            lineVat: '0.00',
            lineTotal: '500.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '500.00' },
        // Ein gewoehnlicher Tag: die Sicherungseinrichtung hat jeden Beleg
        // signiert. Ein Beleg OHNE Signatur ist ein Ausfall, kein Alltag.
        tse: true,
      });
      const storno = await storniereUeberHttp(beleg.id, 'Ankauf irrtuemlich erfasst');
      return { tag, stornoId: storno.id };
    }

    it('der Abschluss fuehrt den stornierten Ankauf in SEINER eigenen Spalte, positiv', async () => {
      const { tag } = await baueAnkaufUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      await schliesseTagAbUeberHttp(tag);

      const z = await abschlusszeile(tag);

      // Von Hand: ein Ankauf ueber 50000 Cent, ein Storno darauf.
      expect(Number(z.ankauf_count)).toBe(1);
      expect(Number(z.storno_count)).toBe(1);
      expect(zuCent(z.gross_ankauf_eur)).toBe(50000n);
      expect(zuCent(z.storno_ankauf_eur)).toBe(50000n);
      // Der Verkaufs-Storno bleibt davon unberuehrt — die Spalten sind getrennt.
      expect(zuCent(z.storno_verkauf_eur)).toBe(0n);
      // Netto Ankauf zaehlt nur den Beleg: 50000 Cent.
      expect(zuCent(z.net_ankauf_eur)).toBe(50000n);
    });

    it('in DATEV kehrt der Ankauf um: Wareneingang gegen Kasse, mit getauschter Seite', async () => {
      const { tag } = await baueAnkaufUndStorno();
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      const { id } = await schliesseTagAbUeberHttp(tag);

      const res = await buehne.hol(`/api/closings/${id}/export/datev`);
      expect(res.statusCode).toBe(200);
      const buchungen = datevBuchungen(Buffer.from(res.rawPayload));
      expect(buchungen).toHaveLength(2);

      const beleg = buchungen.find((b) => !b.buchungstext.startsWith('STORNO '))!;
      const storno = buchungen.find((b) => b.buchungstext.startsWith('STORNO '))!;

      // Der Ankauf: Wareneingang 3200 im Soll gegen Kasse 1000.
      expect(beleg.konto).toBe('3200');
      expect(beleg.gegenkonto).toBe('1000');
      expect(beleg.sollHaben).toBe('S');

      // Der Storno: DIESELBEN Konten, derselbe (leere) BU-Schluessel,
      // POSITIVER Umsatz, DIESELBE Seite — das Minus traegt Feld 118
      // (Generalumkehr, DATEV Dok.-Nr. 1070379).
      expect(storno.konto).toBe('3200');
      expect(storno.gegenkonto).toBe('1000');
      expect(storno.buSchluessel).toBe(beleg.buSchluessel);
      expect(storno.sollHaben).toBe('S');
      expect(storno.generalumkehr).toBe('1');
      expect(datevZuCent(storno.umsatz)).toBe(50000n);
      expect(storno.umsatz.startsWith('-')).toBe(false);

      // Und das Paar hebt sich exakt auf: +50000 − 50000 = 0 Cent.
      expect(wirkungAufKonto(beleg) + wirkungAufKonto(storno)).toBe(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Ein Tag, der NUR aus Stornos besteht
  // ══════════════════════════════════════════════════════════════════════════

  describe('Ein Tag, der nur aus Stornos besteht', () => {
    it('laesst sich ueber HTTP abschliessen, statt fuer immer gesperrt zu bleiben', async () => {
      // Der Beleg liegt eine WOCHE zurueck, der Storno faellt auf heute. Genau
      // der Dienstag aus Wanderung 0112: der heutige Tag traegt −3.000 ohne die
      // zugehoerigen +3.000. Vor 0112 wurde der Brutto dadurch negativ, der
      // INSERT verletzte `daily_closings_gross_non_negative`, und der Tag liess
      // sich NIE abschliessen — ohne Z-Bon liefern DATEV, Kassenbericht und
      // DSFinV-K fuer ihn gar nichts.
      const { tag } = await heute();
      const [vorigeWoche] = await buehne.migratorSql<{ t: Date }[]>`
        SELECT now() - interval '7 days' AS t`;

      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '2521.01',
        vat: '478.99',
        total: '3000.00',
        // Ueber der GwG-Schwelle von 2.000 EUR am Ladentisch: ohne
        // ausweisgeprueften Kaeufer weist die Datenbank den Beleg ab.
        customerId: buehne.akteure.kundeId,
        finalizedAt: vorigeWoche!.t.toISOString(),
        items: [
          {
            productId: produkt,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '2521.01',
            lineVat: '478.99',
            lineTotal: '3000.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '3000.00' },
        // Ein gewoehnlicher Tag: die Sicherungseinrichtung hat jeden Beleg
        // signiert. Ein Beleg OHNE Signatur ist ein Ausfall, kein Alltag.
        tse: true,
      });

      await storniereUeberHttp(beleg.id, 'Rueckgabe eine Woche nach dem Kauf');
      await legeGeschlosseneSchichtAn('0.00', '0.00');

      // Genau hier stand frueher der 409 — der Tag liess sich nicht schliessen.
      const res = await buehne.sende('/api/closings/finalize', { businessDay: tag });
      expect(res.statusCode).toBe(200);

      const z = await abschlusszeile(tag);
      // Von Hand: heute gab es KEINEN Verkauf (0 Cent brutto) und genau einen
      // Storno ueber 300000 Cent. Der Betrag steht positiv in seiner Spalte.
      expect(Number(z.verkauf_count)).toBe(0);
      expect(Number(z.storno_count)).toBe(1);
      expect(zuCent(z.gross_verkauf_eur)).toBe(0n);
      expect(zuCent(z.storno_verkauf_eur)).toBe(300000n);
      // Und das Netto zaehlt den Storno nicht als Umsatz: 0 Cent, nicht −252101.
      expect(zuCent(z.net_verkauf_eur)).toBe(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. DATEV: das Paar, das sich aufhebt
  // ══════════════════════════════════════════════════════════════════════════

  describe('DATEV: der Storno als Generalumkehr', () => {
    it('gleiche Konten, gleicher BU-Schluessel, POSITIVER Umsatz, Soll und Haben getauscht', async () => {
      const { tag, jetzt } = await heute();
      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: jetzt,
        items: [
          {
            productId: produkt,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '119.00' },
        // Ein gewoehnlicher Tag: die Sicherungseinrichtung hat jeden Beleg
        // signiert. Ein Beleg OHNE Signatur ist ein Ausfall, kein Alltag.
        tse: true,
      });
      await storniereUeberHttp(beleg.id, 'Ware zurueck, Geld zurueck');
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      const { id } = await schliesseTagAbUeberHttp(tag);

      const res = await buehne.hol(`/api/closings/${id}/export/datev`);
      expect(res.statusCode).toBe(200);
      const buchungen = datevBuchungen(Buffer.from(res.rawPayload));
      expect(buchungen).toHaveLength(2);

      const original = buchungen.find((b) => !b.buchungstext.startsWith('STORNO '))!;
      const storno = buchungen.find((b) => b.buchungstext.startsWith('STORNO '))!;

      // Dieselben Konten und derselbe BU-Schluessel — sonst landete die Umkehr
      // in einem anderen Steuertopf als der Beleg, und der Topf des Belegs
      // bliebe fuer immer zu gross.
      expect(storno.konto).toBe(original.konto);
      expect(storno.gegenkonto).toBe(original.gegenkonto);
      expect(storno.buSchluessel).toBe(original.buSchluessel);
      // 19.08.2026: leer — 8400 ist Automatikkonto, das Konto rechnet selbst.
      expect(original.buSchluessel).toBe('');
      expect(storno.belegdatum).toBe(original.belegdatum);

      // POSITIVER Umsatz. Ein negativer Umsatz mit 'S' waere formwidrig; DATEV
      // traegt die Richtung im Kennzeichen, nicht im Vorzeichen.
      expect(storno.umsatz).toBe('119,00');
      expect(datevZuCent(storno.umsatz) > 0n).toBe(true);

      // Gleiche Seite; die Generalumkehr-Marke macht daraus das Minus.
      expect(original.sollHaben).toBe('S');
      expect(original.generalumkehr).not.toBe('1');
      expect(storno.sollHaben).toBe('S');
      expect(storno.generalumkehr).toBe('1');

      // Von Hand: +11900 Cent und −11900 Cent. Das Paar hebt sich exakt auf.
      expect(wirkungAufKonto(original) + wirkungAufKonto(storno)).toBe(0n);
    });

    it('der Storno traegt seine EIGENE Belegnummer, und der Buchungstext weist ihn als Storno aus', async () => {
      const { tag, jetzt } = await heute();
      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: jetzt,
        items: [
          {
            productId: produkt,
            treatment: 'STANDARD_19',
            vatRate: '0.1900',
            lineSubtotal: '100.00',
            lineVat: '19.00',
            lineTotal: '119.00',
            displayOrder: 0,
          },
        ],
        payment: { method: 'CASH', amount: '119.00' },
        // Ein gewoehnlicher Tag: die Sicherungseinrichtung hat jeden Beleg
        // signiert. Ein Beleg OHNE Signatur ist ein Ausfall, kein Alltag.
        tse: true,
      });
      const storno = await storniereUeberHttp(beleg.id, 'Ware zurueck, Geld zurueck');
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      const { id } = await schliesseTagAbUeberHttp(tag);

      const res = await buehne.hol(`/api/closings/${id}/export/datev`);
      const buchungen = datevBuchungen(Buffer.from(res.rawPayload));
      const stornoZeile = buchungen.find((b) => b.buchungstext.startsWith('STORNO '))!;

      // Jeder Beleg traegt seine eigene Nummer — auch der Stornobeleg. Das ist
      // richtig so: der Storno IST ein eigener Beleg mit eigener Nummer, und
      // eine doppelt vergebene Belegnummer waere im Stapel ein Mangel.
      expect(stornoZeile.belegfeld1).toBe(storno.receiptLocator);
      expect(stornoZeile.belegfeld1).not.toBe(beleg.locator);
      expect(stornoZeile.buchungstext).toBe(
        `STORNO VERKAUF ${storno.receiptLocator} (STANDARD_19)`,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. DSFinV-K: einmal, und als Storno gekennzeichnet
  // ══════════════════════════════════════════════════════════════════════════

  describe('DSFinV-K', () => {
    it('der Storno erscheint als eigener Beleg mit umgekehrtem Vorzeichen, GENAU EINMAL', async () => {
      const { tag, jetzt } = await heute();
      const produkt = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: jetzt,
        items: [
          {
            productId: produkt,
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
      const storno = await storniereUeberHttp(beleg.id, 'Rueckgabe direkt nach dem Kauf');
      await legeGeschlosseneSchichtAn('0.00', '0.00');
      const { id } = await schliesseTagAbUeberHttp(tag);

      const res = await buehne.hol(`/api/closings/${id}/export/dsfinvk`);
      expect(res.statusCode).toBe(200);
      const dateien = entpacke(Buffer.from(res.rawPayload));

      // ⚠️ DIE DATEINAMEN STAMMEN AUS DER NORM, NICHT AUS DEM HAUS.
      //
      // Bis zum 28.07.2026 schrieb der Erzeuger `bon_kopf.csv`, `bon_pos.csv`
      // und Geschwister — Namen, die die DSFinV-K nicht kennt. Diese Pruefung
      // verlangte sie woertlich mit und haette den Fund nie machen koennen.
      // Der Kassendatenauszug heisst amtlich `transactions.csv` (Bonkopf) und
      // `lines.csv` (Bonpos), der Betrag `UMS_BRUTTO`.
      const kopf = csvZeilen(dateien.get('transactions.csv') ?? '');
      const spalten = kopf[0]!;
      const iBonId = spalten.indexOf('BON_ID');
      const iBonTyp = spalten.indexOf('BON_TYP');
      const iBrutto = spalten.indexOf('UMS_BRUTTO');
      const zeilen = kopf.slice(1);

      // Genau zwei Belege am Tag: der Verkauf und sein Storno. Nicht drei.
      expect(zeilen).toHaveLength(2);

      const belegZeilen = zeilen.filter((z) => z[iBonId] === beleg.locator);
      const stornoZeilen = zeilen.filter((z) => z[iBonId] === storno.receiptLocator);
      // Jeder GENAU EINMAL — ein doppelt ausgewiesener Storno waere ein
      // doppelter Abzug im Kassendatenauszug.
      expect(belegZeilen).toHaveLength(1);
      expect(stornoZeilen).toHaveLength(1);

      // ⚠️ BEIDE tragen den Vorgangstyp `Beleg`, und das ist die RICHTIGE
      // Darstellung, kein Versaeumnis. Anhang B: der Wert `AVBelegstorno`
      // nimmt dem Pruefer BEIDE Belege aus dem Kassenabschluss und ist an
      // einer Kasse mit Sicherungseinrichtung ausdruecklich nicht mehr
      // verwendbar; die Umkehr gehoert als eigener Beleg mit umgekehrtem
      // Vorzeichen und OHNE Storno-Kennzeichen in den Auszug. Ein
      // `Beleg-Storno` steht in keiner Werteliste der Norm.
      expect(belegZeilen[0]![iBonTyp]).toBe('Beleg');
      expect(stornoZeilen[0]![iBonTyp]).toBe('Beleg');

      // ⚠️ `BON_STORNO` wird hier BEWUSST NICHT festgeschrieben.
      //
      // Gemessen am 04.08.2026 traegt die Stornozeile das Storno-Kennzeichen
      // '1'. Derselbe Absatz aus Anhang B, den `lib/dsfinvk-schluessel.ts`
      // woertlich zitiert, verlangt fuer die negative Darstellung aber den
      // Vorgangstyp `Beleg` „mit umgekehrten Vorzeichen und OHNE
      // Storno-Kennzeichen". Welcher der beiden Werte richtig ist, entscheidet
      // nicht diese Buehne; solange die Frage offen ist, waere jede der beiden
      // Erwartungen eine Festschreibung. Der Befund ist gemeldet.

      // Von Hand: der Storno traegt −11900 Cent brutto, der Urbeleg +11900.
      // ⚠️ Die DSFinV-K schreibt deutsche Dezimalzahlen ('119,00'), genau wie
      // DATEV; deshalb derselbe Umrechner und nicht `zuCent`.
      expect(datevZuCent(stornoZeilen[0]![iBrutto]!)).toBe(-11900n);
      expect(datevZuCent(belegZeilen[0]![iBrutto]!)).toBe(11900n);

      // Damit die Umkehr nicht in der Luft haengt, MUSS der Verweis auf den
      // Urbeleg im Auszug stehen (Tz. 4.2.2). Ohne ihn saehe ein Pruefer zwei
      // unverbundene Belege.
      const verweise = csvZeilen(dateien.get('references.csv') ?? '');
      const vSpalten = verweise[0]!;
      const iVBonId = vSpalten.indexOf('BON_ID');
      const iVRefBonId = vSpalten.indexOf('REF_BON_ID');
      const iVRefTyp = vSpalten.indexOf('REF_TYP');
      const zumStorno = verweise.slice(1).filter((z) => z[iVBonId] === storno.receiptLocator);
      expect(zumStorno).toHaveLength(1);
      expect(zumStorno[0]![iVRefBonId]).toBe(beleg.locator);
      expect(zumStorno[0]![iVRefTyp]).toBe('Transaktion');

      // Und auch die Positionen erscheinen nur einmal je Beleg.
      const pos = csvZeilen(dateien.get('lines.csv') ?? '');
      const posSpalten = pos[0]!;
      const iPosBonId = posSpalten.indexOf('BON_ID');
      const stornoPositionen = pos.slice(1).filter((z) => z[iPosBonId] === storno.receiptLocator);
      expect(stornoPositionen).toHaveLength(1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 8. Die Retoure — derselbe Nachweis fuer `transactions-return.ts`
  // ══════════════════════════════════════════════════════════════════════════

  /*
   * ── ⚠️ 15.08.2026: DAS RETOURE-SZENARIO IST GELOESCHT ──────────────────
   *
   * Hier standen fuenf Saetze ueber `POST /api/transactions/return`. Sie waren
   * seit Wochen gruen und pruefen einen Weg, den es in der Produktion NICHT
   * mehr gibt:
   *
   *   • Die Route wies alles ab, was kein WEB-Verkauf war.
   *   • Seit dem 0.4.0-Kahlschlag (Storefront raus) schreibt NIEMAND mehr
   *     `salesChannel: 'WEB'` — gemessen am 15.08.2026 ueber den ganzen Baum.
   *   • Das Szenario kam trotzdem durch, weil es den WEB-Verkauf per
   *     `buehne.legeBelegAn({ salesChannel: 'WEB' })` DIREKT in die Datenbank
   *     schrieb, an jeder Route vorbei.
   *
   * Das ist die Hausklasse „Buehne modelliert einen unmoeglichen Zustand":
   * gruene Saetze ueber einen Zustand, den kein Nutzer je herstellen kann.
   * Zusaetzlich schrieb die Route in die fiskalische Tabelle, OHNE die
   * Sicherungseinrichtung zu pruefen — gefunden vom neuen Waechter
   * `keine-gnadenfrist-ohne-tse.guard.test.ts`.
   *
   * Route, Registrierung, Wiedervorlage-Eintrag und dieses Szenario sind
   * gemeinsam entfernt. Der STORNO bleibt der Weg fuer eine Rueckabwicklung,
   * und der ist oben in dieser Datei ausfuehrlich geprueft.
   */


  describe('⛔ Ein Abschlusstag in der Zukunft wird abgewiesen', () => {
    /**
     * ── DER BEFUND VOM 08.08.2026 ────────────────────────────────────────
     *
     * `POST /api/closings/finalize` nahm den `businessDay` aus dem Rumpf und
     * benutzte ihn ungeprüft. Ein Zahlendreher versiegelte damit MORGEN, und
     * am nächsten Morgen wies der Auslöser `transactions_validate_closing_day`
     * jeden Verkauf dieses Tages ab. Ohne Weg zurück: einen festgeschriebenen
     * Abschluss kann niemand aufheben, das ist der Sinn von § 146 Abs. 4 AO.
     *
     * Dieser Satz geht über den ECHTEN HTTP-Weg, nicht an der reinen Regel
     * vorbei — der Riegel könnte sonst geschrieben und nie angeschlossen sein.
     */
    function inTagen(n: number): string {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    }

    it('morgen: 422 mit einer Begründung, die den Tag NENNT', async () => {
      const morgen = inTagen(2); // zwei Tage, damit keine Zeitzone dazwischenfunkt
      const res = await buehne.sende('/api/closings/finalize', { businessDay: morgen });
      expect(res.statusCode, res.body).toBe(422);
      const rumpf = res.json() as { error?: { message?: string; code?: string } };
      // ⚠️ Ohne die 422 in der Antwortliste der Route entfernt Fastify die
      // Begründung STILL, und der Mensch am Abschluss sähe eine leere Fehlseite.
      expect(rumpf.error?.message, res.body).toContain(morgen);
      expect(rumpf.error?.message, res.body).toContain('Zukunft');
    });

    /**
     * ⚠️ EHRLICH GEMESSEN: dieser Satz wird NICHT rot, wenn man nur die
     * Zukunftsprüfung entfernt. Für morgen gibt es keine geschlossene Schicht,
     * also verweigert der Abschluss ohnehin, und die Zeile entstünde auch ohne
     * Riegel nicht. Er fängt den schlimmeren Fall: Riegel weg UND eine Schicht
     * vorhanden. Der Satz darüber ist der, der die Sabotage sieht.
     */
    it('und der Tag ist danach WIRKLICH nicht festgeschrieben', async () => {
      const morgen = inTagen(2);
      await buehne.sende('/api/closings/finalize', { businessDay: morgen });
      const zeilen = await buehne.migratorSql`
        SELECT id FROM daily_closings WHERE business_day = ${morgen}::date`;
      expect(zeilen.length, 'der Zukunftstag darf keine Abschlusszeile haben').toBe(0);
    });

    it('ein unmögliches Datum wird ebenfalls abgewiesen, nicht an Postgres gereicht', async () => {
      const res = await buehne.sende('/api/closings/finalize', { businessDay: '2026-02-30' });
      expect(res.statusCode, res.body).toBe(422);
    });
  });
});
