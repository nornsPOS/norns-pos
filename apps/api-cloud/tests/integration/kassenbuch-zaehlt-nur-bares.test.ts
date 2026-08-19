/**
 * ════════════════════════════════════════════════════════════════════════
 *  Das Kassenbuch zählt, was in der Lade liegt — nicht den Umsatz
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 09.08.2026 ───────────────────────────────────────────
 *
 *     KassenbuchPanel.tsx:62
 *       const cashRevenueEur = dashboard?.currentShiftRevenueEur ?? '0.00';
 *
 * Die Grösse hiess `cashRevenueEur` und hielt den GESAMTEN Schichtumsatz,
 * Kartenzahlung inbegriffen. Daraus rechnete die Fläche den erwarteten
 * Ladenbestand.
 *
 * Nach einem Kartentag von 2.000 EUR sagte das Kassenbuch dem Kassierer
 * also 2.000 EUR mehr, als in der Lade liegen kann. Er zählt, findet die
 * Differenz, und sucht Geld, das nie da war.
 *
 * ── DIE ZWEI NACHZÜGLER (14. und 15.08.2026, Begehung 0.6.0) ───────────
 *
 * Hier stand: „Die Zahl bleibt eine SCHÄTZUNG, sie enthält keinen
 * Barankauf und keine Einlagen oder Entnahmen." Beides ist inzwischen
 * behoben, in zwei Anläufen — der halbe Fix an derselben Ampel, zweimal:
 * erst kamen die Ankauf-Beine dazu (Tageskasse zeigte 440 statt 320 nach
 * Barankauf 120, live gemessen), dann die Bewegungen (nach Entnahme 100
 * suchte die Vorschau 100, die längst im Tresor lagen). Die Tests unten
 * pinnen ALLE Bein-Familien des Kassensturzes einzeln fest.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

const buehne = baueFiskalBuehne({ geschaeftstag: '2026-05-12' });

const TAG = '2026-05-12';

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

  const [s] = await buehne.migratorSql<{ id: string }[]>`
    INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status, opened_at)
    VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.kassiererId}, '100.00',
            'OPEN'::shift_status, ${buehne.ts(8, 0, TAG)}::timestamptz)
    RETURNING id`;
  schichtId = s!.id;
});

/** Ein Verkauf mit einer bestimmten Zahlungsart. */
async function verkauf(betrag: string, art: 'CASH' | 'ZVT_CARD'): Promise<void> {
  const produktId = await buehne.legeProduktAn();
  const netto = (Number(betrag) / 1.19).toFixed(2);
  const ust = (Number(betrag) - Number(netto)).toFixed(2);
  await buehne.legeBelegAn({
    direction: 'VERKAUF',
    treatment: 'STANDARD_19',
    subtotal: netto,
    vat: ust,
    total: betrag,
    customerId: null,
    finalizedAt: buehne.ts(11, 0, TAG),
    shiftId: schichtId,
    items: [
      {
        productId: produktId,
        treatment: 'STANDARD_19',
        vatRate: '0.1900',
        lineSubtotal: netto,
        lineVat: ust,
        lineTotal: betrag,
        displayOrder: 1,
      },
    ],
    payment: { method: art, amount: betrag },
  });
}

describe('⛔ Kartenumsatz gehört nicht in die Lade', () => {
  it('⛔ ein Kartenverkauf erhöht das Bare NICHT', async () => {
    await verkauf('100.00', 'ZVT_CARD');
    await verkauf('40.00', 'CASH');

    const antwort = await buehne.hol('/api/dashboard/summary');
    expect(antwort.statusCode, antwort.body.slice(0, 300)).toBe(200);
    const s = JSON.parse(antwort.body) as {
      currentShiftBarEur?: string;
      currentShiftRevenueEur: string;
    };

    // Ohne die Schemazeile entfernt Fastify das Feld still.
    expect(s.currentShiftBarEur, 'das Feld kommt gar nicht an').toBeDefined();
    expect(s.currentShiftBarEur, 'Kartenumsatz zaehlt als Bares').toBe('40.00');

    // Und die alte Zahl bleibt, was sie war: die Werkstatt und die
    // Inhaber-App lesen sie ebenfalls, ihre Bedeutung darf sich nicht
    // still ändern.
    expect(s.currentShiftRevenueEur).toBe('140.00');
  }, 90_000);

  it('⚠️ ein reiner Kartentag lässt die Lade bei null', async () => {
    /**
     * Der Fall aus dem Befund. ⚠️ 1.900 statt 2.000: bei GENAU 2.000 sperrt
     * die Datenbank nach § 10 GwG (Identifizierung des Vertragspartners) —
     * zu Recht, und das ist ein anderer Riegel als der hier gemessene.
     */
    await verkauf('1900.00', 'ZVT_CARD');

    const antwort = await buehne.hol('/api/dashboard/summary');
    const s = JSON.parse(antwort.body) as { currentShiftBarEur: string };
    expect(s.currentShiftBarEur).toBe('0');
  }, 90_000);

  it('⚠️ und ein reiner Bartag zählt voll', async () => {
    // Gegenprobe: sonst wäre „zählt Karte nicht" auch erfüllt, wenn die Zahl
    // schlicht immer null wäre.
    await verkauf('250.00', 'CASH');

    const antwort = await buehne.hol('/api/dashboard/summary');
    const s = JSON.parse(antwort.body) as { currentShiftBarEur: string };
    expect(s.currentShiftBarEur).toBe('250.00');
  }, 90_000);

  it('⛔ Einlage, Abschöpfung und Tresortransit bewegen die Lade mit ihrem Vorzeichen', async () => {
    /**
     * 15.08.2026: das dritte Bein derselben Ampel. Der Kassensturz rechnete
     * Einlagen PLUS, Abschöpfung und Tresortransit MINUS — die Schätzung
     * liess alle drei weg. Barverkauf 40, Einlage 50, Abschöpfung 30,
     * Tresortransit 5: in der Lade liegen 40 + 50 − 30 − 5 = 55.
     *
     * ⚠️ Die Bewegungssumme darf NICHT null sein. Der erste Wurf nahm
     * 50 − 30 − 20 = 0, und der Wächter blieb grün, als die Bewegungen
     * absichtlich aus der Route sabotiert waren: er mass gar nichts.
     * Rot-Grün mit DIESEN Beträgen ist am 15.08.2026 gefahren.
     */
    await verkauf('40.00', 'CASH');
    for (const [richtung, betrag] of [
      ['INJECTION', '50.00'],
      ['BANK_DROP', '30.00'],
      ['SAFE_TRANSIT', '5.00'],
    ] as const) {
      await buehne.migratorSql`
        INSERT INTO cash_movements (shift_id, direction, amount_eur, reason, performed_by_user_id)
        VALUES (${schichtId}, ${richtung}::cash_movement_direction, ${betrag},
                'Prüfstand', ${buehne.akteure.kassiererId})`;
    }

    const antwort = await buehne.hol('/api/dashboard/summary');
    expect(antwort.statusCode, antwort.body.slice(0, 300)).toBe(200);
    const s = JSON.parse(antwort.body) as { currentShiftBarEur: string };
    expect(s.currentShiftBarEur, 'eine Bein-Familie fehlt in der Schätzung').toBe('55.00');
  }, 90_000);
});
