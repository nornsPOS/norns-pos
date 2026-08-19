/**
 * POST /api/products/:id/relocate — low-risk physical re-shelving.
 *
 * A dedicated, audited LOCATION-ONLY move that — unlike
 * /api/products/:id/inventory-adjustment — eine Mengenkorrektur, also
 * warehouse worker on a paired phone can re-shelve stock practically. It only
 * ever changes the location triplet (never quantity/status), and every move is
 * written to audit_log exactly like the LOCATION_CHANGE adjustment, so the
 * GoBD trail is identical. Quantity-affecting or loss/damage reasons stay on
 * die Mengenkorrektur ueber inventory-adjustment.
 */

import { type Static, Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, products } from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const RelocateBody = Type.Object({
  locationStorageUnit: Type.String({ minLength: 1, maxLength: 64 }),
  locationDrawer: Type.String({ minLength: 1, maxLength: 64 }),
  locationPosition: Type.String({ minLength: 1, maxLength: 64 }),
  notes: Type.Optional(Type.String({ maxLength: 1024 })),
});
type TRelocateBody = Static<typeof RelocateBody>;

const RelocateResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  locationStorageUnit: Type.String(),
  locationDrawer: Type.String(),
  locationPosition: Type.String(),
  auditLogId: Type.String({ format: 'uuid' }),
  loggedAt: Type.String({ format: 'date-time' }),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const productRelocateRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: TRelocateBody }>(
    '/api/products/:id/relocate',
    {
      schema: {
        tags: ['products'],
        summary: 'Re-shelve a product (location-only, audited, no step-up).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: RelocateBody,
        response: { 200: RelocateResponse, 400: ErrorResponse, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const { id } = req.params;
      const body = req.body;
      const actorId = req.actor.id;
      const deviceId = req.deviceId ?? null;

      const outcome = await app.db.transaction(async (tx) => {
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
        const nextLocation = {
          locationStorageUnit: body.locationStorageUnit,
          locationDrawer: body.locationDrawer,
          locationPosition: body.locationPosition,
        };

        await tx
          .update(products)
          .set({ ...nextLocation, locationAssignedAt: new Date() })
          .where(eq(products.id, id));

        const [audit] = await tx
          .insert(auditLog)
          .values({
            eventType: 'product.location_changed',
            actorUserId: actorId,
            deviceId,
            ipAddress: req.ip ?? null,
            userAgent: req.headers['user-agent'] ?? null,
            payload: {
              productId: id,
              reason: 'LOCATION_CHANGE',
              via: 'relocate',
              notes: body.notes ?? 'Umlagern (mobil)',
              previousLocation,
              nextLocation,
            },
          })
          .returning({ id: auditLog.id, createdAt: auditLog.createdAt });
        if (!audit) throw new Error('audit_log INSERT returned no row');

        return { auditLogId: audit.id, loggedAt: audit.createdAt, location: nextLocation };
      });

      return reply.status(200).send({
        productId: id,
        locationStorageUnit: outcome.location.locationStorageUnit,
        locationDrawer: outcome.location.locationDrawer,
        locationPosition: outcome.location.locationPosition,
        auditLogId: outcome.auditLogId,
        loggedAt: outcome.loggedAt.toISOString(),
      });
    },
  );
};

export default productRelocateRoute;
