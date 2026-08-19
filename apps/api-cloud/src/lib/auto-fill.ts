/**
 * Single-Operator auto-fill helpers (Day 25, memory.md #71).
 *
 * In single-operator mode every assignment column auto-defaults to the
 * acting user. The DB stays multi-user-shaped — the moment the Owner hires
 * a Lehrling and the front-end starts sending an explicit assignee, these
 * helpers transparently honour it.
 *
 * Pure functions over the authenticated `req.actor`. No DB calls.
 */

import type { FastifyRequest } from 'fastify';

/**
 * Resolve {assignedToUserId, createdByUserId} for an internal_tasks INSERT.
 *
 *   • `createdByUserId` is ALWAYS `req.actor.id` — never overridable.
 *   • `assignedToUserId` defaults to `req.actor.id` unless the body
 *     explicitly sets a non-null value (the team-mode upgrade path).
 *
 * Throws if the request is unauthenticated — callers MUST call
 * `requireAuth(req)` first; the type guard below makes that contract
 * explicit.
 */
export function resolveTaskAssignment(
  req: FastifyRequest,
  body: { assignedToUserId?: string | null },
): { assignedToUserId: string; createdByUserId: string } {
  if (!req.actor) {
    throw new Error('resolveTaskAssignment: req.actor is null — call requireAuth first');
  }
  const actorId = req.actor.id;
  return {
    assignedToUserId: body.assignedToUserId ?? actorId,
    createdByUserId: actorId,
  };
}

/**
 * Resolve the document context from URL query params or body fields.
 *
 * The route receives one of `customerId`, `productId`, `transactionId`,
 * `appraisalId` — exactly one must be set. Returns the link tuple suitable
 * for inserting into document_attachments.
 *
 * The category-link discipline is enforced by the DB CHECK; this helper
 * only enforces the "exactly one" invariant at the route boundary so we
 * can return a 400 instead of letting the DB raise a 23514.
 */
export function resolveDocumentLink(input: {
  customerId?: string | null;
  productId?: string | null;
  transactionId?: string | null;
  appraisalId?: string | null;
}): {
  customerId: string | null;
  productId: string | null;
  transactionId: string | null;
  appraisalId: string | null;
} {
  const setCount =
    (input.customerId ? 1 : 0) +
    (input.productId ? 1 : 0) +
    (input.transactionId ? 1 : 0) +
    (input.appraisalId ? 1 : 0);
  if (setCount === 0) {
    throw new DocumentLinkError(
      'document must link to exactly one entity (customerId | productId | transactionId | appraisalId)',
    );
  }
  if (setCount > 1) {
    throw new DocumentLinkError('document may link to ONLY one entity at a time');
  }
  return {
    customerId: input.customerId ?? null,
    productId: input.productId ?? null,
    transactionId: input.transactionId ?? null,
    appraisalId: input.appraisalId ?? null,
  };
}

/** Thrown when the polymorphic link is malformed. Caught by the route → 400. */
export class DocumentLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentLinkError';
  }
}
