/**
 * Stripe Terminal — der servergesteuerte Leser-Weg (Gewerk 2, Koordination §9).
 *
 * ── LESER-VERWALTUNG (Mandantendaten, Muster beleg_logo/0119) ──────────────
 *   POST   /api/stripe/terminal/readers      — Inhaber (ADMIN + Stufe):
 *          Registrierungscode vom Geraet → Stripe, Zeile in `kartenleser`.
 *   GET    /api/stripe/terminal/readers      — jeder Angemeldete: die Liste,
 *          die die Kasse im Bezahlen-Dialog anbietet.
 *   DELETE /api/stripe/terminal/readers/:id  — Inhaber: bei Stripe UND hier.
 *
 * ── DIE EINE GESTE ─────────────────────────────────────────────────────────
 *   POST /api/stripe/terminal/payments       — Betrag, Warenkorbzeilen und
 *        Idempotenzkennung herein; PaymentIntent AUF dem Haendlerkonto
 *        (Kopfzeile `Stripe-Account`, Vermittlungsgebuehr aus der
 *        Provisionstabelle Kanal POS), die ECHTEN Zeilen aufs Kundendisplay
 *        (`set_reader_display`), dann `process_payment_intent`.
 *   GET  /api/stripe/terminal/payments/:id   — der Stand fuer die Kasse.
 *   POST /api/stripe/terminal/payments/:id/cancel — `cancel_action` + Storno.
 *   POST /api/stripe/terminal/payments/:id/refund — Erstattung, mit der
 *        EHRLICHEN Auskunft ueber den Weg (girocard: SEPA, ein bis zwei Tage).
 *
 * ── WARUM DER STAND NUR AUS DER DATENBANK KOMMT (26.07.2026) ───────────────
 * Der Webhook ist der EINE Schreiber des Zahlungsstands, und in ihm wohnt der
 * Doppelbelastungs-Riegel (leser-zahlung-stand.ts): die weiche girocard-
 * Ablehnung `online_or_offline_pin_required` darf NIE als Fehlschlag
 * erscheinen. Fragte die Stand-Abfrage zusaetzlich frisch bei Stripe nach,
 * entstuende ein zweiter Leser desselben Automaten mit eigener Reihenfolge —
 * genau die zwei Wahrheiten, die der Riegel verhindert. Die Kasse fragt hier,
 * der Webhook schreibt, sonst niemand.
 */

import { Type } from '@sinclair/typebox';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  auditLog,
  kartenleser,
  leserZahlungen,
  paymentCommissionRates,
  stripeConnectedAccounts,
  type LeserZahlungPosition,
} from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { resolveCommission, type CommissionChannel } from '../lib/commission.js';
import {
  assertReadyToCharge,
  computeApplicationFeeCents,
  retrieveAccount,
} from '../lib/stripe-connect.js';
import {
  brichLeserAktionAb,
  erstatte,
  erstattungsWeg,
  erzeugeKartenzahlung,
  holeIntent,
  legeLocationAn,
  listeLeserBeiStripe,
  listeLocations,
  loescheLeserBeiStripe,
  registriereLeser,
  storniereIntent,
  starteZahlungAmLeser,
  zeigeWarenkorb,
  type TerminalConfig,
  type TerminalResult,
} from '../lib/stripe-terminal.js';
import { naechsterStand, type Fehlerbild, type ZahlungsStand } from '../lib/leser-zahlung-stand.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

// ── Fehler ─────────────────────────────────────────────────────────────────

class TerminalValidierungError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

class TerminalNichtGefundenError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

/**
 * 409, nicht 400: die Anfrage der Kasse war in Ordnung, der ZUSTAND des
 * Ladens traegt sie nicht (kein verbundenes Haendlerkonto, Konto nicht
 * freigeschaltet, Zahlung im falschen Stand). Dasselbe Muster wie
 * ZahlartNichtKontiertError im DATEV-Weg.
 */
class TerminalZustandError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Stripe ist nicht eingerichtet — ehrliches 503, kein 500. */
class TerminalNichtEingerichtetError extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'SERVICE_UNAVAILABLE';
}

/** Stripe war erreichbar und hat NEIN gesagt (oder war nicht erreichbar). */
class TerminalAnbieterError extends DomainError {
  public readonly httpStatus = 502;
  public readonly code: ApiErrorCode = 'EXTERNAL_SERVICE_FAILED';
}

/** Ein Anbieter-Ergebnis auspacken oder den passenden Fehler werfen. */
function verlange<T>(res: TerminalResult<T>): T {
  if (res.ok) return res.value;
  switch (res.reason) {
    case 'NOT_CONFIGURED':
      throw new TerminalNichtEingerichtetError(res.detail);
    case 'INVALID_INPUT':
      throw new TerminalValidierungError(res.detail);
    case 'PROVIDER_REJECTED':
      throw new TerminalAnbieterError(res.detail);
  }
}

// ── Schemata ───────────────────────────────────────────────────────────────

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const AnschriftBody = Type.Object({
  displayName: Type.String({ minLength: 1, maxLength: 100 }),
  line1: Type.String({ minLength: 1, maxLength: 200 }),
  postalCode: Type.String({ minLength: 1, maxLength: 16 }),
  city: Type.String({ minLength: 1, maxLength: 100 }),
  country: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
});

const LeserRegistrierenBody = Type.Object({
  /** Die drei Woerter vom Display des Geraets; simulierte Leser `simulated-…`. */
  registrationCode: Type.String({ minLength: 1, maxLength: 100 }),
  label: Type.String({ minLength: 1, maxLength: 100 }),
  /** Fuer den Stripe-Standort (`tml_…`), falls noch keiner existiert. */
  anschrift: AnschriftBody,
});
type TLeserRegistrierenBody = {
  registrationCode: string;
  label: string;
  anschrift: { displayName: string; line1: string; postalCode: string; city: string; country?: string };
};

const LeserView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  providerReaderId: Type.String(),
  bezeichnung: Type.String(),
  geraetetyp: Type.Union([Type.String(), Type.Null()]),
  seriennummer: Type.Union([Type.String(), Type.Null()]),
  /** Der zuletzt bei Stripe gesehene Stand — Auskunft, keine Wahrheit. */
  status: Type.Union([Type.String(), Type.Null()]),
  registriertAm: Type.String({ format: 'date-time' }),
});

const LeserListeResponse = Type.Object({ leser: Type.Array(LeserView) });

const PositionBody = Type.Object({
  bezeichnung: Type.String({ minLength: 1, maxLength: 200 }),
  menge: Type.Integer({ minimum: 1 }),
  /** Der ZEILENBETRAG in ganzen Cent (nicht der Stueckpreis). */
  betragCents: Type.Integer({ minimum: 0 }),
});

const ZahlungStartenBody = Type.Object({
  /** Die Zeilen-Kennung aus `kartenleser`, nicht die Stripe-Kennung. */
  readerId: Type.String({ format: 'uuid' }),
  amountCents: Type.Integer({ minimum: 1 }),
  steuerCents: Type.Integer({ minimum: 0 }),
  positionen: Type.Array(PositionBody, { minItems: 1, maxItems: 100 }),
  /** Die Idempotenzkennung der GESTE — dieselbe Geste, dieselbe Zahlung. */
  idempotencyKey: Type.String({ format: 'uuid' }),
});
type TZahlungStartenBody = {
  readerId: string;
  amountCents: number;
  steuerCents: number;
  positionen: { bezeichnung: string; menge: number; betragCents: number }[];
  idempotencyKey: string;
};

const ZahlungView = Type.Object({
  zahlungId: Type.String({ format: 'uuid' }),
  providerIntentId: Type.String(),
  status: Type.String(),
  fehlerbild: Type.Union([Type.String(), Type.Null()]),
  fehlerMeldung: Type.Union([Type.String(), Type.Null()]),
  gebuehrCents: Type.Integer(),
});

const StandResponse = Type.Object({
  zahlungId: Type.String({ format: 'uuid' }),
  providerIntentId: Type.String(),
  status: Type.String(),
  fehlerbild: Type.Union([Type.String(), Type.Null()]),
  fehlerMeldung: Type.Union([Type.String(), Type.Null()]),
  /** Beweiszaehler der weichen girocard-Ablehnungen — nie eine Buchung. */
  weicheAblehnungen: Type.Integer(),
});

const AbbrechenResponse = Type.Object({ status: Type.String() });

const ErstattenBody = Type.Object({
  /** Ohne Angabe: der volle Betrag. */
  amountCents: Type.Optional(Type.Integer({ minimum: 1 })),
});
type TErstattenBody = { amountCents?: number };

const ErstattenResponse = Type.Object({
  refundId: Type.String(),
  /** Stripes Stand der Erstattung ('succeeded' | 'pending'). */
  refundStatus: Type.String(),
  /** 'SOFORT' | 'SEPA_UEBERWEISUNG' — girocard kennt keine Sofort-Erstattung. */
  weg: Type.String(),
  /** Der Satz, den die Kasse dem Kassierer woertlich zeigt. */
  hinweis: Type.String(),
});

export interface StripeTerminalOpts {
  env: Env;
}

// ── Die Routen ─────────────────────────────────────────────────────────────

const stripeTerminalRoutes: FastifyPluginAsync<StripeTerminalOpts> = async (app, opts) => {
  const cfg: TerminalConfig = {
    secretKey: opts.env.STRIPE_SECRET_KEY,
    apiVersion: opts.env.STRIPE_API_VERSION,
  };

  /** Das EINE verbundene Haendlerkonto — oder ein ehrliches 409. */
  async function verlangeHaendlerkonto(): Promise<{
    stripeAccountId: string;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
  }> {
    const [konto] = await app.db
      .select({
        stripeAccountId: stripeConnectedAccounts.stripeAccountId,
        chargesEnabled: stripeConnectedAccounts.chargesEnabled,
        detailsSubmitted: stripeConnectedAccounts.detailsSubmitted,
      })
      .from(stripeConnectedAccounts)
      .limit(1);
    if (konto === undefined) {
      throw new TerminalZustandError(
        'Es ist kein Stripe-Haendlerkonto verbunden. Erst die Stripe-Einrichtung abschliessen, dann kann der Leser kassieren.',
      );
    }
    return konto;
  }

  // ── Leser registrieren (Inhaber) ─────────────────────────────────────────
  app.post<{ Body: TLeserRegistrierenBody }>(
    '/api/stripe/terminal/readers',
    {
      schema: {
        tags: ['stripe-terminal'],
        summary: 'Einen Kartenleser auf dem Haendlerkonto registrieren (ADMIN + Stufe).',
        description:
          'Nimmt den Registrierungscode vom Geraet, registriert den Leser bei Stripe ' +
          '(`POST /v1/terminal/readers`, Kopfzeile Stripe-Account) und traegt ihn in ' +
          '`kartenleser` ein. Legt bei Bedarf zuerst einen Stripe-Standort an.',
        body: LeserRegistrierenBody,
        response: { 200: LeserView, 400: ErrorResponse, 401: ErrorResponse, 403: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const konto = await verlangeHaendlerkonto();

      // Der Standort (`tml_…`) haengt am Haendlerkonto: den vorhandenen
      // nehmen, sonst aus der mitgelieferten Anschrift einen anlegen.
      const locations = verlange(await listeLocations(cfg, konto.stripeAccountId));
      const locationId =
        locations[0]?.id ??
        verlange(
          await legeLocationAn(cfg, konto.stripeAccountId, {
            displayName: req.body.anschrift.displayName,
            line1: req.body.anschrift.line1,
            postalCode: req.body.anschrift.postalCode,
            city: req.body.anschrift.city,
            ...(req.body.anschrift.country !== undefined
              ? { country: req.body.anschrift.country }
              : {}),
          }),
        ).id;

      const leser = verlange(
        await registriereLeser(cfg, {
          stripeAccountId: konto.stripeAccountId,
          registrationCode: req.body.registrationCode,
          label: req.body.label,
          locationId,
        }),
      );

      const zeile = await app.db.transaction(async (tx) => {
        const [geschrieben] = await tx
          .insert(kartenleser)
          .values({
            provider: 'STRIPE',
            providerReaderId: leser.readerId,
            bezeichnung: req.body.label,
            geraetetyp: leser.deviceType,
            seriennummer: leser.serialNumber,
            providerLocationId: leser.locationId,
            zuletztGesehenStatus: leser.status,
            registriertVon: req.actor.id,
          })
          .returning();
        if (geschrieben === undefined) throw new Error('kartenleser INSERT returned no row');
        await tx.insert(auditLog).values({
          eventType: 'kartenleser.registriert',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: { providerReaderId: leser.readerId, label: req.body.label },
        });
        return geschrieben;
      });

      return reply.status(200).send({
        id: zeile.id,
        providerReaderId: zeile.providerReaderId,
        bezeichnung: zeile.bezeichnung,
        geraetetyp: zeile.geraetetyp,
        seriennummer: zeile.seriennummer,
        status: zeile.zuletztGesehenStatus,
        registriertAm: zeile.registriertAm.toISOString(),
      });
    },
  );

  // ── Leser auflisten (jeder Angemeldete) ──────────────────────────────────
  app.get(
    '/api/stripe/terminal/readers',
    {
      schema: {
        tags: ['stripe-terminal'],
        summary: 'Die registrierten Kartenleser des Ladens.',
        description:
          'Liest `kartenleser` und frischt, wenn Stripe erreichbar ist, den zuletzt ' +
          'gesehenen Geraetestand mit auf. Ein Netzfehler macht die Liste nicht kaputt.',
        response: { 200: LeserListeResponse, 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      // Auch das LESEN gehoert hinter eine Rolle: der Stand einer Zahlung und
      // die Liste der Leser sind Betriebsdaten, kein oeffentliches Wissen.
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const zeilen = await app.db.select().from(kartenleser);

      // Bester Wille, keine Pflicht: der Geraetestand ('online'/'offline')
      // von Stripe ist nur eine Auskunft fuer die Oberflaeche. Entschieden
      // wird je Zahlung frisch, beim Anstossen.
      if (zeilen.length > 0 && cfg.secretKey.trim().length > 0) {
        const [konto] = await app.db
          .select({ stripeAccountId: stripeConnectedAccounts.stripeAccountId })
          .from(stripeConnectedAccounts)
          .limit(1);
        if (konto !== undefined) {
          const beiStripe = await listeLeserBeiStripe(cfg, konto.stripeAccountId);
          if (beiStripe.ok) {
            const stand = new Map(beiStripe.value.map((l) => [l.id, l.status]));
            for (const zeile of zeilen) {
              const neu = stand.get(zeile.providerReaderId);
              if (neu !== undefined && neu !== zeile.zuletztGesehenStatus) {
                zeile.zuletztGesehenStatus = neu;
                await app.db
                  .update(kartenleser)
                  .set({ zuletztGesehenStatus: neu })
                  .where(eq(kartenleser.id, zeile.id));
              }
            }
          }
        }
      }

      return reply.status(200).send({
        leser: zeilen.map((z) => ({
          id: z.id,
          providerReaderId: z.providerReaderId,
          bezeichnung: z.bezeichnung,
          geraetetyp: z.geraetetyp,
          seriennummer: z.seriennummer,
          status: z.zuletztGesehenStatus,
          registriertAm: z.registriertAm.toISOString(),
        })),
      });
    },
  );

  // ── Leser entfernen (Inhaber) ────────────────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/api/stripe/terminal/readers/:id',
    {
      schema: {
        tags: ['stripe-terminal'],
        summary: 'Einen Kartenleser entfernen — bei Stripe UND hier (ADMIN + Stufe).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: Type.Object({ geloescht: Type.Boolean() }),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const [zeile] = await app.db
        .select()
        .from(kartenleser)
        .where(eq(kartenleser.id, req.params.id))
        .limit(1);
      if (zeile === undefined) {
        throw new TerminalNichtGefundenError('Diesen Leser gibt es nicht.');
      }

      const konto = await verlangeHaendlerkonto();
      // Erst bei Stripe, dann hier: schlaegt Stripe fehl, bleibt die Zeile
      // stehen und der Inhaber sieht den Fehler, statt einen Geist bei
      // Stripe zu hinterlassen, der weiter Zahlungen annehmen koennte.
      verlange(await loescheLeserBeiStripe(cfg, konto.stripeAccountId, zeile.providerReaderId));

      await app.db.transaction(async (tx) => {
        await tx.delete(kartenleser).where(eq(kartenleser.id, zeile.id));
        await tx.insert(auditLog).values({
          eventType: 'kartenleser.geloescht',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: { providerReaderId: zeile.providerReaderId, label: zeile.bezeichnung },
        });
      });

      return reply.status(200).send({ geloescht: true });
    },
  );

  // ── Zahlung starten: die eine Geste ──────────────────────────────────────
  app.post<{ Body: TZahlungStartenBody }>(
    '/api/stripe/terminal/payments',
    {
      schema: {
        tags: ['stripe-terminal'],
        summary: 'Eine Kartenzahlung an den Leser geben, die eine Geste.',
        description:
          'Eroeffnet den PaymentIntent kartenpraesent AUF dem Haendlerkonto ' +
          '(Vermittlungsgebuehr aus der Provisionstabelle, Kanal POS), zeigt die ' +
          'echten Warenkorbzeilen auf dem Kundendisplay des Lesers und ruft ' +
          'process_payment_intent. Dieselbe Idempotenzkennung eroeffnet nie eine ' +
          'zweite Zahlung.',
        body: ZahlungStartenBody,
        response: {
          200: ZahlungView,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      // ⚠️ BIS ZUM 08.08.2026 STAND HIER NUR `requireAuth`.
      //
      // Das Registrieren eines Lesers verlangte ADMIN, das BEWEGEN VON GELD
      // verlangte nichts weiter als irgendeine gueltige Anmeldung. Damit
      // konnte jeder Traeger einer Sitzung oder eines Programmschluessels
      // belasten, abbrechen und erstatten — auch einer, der mit der Kasse
      // nichts zu tun hat.
      //
      // Die Rolle sagt WER; sie ersetzt keine Bestaetigung am Geraet und wird
      // von keiner ersetzt. Beide stehen nebeneinander, nie anstelle des
      // anderen.
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      // ── DIESELBE GESTE, DIESELBE ZAHLUNG (Riegel, Teil 3) ────────────────
      // Vor jedem Anbieter-Aufruf: traegt eine Zahlung bereits diese
      // Idempotenzkennung, ist sie die Antwort — bei Stripe wird kein
      // zweiter Intent eroeffnet.
      const [vorhanden] = await app.db
        .select()
        .from(leserZahlungen)
        .where(eq(leserZahlungen.idempotenzSchluessel, req.body.idempotencyKey))
        .limit(1);
      if (vorhanden !== undefined) {
        return reply.status(200).send(alsZahlungView(vorhanden));
      }

      // Die Rechenpruefung VOR jedem Netzaufruf: die Zeilen des
      // Kundendisplays muessen den Betrag exakt ergeben. Stripe rechnet
      // nichts — also duerfen wir keine Zeilen zeigen, die nicht stimmen.
      const zeilenSumme = req.body.positionen.reduce((s, p) => s + p.betragCents, 0);
      if (zeilenSumme !== req.body.amountCents) {
        throw new TerminalValidierungError(
          `Die Positionen ergeben ${zeilenSumme} Cent, der Betrag ist ${req.body.amountCents} Cent. ` +
            'Das Kundendisplay zeigt nur Zeilen, die exakt aufgehen.',
        );
      }
      if (req.body.steuerCents > req.body.amountCents) {
        throw new TerminalValidierungError('Die Steuer kann nicht groesser sein als der Betrag.');
      }

      const [leser] = await app.db
        .select()
        .from(kartenleser)
        .where(eq(kartenleser.id, req.body.readerId))
        .limit(1);
      if (leser === undefined) {
        throw new TerminalNichtGefundenError('Diesen Leser gibt es nicht.');
      }

      const konto = await verlangeHaendlerkonto();

      // ── DER TORWAECHTER, frisch an der Quelle ────────────────────────────
      // Stripe lehnt eine Zahlung auf einem gesperrten Konto NICHT ab (live
      // gemessen, stripe-connect.ts). Vor jeder Zahlung wird der Stand
      // deshalb bei Stripe nachgeschlagen; ist Stripe nicht erreichbar,
      // gilt der zuletzt bekannte Stand — ein Netzfehler legt keinen
      // freigeschalteten Laden lahm, gibt aber auch keinen gesperrten frei.
      const frisch = await retrieveAccount(
        {
          secretKey: cfg.secretKey,
          apiVersion: cfg.apiVersion,
          defaultFeeBps: Number(opts.env.STRIPE_APPLICATION_FEE_BPS),
        },
        konto.stripeAccountId,
      );
      const stand = frisch.ok ? frisch.value : konto;
      const tor = assertReadyToCharge(stand);
      if (!tor.ready) {
        throw new TerminalZustandError(tor.reason);
      }

      // ── Die Vermittlungsgebuehr: Provisionstabelle, Kanal POS (0110) ─────
      // NICHT hart 1 %: Basels Satz steht als Zeile im Register des
      // Haendlers. Die Auswahl holt alle in Frage kommenden Zeilen und
      // laesst `resolveCommission` entscheiden (rein, ohne Datenbank
      // geprueft) — dieselbe Rangfolge wie im Web-Shop.
      const KANAL: CommissionChannel = 'POS';
      const gebuehr = resolveCommission(
        await app.db
          .select({
            provider: paymentCommissionRates.provider,
            accountRef: paymentCommissionRates.accountRef,
            channel: paymentCommissionRates.channel,
            feeBps: paymentCommissionRates.feeBps,
          })
          .from(paymentCommissionRates)
          .where(
            and(
              eq(paymentCommissionRates.provider, 'STRIPE'),
              or(
                isNull(paymentCommissionRates.accountRef),
                eq(paymentCommissionRates.accountRef, konto.stripeAccountId),
              ),
              or(
                isNull(paymentCommissionRates.channel),
                eq(paymentCommissionRates.channel, KANAL),
              ),
            ),
          ),
        {
          provider: 'STRIPE',
          accountRef: konto.stripeAccountId,
          channel: KANAL,
          fallbackBps: Number(opts.env.STRIPE_APPLICATION_FEE_BPS),
        },
      );
      const feeCents = computeApplicationFeeCents(req.body.amountCents, gebuehr.feeBps);
      req.log.info(
        { feeBps: gebuehr.feeBps, feeCents, source: gebuehr.source, channel: KANAL },
        'commission.resolved',
      );

      // ── PaymentIntent AUF dem Haendlerkonto ──────────────────────────────
      const intent = verlange(
        await erzeugeKartenzahlung(cfg, {
          stripeAccountId: konto.stripeAccountId,
          amountCents: req.body.amountCents,
          feeCents,
          idempotencyKey: req.body.idempotencyKey,
          metadata: { quelle: 'kasse', leser: leser.providerReaderId },
        }),
      );

      // Die Zahlung ins Gedaechtnis, BEVOR der Leser angestossen wird: ab
      // jetzt kann der Webhook jedes Ereignis zuordnen. Verliert dieser
      // INSERT ein Wettrennen um dieselbe Idempotenzkennung, gewinnt die
      // aeltere Zeile — unser frischer Intent wird storniert, nicht benutzt.
      const eingefuegt = await app.db
        .insert(leserZahlungen)
        .values({
          leserId: leser.id,
          providerReaderId: leser.providerReaderId,
          provider: 'STRIPE',
          providerIntentId: intent.intentId,
          stripeAccountId: konto.stripeAccountId,
          betragCents: BigInt(req.body.amountCents),
          steuerCents: BigInt(req.body.steuerCents),
          gebuehrCents: BigInt(feeCents),
          gebuehrBps: gebuehr.feeBps,
          gebuehrQuelle: gebuehr.source,
          status: 'PROCESSING',
          positionen: req.body.positionen satisfies LeserZahlungPosition[],
          idempotenzSchluessel: req.body.idempotencyKey,
          angelegtVon: req.actor.id,
        })
        .onConflictDoNothing({ target: leserZahlungen.idempotenzSchluessel })
        .returning();
      if (eingefuegt.length === 0) {
        await storniereIntent(cfg, {
          stripeAccountId: konto.stripeAccountId,
          intentId: intent.intentId,
        });
        const [gewinner] = await app.db
          .select()
          .from(leserZahlungen)
          .where(eq(leserZahlungen.idempotenzSchluessel, req.body.idempotencyKey))
          .limit(1);
        if (gewinner === undefined) throw new Error('leser_zahlungen: Gewinnerzeile fehlt');
        return reply.status(200).send(alsZahlungView(gewinner));
      }
      const zahlung = eingefuegt[0]!;

      // ── ⭐ Der Leser IST das Kundendisplay, dann die Sammlung ─────────────
      const display = await zeigeWarenkorb(cfg, {
        stripeAccountId: konto.stripeAccountId,
        readerId: leser.providerReaderId,
        positionen: req.body.positionen,
        steuerCents: req.body.steuerCents,
        summeCents: req.body.amountCents,
      });
      const start = display.ok
        ? await starteZahlungAmLeser(cfg, {
            stripeAccountId: konto.stripeAccountId,
            readerId: leser.providerReaderId,
            intentId: intent.intentId,
          })
        : display;

      if (!start.ok) {
        // Kein haengender Intent: stornieren, ehrlich buchen, der Kasse das
        // Fehlerbild nennen. `terminal_reader_offline` ist das haeufigste.
        await storniereIntent(cfg, {
          stripeAccountId: konto.stripeAccountId,
          intentId: intent.intentId,
        });
        const fehlerbild: Fehlerbild | null =
          start.code === 'terminal_reader_offline' ? 'LESER_OFFLINE' : null;
        const [aktualisiert] = await app.db
          .update(leserZahlungen)
          .set({
            status: 'FAILED',
            fehlerbild,
            fehlerMeldung: start.detail,
            updatedAt: new Date(),
          })
          .where(eq(leserZahlungen.id, zahlung.id))
          .returning();
        req.log.warn(
          { intentId: intent.intentId, code: start.code, fehlerbild },
          'leser-zahlung: Start fehlgeschlagen, Intent storniert',
        );
        return reply.status(200).send(alsZahlungView(aktualisiert ?? zahlung));
      }

      req.log.info(
        {
          intentId: intent.intentId,
          readerId: leser.providerReaderId,
          amountCents: req.body.amountCents,
          feeCents,
        },
        'leser-zahlung: Sammlung am Leser gestartet',
      );
      return reply.status(200).send(alsZahlungView(zahlung));
    },
  );

  // ── Stand abfragen ───────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/stripe/terminal/payments/:id',
    {
      schema: {
        tags: ['stripe-terminal'],
        summary: 'Der Stand einer Leser-Zahlung, wie der Webhook ihn fortgeschrieben hat.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: StandResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      // Auch das LESEN gehoert hinter eine Rolle: der Stand einer Zahlung und
      // die Liste der Leser sind Betriebsdaten, kein oeffentliches Wissen.
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const [zahlung] = await app.db
        .select()
        .from(leserZahlungen)
        .where(eq(leserZahlungen.id, req.params.id))
        .limit(1);
      if (zahlung === undefined) {
        throw new TerminalNichtGefundenError('Diese Zahlung gibt es nicht.');
      }
      return reply.status(200).send({
        zahlungId: zahlung.id,
        providerIntentId: zahlung.providerIntentId,
        status: zahlung.status,
        fehlerbild: zahlung.fehlerbild,
        fehlerMeldung: zahlung.fehlerMeldung,
        weicheAblehnungen: zahlung.weicheAblehnungen,
      });
    },
  );

  // ── Abbrechen ────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    '/api/stripe/terminal/payments/:id/cancel',
    {
      schema: {
        tags: ['stripe-terminal'],
        summary: 'Die laufende Sammlung abbrechen: cancel_action + Intent-Storno.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: AbbrechenResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      // ⚠️ BIS ZUM 08.08.2026 STAND HIER NUR `requireAuth`.
      //
      // Das Registrieren eines Lesers verlangte ADMIN, das BEWEGEN VON GELD
      // verlangte nichts weiter als irgendeine gueltige Anmeldung. Damit
      // konnte jeder Traeger einer Sitzung oder eines Programmschluessels
      // belasten, abbrechen und erstatten — auch einer, der mit der Kasse
      // nichts zu tun hat.
      //
      // Die Rolle sagt WER; sie ersetzt keine Bestaetigung am Geraet und wird
      // von keiner ersetzt. Beide stehen nebeneinander, nie anstelle des
      // anderen.
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      const [zahlung] = await app.db
        .select()
        .from(leserZahlungen)
        .where(eq(leserZahlungen.id, req.params.id))
        .limit(1);
      if (zahlung === undefined) {
        throw new TerminalNichtGefundenError('Diese Zahlung gibt es nicht.');
      }
      // Ein bereits beendeter Vorgang wird nicht noch einmal angefasst — die
      // Antwort traegt ehrlich den Stand, den er hat.
      if (zahlung.status !== 'PROCESSING') {
        return reply.status(200).send({ status: zahlung.status });
      }

      // Erst der Leser (die Sammlung beenden), dann der Intent. Beides darf
      // einzeln scheitern (Aktion schon vorbei, Intent schon storniert) —
      // massgeblich ist, dass am Ende nichts mehr sammelt und nichts haengt.
      const aktion = await brichLeserAktionAb(cfg, {
        stripeAccountId: zahlung.stripeAccountId,
        readerId: zahlung.providerReaderId,
      });
      if (!aktion.ok) {
        req.log.info(
          { intentId: zahlung.providerIntentId, detail: aktion.detail },
          'leser-zahlung: cancel_action ohne laufende Aktion',
        );
      }
      const storno = await storniereIntent(cfg, {
        stripeAccountId: zahlung.stripeAccountId,
        intentId: zahlung.providerIntentId,
      });
      if (!storno.ok) {
        req.log.info(
          { intentId: zahlung.providerIntentId, detail: storno.detail },
          'leser-zahlung: Intent-Storno nicht moeglich',
        );
      }

      // Derselbe Automat wie im Webhook, kein zweites Regelwerk. Optimistisch
      // gegen den gelesenen Stand: kommt der Webhook zuvor, gewinnt er.
      const uebergang = naechsterStand(zahlung.status as ZahlungsStand, { typ: 'storniert' });
      if (uebergang.geaendert) {
        await app.db
          .update(leserZahlungen)
          .set({
            status: uebergang.stand,
            fehlerbild: uebergang.fehlerbild,
            fehlerMeldung: uebergang.meldung,
            updatedAt: new Date(),
          })
          .where(and(eq(leserZahlungen.id, zahlung.id), eq(leserZahlungen.status, zahlung.status)));
      }
      const [danach] = await app.db
        .select({ status: leserZahlungen.status })
        .from(leserZahlungen)
        .where(eq(leserZahlungen.id, zahlung.id))
        .limit(1);
      return reply.status(200).send({ status: danach?.status ?? 'CANCELED' });
    },
  );

  // ── Erstattung ───────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: TErstattenBody }>(
    '/api/stripe/terminal/payments/:id/refund',
    {
      schema: {
        tags: ['stripe-terminal'],
        summary: 'Eine Leser-Zahlung erstatten, mit ehrlicher Auskunft ueber den Weg.',
        description:
          'girocard kennt keine Sofort-Erstattung: Stripe ueberweist per SEPA, ein bis ' +
          'zwei Werktage. Die Antwort benennt den Weg woertlich, damit die Kasse es dem ' +
          'Kunden sagen kann, BEVOR er den Laden verlaesst.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: ErstattenBody,
        response: {
          200: ErstattenResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      // ⚠️ BIS ZUM 08.08.2026 STAND HIER NUR `requireAuth`.
      //
      // Das Registrieren eines Lesers verlangte ADMIN, das BEWEGEN VON GELD
      // verlangte nichts weiter als irgendeine gueltige Anmeldung. Damit
      // konnte jeder Traeger einer Sitzung oder eines Programmschluessels
      // belasten, abbrechen und erstatten — auch einer, der mit der Kasse
      // nichts zu tun hat.
      //
      // Die Rolle sagt WER; sie ersetzt keine Bestaetigung am Geraet und wird
      // von keiner ersetzt. Beide stehen nebeneinander, nie anstelle des
      // anderen.
      //
      // ⚠️ Und hier zusaetzlich die Bestaetigung am Geraet. Eine Erstattung
      // schickt Geld HINAUS; im selben Haus verlangt der Storno sie ohne
      // Ausnahme und ohne Betragsgrenze. Zwei verschiedene Fragen: die Rolle
      // sagt WER, die Bestaetigung sagt DASS ER ES GERADE WILL.
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');
      requireStepUp(req);
      const [zahlung] = await app.db
        .select()
        .from(leserZahlungen)
        .where(eq(leserZahlungen.id, req.params.id))
        .limit(1);
      if (zahlung === undefined) {
        throw new TerminalNichtGefundenError('Diese Zahlung gibt es nicht.');
      }
      if (zahlung.status !== 'SUCCEEDED') {
        throw new TerminalZustandError(
          `Nur eine erfolgreiche Zahlung kann erstattet werden (Stand: ${zahlung.status}).`,
        );
      }

      // Das Kartennetz entscheidet ueber den Weg — es steht am Intent, nicht
      // bei uns. girocard heisst SEPA, ein bis zwei Tage; alles andere geht
      // sofort auf die Karte zurueck.
      const intentStand = verlange(
        await holeIntent(cfg, {
          stripeAccountId: zahlung.stripeAccountId,
          intentId: zahlung.providerIntentId,
        }),
      );
      const refund = verlange(
        await erstatte(cfg, {
          stripeAccountId: zahlung.stripeAccountId,
          intentId: zahlung.providerIntentId,
          ...(req.body.amountCents !== undefined ? { amountCents: req.body.amountCents } : {}),
        }),
      );
      const weg = erstattungsWeg(intentStand.kartennetz);

      await app.db.insert(auditLog).values({
        eventType: 'leser_zahlung.erstattet',
        actorUserId: req.actor.id,
        deviceId: req.deviceId ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: {
          zahlungId: zahlung.id,
          providerIntentId: zahlung.providerIntentId,
          refundId: refund.refundId,
          amountCents: req.body.amountCents ?? Number(zahlung.betragCents),
          kartennetz: intentStand.kartennetz,
          weg: weg.weg,
        },
      });

      return reply.status(200).send({
        refundId: refund.refundId,
        refundStatus: refund.status,
        weg: weg.weg,
        hinweis: weg.hinweis,
      });
    },
  );
};

/** Die Antwortform der Kasse — aus einer `leser_zahlungen`-Zeile. */
function alsZahlungView(zahlung: typeof leserZahlungen.$inferSelect): {
  zahlungId: string;
  providerIntentId: string;
  status: string;
  fehlerbild: string | null;
  fehlerMeldung: string | null;
  gebuehrCents: number;
} {
  return {
    zahlungId: zahlung.id,
    providerIntentId: zahlung.providerIntentId,
    status: zahlung.status,
    fehlerbild: zahlung.fehlerbild,
    fehlerMeldung: zahlung.fehlerMeldung,
    gebuehrCents: Number(zahlung.gebuehrCents),
  };
}

export default stripeTerminalRoutes;
