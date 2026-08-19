/**
 * Die Terminal-Anbindung gegen die protokolltreue Attrappe.
 *
 * Kein Netz: `fetch` ist die Attrappe (tests/helfer/stripe-attrappe.ts), die
 * das Stripe-HTTP-Protokoll nach der API-Referenz nachbaut und im Zweifel
 * STRENGER ist als das Original. Eine Attrappe, die mehr erlaubt als Stripe,
 * ist die bekannte Fehlerklasse dieses Hauses.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  erstatte,
  erstattungsWeg,
  erzeugeKartenzahlung,
  holeIntent,
  legeLocationAn,
  registriereLeser,
  starteZahlungAmLeser,
  zeigeWarenkorb,
  type TerminalConfig,
} from '../../src/lib/stripe-terminal.js';
import {
  KARTE_GIROCARD_PIN,
  baueStripeAttrappe,
  type StripeAttrappe,
} from '../helfer/stripe-attrappe.js';

const ACCT = 'acct_attrappeUnit0001';
const CFG: TerminalConfig = { secretKey: 'sk_test_attrappe', apiVersion: '2024-12-18.acacia' };

describe('stripe-terminal — die Anbindung gegen die Attrappe', () => {
  let attrappe: StripeAttrappe;

  beforeEach(() => {
    attrappe = baueStripeAttrappe();
    attrappe.legeKontoAn(ACCT);
    vi.stubGlobal('fetch', attrappe.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Location + Leser anlegen — der gemeinsame Unterbau der Faelle unten. */
  async function baueLeser(): Promise<string> {
    const loc = await legeLocationAn(CFG, ACCT, {
      displayName: 'Warehouse14 Laden',
      line1: 'Musterstrasse 1',
      postalCode: '44135',
      city: 'Dortmund',
      country: 'DE',
    });
    if (!loc.ok) throw new Error(loc.detail);
    const leser = await registriereLeser(CFG, {
      stripeAccountId: ACCT,
      registrationCode: 'simulated-wpe',
      label: 'Tresen links',
      locationId: loc.value.id,
    });
    if (!leser.ok) throw new Error(leser.detail);
    return leser.value.readerId;
  }

  it('verweigert ohne Schluessel mit NOT_CONFIGURED und ruft NIE das Netz', async () => {
    const nieRufen = vi.fn(() => {
      throw new Error('fetch darf ohne Schluessel nie laufen');
    });
    vi.stubGlobal('fetch', nieRufen);
    const res = await erzeugeKartenzahlung(
      { secretKey: '  ', apiVersion: CFG.apiVersion },
      { stripeAccountId: ACCT, amountCents: 11900, feeCents: 119, idempotencyKey: 'k1' },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NOT_CONFIGURED');
    expect(nieRufen).not.toHaveBeenCalled();
  });

  it('registriert den Leser mit Registrierungscode, Label und Standort AUF dem Haendlerkonto', async () => {
    const readerId = await baueLeser();
    expect(readerId).toMatch(/^tmr_/);
    const anruf = attrappe.anrufe.find((a) => a.pfad === '/v1/terminal/readers');
    expect(anruf?.stripeAccount).toBe(ACCT);
    expect(anruf?.form?.registration_code).toBe('simulated-wpe');
    expect(anruf?.form?.label).toBe('Tresen links');
  });

  it('eroeffnet die Zahlung kartenpraesent mit Vermittlungsgebuehr und Stripe-Account-Kopfzeile', async () => {
    const res = await erzeugeKartenzahlung(CFG, {
      stripeAccountId: ACCT,
      amountCents: 11900,
      feeCents: 119,
      idempotencyKey: 'geste-1',
      metadata: { quelle: 'kasse' },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const anruf = attrappe.anrufe.find((a) => a.pfad === '/v1/payment_intents');
    expect(anruf?.stripeAccount).toBe(ACCT);
    expect(anruf?.idempotencyKey).toBe('geste-1');
    expect(anruf?.form?.amount).toBe('11900');
    expect(anruf?.form?.currency).toBe('eur');
    expect(anruf?.form?.application_fee_amount).toBe('119');
    expect(anruf?.form?.payment_method_types).toEqual(['card_present']);
    expect((anruf?.form?.metadata as Record<string, string>).quelle).toBe('kasse');
  });

  it('die Attrappe lehnt eine Gebuehr ueber dem Betrag ab — strenger geht es nicht durch', async () => {
    const res = await erzeugeKartenzahlung(CFG, {
      stripeAccountId: ACCT,
      amountCents: 100,
      feeCents: 101,
      idempotencyKey: 'geste-2',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('PROVIDER_REJECTED');
  });

  it('zeigt die ECHTEN Warenkorbzeilen auf dem Leser an — Bezeichnung, Menge, Betrag, Steuer, Summe', async () => {
    const readerId = await baueLeser();
    const res = await zeigeWarenkorb(CFG, {
      stripeAccountId: ACCT,
      readerId,
      positionen: [
        { bezeichnung: 'Goldring 585', menge: 1, betragCents: 9900 },
        { bezeichnung: 'Silberkette', menge: 2, betragCents: 2000 },
      ],
      steuerCents: 1900,
      summeCents: 11900,
    });
    expect(res.ok).toBe(true);
    const anruf = attrappe.anrufe.find((a) => a.pfad.endsWith('/set_reader_display'));
    const cart = anruf?.form?.cart as Record<string, unknown>;
    expect(cart.currency).toBe('eur');
    expect(cart.tax).toBe('1900');
    expect(cart.total).toBe('11900');
    expect(cart.line_items).toEqual([
      { description: 'Goldring 585', quantity: '1', amount: '9900' },
      { description: 'Silberkette', quantity: '2', amount: '2000' },
    ]);
  });

  it('meldet einen offenen Leser als LESER-OFFLINE-Code weiter, statt ihn zu verschlucken', async () => {
    const readerId = await baueLeser();
    const zahlung = await erzeugeKartenzahlung(CFG, {
      stripeAccountId: ACCT,
      amountCents: 5000,
      feeCents: 50,
      idempotencyKey: 'geste-3',
    });
    if (!zahlung.ok) throw new Error(zahlung.detail);
    attrappe.schalteLeserOffline(readerId);
    const res = await starteZahlungAmLeser(CFG, {
      stripeAccountId: ACCT,
      readerId,
      intentId: zahlung.value.intentId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe('terminal_reader_offline');
  });

  it('liest aus dem abgeschlossenen Intent das Kartennetz und erstattet darauf', async () => {
    const readerId = await baueLeser();
    const zahlung = await erzeugeKartenzahlung(CFG, {
      stripeAccountId: ACCT,
      amountCents: 11900,
      feeCents: 119,
      idempotencyKey: 'geste-4',
    });
    if (!zahlung.ok) throw new Error(zahlung.detail);
    const start = await starteZahlungAmLeser(CFG, {
      stripeAccountId: ACCT,
      readerId,
      intentId: zahlung.value.intentId,
    });
    expect(start.ok).toBe(true);

    // Die girocard-Doppelfolge am simulierten Leser — Stripes Testweg.
    const praesentiert = await attrappe.fetch(
      `https://api.stripe.com/v1/test_helpers/terminal/readers/${readerId}/present_payment_method`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer sk_test_attrappe',
          'content-type': 'application/x-www-form-urlencoded',
          'stripe-account': ACCT,
        },
        body: `card_present[number]=${KARTE_GIROCARD_PIN}`,
      },
    );
    expect(praesentiert.status).toBe(200);

    const stand = await holeIntent(CFG, {
      stripeAccountId: ACCT,
      intentId: zahlung.value.intentId,
    });
    expect(stand.ok).toBe(true);
    if (!stand.ok) return;
    expect(stand.value.status).toBe('succeeded');
    expect(stand.value.kartennetz).toBe('girocard');

    const refund = await erstatte(CFG, {
      stripeAccountId: ACCT,
      intentId: zahlung.value.intentId,
      amountCents: 11900,
    });
    expect(refund.ok).toBe(true);
    if (!refund.ok) return;
    expect(refund.value.refundId).toMatch(/^re_/);
  });

  it('benennt den Erstattungsweg ehrlich: girocard per SEPA in ein bis zwei Tagen, Karten sofort', () => {
    const giro = erstattungsWeg('girocard');
    expect(giro.weg).toBe('SEPA_UEBERWEISUNG');
    expect(giro.hinweis).toContain('ein bis zwei');
    const visa = erstattungsWeg('visa');
    expect(visa.weg).toBe('SOFORT');
  });
});
