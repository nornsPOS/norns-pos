/**
 * Owner Control Desktop — the Bridge KPI snapshot (ADR-0019 §1).
 *
 *   GET /api/bridge/summary   (ADMIN only)
 *
 * A compact cents-based view-model for the three-column Übersicht: today's
 * revenue/Ankauf, the four queues, the next appointment, and system health
 * (TSE cert headroom + worker DLQ) in one CTE round-trip.
 *
 * The earlier `/api/bridge/overview` aggregate (+ its Arabic Morning Briefing)
 * was removed 2026-06-07 as dead code: the live Übersicht consumes `/summary`
 * only, and the Control Desktop is German-only. See docs/memory.md §28.5 / §28.8.
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

// ── /api/bridge/summary — compact owner KPI snapshot (Task 7) ───────────────
// A flatter, cents-based view-model for the three-column Übersicht. Computed
// from the SAME real columns the rest of the app uses (transactions.total_eur,
// whatsapp_inbound_messages.handled_at, tse_clients.cert_valid_to,
// worker_job_dlq.acked_at) — only the wire contract is cents/camelCase.

const BridgeSummaryResponse = Type.Object({
  todayRevenueCents: Type.Integer(),
  todaySalesCount: Type.Integer(),
  todayAnkaufCount: Type.Integer(),
  todayAnkaufValueCents: Type.Integer(),
  // 19.08.2026: hier standen zwei Warteschlangen aus dem ausgebauten
  // Webshop-Erbe (Entwurfs-Zaehler unter fremdem Namen, ungelesene
  // Kanal-Nachrichten). Kein Bildschirm las sie; die Tabellen des zweiten
  // Zaehlers sind mit Wanderung 0149 ausgezogen.
  approvalsPending: Type.Integer(),
  nextAppointmentAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  todayAppointmentCount: Type.Integer(),
  tseCertDaysRemaining: Type.Union([Type.Integer(), Type.Null()]),
  workerDlqUnacked: Type.Integer(),
  systemStatus: Type.Union([Type.Literal('ok'), Type.Literal('watch'), Type.Literal('alert')]),
  computedAt: Type.String({ format: 'date-time' }),
});

export type TBridgeSummaryResponse = Static<typeof BridgeSummaryResponse>;

type SummaryRow = {
  today_revenue_cents: string | number;
  today_sales_count: number;
  today_ankauf_count: number;
  today_ankauf_value_cents: string | number;
  approvals_pending: number;
  next_appointment_at: Date | null;
  today_appointment_count: number;
  tse_cert_days_remaining: number | null;
  worker_dlq_unacked: number;
};

function deriveStatus(
  tseDays: number | null,
  dlq: number,
  approvals: number,
): 'ok' | 'watch' | 'alert' {
  if (tseDays !== null && tseDays < 7) return 'alert';
  if ((tseDays !== null && tseDays <= 30) || dlq > 0 || approvals > 0) return 'watch';
  return 'ok';
}

const bridgeRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/bridge/summary — compact cents-based KPI snapshot (Task 7) ────
  app.get(
    '/api/bridge/summary',
    {
      schema: {
        tags: ['bridge'],
        summary: 'Compact owner KPI snapshot for the three-column Übersicht. ADMIN only.',
        description:
          "Today's revenue/Ankauf (cents), the four queues, the next appointment, and " +
          'system health (TSE cert headroom + worker DLQ) in one CTE round-trip.',
        response: {
          200: BridgeSummaryResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const rows = (await app.db.execute<SummaryRow>(drizzleSql`
        WITH
          sales AS (
            SELECT COALESCE(SUM(total_eur), 0) AS revenue, COUNT(*)::int AS n
              FROM transactions
             WHERE direction = 'VERKAUF'
               AND storno_of_transaction_id IS NULL
               AND berlin_business_day(finalized_at) = berlin_business_day(now())
          ),
          ankauf AS (
            SELECT COALESCE(SUM(total_eur), 0) AS amount, COUNT(*)::int AS n
              FROM transactions
             WHERE direction = 'ANKAUF'
               AND storno_of_transaction_id IS NULL
               AND berlin_business_day(finalized_at) = berlin_business_day(now())
          ),
          approvals AS (
            SELECT COUNT(*)::int AS n FROM ledger_events e
             WHERE e.event_type = 'command.approval_requested'
               AND e.created_at > now() - interval '24 hours'
               AND NOT EXISTS (
                 SELECT 1 FROM ledger_events r
                  WHERE r.entity_id = e.entity_id
                    AND r.event_type IN ('command.dispatched', 'command.approval_resolved')
                    AND r.id > e.id
               )
          ),
          appt_next AS (
            SELECT starts_at
              FROM appointments
             WHERE starts_at > now()
               AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
             ORDER BY starts_at ASC
             LIMIT 1
          ),
          appt_today AS (
            SELECT COUNT(*)::int AS n FROM appointments
             WHERE berlin_business_day(starts_at) = berlin_business_day(now())
               AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
          ),
          tse AS (
            SELECT FLOOR(MIN(EXTRACT(EPOCH FROM (cert_valid_to - now()))) / 86400)::int AS days
              FROM tse_clients
          ),
          dlq AS (
            SELECT COUNT(*)::int AS n FROM worker_job_dlq WHERE acked_at IS NULL
          )
        SELECT
          (SELECT (revenue * 100)::bigint FROM sales)  AS today_revenue_cents,
          (SELECT n FROM sales)                        AS today_sales_count,
          (SELECT n FROM ankauf)                       AS today_ankauf_count,
          (SELECT (amount * 100)::bigint FROM ankauf)  AS today_ankauf_value_cents,
          (SELECT n FROM approvals)                    AS approvals_pending,
          (SELECT starts_at FROM appt_next)            AS next_appointment_at,
          (SELECT n FROM appt_today)                   AS today_appointment_count,
          (SELECT days FROM tse)                       AS tse_cert_days_remaining,
          (SELECT n FROM dlq)                          AS worker_dlq_unacked
      `)) as unknown as SummaryRow[];

      const r = rows[0];
      if (!r) {
        throw new Error('bridge summary returned no rows');
      }

      const tseCertDaysRemaining =
        r.tse_cert_days_remaining === null ? null : Number(r.tse_cert_days_remaining);
      const approvalsPending = Number(r.approvals_pending);
      const workerDlqUnacked = Number(r.worker_dlq_unacked);

      return reply.status(200).send({
        todayRevenueCents: Number(r.today_revenue_cents),
        todaySalesCount: Number(r.today_sales_count),
        todayAnkaufCount: Number(r.today_ankauf_count),
        todayAnkaufValueCents: Number(r.today_ankauf_value_cents),
        approvalsPending,
        nextAppointmentAt: r.next_appointment_at
          ? new Date(r.next_appointment_at).toISOString()
          : null,
        todayAppointmentCount: Number(r.today_appointment_count),
        tseCertDaysRemaining,
        workerDlqUnacked,
        systemStatus: deriveStatus(tseCertDaysRemaining, workerDlqUnacked, approvalsPending),
        computedAt: new Date().toISOString(),
      });
    },
  );
};

export default bridgeRoutes;
