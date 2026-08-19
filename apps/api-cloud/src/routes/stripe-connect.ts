/**
 * Stripe Connect Standard — die Einrichtung des Händlerkontos (0108).
 *
 *   POST /api/stripe/connect/account     — legt das eigene Konto des Händlers an
 *   POST /api/stripe/connect/onboarding  — erzeugt den kurzlebigen Einrichtungslink
 *   GET  /api/stripe/connect/status      — fragt den Freischaltungsstand ab
 *
 * Alle drei sind OWNER-only. Es geht um das Konto, auf das das Geld des
 * Betriebs fliesst; ein Kassierer hat hier nichts zu suchen, und eine
 * versehentlich falsch verknüpfte Kontokennung wäre der teuerste denkbare
 * Fehler im ganzen System.
 *
 * ── Warum es kein PUT auf die Kontokennung gibt ────────────────────────────
 *
 * Die Kennung wird EINMAL geschrieben, beim Anlegen, und danach nie wieder.
 * Migration 0108 vergibt das UPDATE-Recht deshalb spaltenweise und lässt
 * `stripe_account_id` bewusst aus. Selbst wenn hier eine Route entstünde, die
 * sie ändern will, verweigert die Datenbank es. Zwei Schlösser, weil eine
 * umgebogene Kennung jede künftige Zahlung an ein fremdes Konto leiten würde.
 *
 * ── Warum die Rückkehr aus dem Browser nichts beweist ──────────────────────
 *
 * Nach dem Onboarding schickt Stripe den Händler auf die Rückkehrseite. Diese
 * Rückkehr sagt nur, dass er das Formular verlassen hat, nicht dass Stripe ihn
 * freigeschaltet hat. Der Stand wird darum ausschliesslich aktiv bei Stripe
 * abgefragt oder aus einer signierten `account.updated`-Meldung übernommen.
 * Dasselbe Prinzip wie bei der Zahlung selbst (payment-gateway.ts).
 */

import { Type } from '@sinclair/typebox';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { stripeConnectedAccounts } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireOwner } from '../lib/auth-policy.js';
import {
  assertReadyToCharge,
  createOnboardingLink,
  createStandardAccount,
  retrieveAccount,
  type ConnectRefusal,
  type ConnectedAccountState,
  type StripeConnectConfig,
} from '../lib/stripe-connect.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ConnectNotConfiguredError extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}
class ConnectProviderError extends DomainError {
  public readonly httpStatus = 502;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}
class ConnectInputError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class ConnectMissingError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class ConnectConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/** Übersetzt eine Ablehnung des Anschlusses in den passenden HTTP-Fehler. */
function raise(reason: ConnectRefusal, detail: string): never {
  switch (reason) {
    case 'NOT_CONFIGURED':
      throw new ConnectNotConfiguredError(detail);
    case 'INVALID_INPUT':
      throw new ConnectInputError(detail);
    case 'NOT_READY':
      throw new ConnectConflictError(detail);
    case 'PROVIDER_REJECTED':
      throw new ConnectProviderError(detail);
  }
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const StatusResponse = Type.Object({
  connected: Type.Boolean(),
  stripeAccountId: Type.Optional(Type.String()),
  chargesEnabled: Type.Boolean(),
  payoutsEnabled: Type.Boolean(),
  detailsSubmitted: Type.Boolean(),
  /** Wahr heisst: an der Kasse darf jetzt eine Kartenzahlung eröffnet werden. */
  readyToCharge: Type.Boolean(),
  /** Ein Satz auf Deutsch, den die Oberfläche unverändert anzeigen kann. */
  hint: Type.String(),
  applicationFeeBps: Type.Integer(),
  requirements: Type.Optional(Type.Unknown()),
  lastSyncedAt: Type.Union([Type.String(), Type.Null()]),
});

const OnboardingResponse = Type.Object({
  url: Type.String(),
  expiresAt: Type.Integer(),
});

export interface StripeConnectRouteOpts {
  env: Env;
}

const stripeConnectRoutes: FastifyPluginAsync<StripeConnectRouteOpts> = async (app, opts) => {
  const cfg: StripeConnectConfig = {
    secretKey: opts.env.STRIPE_SECRET_KEY,
    apiVersion: opts.env.STRIPE_API_VERSION,
    defaultFeeBps: Number(opts.env.STRIPE_APPLICATION_FEE_BPS),
  };

  /** Die eine Zeile, sofern es sie gibt. Ein Laden, ein Konto. */
  async function loadRow() {
    const rows = await app.db
      .select()
      .from(stripeConnectedAccounts)
      .orderBy(drizzleSql`created_at ASC`)
      .limit(1);
    return rows[0] ?? null;
  }

  /** Schreibt einen frisch bei Stripe abgefragten Stand fort. */
  async function persistState(state: ConnectedAccountState) {
    await app.db
      .update(stripeConnectedAccounts)
      .set({
        chargesEnabled: state.chargesEnabled,
        payoutsEnabled: state.payoutsEnabled,
        detailsSubmitted: state.detailsSubmitted,
        requirements: state.requirements,
        country: state.country,
        defaultCurrency: state.defaultCurrency,
        lastSyncedAt: drizzleSql`now()` as unknown as Date,
        updatedAt: drizzleSql`now()` as unknown as Date,
      })
      .where(eq(stripeConnectedAccounts.stripeAccountId, state.stripeAccountId));
  }

  app.post<{ Body: { email?: string; businessName?: string } }>(
    '/api/stripe/connect/account',
    {
      schema: {
        tags: ['stripe-connect'],
        summary: 'Legt das eigene Stripe-Konto des Händlers an (Connect Standard). OWNER.',
        description:
          'Erzeugt ein Standard-Konto auf den Namen des Händlers. Das Geld fliesst danach direkt ' +
          'dorthin, nie über die Plattform. Ist bereits ein Konto verknüpft, wird KEIN zweites ' +
          'angelegt, sondern der bestehende Stand zurückgegeben.',
        body: Type.Object({
          email: Type.Optional(Type.String({ format: 'email' })),
          businessName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        }),
        response: { 200: StatusResponse, 401: ErrorResponse, 403: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      requireOwner(req);

      // Ein zweites Konto anzulegen wäre kein harmloser Doppelklick: der Laden
      // hätte zwei Konten bei Stripe, und die Zahlungen verteilten sich still
      // auf beide. Darum wird hier nichts angelegt, sondern nur berichtet.
      const existing = await loadRow();
      if (existing) {
        const fresh = await retrieveAccount(cfg, existing.stripeAccountId);
        if (fresh.ok) await persistState(fresh.value);
        return statusPayload(existing.stripeAccountId, fresh.ok ? fresh.value : existing, existing.applicationFeeBps, existing.lastSyncedAt);
      }

      const created = await createStandardAccount(cfg, {
        email: req.body.email ?? null,
        businessName: req.body.businessName ?? null,
      });
      if (!created.ok) raise(created.reason, created.detail);

      await app.db.insert(stripeConnectedAccounts).values({
        stripeAccountId: created.value.stripeAccountId,
        country: created.value.country,
        defaultCurrency: created.value.defaultCurrency,
        chargesEnabled: created.value.chargesEnabled,
        payoutsEnabled: created.value.payoutsEnabled,
        detailsSubmitted: created.value.detailsSubmitted,
        requirements: created.value.requirements,
      });

      req.log.info(
        { stripeAccountId: created.value.stripeAccountId },
        'stripe.connect.account_created',
      );
      return statusPayload(created.value.stripeAccountId, created.value, null, null);
    },
  );

  app.post(
    '/api/stripe/connect/onboarding',
    {
      schema: {
        tags: ['stripe-connect'],
        summary: 'Erzeugt den kurzlebigen Link zur Einrichtung bei Stripe. OWNER.',
        description:
          'Der Link ist EINMALIG und läuft nach wenigen Minuten ab. Er darf nicht gespeichert und ' +
          'nicht verschickt werden, sondern muss sofort geöffnet werden.',
        response: { 200: OnboardingResponse, 401: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 502: ErrorResponse, 503: ErrorResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      requireOwner(req);

      const row = await loadRow();
      if (!row) {
        throw new ConnectMissingError(
          'Es ist noch kein Stripe-Konto angelegt. Bitte zuerst das Konto erstellen.',
        );
      }
      if (
        opts.env.STRIPE_CONNECT_RETURN_URL.trim().length === 0 ||
        opts.env.STRIPE_CONNECT_REFRESH_URL.trim().length === 0
      ) {
        throw new ConnectNotConfiguredError(
          'Für die Einrichtung fehlen die Rückkehradressen. Ohne sie kann Stripe den Händler ' +
            'nach dem Abschluss nirgendwohin zurückschicken.',
        );
      }

      const link = await createOnboardingLink(cfg, {
        stripeAccountId: row.stripeAccountId,
        returnUrl: opts.env.STRIPE_CONNECT_RETURN_URL,
        refreshUrl: opts.env.STRIPE_CONNECT_REFRESH_URL,
      });
      if (!link.ok) raise(link.reason, link.detail);
      return link.value;
    },
  );

  app.get(
    '/api/stripe/connect/status',
    {
      schema: {
        tags: ['stripe-connect'],
        summary: 'Der Freischaltungsstand des Händlerkontos. OWNER.',
        description:
          'Fragt aktiv bei Stripe nach und schreibt den Stand fort. Ist Stripe nicht erreichbar, ' +
          'wird der zuletzt bekannte Stand zurückgegeben, deutlich am Zeitstempel erkennbar.',
        response: { 200: StatusResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      requireOwner(req);

      const row = await loadRow();
      if (!row) {
        return {
          connected: false,
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          readyToCharge: false,
          hint: 'Es ist noch kein Stripe-Konto verknüpft. Kartenzahlung ist nicht möglich.',
          applicationFeeBps: Number(opts.env.STRIPE_APPLICATION_FEE_BPS),
          lastSyncedAt: null,
        };
      }

      const fresh = await retrieveAccount(cfg, row.stripeAccountId);
      if (fresh.ok) {
        await persistState(fresh.value);
        return statusPayload(row.stripeAccountId, fresh.value, row.applicationFeeBps, new Date());
      }
      // Stripe war nicht erreichbar. Wir erfinden keinen Stand, sondern
      // liefern den zuletzt bekannten, und der Zeitstempel verrät sein Alter.
      req.log.warn({ reason: fresh.reason }, 'stripe.connect.status_stale');
      return statusPayload(row.stripeAccountId, row, row.applicationFeeBps, row.lastSyncedAt);
    },
  );

  function statusPayload(
    stripeAccountId: string,
    state: { chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean; requirements?: unknown },
    feeBps: number | null,
    syncedAt: Date | null,
  ) {
    const gate = assertReadyToCharge(state);
    return {
      connected: true,
      stripeAccountId,
      chargesEnabled: state.chargesEnabled,
      payoutsEnabled: state.payoutsEnabled,
      detailsSubmitted: state.detailsSubmitted,
      readyToCharge: gate.ready,
      hint: gate.reason,
      applicationFeeBps: feeBps ?? Number(opts.env.STRIPE_APPLICATION_FEE_BPS),
      requirements: state.requirements ?? {},
      lastSyncedAt: syncedAt ? new Date(syncedAt).toISOString() : null,
    };
  }
};

export default stripeConnectRoutes;
