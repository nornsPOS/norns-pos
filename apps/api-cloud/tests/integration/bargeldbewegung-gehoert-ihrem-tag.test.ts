/**
 * ════════════════════════════════════════════════════════════════════════
 *  Eine Bargeldbewegung gehört ihrem EIGENEN Tag, nicht dem Schliesstag
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 *     closing-export.ts:1045
 *       JOIN shifts s ON s.id = cm.shift_id
 *      WHERE s.status = 'CLOSED'
 *        AND berlin_business_day(s.closed_at) = <tag>
 *
 * Die Bewegung gehörte dem Tag, an dem ihre SCHICHT geschlossen wurde.
 * Gemessen sind Schichten über mehrere Tage der Normalfall — das Gerät steht
 * nachts in der Theke, eine gemessene Schicht lief 33 Tage. Eine
 * Bankabschöpfung vom Ersten erschien dann im Auszug des Dreiunddreissigsten,
 * und im Auszug ihres EIGENEN Tages in KEINER Zeile.
 *
 * § 146 Abs. 1 Satz 2 AO verlangt die tägliche Aufzeichnung. Ein Blatt, auf
 * dem eine Barbewegung ein Datum trägt, das ihrem eigenen Zeitstempel
 * widerspricht, verletzt das direkt vor den Augen des Prüfers.
 *
 * ── ⚠️ WARUM ES SO LANGE STAND ─────────────────────────────────────────
 *
 * Keine einzige bestehende Prüfung legt je eine Bargeldbewegung an. Der Weg
 * von der Datenbank in die DATEV-Datei war testfrei. Diese Datei ist die
 * erste, die ihn wirklich fährt.
 *
 * ── ⚠️ WAS HIER BEWUSST NICHT GEPRÜFT WIRD ────────────────────────────
 *
 * Der KASSENBERICHT bleibt vorerst auf der Schichtzuordnung. Dort hängt der
 * Anfangsbestand an derselben Regel, und eine halbe Umstellung druckt einen
 * erwarteten Endbestand von minus 300,00 EUR. Eine ausgerechnete FALSCHE
 * Zahl auf einer Aufzeichnung nach § 146 AO ist schlimmer als eine fehlende.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

const buehne = baueFiskalBuehne({ geschaeftstag: '2026-05-04' });

/** Der Tag, an dem die Bewegung WIRKLICH stattfand. */
const TAG_DER_BEWEGUNG = '2026-05-04';
/** Der Tag, an dem die Schicht erst geschlossen wird. Zwei Tage später. */
const TAG_DES_SCHLUSSES = '2026-05-06';

let schichtId: string;

beforeAll(async () => {
  await buehne.starten();
}, 180_000);

afterAll(async () => {
  await buehne.stoppen();
});

beforeEach(async () => {
  await buehne.leeren();
  await buehne.saeeFiskalischeVoraussetzungen();

  /**
   * Eine Schicht, die über mehrere Tage läuft — der gemessene Normalfall
   * eines Geräts, das nachts in der Theke steht.
   */
  const [s] = await buehne.migratorSql<{ id: string }[]>`
    INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status, opened_at)
    VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.kassiererId}, '100.00',
            'OPEN'::shift_status, ${buehne.ts(8, 0, TAG_DER_BEWEGUNG)}::timestamptz)
    RETURNING id`;
  schichtId = s!.id;
});

/** Eine Bankabschöpfung an einem bestimmten Tag, in einer laufenden Schicht. */
async function legeBewegungAn(tag: string, betrag: string): Promise<string> {
  const [b] = await buehne.migratorSql<{ id: string }[]>`
    INSERT INTO cash_movements (shift_id, direction, amount_eur, reason, performed_by_user_id, created_at)
    VALUES (${schichtId}, 'BANK_DROP'::cash_movement_direction, ${betrag},
            'Bankabschöpfung', ${buehne.akteure.kassiererId},
            ${buehne.ts(16, 0, tag)}::timestamptz)
    RETURNING id`;
  return b!.id;
}

/**
 * Ein echter Verkauf an diesem Tag.
 *
 * ⚠️ Nicht Beiwerk: `legeAbschlussAn` verlangt einen Anker in der
 * Beweiskette, und ohne einen Beleg gibt es keinen. Ein Tag ohne Umsatz
 * waere ausserdem kein ehrlicher Prueffall fuer einen DATEV-Stapel.
 */
async function legeVerkaufAn(tag: string): Promise<void> {
  const produktId = await buehne.legeProduktAn();
  await buehne.legeBelegAn({
    direction: 'VERKAUF',
    // ⚠️ Regelsteuersatz statt § 25a: eine Margenposition braucht einen
    // Einkaufspreis, und ohne ihn weist der DATEV-Export seit dem 08.08. zu
    // Recht mit 409 ab. Gemessen wird hier die Bargeldbewegung, nicht die
    // Marge.
    treatment: 'STANDARD_19',
    subtotal: '226.89',
    vat: '43.11',
    total: '270.00',
    customerId: null,
    finalizedAt: buehne.ts(10, 0, tag),
    items: [
      {
        productId: produktId,
        treatment: 'STANDARD_19',
        vatRate: '0.1900',
        lineSubtotal: '226.89',
        lineVat: '43.11',
        lineTotal: '270.00',
        displayOrder: 1,
      },
    ],
    payment: { method: 'CASH', amount: '270.00' },
  });
}

/** Der DATEV-Stapel des Tages, als Text. */
async function datevFuer(tag: string): Promise<string> {
  await legeVerkaufAn(tag);
  const abschlussId = await buehne.legeAbschlussAn({ geschaeftstag: tag });
  const antwort = await buehne.hol(`/api/closings/${abschlussId}/export/datev`);
  expect(antwort.statusCode, antwort.body.slice(0, 300)).toBe(200);
  // Der Server sendet Windows-1252-Bytes; für die Suche genügt die
  // verlustfreie Umschrift der ASCII-Anteile.
  return Buffer.from(antwort.rawPayload).toString('latin1');
}

describe('⛔ Die Bewegung steht im Auszug IHRES Tages', () => {
  it('⛔ eine Abschöpfung vom 4. steht im DATEV-Stapel des 4.', async () => {
    /**
     * Der Kern des Befunds. Vorher stand sie dort NICHT: die Schicht war am
     * 4. noch offen, und der alte `WHERE s.status = 'CLOSED'` warf sie ganz
     * aus dem Auszug.
     */
    const id = await legeBewegungAn(TAG_DER_BEWEGUNG, '300.00');
    const stapel = await datevFuer(TAG_DER_BEWEGUNG);
    expect(stapel, 'die Bewegung fehlt im Auszug ihres eigenen Tages').toContain(
      `KB-${id.slice(0, 8)}`,
    );
  }, 60_000);

  it('⛔ und sie steht NICHT im Stapel eines fremden Tages', async () => {
    /**
     * Die Gegenrichtung. Ohne sie wäre „steht drin" auch dann erfüllt, wenn
     * der Auszug schlicht alle Bewegungen jedes Tages enthielte — und dann
     * stünde dieselbe Abschöpfung in jedem Monatsstapel erneut.
     */
    const id = await legeBewegungAn(TAG_DER_BEWEGUNG, '300.00');
    const fremder = await datevFuer('2026-05-05');
    expect(fremder, 'die Bewegung erscheint an einem fremden Tag').not.toContain(
      `KB-${id.slice(0, 8)}`,
    );
  }, 60_000);

  it('⚠️ eine noch OFFENE Schicht hält die Bewegung nicht mehr zurück', async () => {
    /**
     * `s.status = 'CLOSED'` war die zweite Hälfte des Befunds: solange die
     * Schicht lief, fiel die Bewegung ganz aus dem Auszug. Der TAG ist aber
     * abgeschlossen, und damit gehört sie hinein.
     */
    const id = await legeBewegungAn(TAG_DER_BEWEGUNG, '250.00');
    const [offen] = await buehne.migratorSql<{ status: string }[]>`
      SELECT status::text AS status FROM shifts WHERE id = ${schichtId}`;
    expect(offen!.status, 'die Vorrichtung stimmt nicht mehr').toBe('OPEN');

    const stapel = await datevFuer(TAG_DER_BEWEGUNG);
    expect(stapel).toContain(`KB-${id.slice(0, 8)}`);
  }, 60_000);

  it('⚠️ und der Betrag steht wirklich auf dem Blatt, nicht nur die Kennung', async () => {
    // Eine Belegnummer ohne Betrag wäre eine Zeile, die nichts bucht.
    await legeBewegungAn(TAG_DER_BEWEGUNG, '300.00');
    const stapel = await datevFuer(TAG_DER_BEWEGUNG);
    expect(stapel).toMatch(/300,00/);
  }, 60_000);
});

describe('⚠️ Der Schliesstag zieht nichts Fremdes mehr herein', () => {
  it('⛔ eine Bewegung vom 4. taucht im Stapel des SCHLIESSTAGES nicht auf', async () => {
    /**
     * Genau das war die alte Wirkung: die Abschöpfung vom Ersten erschien im
     * Auszug des Dreiunddreissigsten. Hier zwei Tage statt dreiunddreissig,
     * dieselbe Mechanik.
     */
    const id = await legeBewegungAn(TAG_DER_BEWEGUNG, '300.00');

    await buehne.migratorSql`
      UPDATE shifts
         SET status = 'CLOSED'::shift_status,
             closed_at = ${buehne.ts(20, 0, TAG_DES_SCHLUSSES)}::timestamptz,
             closed_by_user_id = ${buehne.akteure.kassiererId},
             blind_count_eur = '100.00',
             system_expected_eur = '100.00'
       WHERE id = ${schichtId}`;

    const stapel = await datevFuer(TAG_DES_SCHLUSSES);
    expect(stapel, 'die Bewegung wandert weiter an den Schliesstag').not.toContain(
      `KB-${id.slice(0, 8)}`,
    );
  }, 60_000);
});
