/**
 * Internal-tasks routes — Single-Operator Assistance (Day 25).
 *
 *   POST   /api/tasks                  — create; auto-fills assignee + creator
 *   GET    /api/tasks                  — list with filters
 *   GET    /api/tasks/:id              — single row
 *   PATCH  /api/tasks/:id              — edit metadata
 *   PATCH  /api/tasks/:id/status       — validated state-machine transitions
 *
 * Auto-fill rule (lib/auto-fill.ts):
 *   • `createdByUserId` is ALWAYS `req.actor.id` — never overridable
 *   • `assignedToUserId` defaults to `req.actor.id` if body omits it
 *
 * The DB lifecycle CHECKs (migration 0023) guarantee server-side
 * consistency even if the route validator misses an edge case. The
 * route's job is to set started_at / completed_at / cancelled_at at
 * the right moments and surface clean 4xx errors.
 */

import { Type } from '@sinclair/typebox';
import { type SQL, and, asc, count, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { internalTasks } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { resolveTaskAssignment } from '../lib/auto-fill.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CreateTaskBody,
  CreateTaskResponse,
  GetTaskResponse,
  ListTasksQuery,
  ListTasksResponse,
  type TCreateTaskBody,
  type TListTasksQuery,
  type TTaskIdParams,
  type TTransitionTaskStatusBody,
  type TUpdateTaskBody,
  TaskIdParams,
  TransitionTaskStatusBody,
  UpdateTaskBody,
} from '../schemas/tasks.js';

class TaskNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class TaskValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class IllegalTransitionError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

/**
 * State-machine transition table. Mirrors the DB CHECK constraints; the
 * route uses this to reject illegal transitions with a clean 409 before
 * the DB ever sees the UPDATE.
 */
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  OPEN: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

type TaskRowDb = typeof internalTasks.$inferSelect;

function serializeTask(row: TaskRowDb): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assignedToUserId: row.assignedToUserId,
    createdByUserId: row.createdByUserId,
    dueDate: row.dueDate,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancellationReason: row.cancellationReason,
    relatedEntityTable: row.relatedEntityTable,
    relatedEntityId: row.relatedEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const tasksRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // POST /api/tasks
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TCreateTaskBody }>(
    '/api/tasks',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Create an internal task (assignee auto-filled from actor).',
        description:
          'Single-Operator mode (V1): if `assignedToUserId` is omitted, the task ' +
          'is assigned to the current actor. `createdByUserId` is always the actor.',
        body: CreateTaskBody,
        response: {
          200: CreateTaskResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;

      // Polymorphic link both-or-none — DB CHECK will also enforce, but a
      // route-level 400 is friendlier than a 500.
      if ((body.relatedEntityTable == null) !== (body.relatedEntityId == null)) {
        throw new TaskValidationError(
          'relatedEntityTable and relatedEntityId must be both set or both omitted',
        );
      }

      const { assignedToUserId, createdByUserId } = resolveTaskAssignment(req, body);

      const [row] = await app.db
        .insert(internalTasks)
        .values({
          title: body.title,
          description: body.description ?? null,
          priority: body.priority ?? 'NORMAL',
          status: 'OPEN',
          assignedToUserId,
          createdByUserId,
          dueDate: body.dueDate ?? null,
          relatedEntityTable: body.relatedEntityTable ?? null,
          relatedEntityId: body.relatedEntityId ?? null,
        })
        .returning();
      if (!row) throw new Error('internal_tasks INSERT returned no row');

      return reply.status(200).send(serializeTask(row));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/tasks
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TListTasksQuery }>(
    '/api/tasks',
    {
      schema: {
        tags: ['tasks'],
        summary: 'List tasks (paged, filtered).',
        querystring: ListTasksQuery,
        response: { 200: ListTasksResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;
      const assigneeFilter = q.mineOnly ? req.actor.id : q.assignedToUserId;

      const preds: Array<SQL | undefined> = [
        q.status !== undefined ? eq(internalTasks.status, q.status) : undefined,
        q.priority !== undefined ? eq(internalTasks.priority, q.priority) : undefined,
        assigneeFilter !== undefined
          ? eq(internalTasks.assignedToUserId, assigneeFilter)
          : undefined,
        q.dueWithinDays !== undefined
          ? drizzleSql`${internalTasks.dueDate} IS NOT NULL
                     AND ${internalTasks.dueDate} <= (current_date + ${q.dueWithinDays}::int * interval '1 day')`
          : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(internalTasks)
          .where(whereClause)
          .orderBy(
            desc(internalTasks.priority),
            asc(internalTasks.dueDate),
            desc(internalTasks.createdAt),
          )
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(internalTasks).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);
      return reply.status(200).send({
        items: rows.map(serializeTask),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/tasks/:id
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Params: TTaskIdParams }>(
    '/api/tasks/:id',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Fetch a single task.',
        params: TaskIdParams,
        response: {
          200: GetTaskResponse,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const [row] = await app.db
        .select()
        .from(internalTasks)
        .where(eq(internalTasks.id, req.params.id))
        .limit(1);
      if (!row) throw new TaskNotFoundError(`Task ${req.params.id} not found`);
      return reply.status(200).send(serializeTask(row));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/tasks/:id  (edit metadata, NOT status)
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TTaskIdParams; Body: TUpdateTaskBody }>(
    '/api/tasks/:id',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Edit task metadata (title, description, priority, assignee, dueDate).',
        description:
          'Status transitions go through PATCH /api/tasks/:id/status — this endpoint refuses status changes.',
        params: TaskIdParams,
        body: UpdateTaskBody,
        response: {
          200: GetTaskResponse,
          404: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const updates: Partial<typeof internalTasks.$inferInsert> = {};
      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.priority !== undefined) updates.priority = req.body.priority;
      if (req.body.assignedToUserId !== undefined)
        updates.assignedToUserId = req.body.assignedToUserId;
      if (req.body.dueDate !== undefined) updates.dueDate = req.body.dueDate;

      if (Object.keys(updates).length === 0) {
        throw new TaskValidationError('no editable fields provided');
      }

      const [row] = await app.db
        .update(internalTasks)
        .set(updates)
        .where(eq(internalTasks.id, req.params.id))
        .returning();
      if (!row) throw new TaskNotFoundError(`Task ${req.params.id} not found`);
      return reply.status(200).send(serializeTask(row));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/tasks/:id/status
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TTaskIdParams; Body: TTransitionTaskStatusBody }>(
    '/api/tasks/:id/status',
    {
      schema: {
        tags: ['tasks'],
        summary: 'Transition task status with state-machine validation.',
        params: TaskIdParams,
        body: TransitionTaskStatusBody,
        response: {
          200: GetTaskResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const next = req.body.status;
      if (
        next === 'CANCELLED' &&
        (!req.body.cancellationReason || req.body.cancellationReason.length < 4)
      ) {
        throw new TaskValidationError(
          'cancellationReason (≥ 4 chars) required when status=CANCELLED',
        );
      }

      // Read current state inside a transaction so the transition check is atomic.
      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: internalTasks.id,
            status: internalTasks.status,
            startedAt: internalTasks.startedAt,
          })
          .from(internalTasks)
          .where(eq(internalTasks.id, req.params.id))
          .limit(1);
        if (!current) throw new TaskNotFoundError(`Task ${req.params.id} not found`);

        const allowed = ALLOWED_TRANSITIONS[current.status] ?? [];
        if (!allowed.includes(next)) {
          throw new IllegalTransitionError(`Illegal transition ${current.status} → ${next}`);
        }

        const updates: Partial<typeof internalTasks.$inferInsert> = { status: next };
        const now = new Date();
        if (next === 'IN_PROGRESS' && current.startedAt == null) {
          updates.startedAt = now;
        }
        if (next === 'DONE') {
          updates.completedAt = now;
          if (current.startedAt == null) {
            // DONE without prior IN_PROGRESS — stamp startedAt = completedAt
            // so the DB CHECK is satisfied. Operator clicked "Mark done" on
            // an OPEN task; honour the shortcut.
            updates.startedAt = now;
          }
        }
        if (next === 'CANCELLED') {
          updates.cancelledAt = now;
          updates.cancellationReason = req.body.cancellationReason!;
        }

        const [updated] = await tx
          .update(internalTasks)
          .set(updates)
          .where(eq(internalTasks.id, req.params.id))
          .returning();
        if (!updated) throw new Error('UPDATE returned no row after transition');
        return updated;
      });

      return reply.status(200).send(serializeTask(result));
    },
  );
};

export default tasksRoutes;
