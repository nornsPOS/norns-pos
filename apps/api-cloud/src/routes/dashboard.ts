/**
 * Dashboard summary aggregator (Phase 2 Day 2).
 *
 *   GET /api/dashboard/summary
 *
 * Single round-trip endpoint feeding the Werkstatt + Übersicht tiles on
 * tauri-pos + desktop-control. Replaces 8+ separate fetches per dashboard
 * render. Tuned for "fast first paint" — every sub-query is either a
 * partial-index hit (status='OPEN' / valid_to IS NULL) or a 1-row scan
 * (`worker_job_runs LIMIT 1`).
 *
 * Auth: ADMIN + CASHIER. The shape is identical for both roles; counters
 * the cashier doesn't have permission to act on still appear (read-only).
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

const DashboardSummaryResponse = Type.Object({
  /** Tasks assigned to req.actor with status IN (OPEN, IN_PROGRESS, BLOCKED). */
  openTasksMine: Type.Integer(),
  /** Tasks (any assignee) with status IN (OPEN, IN_PROGRESS) and due_date ≤ today. */
  tasksDueToday: Type.Integer(),
  /** Tasks past their due_date that are still not DONE. */
  tasksOverdue: Type.Integer(),

  /** Appraisals with status IN ('DRAFT','COMPLETED') — awaiting Owner decision. */
  pendingAppraisals: Type.Integer(),

  /** Photos still awaiting assignment (orphan + workflow_state < ZUGEORDNET). */
  unassignedPhotos: Type.Integer(),

  // 14.08.2026: hier standen ebayPipelineDepth + ebayConflictsWeek. Der
  // eBay-Ausbau (0.4.0) hat jeden SCHREIBER entfernt — die Zaehler waren
  // Dauernullen ueber einer Welt, die es nicht mehr gibt. Alte
  // alert.ebay_sale_conflict-Zeilen im Tagebuch bleiben lesbar (i18n-Vokabular
  // besteht weiter); nur die lebende Anzeige ist weg.

  /** Current shift id (NULL when no shift open on this device). */
  currentShiftId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  /** Sum of finalized transaction totals on the open shift, EUR. */
  currentShiftRevenueEur: Type.String(),
  /**
   * Die BAR-Bewegung der offenen Schicht, in EUR: Verkäufe hinein,
   * Ankauf-Auszahlungen hinaus, Einlagen hinein, Abschöpfungen und
   * Tresortransit hinaus — dieselben Bein-Familien, die der Kassensturz
   * rechnet (shifts.ts), nur ohne dessen Altlast-Zweig für Stornos ohne
   * Schicht.
   *
   * ⚠️ `currentShiftRevenueEur` daneben ist der GESAMTE Umsatz und taugt
   * nicht für den erwarteten Ladenbestand: er zählt Kartenzahlung mit.
   *
   * 15.08.2026 (0.6.0 Spur E): bis gestern fehlte hier der Barankauf, bis
   * heute fehlten Einlagen und Entnahmen — die Tageskasse log nach jeder
   * dieser Bewegungen um deren volle Höhe, während der Kassensturz längst
   * richtig rechnete. Der halbe Fix an derselben Ampel, zweimal.
   */
  currentShiftBarEur: Type.String(),

  /** Customers in trust_level IN ('SUSPICIOUS','BANNED'). */
  watchlistCustomerCount: Type.Integer(),

  /** Worker daemons that have a RUNNING row right now (no SUCCESS terminal yet). */
  workerJobsRunning: Type.Array(Type.String()),
  /** ISO timestamp of the most recent chain-verifier SUCCESS, or null. */
  lastChainVerifiedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** Worker DLQ rows that have not been acknowledged. */
  workerDlqUnacked: Type.Integer(),

  /** Current metal prices keyed by metal — null entries when no row recorded. */
  currentMetalPrices: Type.Object({
    gold: Type.Union([Type.String(), Type.Null()]),
    silver: Type.Union([Type.String(), Type.Null()]),
    platinum: Type.Union([Type.String(), Type.Null()]),
    palladium: Type.Union([Type.String(), Type.Null()]),
  }),

  /** When the snapshot was assembled (server time). */
  computedAt: Type.String({ format: 'date-time' }),
});

export type TDashboardSummaryResponse = Static<typeof DashboardSummaryResponse>;

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/dashboard/summary',
    {
      schema: {
        tags: ['dashboard'],
        summary: 'Aggregate counters for the Werkstatt + Übersicht tiles.',
        description:
          'One round-trip replaces the 10+ fetches a dashboard would otherwise need. ' +
          'Every sub-query targets a partial index or a single-row aggregate.',
        response: { 200: DashboardSummaryResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // One big read transaction — gives all sub-queries the same snapshot.
      const rows = await app.db.execute<{
        open_tasks_mine: number;
        tasks_due_today: number;
        tasks_overdue: number;
        pending_appraisals: number;
        unassigned_photos: number;
        current_shift_id: string | null;
        current_shift_revenue_eur: string;
        current_shift_bar_eur: string;
        watchlist_customer_count: number;
        worker_jobs_running: string[];
        last_chain_verified_at: Date | null;
        worker_dlq_unacked: number;
        gold: string | null;
        silver: string | null;
        platinum: string | null;
        palladium: string | null;
      }>(drizzleSql`
      WITH
        t_mine AS (
          SELECT COUNT(*)::int AS n FROM internal_tasks
           WHERE assigned_to_user_id = ${actorId}
             AND status IN ('OPEN','IN_PROGRESS','BLOCKED')
        ),
        t_due_today AS (
          SELECT COUNT(*)::int AS n FROM internal_tasks
           WHERE status IN ('OPEN','IN_PROGRESS')
             AND due_date IS NOT NULL
             AND due_date <= current_date
        ),
        t_overdue AS (
          SELECT COUNT(*)::int AS n FROM internal_tasks
           WHERE status IN ('OPEN','IN_PROGRESS','BLOCKED')
             AND due_date IS NOT NULL
             AND due_date < current_date
        ),
        appr AS (
          SELECT COUNT(*)::int AS n FROM appraisals
           WHERE status IN ('DRAFT','COMPLETED')
        ),
        photos_un AS (
          SELECT COUNT(*)::int AS n FROM product_photos
           WHERE product_id IS NULL
             AND workflow_state IN ('FOTOGRAFIERT','BEARBEITET','FREIGESTELLT')
        ),
        current_shift AS (
          SELECT id FROM shifts
           WHERE status = 'OPEN'
             ${
               // Filter to the calling device when known so cashiers see THEIR shift.
               deviceId ? drizzleSql`AND device_id = ${deviceId}::uuid` : drizzleSql``
             }
           ORDER BY opened_at DESC LIMIT 1
        ),
        shift_rev AS (
          -- ⚠️ 14.08.2026, Begehung 0.6.0: hier stand zusaetzlich
          -- storno_of_transaction_id IS NULL. Damit zaehlte der Umsatz das
          -- PLUS eines Verkaufs, aber nicht das MINUS seiner Stornierung:
          -- nach Verkauf (499) und Storno (-499) zeigte die Werkstatt-
          -- Fusszeile 499,00 EUR fuer eine Schicht, deren wahrer Umsatz
          -- 0,00 EUR war (gemessen, RCP-2026-000001/-000002). Das Storno-
          -- Bein traegt dieselbe Richtung VERKAUF mit negativem Betrag,
          -- die blosse Summe ist also bereits der ehrliche Nettoumsatz.
          -- shift_bar darunter zaehlte die Beine schon immer mit.
          SELECT COALESCE(SUM(t.total_eur), 0)::text AS s
            FROM transactions t
            JOIN current_shift cs ON cs.id = t.shift_id
           WHERE t.direction = 'VERKAUF'
        ),
        shift_bar AS (
          -- ⚠️ 09.08.2026: NUR die BAREN Beine der Verkaeufe dieser Schicht.
          --
          -- ⚠️ KEINE Rueckwaerts-Anfuehrungszeichen in diesem Kommentar. Das
          -- SQL steht in einer JS-Schablonenzeichenkette; ein einziges davon
          -- beendet sie und der Uebersetzer bricht ab. Heute zum vierten Mal.
          --
          -- shift_rev oben zaehlt den GESAMTEN Umsatz, gleich womit bezahlt
          -- wurde. Das Kassenbuch rechnete damit den erwarteten Bestand der
          -- Lade. Nach einem Kartentag von 2.000 EUR suchte der Kassierer
          -- also 2.000 EUR, die nie in der Lade waren.
          --
          -- shift_rev bleibt unangetastet: die Zahl wird auch von der
          -- Werkstatt und der Inhaber-App gelesen, und ihre Bedeutung still
          -- zu aendern waere ein Umbau in zwei fremden Flaechen.
          --
          -- ⚠️ OHNE Stornoausschluss: das negative Bein einer Stornierung
          -- SOLL die Lade mindern, genau wie im Laden.
          --
          -- ⚠️ 14.08.2026, Begehung 0.6.0: hier stand zusaetzlich
          -- t.direction = 'VERKAUF'. Damit fehlte die ANKAUF-Barauszahlung:
          -- nach Ankauf 120 bar und Verkauf 240 bar zeigte die Tageskasse
          -- einen erwarteten Bestand von 440 statt 320 (gemessen; der
          -- kanonische Schichtschluss rechnete laengst richtig, nur diese
          -- Schaetzung log). Jetzt zaehlt jedes Bar-Bein mit Vorzeichen je
          -- Richtung: Verkauf hinein, Ankauf hinaus; Stornos tragen ihr
          -- Minus schon selbst und drehen sich damit von allein richtig.
          SELECT COALESCE(SUM(
            CASE WHEN t.direction = 'VERKAUF' THEN tp.amount_eur
                 ELSE -tp.amount_eur END), 0) AS s
            FROM transaction_payments tp
            JOIN transactions t ON t.id = tp.transaction_id
            JOIN current_shift cs ON cs.id = t.shift_id
           WHERE tp.payment_method = 'CASH'::payment_method
        ),
        shift_moves AS (
          -- ⚠️ 15.08.2026 (0.6.0 Spur E): das DRITTE Bein derselben Ampel.
          -- Der Kassensturz (shifts.ts) rechnet Einlagen PLUS, Abschoepfung
          -- und Tresortransit MINUS; diese Schaetzung liess alle drei weg.
          -- Nach einer Entnahme von 100 suchte die Tageskasse also 100, die
          -- laengst im Tresor lagen. Gestern fehlte hier der Barankauf,
          -- heute die Bewegungen: wer eine Grosse an zwei Stellen rechnet,
          -- muss BEIDE Stellen aus derselben Formel speisen.
          SELECT COALESCE(SUM(
            CASE WHEN cm.direction = 'INJECTION' THEN cm.amount_eur
                 ELSE -cm.amount_eur END), 0) AS s
            FROM cash_movements cm
            JOIN current_shift cs ON cs.id = cm.shift_id
        ),
        watchlist AS (
          SELECT COUNT(*)::int AS n FROM customers
           WHERE soft_deleted_at IS NULL
             AND trust_level IN ('SUSPICIOUS','BANNED')
        ),
        wj_running AS (
          SELECT COALESCE(array_agg(DISTINCT job_name), ARRAY[]::text[]) AS arr
            FROM worker_job_runs
           WHERE status = 'RUNNING'
        ),
        wj_chain AS (
          SELECT MAX(finished_at) AS t FROM worker_job_runs
           WHERE job_name = 'chain_verifier'
             AND status = 'SUCCESS'
        ),
        wj_dlq AS (
          SELECT COUNT(*)::int AS n FROM worker_job_dlq
           WHERE acked_at IS NULL
        ),
        metal_gold      AS (SELECT current_metal_price_eur_per_gram('gold')::text      AS v),
        metal_silver    AS (SELECT current_metal_price_eur_per_gram('silver')::text    AS v),
        metal_platinum  AS (SELECT current_metal_price_eur_per_gram('platinum')::text  AS v),
        metal_palladium AS (SELECT current_metal_price_eur_per_gram('palladium')::text AS v)
      SELECT
        (SELECT n FROM t_mine)              AS open_tasks_mine,
        (SELECT n FROM t_due_today)         AS tasks_due_today,
        (SELECT n FROM t_overdue)           AS tasks_overdue,
        (SELECT n FROM appr)                AS pending_appraisals,
        (SELECT n FROM photos_un)           AS unassigned_photos,
        (SELECT id::text FROM current_shift) AS current_shift_id,
        (SELECT s FROM shift_rev)           AS current_shift_revenue_eur,
        ((SELECT s FROM shift_bar) + (SELECT s FROM shift_moves))::text
                                            AS current_shift_bar_eur,
        (SELECT n FROM watchlist)           AS watchlist_customer_count,
        (SELECT arr FROM wj_running)        AS worker_jobs_running,
        (SELECT t FROM wj_chain)            AS last_chain_verified_at,
        (SELECT n FROM wj_dlq)              AS worker_dlq_unacked,
        (SELECT v FROM metal_gold)          AS gold,
        (SELECT v FROM metal_silver)        AS silver,
        (SELECT v FROM metal_platinum)      AS platinum,
        (SELECT v FROM metal_palladium)     AS palladium
    `);

      const r = (
        rows as unknown as Array<{
          open_tasks_mine: number;
          tasks_due_today: number;
          tasks_overdue: number;
          pending_appraisals: number;
          unassigned_photos: number;
          current_shift_id: string | null;
          current_shift_revenue_eur: string;
        current_shift_bar_eur: string;
          watchlist_customer_count: number;
          worker_jobs_running: string[];
          last_chain_verified_at: Date | null;
          worker_dlq_unacked: number;
          gold: string | null;
          silver: string | null;
          platinum: string | null;
          palladium: string | null;
        }>
      )[0];

      if (!r) {
        throw new Error('dashboard summary returned no rows');
      }

      return reply.status(200).send({
        openTasksMine: Number(r.open_tasks_mine ?? 0),
        tasksDueToday: Number(r.tasks_due_today ?? 0),
        tasksOverdue: Number(r.tasks_overdue ?? 0),
        pendingAppraisals: Number(r.pending_appraisals ?? 0),
        unassignedPhotos: Number(r.unassigned_photos ?? 0),
        currentShiftId: r.current_shift_id,
        currentShiftRevenueEur: r.current_shift_revenue_eur ?? '0',
        currentShiftBarEur: r.current_shift_bar_eur ?? '0',
        watchlistCustomerCount: Number(r.watchlist_customer_count ?? 0),
        workerJobsRunning: Array.isArray(r.worker_jobs_running) ? r.worker_jobs_running : [],
        lastChainVerifiedAt: r.last_chain_verified_at
          ? new Date(r.last_chain_verified_at).toISOString()
          : null,
        workerDlqUnacked: Number(r.worker_dlq_unacked ?? 0),
        currentMetalPrices: {
          gold: r.gold,
          silver: r.silver,
          platinum: r.platinum,
          palladium: r.palladium,
        },
        computedAt: new Date().toISOString(),
      });
    },
  );
};

export default dashboardRoutes;
