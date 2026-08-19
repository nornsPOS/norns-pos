/**
 * Tasks domain client — Single-Operator Assistance (Day 25).
 *
 *   list(query)              — GET    /api/tasks
 *   get(id)                  — GET    /api/tasks/:id
 *   create(body)             — POST   /api/tasks      (auto-fills assignee + creator)
 *   update(id, body)         — PATCH  /api/tasks/:id  (metadata only — title, due, etc.)
 *   transition(id, body)     — PATCH  /api/tasks/:id/status  (state-machine)
 *
 * Mirrors `apps/api-cloud/src/schemas/tasks.ts`. Note that the backend's
 * state-machine table is OPEN → IN_PROGRESS → DONE plus BLOCKED/CANCELLED;
 * the consumer screen renders only the legal transitions per current state.
 */

import type { ApiClient } from '../client.js';

export type TaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';

export type TaskRelatedTable =
  | 'products'
  | 'customers'
  | 'transactions'
  | 'appraisals'
  | 'product_photos'
  | 'shifts'
  | 'inventory_sessions';

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assignedToUserId: string;
  createdByUserId: string;
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  relatedEntityTable: TaskRelatedTable | null;
  relatedEntityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListTasksQuery {
  status?: TaskStatus;
  priority?: TaskPriority;
  assignedToUserId?: string;
  mineOnly?: boolean;
  dueWithinDays?: number;
  limit?: number;
  offset?: number;
}

export interface ListTasksResponse {
  items: TaskRow[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CreateTaskBody {
  title: string;
  description?: string;
  priority?: TaskPriority;
  assignedToUserId?: string;
  dueDate?: string;
  relatedEntityTable?: TaskRelatedTable;
  relatedEntityId?: string;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedToUserId?: string;
  dueDate?: string | null;
}

export interface TransitionTaskBody {
  status: TaskStatus;
  /** Required when status='CANCELLED'. ≥ 4 chars per DB CHECK. */
  cancellationReason?: string;
}

function buildQuery(query: ListTasksQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export const tasksApi = {
  list(client: ApiClient, query: ListTasksQuery = {}): Promise<ListTasksResponse> {
    return client.request<ListTasksResponse>('GET', `/api/tasks${buildQuery(query)}`);
  },
  get(client: ApiClient, id: string): Promise<TaskRow> {
    return client.request<TaskRow>('GET', `/api/tasks/${encodeURIComponent(id)}`);
  },
  create(client: ApiClient, body: CreateTaskBody): Promise<TaskRow> {
    return client.request<TaskRow>('POST', '/api/tasks', body);
  },
  update(client: ApiClient, id: string, body: UpdateTaskBody): Promise<TaskRow> {
    return client.request<TaskRow>('PATCH', `/api/tasks/${encodeURIComponent(id)}`, body);
  },
  transition(client: ApiClient, id: string, body: TransitionTaskBody): Promise<TaskRow> {
    return client.request<TaskRow>('PATCH', `/api/tasks/${encodeURIComponent(id)}/status`, body);
  },
};

/**
 * State-machine transition table — mirrors apps/api-cloud/src/routes/tasks.ts.
 * The screen consults this to gate which buttons to render per row.
 */
export const ALLOWED_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  OPEN: ['IN_PROGRESS', 'BLOCKED', 'CANCELLED'],
  IN_PROGRESS: ['BLOCKED', 'DONE', 'CANCELLED'],
  BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};
