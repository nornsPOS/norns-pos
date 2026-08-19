/**
 * Sanctions screening route (Epic J).
 *
 *   POST /api/customers/:id/check-sanctions  — ADMIN + CASHIER.
 *
 * Decrypts the customer's name (+ DOB) via `app.withPii`, screens it against
 * OpenSanctions, and writes the OUTCOME (never the name) to audit_log.
 *
 * PII discipline (ADR-0022 §5 RED LINE + memory.md #20):
 *   • The decrypted name lives only inside the withPii transaction and the
 *     in-memory query — it is NEVER logged, never put in audit_log/Sentry.
 *   • The HTTP call to OpenSanctions happens AFTER the withPii tx closes, so we
 *     never hold a PII-keyed transaction open across a 10s network round-trip.
 *
 * Fail-safe (memory.md #53): an API outage returns apiUnavailable:true with
 * matched:false — the operator is not blocked. Only matched:true (a real hit)
 * drives the downstream hard-block.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@norns/db/schema';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { matchSanctions } from '../lib/opensanctions.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const CheckSanctionsResponse = Type.Object({
  customerId: Type.String({ format: 'uuid' }),
  score: Type.Number(),
  matched: Type.Boolean(),
  apiUnavailable: Type.Optional(Type.Boolean()),
  skipped: Type.Optional(Type.Boolean()),
});

export interface CheckSanctionsRouteOpts {
  env: Env;
}

const customersCheckSanctionsRoute: FastifyPluginAsync<CheckSanctionsRouteOpts> = async (
  app,
  opts,
) => {
  app.post<{ Params: { id: string } }>(
    '/api/customers/:id/check-sanctions',
    {
      schema: {
        tags: ['customers'],
        summary: 'Screen a customer against OpenSanctions (PEP/EU/OFAC). ADMIN + CASHIER.',
        description:
          'Decrypts the name via withPii, matches against the OpenSanctions hosted ' +
          'API, and audit-logs only { score, matched, apiUnavailable } — never the ' +
          'name. Fail-safe: an API outage never blocks; empty key → skipped.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          200: CheckSanctionsResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const { id } = req.params;

      // 1. Decrypt the name + DOB inside a short-lived PII transaction.
      const person = await app.withPii(async (tx) => {
        const rows = await tx.execute<{ full_name: string; date_of_birth: string | null }>(sql`
          SELECT
            decrypt_pii(full_name_encrypted)      AS full_name,
            decrypt_pii(date_of_birth_encrypted)  AS date_of_birth
          FROM customers
          WHERE id = ${id}
            AND soft_deleted_at IS NULL
          LIMIT 1
        `);
        return rows[0] ?? null;
      });

      if (!person) {
        throw new CustomerNotFoundError(`Customer ${id} not found.`);
      }

      // 2. Screen — outside the PII tx; never throws (fail-safe).
      const result = await matchSanctions(
        {
          apiKey: opts.env.OPENSANCTIONS_API_KEY,
          scoreThreshold: Number(opts.env.OPENSANCTIONS_SCORE_THRESHOLD),
        },
        {
          name: person.full_name,
          ...(person.date_of_birth ? { birthDate: person.date_of_birth } : {}),
        },
      );

      // 3. Persist the screening OUTCOME onto the customer row so the AML wall
      //    is actually armed. Migration 0013's BEFORE INSERT trigger
      //    `transactions_validate_sanctions` hard-blocks any transaction for a
      //    customer with `sanctions_match = TRUE` — but it reads a column that
      //    nothing ever wrote, so it was ALWAYS FALSE and the gate was dead.
      //    On a real hit we flip the flag (the trigger then refuses the sale).
      //    We never CLEAR an existing flag here: a positive screen latches until
      //    an Owner clears it deliberately (ADR-0018 §6). `sanctions_screened_at`
      //    records when the screen ran regardless of outcome (audit trail).
      //
      //    The UPDATE runs as warehouse14_app, which migration 0059 grants
      //    UPDATE(sanctions_match, sanctions_screened_at) on customers. We do NOT
      //    write inside withPii — this touches only non-PII compliance columns.
      //    Skipped/api-unavailable screens never set the flag (fail-safe).
      if (!result.skipped && !result.apiUnavailable) {
        if (result.matched) {
          await app.db.execute(sql`
            UPDATE customers
               SET sanctions_match = TRUE,
                   sanctions_screened_at = now()
             WHERE id = ${id}
               AND soft_deleted_at IS NULL
          `);
        } else {
          await app.db.execute(sql`
            UPDATE customers
               SET sanctions_screened_at = now()
             WHERE id = ${id}
               AND soft_deleted_at IS NULL
          `);
        }
      }

      // 4. Audit — outcome only, NEVER the name (GoBD + DSGVO).
      await app.db.insert(auditLog).values({
        eventType: 'customer.sanctions_checked',
        actorUserId: req.actor.id,
        deviceId: req.deviceId ?? null,
        ipAddress: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
        payload: {
          customerId: id,
          score: result.score,
          matched: result.matched,
          apiUnavailable: result.apiUnavailable ?? false,
          skipped: result.skipped ?? false,
        },
      });

      return reply.status(200).send({
        customerId: id,
        score: result.score,
        matched: result.matched,
        ...(result.apiUnavailable !== undefined ? { apiUnavailable: result.apiUnavailable } : {}),
        ...(result.skipped !== undefined ? { skipped: result.skipped } : {}),
      });
    },
  );
};

export default customersCheckSanctionsRoute;
