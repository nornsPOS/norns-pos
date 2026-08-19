/**
 * API-key management (Track E) — create / list / revoke programmatic keys.
 *
 *   POST /api/api-keys            — mint a key (ADMIN + PIN step-up). Returns the
 *                                   plaintext token ONCE; only its hash is stored.
 *   GET  /api/api-keys            — list keys (metadata only, never a secret).
 *   POST /api/api-keys/:id/revoke — soft-revoke a key (ADMIN + PIN step-up).
 *
 * These are management routes for a HUMAN admin: an API-key principal is refused
 * outright (a key cannot mint or manage keys), and the step-up requirement is a
 * second lock (a key has no step-up, so it fails there too). Every mint + revoke
 * writes an audit row.
 */

import { Type } from '@sinclair/typebox';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

import { apiKeys, auditLog } from '@norns/db/schema';

import { generateApiKey } from '../lib/api-key.js';
import { ForbiddenError, requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';

const RoleEnum = Type.Union([
  Type.Literal('ADMIN'),
  Type.Literal('CASHIER'),
  Type.Literal('READONLY'),
]);

const CreateBody = Type.Object({
  label: Type.String({ minLength: 1, maxLength: 120 }),
  role: RoleEnum,
  readOnly: Type.Boolean(),
  expiresAt: Type.Optional(Type.Union([Type.String({ format: 'date-time' }), Type.Null()])),
});

interface CreateBodyShape {
  label: string;
  role: 'ADMIN' | 'CASHIER' | 'READONLY';
  readOnly: boolean;
  expiresAt?: string | null;
}

/** Reject an API-key principal from the management surface (a key can't manage keys). */
function refuseApiKeyActor(req: FastifyRequest): void {
  if (req.actor?.apiKeyId) {
    throw new ForbiddenError('API-Schlüssel können keine API-Schlüssel verwalten.');
  }
}

const apiKeysRoutes: FastifyPluginAsync = async (app) => {
  // ── POST /api/api-keys ────────────────────────────────────────────────
  app.post(
    '/api/api-keys',
    { schema: { tags: ['auth'], summary: 'Create an API key (shown once).', body: CreateBody } },
    async (req) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      refuseApiKeyActor(req);
      requireStepUp(req);

      const body = req.body as CreateBodyShape;
      const gen = generateApiKey();
      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

      const created = await app.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(apiKeys)
          .values({
            label: body.label,
            tokenHash: gen.tokenHash,
            tokenPrefix: gen.tokenPrefix,
            role: body.role,
            readOnly: body.readOnly,
            createdByUserId: req.actor.id,
            expiresAt,
          })
          .returning({ id: apiKeys.id, createdAt: apiKeys.createdAt });
        const row = inserted[0];
        if (!row) throw new Error('api key insert returned no row');
        await tx.insert(auditLog).values({
          eventType: 'api_key.created',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
          payload: {
            apiKeyId: row.id,
            label: body.label,
            role: body.role,
            readOnly: body.readOnly,
            tokenPrefix: gen.tokenPrefix,
          },
        });
        return row;
      });

      return {
        ok: true as const,
        id: created.id,
        label: body.label,
        role: body.role,
        readOnly: body.readOnly,
        tokenPrefix: gen.tokenPrefix,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
        createdAt: created.createdAt.toISOString(),
        // The plaintext secret — shown ONCE here, never retrievable again.
        token: gen.token,
      };
    },
  );

  // ── GET /api/api-keys ─────────────────────────────────────────────────
  app.get(
    '/api/api-keys',
    { schema: { tags: ['auth'], summary: 'List API keys (metadata only).' } },
    async (req) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      refuseApiKeyActor(req);

      const rows = await app.db
        .select({
          id: apiKeys.id,
          label: apiKeys.label,
          tokenPrefix: apiKeys.tokenPrefix,
          role: apiKeys.role,
          readOnly: apiKeys.readOnly,
          expiresAt: apiKeys.expiresAt,
          lastUsedAt: apiKeys.lastUsedAt,
          revokedAt: apiKeys.revokedAt,
          createdAt: apiKeys.createdAt,
        })
        .from(apiKeys)
        .orderBy(desc(apiKeys.createdAt))
        .limit(200);

      return {
        items: rows.map((r) => ({
          id: r.id,
          label: r.label,
          tokenPrefix: r.tokenPrefix,
          role: r.role,
          readOnly: r.readOnly,
          expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
          lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
          revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  // ── POST /api/api-keys/:id/revoke ─────────────────────────────────────
  app.post(
    '/api/api-keys/:id/revoke',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke an API key.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
      },
    },
    async (req) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      refuseApiKeyActor(req);
      requireStepUp(req);

      const { id } = req.params as { id: string };
      const revoked = await app.db.transaction(async (tx) => {
        const res = await tx
          .update(apiKeys)
          .set({
            revokedAt: new Date(),
            revokedByUserId: req.actor.id,
            updatedAt: new Date(),
          })
          .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
          .returning({ id: apiKeys.id });
        if (res.length > 0) {
          await tx.insert(auditLog).values({
            eventType: 'api_key.revoked',
            actorUserId: req.actor.id,
            deviceId: req.deviceId ?? null,
            ipAddress: req.ip ?? null,
            userAgent: (req.headers['user-agent'] as string | undefined) ?? null,
            payload: { apiKeyId: id },
          });
        }
        return res.length > 0;
      });

      return { ok: true as const, revoked };
    },
  );
};

export default apiKeysRoutes;
