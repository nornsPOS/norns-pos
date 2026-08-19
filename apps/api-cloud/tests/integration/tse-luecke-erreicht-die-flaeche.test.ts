/**
 * ════════════════════════════════════════════════════════════════════════
 *  „alles signiert" war eine Konstante, keine Messung
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 *     closings-finalize.ts:590        ${finished}, ${pending}, 0,
 *     Kommentar Zeile 477             „tse_failed is not yet wired to a
 *                                      failure source — reported as 0"
 *
 * `tse_failed_count` wird als feste NULL geschrieben, in der Quelle UND im
 * ausgelieferten Bündel. Ein Kommentar ist kein Riegel.
 *
 * Die Steuerfläche rechnete daraus:
 *
 *     SteuerExport.tsx:271            const tseClean = closing.tseFailedCount === 0;
 *
 * Also auf JEDER Zeile, immer, wahr. Ein Tag mit zwölf unsignierten Belegen
 * trug ein grünes „alles signiert", während `tse_pending_count = 12` in
 * derselben Datenbankzeile stand. Das ist die Fläche, die ein Prüfer bei
 * einer Kassennachschau als erstes aufschlägt.
 *
 * ── ⚠️ WARUM DIESER TEST ÜBER HTTP GEHT ────────────────────────────────
 *
 * Die ehrliche Zahl steht seit jeher in der Datenbank. Sie fehlte in der
 * Abfrage UND im Antwortschema — und ein Fastify-Antwortschema ENTFERNT
 * still, was es nicht kennt. Ein Test, der die Route direkt aufruft oder
 * nur die Abfrage prüft, bliebe grün, während das Feld auf dem Weg nach
 * draussen verschwindet.
 *
 * Deshalb: echter Aufruf, echte Antwort, echtes Feld.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

const buehne = baueFiskalBuehne({ geschaeftstag: '2026-05-11' });

const TAG = '2026-05-11';

beforeAll(async () => {
  await buehne.starten();
}, 180_000);

afterAll(async () => {
  await buehne.stoppen();
});

beforeEach(async () => {
  await buehne.leeren();
  await buehne.saeeFiskalischeVoraussetzungen();
});

/** Ein Abschluss mit einer bestimmten Zahl unsignierter Belege. */
async function legeAbschlussMitLuecke(offen: number): Promise<void> {
  const produktId = await buehne.legeProduktAn();
  await buehne.legeBelegAn({
    direction: 'VERKAUF',
    treatment: 'STANDARD_19',
    subtotal: '84.03',
    vat: '15.97',
    total: '100.00',
    customerId: null,
    finalizedAt: buehne.ts(10, 0, TAG),
    items: [
      {
        productId: produktId,
        treatment: 'STANDARD_19',
        vatRate: '0.1900',
        lineSubtotal: '84.03',
        lineVat: '15.97',
        lineTotal: '100.00',
        displayOrder: 1,
      },
    ],
    payment: { method: 'CASH', amount: '100.00' },
  });
  /**
   * ⚠️ Die Lücke wird BEIM ANLEGEN gesetzt, nicht danach.
   *
   * Die erste Fassung dieses Prüfstands versuchte ein UPDATE auf den fertigen
   * Abschluss und wurde von der Datenbank abgewiesen:
   *
   *     Cannot modify FINALIZED closing — only notes is mutable after
   *     finalization
   *
   * Das ist § 146 Abs. 4 AO, als Auslöser gegossen. Der Riegel hat gewirkt,
   * mein Prüfstand war falsch. Gemessen wird der Weg NACH DRAUSSEN, nicht die
   * Frage, wie die Zahl zustande kommt — also genügt es, sie mitzugeben.
   */
  await buehne.legeAbschlussAn({ geschaeftstag: TAG, tseOffen: offen });
}

describe('⛔ Die Zahl der unsignierten Belege erreicht die Fläche', () => {
  it('⛔ eine Lücke von zwölf kommt als zwölf an', async () => {
    /**
     * Der Kern. Ohne die Zeile im Antwortschema entfernt Fastify das Feld,
     * und `tsePendingCount` ist hier `undefined`.
     */
    await legeAbschlussMitLuecke(12);

    const antwort = await buehne.hol('/api/closings');
    expect(antwort.statusCode, antwort.body.slice(0, 300)).toBe(200);

    const zeile = JSON.parse(antwort.body).items[0] as {
      tsePendingCount?: number;
      tseFailedCount?: number;
    };
    expect(zeile.tsePendingCount, 'das Feld kommt gar nicht an').toBeDefined();
    expect(zeile.tsePendingCount).toBe(12);
  }, 90_000);

  it('⚠️ und ein sauberer Tag meldet null', async () => {
    // Gegenprobe: sonst wäre „kommt an" auch erfüllt, wenn immer zwölf käme.
    await legeAbschlussMitLuecke(0);

    const antwort = await buehne.hol('/api/closings');
    const zeile = JSON.parse(antwort.body).items[0] as { tsePendingCount?: number };
    expect(zeile.tsePendingCount).toBe(0);
  }, 90_000);

  it('⚠️ die alte Konstante steht weiter auf null, und das ist ehrlich', async () => {
    /**
     * `tse_failed_count` bleibt bewusst eine Null: es gibt bis heute keine
     * Quelle, die „fehlgeschlagen" von „ausstehend" unterscheidet. Eine
     * erfundene wäre genau die Klasse fabricate-when-unconfigured.
     *
     * Deshalb darf die Fläche sich NICHT allein auf sie stützen — was der
     * erste Fall misst.
     */
    await legeAbschlussMitLuecke(3);

    const antwort = await buehne.hol('/api/closings');
    const zeile = JSON.parse(antwort.body).items[0] as {
      tseFailedCount: number;
      tsePendingCount: number;
    };
    expect(zeile.tseFailedCount).toBe(0);
    expect(zeile.tsePendingCount).toBe(3);
    // Und damit ist die Summe, aus der die Fläche urteilt, nicht null.
    expect(zeile.tseFailedCount + zeile.tsePendingCount).toBe(3);
  }, 90_000);
});
