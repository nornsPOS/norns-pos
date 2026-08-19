/**
 * Metal-prices routes — Edelmetall-Kursmodul (Day 23).
 *
 *   GET  /api/metal-prices/current  — { prices: [{ metal, pricePerGramEur, … }] }
 *                                     Always 4 entries (gold/silver/platinum/palladium),
 *                                     `null` price when no row exists yet.
 *                                     ADMIN + CASHIER.
 *
 *   GET  /api/metal-prices/history?metal=&limit=&offset=
 *                                   — paged history. ADMIN-only.
 *
 *   POST /api/metal-prices          — Owner manual override.
 *                                     Body: { metal, pricePerGramEur, reason }
 *                                     Owner-only. Writes audit_log.
 *                                     Performs close-out + insert in one TX
 *                                     against the partial UNIQUE.
 *
 *   GET  /api/products/:id/valuation — schmelzwert + collector_premium +
 *                                      suggested ask + margin-over-scrap.
 *                                      ADMIN + CASHIER.
 *
 * Money math relies on the SQL helpers `current_metal_price_eur_per_gram` and
 * `product_schmelzwert_eur` so rounding is identical to the DB-side view (the
 * Schmelzwert column ROUNDs HALF-AWAY-FROM-ZERO to 2dp via NUMERIC arithmetic).
 *
 * ⚠️ 11.08.2026 — WORAUF SICH DIESES „IDENTISCH" BEZIEHT, UND WORAUF NICHT.
 *
 * Identisch heisst: diese Route liest die SQL-Funktion, also bekommt sie
 * genau deren Zahl. Es heisst NICHT, dass die Kasse dieselbe Zahl ausrechnet.
 * Die tut es an zwei Stellen anders:
 *
 *   1. `feingewicht_grams` ist NUMERIC(10,4) GENERATED — das Feingewicht wird
 *      ZUERST auf vier Stellen gerundet, erst dann multipliziert. Die Kasse
 *      (`intake-math.ts`) rechnet in bigint durch und rundet EINMAL am Ende.
 *   2. Postgres rundet NUMERIC von der Null weg, Decimal.js ist im Haus global
 *      auf ROUND_HALF_EVEN gestellt.
 *
 * Auf ein Stueck macht das einen Cent. Es beruehrt keinen Beleg, keine TSE,
 * keine DSFinV-K (Wanderung 0132: „NUR BESTAND, NIEMALS EIN BELEG"). Wer die
 * beiden Zahlen aber je gegeneinander stellt, muss wissen, warum sie sich
 * unterscheiden — sonst sucht er einen Defekt, den es nicht gibt.
 */

import { Type } from '@sinclair/typebox';
import { asc, count, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { AppDb } from '@norns/db/client';
import {
  METAL_KIND,
  type MetalKind,
  metalPrices,
  systemSettings,
} from '@norns/db/schema';
import { Money } from '@norns/domain';
import { VERKAUFSAUFSCHLAG_KEY, leseVerkaufsaufschlag } from '../lib/verkaufsaufschlag.js';

import { requireAuth, requireOwner, requireRole } from '../lib/auth-policy.js';
import { KURS_HOECHSTALTER_STUNDEN, beurteileKursalter } from '../lib/kursalter.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CurrentMetalPricesResponse,
  MarginBody,
  MarginResponse,
  MetalPriceHistoryQuery,
  MetalPriceHistoryResponse,
  MetalRatesResponse,
  ProductValuationParams,
  ProductValuationResponse,
  type TMarginBody,
  type TMetalPriceHistoryQuery,
  type TProductValuationParams,
  type TVerkaufsaufschlagBody,
  VerkaufsaufschlagBody,
  VerkaufsaufschlagResponse,
} from '../schemas/metal-prices.js';

/**
 * Ankauf safety margin (ADR Epic A). The live value lives in system_settings
 * under `MARGIN_KEY` (Owner-editable via PATCH /margin, Phase A3); this is the
 * fallback used when the key is absent or malformed.
 */
const MARGIN_KEY = 'pricing.ankauf_safety_margin_pct';
const DEFAULT_ANKAUF_SAFETY_MARGIN_PCT = 0.1;
const MARGIN_MIN = 0;
const MARGIN_MAX = 0.5;
const AVG_WINDOW_DAYS = 10;

function clampMargin(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= MARGIN_MIN && v <= MARGIN_MAX
    ? v
    : null;
}

/** The system_settings key holding a metal's margin override. */
function marginKeyFor(metal: MetalKind): string {
  return `${MARGIN_KEY}.${metal}`;
}

/**
 * Read the global Ankauf safety margin plus any per-metal overrides in one
 * round-trip. A metal without its own valid override inherits the global value;
 * the global itself falls back to the default when missing/out-of-range.
 */
async function readMargins(
  db: AppDb,
): Promise<{ global: number; perMetal: Record<MetalKind, number> }> {
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(drizzleSql`${systemSettings.key} LIKE ${`${MARGIN_KEY}%`}`);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const global = clampMargin(byKey.get(MARGIN_KEY)) ?? DEFAULT_ANKAUF_SAFETY_MARGIN_PCT;
  const perMetal = {} as Record<MetalKind, number>;
  for (const m of METAL_KIND) {
    perMetal[m] = clampMargin(byKey.get(marginKeyFor(m))) ?? global;
  }
  return { global, perMetal };
}

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
/*
 * ── ⛔ 11.08.2026: HIER STAND EINE NOTBREMSE, DIE NIEMAND ZIEHEN KONNTE ────
 *
 * `ImplausiblePriceError` und `OVERRIDE_BAND_PCT` wohnen jetzt in
 * `lib/kursband.ts`. Zwei Gründe, beide gemessen:
 *
 * 1. DIE NOTBREMSE WAR TOT. Die Kommentare hier versprachen dem Leser, der
 *    Inhaber könne mit `confirmOutlier: true` durchsetzen. Gemessen: das Wort
 *    kam im ganzen Baum NUR in dieser Datei vor. Der Klientenvertrag
 *    (`ManualOverrideBody`) kennt kein solches Feld, und der einzige Aufrufer
 *    schickt drei. Ein Kommentar, der einen Weg verspricht, den es nicht gibt,
 *    ist schlimmer als keiner.
 *
 * 2. DER SATZ KAM NIE AN. Er nannte dem Händler auf Deutsch den englischen
 *    Feldnamen — und erreichte ihn ohnehin nicht: als `VALIDATION_ERROR` ohne
 *    ajv-Feldliste steigt `describeValidationError` aus, und am Tresen stand
 *    „Eingabe ungültig bitte die Angaben prüfen. (NORNS-IMPLAUSIBLE-PRICE)".
 *    Weder Band noch Vergleichskurs. Deshalb hat der Fall jetzt einen EIGENEN
 *    Code (`IMPLAUSIBLE_PRICE`) und trägt seine Zahlen in `details.kursband`.
 *
 * Die Prüfung selbst ist unverändert: dieselbe Money-Rechnung, dasselbe Band,
 * dieselbe Stelle innerhalb der Transaktion, VOR jedem Schreibvorgang.
 *
 * ⚰️ 18.08.2026, das Ende der Geschichte: mit der Handeingabe starb auch das
 * Band. `lib/kursband.ts` ist gelöscht, samt Wächter und dem Fehlercode
 * `IMPLAUSIBLE_PRICE`. Es war ±50 % GEGEN DIE LAUFENDE ZEILE gebaut, mit
 * einem Fehlersatz, der einen Menschen bittet, seine EINGABE zu prüfen und
 * in Schritten einzutragen. Auf die Quellen-Übernahme gelegt wäre es eine
 * Falle: steht die Kasse Monate still und der Markt läuft weiter als das
 * Band, lehnte der Dienst die echte Quelle für immer ab, und den
 * menschlichen Notausgang gibt es nicht mehr. Die Übernahme hat ihren
 * eigenen, richtigen Wächter: absolute Vernunftgrenzen (`SINNVOLL`) im
 * Beipack-Dienst, je Metall, laut im Protokoll wenn verworfen.
 */

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const metalPricesRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/metal-prices/current
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/metal-prices/current',
    {
      schema: {
        tags: ['metal-prices'],
        summary: 'Current price per gram (EUR) for all 4 metals.',
        description:
          'Always returns exactly 4 entries (gold/silver/platinum/palladium). ' +
          'When no row exists for a metal yet, fields are nulled — UI shows ' +
          '"awaiting first fix".',
        response: {
          200: CurrentMetalPricesResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // One round-trip — SELECT the CURRENT row per metal.
      const rows = await app.db
        .select({
          metal: metalPrices.metal,
          pricePerGramEur: metalPrices.pricePerGramEur,
          source: metalPrices.source,
          fetchedAt: metalPrices.fetchedAt,
          validFrom: metalPrices.validFrom,
        })
        .from(metalPrices)
        .where(drizzleSql`${metalPrices.validTo} IS NULL`);

      const byMetal = new Map(rows.map((r) => [r.metal as MetalKind, r]));
      const prices = METAL_KIND.map((m) => {
        const r = byMetal.get(m);
        return r
          ? {
              metal: m,
              pricePerGramEur: r.pricePerGramEur,
              source: r.source,
              fetchedAt: r.fetchedAt.toISOString(),
              validFrom: r.validFrom.toISOString(),
            }
          : {
              metal: m,
              pricePerGramEur: null,
              source: null,
              fetchedAt: null,
              validFrom: null,
            };
      });

      return reply.status(200).send({ prices });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/metal-prices/rates — current + 10d time-weighted avg + Ankauf
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/metal-prices/rates',
    {
      schema: {
        tags: ['metal-prices'],
        summary: 'Per-metal current price, 10-day time-weighted average, and Ankauf buy rate.',
        description:
          'Ankauf rate = 10-day time-weighted average × (1 − safetyMarginPct, default 0.10). ' +
          'verkaufBasePerGramEur is the current spot (melt value per gram); the full item-level ' +
          'suggested ask (Schmelzwert + Sammleraufschlag) lives in GET /api/products/:id/valuation. ' +
          'NULL fields mean "no price / no in-window coverage yet". ADMIN + CASHIER.',
        response: {
          200: MetalRatesResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // Owner-configured margins: global default + per-metal overrides.
      const { global: safetyMarginPct, perMetal } = await readMargins(app.db);

      // Die Altersgrenze ist eine Einstellung, kein Beton: wer den Abruf
      // engmaschiger fährt, darf sie senken. Vorgabe 48 Stunden, begründet in
      // lib/kursalter.ts aus dem gemessenen Rhythmus der Produktion.
      const [grenzeRow] = (await app.db.execute<{ v: string | null }>(drizzleSql`
        SELECT (value #>> '{}') AS v FROM system_settings
         WHERE key = 'pricing.kurs_hoechstalter_stunden'`)) as unknown as Array<{
        v: string | null;
      }>;
      const hoechstalter = Number(grenzeRow?.v ?? KURS_HOECHSTALTER_STUNDEN);

      // One round-trip: compute current / 10d-avg / Ankauf for all 4 metals via
      // the SQL helpers so rounding matches every other read of the same value.
      // Each metal carries its OWN margin into the VALUES list so the Ankauf
      // rate is ROUND-ed in SQL with that metal's discount.
      const rows = await app.db.execute<{
        metal: string;
        current_price: string | null;
        avg10d: string | null;
        ankauf: string | null;
        gueltig_seit: string | null;
      }>(drizzleSql`
      SELECT
        m.metal                                                            AS metal,
        current_metal_price_eur_per_gram(m.metal)                          AS current_price,
        -- ⚠️ WANN wurde dieser Kurs gültig? Ohne diese Spalte konnte niemand
        -- merken, dass er eingefroren ist. Gold stand vom 05.06. bis 13.06.
        -- auf EINEM Wert, 172,8 Stunden, und wurde die ganze Zeit als
        -- aktueller ausgeliefert. Siehe lib/kursalter.ts.
        (SELECT valid_from FROM metal_prices
          WHERE metal = m.metal AND valid_to IS NULL LIMIT 1)              AS gueltig_seit,
        metal_price_avg_eur_per_gram(m.metal, ${AVG_WINDOW_DAYS}::int)      AS avg10d,
        ROUND(
          metal_price_avg_eur_per_gram(m.metal, ${AVG_WINDOW_DAYS}::int)
            * (1 - m.margin),
          4
        )                                                                  AS ankauf
      FROM (VALUES
        ('gold',      ${String(perMetal.gold)}::numeric),
        ('silver',    ${String(perMetal.silver)}::numeric),
        ('platinum',  ${String(perMetal.platinum)}::numeric),
        ('palladium', ${String(perMetal.palladium)}::numeric)
      ) AS m(metal, margin)`);

      const list = rows as unknown as Array<{
        metal: string;
        current_price: string | null;
        avg10d: string | null;
        ankauf: string | null;
        gueltig_seit: string | null;
      }>;
      const byMetal = new Map(list.map((r) => [r.metal as MetalKind, r]));

      const jetzt = new Date();
      const rates = METAL_KIND.map((m) => {
        const r = byMetal.get(m);
        const alter = beurteileKursalter({
          gueltigSeit: r?.gueltig_seit ?? null,
          jetzt,
          hoechstalterStunden: hoechstalter,
        });
        return {
          metal: m,
          currentPricePerGramEur: r?.current_price ?? null,
          avg10dPricePerGramEur: r?.avg10d ?? null,
          // ⚠️ BEI EINEM VERALTETEN KURS GIBT ES KEINEN ANKAUFSVORSCHLAG.
          //
          // Der Kurs selbst wird weiter geliefert — die Oberfläche soll ihn
          // ZEIGEN dürfen, samt Alter, damit ein Mensch entscheiden kann.
          // Aber der Ankaufsatz wird ungefragt ins Preisfeld vorgeschrieben,
          // und ein Vorschlag aus einem sieben Tage alten Kurs ist bares
          // Geld in die falsche Richtung. `null` heisst hier: rechne selbst.
          ankaufRatePerGramEur: alter.veraltet ? null : (r?.ankauf ?? null),
          verkaufBasePerGramEur: r?.current_price ?? null,
          safetyMarginPct: perMetal[m],
          /** Wann dieser Kurs gültig wurde. Null, wenn es keinen gibt. */
          asOf: r?.gueltig_seit ?? null,
          /** Alter in Stunden. Die Oberfläche kann daraus „zuletzt …" bauen. */
          ageHours: alter.alterStunden,
          /** Zu alt für eine Empfehlung. Dann ist `ankaufRatePerGramEur` null. */
          stale: alter.veraltet,
        };
      });

      return reply.status(200).send({
        safetyMarginPct,
        windowDays: AVG_WINDOW_DAYS,
        rates,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/metal-prices/margin — Owner sets the Ankauf safety margin
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Body: TMarginBody }>(
    '/api/metal-prices/margin',
    {
      schema: {
        tags: ['metal-prices'],
        summary: 'Set the Ankauf safety margin (Owner-only).',
        description:
          'Upserts system_settings.pricing.ankauf_safety_margin_pct. marginPct is a ' +
          'fraction in [0, 0.50] (0.12 = 12%). Out-of-range values are rejected (400). ' +
          'The change is audited via the system_settings AFTER-write trigger.',
        body: MarginBody,
        response: {
          200: MarginResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req); // narrows req.actor
      requireOwner(req);

      const { metal, marginPct } = req.body;
      const key = metal ? marginKeyFor(metal) : MARGIN_KEY;
      const description = metal
        ? `Ankauf safety margin for ${metal} as a fraction (0.10 = 10%). Owner-editable.`
        : 'Ankauf safety margin (global default) as a fraction (0.10 = 10%). Owner-editable.';

      // Upsert: app holds INSERT (default privilege) + column UPDATE on
      // system_settings. The global key is seeded in migration 0034; per-metal
      // override keys are created on first write. updated_at is set by the
      // BEFORE-UPDATE trigger; the AFTER-write trigger audits the change.
      await app.db
        .insert(systemSettings)
        .values({ key, value: marginPct, description, updatedByUserId: req.actor.id })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: marginPct, updatedByUserId: req.actor.id },
        });

      return reply.status(200).send({ metal: metal ?? null, marginPct });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/metal-prices/verkaufsaufschlag — der Stand aller vier
  // ────────────────────────────────────────────────────────────────────
  //
  // Basels Entscheidung vom 05.08.2026: der Verkaufspreis eines
  // Metallstücks wird gerechnet, Feingewicht × Tageskurs + Aufschlag. Der
  // Aufschlag gehört ihm, nicht dem Quelltext — er setzt ihn selbst in den
  // Einstellungen. Diese Route sagt, was gerade gilt.
  app.get(
    '/api/metal-prices/verkaufsaufschlag',
    {
      schema: {
        tags: ['metal-prices'],
        summary: 'Der Verkaufsaufschlag je Metall (ANTEIL, 0.12 = 12 Prozent).',
        description:
          'Der globale Wert plus die vier Metalle. Ein Metall ohne eigene ' +
          'Ausnahme erbt den globalen. Vorgabe ist 0: lieber der nackte ' +
          'Materialwert als ein erfundener Zuschlag.',
        response: { 200: VerkaufsaufschlagResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      const karte = await leseVerkaufsaufschlag(app.db);
      const [globalZeile] = await app.db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, VERKAUFSAUFSCHLAG_KEY));
      return reply.status(200).send({
        global: String(globalZeile?.value ?? '0').replace(/^"|"$/g, ''),
        gold: karte.get('gold') ?? '0',
        silver: karte.get('silver') ?? '0',
        platinum: karte.get('platinum') ?? '0',
        palladium: karte.get('palladium') ?? '0',
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/metal-prices/verkaufsaufschlag — der Inhaber setzt ihn
  // ────────────────────────────────────────────────────────────────────
  //
  // ⚠️ Dieselben zwei Riegel wie bei der Ankaufmarge daneben: nur der
  // Inhaber, und nur mit frischer Nachbestätigung. Ein Aufschlag ist der
  // Unterschied zwischen Gewinn und Verlust auf JEDEM Metallstück im
  // Laden; wer ihn ändern darf, ändert alle Preise auf einmal.
  app.patch<{ Body: TVerkaufsaufschlagBody }>(
    '/api/metal-prices/verkaufsaufschlag',
    {
      schema: {
        tags: ['metal-prices'],
        summary: 'Verkaufsaufschlag setzen (nur Inhaber, mit Nachbestätigung).',
        description:
          'aufschlagAnteil ist ein ANTEIL in [0, 1] — 0.12 sind zwölf Prozent. ' +
          'Werte darueber werden mit 400 abgewiesen: wer "12" statt "0.12" ' +
          'eintippt, soll keinen zehnfachen Preis bekommen. Die Aenderung ' +
          'wird ueber den system_settings-Auslöser ins Tagebuch geschrieben.',
        body: VerkaufsaufschlagBody,
        response: {
          200: VerkaufsaufschlagResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwner(req);

      const { metal, aufschlagAnteil } = req.body;
      const key = metal ? `${VERKAUFSAUFSCHLAG_KEY}.${metal}` : VERKAUFSAUFSCHLAG_KEY;
      const beschreibung = metal
        ? `Verkaufsaufschlag fuer ${metal} als ANTEIL (0.12 = 12 Prozent). Vom Inhaber gesetzt.`
        : 'Verkaufsaufschlag (global) als ANTEIL (0.12 = 12 Prozent). Vom Inhaber gesetzt.';

      await app.db
        .insert(systemSettings)
        .values({
          key,
          value: aufschlagAnteil,
          description: beschreibung,
          updatedByUserId: req.actor.id,
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: aufschlagAnteil, updatedByUserId: req.actor.id },
        });

      const karte = await leseVerkaufsaufschlag(app.db);
      const [globalZeile] = await app.db
        .select({ value: systemSettings.value })
        .from(systemSettings)
        .where(eq(systemSettings.key, VERKAUFSAUFSCHLAG_KEY));
      return reply.status(200).send({
        global: String(globalZeile?.value ?? '0').replace(/^"|"$/g, ''),
        gold: karte.get('gold') ?? '0',
        silver: karte.get('silver') ?? '0',
        platinum: karte.get('platinum') ?? '0',
        palladium: karte.get('palladium') ?? '0',
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/metal-prices/history
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TMetalPriceHistoryQuery }>(
    '/api/metal-prices/history',
    {
      schema: {
        tags: ['metal-prices'],
        summary: 'Paged metal-price history.',
        description:
          'Ordered DESC by valid_from. Filter by metal to narrow. ADMIN-only because ' +
          'the response carries the operator who issued each MANUAL override.',
        querystring: MetalPriceHistoryQuery,
        response: {
          200: MetalPriceHistoryResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      /*
       * ⚠️ 18.08.2026: hier stand `requireRole(req, 'ADMIN')`, begruendet mit
       * den Namen der Override-Bediener in der Antwort. Die Folge an Basels
       * Tresen: die Kursflaeche des KASSIERERS bekam 403, der Verlauf blieb
       * leer, und statt der echten Kurve sah er nur den Platzhalter — genau
       * sein Befund („der gebaute Puls").
       *
       * Der Override ist abgeschafft; die Begruendung traegt nur noch fuer
       * ALTE Zeilen. Deshalb: lesen darf jeder Angemeldete, die Bedienerfelder
       * bekommt weiterhin nur ADMIN (unten beim Abbilden).
       */
      const istAdmin = req.actor.role === 'ADMIN';

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;
      const whereClause = q.metal !== undefined ? eq(metalPrices.metal, q.metal) : undefined;

      const [rows, totalRow] = await Promise.all([
        app.db
          .select({
            id: metalPrices.id,
            metal: metalPrices.metal,
            pricePerGramEur: metalPrices.pricePerGramEur,
            source: metalPrices.source,
            validFrom: metalPrices.validFrom,
            validTo: metalPrices.validTo,
            fetchedAt: metalPrices.fetchedAt,
            manualOverrideByUserId: metalPrices.manualOverrideByUserId,
            manualOverrideReason: metalPrices.manualOverrideReason,
          })
          .from(metalPrices)
          .where(whereClause)
          .orderBy(desc(metalPrices.validFrom), asc(metalPrices.id))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(metalPrices).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id.toString(),
          metal: r.metal as MetalKind,
          pricePerGramEur: r.pricePerGramEur,
          source: r.source,
          validFrom: r.validFrom.toISOString(),
          validTo: r.validTo ? r.validTo.toISOString() : null,
          fetchedAt: r.fetchedAt.toISOString(),
          // Bedienerfelder alter Override-Zeilen: nur ADMIN. Der Kassierer
          // braucht die Kurve, nicht die Personalie.
          manualOverrideByUserId: istAdmin ? r.manualOverrideByUserId : null,
          manualOverrideReason: istAdmin ? r.manualOverrideReason : null,
        })),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/metal-prices — Owner MANUAL override
  // ────────────────────────────────────────────────────────────────────
  // ────────────────────────────────────────────────────────────────────
  // POST /api/metal-prices — ⚰️ der manuelle Kurs ist abgeschafft
  // ────────────────────────────────────────────────────────────────────
  //
  // ── BASELS ANWEISUNG VOM 18.08.2026 ──────────────────────────────────
  //
  //     „Ein Goldpreis wird nicht von Hand eingetragen. Verboten."
  //
  // Bis zu diesem Tag stand hier der Inhaber-Override: CURRENT-Zeile
  // schliessen, neue Zeile mit source=MANUAL, Kursband-Pruefung,
  // Tagebucheintrag. Das Band starb mit der Eingabe (Begruendung oben bei
  // der 11.08-Notiz); die Quellen-Uebernahme schuetzt SINNVOLL im Beipack. Er war sauber gebaut, und genau das war die Gefahr:
  // ein sauberer Weg, auf dem EIN Tippfehler jeden Ankaufpreis vergiftet.
  //
  // ⚠️ FOLGE, OFFEN GESAGT: faellt das Netz laenger aus als das
  // Hoechstalter des Kurses, gibt es KEINEN Ankaufsvorschlag mehr und
  // keinen Handgriff, ihn zu erzwingen. Bewusste Wahl des Inhabers:
  // lieber kein Vorschlag als ein getippter.
  //
  // Die Route bleibt registriert und antwortet mit 410 und einem Satz,
  // damit eine aeltere Kasse eine ANTWORT bekommt statt eines 404, das
  // wie „alter Server" aussaehe.
  app.post(
    '/api/metal-prices',
    {
      schema: {
        tags: ['metal-prices'],
        summary: 'Abgeschafft: der manuelle Kursoverride.',
        description:
          'Seit dem 18.08.2026 kommen Kurse ausschliesslich von der eingestellten ' +
          'Quelle. Diese Route antwortet dauerhaft mit 410.',
      },
    },
    async (req, reply) => {
      requireAuth(req);
      return reply.status(410).send({
        error: {
          code: 'MANUAL_PRICE_ABOLISHED',
          message:
            'Manuelle Kurse sind abgeschafft. Der Kurs kommt ausschliesslich von der ' +
            'eingestellten Quelle (Einstellungen, Kursquelle).',
        },
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/products/:id/valuation
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Params: TProductValuationParams }>(
    '/api/products/:id/valuation',
    {
      schema: {
        tags: ['metal-prices', 'products'],
        summary: 'Schmelzwert + collector_premium + suggested ask price.',
        description:
          'Returns NULL fields when the underlying data is missing (no metal, ' +
          'no weight, no fineness, or no current price for the metal). Math is ' +
          'computed by the SQL helper product_schmelzwert_eur() so it matches ' +
          'every other read of the same value.',
        params: ProductValuationParams,
        response: {
          200: ProductValuationResponse,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const productId = req.params.id;

      // Single round-trip: SELECT the product + helper output + current price.
      const rows = await app.db.execute<{
        id: string;
        metal: string | null;
        weight_grams: string | null;
        fineness_decimal: string | null;
        feingewicht_grams: string | null;
        collector_premium_eur: string | null;
        list_price_eur: string;
        current_price: string | null;
        schmelzwert: string | null;
        priced_at: Date | null;
      }>(drizzleSql`
      SELECT
        p.id,
        p.metal,
        p.weight_grams,
        p.fineness_decimal,
        p.feingewicht_grams,
        p.collector_premium_eur,
        p.list_price_eur,
        current_metal_price_eur_per_gram(p.metal)         AS current_price,
        product_schmelzwert_eur(p.id)                      AS schmelzwert,
        (SELECT valid_from FROM metal_prices
           WHERE metal = p.metal AND valid_to IS NULL
           LIMIT 1)                                        AS priced_at
      FROM products p
      WHERE p.id = ${productId}
      LIMIT 1`);

      const row = (
        rows as unknown as Array<{
          id: string;
          metal: string | null;
          weight_grams: string | null;
          fineness_decimal: string | null;
          feingewicht_grams: string | null;
          collector_premium_eur: string | null;
          list_price_eur: string;
          current_price: string | null;
          schmelzwert: string | null;
          priced_at: Date | null;
        }>
      )[0];

      if (!row) {
        throw new ProductNotFoundError(`Product ${productId} not found`);
      }

      // Derived figures — compute via Money so rounding matches the rest of the API.
      const schmelz = row.schmelzwert ? Money.parse(row.schmelzwert) : null;
      const premium = row.collector_premium_eur ? Money.parse(row.collector_premium_eur) : null;
      const list = Money.parse(row.list_price_eur);

      const suggested = schmelz && premium ? schmelz.add(premium).toString() : null;
      const marginOverScrap = schmelz ? list.subtract(schmelz).toString() : null;

      return reply.status(200).send({
        productId: row.id,
        metal: row.metal as MetalKind | null,
        weightGrams: row.weight_grams,
        finenessDecimal: row.fineness_decimal,
        feingewichtGrams: row.feingewicht_grams,
        currentPricePerGramEur: row.current_price,
        schmelzwertEur: row.schmelzwert,
        collectorPremiumEur: row.collector_premium_eur,
        suggestedAskPriceEur: suggested,
        listPriceEur: row.list_price_eur,
        marginOverScrapEur: marginOverScrap,
        pricedAt: row.priced_at ? new Date(row.priced_at).toISOString() : null,
      });
    },
  );
};

export default metalPricesRoutes;
