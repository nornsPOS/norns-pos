/**
 * GET /api/transactions/recent — the cashier's recent VERKAUF sales, so a
 * mistaken ring can be stornoed AFTER the post-finalize screen was dismissed
 * (the immediate Storno only covers the just-finalized sale). Last 24h, newest
 * first, capped. CASHIER/ADMIN. Read-only; the storno itself is the existing
 * POST /api/transactions/storno (verlangt den Geraetecode).
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

const RecentItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  receiptLocator: Type.String(),
  totalEur: Type.String(),
  finalizedAt: Type.String({ format: 'date-time' }),
  isStorno: Type.Boolean(),
  alreadyStornoed: Type.Boolean(),
});
const RecentResponse = Type.Object({ items: Type.Array(RecentItem) });

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

type Row = {
  id: string;
  receipt_locator: string;
  total_eur: string;
  finalized_at: Date;
  is_storno: boolean;
  already_stornoed: boolean;
};

const transactionsRecentRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/transactions/recent',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Recent VERKAUF sales for late storno (CASHIER/ADMIN).',
        response: { 200: RecentResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const rows = (await app.db.execute<Row>(sql`
        SELECT t.id::text AS id,
               t.receipt_locator,
               t.total_eur::text AS total_eur,
               t.finalized_at,
               (t.storno_of_transaction_id IS NOT NULL) AS is_storno,
               EXISTS (
                 SELECT 1 FROM transactions s WHERE s.storno_of_transaction_id = t.id
               ) AS already_stornoed
          FROM transactions t
         WHERE t.direction = 'VERKAUF'
           AND t.finalized_at >= now() - interval '24 hours'
         ORDER BY t.finalized_at DESC
         LIMIT 30
      `)) as unknown as Row[];

      return reply.status(200).send({
        items: rows.map((r) => ({
          id: r.id,
          receiptLocator: r.receipt_locator,
          totalEur: r.total_eur,
          finalizedAt: new Date(r.finalized_at).toISOString(),
          isStorno: r.is_storno,
          alreadyStornoed: r.already_stornoed,
        })),
      });
    },
  );
};

export default transactionsRecentRoute;
