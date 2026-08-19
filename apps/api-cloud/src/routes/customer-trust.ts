/**
 * Customer trust + KYC verification routes (Day 26, the Backend Finale).
 *
 *   PATCH /api/customers/:id/kyc                         — Owner stamps the
 *                                                          physical-ID check
 *   PATCH /api/customers/:id/trust                       — Owner sets trust_level
 *   PATCH /api/customers/:id/price-expectation-notes     — Owner free-text
 *
 * Every mutation:
 *   • requires Owner (fiscal/AML-relevant)
 *   • writes a redacted-PII row to audit_log inside the same TX
 *   • emits ledger alerts when entering SUSPICIOUS / BANNED
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, customers } from '@norns/db/schema';

import { requireAuth, requireOwner } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CustomerIdParams,
  KycStampBody,
  KycStampResponse,
  PriceNotesBody,
  SetTrustBody,
  SetTrustResponse,
  type TCustomerIdParams,
  type TKycStampBody,
  type TPriceNotesBody,
  type TSetTrustBody,
} from '../schemas/customer-trust.js';

class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class TrustValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class TrustConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}
class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const customerTrustRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/customers/:id/kyc
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TCustomerIdParams; Body: TKycStampBody }>(
    '/api/customers/:id/kyc',
    {
      schema: {
        tags: ['customers', 'kyc'],
        summary: 'Owner stamps the physical-ID verification.',
        description:
          'Records WHO verified the document and WHEN. Optionally promotes ' +
          'trust_level to VERIFIED or VIP. Owner-only. Writes ' +
          '`customer.kyc_verified` to audit_log with redacted PII (only ' +
          'documentType + new trust_level).',
        params: CustomerIdParams,
        body: KycStampBody,
        response: {
          200: KycStampResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwner(req);

      const { deviceId } = req;
      if (deviceId == null) {
        throw new DeviceRequiredError('KYC stamping requires an mTLS-paired device.');
      }
      const actorId = req.actor.id;

      const result = await app.db.transaction(async (tx) => {
        const updates: Partial<typeof customers.$inferInsert> = {
          kycVerifiedAt: new Date(),
          kycVerifiedByUserId: actorId,
        };
        if (req.body.promoteTrustLevelTo) {
          updates.trustLevel = req.body.promoteTrustLevelTo;
        }

        const [row] = await tx
          .update(customers)
          .set(updates)
          .where(eq(customers.id, req.params.id))
          .returning({
            id: customers.id,
            trustLevel: customers.trustLevel,
            kycVerifiedAt: customers.kycVerifiedAt,
            kycVerifiedByUserId: customers.kycVerifiedByUserId,
          });
        if (!row) throw new CustomerNotFoundError(`Customer ${req.params.id} not found`);

        await tx.insert(auditLog).values({
          eventType: 'customer.kyc_verified',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            customerId: row.id,
            documentType: req.body.documentType,
            promotedTrustLevel: req.body.promoteTrustLevelTo ?? null,
            // notes are NEVER persisted to audit_log payload as raw text —
            // they may contain personal references. Length only.
            notesLength: req.body.notes?.length ?? 0,
          },
        });
        return row;
      });

      return reply.status(200).send({
        id: result.id,
        trustLevel: result.trustLevel,
        kycVerifiedAt: result.kycVerifiedAt!.toISOString(),
        kycVerifiedByUserId: result.kycVerifiedByUserId!,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/customers/:id/trust
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TCustomerIdParams; Body: TSetTrustBody }>(
    '/api/customers/:id/trust',
    {
      schema: {
        tags: ['customers', 'kyc'],
        summary: 'Set customer trust_level (Owner).',
        description:
          'SUSPICIOUS / BANNED require a reason (≥ 8 chars) — saved to ' +
          '`price_expectation_notes`. VERIFIED / VIP require prior KYC stamp. ' +
          'Emits `alert.customer_marked_suspicious` / `alert.customer_banned` ' +
          'ledger events when applicable.',
        params: CustomerIdParams,
        body: SetTrustBody,
        response: {
          200: SetTrustResponse,
          400: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwner(req);

      const { deviceId } = req;
      if (deviceId == null) {
        throw new DeviceRequiredError('Trust changes require an mTLS-paired device.');
      }
      const actorId = req.actor.id;
      const target = req.body.trustLevel;

      if (
        (target === 'SUSPICIOUS' || target === 'BANNED') &&
        (!req.body.reason || req.body.reason.length < 8)
      ) {
        throw new TrustValidationError(
          `trust_level=${target} requires a reason (≥ 8 chars) — written to price_expectation_notes`,
        );
      }

      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: customers.id,
            trustLevel: customers.trustLevel,
            kycVerifiedAt: customers.kycVerifiedAt,
            priceExpectationNotes: customers.priceExpectationNotes,
          })
          .from(customers)
          .where(eq(customers.id, req.params.id))
          .limit(1);
        if (!current) throw new CustomerNotFoundError(`Customer ${req.params.id} not found`);

        if ((target === 'VERIFIED' || target === 'VIP') && current.kycVerifiedAt == null) {
          throw new TrustConflictError(
            `cannot promote to ${target} without a prior physical-ID check ` +
              '(PATCH /api/customers/:id/kyc first)',
          );
        }

        const updates: Partial<typeof customers.$inferInsert> = { trustLevel: target };
        if (req.body.reason !== undefined) {
          updates.priceExpectationNotes = req.body.reason;
        }

        const [row] = await tx
          .update(customers)
          .set(updates)
          .where(eq(customers.id, req.params.id))
          .returning({
            id: customers.id,
            trustLevel: customers.trustLevel,
            priceExpectationNotes: customers.priceExpectationNotes,
          });
        if (!row) throw new CustomerNotFoundError(`Customer ${req.params.id} not found`);

        await tx.insert(auditLog).values({
          eventType: 'customer.trust_changed',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            customerId: row.id,
            fromTrustLevel: current.trustLevel,
            toTrustLevel: row.trustLevel,
            reasonLength: req.body.reason?.length ?? 0,
          },
        });

        // Emit ledger alerts for the two notable transitions.
        // Raw SQL because the SECURITY DEFINER hash-chain trigger fills
        // prev_hash + row_hash — Drizzle's typed insert insists they be set.
        // NOTE: every interpolated parameter inside `jsonb_build_object(...)`
        // MUST carry an explicit cast. The function is variadic `"any"`, so a
        // bare bind parameter leaves Postgres unable to infer its type at
        // prepare time and the whole INSERT fails with 42P18 ("could not
        // determine data type of parameter $n"). That is exactly why entering
        // SUSPICIOUS / BANNED used to 500 while NEW / VERIFIED / VIP (which skip
        // this ledger insert) succeeded. Keep the `::text` / `::int` casts.
        if (target === 'SUSPICIOUS' && current.trustLevel !== 'SUSPICIOUS') {
          await tx.execute(drizzleSql`
            INSERT INTO ledger_events
              (event_type, entity_table, entity_id, actor_user_id, device_id, payload)
            VALUES (
              'alert.customer_marked_suspicious',
              'customers',
              ${row.id},
              ${actorId},
              ${deviceId},
              jsonb_build_object(
                'customerId', ${row.id}::text,
                'fromTrustLevel', ${current.trustLevel}::text,
                'reasonLength', ${req.body.reason?.length ?? 0}::int
              )
            )`);
        } else if (target === 'BANNED' && current.trustLevel !== 'BANNED') {
          await tx.execute(drizzleSql`
            INSERT INTO ledger_events
              (event_type, entity_table, entity_id, actor_user_id, device_id, payload)
            VALUES (
              'alert.customer_banned',
              'customers',
              ${row.id},
              ${actorId},
              ${deviceId},
              jsonb_build_object(
                'customerId', ${row.id}::text,
                'fromTrustLevel', ${current.trustLevel}::text,
                'reasonLength', ${req.body.reason?.length ?? 0}::int
              )
            )`);
        }

        return row;
      });

      return reply.status(200).send({
        id: result.id,
        trustLevel: result.trustLevel,
        priceExpectationNotes: result.priceExpectationNotes,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/customers/:id/price-expectation-notes
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TCustomerIdParams; Body: TPriceNotesBody }>(
    '/api/customers/:id/price-expectation-notes',
    {
      schema: {
        tags: ['customers'],
        summary: 'Set or clear the price-expectation notes on a customer.',
        description:
          'Free-text notes about how the customer haggles. Owner-only; ' +
          'audited. Refuses clearing when trust_level is SUSPICIOUS / BANNED ' +
          '(those require a rationale).',
        params: CustomerIdParams,
        body: PriceNotesBody,
        response: {
          200: Type.Object({
            id: Type.String(),
            priceExpectationNotes: Type.Union([Type.String(), Type.Null()]),
          }),
          404: ErrorResponse,
          409: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwner(req);

      const { deviceId } = req;
      if (deviceId == null) {
        throw new DeviceRequiredError('Note changes require an mTLS-paired device.');
      }

      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({ id: customers.id, trustLevel: customers.trustLevel })
          .from(customers)
          .where(eq(customers.id, req.params.id))
          .limit(1);
        if (!current) throw new CustomerNotFoundError(`Customer ${req.params.id} not found`);

        if (
          req.body.notes === null &&
          (current.trustLevel === 'SUSPICIOUS' || current.trustLevel === 'BANNED')
        ) {
          throw new TrustConflictError(
            `cannot clear notes while trust_level=${current.trustLevel}; ` +
              'change trust_level first or replace with a non-null note',
          );
        }

        const [row] = await tx
          .update(customers)
          .set({ priceExpectationNotes: req.body.notes })
          .where(eq(customers.id, req.params.id))
          .returning({
            id: customers.id,
            priceExpectationNotes: customers.priceExpectationNotes,
          });

        await tx.insert(auditLog).values({
          eventType: 'customer.price_notes_changed',
          actorUserId: req.actor.id,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            customerId: row!.id,
            newLength: req.body.notes?.length ?? 0,
          },
        });

        return row!;
      });

      return reply.status(200).send({
        id: result.id,
        priceExpectationNotes: result.priceExpectationNotes,
      });
    },
  );

  // Silence linter: drizzleSql is imported for future filter use; reference once.
  void drizzleSql;
};

export default customerTrustRoutes;
