/**
 * fixed_costs CRUD — recurring monthly Fixkosten (migration 0075).
 *
 *   GET   /api/fixed-costs          — list (activeOnly filter, paged)
 *   POST  /api/fixed-costs          — create  (ADMIN + audit)
 *   PATCH /api/fixed-costs/:id        — edit    (ADMIN + audit)
 *
 * Mutating routes mirror the house pattern: requireAuth → requireRole(ADMIN)
 * → write + audit_log row in ONE transaction. Money is
 * INTEGER CENTS end-to-end.
 *
 * No DELETE: a cost line is retired by setting `active_to` (PATCH) so past
 * months keep their allocation. The DB CHECK enforces active_to >= active_from.
 */

import { type SQL, and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, fixedCosts } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CreateFixedCostBody,
  ErrorResponse,
  FixedCostIdParams,
  ListFixedCostsQuery,
  ListFixedCostsResponse,
  type TCreateFixedCostBody,
  type TFixedCostIdParams,
  type TListFixedCostsQuery,
  type TUpdateFixedCostBody,
  UpdateFixedCostBody,
} from '../schemas/finance.js';

class FixedCostNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class FixedCostValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

type FixedCostRowDb = typeof fixedCosts.$inferSelect;

function serialize(row: FixedCostRowDb): Record<string, unknown> {
  return {
    id: row.id,
    label: row.label,
    monthlyAmountCents: row.monthlyAmountCents,
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const fixedCostsRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/fixed-costs
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TListFixedCostsQuery }>(
    '/api/fixed-costs',
    {
      schema: {
        tags: ['finance'],
        summary: 'List recurring fixed costs (paged).',
        querystring: ListFixedCostsQuery,
        response: { 200: ListFixedCostsResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;

      const preds: Array<SQL | undefined> = [
        q.activeOnly === true ? isNull(fixedCosts.activeTo) : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(fixedCosts)
          .where(whereClause)
          .orderBy(desc(fixedCosts.activeFrom), desc(fixedCosts.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(fixedCosts).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);
      return reply.status(200).send({
        items: rows.map(serialize),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/fixed-costs
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TCreateFixedCostBody }>(
    '/api/fixed-costs',
    {
      schema: {
        tags: ['finance'],
        summary: 'Add a recurring fixed cost line.',
        description: 'ADMIN. Records the actor + delta to audit_log.',
        body: CreateFixedCostBody,
        response: {
          200: ListFixedCostsResponse.properties.items.items,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const body = req.body;

      // Friendly 400 before the DB CHECK fires.
      if (body.activeTo != null && body.activeTo < body.activeFrom) {
        throw new FixedCostValidationError('activeTo must be on or after activeFrom');
      }

      const row = await app.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(fixedCosts)
          .values({
            label: body.label,
            monthlyAmountCents: body.monthlyAmountCents,
            activeFrom: body.activeFrom,
            activeTo: body.activeTo ?? null,
          })
          .returning();
        if (!inserted) throw new Error('fixed_costs INSERT returned no row');

        await tx.insert(auditLog).values({
          eventType: 'fixed_cost.created',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            fixedCostId: inserted.id,
            label: inserted.label,
            monthlyAmountCents: inserted.monthlyAmountCents,
            activeFrom: inserted.activeFrom,
            activeTo: inserted.activeTo,
          },
        });
        return inserted;
      });

      return reply.status(200).send(serialize(row));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/fixed-costs/:id
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TFixedCostIdParams; Body: TUpdateFixedCostBody }>(
    '/api/fixed-costs/:id',
    {
      schema: {
        tags: ['finance'],
        summary: 'Edit a fixed cost line (retire it by setting activeTo).',
        description: 'ADMIN. Records actor + before/after to audit_log.',
        params: FixedCostIdParams,
        body: UpdateFixedCostBody,
        response: {
          200: ListFixedCostsResponse.properties.items.items,
          400: ErrorResponse,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const updates: Partial<typeof fixedCosts.$inferInsert> = {};
      if (req.body.label !== undefined) updates.label = req.body.label;
      if (req.body.monthlyAmountCents !== undefined)
        updates.monthlyAmountCents = req.body.monthlyAmountCents;
      if (req.body.activeFrom !== undefined) updates.activeFrom = req.body.activeFrom;
      if (req.body.activeTo !== undefined) updates.activeTo = req.body.activeTo;

      if (Object.keys(updates).length === 0) {
        throw new FixedCostValidationError('no editable fields provided');
      }

      const row = await app.db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(fixedCosts)
          .where(eq(fixedCosts.id, req.params.id))
          .limit(1);
        if (!before) throw new FixedCostNotFoundError(`Fixed cost ${req.params.id} not found`);

        // Validate the resulting range against the (possibly updated) bounds.
        const nextFrom = updates.activeFrom ?? before.activeFrom;
        const nextTo = updates.activeTo !== undefined ? updates.activeTo : before.activeTo;
        if (nextTo != null && nextTo < nextFrom) {
          throw new FixedCostValidationError('activeTo must be on or after activeFrom');
        }

        const [updated] = await tx
          .update(fixedCosts)
          .set(updates)
          .where(eq(fixedCosts.id, req.params.id))
          .returning();
        if (!updated) throw new FixedCostNotFoundError(`Fixed cost ${req.params.id} not found`);

        await tx.insert(auditLog).values({
          eventType: 'fixed_cost.updated',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            fixedCostId: updated.id,
            before: {
              label: before.label,
              monthlyAmountCents: before.monthlyAmountCents,
              activeFrom: before.activeFrom,
              activeTo: before.activeTo,
            },
            after: {
              label: updated.label,
              monthlyAmountCents: updated.monthlyAmountCents,
              activeFrom: updated.activeFrom,
              activeTo: updated.activeTo,
            },
          },
        });
        return updated;
      });

      return reply.status(200).send(serialize(row));
    },
  );
};

export default fixedCostsRoutes;
