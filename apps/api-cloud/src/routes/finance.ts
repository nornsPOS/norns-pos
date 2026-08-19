/**
 * Finance read aggregates — Owner OS P&L (migration 0075).
 *
 *   GET /api/finance/profit?period=day|month
 *   GET /api/finance/revenue?period=month
 *   GET /api/inventory/value
 *   GET /api/inventory/metal-weights
 *
 * Computed LIVE from the real `transactions` + `products` tables — no
 * materialized totals. Money crosses the wire as INTEGER CENTS (the finance
 * contract); EUR NUMERIC(18,2) values are converted with ROUND(x * 100).
 *
 * Net profit (period) = gross VERKAUF − gross ANKAUF − one-off expenses
 *                       − allocated fixed costs.
 *   • Storno rows carry negative totals, so SUM(total_eur) over a direction
 *     naturally nets cancelled sales/buys to zero — no special-casing.
 *   • Business-day grouping uses berlin_business_day(finalized_at), the same
 *     key the closings + dashboard use.
 *
 * Fixed-cost allocation:
 *   • period=month → every fixed_costs line whose [active_from, active_to]
 *     window overlaps the current calendar month contributes its full
 *     monthly_amount_cents.
 *   • period=day   → each overlapping line contributes monthly_amount_cents /
 *     days-in-current-month (the per-day share), summed then rounded.
 *
 * Auth: ADMIN only (Owner-facing financials). Read-only — no step-up needed.
 */

import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  ErrorResponse,
  InventoryValueResponse,
  MetalWeightsResponse,
  ProfitQuery,
  ProfitResponse,
  RevenueQuery,
  RevenueResponse,
  type TInventoryValueResponse,
  type TMetalWeightsResponse,
  type TProfitQuery,
  type TProfitResponse,
  type TRevenueResponse,
} from '../schemas/finance.js';

const financeRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/finance/profit?period=day|month
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TProfitQuery }>(
    '/api/finance/profit',
    {
      schema: {
        tags: ['finance'],
        summary: 'Net profit for the current day or month (cents).',
        description:
          'gross VERKAUF − gross ANKAUF − one-off expenses − allocated fixed costs. ' +
          'All figures integer cents. Storno rows net out automatically.',
        querystring: ProfitQuery,
        response: { 200: ProfitResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const period: 'day' | 'month' = req.query.period ?? 'day';

      // Transaction-day filter on berlin_business_day(finalized_at).
      const txDayFilter =
        period === 'day'
          ? drizzleSql`berlin_business_day(t.finalized_at) = current_date`
          : drizzleSql`date_trunc('month', berlin_business_day(t.finalized_at)) = date_trunc('month', current_date)`;

      // Expense-day filter on business_day.
      const exDayFilter =
        period === 'day'
          ? drizzleSql`e.business_day = current_date`
          : drizzleSql`date_trunc('month', e.business_day) = date_trunc('month', current_date)`;

      // Fixed-cost overlap with the current calendar month, scaled per period.
      // For period=day we take the per-day share (÷ days in current month).
      const monthStart = drizzleSql`date_trunc('month', current_date)::date`;
      const monthEnd = drizzleSql`(date_trunc('month', current_date) + interval '1 month - 1 day')::date`;
      const fixedScale =
        period === 'month'
          ? drizzleSql`1.0`
          : drizzleSql`(1.0 / EXTRACT(DAY FROM (date_trunc('month', current_date) + interval '1 month - 1 day')))`;

      const rows = await app.db.execute<{
        gross_revenue_cents: number;
        gross_ankauf_cents: number;
        expenses_cents: number;
        fixed_costs_allocated_cents: number;
      }>(drizzleSql`
        WITH
          rev AS (
            SELECT COALESCE(ROUND(SUM(t.total_eur) * 100), 0)::bigint AS c
              FROM transactions t
             WHERE t.direction = 'VERKAUF'
               AND ${txDayFilter}
          ),
          ank AS (
            SELECT COALESCE(ROUND(SUM(t.total_eur) * 100), 0)::bigint AS c
              FROM transactions t
             WHERE t.direction = 'ANKAUF'
               AND ${txDayFilter}
          ),
          exp AS (
            SELECT COALESCE(SUM(e.amount_cents), 0)::bigint AS c
              FROM operating_expenses e
             WHERE ${exDayFilter}
          ),
          fix AS (
            SELECT COALESCE(ROUND(SUM(f.monthly_amount_cents * ${fixedScale})), 0)::bigint AS c
              FROM fixed_costs f
             WHERE f.active_from <= ${monthEnd}
               AND (f.active_to IS NULL OR f.active_to >= ${monthStart})
          )
        SELECT
          (SELECT c FROM rev) AS gross_revenue_cents,
          (SELECT c FROM ank) AS gross_ankauf_cents,
          (SELECT c FROM exp) AS expenses_cents,
          (SELECT c FROM fix) AS fixed_costs_allocated_cents
      `);

      const r = (
        rows as unknown as Array<{
          gross_revenue_cents: number | string;
          gross_ankauf_cents: number | string;
          expenses_cents: number | string;
          fixed_costs_allocated_cents: number | string;
        }>
      )[0];

      const grossRevenueCents = Number(r?.gross_revenue_cents ?? 0);
      const grossAnkaufCents = Number(r?.gross_ankauf_cents ?? 0);
      const expensesCents = Number(r?.expenses_cents ?? 0);
      const fixedCostsAllocatedCents = Number(r?.fixed_costs_allocated_cents ?? 0);
      const netProfitCents =
        grossRevenueCents - grossAnkaufCents - expensesCents - fixedCostsAllocatedCents;

      const body: TProfitResponse = {
        period,
        grossRevenueCents,
        grossAnkaufCents,
        expensesCents,
        fixedCostsAllocatedCents,
        netProfitCents,
      };
      return reply.status(200).send(body);
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/finance/revenue?period=month
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/finance/revenue',
    {
      schema: {
        tags: ['finance'],
        summary: 'Month-to-date gross VERKAUF revenue (cents).',
        querystring: RevenueQuery,
        response: { 200: RevenueResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const rows = await app.db.execute<{ c: number }>(drizzleSql`
        SELECT COALESCE(ROUND(SUM(t.total_eur) * 100), 0)::bigint AS c
          FROM transactions t
         WHERE t.direction = 'VERKAUF'
           AND date_trunc('month', berlin_business_day(t.finalized_at))
             = date_trunc('month', current_date)
           AND berlin_business_day(t.finalized_at) <= current_date
      `);
      const c = Number((rows as unknown as Array<{ c: number | string }>)[0]?.c ?? 0);
      const body: TRevenueResponse = { monthToDateRevenueCents: c };
      return reply.status(200).send(body);
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/inventory/value
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/inventory/value',
    {
      schema: {
        tags: ['finance'],
        summary: 'On-hand inventory value: list + acquisition (cents) + count.',
        description:
          'On-hand stock = products in status AVAILABLE or RESERVED (unsold). ' +
          'listValue from list_price_eur, acquisitionValue from acquisition_cost_eur.',
        response: { 200: InventoryValueResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const rows = await app.db.execute<{
        list_value_cents: number;
        acquisition_value_cents: number;
        available_count: number;
      }>(drizzleSql`
        SELECT
          COALESCE(ROUND(SUM(p.list_price_eur) * 100), 0)::bigint        AS list_value_cents,
          COALESCE(ROUND(SUM(p.acquisition_cost_eur) * 100), 0)::bigint  AS acquisition_value_cents,
          COUNT(*)::int                                                  AS available_count
          FROM products p
         WHERE p.status IN ('AVAILABLE', 'RESERVED')
      `);
      const r = (
        rows as unknown as Array<{
          list_value_cents: number | string;
          acquisition_value_cents: number | string;
          available_count: number;
        }>
      )[0];

      const body: TInventoryValueResponse = {
        listValueCents: Number(r?.list_value_cents ?? 0),
        acquisitionValueCents: Number(r?.acquisition_value_cents ?? 0),
        availableCount: Number(r?.available_count ?? 0),
      };
      return reply.status(200).send(body);
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/inventory/metal-weights
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/inventory/metal-weights',
    {
      schema: {
        tags: ['finance'],
        summary: 'On-hand fine-metal weight (grams) per metal.',
        description:
          'Σ feingewicht_grams (weight_grams × fineness_decimal) of on-hand stock ' +
          '(AVAILABLE + RESERVED), grouped by products.metal.',
        response: { 200: MetalWeightsResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const rows = await app.db.execute<{
        gold: number;
        silver: number;
        platinum: number;
        palladium: number;
      }>(drizzleSql`
        SELECT
          COALESCE(SUM(p.feingewicht_grams) FILTER (WHERE p.metal = 'gold'), 0)::float8      AS gold,
          COALESCE(SUM(p.feingewicht_grams) FILTER (WHERE p.metal = 'silver'), 0)::float8    AS silver,
          COALESCE(SUM(p.feingewicht_grams) FILTER (WHERE p.metal = 'platinum'), 0)::float8  AS platinum,
          COALESCE(SUM(p.feingewicht_grams) FILTER (WHERE p.metal = 'palladium'), 0)::float8 AS palladium
          FROM products p
         WHERE p.status IN ('AVAILABLE', 'RESERVED')
           AND p.feingewicht_grams IS NOT NULL
      `);
      const r = (
        rows as unknown as Array<{
          gold: number | string;
          silver: number | string;
          platinum: number | string;
          palladium: number | string;
        }>
      )[0];

      const body: TMetalWeightsResponse = {
        goldGrams: Number(r?.gold ?? 0),
        silverGrams: Number(r?.silver ?? 0),
        platinumGrams: Number(r?.platinum ?? 0),
        palladiumGrams: Number(r?.palladium ?? 0),
      };
      return reply.status(200).send(body);
    },
  );
};

export default financeRoutes;
