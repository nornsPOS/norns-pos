/**
 * POST /api/inventory/release — RESERVED → AVAILABLE (Day 15 §2).
 *
 * Releases a reservation back to AVAILABLE. The `sessionId` argument is the
 * cross-session guard — a stale actor cannot accidentally release another
 * session's hold. `ReservationOwnershipError` (from inventory-lock) maps to
 * 409 PRODUCT_NOT_RESERVABLE.
 *
 * Gatekeepers:
 *   • requireAuth + requireRole('CASHIER','ADMIN')
 *   • CASHIER requires a paired device (POS)
 *   • No step-up: release is reversible (reserve() again) and non-fiscal.
 *
 * Auto-release of expired reservations is a SEPARATE flow (worker job
 * `autoReleaseExpired` per ADR-0016 §3). This route is for explicit human
 * intent only.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import { ReservationOwnershipError, release } from '@norns/inventory-lock';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  ReleaseBatchBody,
  ReleaseBatchResponse,
  ReleaseBody,
  ReleaseResponse,
  type ReleaseBatchBody as TReleaseBatchBody,
  type ReleaseBody as TReleaseBody,
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

const inventoryRelease: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TReleaseBody }>(
    '/api/inventory/release',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Release a reservation (RESERVED → AVAILABLE) — session-guarded.',
        description:
          'Returns the product to AVAILABLE. The `sessionId` MUST match the ' +
          "row's `reserved_by_session_id` — cross-session releases are refused. " +
          '409 PRODUCT_NOT_RESERVABLE on mismatch or when the row is not RESERVED.',
        body: ReleaseBody,
        response: {
          200: ReleaseResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      if (req.actor.role === 'CASHIER' && req.deviceId == null) {
        throw new DeviceRequiredError('CASHIER actions require a paired POS device cert.');
      }

      const { productId, sessionId, reason } = req.body;

      try {
        // userId guard (§19.2 C-1): only the cashier who reserved can
        // release. requireAuth narrowed req.actor to non-null.
        await release(app.db, {
          productId,
          sessionId,
          userId: req.actor.id,
          reason,
        });
      } catch (err) {
        if (err instanceof ReservationOwnershipError) {
          throw new ProductNotReservableError(err.message);
        }
        throw err;
      }

      return reply.status(200).send({
        productId,
        releasedAt: new Date().toISOString(),
        reason,
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // POST /api/inventory/release/batch — teardown-survivable batch release.
  //
  // Fired from the POS `beforeunload` via navigator.sendBeacon (P1.4). The
  // session token rides in the body (`accessToken`) because a beacon cannot set
  // an Authorization header; the auth plugin honours it for THIS route only.
  //
  // A beacon also cannot send the mTLS device fingerprint, so — unlike the
  // single release route — the CASHIER device gate is NOT enforced here: release
  // is reversible (reserve again) and non-fiscal, and the alternative is the
  // hold leaking forever. The server-side stale-POS-hold sweep (worker job
  // pos_reservation_sweeper) is the durable backstop for a beacon that never
  // arrives (SIGKILL / power loss).
  // ──────────────────────────────────────────────────────────────────────
  app.post<{ Body: TReleaseBatchBody }>(
    '/api/inventory/release/batch',
    {
      schema: {
        tags: ['inventory'],
        summary: 'Release many reservations in one teardown-survivable request.',
        body: ReleaseBatchBody,
        response: {
          200: ReleaseBatchResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'CASHIER', 'ADMIN');

      const { items, reason } = req.body;
      const userId = req.actor.id;

      // ONE transaction: every release() is itself a single ownership-guarded
      // UPDATE. A per-item ownership mismatch (already released / stale session)
      // is recorded in failedProductIds and does NOT abort the rest; any other
      // DB error rolls the whole batch back.
      const releasedProductIds: string[] = [];
      const failedProductIds: string[] = [];
      await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;
        for (const item of items) {
          try {
            await release(tx, {
              productId: item.productId,
              sessionId: item.sessionId,
              userId,
              reason,
            });
            releasedProductIds.push(item.productId);
          } catch (err) {
            if (err instanceof ReservationOwnershipError) {
              failedProductIds.push(item.productId);
            } else {
              throw err;
            }
          }
        }
      });

      return reply.status(200).send({ releasedProductIds, failedProductIds });
    },
  );
};

export default inventoryRelease;
