/**
 * `buildApp` — the testable Fastify factory.
 *
 * Tests call `buildApp({ env, dbOverride })` to spin up an isolated server,
 * call `app.inject({…})` against it, and `await app.close()` in teardown.
 *
 * Production calls `buildApp({ env: loadEnv() })` once from `server.ts` and
 * never closes — `close-with-grace` takes care of SIGTERM.
 *
 * Plugin registration order — every position is intentional:
 *
 *   1. metrics            — wraps every following route in HTTP histograms.
 *   2. sensible           — error helpers (reply.notFound(), etc.).
 *   3. cookie             — better-auth + PIN-login need reply.setCookie.
 *   4. swagger            — early so route schemas can be collected.
 *   5. db                 — required by everything below.
 *   6. mtls               — populates req.deviceId (used by PIN-login).
 *   7. auth (better-auth) — mounts /api/auth/*, fills req.actor + req.session.
 *   8. request-context    — opens AsyncLocalStorage scope (needs req.actor).
 *   9. pii                — decorates app.withPii (needs db + request-context).
 *  10. error-handler      — replaces Fastify's default error formatter.
 *  11. routes             — after every decorator is in place.
 */

import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifySensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Sql } from 'postgres';

import type { AppDb } from '@norns/db/client';

import type { Env } from './config/env.js';
import { initSentry } from './lib/sentry.js';
import authPlugin from './plugins/auth.js';
import dbPlugin from './plugins/db.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import metricsPlugin from './plugins/metrics.js';
import mtlsPlugin from './plugins/mtls.js';
import piiPlugin from './plugins/pii.js';
import rateLimitPlugin from './plugins/rate-limit.js';
import requestContextPlugin from './plugins/request-context.js';
import securityHeadersPlugin from './plugins/security-headers.js';
import swaggerPlugin from './plugins/swagger.js';
import adminGoogleAuthRoutes from './routes/admin-auth-google.js';
import adminStaffRoutes from './routes/admin-staff.js';
import arbeitszeitenRoutes from './routes/arbeitszeiten.js';
import einrichtungRoutes from './routes/einrichtung.js';
import verfahrensdokumentationRoutes from './routes/verfahrensdokumentation.js';
import tseEinrichtungRoutes, { type TseEinrichtungOpts } from './routes/tse-einrichtung.js';
import apiKeysRoutes from './routes/api-keys.js';
import appointmentsRoutes from './routes/appointments.js';
// Day 22 — Konvolut + Appraisals
import appraisalRoutes from './routes/appraisals.js';
import approvalsRoutes from './routes/approvals.js';
import authPinRoutes from './routes/auth-pin.js';
import authSessionRoutes from './routes/auth-session.js';
import belegtextRoutes from './routes/belegtext.js';
import bridgeRoutes from './routes/bridge.js';
import calendarRoute from './routes/calendar.js';
import categoriesRoutes from './routes/categories.js';
import closingExportRoute from './routes/closing-export.js';
import prueferPaketRoute from './routes/pruefer-paket.js';
import closingsFinalizeRoute from './routes/closings-finalize.js';
import complianceRoute from './routes/compliance.js';
import customerErasureRoute from './routes/customer-erasure.js';
import customerKycDocumentsRoute from './routes/customer-kyc-documents.js';
// Day 26 — Backend Finale: Customer Trust + Belegtext
import customerTrustRoutes from './routes/customer-trust.js';
import customerUpdateRoute from './routes/customer-update.js';
import customersCheckSanctionsRoute from './routes/customers-check-sanctions.js';
import customersListRoute from './routes/customers-list.js';
import customersVatLookupRoute from './routes/customers-vat-lookup.js';
import { customersVerifyVatRoute } from './routes/customers-verify-vat.js';
import customersRoutes from './routes/customers.js';
import devicesRoutes from './routes/devices.js';
import dashboardRoutes from './routes/dashboard.js';
import documentsRoutes from './routes/documents.js';
import expensesRoutes from './routes/expenses.js';
import financeRoutes from './routes/finance.js';
import fixedCostsRoutes from './routes/fixed-costs.js';
import healthRoute from './routes/health.js';
import inventoryAdjustmentRoute from './routes/inventory-adjustment.js';
import inventoryRelease from './routes/inventory-release.js';
import inventoryReserve from './routes/inventory-reserve.js';
import inventorySessionsRoutes from './routes/inventory-sessions.js';
import ledgerRoutes from './routes/ledger.js';
// Day 23 — Edelmetall-Kursmodul
import metalPricesRoutes from './routes/metal-prices.js';
import photoDirectUploadRoute from './routes/photo-direct-upload.js';
import photoUploadUrlRoute from './routes/photo-upload-url.js';
// Phase 2 Day 2 — closes the Day-24 route gap + dashboard aggregator
import photosRoutes from './routes/photos.js';
import productCategoriesRoute from './routes/product-categories.js';
import productRelocateRoute from './routes/product-relocate.js';
import productsDetailRoute from './routes/products-detail.js';
import productsListRoute from './routes/products-list.js';
import productsRoutes from './routes/products.js';
import registersRoute from './routes/registers.js';
// Day 21 — Retail Core
import settingsRoute from './routes/settings.js';
import shiftsRoutes from './routes/shifts.js';
import belegLogoRoute from './routes/beleg-logo.js';
import shopInfoRoute from './routes/shop-info.js';
import riskRoutes from './routes/risk.js';
import systemHealthRoutes from './routes/system-health.js';
import sseLedger from './routes/sse-ledger.js';
import stripeConnectRoutes from './routes/stripe-connect.js';
import stripeOnboardingRueckweg from './routes/stripe-onboarding-rueckweg.js';
import stripeTerminalRoutes from './routes/stripe-terminal.js';
import stripeWebhookRoutes from './routes/stripe-webhook.js';
// Day 25 — Single-Operator Assistance
import tasksRoutes from './routes/tasks.js';
import transactionsAnkauf from './routes/transactions-ankauf.js';
import transactionsFinalize from './routes/transactions-finalize.js';
import transactionsRecent from './routes/transactions-recent.js';
import transactionsSuche from './routes/transactions-suche.js';
import transactionsRueckgabe from './routes/transactions-rueckgabe.js';
import transactionsStorno from './routes/transactions-storno.js';
import transactionsTseSignature from './routes/transactions-tse-signature.js';
import voucherRoutes from './routes/vouchers.js';

export interface BuildAppOpts {
  env: Env;
  /**
   * Optional DB override — integration tests pass a testcontainer-backed
   * `{ db, sql }` pair so the factory does not open its own connection.
   * Tests exercising SSE LISTEN should also pass `dedicatedConnectionFactory`
   * so per-subscriber connections point at the same container.
   */
  dbOverride?: {
    db: AppDb;
    sql: Sql;
    dedicatedConnectionFactory?: () => Sql;
  };
  /**
   * Optional Fastify options — tests may want `disableRequestLogging: true`,
   * production uses the default Pino transport.
   */
  fastifyOpts?: FastifyServerOptions;
  /**
   * Naht fuer die TSE-Pruefung (`POST /api/tse/einrichten`).
   *
   * ⚠️ Ohne diese Naht koennte kein Test beweisen, dass die Route eine TSE im
   * Zustand CREATED wirklich ABWEIST — man muesste fiskaly anrufen. Ein Riegel,
   * dessen Wirkung niemand nachstellen kann, ist kein Riegel. Im Betrieb bleibt
   * das Feld leer und die Route fragt das echte fiskaly.
   */
  tsePruefer?: TseEinrichtungOpts['pruefer'];
}

export async function buildApp(opts: BuildAppOpts): Promise<FastifyInstance> {
  // Telemetry (GlitchTip/Sentry) — optional + fail-safe: a no-op when no DSN.
  initSentry({ dsn: opts.env.SENTRY_DSN, environment: opts.env.NODE_ENV });

  const app = Fastify({
    logger: {
      level: opts.env.LOG_LEVEL,
      ...(opts.env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard' } } }
        : {}),
    },
    genReqId: () => crypto.randomUUID(),
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
    disableRequestLogging: false,
    /**
     * ⚠️ `true` HIESS: DER CLIENT SCHREIBT SEINE EIGENE ADRESSE.
     *
     * Mit `trustProxy: true` glaubt Fastify dem Kopf `X-Forwarded-For`
     * unbesehen, egal wer ihn geschickt hat. An der Produktion mit drei reinen
     * LESEanfragen gemessen: der Zählerstand der Ratenbremse folgt dem selbst
     * gesetzten Kopf, ein geänderter Wert gibt einen frischen Eimer.
     *
     * Zwei Folgen:
     *   • Jede Bremse ohne Anmeldung ist umgehbar (Anmeldung, Gastkonten,
     *     Reservieren). Die wirklich offene Fläche ist die Anmeldung mit
     *     Kennwort unter der 20-pro-Minute-Regel.
     *   • Dieselbe erfundene Adresse landet in `audit_log.ip_address` und
     *     `sessions.ip_address`. Der Hash-Kettenschutz VERSIEGELT den Wert,
     *     er prüft ihn nicht: eine Fälschung bleibt manipulationssicher
     *     falsch.
     *
     * `1` heisst: genau EIN Sprung wird geglaubt, nämlich der eigene
     * Cloudflare-Tunnel davor. Was der Client selbst in den Kopf schreibt,
     * steht dahinter und wird verworfen.
     *
     * Was NICHT lügt und deshalb erhalten bleibt: die Zuordnung zur Person.
     * Nur die Adressspalte war betroffen.
     */
    trustProxy: 1,
    bodyLimit: 1024 * 1024,
    ...opts.fastifyOpts,
  });

  // 1. Metrics — early, so it wraps every later route.
  await app.register(metricsPlugin, { env: opts.env });

  // 1.5 Security headers + CORS (Day 16 audit A-3 + A-4) — must be FIRST
  //     before any handler emits a response, so even error replies carry
  //     the OWASP headers.
  await app.register(securityHeadersPlugin, { env: opts.env });

  // 2. HTTP error helpers.
  await app.register(fastifySensible);

  // 3. Cookies — better-auth + PIN-login both set/read cookies.
  await app.register(fastifyCookie);
  // ⚠️ OHNE diesen Leser versteht Fastify 4 nur JSON. Ein `<form method="POST">`
  // sendet aber immer `application/x-www-form-urlencoded`. Am 26.07.2026 an der
  // offenen Adresse gemessen: das Skript mit JSON bekam 200, der MENSCH mit dem
  // Formular bekam 400. Das Tor stand genau verkehrt herum, und der
  // Browser-Rueckfallweg aller drei Anwendungen war tot.
  await app.register(fastifyFormbody);

  // 4. OpenAPI generation + Swagger UI.
  await app.register(swaggerPlugin, { env: opts.env });

  // 5. Database.
  await app.register(dbPlugin, {
    env: opts.env,
    ...(opts.dbOverride ? { override: opts.dbOverride } : {}),
  });

  // 6. mTLS device extraction — populates req.deviceId.
  await app.register(mtlsPlugin, { env: opts.env });

  // 7. better-auth + session/actor preHandler — populates req.actor + req.session.
  await app.register(authPlugin, { env: opts.env });

  // 8. AsyncLocalStorage request-context — must run AFTER auth populates the actor.
  await app.register(requestContextPlugin, { env: opts.env });

  // 9. PII helper — depends on db + request-context.
  await app.register(piiPlugin);

  // 9.1 Bot dispatcher — bounded concurrency gate for detached bot turns.

  // 10. Rate limit (Day 16 audit A-1) — AFTER auth so the key generator
  //     can use req.actor.id; falls back to req.ip for unauthenticated routes.
  await app.register(rateLimitPlugin, { env: opts.env });

  // 14.08.2026: hier standen die Storefront-Sitzung und der Online-Schalter
  // (Kundenshop, Abholung, Versand). Der Kundenshop ist mit der Trennung von
  // warehouse14 gefallen; es gibt nichts mehr zu schalten.

  // 11. Error handler.
  await app.register(errorHandlerPlugin);

  // 12. Routes.
  await app.register(healthRoute, { env: opts.env });
  await app.register(authPinRoutes, { env: opts.env });
  await app.register(authSessionRoutes);
  // Phase 1 — staff/owner Sign-in-with-Google (the enterprise-grade replacement
  // for the PIN front door). Resolves the verified Google email against `users`
  // and 403s anything not provisioned; mints the same session shape as pin-login.
  await app.register(adminGoogleAuthRoutes, { env: opts.env });
  // Track E — API keys (programmatic access for agents / LLMs / integrations).
  // Management routes are human-admin only (a key cannot manage keys); resolution
  // of a presented key happens in the auth preHandler.
  await app.register(apiKeysRoutes);
  // Track B2 — risk analysis read layer (alert rollup + customer watchlist +
  // env-gated Cloudflare edge-protection rollup).
  await app.register(riskRoutes, { env: opts.env });
  // Owner "Leitstand" — system-health snapshot (components + integrations +
  // open problems) in one round-trip. Owner-only; separate from the
  // METRICS_TOKEN-gated /health so it rides the session/actor path.
  await app.register(systemHealthRoutes, { env: opts.env });
  // Track A3 — staff administration (Owner + step-up; role writes via the
  // SECURITY DEFINER provision_staff function).
  await app.register(adminStaffRoutes);
  await app.register(tseEinrichtungRoutes, {
    env: opts.env,
    // `exactOptionalPropertyTypes`: das Feld darf nur DA sein, wenn es einen
    // Wert hat. Ein ausdrueckliches `undefined` ist etwas anderes als Fehlen.
    ...(opts.tsePruefer ? { pruefer: opts.tsePruefer } : {}),
  });
  await app.register(arbeitszeitenRoutes);
  await app.register(einrichtungRoutes);
  await app.register(verfahrensdokumentationRoutes);
  await app.register(inventoryReserve);
  await app.register(inventoryRelease);
  await app.register(productsRoutes, { env: opts.env });
  await app.register(productsListRoute);
  await app.register(productsDetailRoute);
  await app.register(inventoryAdjustmentRoute);
  await app.register(productRelocateRoute);
  await app.register(complianceRoute);
  // ── Day 13 / Phase 2.B kick-off: commerce taxonomy ────────────────
  await app.register(categoriesRoutes);
  await app.register(productCategoriesRoute);
  await app.register(customersRoutes);
  await app.register(devicesRoutes);
  await app.register(customersListRoute);
  await app.register(customersVatLookupRoute);
  await app.register(customerUpdateRoute);
  await app.register(customersVerifyVatRoute);
  await app.register(customersCheckSanctionsRoute, { env: opts.env });
  await app.register(customerKycDocumentsRoute, { env: opts.env });
  await app.register(customerErasureRoute, { env: opts.env });
  await app.register(photoUploadUrlRoute, { env: opts.env });
  await app.register(photoDirectUploadRoute, { env: opts.env });
  await app.register(transactionsFinalize, { env: opts.env });
  await app.register(transactionsAnkauf, { env: opts.env });
  await app.register(transactionsStorno);
  await app.register(transactionsTseSignature);
  await app.register(transactionsRecent);
  await app.register(transactionsSuche);
  await app.register(transactionsRueckgabe);
  await app.register(sseLedger);
  // 0097: the staff side of the customer conversation.
  await app.register(stripeConnectRoutes, { env: opts.env });
  await app.register(stripeOnboardingRueckweg, { env: opts.env });
  await app.register(stripeTerminalRoutes, { env: opts.env });
  // Der Kartenleser-Webhook — eigener Geltungsbereich (roher JSON-Parser nur
  // dort). 14.08.2026 wiederhergestellt: die Trennung hatte ihn mit dem
  // Kundenshop-Webhook entsorgt, dabei ist er der EINE Schreiber des
  // Leser-Zahlungsstands (siehe routes/stripe-webhook.ts).
  await app.register(stripeWebhookRoutes, { env: opts.env });
  // ── Day 21: retail core ───────────────────────────────────────────
  await app.register(shiftsRoutes);
  await app.register(voucherRoutes);
  await app.register(inventorySessionsRoutes);
  // 15.08.2026: POST /api/transactions/return ist geloescht. Sie wies alles
  // ab, was kein WEB-Verkauf war, und seit dem 0.4.0-Kahlschlag schreibt
  // NIEMAND mehr salesChannel WEB: die Route konnte nur noch ablehnen.
  // Zugleich schrieb sie in die fiskalische Tabelle, ohne die
  // Sicherungseinrichtung zu pruefen.
  await app.register(appointmentsRoutes, { env: opts.env });
  // ── Day 22: Konvolut + Appraisals ────────────────────────────────
  await app.register(appraisalRoutes);
  // ── Day 23: Edelmetall-Kursmodul ─────────────────────────────────
  await app.register(metalPricesRoutes);
  // ── Day 25: Single-Operator Assistance ───────────────────────────
  await app.register(tasksRoutes);
  await app.register(documentsRoutes);
  // ── Day 26: Backend Finale — Customer Trust + Belegtext ──────────
  await app.register(customerTrustRoutes);
  await app.register(belegtextRoutes);
  await app.register(photosRoutes, { env: opts.env });
  await app.register(dashboardRoutes);
  // ── Owner OS: finance backend (migration 0075) ───────────────────
  await app.register(financeRoutes);
  await app.register(expensesRoutes);
  await app.register(fixedCostsRoutes);
  await app.register(bridgeRoutes);
  await app.register(approvalsRoutes);
  await app.register(settingsRoute);
  await app.register(calendarRoute);
  await app.register(shopInfoRoute);
  // Das Beleg-Logo des Haendlers (Dekret 26.07.2026, Wanderung 0119).
  await app.register(belegLogoRoute);
  // 19.08.2026: hier stand der Sprachassistent (kurzlebige Sitzungs-Token
  // fuer ein externes Sprachmodell). Seine Oberflaeche war laengst ausgebaut,
  // der Weg fuehrte ins Leere — Basels Anweisung: alle solchen Erbstuecke
  // verlassen das Haus. Siehe docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md.
  await app.register(ledgerRoutes);
  // ── Epic K: DSFinV-K / DATEV fiscal exports ──────────────────────
  await app.register(closingExportRoute);
  await app.register(prueferPaketRoute);
  await app.register(closingsFinalizeRoute);
  await app.register(registersRoute);
  // Public read-only catalog endpoints. The path prefix
  // so the auth + mTLS preHandlers bypass these routes automatically.
  // scope as the catalog; strict per-route rate limits inside the plugin.
  // 19.08.2026: hier stand ein Werkzeug-Endpunkt fuer Sprachmodelle
  // (JSON-RPC unter /api/mcp, nur ADMIN). Kein Bildschirm der Kasse rief
  // ihn; er gehoerte zum ausgebauten Sprachassistenten. Ausgezogen mit
  // Wanderung 0149 — siehe docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md.

  return app;
}
