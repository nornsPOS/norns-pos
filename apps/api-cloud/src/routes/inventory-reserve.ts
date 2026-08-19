/**
 * POST /api/inventory/reserve — atomic AVAILABLE → RESERVED (Day 15 §1).
 *
 * Wires the HTTP surface to `@norns/inventory-lock` `reserve()`. The
 * one-statement race protection lives in the package; this route handles
 * auth + body validation + mapping null → 409 PRODUCT_NOT_RESERVABLE.
 *
 * Gatekeepers:
 *   • requireAuth                 — valid session
 *   • requireRole('CASHIER','ADMIN') — non-public surface
 *   • Device required for CASHIER — POS must have a mTLS-paired terminal;
 *     ADMIN may not (Bridge-side adjustment).
 *
 * No step-up: a reservation is reversible (release()) and inherently
 * non-fiscal — no money moves yet. Step-up lands at finalize.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { reserve } from '@norns/inventory-lock';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  ReserveBody,
  ReserveResponse,
  type ReserveBody as TReserveBody,
} from '../schemas/inventory.js';

class ProductNotReservableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'PRODUCT_NOT_RESERVABLE';
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

const inventoryReserve: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TReserveBody }>(
    '/api/inventory/reserve',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Reserve a product (AVAILABLE → RESERVED) — race-safe.',
        description:
          'Atomically transitions products.status from AVAILABLE to RESERVED. ' +
          'Returns 409 PRODUCT_NOT_RESERVABLE if the product is already RESERVED, ' +
          'SOLD, or does not exist. Session-id-keyed: the same sessionId must be ' +
          'supplied later to release() or finalize().',
        body: ReserveBody,
        response: {
          200: ReserveResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      // CASHIER must operate from a paired POS terminal.
      if (req.actor.role === 'CASHIER' && req.deviceId == null) {
        throw new DeviceRequiredError('CASHIER actions require a paired POS device cert.');
      }

      const { productId, channel, sessionId } = req.body;

      const result = await reserve(app.db, {
        productId,
        channel,
        sessionId,
        userId: req.actor.id,
      });

      if (result === null) {
        // Race lost OR product not AVAILABLE. The single message is intentional —
        // the caller should not distinguish "someone else won" from "product is
        // SOLD" for UX purposes; both render as "no longer available".
        throw new ProductNotReservableError(
          `Product ${productId} is not AVAILABLE — it is already reserved, sold, or does not exist.`,
        );
      }

      return reply.status(200).send({
        productId: result.productId,
        channel: result.channel,
        sessionId: result.sessionId,
        userId: result.userId,
        reservedAt: result.reservedAt.toISOString(),
        expiresAt: result.expiresAt ? result.expiresAt.toISOString() : null,
      });
    },
  );
};

export default inventoryReserve;
