/**
 * Stripe Terminal — Klient zum servergesteuerten Leser-Weg (Gewerk 2, §9,
 * apps/api-cloud/src/routes/stripe-terminal.ts).
 *
 *   Leser-Verwaltung (Inhaber: ADMIN + Stufenanhebung):
 *     leserRegistrieren() — POST   /api/stripe/terminal/readers
 *     leserListe()        — GET    /api/stripe/terminal/readers (jeder Angemeldete)
 *     leserEntfernen()    — DELETE /api/stripe/terminal/readers/:id
 *
 *   Die eine Geste (Kassierer genuegt):
 *     zahlungStarten()    — POST /api/stripe/terminal/payments
 *     zahlungStand()      — GET  /api/stripe/terminal/payments/:id
 *     zahlungAbbrechen()  — POST /api/stripe/terminal/payments/:id/cancel
 *     zahlungErstatten()  — POST /api/stripe/terminal/payments/:id/refund
 *
 * ── WAS DIE KASSE WISSEN MUSS ──────────────────────────────────────────────
 * • Betrag und Posten kommen aus dem Warenkorb, in ganzen Cent; die
 *   Positionen muessen den Betrag EXAKT ergeben (der Leser ist das
 *   Kundendisplay, es zeigt nur Zeilen, die aufgehen).
 * • `idempotencyKey` ist die Kennung der GESTE: dieselbe Kennung eroeffnet
 *   nie eine zweite Zahlung — bei einem Wackler einfach erneut senden.
 * • Der Stand kommt vom Webhook. Nach dem Start pollt die Kasse
 *   `zahlungStand()`, bis `status` nicht mehr PROCESSING ist. Eine weiche
 *   girocard-Ablehnung aendert den Stand NICht — kein zweiter Anlauf!
 * • Erstattung: `weg`/`hinweis` woertlich anzeigen — girocard erstattet per
 *   SEPA in ein bis zwei Tagen, nicht sofort.
 */

import type { ApiClient } from '../client.js';

/** Eine Warenkorbzeile fuer das Kundendisplay. `betragCents` ist der ZEILENBETRAG. */
export interface TerminalPosition {
  bezeichnung: string;
  menge: number;
  betragCents: number;
}

export interface TerminalLeser {
  id: string;
  providerReaderId: string;
  bezeichnung: string;
  geraetetyp: string | null;
  seriennummer: string | null;
  /** Der zuletzt bei Stripe gesehene Stand ('online'/'offline') — Auskunft. */
  status: string | null;
  registriertAm: string;
}

export interface LeserRegistrierenBody {
  /** Die drei Woerter vom Display des Geraets; simulierte Leser `simulated-…`. */
  registrationCode: string;
  label: string;
  /** Fuer den Stripe-Standort, falls noch keiner existiert. */
  anschrift: {
    displayName: string;
    line1: string;
    postalCode: string;
    city: string;
    country?: string;
  };
}

export type TerminalZahlungStatus = 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';

export type TerminalFehlerbild =
  | 'LESER_OFFLINE'
  | 'KARTE_ABGELEHNT'
  | 'ZEITUEBERSCHREITUNG'
  | 'ABBRUCH_AM_GERAET';

export interface ZahlungStartenBody {
  /** Die Zeilen-Kennung aus der Leser-Liste, nicht die Stripe-Kennung. */
  readerId: string;
  amountCents: number;
  steuerCents: number;
  positionen: TerminalPosition[];
  /** UUID der Geste — dieselbe Kennung, dieselbe Zahlung. */
  idempotencyKey: string;
}

export interface ZahlungView {
  zahlungId: string;
  providerIntentId: string;
  status: TerminalZahlungStatus | string;
  fehlerbild: TerminalFehlerbild | string | null;
  fehlerMeldung: string | null;
  gebuehrCents: number;
}

export interface ZahlungStand {
  zahlungId: string;
  providerIntentId: string;
  status: TerminalZahlungStatus | string;
  fehlerbild: TerminalFehlerbild | string | null;
  fehlerMeldung: string | null;
  /** Beweiszaehler der weichen girocard-Ablehnungen — nie eine Buchung. */
  weicheAblehnungen: number;
}

export type ErstattungsWeg = 'SOFORT' | 'SEPA_UEBERWEISUNG';

export interface ErstattenResponse {
  refundId: string;
  /** Stripes Stand ('succeeded' | 'pending'). */
  refundStatus: string;
  weg: ErstattungsWeg | string;
  /** Der Satz, den die Kasse dem Kassierer woertlich zeigt. */
  hinweis: string;
}

export const stripeTerminalApi = {
  leserRegistrieren(client: ApiClient, body: LeserRegistrierenBody): Promise<TerminalLeser> {
    return client.request<TerminalLeser>('POST', '/api/stripe/terminal/readers', body);
  },

  leserListe(client: ApiClient): Promise<{ leser: TerminalLeser[] }> {
    return client.request<{ leser: TerminalLeser[] }>('GET', '/api/stripe/terminal/readers');
  },

  leserEntfernen(client: ApiClient, leserId: string): Promise<{ geloescht: boolean }> {
    return client.request<{ geloescht: boolean }>(
      'DELETE',
      `/api/stripe/terminal/readers/${encodeURIComponent(leserId)}`,
    );
  },

  zahlungStarten(client: ApiClient, body: ZahlungStartenBody): Promise<ZahlungView> {
    return client.request<ZahlungView>('POST', '/api/stripe/terminal/payments', body);
  },

  zahlungStand(client: ApiClient, zahlungId: string): Promise<ZahlungStand> {
    return client.request<ZahlungStand>(
      'GET',
      `/api/stripe/terminal/payments/${encodeURIComponent(zahlungId)}`,
    );
  },

  zahlungAbbrechen(client: ApiClient, zahlungId: string): Promise<{ status: string }> {
    return client.request<{ status: string }>(
      'POST',
      `/api/stripe/terminal/payments/${encodeURIComponent(zahlungId)}/cancel`,
      {},
    );
  },

  zahlungErstatten(
    client: ApiClient,
    zahlungId: string,
    body: { amountCents?: number } = {},
  ): Promise<ErstattenResponse> {
    return client.request<ErstattenResponse>(
      'POST',
      `/api/stripe/terminal/payments/${encodeURIComponent(zahlungId)}/refund`,
      body,
    );
  },
};
