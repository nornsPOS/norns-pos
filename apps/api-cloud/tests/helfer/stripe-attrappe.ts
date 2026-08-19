/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Die Stripe-Attrappe — das HTTP-Protokoll von Stripe, nachgebaut nach der
 *  API-Referenz, fuer Tests ohne Schluessel
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WARUM ES SIE GIBT (26.07.2026, Gewerk 2): `STRIPE_SECRET_KEY` liegt bei
 * Basel, die Produktion laeuft ohne. Der Terminal-Weg muss trotzdem als
 * GANZE Kette fahrbar sein. Die bekannte Fehlerklasse dieses Hauses ist die
 * Attrappe, die mehr erlaubt als das Original ("fabricate-when-unconfigured",
 * zweimal an einem Tag gefunden). Deshalb ist diese hier im Zweifel STRENGER
 * als die Referenz:
 *
 *   • v1 verlangt Formularkodierung — ein JSON-Koerper wird abgelehnt.
 *   • Unbekannte Parameter am `set_reader_display` sind ein Fehler
 *     ("Received unknown parameter"), wie beim echten Stripe.
 *   • Jede Ressource lebt AUF einem Konto: was mit `Stripe-Account: A`
 *     angelegt wurde, ist ohne dieselbe Kopfzeile nicht auffindbar (404
 *     resource_missing) — die Direktbelastungs-Semantik.
 *   • `application_fee_amount` ohne `Stripe-Account` ist ein Fehler, ueber
 *     dem Betrag ebenfalls.
 *   • Betraege unter 50 Cent lehnt Stripe ab (`amount_too_small`).
 *
 * WAS SIE KANN:
 *   • /v1/payment_intents (anlegen, lesen mit expand=latest_charge,
 *     stornieren), /v1/refunds
 *   • /v1/terminal/locations + /v1/terminal/readers (registrieren, listen,
 *     loeschen, process_payment_intent, set_reader_display, cancel_action)
 *   • /v1/test_helpers/terminal/readers/{id}/present_payment_method —
 *     Stripes SIMULIERTE Leser im Testmodus
 *   • /v2/core/accounts/{id} (JSON) — der Torwaechter-Refresh vor jeder
 *     Zahlung (assertReadyToCharge)
 *
 * DIE GIROCARD-DOPPELFOLGE: die Steuerkarte 4000002500001001 spielt nach, was
 * Stripe fuer girocard mit PIN dokumentiert — ZWEI Belastungen, die erste
 * weich abgelehnt mit `online_or_offline_pin_required`, die zweite echt.
 * Beide erscheinen in `ereignisse`, damit ein Test sie signiert an den
 * Webhook liefern kann, in genau dieser Reihenfolge.
 *
 * `ereignisse` sammelt, was das echte Stripe per Webhook liefern wuerde. Die
 * Attrappe signiert NICHT selbst — das Signieren gehoert dem Test (dasselbe
 * Muster wie day19/day20), damit auch der Signaturweg echt geprueft wird.
 *
 * NUR FUER TESTS. Kein Produktionsquelltext importiert diese Datei.
 */

import { randomUUID } from 'node:crypto';

// ── Formen ─────────────────────────────────────────────────────────────────

interface AttrappenKonto {
  id: string;
  /** `card_payments.status` in v2: 'active' | 'restricted' | 'pending'. */
  kartenStatus: string;
}

interface AttrappenLocation {
  id: string;
  konto: string | undefined;
  displayName: string;
  address: Record<string, string>;
}

interface AttrappenLeser {
  id: string;
  konto: string | undefined;
  label: string;
  deviceType: string;
  serialNumber: string;
  location: string;
  status: 'online' | 'offline';
  action: {
    type: string;
    status: 'in_progress' | 'succeeded' | 'failed';
    paymentIntent: string;
    failureCode: string | null;
    failureMessage: string | null;
  } | null;
  geloescht: boolean;
}

interface AttrappenCharge {
  id: string;
  amount: number;
  status: 'succeeded' | 'failed';
  netz: string;
  marke: string;
  declineCode: string | null;
}

interface AttrappenIntent {
  id: string;
  konto: string | undefined;
  amount: number;
  currency: string;
  applicationFeeAmount: number | null;
  paymentMethodTypes: string[];
  status: string;
  clientSecret: string;
  metadata: Record<string, string>;
  charges: AttrappenCharge[];
  lastPaymentError: Record<string, unknown> | null;
  erstattetCents: number;
}

interface AttrappenRefund {
  id: string;
  konto: string | undefined;
  paymentIntent: string;
  charge: string;
  amount: number;
  status: 'succeeded' | 'pending';
}

/** Ein Ereignis, wie Stripe es per Webhook liefern wuerde. */
export interface AttrappenEreignis {
  id: string;
  object: 'event';
  type: string;
  /** Das verbundene Konto, auf dem das Ereignis entstand. */
  account?: string;
  data: { object: Record<string, unknown> };
}

/** Ein protokollierter Anruf — Beweismaterial fuer die Tests. */
export interface AttrappenAnruf {
  methode: string;
  pfad: string;
  stripeAccount: string | undefined;
  idempotencyKey: string | undefined;
  form: Record<string, unknown> | undefined;
}

// ── Steuerkarten (angelehnt an Stripes Testkarten) ─────────────────────────

/** Erfolg, Visa. */
export const KARTE_ERFOLG = '4242424242424242';
/** Harte Ablehnung (`generic_decline`). */
export const KARTE_ABGELEHNT = '4000000000000002';
/**
 * girocard mit PIN-Pflicht: ZWEI Belastungen, die erste weich abgelehnt mit
 * `online_or_offline_pin_required`, die zweite echt (Netz `girocard`).
 */
export const KARTE_GIROCARD_PIN = '4000002500001001';

// ── Hilfen ─────────────────────────────────────────────────────────────────

function kennung(praefix: string): string {
  return `${praefix}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function fehler(
  status: number,
  body: { type: string; message: string; code?: string; decline_code?: string; param?: string },
): Response {
  return new Response(JSON.stringify({ error: body }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Formularkodierung mit Klammern (`cart[line_items][0][amount]`) in ein
 * geschachteltes Objekt zerlegen — so, wie Stripes v1-Wege sie verstehen.
 */
function zerlegeForm(roh: string): Record<string, unknown> {
  const wurzel: Record<string, unknown> = {};
  const params = new URLSearchParams(roh);
  for (const [schluessel, wert] of params) {
    const teile = schluessel.split(/[[\]]+/).filter((t) => t.length > 0);
    let ort: Record<string, unknown> | unknown[] = wurzel;
    for (let i = 0; i < teile.length; i++) {
      const teil = teile[i]!;
      const letzter = i === teile.length - 1;
      const index = /^\d+$/.test(teil) ? Number(teil) : null;
      if (letzter) {
        if (Array.isArray(ort)) ort[index ?? ort.length] = wert;
        else (ort as Record<string, unknown>)[teil] = wert;
      } else {
        const naechsterIstIndex = /^\d+$/.test(teile[i + 1]!);
        const behaelter = Array.isArray(ort)
          ? (ort[index ?? ort.length] ??= naechsterIstIndex ? [] : {})
          : ((ort as Record<string, unknown>)[teil] ??= naechsterIstIndex ? [] : {});
        ort = behaelter as Record<string, unknown> | unknown[];
      }
    }
  }
  return wurzel;
}

// ── Die Attrappe ───────────────────────────────────────────────────────────

export interface StripeAttrappe {
  /** Der Ersatz fuer das globale `fetch`. */
  fetch: typeof fetch;
  /** Was das echte Stripe per Webhook liefern wuerde, in Reihenfolge. */
  ereignisse: AttrappenEreignis[];
  /** Beweisprotokoll aller Anrufe. */
  anrufe: AttrappenAnruf[];
  /** Ein v2-Konto anlegen (fuer den Torwaechter-Refresh). */
  legeKontoAn(acct: string, kartenStatus?: string): void;
  /** Einen Leser offline schalten (Fehlerbild LESER_OFFLINE). */
  schalteLeserOffline(tmr: string): void;
  /** Die Aktion eines Lesers per Zeitueberschreitung scheitern lassen. */
  lasseAktionVerstreichen(tmr: string): void;
  /** Innerer Zustand, fuer gezielte Zusicherungen. */
  readonly leser: Map<string, AttrappenLeser>;
  readonly intents: Map<string, AttrappenIntent>;
  readonly refunds: Map<string, AttrappenRefund>;
}

export function baueStripeAttrappe(): StripeAttrappe {
  const konten = new Map<string, AttrappenKonto>();
  const locations = new Map<string, AttrappenLocation>();
  const leser = new Map<string, AttrappenLeser>();
  const intents = new Map<string, AttrappenIntent>();
  const refunds = new Map<string, AttrappenRefund>();
  const ereignisse: AttrappenEreignis[] = [];
  const anrufe: AttrappenAnruf[] = [];

  function intentSchnappschuss(pi: AttrappenIntent, expandCharge: boolean): Record<string, unknown> {
    const erfolgreiche = pi.charges.filter((c) => c.status === 'succeeded');
    const letzte = pi.charges[pi.charges.length - 1] ?? null;
    const chargeObjekt = (c: AttrappenCharge): Record<string, unknown> => ({
      id: c.id,
      object: 'charge',
      amount: c.amount,
      status: c.status,
      payment_method_details: {
        type: 'card_present',
        card_present: { brand: c.marke, network: c.netz },
      },
    });
    const latest = erfolgreiche[erfolgreiche.length - 1] ?? letzte;
    return {
      id: pi.id,
      object: 'payment_intent',
      amount: pi.amount,
      currency: pi.currency,
      status: pi.status,
      client_secret: pi.clientSecret,
      payment_method_types: pi.paymentMethodTypes,
      ...(pi.applicationFeeAmount !== null
        ? { application_fee_amount: pi.applicationFeeAmount }
        : {}),
      metadata: pi.metadata,
      last_payment_error: pi.lastPaymentError,
      latest_charge: latest === null ? null : expandCharge ? chargeObjekt(latest) : latest.id,
    };
  }

  function leserSchnappschuss(l: AttrappenLeser): Record<string, unknown> {
    return {
      id: l.id,
      object: 'terminal.reader',
      label: l.label,
      device_type: l.deviceType,
      serial_number: l.serialNumber,
      location: l.location,
      status: l.status,
      action:
        l.action === null
          ? null
          : {
              type: l.action.type,
              status: l.action.status,
              failure_code: l.action.failureCode,
              failure_message: l.action.failureMessage,
              process_payment_intent: { payment_intent: l.action.paymentIntent },
            },
    };
  }

  function ereignis(typ: string, objekt: Record<string, unknown>, konto: string | undefined): void {
    ereignisse.push({
      id: `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      object: 'event',
      type: typ,
      ...(konto !== undefined ? { account: konto } : {}),
      data: { object: objekt },
    });
  }

  /** Der Kern: die Karte wird praesentiert, der Ausgang haengt an der Nummer. */
  function praesentiereKarte(l: AttrappenLeser, nummer: string): Response {
    if (l.action === null || l.action.type !== 'process_payment_intent') {
      return fehler(400, {
        type: 'invalid_request_error',
        message: 'The reader has no payment collection in progress.',
      });
    }
    const pi = intents.get(l.action.paymentIntent);
    if (pi === undefined) {
      return fehler(400, { type: 'invalid_request_error', message: 'PaymentIntent is gone.' });
    }

    if (nummer === KARTE_ABGELEHNT) {
      const charge: AttrappenCharge = {
        id: kennung('ch'),
        amount: pi.amount,
        status: 'failed',
        netz: 'visa',
        marke: 'visa',
        declineCode: 'generic_decline',
      };
      pi.charges.push(charge);
      pi.lastPaymentError = {
        code: 'card_declined',
        decline_code: 'generic_decline',
        message: 'Your card was declined.',
      };
      // Der Leser bleibt in der Sammlung — der Kunde darf eine andere Karte
      // versuchen. Genau so verhaelt sich das Original.
      ereignis('payment_intent.payment_failed', intentSchnappschuss(pi, false), pi.konto);
      return ok(leserSchnappschuss(l));
    }

    if (nummer === KARTE_GIROCARD_PIN) {
      // DIE DOPPELFOLGE: Belastung 1, weich abgelehnt.
      const weich: AttrappenCharge = {
        id: kennung('ch'),
        amount: pi.amount,
        status: 'failed',
        netz: 'girocard',
        marke: 'girocard',
        declineCode: 'online_or_offline_pin_required',
      };
      pi.charges.push(weich);
      pi.lastPaymentError = {
        code: 'card_declined',
        decline_code: 'online_or_offline_pin_required',
        message: 'The card requires online or offline PIN entry.',
      };
      ereignis('payment_intent.payment_failed', intentSchnappschuss(pi, false), pi.konto);
      // Belastung 2, echt — dieselbe Karte, mit PIN.
      const echt: AttrappenCharge = {
        id: kennung('ch'),
        amount: pi.amount,
        status: 'succeeded',
        netz: 'girocard',
        marke: 'girocard',
        declineCode: null,
      };
      pi.charges.push(echt);
      pi.lastPaymentError = null;
      pi.status = 'succeeded';
      l.action.status = 'succeeded';
      ereignis('payment_intent.succeeded', intentSchnappschuss(pi, false), pi.konto);
      ereignis('terminal.reader.action_succeeded', leserSchnappschuss(l), pi.konto);
      return ok(leserSchnappschuss(l));
    }

    // Vorgabe: Erfolg (Visa).
    const charge: AttrappenCharge = {
      id: kennung('ch'),
      amount: pi.amount,
      status: 'succeeded',
      netz: 'visa',
      marke: 'visa',
      declineCode: null,
    };
    pi.charges.push(charge);
    pi.lastPaymentError = null;
    pi.status = 'succeeded';
    l.action.status = 'succeeded';
    ereignis('payment_intent.succeeded', intentSchnappschuss(pi, false), pi.konto);
    ereignis('terminal.reader.action_succeeded', leserSchnappschuss(l), pi.konto);
    return ok(leserSchnappschuss(l));
  }

  async function attrappenFetch(
    eingabe: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(
      typeof eingabe === 'string' ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url,
    );
    if (url.host !== 'api.stripe.com') {
      throw new Error(`Stripe-Attrappe: unerwarteter Aufruf an ${url.host} — kein Netz in Tests.`);
    }
    const methode = (init?.method ?? 'GET').toUpperCase();
    const kopf = new Headers(init?.headers);
    const auth = kopf.get('authorization') ?? '';
    const konto = kopf.get('stripe-account') ?? undefined;
    const idem = kopf.get('idempotency-key') ?? undefined;
    const contentType = kopf.get('content-type') ?? '';
    const rohBody = typeof init?.body === 'string' ? init.body : '';

    if (!/^Bearer\s+\S+$/.test(auth)) {
      return fehler(401, {
        type: 'invalid_request_error',
        message: 'You did not provide an API key.',
      });
    }

    // ── v2: Kontoabfrage (JSON) ──────────────────────────────────────────
    const v2Konto = /^\/v2\/core\/accounts\/([^/?]+)$/.exec(url.pathname);
    if (v2Konto !== null && methode === 'GET') {
      anrufe.push({ methode, pfad: url.pathname, stripeAccount: konto, idempotencyKey: idem, form: undefined });
      const k = konten.get(v2Konto[1]!);
      if (k === undefined) {
        return fehler(404, {
          type: 'invalid_request_error',
          message: `No such account: '${v2Konto[1]!}'`,
        });
      }
      return ok({
        id: k.id,
        configuration: {
          merchant: { capabilities: { card_payments: { status: k.kartenStatus } } },
        },
        identity: { country: 'DE' },
        defaults: { currency: 'eur' },
        requirements: {},
      });
    }

    // ── v1: Formularkodierung ist Pflicht ────────────────────────────────
    if (url.pathname.startsWith('/v1/') && (methode === 'POST' || methode === 'PUT')) {
      if (!contentType.includes('application/x-www-form-urlencoded')) {
        return fehler(400, {
          type: 'invalid_request_error',
          message: 'Invalid request: v1 endpoints expect form-encoded bodies.',
        });
      }
    }
    const form =
      methode === 'POST' || methode === 'PUT' ? zerlegeForm(rohBody) : undefined;
    anrufe.push({ methode, pfad: url.pathname, stripeAccount: konto, idempotencyKey: idem, form });

    // ── /v1/payment_intents ──────────────────────────────────────────────
    if (url.pathname === '/v1/payment_intents' && methode === 'POST') {
      const f = form ?? {};
      const amount = Number(f.amount);
      if (!Number.isInteger(amount)) {
        return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: amount.', param: 'amount' });
      }
      if (amount < 50) {
        return fehler(400, {
          type: 'invalid_request_error',
          code: 'amount_too_small',
          message: 'Amount must be at least €0.50 eur',
        });
      }
      if (typeof f.currency !== 'string' || f.currency.length === 0) {
        return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: currency.', param: 'currency' });
      }
      const fee = f.application_fee_amount === undefined ? null : Number(f.application_fee_amount);
      if (fee !== null) {
        if (konto === undefined) {
          return fehler(400, {
            type: 'invalid_request_error',
            message:
              'Can only apply an application_fee_amount when the PaymentIntent is attributable to another account.',
          });
        }
        if (!Number.isInteger(fee) || fee < 0 || fee > amount) {
          return fehler(400, {
            type: 'invalid_request_error',
            message: 'application_fee_amount must be a positive integer no greater than amount.',
            param: 'application_fee_amount',
          });
        }
      }
      const typen = Array.isArray(f.payment_method_types)
        ? (f.payment_method_types as string[])
        : ['card'];
      const id = kennung('pi');
      const pi: AttrappenIntent = {
        id,
        konto,
        amount,
        currency: String(f.currency),
        applicationFeeAmount: fee,
        paymentMethodTypes: typen,
        status: 'requires_payment_method',
        clientSecret: `${id}_secret_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        metadata: (f.metadata as Record<string, string> | undefined) ?? {},
        charges: [],
        lastPaymentError: null,
        erstattetCents: 0,
      };
      intents.set(id, pi);
      return ok(intentSchnappschuss(pi, false));
    }

    const piLesen = /^\/v1\/payment_intents\/([^/?]+)$/.exec(url.pathname);
    if (piLesen !== null && methode === 'GET') {
      const pi = intents.get(piLesen[1]!);
      if (pi === undefined || pi.konto !== konto) {
        return fehler(404, {
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: `No such payment_intent: '${piLesen[1]!}'`,
        });
      }
      const expandiert = url.searchParams.getAll('expand[0]').concat(url.searchParams.getAll('expand[]'));
      return ok(intentSchnappschuss(pi, expandiert.includes('latest_charge')));
    }

    const piCancel = /^\/v1\/payment_intents\/([^/?]+)\/cancel$/.exec(url.pathname);
    if (piCancel !== null && methode === 'POST') {
      const pi = intents.get(piCancel[1]!);
      if (pi === undefined || pi.konto !== konto) {
        return fehler(404, {
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: `No such payment_intent: '${piCancel[1]!}'`,
        });
      }
      if (pi.status === 'succeeded' || pi.status === 'canceled') {
        return fehler(400, {
          type: 'invalid_request_error',
          code: 'payment_intent_unexpected_state',
          message: `You cannot cancel this PaymentIntent because it has a status of ${pi.status}.`,
        });
      }
      pi.status = 'canceled';
      ereignis('payment_intent.canceled', intentSchnappschuss(pi, false), pi.konto);
      return ok(intentSchnappschuss(pi, false));
    }

    // ── /v1/refunds ──────────────────────────────────────────────────────
    if (url.pathname === '/v1/refunds' && methode === 'POST') {
      const f = form ?? {};
      const piId = typeof f.payment_intent === 'string' ? f.payment_intent : '';
      const pi = intents.get(piId);
      if (pi === undefined || pi.konto !== konto) {
        return fehler(404, {
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: `No such payment_intent: '${piId}'`,
        });
      }
      const charge = pi.charges.find((c) => c.status === 'succeeded');
      if (pi.status !== 'succeeded' || charge === undefined) {
        return fehler(400, {
          type: 'invalid_request_error',
          message: 'This PaymentIntent does not have a successful charge to refund.',
        });
      }
      const offen = pi.amount - pi.erstattetCents;
      const amount = f.amount === undefined ? offen : Number(f.amount);
      if (!Number.isInteger(amount) || amount <= 0 || amount > offen) {
        return fehler(400, {
          type: 'invalid_request_error',
          message: `Refund amount (${amount}) is greater than unrefunded amount on charge (${offen}).`,
        });
      }
      pi.erstattetCents += amount;
      const refund: AttrappenRefund = {
        id: kennung('re'),
        konto,
        paymentIntent: pi.id,
        charge: charge.id,
        // girocard kennt keine Sofort-Erstattung: Stripe ueberweist per SEPA.
        status: charge.netz === 'girocard' ? 'pending' : 'succeeded',
        amount,
      };
      refunds.set(refund.id, refund);
      return ok({
        id: refund.id,
        object: 'refund',
        amount: refund.amount,
        status: refund.status,
        payment_intent: refund.paymentIntent,
        charge: refund.charge,
      });
    }

    // ── /v1/terminal/locations ───────────────────────────────────────────
    if (url.pathname === '/v1/terminal/locations' && methode === 'GET') {
      const data = [...locations.values()]
        .filter((l) => l.konto === konto)
        .map((l) => ({ id: l.id, object: 'terminal.location', display_name: l.displayName, address: l.address }));
      return ok({ object: 'list', data, has_more: false });
    }
    if (url.pathname === '/v1/terminal/locations' && methode === 'POST') {
      const f = form ?? {};
      const address = (f.address ?? {}) as Record<string, string>;
      if (typeof f.display_name !== 'string' || f.display_name.length === 0) {
        return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: display_name.', param: 'display_name' });
      }
      for (const pflicht of ['line1', 'city', 'postal_code', 'country']) {
        if (typeof address[pflicht] !== 'string' || address[pflicht]!.length === 0) {
          return fehler(400, {
            type: 'invalid_request_error',
            message: `Missing required param: address[${pflicht}].`,
            param: `address[${pflicht}]`,
          });
        }
      }
      const loc: AttrappenLocation = {
        id: kennung('tml'),
        konto,
        displayName: String(f.display_name),
        address,
      };
      locations.set(loc.id, loc);
      return ok({ id: loc.id, object: 'terminal.location', display_name: loc.displayName, address: loc.address });
    }

    // ── /v1/terminal/readers ─────────────────────────────────────────────
    if (url.pathname === '/v1/terminal/readers' && methode === 'GET') {
      const data = [...leser.values()]
        .filter((l) => l.konto === konto && !l.geloescht)
        .map((l) => leserSchnappschuss(l));
      return ok({ object: 'list', data, has_more: false });
    }
    if (url.pathname === '/v1/terminal/readers' && methode === 'POST') {
      const f = form ?? {};
      const code = typeof f.registration_code === 'string' ? f.registration_code : '';
      if (code.length === 0) {
        return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: registration_code.', param: 'registration_code' });
      }
      const simuliert = code.startsWith('simulated-');
      if (!simuliert && !/^[a-z]+-[a-z]+-[a-z]+$/.test(code)) {
        return fehler(400, {
          type: 'invalid_request_error',
          message: `Reader registration code is invalid: '${code}'`,
          param: 'registration_code',
        });
      }
      const location = typeof f.location === 'string' ? f.location : '';
      const loc = locations.get(location);
      if (loc === undefined || loc.konto !== konto) {
        return fehler(400, {
          type: 'invalid_request_error',
          message: 'Missing required param: location.',
          param: 'location',
        });
      }
      const l: AttrappenLeser = {
        id: kennung('tmr'),
        konto,
        label: typeof f.label === 'string' && f.label.length > 0 ? f.label : 'Reader',
        deviceType: simuliert ? 'simulated_stripe_s700' : 'stripe_s700',
        serialNumber: `S700-${randomUUID().slice(0, 8)}`,
        location,
        status: 'online',
        action: null,
        geloescht: false,
      };
      leser.set(l.id, l);
      return ok(leserSchnappschuss(l));
    }

    const leserPfad = /^\/v1\/terminal\/readers\/([^/?]+)(?:\/([a-z_]+))?$/.exec(url.pathname);
    if (leserPfad !== null) {
      const l = leser.get(leserPfad[1]!);
      if (l === undefined || l.konto !== konto || l.geloescht) {
        return fehler(404, {
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: `No such terminal reader: '${leserPfad[1]!}'`,
        });
      }
      const unterpfad = leserPfad[2];

      if (unterpfad === undefined && methode === 'DELETE') {
        l.geloescht = true;
        return ok({ id: l.id, object: 'terminal.reader', deleted: true });
      }
      if (unterpfad === undefined && methode === 'GET') {
        return ok(leserSchnappschuss(l));
      }

      if (unterpfad === 'process_payment_intent' && methode === 'POST') {
        if (l.status === 'offline') {
          return fehler(400, {
            type: 'invalid_request_error',
            code: 'terminal_reader_offline',
            message: 'Reader is currently offline, please ensure the reader is powered on and connected to the internet.',
          });
        }
        const piId = typeof form?.payment_intent === 'string' ? form.payment_intent : '';
        const pi = intents.get(piId);
        if (pi === undefined || pi.konto !== konto) {
          return fehler(404, {
            type: 'invalid_request_error',
            code: 'resource_missing',
            message: `No such payment_intent: '${piId}'`,
          });
        }
        if (pi.status !== 'requires_payment_method' && pi.status !== 'requires_confirmation') {
          return fehler(400, {
            type: 'invalid_request_error',
            code: 'intent_invalid_state',
            message: `PaymentIntent is in state ${pi.status} and cannot be processed.`,
          });
        }
        l.action = {
          type: 'process_payment_intent',
          status: 'in_progress',
          paymentIntent: pi.id,
          failureCode: null,
          failureMessage: null,
        };
        return ok(leserSchnappschuss(l));
      }

      if (unterpfad === 'set_reader_display' && methode === 'POST') {
        const f = form ?? {};
        // STRENG wie das Original: unbekannte Parameter sind ein Fehler.
        for (const k of Object.keys(f)) {
          if (k !== 'type' && k !== 'cart') {
            return fehler(400, { type: 'invalid_request_error', message: `Received unknown parameter: ${k}`, param: k });
          }
        }
        if (f.type !== 'cart') {
          return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: type.', param: 'type' });
        }
        const cart = (f.cart ?? {}) as Record<string, unknown>;
        for (const k of Object.keys(cart)) {
          if (!['currency', 'tax', 'total', 'line_items'].includes(k)) {
            return fehler(400, { type: 'invalid_request_error', message: `Received unknown parameter: cart[${k}]`, param: `cart[${k}]` });
          }
        }
        if (typeof cart.currency !== 'string' || cart.currency.length === 0) {
          return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: cart[currency].', param: 'cart[currency]' });
        }
        if (!Number.isInteger(Number(cart.total))) {
          return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: cart[total].', param: 'cart[total]' });
        }
        const zeilen = Array.isArray(cart.line_items) ? cart.line_items : [];
        if (zeilen.length === 0) {
          return fehler(400, { type: 'invalid_request_error', message: 'Missing required param: cart[line_items].', param: 'cart[line_items]' });
        }
        for (const [i, zeile] of zeilen.entries()) {
          const z = (zeile ?? {}) as Record<string, unknown>;
          for (const k of Object.keys(z)) {
            if (!['description', 'quantity', 'amount'].includes(k)) {
              return fehler(400, {
                type: 'invalid_request_error',
                message: `Received unknown parameter: cart[line_items][${i}][${k}]`,
                param: `cart[line_items][${i}][${k}]`,
              });
            }
          }
          if (typeof z.description !== 'string' || z.description.length === 0) {
            return fehler(400, {
              type: 'invalid_request_error',
              message: `Missing required param: cart[line_items][${i}][description].`,
              param: `cart[line_items][${i}][description]`,
            });
          }
          if (!Number.isInteger(Number(z.quantity)) || Number(z.quantity) <= 0) {
            return fehler(400, {
              type: 'invalid_request_error',
              message: `Invalid integer: cart[line_items][${i}][quantity]`,
              param: `cart[line_items][${i}][quantity]`,
            });
          }
          if (!Number.isInteger(Number(z.amount))) {
            return fehler(400, {
              type: 'invalid_request_error',
              message: `Invalid integer: cart[line_items][${i}][amount]`,
              param: `cart[line_items][${i}][amount]`,
            });
          }
        }
        if (l.status === 'offline') {
          return fehler(400, {
            type: 'invalid_request_error',
            code: 'terminal_reader_offline',
            message: 'Reader is currently offline.',
          });
        }
        return ok(leserSchnappschuss(l));
      }

      if (unterpfad === 'cancel_action' && methode === 'POST') {
        if (l.action === null || l.action.status !== 'in_progress') {
          return fehler(400, {
            type: 'invalid_request_error',
            message: 'Reader has no action in progress to cancel.',
          });
        }
        l.action = null;
        return ok(leserSchnappschuss(l));
      }
    }

    // ── Testmodus: simulierte Kartenpraesentation ────────────────────────
    const praesentiere = /^\/v1\/test_helpers\/terminal\/readers\/([^/?]+)\/present_payment_method$/.exec(
      url.pathname,
    );
    if (praesentiere !== null && methode === 'POST') {
      const l = leser.get(praesentiere[1]!);
      if (l === undefined || l.konto !== konto || l.geloescht) {
        return fehler(404, {
          type: 'invalid_request_error',
          code: 'resource_missing',
          message: `No such terminal reader: '${praesentiere[1]!}'`,
        });
      }
      if (!l.deviceType.startsWith('simulated')) {
        return fehler(400, {
          type: 'invalid_request_error',
          message: 'Test helpers may only be used with simulated readers.',
        });
      }
      const f = form ?? {};
      const kartenprofil = (f.card_present ?? {}) as Record<string, unknown>;
      const nummer = typeof kartenprofil.number === 'string' ? kartenprofil.number : KARTE_ERFOLG;
      return praesentiereKarte(l, nummer);
    }

    return fehler(404, {
      type: 'invalid_request_error',
      message: `Unrecognized request URL (${methode}: ${url.pathname}).`,
    });
  }

  return {
    fetch: attrappenFetch as typeof fetch,
    ereignisse,
    anrufe,
    legeKontoAn(acct, kartenStatus = 'active') {
      konten.set(acct, { id: acct, kartenStatus });
    },
    schalteLeserOffline(tmr) {
      const l = leser.get(tmr);
      if (l === undefined) throw new Error(`Attrappe: Leser ${tmr} existiert nicht.`);
      l.status = 'offline';
    },
    lasseAktionVerstreichen(tmr) {
      const l = leser.get(tmr);
      if (l === undefined || l.action === null || l.action.status !== 'in_progress') {
        throw new Error(`Attrappe: Leser ${tmr} hat keine laufende Aktion.`);
      }
      l.action.status = 'failed';
      l.action.failureCode = 'session_timed_out';
      l.action.failureMessage = 'The collection timed out before a card was presented.';
      ereignis('terminal.reader.action_failed', leserSchnappschuss(l), l.konto);
    },
    leser,
    intents,
    refunds,
  };
}
