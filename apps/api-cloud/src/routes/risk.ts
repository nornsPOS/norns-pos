/**
 * Risk overview (Track E / B2) — the analytical read layer the risk surface needs.
 *
 * The detectors already fire (anomaly z-score, smurfing/structuring, cash-drawer
 * variance, sanctions/PEP, trust changes) but only ever emit `alert.*` ledger
 * events; there was no way to roll them up. This route aggregates:
 *   • alert counts by type over a trailing window + a recent-alert feed,
 *   • the customer watchlist (SUSPICIOUS / BANNED / sanctions / PEP).
 *
 * ADMIN-only, read-only. All figures are live from `ledger_events` + `customers`.
 */

import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireRole } from '../lib/auth-policy.js';

const WINDOW_DAYS = 30;

const riskRoutes: FastifyPluginAsync<{ env: Env }> = async (app) => {
  app.get(
    '/api/risk/overview',
    { schema: { tags: ['risk'], summary: 'Risk overview: alert rollup + customer watchlist.' } },
    async (req) => {
      requireRole(req, 'ADMIN');

      // Alert counts by type over the trailing window.
      const counts = await app.db.execute<{ event_type: string; n: number }>(drizzleSql`
        SELECT event_type, COUNT(*)::int AS n
          FROM ledger_events
         WHERE event_type LIKE 'alert.%'
           AND created_at >= now() - (${WINDOW_DAYS} || ' days')::interval
         GROUP BY event_type
         ORDER BY n DESC`);

      // Most-recent alerts (newest first).
      const recent = await app.db.execute<{
        id: string;
        event_type: string;
        created_at: Date | string;
      }>(drizzleSql`
        SELECT id, event_type, created_at
          FROM ledger_events
         WHERE event_type LIKE 'alert.%'
         ORDER BY id DESC
         LIMIT 20`);

      // Customer watchlist snapshot.
      const watchRows = await app.db.execute<{
        suspicious: number;
        banned: number;
        sanctions: number;
        pep: number;
      }>(drizzleSql`
        SELECT
          COUNT(*) FILTER (WHERE trust_level = 'SUSPICIOUS')::int AS suspicious,
          COUNT(*) FILTER (WHERE trust_level = 'BANNED')::int     AS banned,
          COUNT(*) FILTER (WHERE sanctions_match)::int            AS sanctions,
          COUNT(*) FILTER (WHERE pep_match)::int                  AS pep
        FROM customers
        WHERE soft_deleted_at IS NULL`);

      const alertCounts: Record<string, number> = {};
      let totalAlerts = 0;
      for (const r of counts) {
        alertCounts[r.event_type] = r.n;
        totalAlerts += r.n;
      }
      const w = watchRows[0] ?? { suspicious: 0, banned: 0, sanctions: 0, pep: 0 };

      return {
        windowDays: WINDOW_DAYS,
        totalAlerts,
        alertCounts,
        recentAlerts: recent.map((r) => ({
          id: r.id,
          eventType: r.event_type,
          createdAt:
            r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        })),
        watchlist: {
          suspicious: w.suspicious,
          banned: w.banned,
          sanctions: w.sanctions,
          pep: w.pep,
        },
      };
    },
  );

  // 14.08.2026: hier stand der Cloudflare-Randzweig /api/risk/edge. Der
  // Rand gehoerte zur Cloud-Welt von warehouse14; eine oertliche Kasse hat
  // keinen. Der Rest dieser Datei (Bargeld-Varianz, Sanktionen, PEP,
  // Vertrauensstufen) traegt das Geldwaeschegesetz und bleibt.

};

export default riskRoutes;
