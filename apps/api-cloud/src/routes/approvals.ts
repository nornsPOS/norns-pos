/**
 * Transaction Approval Queue (ADR-0019 §7) — the ADMIN side of the high-value
 * sale gate. The POS pauses a sale above threshold and emits a
 * `command.approval_requested` ledger event; the Owner Control Desktop lists
 * the open ones here and resolves each with a hash-chained
 * `command.approval_resolved` event.
 *
 *   GET  /api/approvals/pending      (ADMIN) — open approval requests (24h)
 *   POST /api/approvals/:id/resolve  (ADMIN) — APPROVE / REJECT a request
 *
 * "Pending" = the latest `command.approval_requested` for a transaction that
 * has NO newer `command.dispatched` / `command.approval_resolved`. Both reads
 * ride `ledger_events_event_type_idx (event_type, id DESC)`. Resolution writes
 * go ONLY through the append-only `emit()` helper (the DB trigger computes the
 * hash chain — direct INSERTs are forbidden), per the audit discipline.
 */

import { type Static, Type } from '@sinclair/typebox';
import { emit } from '@norns/audit';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

// ── Schemas ─────────────────────────────────────────────────────────────────

const PendingApproval = Type.Object({
  /** Transaction UUID — the `:id` the resolve endpoint takes. */
  id: Type.String({ format: 'uuid' }),
  /** The ledger event id (bigint as text) that requested the approval. */
  eventId: Type.String(),
  requestedAt: Type.String({ format: 'date-time' }),
  posTerminal: Type.String(),
  cashierName: Type.String(),
  amountEur: Type.String(),
  customerName: Type.String(),
  items: Type.Array(Type.String()),
  kycComplete: Type.Boolean(),
  sanctionsMatch: Type.Boolean(),
  pepMatch: Type.Boolean(),
});

const PendingApprovalsResponse = Type.Object({
  items: Type.Array(PendingApproval),
});

const IdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
type TIdParams = Static<typeof IdParams>;

const ResolveBody = Type.Object({
  status: Type.Union([Type.Literal('APPROVED'), Type.Literal('REJECTED')]),
  reason: Type.Optional(Type.String({ maxLength: 1000 })),
});
type TResolveBody = Static<typeof ResolveBody>;

const ResolveResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  status: Type.Union([Type.Literal('APPROVED'), Type.Literal('REJECTED')]),
  resolvedAt: Type.String({ format: 'date-time' }),
  ledgerEventId: Type.String(),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

// ── Errors ──────────────────────────────────────────────────────────────────

class ApprovalValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

// ── Payload extraction helpers (the POST request payload is owner-trusted but
//    schema-loose — read defensively so a malformed event can't crash the rail) ─

function pstr(p: Record<string, unknown>, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function pbool(p: Record<string, unknown>, key: string): boolean {
  return p[key] === true;
}

function pamount(p: Record<string, unknown>): string {
  for (const key of ['amountEur', 'totalEur', 'amount']) {
    const v = p[key];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return v.toFixed(2);
  }
  return '0.00';
}

function pitems(p: Record<string, unknown>): string[] {
  const v = p.items;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

type PendingRow = {
  transaction_id: string;
  event_id: string;
  created_at: Date;
  payload: Record<string, unknown>;
};

const approvalsRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/approvals/pending ────────────────────────────────────────────
  app.get(
    '/api/approvals/pending',
    {
      schema: {
        tags: ['approvals'],
        summary: 'List high-value sales awaiting ADMIN approval (ADR-0019 §7).',
        description:
          'Open `command.approval_requested` events (last 24h) with no newer ' +
          '`command.dispatched` / `command.approval_resolved` for the same transaction.',
        response: {
          200: PendingApprovalsResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const rows = (await app.db.execute<PendingRow>(drizzleSql`
        SELECT e.entity_id::text AS transaction_id,
               e.id::text        AS event_id,
               e.created_at,
               e.payload
          FROM ledger_events e
         WHERE e.event_type = 'command.approval_requested'
           AND e.created_at > now() - interval '24 hours'
           -- no newer resolution for this transaction
           AND NOT EXISTS (
             SELECT 1 FROM ledger_events r
              WHERE r.entity_id = e.entity_id
                AND r.event_type IN ('command.dispatched', 'command.approval_resolved')
                AND r.id > e.id
           )
           -- this is the LATEST request for the transaction (dedupe retries)
           AND NOT EXISTS (
             SELECT 1 FROM ledger_events q
              WHERE q.entity_id = e.entity_id
                AND q.event_type = 'command.approval_requested'
                AND q.id > e.id
           )
         ORDER BY e.created_at ASC
      `)) as unknown as PendingRow[];

      const items = rows.map((row) => {
        const p = row.payload ?? {};
        return {
          id: row.transaction_id,
          eventId: row.event_id,
          requestedAt: new Date(row.created_at).toISOString(),
          posTerminal: pstr(p, 'posTerminal', 'Unbekannt'),
          cashierName: pstr(p, 'cashierName', 'Unbekannt'),
          amountEur: pamount(p),
          customerName: pstr(p, 'customerName', 'Anonym'),
          items: pitems(p),
          kycComplete: pbool(p, 'kycComplete'),
          sanctionsMatch: pbool(p, 'sanctionsMatch'),
          pepMatch: pbool(p, 'pepMatch'),
        };
      });

      return reply.status(200).send({ items });
    },
  );

  // ── POST /api/approvals/:id/resolve ───────────────────────────────────────
  app.post<{ Params: TIdParams; Body: TResolveBody }>(
    '/api/approvals/:id/resolve',
    {
      schema: {
        tags: ['approvals'],
        summary: 'Approve or reject a pending high-value sale (ADR-0019 §7).',
        description:
          'Writes a hash-chained `command.approval_resolved` ledger event via the ' +
          'append-only emit helper. Rejection requires a reason.',
        params: IdParams,
        body: ResolveBody,
        response: {
          200: ResolveResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const transactionId = req.params.id;
      const { status } = req.body;
      const reason = req.body.reason?.trim() ?? '';

      // ADR-0019 §7 — a rejection MUST carry a reason for the audit trail.
      if (status === 'REJECTED' && reason.length === 0) {
        throw new ApprovalValidationError('A rejection requires a reason.');
      }

      const resolvedByUserId = req.actor.id; // requireAuth narrowed actor → non-null
      const resolvedAt = new Date().toISOString();

      const event = await emit(app.db, {
        eventType: 'command.approval_resolved',
        entityTable: 'transactions',
        entityId: transactionId,
        actorUserId: resolvedByUserId,
        deviceId: req.deviceId ?? null,
        ipAddress: req.ip ?? null,
        payload: {
          status,
          reason: reason.length > 0 ? reason : null,
          resolvedByUserId,
          resolvedAt,
        },
      });

      return reply.status(200).send({
        id: transactionId,
        status,
        resolvedAt,
        ledgerEventId: event.id.toString(),
      });
    },
  );
};

export default approvalsRoutes;
