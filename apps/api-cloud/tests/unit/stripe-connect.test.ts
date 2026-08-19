/**
 * Connect Standard, geprüft an den beiden Fragen, die Geld und Erlaubnis kosten:
 *
 *   1. Darf auf diesem Konto überhaupt kassiert werden?
 *   2. Wie viel entnehmen wir, und kann diese Zahl je falsch herum kippen?
 *
 * Wie bei payment-gateway.test.ts sind diese Tests misstrauisch. Sie versuchen,
 * dem Torwächter ein Ja abzuringen, und bestehen erst, wenn er nein sagt.
 */

import { describe, expect, it } from 'vitest';

import {
  assertReadyToCharge,
  computeApplicationFeeCents,
  createOnboardingLink,
  createStandardAccount,
  directChargeFields,
  retrieveAccount,
  type StripeConnectConfig,
} from '../../src/lib/stripe-connect.js';

const OHNE_ZUGANG: StripeConnectConfig = {
  secretKey: '',
  apiVersion: '2024-12-18.acacia',
  defaultFeeBps: 100,
};

describe('ohne hinterlegten Zugang wird ehrlich abgelehnt', () => {
  it('legt kein Konto an', async () => {
    const res = await createStandardAccount(OHNE_ZUGANG, { email: 'laden@example.de' });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('NOT_CONFIGURED');
      // Der Text muss dem Bediener sagen, dass NICHTS passiert ist.
      expect(res.detail).toContain('kein Konto angelegt');
    }
  });

  it('erzeugt keinen Onboarding-Link', async () => {
    const res = await createOnboardingLink(OHNE_ZUGANG, {
      stripeAccountId: 'acct_1234',
      returnUrl: 'https://example.de/ok',
      refreshUrl: 'https://example.de/neu',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NOT_CONFIGURED');
  });

  it('fragt keinen Kontostand ab', async () => {
    const res = await retrieveAccount(OHNE_ZUGANG, 'acct_1234');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('NOT_CONFIGURED');
  });
});

describe('eine unsinnige Kontokennung kommt nicht bis zu Stripe', () => {
  const cfg: StripeConnectConfig = { ...OHNE_ZUGANG, secretKey: 'sk_test_egal' };

  // Wichtig: die Formprüfung läuft VOR dem Netzaufruf. Diese Tests dürfen
  // deshalb kein Netz brauchen, und wenn doch eines aufgemacht würde, wäre
  // das der Fehler, den sie finden sollen.
  it('lehnt eine Zahlungskennung ab, die als Konto durchgehen soll', async () => {
    const res = await retrieveAccount(cfg, 'pi_3QabcDEF');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('INVALID_INPUT');
  });

  it('lehnt eine leere Kennung ab', async () => {
    const res = await createOnboardingLink(cfg, {
      stripeAccountId: '',
      returnUrl: 'https://example.de/ok',
      refreshUrl: 'https://example.de/neu',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('INVALID_INPUT');
  });
});

describe('der Torwächter: darf hier kassiert werden', () => {
  it('sagt nein, solange Stripe nicht freigeschaltet hat', () => {
    const r = assertReadyToCharge({ chargesEnabled: false, detailsSubmitted: false });
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('nicht abgeschlossen');
  });

  it('unterscheidet warten von nichts getan', () => {
    // Der Händler hat alles eingereicht, Stripe prüft noch. Der Text muss ihn
    // beruhigen statt ihn ein zweites Mal durch das Formular zu schicken.
    const r = assertReadyToCharge({ chargesEnabled: false, detailsSubmitted: true });
    expect(r.ready).toBe(false);
    expect(r.reason).toContain('prüft');
  });

  it('sagt ja, sobald charges_enabled wahr ist', () => {
    expect(assertReadyToCharge({ chargesEnabled: true, detailsSubmitted: true }).ready).toBe(true);
  });

  it('kassieren haengt NICHT an der Auszahlung', () => {
    // Ein frisch geprüftes Konto darf oft kassieren, bevor die Bankverbindung
    // bestätigt ist. Wer beides koppelt, sperrt den Händler ohne Grund aus.
    expect(assertReadyToCharge({ chargesEnabled: true, detailsSubmitted: false }).ready).toBe(true);
  });
});

describe('die Vermittlungsgebühr', () => {
  it('rechnet ein Prozent von 1.200 Euro korrekt', () => {
    expect(computeApplicationFeeCents(120_000, 100)).toBe(1_200);
  });

  it('rundet AB, niemals zu unseren Gunsten', () => {
    // 999 Cent × 1 % = 9,99 Cent. Aufrunden hiesse, dem Händler einen
    // Bruchteil abzunehmen, den er nie vereinbart hat.
    expect(computeApplicationFeeCents(999, 100)).toBe(9);
  });

  it('ist null, wenn keine Gebühr vereinbart ist', () => {
    expect(computeApplicationFeeCents(120_000, 0)).toBe(0);
  });

  it('wird nie groesser als der Betrag selbst, und seit 0110 nie ueber 10 %', () => {
    // Eine Gebühr über dem Zahlbetrag würde Stripe erst IM Bezahlvorgang
    // ablehnen, also vor dem Kunden an der Kasse. Hier fällt sie vorher.
    //
    // Die erwartete Zahl hat sich mit 0110 geändert, und zwar zur STRENGEREN
    // Seite: 100 Cent bei absurden 100.000 Basispunkten ergaben früher die
    // vollen 100 Cent (nur am Betrag gedeckelt), jetzt 10 Cent (zusätzlich
    // bei 10 % gedeckelt). Beide Quellen einer Gebühr decken ohnehin schon
    // bei 1000 Basispunkten (Umgebungsschema und `payment_commission_rates`),
    // ein höherer Wert kann also nur aus einem Fehler stammen. Vorher hätte
    // ein solcher Fehler bis zum vollen Kaufpreis durchgeschlagen.
    expect(computeApplicationFeeCents(100, 100_000)).toBe(10);
    // Die alte Zusage gilt unverändert weiter: nie mehr als der Betrag.
    expect(computeApplicationFeeCents(3, 1_000)).toBeLessThanOrEqual(3);
  });

  it('ignoriert unsinnige Beträge, statt etwas zu erfinden', () => {
    expect(computeApplicationFeeCents(0, 100)).toBe(0);
    expect(computeApplicationFeeCents(-500, 100)).toBe(0);
    expect(computeApplicationFeeCents(12.5, 100)).toBe(0);
    expect(computeApplicationFeeCents(120_000, Number.NaN)).toBe(0);
  });
});

describe('die Zusatzfelder der Direktbelastung', () => {
  it('nennt das fremde Konto in der Kopfzeile, nicht im Körper', () => {
    // Das ist der eigentliche Schalter: die Kopfzeile entscheidet, WESSEN
    // Konto die Zahlung trägt. Stünde sie im Körper, liefe das Geld über uns.
    const d = directChargeFields({ stripeAccountId: 'acct_abc123', amountCents: 120_000, feeBps: 100 });
    expect(d.header.stripeAccount).toBe('acct_abc123');
    expect(d.form.get('application_fee_amount')).toBe('1200');
    expect(d.feeCents).toBe(1_200);
  });

  it('laesst das Gebuehrenfeld ganz weg, wenn keine Gebuehr anfaellt', () => {
    // Ein `application_fee_amount=0` wäre eine Gebühr von null, kein Verzicht.
    // Stripe behandelt beides gleich, die Belege des Händlers aber nicht.
    const d = directChargeFields({ stripeAccountId: 'acct_abc123', amountCents: 120_000, feeBps: 0 });
    expect(d.form.has('application_fee_amount')).toBe(false);
    expect(d.feeCents).toBe(0);
  });
});

describe('was an der ECHTEN Schnittstelle gemessen wurde', () => {
  // Diese Tests halten zwei Erkenntnisse fest, die ein Aufruf gegen Stripe
  // im Testmodus geliefert hat und die keine Vermutung mehr sind.

  it('DER TORWAECHTER IST DIE EINZIGE SCHRANKE', () => {
    // Gemessen: Stripe legt eine Zahlung auf einem NICHT freigeschalteten
    // Konto anstandslos an (beobachtet: pi_… auf einem Konto mit
    // card_payments.status = "restricted"). Es gibt beim Anbieter also KEINE
    // zweite Sicherung, auf die man sich verlassen koennte.
    //
    // Wer assertReadyToCharge aus dem Zahlungspfad entfernt, belastet Kunden
    // fuer einen Haendler, der die Gutschrift nie sieht. Dieser Test steht
    // hier, damit das niemand versehentlich tut.
    const frisch = { chargesEnabled: false, detailsSubmitted: false };
    expect(assertReadyToCharge(frisch).ready).toBe(false);

    const inPruefung = { chargesEnabled: false, detailsSubmitted: true };
    expect(assertReadyToCharge(inPruefung).ready).toBe(false);
  });

  it('nur der Status "active" oeffnet die Kasse', () => {
    // In v2 ist die Faehigkeit je Zahlungsart aufgeschluesselt. "restricted"
    // und "pending" sind BEIDE ein Nein. Nur "active" ist ein Ja.
    for (const status of ['restricted', 'pending', 'inactive', 'unrequested']) {
      const chargesEnabled = status === 'active';
      expect(assertReadyToCharge({ chargesEnabled, detailsSubmitted: true }).ready).toBe(false);
    }
    expect(assertReadyToCharge({ chargesEnabled: true, detailsSubmitted: true }).ready).toBe(true);
  });
});
