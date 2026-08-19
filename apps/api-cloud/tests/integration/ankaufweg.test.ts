/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER ANKAUFWEG — ZUM ERSTEN MAL ÜBER HTTP GEFAHREN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM ES DIESE DATEI ERST SEIT DEM 12.08.2026 GIBT ────────────────────
 *
 * Für einen Edelmetallhändler ist der Ankauf fast jeder zweite Vorgang. Die
 * Route `POST /api/transactions/ankauf` führt in die fiskalische Tabelle und
 * in die Lade — und hatte NULL Proben über HTTP. Gemessen im Bereitschafts-
 * lauf: `grep "transactions/ankauf" tests/` fand keinen Treffer; was die
 * Fiskalkette prüfte, war `direction: 'ANKAUF'` durch `finalize` oder ein per
 * SQL gesetzter Beleg. Jede Änderung an Betragsprüfung, Schichtbindung,
 * KYC-Riegel oder Produktanlage dieses Weges wäre keinem Satz aufgefallen.
 *
 * ── WAS HIER GEMESSEN WIRD ────────────────────────────────────────────────
 *
 * Der ECHTE Weg gegen ein echtes Postgres: die Riegel (TSE, KYC nach § 259
 * StGB, Auszahlungsart), der glückliche Fall mit seinen Zeilen in
 * `transactions`, `transaction_items`, `transaction_payments` und `products`,
 * die Schicht an der Zeile, die Idempotenz — und dass die LADE den Ankauf
 * zählt: ein Kassensturz nach dem Ankauf geht mit Abweichung 0,00 auf.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PII_SCHLUESSEL, baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

/** Ein ehrlicher Ankaufsposten: ein Goldring, 380,00 EUR bar an den Verkäufer. */
function posten(sku: string) {
  return {
    sku,
    itemType: 'gold_jewelry',
    condition: 'USED_GOOD',
    taxTreatmentCode: 'MARGIN_25A',
    name: 'Goldring 585, Erbstück',
    listPriceEur: '520.00',
    negotiatedPriceEur: '380.00',
    publishImmediately: false,
    hallmarkStamps: [],
  };
}

describe('Der Ankaufweg über HTTP', () => {
  const buehne = baueFiskalBuehne();

  beforeAll(async () => {
    await buehne.starten();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
  });

  async function oeffneSchicht(anfang: string): Promise<string> {
    const res = await buehne.sende('/api/shifts/open', { openingFloatEur: anfang });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { id: string }).id;
  }

  /**
   * ══════════════════════════════════════════════════════════════════════
   *  ⛔ OHNE SICHERUNGSEINRICHTUNG KEIN ANKAUF — AB DEM ERSTEN
   * ══════════════════════════════════════════════════════════════════════
   *
   * Dieser Satz hiess am 02.08.2026 „§ 146a AO kennt keine Ausnahme", wurde
   * am 13.08. auf die Gnadenfrist von zehn Belegen umgeschrieben, und kehrt
   * am 15.08.2026 zu seiner ersten Fassung zurueck: Basel hat die Frist nach
   * der Rechtspruefung gestrichen.
   *
   * Die Rundreise gehoert in die Datei, weil sie die Lehre traegt: ein Test
   * ist so lange richtig, wie die Regel gilt, die er behauptet — und wer die
   * Regel aendert, muss den Test MITaendern, sonst pinnt er den geloeschten
   * Zustand fest.
   */
  it('⛔ ohne Sicherungseinrichtung wird schon der ERSTE Ankauf abgewiesen', async () => {
    await buehne.migratorSql`DELETE FROM system_settings WHERE key = 'tse.tss_id'`;
    await oeffneSchicht('200.00');

    const res = await buehne.sende('/api/transactions/ankauf', {
      customerId: buehne.akteure.kundeId,
      payoutMethod: 'CASH',
      totalEur: '380.00',
      items: [posten('ANK-TSE-1')],
    });

    expect(res.statusCode, res.body).toBe(409);
    expect(res.body).toContain('keine technische Sicherheitseinrichtung');
    expect(res.body).toContain('Ankauf');

    // ⛔ Und es entsteht KEINE Zeile: weder ein Beleg noch ein Stueck.
    const zeilen = await buehne.migratorSql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM transactions`;
    expect(zeilen[0]?.n, 'trotz Abweisung wurde gebucht').toBe(0);
  });

  it('⛔ ohne geprüften Ausweis wird KEIN Ankauf angenommen (§ 259 StGB, ab dem ersten Cent)', async () => {
    // Ein Verkäufer OHNE kyc_verified_at — angelegt wie die Bühne ihren
    // geprüften anlegt, nur ohne die Prüfung.
    const [ohneKyc] = await buehne.migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_SCHLUESSEL}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Unbekannter Verkaeufer'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    expect(ohneKyc).toBeDefined();

    const res = await buehne.sende('/api/transactions/ankauf', {
      customerId: ohneKyc?.id,
      payoutMethod: 'CASH',
      totalEur: '380.00',
      items: [posten('ANK-KYC-1')],
    });
    expect(res.statusCode, res.body).toBe(403);
    expect(res.body).toContain('259');
  });

  it('⛔ Überweisung ohne Verwendungszweck wird abgewiesen', async () => {
    const res = await buehne.sende('/api/transactions/ankauf', {
      customerId: buehne.akteure.kundeId,
      payoutMethod: 'BANK_TRANSFER',
      totalEur: '380.00',
      items: [posten('ANK-BANK-1')],
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  /**
   * ⛔ DER BEFUND VOM 12.08.2026 — DER HALBE FIX AN DERSELBEN AMPEL
   *
   * Verkauf und Storno weisen seit dem 08.08.2026 eine BARzahlung ohne
   * offene Schicht ab. Der Ankauf tat es nicht: er setzte still
   * `shiftId = null` und zahlte trotzdem aus. Der Kassensturz zählt
   * Auszahlungen nur über `t.shift_id = <Schicht>` oder den Storno-Zweig —
   * ein gewöhnlicher Ankauf ohne Schicht fällt durch beide. Der erwartete
   * Ladenbestand bleibt um die volle Auszahlung zu hoch, und der
   * Tagesabschluss schreibt diesen nie geschehenen Fehlbetrag unveränderlich
   * fest.
   *
   * Bei Edelmetall sind das schnell mehrere tausend Euro in EINEM Vorgang.
   */
  it('⛔ BAR-Ankauf OHNE offene Schicht wird abgewiesen — sonst lügt die Lade', async () => {
    // KEINE Schicht geöffnet. Genau die Lage nach einem Schichtschluss oder
    // wenn der Kassierer das Öffnen vergisst.
    const res = await buehne.sende('/api/transactions/ankauf', {
      customerId: buehne.akteure.kundeId,
      payoutMethod: 'CASH',
      totalEur: '5000.00',
      items: [{ ...posten('ANK-OHNE-SCHICHT-1'), negotiatedPriceEur: '5000.00' }],
    });

    expect(res.statusCode, res.body).toBe(409);
    // Der Kassierer liest, WAS zu tun ist — nicht nur, dass es nicht geht.
    expect(res.body).toContain('Schicht');

    // Und es liegt WIRKLICH nichts in der fiskalischen Tabelle: kein halber
    // Ankauf, kein Produkt, keine Auszahlung.
    const [n] = await buehne.migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM transactions`;
    expect(n?.n, 'ein Beleg ist trotz Riegel entstanden').toBe('0');
    const [p] = await buehne.migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM products WHERE sku = 'ANK-OHNE-SCHICHT-1'`;
    expect(p?.n, 'ein Produkt ist trotz Riegel entstanden').toBe('0');
  });

  it('eine ÜBERWEISUNG ohne Schicht bleibt erlaubt — sie verlässt die Lade nicht', async () => {
    // Der Riegel darf nur so weit reichen, wie der Schaden geht. Geld, das
    // nie in der Schublade lag, verfälscht keinen Kassensturz.
    const res = await buehne.sende('/api/transactions/ankauf', {
      customerId: buehne.akteure.kundeId,
      payoutMethod: 'BANK_TRANSFER',
      payoutExternalRef: 'SEPA-2026-08-12-0001',
      totalEur: '380.00',
      items: [posten('ANK-OHNE-SCHICHT-2')],
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('der glückliche Fall: Beleg, Position, Auszahlung, Produkt — und die SCHICHT an der Zeile', async () => {
    const schichtId = await oeffneSchicht('500.00');

    const res = await buehne.sende('/api/transactions/ankauf', {
      customerId: buehne.akteure.kundeId,
      payoutMethod: 'CASH',
      totalEur: '380.00',
      items: [posten('ANK-GLUECK-1')],
    });
    expect(res.statusCode, res.body).toBe(200);
    const antwort = res.json() as { transactionId: string; receiptLocator: string };
    expect(antwort.receiptLocator).toBeTruthy();

    const [beleg] = await buehne.migratorSql<
      { direction: string; schicht: string | null; total: string }[]
    >`
      SELECT direction::text AS direction, shift_id::text AS schicht, total_eur::text AS total
        FROM transactions WHERE id = ${antwort.transactionId}::uuid`;
    expect(beleg?.direction).toBe('ANKAUF');
    expect(beleg?.total).toBe('380.00');
    // ⚠️ Die Schicht AN DER ZEILE — dieselbe Regel, die der Storno am 11.08.
    // bekommen hat. Ohne sie fiele dieses Bargeld aus dem Kassensturz.
    expect(beleg?.schicht, 'der Ankauf traegt keine Schicht').toBe(schichtId);

    const [posi] = await buehne.migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM transaction_items WHERE transaction_id = ${antwort.transactionId}::uuid`;
    expect(posi?.n).toBe('1');
    const [zahlung] = await buehne.migratorSql<{ methode: string; betrag: string }[]>`
      SELECT payment_method::text AS methode, amount_eur::text AS betrag
        FROM transaction_payments WHERE transaction_id = ${antwort.transactionId}::uuid`;
    expect(zahlung?.methode).toBe('CASH');
    expect(zahlung?.betrag).toBe('380.00');
    // Das Stück liegt als Ware im Bestand, mit dem GEZAHLTEN Preis als
    // Anschaffungskosten — daraus rechnet später die § 25a Marge.
    const [produkt] = await buehne.migratorSql<{ kosten: string; status: string }[]>`
      SELECT acquisition_cost_eur::text AS kosten, status::text AS status
        FROM products WHERE sku = 'ANK-GLUECK-1'`;
    expect(produkt?.kosten).toBe('380.00');
    expect(produkt?.status).toBe('DRAFT');
  });

  it('die LADE zählt den Ankauf: Kassensturz nach Auszahlung geht mit 0,00 auf', async () => {
    const schichtId = await oeffneSchicht('500.00');
    const res = await buehne.sende('/api/transactions/ankauf', {
      customerId: buehne.akteure.kundeId,
      payoutMethod: 'CASH',
      totalEur: '380.00',
      items: [posten('ANK-LADE-1')],
    });
    expect(res.statusCode, res.body).toBe(200);

    // 500,00 Anfang, 380,00 bar hinausgegeben: in der Lade liegen 120,00.
    const zu = await buehne.sende(`/api/shifts/${schichtId}/close`, { blindCountEur: '120.00' });
    expect(zu.statusCode, zu.body).toBe(200);
    const sturz = zu.json() as { systemExpectedEur: string; varianceEur: string };
    expect(sturz.systemExpectedEur, 'der Sollbestand kennt die Auszahlung nicht').toBe('120.00');
    expect(sturz.varianceEur).toBe('0.00');
  });

  it('derselbe Idempotenzschlüssel bucht KEINE zweite Auszahlung', async () => {
    await oeffneSchicht('500.00');
    const schluessel = '99999999-1111-2222-3333-444444444444';
    const rumpf = {
      customerId: buehne.akteure.kundeId,
      payoutMethod: 'CASH',
      totalEur: '380.00',
      idempotencyKey: schluessel,
      items: [posten('ANK-IDEM-1')],
    };
    const erster = await buehne.sende('/api/transactions/ankauf', rumpf);
    expect(erster.statusCode, erster.body).toBe(200);
    const zweiter = await buehne.sende('/api/transactions/ankauf', rumpf);
    expect(zweiter.statusCode, zweiter.body).toBe(200);
    expect((zweiter.json() as { transactionId: string }).transactionId).toBe(
      (erster.json() as { transactionId: string }).transactionId,
    );
    const [n] = await buehne.migratorSql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM transactions WHERE direction = 'ANKAUF'`;
    expect(n?.n, 'der Doppelklick hat ZWEI Auszahlungen gebucht').toBe('1');
  });
});
