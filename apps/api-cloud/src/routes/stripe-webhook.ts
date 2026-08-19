/**
 * POST /api/webhooks/stripe — der Kartenleser-Webhook (HMAC-verifiziert,
 * idempotent, NUR der Leser-Weg).
 *
 * ── WARUM ES DIESE DATEI GIBT (14.08.2026) ────────────────────────────────
 * Bis zur Trennung von warehouse14 wohnte dieser Endpunkt in
 * `storefront-webhook.ts` und trug ZWEI Wege: die Warenkorb-Umwandlung des
 * Kundenshops UND den Stand-Automaten der Leser-Zahlung. Die Trennung
 * entsorgte die Datei mit dem Kundenshop — und riss damit dem Kartenleser
 * das Ohr ab: `stripe-terminal.ts` nennt den Webhook ausdruecklich den
 * EINEN Schreiber des Zahlungsstands, und im Stand-Automaten
 * (`lib/leser-zahlung-stand.ts`) wohnt der Doppelbelastungs-Riegel der
 * girocard-PIN-Folge. Gefunden hat es die Integrationsmappe
 * (szenario-stripe-leser: 404 statt 200), nicht ein Mensch.
 *
 * Diese Fassung traegt NUR noch den Leser-Weg. Ereignisse, die zu keiner
 * Leser-Zahlung gehoeren, werden als Beweis in `webhook_events` gespeichert
 * und quittiert — mehr Wege gibt es in dieser Kasse nicht mehr.
 *
 * ── DIE HARTE ROTE LINIE (unveraendert aus der alten Datei) ───────────────
 *   1. Der ROHE Koerper wird VOR Fastifys JSON-Parser gelesen — die
 *      Signaturpruefung arbeitet auf exakt den Bytes, die Stripe signierte.
 *   2. `Stripe-Signature` wird konstantzeitlich gegen
 *      HMAC-SHA256(`<t>.<rawBody>`, secret) geprueft.
 *   3. `t=` muss innerhalb von STRIPE_WEBHOOK_TOLERANCE_SECONDS liegen
 *      (Wiedereinspiel-Schutz).
 *   4. Idempotenz ueber `webhook_events` UNIQUE (provider, provider_event_id):
 *      ein Duplikat, dessen ERSTE Zustellung fertig wurde (processed_at
 *      gesetzt), wird ohne Arbeit quittiert; eine halb gescheiterte erste
 *      Zustellung (processed_at NULL) wird auf dem Retry NACHGEARBEITET,
 *      sonst waere eine eingezogene Zahlung fuer immer verschluckt.
 *   5. ERST DANN laeuft der Stand-Automat der Leser-Zahlung.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { webhookEvents } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { verarbeiteLeserEreignis } from '../lib/leser-zahlung-ereignis.js';
import { verifyStripeSignature } from '../lib/stripe-signature.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class WebhookBadSignatureError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class WebhookConfigError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}

const WebhookAck = Type.Object({
  received: Type.Boolean(),
  idempotent: Type.Boolean(),
  eventId: Type.String(),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface StripeWebhookOpts {
  env: Env;
}

/** Typwaechter fuer die Ereignisgestalt, auf die wir reagieren. */
interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id: string; status?: string; metadata?: Record<string, string> } };
}

function isStripeEvent(x: unknown): x is StripeEvent {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.type === 'string' &&
    typeof o.data === 'object' &&
    o.data !== null &&
    typeof (o.data as Record<string, unknown>).object === 'object'
  );
}

const stripeWebhookRoutes: FastifyPluginAsync<StripeWebhookOpts> = async (app, opts) => {
  // Roh-Koerper-Parser NUR in diesem Geltungsbereich: parseAs='string'
  // reicht die unveraenderten Bytes als Text an den Handler weiter.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    function rawJsonParser(_req, body, done) {
      done(null, body);
    },
  );

  app.post(
    '/api/webhooks/stripe',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Stripe-Webhook — HMAC-verifiziert + idempotent, nur der Leser-Weg.',
        description:
          'Empfaengt Stripe-Zustellungen, prueft die Stripe-Signature gegen den rohen ' +
          'Koerper und schreibt den Stand der zugehoerigen Leser-Zahlung fort. Ereignisse ' +
          'ohne Leser-Zahlung werden als Beweis gespeichert und quittiert.',
        response: {
          200: WebhookAck,
          400: ErrorResponse,
          500: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      // 0. Ohne Geheimnis keine Annahme — laut scheitern schlaegt still schlucken.
      if (!opts.env.STRIPE_WEBHOOK_SECRET) {
        throw new WebhookConfigError('Stripe webhook secret not configured.');
      }

      // 1. Roher Koerper + Kopfzeile.
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const sigHeader = req.headers['stripe-signature'];
      if (typeof sigHeader !== 'string' || sigHeader.length === 0) {
        throw new WebhookBadSignatureError('Missing Stripe-Signature header.');
      }

      // 2. HMAC — die harte rote Linie.
      const verification = verifyStripeSignature({
        rawBody,
        header: sigHeader,
        secret: opts.env.STRIPE_WEBHOOK_SECRET,
        toleranceSeconds: opts.env.STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      });
      if (!verification.ok) {
        // Stripe raet ausdruecklich davon ab, das Geheimnis zu protokollieren.
        req.log.warn({ failure: verification.failure }, 'stripe webhook signature rejected');
        throw new WebhookBadSignatureError(
          `Stripe-Signature rejected: ${verification.failure.code}`,
        );
      }

      // 3. Erst NACH der Signatur parsen.
      let event: StripeEvent;
      try {
        const parsed = JSON.parse(rawBody);
        if (!isStripeEvent(parsed)) {
          throw new Error('Event JSON did not match expected shape.');
        }
        event = parsed;
      } catch (err) {
        req.log.warn({ err }, 'stripe webhook JSON parse failed (signature verified)');
        throw new WebhookBadSignatureError(
          'Verified Stripe-Signature but payload is not a JSON event.',
        );
      }

      // 4. Idempotenz ueber webhook_events UNIQUE — inkl. Nacharbeit einer
      //    halb gescheiterten ersten Zustellung (processed_at NULL).
      let isIdempotent = false;
      try {
        await app.db.insert(webhookEvents).values({
          provider: 'STRIPE',
          providerEventId: event.id,
          eventType: event.type,
          rawBody: rawBody.slice(0, 64 * 1024), // defensiv gedeckelt
          payload: event as unknown,
          signatureVerified: true,
        });
      } catch (err) {
        const msg = (err as Error).message ?? '';
        if (!msg.includes('webhook_events_provider_event_uq')) throw err;
        isIdempotent = true;
        const [existing] = await app.db.execute<{ processed_at: string | null }>(drizzleSql`
          SELECT processed_at FROM webhook_events
           WHERE provider = 'STRIPE' AND provider_event_id = ${event.id}
           LIMIT 1
        `);
        if (existing && existing.processed_at !== null) {
          return reply.status(200).send({ received: true, idempotent: true, eventId: event.id });
        }
        req.log.warn(
          { eventId: event.id, eventType: event.type },
          'stripe webhook: prior delivery never finished, re-processing',
        );
      }

      // 5. Der Leser-Weg — der einzige, den es noch gibt. Gehoert der Intent
      //    zu einer Leser-Zahlung, schreibt der reine Stand-Automat den Stand
      //    fort (dort wohnt der Doppelbelastungs-Riegel). Alles Uebrige liegt
      //    als Beweis in webhook_events und wird quittiert.
      await verarbeiteLeserEreignis(
        app,
        event as unknown as Parameters<typeof verarbeiteLeserEreignis>[1],
      );

      // Als verarbeitet stempeln — gesehen ist gesehen.
      await app.db.execute(drizzleSql`
      UPDATE webhook_events SET processed_at = now()
       WHERE provider = 'STRIPE' AND provider_event_id = ${event.id}
    `);

      return reply
        .status(200)
        .send({ received: true, idempotent: isIdempotent, eventId: event.id });
    },
  );
};

export default stripeWebhookRoutes;
