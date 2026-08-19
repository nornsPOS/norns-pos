/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Szenario Stripe-Leser — die eine Geste, servergesteuert, gegen die
 *  protokolltreue Attrappe (Gewerk 2, Koordination §9)
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Gefahren wird die GANZE Kette: echtes Postgres im Behaelter mit jeder
 * Produktionswanderung, die echte Fastify-Anwendung mit der App-Rolle, und
 * fuer Stripe die Attrappe (tests/helfer/stripe-attrappe.ts), die das
 * HTTP-Protokoll nach der API-Referenz nachbaut — im Zweifel strenger als
 * das Original. Webhook-Ereignisse werden wie bei day19/day20 SELBST
 * signiert, damit auch der Signaturweg echt geprueft ist.
 *
 * ── DER WICHTIGSTE FALL: DER DOPPELBELASTUNGS-RIEGEL ───────────────────────
 * Eine girocard-Zahlung mit PIN erzeugt bei Stripe ZWEI Belastungen — erst
 * eine weich abgelehnte mit `online_or_offline_pin_required`, dann die
 * echte. Zaehlte unser Kassenbuch beide, stuende der Tagesumsatz doppelt in
 * DSFinV-K. Der Fall unten weist nach: am Ende steht GENAU EINE Zahlung.
 */

import { createHmac, randomUUID } from 'node:crypto';

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';
import {
  KARTE_ABGELEHNT,
  KARTE_GIROCARD_PIN,
  baueStripeAttrappe,
  type AttrappenEreignis,
  type StripeAttrappe,
} from '../helfer/stripe-attrappe.js';

const ACCT = 'acct_attrappeBuehne01';
const WHSEC = 'whsec_attrappe_buehne_test';

/** Dasselbe Signatur-Muster wie day19/day20 — Stripes dokumentierte Form. */
function stripeSignature(rawBody: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('Szenario Stripe-Leser — die eine Geste aus der Kasse an den Leser', () => {
  const buehne = baueFiskalBuehne({
    umgebung: {
      STRIPE_SECRET_KEY: 'sk_test_attrappe',
      STRIPE_WEBHOOK_SECRET: WHSEC,
    },
  });

  let attrappe: StripeAttrappe;

  beforeAll(async () => {
    await buehne.starten();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  beforeEach(async () => {
    await buehne.leeren();
    await buehne.migratorSql.unsafe(
      'TRUNCATE kartenleser, leser_zahlungen, webhook_events, ' +
        'payment_commission_rates, stripe_connected_accounts CASCADE',
    );
    // Das verbundene Haendlerkonto (Mandantendatum, deshalb hier im Test
    // gesaet und nie in einer Wanderung) + Basels 1 % auf dem Kanal POS.
    await buehne.migratorSql`
      INSERT INTO stripe_connected_accounts
        (stripe_account_id, charges_enabled, payouts_enabled, details_submitted)
      VALUES (${ACCT}, TRUE, TRUE, TRUE)`;
    await buehne.migratorSql`
      INSERT INTO payment_commission_rates (provider, account_ref, channel, fee_bps)
      VALUES ('STRIPE', NULL, 'POS', 100)`;

    attrappe = baueStripeAttrappe();
    attrappe.legeKontoAn(ACCT);
    vi.stubGlobal('fetch', attrappe.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── Handgriffe ───────────────────────────────────────────────────────────

  async function registriereLeser(): Promise<{ id: string; providerReaderId: string }> {
    const res = await buehne.sende('/api/stripe/terminal/readers', {
      registrationCode: 'simulated-wpe',
      label: 'Tresen links',
      anschrift: {
        displayName: 'Warehouse14 Laden',
        line1: 'Musterstrasse 1',
        postalCode: '44135',
        city: 'Dortmund',
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json() as { id: string; providerReaderId: string };
  }

  interface ZahlungAntwort {
    zahlungId: string;
    providerIntentId: string;
    status: string;
    fehlerbild: string | null;
    fehlerMeldung: string | null;
    gebuehrCents: number;
  }

  async function starteZahlung(
    leserId: string,
    angaben?: { idempotencyKey?: string; amountCents?: number },
  ): Promise<ZahlungAntwort> {
    const amountCents = angaben?.amountCents ?? 11900;
    const res = await buehne.sende(
      '/api/stripe/terminal/payments',
      {
        readerId: leserId,
        amountCents,
        steuerCents: 1900,
        positionen: [{ bezeichnung: 'Goldring 585', menge: 1, betragCents: amountCents }],
        idempotencyKey: angaben?.idempotencyKey ?? randomUUID(),
      },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(200);
    return res.json() as ZahlungAntwort;
  }

  /** Eine simulierte Karte am Leser praesentieren — Stripes eigener Testweg. */
  async function praesentiereKarte(tmr: string, nummer: string): Promise<void> {
    const res = await attrappe.fetch(
      `https://api.stripe.com/v1/test_helpers/terminal/readers/${tmr}/present_payment_method`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer sk_test_attrappe',
          'content-type': 'application/x-www-form-urlencoded',
          'stripe-account': ACCT,
        },
        body: `card_present[number]=${nummer}`,
      },
    );
    expect(res.status).toBe(200);
  }

  /** Ein einzelnes Ereignis signiert an den Webhook liefern. */
  async function liefere(ereignis: AttrappenEreignis): Promise<LightMyRequestResponse> {
    const body = JSON.stringify(ereignis);
    const res = await buehne.app.inject({
      method: 'POST',
      url: '/api/webhooks/stripe',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignature(body, WHSEC),
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    return res;
  }

  /** Alle aufgelaufenen Attrappen-Ereignisse in Reihenfolge liefern. */
  async function liefereAlle(): Promise<void> {
    for (const e of attrappe.ereignisse.splice(0)) await liefere(e);
  }

  interface StandAntwort {
    status: string;
    fehlerbild: string | null;
    weicheAblehnungen: number;
  }

  async function holeStand(zahlungId: string): Promise<StandAntwort> {
    const res = await buehne.hol(`/api/stripe/terminal/payments/${zahlungId}`, {
      token: buehne.akteure.kassiererSitzung,
    });
    expect(res.statusCode).toBe(200);
    return res.json() as StandAntwort;
  }

  /** Der echte finalize-Weg mit dem Leser-Zahlungsbein — wie die Kasse ihn zieht. */
  async function finalisiere(providerIntentId: string): Promise<void> {
    const produktId = await buehne.legeProduktAn({ behandlung: 'STANDARD_19' });
    const sessionId = randomUUID();
    await buehne.migratorSql`
      UPDATE products
         SET status = 'RESERVED'::product_status,
             reserved_at = now(),
             reserved_by_session_id = ${sessionId},
             reserved_by_channel = 'POS'::reservation_channel,
             reserved_by_user_id = ${buehne.akteure.kassiererId}
       WHERE id = ${produktId}`;
    const res = await buehne.sende(
      '/api/transactions/finalize',
      {
        direction: 'VERKAUF',
        customerId: null,
        subtotalEur: '100.00',
        vatEur: '19.00',
        totalEur: '119.00',
        taxTreatmentCode: 'STANDARD_19',
        items: [
          {
            productId: produktId,
            reservationSessionId: sessionId,
            lineSubtotalEur: '100.00',
            lineVatEur: '19.00',
            lineTotalEur: '119.00',
            appliedTaxTreatmentCode: 'STANDARD_19',
            appliedVatRate: '0.1900',
            acquisitionCostEurSnapshot: null,
            marginEur: null,
          },
        ],
        payments: [
          {
            paymentMethod: 'STRIPE_TERMINAL',
            amountEur: '119.00',
            externalRef: providerIntentId,
          },
        ],
        idempotencyKey: randomUUID(),
      },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(200);
  }

  // ────────────────────────────────────────────────────────────────────────
  // 1. DER DOPPELBELASTUNGS-RIEGEL — der Fall, der zuerst rot war
  // ────────────────────────────────────────────────────────────────────────

  it('zaehlt die girocard-Doppelfolge als GENAU EINE Zahlung im Kassenbuch', async () => {
    const leser = await registriereLeser();
    const zahlung = await starteZahlung(leser.id);
    await praesentiereKarte(leser.providerReaderId, KARTE_GIROCARD_PIN);

    // Die Attrappe hat die dokumentierte Doppelfolge erzeugt: erst die
    // weiche Ablehnung, dann der Erfolg. Wir liefern sie EINZELN, damit der
    // Zwischenstand sichtbar wird.
    const folge = attrappe.ereignisse.splice(0);
    expect(folge.map((e) => e.type)).toEqual([
      'payment_intent.payment_failed',
      'payment_intent.succeeded',
      'terminal.reader.action_succeeded',
    ]);

    // Nach der WEICHEN Ablehnung: die Zahlung ist NICHT gescheitert. Die
    // Kasse darf hier keinen zweiten Anlauf starten — der Leser zieht die
    // echte Belastung gleich selbst nach.
    await liefere(folge[0]!);
    const zwischenstand = await holeStand(zahlung.zahlungId);
    expect(zwischenstand.status).toBe('PROCESSING');
    expect(zwischenstand.fehlerbild).toBeNull();
    expect(zwischenstand.weicheAblehnungen).toBe(1);

    await liefere(folge[1]!);
    await liefere(folge[2]!);
    expect((await holeStand(zahlung.zahlungId)).status).toBe('SUCCEEDED');

    // Ein NACHZUEGLER desselben Erfolgs (frische Ereigniskennung, derselbe
    // Intent) aendert nichts mehr.
    const nachzuegler = { ...folge[1]!, id: `evt_${randomUUID().replace(/-/g, '').slice(0, 24)}` };
    await liefere(nachzuegler);
    expect((await holeStand(zahlung.zahlungId)).status).toBe('SUCCEEDED');

    // Und im Kassenbuch: EIN Beleg, EIN Zahlungsbein, EINE Leser-Zahlung —
    // obwohl Stripe zwei Belastungen sah.
    await finalisiere(zahlung.providerIntentId);
    const [beine] = await buehne.migratorSql<{ anzahl: string }[]>`
      SELECT count(*)::text AS anzahl FROM transaction_payments
       WHERE payment_method = 'STRIPE_TERMINAL'`;
    expect(beine?.anzahl).toBe('1');
    const [zahlungen] = await buehne.migratorSql<{ anzahl: string; weiche: number }[]>`
      SELECT count(*)::text AS anzahl, max(weiche_ablehnungen) AS weiche FROM leser_zahlungen`;
    expect(zahlungen?.anzahl).toBe('1');
    expect(zahlungen?.weiche).toBe(1);
    expect(attrappe.intents.size).toBe(1);
  });

  it('eroeffnet fuer DIESELBE Geste (Idempotenzkennung) keine zweite Zahlung', async () => {
    const leser = await registriereLeser();
    const kennung = randomUUID();
    const erste = await starteZahlung(leser.id, { idempotencyKey: kennung });
    const zweite = await starteZahlung(leser.id, { idempotencyKey: kennung });
    expect(zweite.zahlungId).toBe(erste.zahlungId);
    expect(zweite.providerIntentId).toBe(erste.providerIntentId);
    // Bei Stripe wurde nur EIN Intent eroeffnet.
    expect(attrappe.anrufe.filter((a) => a.pfad === '/v1/payment_intents').length).toBe(1);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. Die eine Geste: Betrag und Posten aus dem Warenkorb, Gebuehr aus der
  //    Provisionstabelle, das Kundendisplay zeigt die echten Zeilen
  // ────────────────────────────────────────────────────────────────────────

  it('faehrt die Geste komplett: Intent auf dem Haendlerkonto, 1 % Gebuehr, echte Zeilen auf dem Display', async () => {
    const leser = await registriereLeser();
    const zahlung = await starteZahlung(leser.id);
    expect(zahlung.status).toBe('PROCESSING');
    // Basels 1 % aus der Provisionstabelle (Kanal POS), nicht hart im Code:
    // 11900 Cent × 100 bps = 119 Cent.
    expect(zahlung.gebuehrCents).toBe(119);

    const intentAnruf = attrappe.anrufe.find((a) => a.pfad === '/v1/payment_intents');
    expect(intentAnruf?.stripeAccount).toBe(ACCT);
    expect(intentAnruf?.form?.application_fee_amount).toBe('119');
    expect(intentAnruf?.form?.payment_method_types).toEqual(['card_present']);

    const display = attrappe.anrufe.find((a) => a.pfad.endsWith('/set_reader_display'));
    const cart = display?.form?.cart as Record<string, unknown>;
    expect(cart.total).toBe('11900');
    expect(cart.tax).toBe('1900');
    expect(cart.line_items).toEqual([
      { description: 'Goldring 585', quantity: '1', amount: '11900' },
    ]);

    const process = attrappe.anrufe.find((a) => a.pfad.endsWith('/process_payment_intent'));
    expect(process?.form?.payment_intent).toBe(zahlung.providerIntentId);

    await praesentiereKarte(leser.providerReaderId, '4242424242424242');
    await liefereAlle();
    expect((await holeStand(zahlung.zahlungId)).status).toBe('SUCCEEDED');
  });

  it('verweigert die Geste ehrlich, wenn die Posten nicht auf den Betrag aufgehen', async () => {
    const leser = await registriereLeser();
    const res = await buehne.sende(
      '/api/stripe/terminal/payments',
      {
        readerId: leser.id,
        amountCents: 11900,
        steuerCents: 1900,
        positionen: [{ bezeichnung: 'Goldring 585', menge: 1, betragCents: 11800 }],
        idempotencyKey: randomUUID(),
      },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(400);
  });

  it('verweigert die Geste ohne verbundenes Haendlerkonto mit 409', async () => {
    const leser = await registriereLeser();
    await buehne.migratorSql.unsafe('TRUNCATE stripe_connected_accounts CASCADE');
    const res = await buehne.sende(
      '/api/stripe/terminal/payments',
      {
        readerId: leser.id,
        amountCents: 11900,
        steuerCents: 1900,
        positionen: [{ bezeichnung: 'Goldring 585', menge: 1, betragCents: 11900 }],
        idempotencyKey: randomUUID(),
      },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(409);
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. Die Fehlerbilder, klar getrennt
  // ────────────────────────────────────────────────────────────────────────

  it('meldet einen offenen Leser als LESER_OFFLINE und laesst keinen Intent haengen', async () => {
    const leser = await registriereLeser();
    attrappe.schalteLeserOffline(leser.providerReaderId);
    const zahlung = await starteZahlung(leser.id);
    expect(zahlung.status).toBe('FAILED');
    expect(zahlung.fehlerbild).toBe('LESER_OFFLINE');
    // Der eroeffnete Intent wurde storniert, nicht liegengelassen.
    const intent = [...attrappe.intents.values()][0];
    expect(intent?.status).toBe('canceled');
  });

  it('meldet die harte Kartenablehnung als KARTE_ABGELEHNT', async () => {
    const leser = await registriereLeser();
    const zahlung = await starteZahlung(leser.id);
    await praesentiereKarte(leser.providerReaderId, KARTE_ABGELEHNT);
    await liefereAlle();
    const stand = await holeStand(zahlung.zahlungId);
    expect(stand.status).toBe('FAILED');
    expect(stand.fehlerbild).toBe('KARTE_ABGELEHNT');
  });

  it('meldet die verstrichene Sammlung als ZEITUEBERSCHREITUNG', async () => {
    const leser = await registriereLeser();
    const zahlung = await starteZahlung(leser.id);
    attrappe.lasseAktionVerstreichen(leser.providerReaderId);
    await liefereAlle();
    const stand = await holeStand(zahlung.zahlungId);
    expect(stand.status).toBe('FAILED');
    expect(stand.fehlerbild).toBe('ZEITUEBERSCHREITUNG');
  });

  it('bricht auf Wunsch der Kasse ab: Leser-Aktion beendet, Intent storniert', async () => {
    const leser = await registriereLeser();
    const zahlung = await starteZahlung(leser.id);
    const res = await buehne.sende(
      `/api/stripe/terminal/payments/${zahlung.zahlungId}/cancel`,
      {},
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('CANCELED');
    const intent = [...attrappe.intents.values()][0];
    expect(intent?.status).toBe('canceled');
    const leserBeiStripe = [...attrappe.leser.values()][0];
    expect(leserBeiStripe?.action).toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. Erstattung: der Weg wird ehrlich benannt
  // ────────────────────────────────────────────────────────────────────────

  it('erstattet girocard per SEPA und sagt es woertlich: ein bis zwei Tage', async () => {
    const leser = await registriereLeser();
    const zahlung = await starteZahlung(leser.id);
    await praesentiereKarte(leser.providerReaderId, KARTE_GIROCARD_PIN);
    await liefereAlle();

    const res = await buehne.sende(
      `/api/stripe/terminal/payments/${zahlung.zahlungId}/refund`,
      { amountCents: 11900 },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(200);
    const antwort = res.json() as { refundId: string; weg: string; hinweis: string };
    expect(antwort.refundId).toMatch(/^re_/);
    expect(antwort.weg).toBe('SEPA_UEBERWEISUNG');
    expect(antwort.hinweis).toContain('ein bis zwei');
  });

  it('erstattet Kredit- und Debitkarten sofort auf die Karte', async () => {
    const leser = await registriereLeser();
    const zahlung = await starteZahlung(leser.id);
    await praesentiereKarte(leser.providerReaderId, '4242424242424242');
    await liefereAlle();

    const res = await buehne.sende(
      `/api/stripe/terminal/payments/${zahlung.zahlungId}/refund`,
      {},
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(200);
    expect((res.json() as { weg: string }).weg).toBe('SOFORT');
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. Leser-Verwaltung: Inhaber-gebunden, Liste, Entfernen
  // ────────────────────────────────────────────────────────────────────────

  it('bindet die Leser-Verwaltung an den Inhaber — der Kassierer bekommt 403', async () => {
    const res = await buehne.sende(
      '/api/stripe/terminal/readers',
      {
        registrationCode: 'simulated-wpe',
        label: 'Tresen links',
        anschrift: {
          displayName: 'Laden',
          line1: 'Musterstrasse 1',
          postalCode: '44135',
          city: 'Dortmund',
        },
      },
      { token: buehne.akteure.kassiererSitzung },
    );
    expect(res.statusCode).toBe(403);
  });

  it('listet registrierte Leser und entfernt sie bei Stripe UND in der Datenbank', async () => {
    const leser = await registriereLeser();

    const liste = await buehne.hol('/api/stripe/terminal/readers', {
      token: buehne.akteure.kassiererSitzung,
    });
    expect(liste.statusCode).toBe(200);
    const eintraege = (liste.json() as { leser: { id: string; bezeichnung: string }[] }).leser;
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]?.bezeichnung).toBe('Tresen links');

    const weg = await buehne.app.inject({
      method: 'DELETE',
      url: `/api/stripe/terminal/readers/${leser.id}`,
      headers: {
        cookie: `warehouse14.session=${buehne.akteure.inhaberSitzung}`,
        'x-dev-device-fingerprint': buehne.akteure.geraetFingerabdruck,
      },
    });
    expect(weg.statusCode).toBe(200);
    const [zeilen] = await buehne.migratorSql<{ anzahl: string }[]>`
      SELECT count(*)::text AS anzahl FROM kartenleser`;
    expect(zeilen?.anzahl).toBe('0');
    expect([...attrappe.leser.values()][0]?.geloescht).toBe(true);
  });
});
