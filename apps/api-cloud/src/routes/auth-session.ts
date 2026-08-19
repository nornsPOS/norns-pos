/**
 * Auth session companion routes (Day 5 — Operational Foundations, memory.md #76).
 *
 *   GET  /api/auth/session   — current actor + step-up freshness, or 401
 *   POST /api/auth/sign-out  — destroy the current PIN session
 *
 * These complete the auth surface that the Tauri client needs for cold-start
 * restore + clean sign-out. They live in their own route file (NOT inside
 * auth-pin.ts) because they target the SESSION lifecycle, not the PIN
 * lifecycle. The schemas the client consumes are exported alongside.
 */

import { Type } from '@sinclair/typebox';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, sessions } from '@norns/db/schema';

import { UnauthorizedError, requireAuth } from '../lib/auth-policy.js';

// ────────────────────────────────────────────────────────────────────────
// Response schemas
// ────────────────────────────────────────────────────────────────────────

const SessionActor = Type.Object({
  id: Type.String({ format: 'uuid' }),
  role: Type.Union([Type.Literal('ADMIN'), Type.Literal('CASHIER'), Type.Literal('READONLY')]),
  isOwner: Type.Boolean(),
});

const SessionResponse = Type.Object({
  ok: Type.Literal(true),
  actor: SessionActor,
  /** Server time when the current PIN step-up was last refreshed (or null). */
  lastPinStepUpAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  /** When this session cookie expires. */
  expiresAt: Type.String({ format: 'date-time' }),
});

const SignOutResponse = Type.Object({
  ok: Type.Literal(true),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
  }),
});

// ────────────────────────────────────────────────────────────────────────
// Routes
// ────────────────────────────────────────────────────────────────────────

const authSessionRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/auth/session
  //
  // Trivial probe — the auth preHandler already populated req.actor /
  // req.session for any valid cookie. We just echo a stable shape; the
  // client uses it for cold-start restore. Returns 401 when there is no
  // session (the standard requireAuth path).
  // ────────────────────────────────────────────────────────────────────
  app.get(
    '/api/auth/session',
    {
      schema: {
        tags: ['auth'],
        summary: 'Return the current PIN session (cold-start restore).',
        response: { 200: SessionResponse, 401: ErrorResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      return {
        ok: true as const,
        actor: {
          id: req.actor.id,
          role: req.actor.role,
          isOwner: req.actor.isOwner,
        },
        lastPinStepUpAt: req.session.lastPinStepUpAt
          ? req.session.lastPinStepUpAt.toISOString()
          : null,
        expiresAt: req.session.sessionExpiresAt.toISOString(),
      };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/sign-out
  //
  // Deletes the row from `sessions` + clears the cookie. Idempotent:
  // calling it without a session returns 401 (no harm done). Writes an
  // `auth.sign_out` audit row inside the same transaction as the delete.
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/sign-out',
    {
      schema: {
        tags: ['auth'],
        summary: 'Destroy the current PIN session.',
        response: { 200: SignOutResponse, 401: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!req.session || !req.actor) {
        throw new UnauthorizedError('No active session to sign out.');
      }
      const sessionId = req.session.sessionId;
      const actorId = req.actor.id;

      await app.db.transaction(async (tx) => {
        await tx.delete(sessions).where(eq(sessions.id, sessionId));
        await tx.insert(auditLog).values({
          eventType: 'auth.sign_out',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: { sessionId },
        });
      });

      // Clear the cookie. Mirror the set-cookie attributes (SameSite=None +
      // Secure in prod, for the cross-site Tauri webview) so the browser
      // actually matches + overwrites the existing cookie.
      {
        const crossSite = process.env.NODE_ENV === 'production';
        reply.clearCookie('warehouse14.session', {
          path: '/',
          httpOnly: true,
          secure: crossSite ? true : req.protocol === 'https',
          sameSite: crossSite ? 'none' : 'lax',
        });
      }

      return { ok: true as const };
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/auth/sign-out-all
  //
  // The lost-device kill switch (security review 2026-07-21). Revokes EVERY
  // live session of the current user, on every device, by stamping
  // `sessions.revoked_at` — the per-request auth loader rejects a revoked
  // session on its very next call, so a phone that was lost while unlocked
  // stops working the instant the owner runs this from any other device.
  // The current session is included; the cookie is cleared too.
  // ────────────────────────────────────────────────────────────────────
  app.post(
    '/api/auth/sign-out-all',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke ALL of the current user\'s sessions (all devices).',
        response: {
          200: Type.Object({ ok: Type.Literal(true), revoked: Type.Integer() }),
          401: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      if (!req.session || !req.actor) {
        throw new UnauthorizedError('No active session.');
      }
      const actorId = req.actor.id;

      const revoked = await app.db.transaction(async (tx) => {
        const rows = await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, actorId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id });
        await tx.insert(auditLog).values({
          eventType: 'auth.sign_out_all',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: { revokedCount: rows.length },
        });
        return rows.length;
      });

      {
        const crossSite = process.env.NODE_ENV === 'production';
        reply.clearCookie('warehouse14.session', {
          path: '/',
          httpOnly: true,
          secure: crossSite ? true : req.protocol === 'https',
          sameSite: crossSite ? 'none' : 'lax',
        });
      }

      return { ok: true as const, revoked };
    },
  );
};

export default authSessionRoutes;
