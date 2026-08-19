/**
 * POST /api/products/:id/inventory-adjustment — Day-9 additive.
 *
 * Single secure write path for the Lager surface's mutation actions:
 *   • LOCATION_CHANGE → UPDATE products.location_* + audit_log
 *   • LOST / DAMAGED / FOUND / OPERATOR_NOTE → audit_log only (Phase-1
 *     Freeze blocks the `LOST` enum addition; Phase 1.5 #I-45 wires the
 *     status flip when the migration lands)
 *
 * Step-up REQUIRED for every reason — inventory adjustments are owner-
 * sensitive (a faked LOST flag could mask theft). The interceptor opens
 * die Bestandskorrektur.
 *
 * Returns the audit_log id + the post-mutation location triplet so the
 * Lager surface can update its row without a refetch.
 */

import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, products } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  InventoryAdjustmentBody,
  InventoryAdjustmentResponse,
  type InventoryAdjustmentBody as TBody,
} from '../schemas/inventory-adjustment.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class AdjustmentValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: { field: string; reason: string };
  public constructor(field: string, reason: string) {
    super(`Validation failed for "${field}": ${reason}`);
    this.details = { field, reason };
  }
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const inventoryAdjustmentRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: TBody }>(
    '/api/products/:id/inventory-adjustment',
    {
      schema: {
        tags: ['products'],
        summary: 'Lager mutation: location change, lost/damaged flag, operator note.',
        description:
          'Every reason writes audit_log. LOCATION_CHANGE additionally updates ' +
          'products.location_* + location_assigned_at. LOST/DAMAGED/FOUND/' +
          'OPERATOR_NOTE leave the products row untouched in V1 (Phase 1.5 #I-45 ' +
          'wires status flip). Step-up REQUIRED.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: InventoryAdjustmentBody,
        response: {
          200: InventoryAdjustmentResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const { id } = req.params;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      // ── Per-reason field validation ──
      const allLocationProvided =
        body.locationStorageUnit !== undefined &&
        body.locationDrawer !== undefined &&
        body.locationPosition !== undefined;
      const anyLocationProvided =
        body.locationStorageUnit !== undefined ||
        body.locationDrawer !== undefined ||
        body.locationPosition !== undefined;

      if (body.reason === 'LOCATION_CHANGE') {
        if (!allLocationProvided) {
          throw new AdjustmentValidationError(
            'location*',
            'LOCATION_CHANGE requires locationStorageUnit + locationDrawer + locationPosition.',
          );
        }
      } else if (anyLocationProvided) {
        throw new AdjustmentValidationError(
          'location*',
          `Reason "${body.reason}" does not accept location fields (only LOCATION_CHANGE does).`,
        );
      }

      // ── One DB transaction: products UPDATE (if relevant) + audit_log ──
      const outcome = await app.db.transaction(async (tx) => {
        // Lock + read existing row.
        const [row] = await tx
          .select({
            id: products.id,
            locationStorageUnit: products.locationStorageUnit,
            locationDrawer: products.locationDrawer,
            locationPosition: products.locationPosition,
          })
          .from(products)
          .where(eq(products.id, id))
          .limit(1);
        if (!row) throw new ProductNotFoundError(`Product ${id} not found.`);

        const previousLocation = {
          locationStorageUnit: row.locationStorageUnit,
          locationDrawer: row.locationDrawer,
          locationPosition: row.locationPosition,
        };
        let nextLocation = previousLocation;

        if (body.reason === 'LOCATION_CHANGE' && allLocationProvided) {
          await tx
            .update(products)
            .set({
              locationStorageUnit: body.locationStorageUnit!,
              locationDrawer: body.locationDrawer!,
              locationPosition: body.locationPosition!,
              locationAssignedAt: new Date(),
            })
            .where(eq(products.id, id));
          nextLocation = {
            locationStorageUnit: body.locationStorageUnit!,
            locationDrawer: body.locationDrawer!,
            locationPosition: body.locationPosition!,
          };
        }

        // Audit log — event type varies by reason for downstream filtering.
        const eventType =
          body.reason === 'LOCATION_CHANGE'
            ? 'product.location_changed'
            : 'product.inventory_adjustment_logged';

        const [audit] = await tx
          .insert(auditLog)
          .values({
            eventType,
            actorUserId: actorId,
            deviceId,
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            payload: {
              productId: id,
              reason: body.reason,
              notes: body.notes,
              ...(body.reason === 'LOCATION_CHANGE' ? { previousLocation, nextLocation } : {}),
            },
          })
          .returning({ id: auditLog.id, createdAt: auditLog.createdAt });
        if (!audit) {
          throw new Error('audit_log INSERT returned no row (should be impossible)');
        }

        return {
          auditLogId: audit.id,
          loggedAt: audit.createdAt,
          location: nextLocation,
        };
      });

      return reply.status(200).send({
        productId: id,
        reason: body.reason,
        auditLogId: outcome.auditLogId,
        loggedAt: outcome.loggedAt.toISOString(),
        locationStorageUnit: outcome.location.locationStorageUnit,
        locationDrawer: outcome.location.locationDrawer,
        locationPosition: outcome.location.locationPosition,
      });
    },
  );
};

export default inventoryAdjustmentRoute;
