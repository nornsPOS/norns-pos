/**
 * Die Rangfolge der Vermittlungsgebühr.
 *
 * Diese Tests halten eine GESCHÄFTLICHE Zusage fest, nicht eine technische:
 * eine Einzelabrede mit einem Händler muss den Listenpreis eines Kanals
 * schlagen. Kehrt jemand die Reihenfolge um, weil sie in SQL bequemer wäre,
 * wird hier rot, und zwar bevor ein Händler eine Rechnung bekommt, die seiner
 * Abmachung widerspricht.
 *
 * Und sie halten fest, dass dieses Modul Stripe NICHT kennt. Die Zeilen
 * unten tragen `PAYPAL` und `MOLLIE` genauso selbstverständlich wie `STRIPE`.
 */

import { describe, expect, it } from 'vitest';

import {
  computeCommissionCents,
  MAX_FEE_BPS,
  resolveCommission,
  type CommissionRate,
} from '../../src/lib/commission.js';

const KONTO = 'acct_romansladen';
const FREMD = 'acct_einanderer';

const zeile = (
  accountRef: string | null,
  channel: CommissionRate['channel'],
  feeBps: number,
  provider: CommissionRate['provider'] = 'STRIPE',
): CommissionRate => ({ provider, accountRef, channel, feeBps });

describe('die Rangfolge, von der genauesten zur allgemeinsten', () => {
  it('die Einzelabrede schlaegt alles', () => {
    const rates = [
      zeile(KONTO, 'MARKETPLACE', 250),
      zeile(KONTO, null, 150),
      zeile(null, 'MARKETPLACE', 300),
      zeile(null, null, 100),
    ];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'MARKETPLACE',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 250, source: 'ACCOUNT_CHANNEL' });
  });

  it('ohne Einzelabrede gilt, was mit DIESEM Haendler vereinbart ist', () => {
    // Der entscheidende Fall: die Abmachung mit dem Haendler (150) muss den
    // Listenpreis des Kanals (300) schlagen, nicht umgekehrt.
    const rates = [zeile(KONTO, null, 150), zeile(null, 'MARKETPLACE', 300), zeile(null, null, 100)];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'MARKETPLACE',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 150, source: 'ACCOUNT_DEFAULT' });
  });

  it('ohne Abmachung gilt der Listenpreis des Kanals', () => {
    const rates = [zeile(null, 'MARKETPLACE', 300), zeile(null, null, 100)];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'MARKETPLACE',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 300, source: 'CHANNEL_DEFAULT' });
  });

  it('sonst der Hauspreis', () => {
    const rates = [zeile(null, null, 100)];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'WEB',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 100, source: 'PLATFORM_DEFAULT' });
  });

  it('und ganz zuletzt die Vorgabe aus der Umgebung', () => {
    expect(
      resolveCommission([], {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'WEB',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 50, source: 'ENV_FALLBACK' });
  });
});

describe('der Kanal traegt wirklich eine eigene Gebuehr', () => {
  it('derselbe Haendler zahlt im Marktplatz anders als im eigenen Shop', () => {
    // Das ist der ganze Zweck dieser Wanderung. Vor 0110 war das unmoeglich:
    // die Gebuehr war EIN Wert je Konto.
    const rates = [zeile(KONTO, 'WEB', 100), zeile(KONTO, 'MARKETPLACE', 500)];
    const gemeinsam = { provider: 'STRIPE', accountRef: KONTO, fallbackBps: 0 } as const;

    expect(resolveCommission(rates, { ...gemeinsam, channel: 'WEB' }).feeBps).toBe(100);
    expect(resolveCommission(rates, { ...gemeinsam, channel: 'MARKETPLACE' }).feeBps).toBe(500);
  });
});

describe('der Anbieter ist austauschbar', () => {
  it('eine Stripe-Zeile gilt NICHT fuer eine Mollie-Zahlung', () => {
    const rates = [zeile(KONTO, 'WEB', 500, 'STRIPE')];
    expect(
      resolveCommission(rates, {
        provider: 'MOLLIE',
        accountRef: KONTO,
        channel: 'WEB',
        fallbackBps: 75,
      }),
    ).toEqual({ feeBps: 75, source: 'ENV_FALLBACK' });
  });

  it('dasselbe Modell traegt jeden Anbieter, ohne Sonderfall im Code', () => {
    for (const anbieter of ['STRIPE', 'PAYPAL', 'MOLLIE'] as const) {
      const rates = [zeile('konto', 'MARKETPLACE', 200, anbieter)];
      expect(
        resolveCommission(rates, {
          provider: anbieter,
          accountRef: 'konto',
          channel: 'MARKETPLACE',
          fallbackBps: 0,
        }),
        anbieter,
      ).toEqual({ feeBps: 200, source: 'ACCOUNT_CHANNEL' });
    }
  });
});

describe('kaputte Zeilen legen die Zahlung nicht lahm', () => {
  it('eine Zeile mit 0 oder negativ wird uebersprungen, nicht angewandt', () => {
    // Eine Null-Zeile darf nicht als "0 Prozent vereinbart" durchgehen und die
    // darunterliegende Stufe verdecken. Wer keine Gebuehr will, loescht die
    // Zeile; er traegt keine Null ein.
    const rates = [zeile(KONTO, 'WEB', 0), zeile(null, null, 100)];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'WEB',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 100, source: 'PLATFORM_DEFAULT' });
  });

  it('ein Kanal, den dieser Code NICHT kennt, wird uebersprungen statt geraten', () => {
    // Die Spalte ist `text`. Traegt sie eines Tages einen Wert, den eine
    // spaetere Wanderung eingefuehrt hat und dieser Code noch nicht kennt,
    // darf die Zeile nicht zufaellig fuer irgendetwas gelten. Sie passt zu
    // keinem bekannten Kanal, also gilt die naechste Stufe.
    const rates = [
      { provider: 'STRIPE', accountRef: KONTO, channel: 'SUBSCRIPTION', feeBps: 900 },
      zeile(null, null, 100),
    ] satisfies CommissionRate[];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'WEB',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 100, source: 'PLATFORM_DEFAULT' });
  });

  it('ueber der Schranke wird gedeckelt, nicht durchgelassen', () => {
    const rates = [zeile(KONTO, 'WEB', 9999)];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'WEB',
        fallbackBps: 50,
      }).feeBps,
    ).toBe(MAX_FEE_BPS);
  });

  it('ein Konto ohne Kennung greift nie auf eine Kontozeile zu', () => {
    // Zahlung ueber den Plattformzugang selbst: accountRef ist NULL. Sie darf
    // nicht zufaellig die Abrede irgendeines Haendlers erwischen.
    const rates = [zeile(KONTO, 'WEB', 500), zeile(null, null, 100)];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: null,
        channel: 'WEB',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 100, source: 'PLATFORM_DEFAULT' });
  });

  it('die Zeile eines FREMDEN Kontos wird nie angewandt', () => {
    const rates = [zeile(FREMD, 'WEB', 900), zeile(null, null, 100)];
    expect(
      resolveCommission(rates, {
        provider: 'STRIPE',
        accountRef: KONTO,
        channel: 'WEB',
        fallbackBps: 50,
      }),
    ).toEqual({ feeBps: 100, source: 'PLATFORM_DEFAULT' });
  });
});

describe('der Betrag in Cent', () => {
  it('rechnet am Beispiel des Rings zu 1.200 Euro', () => {
    expect(computeCommissionCents(120_000, 100)).toBe(1_200); // 1 % = 12,00 EUR
  });

  it('rundet ab, damit nie mehr entnommen wird als vereinbart', () => {
    expect(computeCommissionCents(999, 150)).toBe(14); // 14,985 -> 14
  });

  it('nie negativ, nie groesser als der Kaufpreis, nie bei kaputter Eingabe', () => {
    expect(computeCommissionCents(-100, 100)).toBe(0);
    expect(computeCommissionCents(0, 100)).toBe(0);
    expect(computeCommissionCents(100.5, 100)).toBe(0);
    expect(computeCommissionCents(1_000, 0)).toBe(0);
    expect(computeCommissionCents(1_000, Number.NaN)).toBe(0);
    // Selbst wenn jemand die Schranke umgeht: hoechstens der Betrag selbst.
    expect(computeCommissionCents(1_000, 999_999)).toBeLessThanOrEqual(1_000);
  });
});
