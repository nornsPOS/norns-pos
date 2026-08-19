/**
 * TypeBox schemas for the internal_tasks API surface (Day 25).
 */

import { type Static, Type } from '@sinclair/typebox';

const TASK_PRIORITY = Type.Union([
  Type.Literal('LOW'),
  Type.Literal('NORMAL'),
  Type.Literal('HIGH'),
  Type.Literal('URGENT'),
]);

const TASK_STATUS = Type.Union([
  Type.Literal('OPEN'),
  Type.Literal('IN_PROGRESS'),
  Type.Literal('BLOCKED'),
  Type.Literal('DONE'),
  Type.Literal('CANCELLED'),
]);

const RELATED_TABLE = Type.Union([
  Type.Literal('products'),
  Type.Literal('customers'),
  Type.Literal('transactions'),
  Type.Literal('appraisals'),
  Type.Literal('product_photos'),
  Type.Literal('shifts'),
  Type.Literal('inventory_sessions'),
]);

// ────────────────────────────────────────────────────────────────────────
// POST /api/tasks
// ────────────────────────────────────────────────────────────────────────

export const CreateTaskBody = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  priority: Type.Optional(TASK_PRIORITY),
  /**
   * Defaults to req.actor.id in single-operator mode. Set this only when
   * a team is present and the Owner wants someone else to own the work.
   */
  assignedToUserId: Type.Optional(Type.String({ format: 'uuid' })),
  dueDate: Type.Optional(Type.String({ format: 'date' })),
  relatedEntityTable: Type.Optional(RELATED_TABLE),
  relatedEntityId: Type.Optional(Type.String({ format: 'uuid' })),
});

export const TaskRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  title: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  priority: TASK_PRIORITY,
  status: TASK_STATUS,
  assignedToUserId: Type.String({ format: 'uuid' }),
  createdByUserId: Type.String({ format: 'uuid' }),
  dueDate: Type.Union([Type.String(), Type.Null()]),
  startedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  completedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  cancelledAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  cancellationReason: Type.Union([Type.String(), Type.Null()]),
  relatedEntityTable: Type.Union([RELATED_TABLE, Type.Null()]),
  relatedEntityId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export const CreateTaskResponse = TaskRow;

// ────────────────────────────────────────────────────────────────────────
// GET /api/tasks
// ────────────────────────────────────────────────────────────────────────

export const ListTasksQuery = Type.Object({
  status: Type.Optional(TASK_STATUS),
  priority: Type.Optional(TASK_PRIORITY),
  assignedToUserId: Type.Optional(Type.String({ format: 'uuid' })),
  /** "Only mine" — convenience flag — overrides assignedToUserId when true. */
  mineOnly: Type.Optional(Type.Boolean()),
  /** Future-dated dueDate within N days; useful for "due-soon" banner. */
  dueWithinDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 365 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const ListTasksResponse = Type.Object({
  items: Type.Array(TaskRow),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:id
// ────────────────────────────────────────────────────────────────────────

export const TaskIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export const GetTaskResponse = TaskRow;

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/tasks/:id  (edit metadata, not status)
// ────────────────────────────────────────────────────────────────────────

export const UpdateTaskBody = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 5000 }), Type.Null()])),
  priority: Type.Optional(TASK_PRIORITY),
  assignedToUserId: Type.Optional(Type.String({ format: 'uuid' })),
  dueDate: Type.Optional(Type.Union([Type.String({ format: 'date' }), Type.Null()])),
});

// ────────────────────────────────────────────────────────────────────────
// PATCH /api/tasks/:id/status  (state-machine transitions)
// ────────────────────────────────────────────────────────────────────────

export const TransitionTaskStatusBody = Type.Object({
  status: TASK_STATUS,
  /** Required when status='CANCELLED'. ≥ 4 chars per DB CHECK. */
  cancellationReason: Type.Optional(Type.String({ minLength: 4, maxLength: 500 })),
});

export type TCreateTaskBody = Static<typeof CreateTaskBody>;
export type TListTasksQuery = Static<typeof ListTasksQuery>;
export type TUpdateTaskBody = Static<typeof UpdateTaskBody>;
export type TTransitionTaskStatusBody = Static<typeof TransitionTaskStatusBody>;
export type TTaskIdParams = Static<typeof TaskIdParams>;
