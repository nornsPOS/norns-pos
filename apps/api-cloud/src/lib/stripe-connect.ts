/**
 * Stripe Connect — das eigene Konto des Händlers, auf der Accounts-v2-Schnittstelle.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  DAS GELD LÄUFT NIE ÜBER UNS. DARUM BRAUCHT NORNS KEINE BAFIN-ERLAUBNIS.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Wer für fremde Rechnung Gelder entgegennimmt und weiterleitet, erbringt in
 * Deutschland einen Zahlungsdienst und braucht eine Erlaubnis nach dem ZAG.
 * Diese Datei ist der Grund, warum das auf Norns nicht zutrifft:
 *
 *   • Der Händler hat ein EIGENES Konto bei Stripe auf seinen Namen.
 *   • Die Zahlung wird AUF diesem Konto eröffnet (Kopfzeile `Stripe-Account`),
 *     nicht auf unserem. Das nennt Stripe eine Direktbelastung.
 *   • Stripe zahlt unmittelbar an den Händler aus.
 *   • Wir entnehmen ausschliesslich eine Vermittlungsgebühr.
 *
 * Zwei Angaben in `defaults.responsibilities` schreiben das ausdrücklich fest:
 * `fees_collector: 'stripe'` und `losses_collector: 'stripe'`. Damit trägt der
 * Händler die Entgelte UND die Rückbuchungen selbst. Stünde dort 'application',
 * hafteten wir für seine Verluste, und aus der Vermittlung würde ein eigenes
 * Risikogeschäft mit ganz anderer aufsichtsrechtlicher Beurteilung.
 *
 * ── Warum v2 und nicht die vertraute v1-Schnittstelle ──────────────────────
 *
 * Dieser Anschluss war zuerst gegen `POST /v1/accounts` mit `type: 'standard'`
 * gebaut. Die Unit-Tests waren grün, weil sie kein Netz brauchen. Der erste
 * echte Aufruf gegen Stripe (Testmodus) lieferte:
 *
 *   400 — "Stripe no longer recommends Accounts v1 for new Connect
 *          integrations. Create connected accounts with POST /v2/core/accounts"
 *
 * Für ein System, das gerade seinen ersten zahlenden Händler aufnimmt, wäre
 * ein Start auf einer abgekündigten Schnittstelle ein vermeidbarer Fehler.
 * Deshalb v2. Zwei Dinge dabei im Kopf behalten:
 *
 *   1. v2 spricht JSON, nicht formularkodiert wie v1.
 *   2. v2 braucht eine EIGENE, neuere Versionsangabe. Die für Zahlungen
 *      gepinnte v1-Version bleibt davon unberührt, beide laufen nebeneinander.
 *
 * Die Zahlungswege selbst (`/v1/payment_intents`) bleiben v1 und sind mit
 * v2-Konten voll verträglich. Nur die Kontoverwaltung wanderte.
 *
 * ── Zwei Fehler, die diese Datei bewusst verhindert ────────────────────────
 *
 * 1. EIN NEUES KONTO KANN NOCH NICHT KASSIEREN.
 *    Stripe legt es sofort an, prüft aber Identität, Gewerbe und Bank danach.
 *    In v2 heisst dieser Zustand `card_payments.status = 'restricted'`. Wer
 *    trotzdem eine Zahlung eröffnet, belastet den Kunden für einen Händler,
 *    der die Gutschrift nie sieht. `assertReadyToCharge` entscheidet das,
 *    und sonst niemand.
 *
 * 2. DER ONBOARDING-LINK IST EIN EINMALSCHLÜSSEL.
 *    Er läuft nach wenigen Minuten ab und lässt sich nicht wiederverwenden.
 *    Weder speichern noch verschicken: erzeugen und sofort öffnen.
 *
 * Kein Stripe-SDK, dieselbe schlanke REST-Anbindung wie storefront-cart.ts.
 */

import { computeCommissionCents } from './commission.js';

const STRIPE_API = 'https://api.stripe.com';

/**
 * Die Versionsangabe für die v2-Kontowege. Bewusst getrennt von der für
 * Zahlungen gepinnten v1-Version: die eine anzuheben darf die andere nie
 * mitreissen.
 */
export const STRIPE_V2_VERSION = '2026-06-24.dahlia';

export interface StripeConnectConfig {
  secretKey: string;
  /** Die gepinnte v1-Version, für Zahlungswege. */
  apiVersion: string;
  /** Vorgabegebühr in Basispunkten, falls für den Laden nichts hinterlegt ist. */
  defaultFeeBps: number;
}

export type ConnectRefusal =
  | 'NOT_CONFIGURED'
  | 'PROVIDER_REJECTED'
  | 'NOT_READY'
  | 'INVALID_INPUT';

export type ConnectResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: ConnectRefusal; detail: string };

/** Der Freischaltungsstand, wie Stripe ihn meldet. */
export interface ConnectedAccountState {
  stripeAccountId: string;
  country: string;
  defaultCurrency: string;
  /** Wahr, sobald `card_payments.status` aktiv ist. Die einzige Wahrheit für die Kasse. */
  chargesEnabled: boolean;
  /** In v2 aus dem Zustand der Auszahlungsfähigkeit abgeleitet. */
  payoutsEnabled: boolean;
  /** Wahr, sobald keine Angabe mehr überfällig ist. */
  detailsSubmitted: boolean;
  /** Was Stripe noch braucht, roh, damit die Oberfläche es benennen kann. */
  requirements: Record<string, unknown>;
}

function fail<T>(reason: ConnectRefusal, detail: string): ConnectResult<T> {
  return { ok: false, reason, detail };
}

/** Ein Aufruf gegen die v2-Wege. JSON hinein, JSON heraus. */
async function callV2(
  cfg: StripeConnectConfig,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
): Promise<ConnectResult<Record<string, unknown>>> {
  if (cfg.secretKey.trim().length === 0) {
    return fail(
      'NOT_CONFIGURED',
      'Für Stripe ist kein Zugang hinterlegt. Es wurde kein Konto angelegt und keine Zahlung eröffnet.',
    );
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.secretKey}`,
    'Stripe-Version': STRIPE_V2_VERSION,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    // `exactOptionalPropertyTypes`: ein `body: undefined` ist NICHT dasselbe
    // wie ein fehlendes body. Bei GET muss das Feld ganz wegbleiben.
    res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // Ein Netzfehler ist KEIN Erfolg. Er wird als Ablehnung gemeldet, damit
    // nirgends ein halber Zustand entsteht.
    return fail('PROVIDER_REJECTED', `Stripe war nicht erreichbar: ${String(err)}`);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // Stripes Fehlertext trägt die für den Händler wirklich nützliche
    // Begründung. Er wird gekürzt durchgereicht, nicht verschluckt.
    let message = text.slice(0, 400);
    try {
      const parsed = JSON.parse(text) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* der rohe Text bleibt stehen */
    }
    return fail('PROVIDER_REJECTED', `Stripe hat abgelehnt (${res.status}): ${message}`);
  }
  try {
    return { ok: true, value: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return fail('PROVIDER_REJECTED', 'Stripe hat eine unlesbare Antwort geschickt.');
  }
}

/**
 * Liest den Freischaltungsstand aus einer v2-Kontoantwort.
 *
 * Der entscheidende Pfad ist
 * `configuration.merchant.capabilities.card_payments.status`. In v1 hiess das
 * schlicht `charges_enabled`; in v2 ist es je Zahlungsart aufgeschlüsselt, und
 * für die Kasse zählt allein die Karte.
 */
function readStateV2(raw: Record<string, unknown>): ConnectedAccountState {
  const conf = (raw.configuration ?? {}) as Record<string, unknown>;
  const merchant = (conf.merchant ?? {}) as Record<string, unknown>;
  const caps = (merchant.capabilities ?? {}) as Record<string, unknown>;
  const card = (caps.card_payments ?? null) as
    | { status?: string; status_details?: { code?: string }[] }
    | null;
  const defaults = (raw.defaults ?? {}) as Record<string, unknown>;
  const identity = (raw.identity ?? {}) as Record<string, unknown>;
  const requirements = (raw.requirements ?? {}) as Record<string, unknown>;

  const cardStatus = card?.status ?? 'inactive';
  // `restricted` heisst: Stripe will noch etwas. `pending` heisst: Stripe prüft.
  // Nur `active` erlaubt eine Zahlung.
  const chargesEnabled = cardStatus === 'active';

  // In v2 gibt es kein einzelnes `details_submitted`. Überfällige Forderungen
  // sind das ehrlichere Signal: solange etwas überfällig ist, hat der Händler
  // den Vorgang nicht zu Ende gebracht.
  const details = (card?.status_details ?? []) as { code?: string }[];
  const pastDue = details.some((d) => d.code === 'requirements_past_due');
  const detailsSubmitted = !pastDue;

  return {
    stripeAccountId: String(raw.id ?? ''),
    country: String(identity.country ?? 'DE').toUpperCase(),
    defaultCurrency: String(defaults.currency ?? 'eur').toLowerCase(),
    chargesEnabled,
    // Auszahlung setzt Kassieren voraus und kommt bei uns nie früher.
    payoutsEnabled: chargesEnabled && detailsSubmitted,
    detailsSubmitted,
    requirements: { cardStatus, statusDetails: details, ...requirements },
  };
}

/** Die Felder, die bei jeder Kontoabfrage mitgeliefert werden sollen. */
const INCLUDE = ['configuration.merchant', 'identity', 'defaults', 'requirements'];

/**
 * Legt ein Händlerkonto an. Der Händler schliesst danach bei Stripe selbst ab;
 * wir sehen seine Ausweis- und Bankdaten nie.
 *
 * `dashboard: 'full'` gibt ihm die vollständige eigene Stripe-Oberfläche. Das
 * entspricht dem, was früher ein Standard-Konto war, und ist für unser Modell
 * richtig: er ist Vertragspartner seiner Kunden, also gehört ihm auch die
 * Oberfläche, in der er Zahlungen und Rückbuchungen sieht.
 */
export async function createStandardAccount(
  cfg: StripeConnectConfig,
  input: { email?: string | null; businessName?: string | null },
): Promise<ConnectResult<ConnectedAccountState>> {
  if (!input.email || input.email.trim().length === 0) {
    // v2 verlangt eine Kontaktadresse. Ohne sie kann Stripe den Händler nicht
    // erreichen, und die Einrichtung bliebe stecken.
    return fail('INVALID_INPUT', 'Für das Konto wird eine Kontakt-E-Mail des Händlers gebraucht.');
  }
  const name = input.businessName?.trim();
  const body = {
    contact_email: input.email.trim(),
    ...(name ? { display_name: name } : {}),
    identity: {
      country: 'de',
      entity_type: 'company',
      ...(name ? { business_details: { registered_name: name } } : {}),
    },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
    },
    defaults: {
      currency: 'eur',
      // DIE ZWEI ZEILEN, DIE UNS AUS DEM ZAG HALTEN: der Händler trägt die
      // Entgelte und die Verluste. Wir sind Vermittler, nicht Risikoträger.
      responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
    },
    dashboard: 'full',
    include: INCLUDE,
  };

  const res = await callV2(cfg, '/v2/core/accounts', 'POST', body);
  if (!res.ok) return res;
  return { ok: true, value: readStateV2(res.value) };
}

/**
 * Erzeugt den Link, über den der Händler sein Konto bei Stripe vervollständigt.
 *
 * Kurzlebig und einmalig. Nicht speichern, nicht verschicken, sofort öffnen.
 */
export async function createOnboardingLink(
  cfg: StripeConnectConfig,
  input: { stripeAccountId: string; returnUrl: string; refreshUrl: string },
): Promise<ConnectResult<{ url: string; expiresAt: number }>> {
  if (!/^acct_[A-Za-z0-9]+$/.test(input.stripeAccountId)) {
    return fail('INVALID_INPUT', 'Die Kontokennung hat nicht die Form, die Stripe vergibt.');
  }
  const res = await callV2(cfg, '/v2/core/account_links', 'POST', {
    account: input.stripeAccountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant'],
        return_url: input.returnUrl,
        refresh_url: input.refreshUrl,
      },
    },
  });
  if (!res.ok) return res;
  const url = String(res.value.url ?? '');
  if (url.length === 0) {
    return fail('PROVIDER_REJECTED', 'Stripe hat keinen Link zurückgegeben.');
  }
  // v2 liefert einen ISO-Zeitpunkt, v1 lieferte Sekunden. Nach aussen bleibt
  // es eine Sekundenzahl, damit die Aufrufer unverändert bleiben.
  const raw = res.value.expires_at;
  const expiresAt =
    typeof raw === 'number' ? raw : Math.floor(new Date(String(raw ?? '')).getTime() / 1000) || 0;
  return { ok: true, value: { url, expiresAt } };
}

/** Fragt den aktuellen Stand direkt bei Stripe ab. Die Quelle der Wahrheit. */
export async function retrieveAccount(
  cfg: StripeConnectConfig,
  stripeAccountId: string,
): Promise<ConnectResult<ConnectedAccountState>> {
  if (!/^acct_[A-Za-z0-9]+$/.test(stripeAccountId)) {
    return fail('INVALID_INPUT', 'Die Kontokennung hat nicht die Form, die Stripe vergibt.');
  }
  // v2 lehnt die Kurzform `include[]=` ab und verlangt ausdrückliche Indizes.
  // Gemessen an der echten Schnittstelle, nicht angenommen:
  //   400 — "Query parameters with the [] array syntax are unsupported.
  //          Please provide exact indexes, i.e. value[0], value[1], etc."
  const query = INCLUDE.map((i, n) => `include[${n}]=${encodeURIComponent(i)}`).join('&');
  const res = await callV2(cfg, `/v2/core/accounts/${stripeAccountId}?${query}`, 'GET');
  if (!res.ok) return res;
  return { ok: true, value: readStateV2(res.value) };
}

/**
 * DIE TORWÄCHTER-FUNKTION für Connect.
 *
 * Sie beantwortet genau eine Frage: darf auf diesem Konto jetzt kassiert
 * werden? Alles andere, Auszahlung, offene Unterlagen, Sperren, ist für die
 * Kasse in diesem Augenblick unerheblich.
 *
 * Getrennt von der Auszahlung, weil beides auseinanderfallen kann: ein Konto
 * darf oft kassieren, bevor die Bankverbindung geprüft ist. Das ist in
 * Ordnung, das Geld liegt dann bei Stripe und wird später ausgezahlt.
 */
export function assertReadyToCharge(state: {
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
}): { ready: boolean; reason: string } {
  if (!state.chargesEnabled) {
    return {
      ready: false,
      reason: state.detailsSubmitted
        ? 'Stripe prüft die eingereichten Angaben noch. Sobald die Prüfung durch ist, kann kassiert werden.'
        : 'Die Einrichtung des Stripe-Kontos ist noch nicht abgeschlossen. Bitte den Vorgang bei Stripe beenden.',
    };
  }
  return { ready: true, reason: 'Das Konto ist zur Kartenzahlung freigeschaltet.' };
}

/**
 * Berechnet die Vermittlungsgebühr in ganzen Cent.
 *
 * Seit 0110 wohnt diese Rechnung in `commission.ts` und nicht mehr hier. Der
 * Grund ist nicht Ordnungsliebe: die Gebühr ist eine Abmachung zwischen Norns
 * und dem Händler und hat mit dem Zahlungsanbieter nichts zu tun. Läge sie in
 * einer Datei namens `stripe-connect.ts`, wanderte sie beim nächsten
 * Anbieterwechsel mit hinaus, obwohl sie bleiben soll.
 *
 * Diese Hülle bleibt stehen, damit die bestehenden Aufrufer unverändert
 * weiterlaufen. Sie ruft dieselbe eine Rechnung auf, es gibt keine zweite.
 *
 * Die Eigenschaften der Rechnung, unverändert und absichtlich so:
 *
 *   • ABGERUNDET, nicht kaufmännisch gerundet. Bei einem Streit über einen
 *     halben Cent soll die Abweichung zugunsten des Händlers ausfallen, nie
 *     zu unseren Gunsten. Das ist billiger als jede Diskussion darüber.
 *
 *   • NIE grösser als der Betrag selbst. Stripe würde eine Gebühr über dem
 *     Zahlbetrag ablehnen, und zwar erst bei der Zahlung, also vor dem Kunden
 *     an der Kasse. Die Deckelung fängt das hier ab, still und vorher.
 *
 *   • NEU seit 0110: nie über 10 %. Umgebung und Datenbank decken beide
 *     bereits bei 1000 Basispunkten, ein höherer Wert kann also nur aus einem
 *     Fehler stammen. Vorher hätte ein solcher Fehler bis zum vollen
 *     Kaufpreis durchgeschlagen; jetzt ist die Zusage bedingungslos.
 */
export function computeApplicationFeeCents(amountCents: number, feeBps: number): number {
  return computeCommissionCents(amountCents, feeBps);
}

/**
 * Baut die Zusatzfelder für eine Zahlung AUF dem Konto des Händlers.
 *
 * Der Aufrufer setzt die Kopfzeile `Stripe-Account` auf `header.stripeAccount`
 * und hängt `form` an seinen bestehenden Zahlungsaufruf an. Damit wird aus
 * einer Zahlung auf unserem Konto eine Direktbelastung auf seinem, ohne dass
 * der übrige Ablauf sich ändert. Die Zahlungswege bleiben v1 und sind mit
 * v2-Konten voll verträglich.
 */
export function directChargeFields(input: {
  stripeAccountId: string;
  amountCents: number;
  feeBps: number;
}): { header: { stripeAccount: string }; form: URLSearchParams; feeCents: number } {
  const feeCents = computeApplicationFeeCents(input.amountCents, input.feeBps);
  const form = new URLSearchParams();
  if (feeCents > 0) form.set('application_fee_amount', String(feeCents));
  return {
    header: { stripeAccount: input.stripeAccountId },
    form,
    feeCents,
  };
}
