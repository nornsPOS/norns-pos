/**
 * Rauchprobe der Fiskal-Buehne — `tests/helfer/fiskal-buehne.ts`.
 *
 * Sie beweist genau das, worauf die fuenf kommenden Szenariendateien bauen:
 * die Buehne faehrt hoch, legt einen Beleg an, legt einen Abschluss an, und der
 * DATEV-Weg der ECHTEN Anwendung antwortet mit 200.
 *
 * Der Beleg wird bewusst GETEILT bezahlt (bar + Karte). Das ist die eine
 * Faehigkeit, die die alte Vorlage nicht hatte — sie schrieb genau eine Zahlung
 * je Beleg — und die es auf der Produktion wirklich gibt. Zwei Beine, die auf
 * den Kopfbetrag aufgehen, kommen am DATEV-Ende als ZWEI Buchungszeilen an:
 * die Kasse nimmt nur den Barteil auf, der Kartenteil laeuft ueber den
 * Geldtransit. Genau deshalb muss die Buehne das koennen.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

describe('Fiskal-Buehne — Rauchprobe', () => {
  const buehne = baueFiskalBuehne({ geschaeftstag: '2026-06-08' });

  beforeAll(async () => {
    await buehne.starten();
  }, 120_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
  });

  it('faehrt hoch, nimmt einen geteilt bezahlten Beleg, schliesst den Tag ab und liefert DATEV', async () => {
    const produkt = await buehne.legeProduktAn();

    // 119,00 brutto = 100,00 netto + 19,00 USt, bezahlt mit 60,00 bar und
    // 59,00 per Karte. Von Hand nachgerechnet: 6000 + 5900 = 11900 Cent.
    const beleg = await buehne.legeBelegAn({
      direction: 'VERKAUF',
      treatment: 'STANDARD_19',
      subtotal: '100.00',
      vat: '19.00',
      total: '119.00',
      customerId: null,
      finalizedAt: buehne.ts(9, 0),
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
      tse: true,
    });

    // Beide Beine sind wirklich gelandet — der Ausgleichswaechter aus 0016
    // haette den COMMIT sonst zurueckgewiesen, aber gezaehlt wird trotzdem.
    const zahlungen = await buehne.migratorSql<{ payment_method: string; amount_eur: string }[]>`
      SELECT payment_method::text AS payment_method, amount_eur::text AS amount_eur
        FROM transaction_payments WHERE transaction_id = ${beleg.id}
       ORDER BY created_at`;
    expect(zahlungen).toHaveLength(2);
    expect(zahlungen.map((z) => z.payment_method).sort()).toEqual(['CASH', 'ZVT_CARD']);

    const abschlussId = await buehne.legeAbschlussAn({
      geschaeftstag: buehne.geschaeftstag,
      verkaufAnzahl: 1,
      bruttoVerkauf: '119.00',
      nettoVerkauf: '100.00',
      ustJeBehandlung: { STANDARD_19: '19.00' },
      zahlungenJeArt: { CASH: '60.00', ZVT_CARD: '59.00' },
      kasseErwartet: '60.00',
      kasseGezaehlt: '60.00',
      kasseAbweichung: '0.00',
      tseFertig: 1,
    });

    const res = await buehne.hol(`/api/closings/${abschlussId}/export/datev`);
    expect(res.statusCode).toBe(200);

    // Die Datei ist ANSI (Windows-1252), deshalb die ROHEN Bytes lesen.
    const csv = Buffer.from(res.rawPayload).toString('latin1');
    const zeilen = csv.split('\r\n').filter((l) => l.length > 0);
    expect(zeilen[0]?.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);

    // Kopf + Spaltenzeile + ZWEI Buchungszeilen, eine je Zahlart.
    expect(zeilen.length).toBe(4);
    const buchungen = zeilen.slice(2).map((l) => l.split(';').map((c) => c.replace(/^"|"$/g, '')));
    const kassenZeile = buchungen.find((c) => c[6] === '1000');
    const kartenZeile = buchungen.find((c) => c[6] === '1361');
    expect(kassenZeile?.[0]).toBe('60,00');
    expect(kartenZeile?.[0]).toBe('59,00');
  });

  it('die Buehne verweigert einen Beleg ohne Zahlung, statt ihn stumm zu erfinden', async () => {
    const produkt = await buehne.legeProduktAn();
    await expect(
      buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: 'STANDARD_19',
        subtotal: '100.00',
        vat: '19.00',
        total: '119.00',
        customerId: null,
        finalizedAt: buehne.ts(10, 0),
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
        payments: [],
      }),
    ).rejects.toThrow(/mindestens eine Zahlung/);
  });
});
