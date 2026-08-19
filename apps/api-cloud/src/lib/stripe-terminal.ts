/**
 * Stripe Terminal — der servergesteuerte Leser-Weg (Gewerk 2, §9).
 *
 * Der Server steuert den Leser (S700): er eroeffnet den PaymentIntent AUF
 * dem Konto des Haendlers (Kopfzeile `Stripe-Account`, wie im Web-Shop),
 * zeigt die ECHTEN Warenkorbzeilen auf dem Kundendisplay des Lesers an
 * (`set_reader_display`, Basels Einfall: der Leser IST das Kundendisplay)
 * und ruft `process_payment_intent` auf. Das Ergebnis kommt als Webhook.
 *
 * Kein Stripe-SDK — dieselbe schlanke, formularkodierte v1-Anbindung wie
 * storefront-cart.ts. Stripe rechnet NICHTS: unsere Cent-Betraege sind die
 * einzige Wahrheit, auch auf dem Display.
 *
 * Ein Verbindungs-Token braucht dieser Weg NICHT: Connection-Tokens gehoeren
 * zum SDK-gesteuerten Betrieb; servergesteuert spricht allein unser Server
 * mit Stripe, und der Leser gehorcht Stripe.
 */

const STRIPE_API = 'https://api.stripe.com';

export interface TerminalConfig {
  secretKey: string;
  /** Die gepinnte v1-Version (STRIPE_API_VERSION). */
  apiVersion: string;
}

export type TerminalRefusal = 'NOT_CONFIGURED' | 'PROVIDER_REJECTED' | 'INVALID_INPUT';

export type TerminalResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: TerminalRefusal;
      detail: string;
      /**
       * Stripes Fehlercode, roh durchgereicht (`terminal_reader_offline`,
       * `amount_too_small`, …), damit der Aufrufer das Fehlerbild fuer die
       * Kasse daraus ableiten kann, ohne Texte zu raten.
       */
      code: string | null;
    };

function fail<T>(reason: TerminalRefusal, detail: string, code: string | null = null): TerminalResult<T> {
  return { ok: false, reason, detail, code };
}

/** Eine Warenkorbzeile fuer das Kundendisplay. Betraege in ganzen Cent. */
export interface DisplayPosition {
  bezeichnung: string;
  menge: number;
  betragCents: number;
}

const LESER_FORM = /^tmr_[A-Za-z0-9]+$/;
const INTENT_FORM = /^pi_[A-Za-z0-9_]+$/;
const KONTO_FORM = /^acct_[A-Za-z0-9]+$/;

/**
 * Ein Aufruf gegen die v1-Wege, formularkodiert, auf dem Konto des
 * Haendlers. Netzfehler sind KEIN Erfolg; Stripes Fehlertext wird gekuerzt
 * durchgereicht, nicht verschluckt (dasselbe Muster wie stripe-connect.ts).
 */
async function callV1(
  cfg: TerminalConfig,
  input: {
    path: string;
    method: 'GET' | 'POST' | 'DELETE';
    stripeAccount: string;
    form?: URLSearchParams;
    idempotencyKey?: string;
  },
): Promise<TerminalResult<Record<string, unknown>>> {
  if (cfg.secretKey.trim().length === 0) {
    return fail(
      'NOT_CONFIGURED',
      'Fuer Stripe ist kein Zugang hinterlegt. Es wurde nichts angestossen.',
    );
  }
  if (!KONTO_FORM.test(input.stripeAccount)) {
    return fail('INVALID_INPUT', 'Die Kontokennung hat nicht die Form, die Stripe vergibt.');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.secretKey}`,
    'Stripe-Version': cfg.apiVersion,
    // DIE KOPFZEILE IST DER SCHALTER: mit ihr laeuft alles auf dem Konto
    // des Haendlers, nicht auf unserem (Direktbelastung, kein ZAG).
    'Stripe-Account': input.stripeAccount,
  };
  if (input.form !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (input.idempotencyKey !== undefined) headers['Idempotency-Key'] = input.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}${input.path}`, {
      method: input.method,
      headers,
      ...(input.form !== undefined ? { body: input.form.toString() } : {}),
    });
  } catch (err) {
    return fail('PROVIDER_REJECTED', `Stripe war nicht erreichbar: ${String(err)}`);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let message = text.slice(0, 400);
    let code: string | null = null;
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; code?: string; decline_code?: string };
      };
      if (parsed.error?.message !== undefined) message = parsed.error.message;
      code = parsed.error?.decline_code ?? parsed.error?.code ?? null;
    } catch {
      /* der rohe Text bleibt stehen */
    }
    return fail('PROVIDER_REJECTED', `Stripe hat abgelehnt (${res.status}): ${message}`, code);
  }
  try {
    return { ok: true, value: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return fail('PROVIDER_REJECTED', 'Stripe hat eine unlesbare Antwort geschickt.');
  }
}

// ── Standorte ──────────────────────────────────────────────────────────────

/** Die Standorte (`tml_…`) des Haendlerkontos. */
export async function listeLocations(
  cfg: TerminalConfig,
  stripeAccountId: string,
): Promise<TerminalResult<{ id: string }[]>> {
  const res = await callV1(cfg, {
    path: '/v1/terminal/locations',
    method: 'GET',
    stripeAccount: stripeAccountId,
  });
  if (!res.ok) return res;
  const data = Array.isArray(res.value.data) ? (res.value.data as { id: string }[]) : [];
  return { ok: true, value: data.map((l) => ({ id: String(l.id) })) };
}

/** Legt einen Standort an — noetig, bevor der erste Leser registriert wird. */
export async function legeLocationAn(
  cfg: TerminalConfig,
  stripeAccountId: string,
  anschrift: {
    displayName: string;
    line1: string;
    postalCode: string;
    city: string;
    country?: string;
  },
): Promise<TerminalResult<{ id: string }>> {
  const form = new URLSearchParams();
  form.set('display_name', anschrift.displayName);
  form.set('address[line1]', anschrift.line1);
  form.set('address[postal_code]', anschrift.postalCode);
  form.set('address[city]', anschrift.city);
  form.set('address[country]', anschrift.country ?? 'DE');
  const res = await callV1(cfg, {
    path: '/v1/terminal/locations',
    method: 'POST',
    stripeAccount: stripeAccountId,
    form,
  });
  if (!res.ok) return res;
  return { ok: true, value: { id: String(res.value.id ?? '') } };
}

// ── Leser ──────────────────────────────────────────────────────────────────

export interface RegistrierterLeser {
  readerId: string;
  deviceType: string;
  serialNumber: string;
  status: string;
  locationId: string;
}

/**
 * Registriert einen Leser auf dem Konto des Haendlers. Der
 * Registrierungscode kommt vom Geraet selbst (drei Woerter auf dem
 * Display; simulierte Leser tragen `simulated-…`).
 */
export async function registriereLeser(
  cfg: TerminalConfig,
  input: {
    stripeAccountId: string;
    registrationCode: string;
    label: string;
    locationId: string;
  },
): Promise<TerminalResult<RegistrierterLeser>> {
  if (input.registrationCode.trim().length === 0) {
    return fail('INVALID_INPUT', 'Der Registrierungscode vom Geraet fehlt.');
  }
  const form = new URLSearchParams();
  form.set('registration_code', input.registrationCode.trim());
  form.set('label', input.label);
  form.set('location', input.locationId);
  const res = await callV1(cfg, {
    path: '/v1/terminal/readers',
    method: 'POST',
    stripeAccount: input.stripeAccountId,
    form,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    value: {
      readerId: String(res.value.id ?? ''),
      deviceType: String(res.value.device_type ?? ''),
      serialNumber: String(res.value.serial_number ?? ''),
      status: String(res.value.status ?? ''),
      locationId: String(res.value.location ?? ''),
    },
  };
}

/** Die Leser, wie Stripe sie fuer dieses Konto kennt (Stand inklusive). */
export async function listeLeserBeiStripe(
  cfg: TerminalConfig,
  stripeAccountId: string,
): Promise<TerminalResult<{ id: string; status: string }[]>> {
  const res = await callV1(cfg, {
    path: '/v1/terminal/readers',
    method: 'GET',
    stripeAccount: stripeAccountId,
  });
  if (!res.ok) return res;
  const data = Array.isArray(res.value.data)
    ? (res.value.data as { id: string; status?: string }[])
    : [];
  return {
    ok: true,
    value: data.map((l) => ({ id: String(l.id), status: String(l.status ?? '') })),
  };
}

export async function loescheLeserBeiStripe(
  cfg: TerminalConfig,
  stripeAccountId: string,
  readerId: string,
): Promise<TerminalResult<{ deleted: boolean }>> {
  if (!LESER_FORM.test(readerId)) {
    return fail('INVALID_INPUT', 'Die Leser-Kennung hat nicht die Form, die Stripe vergibt.');
  }
  const res = await callV1(cfg, {
    path: `/v1/terminal/readers/${readerId}`,
    method: 'DELETE',
    stripeAccount: stripeAccountId,
  });
  if (!res.ok) return res;
  return { ok: true, value: { deleted: res.value.deleted === true } };
}

// ── Die Zahlung ────────────────────────────────────────────────────────────

/**
 * Eroeffnet den PaymentIntent kartenpraesent auf dem Konto des Haendlers.
 * Die Vermittlungsgebuehr kommt fertig gerechnet herein (Provisionstabelle
 * Kanal POS, resolveCommission) — hier wird nichts erfunden.
 */
export async function erzeugeKartenzahlung(
  cfg: TerminalConfig,
  input: {
    stripeAccountId: string;
    amountCents: number;
    feeCents: number;
    idempotencyKey: string;
    metadata?: Record<string, string>;
  },
): Promise<TerminalResult<{ intentId: string }>> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return fail('INVALID_INPUT', 'Der Betrag muss in ganzen Cent groesser null sein.');
  }
  const form = new URLSearchParams();
  form.set('amount', String(input.amountCents));
  form.set('currency', 'eur');
  form.set('payment_method_types[0]', 'card_present');
  form.set('capture_method', 'automatic');
  if (input.feeCents > 0) form.set('application_fee_amount', String(input.feeCents));
  for (const [k, v] of Object.entries(input.metadata ?? {})) {
    form.set(`metadata[${k}]`, v);
  }
  const res = await callV1(cfg, {
    path: '/v1/payment_intents',
    method: 'POST',
    stripeAccount: input.stripeAccountId,
    form,
    idempotencyKey: input.idempotencyKey,
  });
  if (!res.ok) return res;
  const intentId = String(res.value.id ?? '');
  if (!INTENT_FORM.test(intentId)) {
    return fail('PROVIDER_REJECTED', 'Stripe hat keine brauchbare Intent-Kennung geliefert.');
  }
  return { ok: true, value: { intentId } };
}

/**
 * ⭐ Der Leser IST das Kundendisplay: waehrend der Zahlung stehen die
 * ECHTEN Warenkorbzeilen darauf — Bezeichnung, Menge, Betrag, dazu Steuer
 * und Summe. Alles in ganzen Cent, von uns gerechnet, nie von Stripe.
 */
export async function zeigeWarenkorb(
  cfg: TerminalConfig,
  input: {
    stripeAccountId: string;
    readerId: string;
    positionen: readonly DisplayPosition[];
    steuerCents: number;
    summeCents: number;
  },
): Promise<TerminalResult<Record<string, never>>> {
  if (!LESER_FORM.test(input.readerId)) {
    return fail('INVALID_INPUT', 'Die Leser-Kennung hat nicht die Form, die Stripe vergibt.');
  }
  if (input.positionen.length === 0) {
    return fail('INVALID_INPUT', 'Ohne Positionen gibt es nichts anzuzeigen.');
  }
  const form = new URLSearchParams();
  form.set('type', 'cart');
  form.set('cart[currency]', 'eur');
  form.set('cart[tax]', String(input.steuerCents));
  form.set('cart[total]', String(input.summeCents));
  for (const [i, p] of input.positionen.entries()) {
    form.set(`cart[line_items][${i}][description]`, p.bezeichnung);
    form.set(`cart[line_items][${i}][quantity]`, String(p.menge));
    form.set(`cart[line_items][${i}][amount]`, String(p.betragCents));
  }
  const res = await callV1(cfg, {
    path: `/v1/terminal/readers/${input.readerId}/set_reader_display`,
    method: 'POST',
    stripeAccount: input.stripeAccountId,
    form,
  });
  if (!res.ok) return res;
  return { ok: true, value: {} };
}

/** `process_payment_intent` — der Leser beginnt zu sammeln. */
export async function starteZahlungAmLeser(
  cfg: TerminalConfig,
  input: { stripeAccountId: string; readerId: string; intentId: string },
): Promise<TerminalResult<Record<string, never>>> {
  if (!LESER_FORM.test(input.readerId) || !INTENT_FORM.test(input.intentId)) {
    return fail('INVALID_INPUT', 'Leser- oder Zahlungskennung hat nicht die erwartete Form.');
  }
  const form = new URLSearchParams();
  form.set('payment_intent', input.intentId);
  const res = await callV1(cfg, {
    path: `/v1/terminal/readers/${input.readerId}/process_payment_intent`,
    method: 'POST',
    stripeAccount: input.stripeAccountId,
    form,
  });
  if (!res.ok) return res;
  return { ok: true, value: {} };
}

/** `cancel_action` — die laufende Sammlung am Leser beenden. */
export async function brichLeserAktionAb(
  cfg: TerminalConfig,
  input: { stripeAccountId: string; readerId: string },
): Promise<TerminalResult<Record<string, never>>> {
  if (!LESER_FORM.test(input.readerId)) {
    return fail('INVALID_INPUT', 'Die Leser-Kennung hat nicht die Form, die Stripe vergibt.');
  }
  const res = await callV1(cfg, {
    path: `/v1/terminal/readers/${input.readerId}/cancel_action`,
    method: 'POST',
    stripeAccount: input.stripeAccountId,
    form: new URLSearchParams(),
  });
  if (!res.ok) return res;
  return { ok: true, value: {} };
}

/** Storniert den Intent — nach Abbruch oder Leser-Stoerung. */
export async function storniereIntent(
  cfg: TerminalConfig,
  input: { stripeAccountId: string; intentId: string },
): Promise<TerminalResult<{ status: string }>> {
  if (!INTENT_FORM.test(input.intentId)) {
    return fail('INVALID_INPUT', 'Die Zahlungskennung hat nicht die Form, die Stripe vergibt.');
  }
  const res = await callV1(cfg, {
    path: `/v1/payment_intents/${input.intentId}/cancel`,
    method: 'POST',
    stripeAccount: input.stripeAccountId,
    form: new URLSearchParams(),
  });
  if (!res.ok) return res;
  return { ok: true, value: { status: String(res.value.status ?? '') } };
}

export interface IntentStand {
  status: string;
  /** `decline_code` (sonst `code`) des letzten Zahlungsfehlers, sofern einer ansteht. */
  declineCode: string | null;
  declineMeldung: string | null;
  /** Das Kartennetz der erfolgreichen Belastung ('girocard', 'visa', …). */
  kartennetz: string | null;
}

/** Fragt den Intent-Stand direkt bei Stripe ab — die Quelle der Wahrheit. */
export async function holeIntent(
  cfg: TerminalConfig,
  input: { stripeAccountId: string; intentId: string },
): Promise<TerminalResult<IntentStand>> {
  if (!INTENT_FORM.test(input.intentId)) {
    return fail('INVALID_INPUT', 'Die Zahlungskennung hat nicht die Form, die Stripe vergibt.');
  }
  const res = await callV1(cfg, {
    path: `/v1/payment_intents/${input.intentId}?expand[0]=latest_charge`,
    method: 'GET',
    stripeAccount: input.stripeAccountId,
  });
  if (!res.ok) return res;
  const fehler = (res.value.last_payment_error ?? null) as {
    code?: string;
    decline_code?: string;
    message?: string;
  } | null;
  const charge = (res.value.latest_charge ?? null) as {
    payment_method_details?: { card_present?: { network?: string; brand?: string } };
    status?: string;
  } | null;
  const details = charge?.payment_method_details?.card_present;
  const netz =
    charge !== null && charge.status === 'succeeded'
      ? (details?.network ?? details?.brand ?? null)
      : null;
  return {
    ok: true,
    value: {
      status: String(res.value.status ?? ''),
      declineCode: fehler?.decline_code ?? fehler?.code ?? null,
      declineMeldung: fehler?.message ?? null,
      kartennetz: netz === null ? null : String(netz).toLowerCase(),
    },
  };
}

// ── Erstattung ─────────────────────────────────────────────────────────────

export async function erstatte(
  cfg: TerminalConfig,
  input: { stripeAccountId: string; intentId: string; amountCents?: number },
): Promise<TerminalResult<{ refundId: string; status: string }>> {
  if (!INTENT_FORM.test(input.intentId)) {
    return fail('INVALID_INPUT', 'Die Zahlungskennung hat nicht die Form, die Stripe vergibt.');
  }
  const form = new URLSearchParams();
  form.set('payment_intent', input.intentId);
  if (input.amountCents !== undefined) {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return fail('INVALID_INPUT', 'Der Erstattungsbetrag muss in ganzen Cent groesser null sein.');
    }
    form.set('amount', String(input.amountCents));
  }
  const res = await callV1(cfg, {
    path: '/v1/refunds',
    method: 'POST',
    stripeAccount: input.stripeAccountId,
    form,
  });
  if (!res.ok) return res;
  return {
    ok: true,
    value: { refundId: String(res.value.id ?? ''), status: String(res.value.status ?? '') },
  };
}

export interface ErstattungsWeg {
  weg: 'SOFORT' | 'SEPA_UEBERWEISUNG';
  /** Ein Satz auf Deutsch, den die Kasse dem Kassierer woertlich zeigt. */
  hinweis: string;
}

/**
 * ⚠️ girocard kennt KEINE Sofort-Erstattung: Stripe ueberweist per SEPA,
 * ein bis zwei Tage. Die Flaeche muss das dem Kunden ehrlich sagen koennen,
 * BEVOR er den Laden verlaesst — deshalb liefert der Server die Auskunft
 * ausdruecklich mit, statt sie der Oberflaeche zum Raten zu ueberlassen.
 */
export function erstattungsWeg(kartennetz: string | null): ErstattungsWeg {
  if ((kartennetz ?? '').toLowerCase() === 'girocard') {
    return {
      weg: 'SEPA_UEBERWEISUNG',
      hinweis:
        'girocard kennt keine Sofort-Erstattung. Stripe ueberweist den Betrag per SEPA, ' +
        'das Geld ist in ein bis zwei Werktagen auf dem Konto des Kunden.',
    };
  }
  return {
    weg: 'SOFORT',
    hinweis: 'Die Erstattung geht sofort auf die Karte des Kunden zurueck.',
  };
}
