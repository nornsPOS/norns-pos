/**
 * Der Anschluss für die Zahlung, und die eine Regel, die alles trägt.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  NUR EINE SIGNIERTE MELDUNG DES ANBIETERS DARF EINE ZAHLUNG BESTÄTIGEN.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Der Browser des Kunden landet nach dem Bezahlen auf einer Rückkehrseite.
 * Diese Rückkehr ist KEIN Beweis. Sie lässt sich aufrufen, ohne bezahlt zu
 * haben; sie lässt sich wiederholen; sie lässt sich fälschen. Wer sie als
 * Bestätigung nimmt, verschenkt Goldmünzen an jeden, der eine URL abtippen
 * kann. Genau dieser Fehler ist der häufigste im ganzen Onlinehandel.
 *
 * Deshalb trennt dieser Anschluss zwei Dinge streng:
 *
 *   • Was der Kunde SIEHT       →  eine Absicht, ein Hinweis, nie ein Urteil.
 *   • Was den Auftrag BEZAHLT   →  ausschließlich eine Meldung mit gültiger
 *                                   Signatur, die serverseitig geprüft wurde.
 *
 * Das Feld heißt darum `authoritative`. Nur wo es wahr ist, darf ein Auftrag
 * in die Kommissionierung. Kein anderer Weg setzt SUCCEEDED.
 *
 * Und wie beim Versand: ohne Zugang wird ehrlich abgelehnt, statt so zu tun
 * als ob. Eine simulierte Zahlung trägt eine Kennung, die niemand für echt
 * halten kann, und sie ist NIEMALS maßgeblich.
 */

export type PaymentProvider = 'STRIPE' | 'PAYPAL' | 'MOLLIE';

/** Spiegelt `payment_intent_status` in der Datenbank. */
export type PaymentIntentState =
  | 'CREATED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'EXPIRED';

export type PaymentRefusal =
  /** Kein Zugang hinterlegt. Der ehrliche Normalfall vor dem Anschluss. */
  | 'NOT_CONFIGURED'
  /** Betrag, Währung oder Auftrag taugen nicht. */
  | 'INVALID_INPUT'
  /** Der Anbieter hat abgelehnt oder war nicht erreichbar. */
  | 'PROVIDER_REJECTED'
  /** Die Signatur der Meldung stimmt nicht. Sie wird NICHT geglaubt. */
  | 'BAD_SIGNATURE';

export type PaymentResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: PaymentRefusal; detail: string };

export interface CreateIntentInput {
  cartId: string;
  /** Ganze Cent. Niemals eine Fließkommazahl. */
  amountCents: number;
  /** ISO 4217. Der Laden rechnet in Euro; das Feld hält den Vertrag ehrlich. */
  currency: 'EUR';
  /** Was der Kunde später auf dem Kontoauszug lesen soll. */
  descriptor?: string | null;
}

export interface CreatedIntent {
  providerIntentId: string;
  /** Womit die Kundenoberfläche den Bezahlvorgang öffnet. */
  clientSecret: string | null;
  redirectUrl: string | null;
  /** Wahr heißt: nichts davon ist echtes Geld. */
  simulated: boolean;
}

/**
 * Was eine geprüfte Meldung des Anbieters aussagt.
 *
 * `authoritative` ist das Herz dieser Datei. Es ist NUR wahr, wenn die
 * Signatur serverseitig gegen das Geheimnis des Anbieters geprüft wurde.
 */
export interface PaymentEvent {
  providerIntentId: string;
  state: PaymentIntentState;
  /** Was der Anbieter als bezahlt meldet, in ganzen Cent. */
  amountCents: number | null;
  authoritative: boolean;
  /** Der rohe Anbietertext, für die Akte. Nie für den Kunden. */
  rawStatus: string | null;
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  /** Falsch heißt: dieser Anschluss lehnt jeden Vorgang ehrlich ab. */
  readonly configured: boolean;
  /** Wahr heißt: hier fließt kein echtes Geld, egal wie es aussieht. */
  readonly simulated: boolean;
  createIntent(input: CreateIntentInput): Promise<PaymentResult<CreatedIntent>>;
  /**
   * Prüft eine eingehende Meldung. Der rohe Körper und die Signaturkopfzeile
   * gehen unverändert hinein, denn jede Umformung vorher zerstört die Prüfung.
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<PaymentResult<PaymentEvent>>;
}

/** Ein Betrag muss ganzzahlig und positiv sein, sonst ist er kein Betrag. */
export function validateIntentInput(input: CreateIntentInput): string | null {
  if (!Number.isInteger(input.amountCents)) return 'Der Betrag ist keine ganze Centzahl.';
  if (input.amountCents <= 0) return 'Der Betrag muss größer als null sein.';
  if (input.currency !== 'EUR') return 'Es wird nur in Euro abgerechnet.';
  if (input.cartId.trim().length === 0) return 'Der Auftrag fehlt.';
  return null;
}

/**
 * DIE TORWÄCHTER-FUNKTION. Sie entscheidet, ob ein Auftrag als bezahlt gelten
 * darf, und sie ist absichtlich die einzige Stelle, die das entscheidet.
 *
 * Drei Bedingungen, alle nötig:
 *   1. Die Meldung ist geprüft (signiert), nicht bloß empfangen.
 *   2. Sie sagt SUCCEEDED.
 *   3. Der gemeldete Betrag stimmt auf den Cent mit dem geforderten überein.
 *
 * Punkt 3 fängt den Fall, in dem jemand den Betrag auf dem Weg kleinrechnet:
 * eine bestätigte Zahlung über 1,00 Euro für einen Warenkorb über 1.200,00
 * ist keine bezahlte Bestellung, sondern ein Angriff.
 */
export function mayReleaseGoods(
  event: PaymentEvent,
  expectedAmountCents: number,
): { release: boolean; reason: string } {
  if (!event.authoritative) {
    return {
      release: false,
      reason: 'Die Zahlungsmeldung ist nicht geprüft. Eine Rückkehr aus dem Browser ist kein Zahlungsnachweis.',
    };
  }
  if (event.state !== 'SUCCEEDED') {
    return { release: false, reason: 'Die Zahlung ist nicht abgeschlossen.' };
  }
  if (event.amountCents == null || event.amountCents !== expectedAmountCents) {
    return {
      release: false,
      reason: 'Der bezahlte Betrag stimmt nicht mit der Bestellung überein.',
    };
  }
  return { release: true, reason: 'Zahlung geprüft und vollständig.' };
}

/** Der Anschluss ohne Zugang. Lehnt ab, und sagt warum. */
export function createUnconfiguredGateway(provider: PaymentProvider = 'STRIPE'): PaymentGateway {
  const refuse = <T>(): PaymentResult<T> => ({
    ok: false,
    reason: 'NOT_CONFIGURED',
    detail:
      `Für ${provider} ist noch kein Zugang hinterlegt. Es wurde kein Zahlungsvorgang ` +
      'eröffnet und kein Betrag eingezogen.',
  });
  return {
    provider,
    configured: false,
    simulated: false,
    createIntent: async () => refuse<CreatedIntent>(),
    verifyWebhook: async () => refuse<PaymentEvent>(),
  };
}

/**
 * Der Anschluss zum Üben. Er läuft den ganzen Weg durch, mit denselben
 * Eingabeprüfungen, und bleibt dabei an einer Stelle unnachgiebig:
 *
 *   `authoritative` ist IMMER falsch.
 *
 * Eine Übungszahlung darf niemals Ware freigeben. Wer den Weg im Testbetrieb
 * durchspielt, sieht deshalb genau da eine Wand, wo im Echtbetrieb die
 * signierte Meldung stehen wird. Das ist der Sinn der Übung, nicht ihr Mangel.
 */
export function createSimulatedGateway(
  provider: PaymentProvider = 'STRIPE',
  nextSequence: () => number = (() => {
    let n = 0;
    return () => ++n;
  })(),
): PaymentGateway {
  return {
    provider,
    configured: true,
    simulated: true,
    async createIntent(input) {
      const problem = validateIntentInput(input);
      if (problem != null) return { ok: false, reason: 'INVALID_INPUT', detail: problem };
      const seq = String(nextSequence()).padStart(6, '0');
      return {
        ok: true,
        value: {
          // Sichtbar keine Anbieterkennung. `pi_...` oder `tr_...` hier wäre
          // eine Einladung, eine Übung für einen echten Vorgang zu halten.
          providerIntentId: `SIMULATION-${seq}`,
          clientSecret: null,
          redirectUrl: null,
          simulated: true,
        },
      };
    },
    async verifyWebhook() {
      return {
        ok: false,
        reason: 'NOT_CONFIGURED',
        detail:
          'Im Übungsbetrieb gibt es keine signierte Zahlungsmeldung. Es wird darum ' +
          'auch keine Bestellung als bezahlt geführt.',
      };
    },
  };
}

/** Was der Bediener liest, wenn ein Zahlungsvorgang nicht zustande kam. */
export function paymentRefusalTextDe(reason: PaymentRefusal, detail: string): string {
  switch (reason) {
    case 'NOT_CONFIGURED':
      return detail;
    case 'INVALID_INPUT':
      return `Der Zahlungsvorgang ist unvollständig: ${detail}`;
    case 'PROVIDER_REJECTED':
      return `Der Zahlungsdienst hat abgelehnt: ${detail}`;
    case 'BAD_SIGNATURE':
      return 'Die Zahlungsmeldung trug keine gültige Signatur und wurde verworfen.';
  }
}
