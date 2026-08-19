/**
 * GET /api/ledger — paged + filtered read of ledger_events.
 *
 * The SSE feed (routes/sse-ledger.ts) is the live + replay path; this is
 * the "open the Tagebuch and scroll history" path. Same table, append-only.
 *
 * Filters:
 *   • eventType        — exact match (e.g. `transaction.finalized`)
 *   • actorUserId      — exact match
 *   • entityTable      — exact match
 *   • fromBusinessDay  — created_at >= ${date}   (inclusive)
 *   • toBusinessDay    — created_at <  ${date}+1 (inclusive day)
 *
 * Auth: ADMIN-only — surfaces actor + device id which are operator forensics.
 */

import { Type } from '@sinclair/typebox';
import { type SQL, and, count, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { ledgerEvents } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { ListLedgerQuery, ListLedgerResponse, type TListLedgerQuery } from '../schemas/ledger.js';

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

function toHex(buf: Uint8Array | null): string {
  if (!buf) return '';
  let out = '';
  for (const b of buf) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

const ledgerRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: TListLedgerQuery }>(
    '/api/ledger',
    {
      schema: {
        tags: ['ledger'],
        summary: 'Paged + filtered read of ledger_events (Tagebuch screen).',
        description:
          'Append-only. ADMIN-only because actor + device ids are surfaced. ' +
          'Filters: eventType / actorUserId / entityTable / fromBusinessDay / ' +
          'toBusinessDay. Live + reconnect-replay live on /api/sse/ledger.',
        querystring: ListLedgerQuery,
        response: {
          200: ListLedgerResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;

      const preds: Array<SQL | undefined> = [
        q.eventType !== undefined ? eq(ledgerEvents.eventType, q.eventType) : undefined,
        q.actorUserId !== undefined ? eq(ledgerEvents.actorUserId, q.actorUserId) : undefined,
        q.entityTable !== undefined ? eq(ledgerEvents.entityTable, q.entityTable) : undefined,
        q.fromBusinessDay !== undefined
          ? drizzleSql`${ledgerEvents.createdAt} >= ${q.fromBusinessDay}::date`
          : undefined,
        q.toBusinessDay !== undefined
          ? drizzleSql`${ledgerEvents.createdAt} < (${q.toBusinessDay}::date + interval '1 day')`
          : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      const [rows, totalRow] = await Promise.all([
        app.db
          .select({
            id: ledgerEvents.id,
            eventType: ledgerEvents.eventType,
            entityTable: ledgerEvents.entityTable,
            entityId: ledgerEvents.entityId,
            actorUserId: ledgerEvents.actorUserId,
            deviceId: ledgerEvents.deviceId,
            payload: ledgerEvents.payload,
            rowHash: ledgerEvents.rowHash,
            createdAt: ledgerEvents.createdAt,
          })
          .from(ledgerEvents)
          .where(whereClause)
          .orderBy(desc(ledgerEvents.id))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(ledgerEvents).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);
      return reply.status(200).send({
        items: rows.map((r) => ({
          id: Number(r.id),
          eventType: r.eventType,
          entityTable: r.entityTable,
          entityId: r.entityId,
          actorUserId: r.actorUserId,
          deviceId: r.deviceId,
          payload: r.payload,
          rowHashHex: toHex(r.rowHash),
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );
};

export default ledgerRoutes;
