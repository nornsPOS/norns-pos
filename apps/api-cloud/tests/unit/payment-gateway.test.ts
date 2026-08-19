/**
 * Der Zahlungsanschluss, geprüft an der einen Frage, die Geld kostet:
 * WANN darf Ware das Haus verlassen.
 *
 * Diese Tests sind bewusst misstrauisch. Sie versuchen, den Torwächter zu
 * überreden, und bestehen erst, wenn er in jedem einzelnen Fall nein sagt.
 */

import { describe, expect, it } from 'vitest';

import {
  createSimulatedGateway,
  createUnconfiguredGateway,
  mayReleaseGoods,
  type PaymentEvent,
  paymentRefusalTextDe,
  validateIntentInput,
} from '../../src/lib/payment-gateway.js';

function event(over: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    providerIntentId: 'pi_test',
    state: 'SUCCEEDED',
    amountCents: 120000,
    authoritative: true,
    rawStatus: 'succeeded',
    ...over,
  };
}

describe('the gatekeeper: when may goods leave the building', () => {
  it('releases only on a verified, complete, exactly-matching payment', () => {
    const r = mayReleaseGoods(event(), 120000);
    expect(r.release).toBe(true);
  });

  it('REFUSES an unverified event, even when it says SUCCEEDED', () => {
    // Der häufigste Fehler im Onlinehandel: die Rückkehr des Browsers als
    // Beweis nehmen. Sie lässt sich aufrufen, ohne bezahlt zu haben.
    const r = mayReleaseGoods(event({ authoritative: false }), 120000);
    expect(r.release).toBe(false);
    expect(r.reason).toContain('nicht geprüft');
  });

  it('REFUSES a short payment, which is the interesting attack', () => {
    // Eine bestätigte Zahlung über 1,00 Euro für einen Warenkorb über
    // 1.200,00 ist keine bezahlte Bestellung.
    const r = mayReleaseGoods(event({ amountCents: 100 }), 120000);
    expect(r.release).toBe(false);
    expect(r.reason).toContain('stimmt nicht');
  });

  it('REFUSES an overpayment too, because it means the books disagree', () => {
    const r = mayReleaseGoods(event({ amountCents: 130000 }), 120000);
    expect(r.release).toBe(false);
  });

  it('REFUSES when the provider reported no amount at all', () => {
    const r = mayReleaseGoods(event({ amountCents: null }), 120000);
    expect(r.release).toBe(false);
  });

  it.each(['CREATED', 'PENDING', 'FAILED', 'CANCELED', 'EXPIRED'] as const)(
    'REFUSES state %s',
    (state) => {
      expect(mayReleaseGoods(event({ state }), 120000).release).toBe(false);
    },
  );

  it('never explains a refusal with a raw code', () => {
    const r = mayReleaseGoods(event({ authoritative: false }), 120000);
    expect(r.reason).not.toContain('_');
  });
});

describe('the unconfigured gateway takes no money and admits it', () => {
  const gw = createUnconfiguredGateway('STRIPE');

  it('reports itself unconfigured', () => {
    expect(gw.configured).toBe(false);
    expect(gw.simulated).toBe(false);
  });

  it('opens no payment and collects nothing', async () => {
    const r = await gw.createIntent({ cartId: 'c-1', amountCents: 120000, currency: 'EUR' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('NOT_CONFIGURED');
    expect(!r.ok && r.detail).toContain('kein Betrag eingezogen');
  });

  it('believes no webhook either', async () => {
    const r = await gw.verifyWebhook('{"type":"payment_intent.succeeded"}', 'sig');
    expect(r.ok).toBe(false);
  });

  it('speaks German with no raw code', async () => {
    const r = await gw.createIntent({ cartId: 'c-1', amountCents: 1, currency: 'EUR' });
    const text = !r.ok ? paymentRefusalTextDe(r.reason, r.detail) : '';
    expect(text).not.toContain('_');
    expect(text).toContain('STRIPE');
  });
});

describe('a simulated payment can never release goods', () => {
  it('marks its identifier visibly, so nobody mistakes it for a real one', async () => {
    const gw = createSimulatedGateway();
    const r = await gw.createIntent({ cartId: 'c-1', amountCents: 4999, currency: 'EUR' });
    expect(r.ok && r.value.providerIntentId.startsWith('SIMULATION-')).toBe(true);
    expect(r.ok && r.value.simulated).toBe(true);
    // `pi_...` hier wäre eine Einladung, eine Übung für echt zu halten.
    expect(r.ok && r.value.providerIntentId.startsWith('pi_')).toBe(false);
  });

  it('produces NO authoritative event, by construction', async () => {
    // Der Sinn der Übung, nicht ihr Mangel: der Weg endet genau da, wo im
    // Echtbetrieb die signierte Meldung stehen wird.
    const gw = createSimulatedGateway();
    const r = await gw.verifyWebhook('{"anything":true}', 'sig');
    expect(r.ok).toBe(false);
  });

  it('applies the same input checks a real provider would', async () => {
    const gw = createSimulatedGateway();
    const r = await gw.createIntent({ cartId: 'c-1', amountCents: 0, currency: 'EUR' });
    expect(!r.ok && r.reason).toBe('INVALID_INPUT');
  });

  it('is deterministic across runs', async () => {
    const mk = () => createSimulatedGateway('STRIPE', (() => { let n = 0; return () => ++n; })());
    const a = await mk().createIntent({ cartId: 'c', amountCents: 100, currency: 'EUR' });
    const b = await mk().createIntent({ cartId: 'c', amountCents: 100, currency: 'EUR' });
    expect(a.ok && b.ok && a.value.providerIntentId).toBe(b.ok ? b.value.providerIntentId : '');
  });
});

describe('an amount has to be a real amount', () => {
  const base = { cartId: 'c-1', currency: 'EUR' as const };

  it('rejects zero and negative', () => {
    expect(validateIntentInput({ ...base, amountCents: 0 })).toContain('größer als null');
    expect(validateIntentInput({ ...base, amountCents: -500 })).toContain('größer als null');
  });

  it('rejects a fractional cent, which is how float money arrives', () => {
    expect(validateIntentInput({ ...base, amountCents: 12.5 })).toContain('ganze Centzahl');
  });

  it('rejects a missing order', () => {
    expect(validateIntentInput({ ...base, cartId: '   ', amountCents: 100 })).toContain('Auftrag');
  });

  it('accepts a real one', () => {
    expect(validateIntentInput({ ...base, amountCents: 120000 })).toBeNull();
  });
});
