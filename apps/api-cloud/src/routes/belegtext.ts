/**
 * Belegtext-templates routes (Day 26, Backend Finale).
 *
 *   GET   /api/belegtext-templates           — list (filters: kind, language,
 *                                              currentOnly), ADMIN+CASHIER
 *   GET   /api/belegtext-templates/current   — single CURRENT row by (kind, lang)
 *   GET   /api/belegtext-templates/resolve   — by tax_treatment_code (for the
 *                                              receipt printer)
 *   POST  /api/belegtext-templates           — publish a new version
 *                                              (Owner, close-out
 *                                              + insert in one TX, audited)
 */

import { Type } from '@sinclair/typebox';
import { type SQL, and, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, belegtextTemplates } from '@norns/db/schema';

import { requireAuth, requireOwner, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CurrentBelegtextQuery,
  CurrentBelegtextResponse,
  ListBelegtextQuery,
  ListBelegtextResponse,
  PublishBelegtextBody,
  PublishBelegtextResponse,
  ResolveBelegtextQuery,
  ResolveBelegtextResponse,
  type TCurrentBelegtextQuery,
  type TListBelegtextQuery,
  type TPublishBelegtextBody,
  type TResolveBelegtextQuery,
} from '../schemas/belegtext.js';

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

type BelegtextRowDb = typeof belegtextTemplates.$inferSelect;

function serializeBelegtext(row: BelegtextRowDb): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    language: row.language,
    bodyText: row.bodyText,
    validFrom: row.validFrom.toISOString(),
    validTo: row.validTo ? row.validTo.toISOString() : null,
    createdByUserId: row.createdByUserId,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

const belegtextRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // GET /api/belegtext-templates
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TListBelegtextQuery }>(
    '/api/belegtext-templates',
    {
      schema: {
        tags: ['belegtext'],
        summary: 'List belegtext templates (filters: kind, language, currentOnly).',
        querystring: ListBelegtextQuery,
        response: { 200: ListBelegtextResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const q = req.query;
      const currentOnly = q.currentOnly ?? true;
      const preds: Array<SQL | undefined> = [
        q.kind !== undefined ? eq(belegtextTemplates.kind, q.kind) : undefined,
        q.language !== undefined ? eq(belegtextTemplates.language, q.language) : undefined,
        currentOnly ? drizzleSql`${belegtextTemplates.validTo} IS NULL` : undefined,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      const rows = await app.db
        .select()
        .from(belegtextTemplates)
        .where(whereClause)
        .orderBy(desc(belegtextTemplates.validFrom));

      return reply.status(200).send({ items: rows.map(serializeBelegtext) });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/belegtext-templates/current
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TCurrentBelegtextQuery }>(
    '/api/belegtext-templates/current',
    {
      schema: {
        tags: ['belegtext'],
        summary: 'Fetch the current template for a (kind, language).',
        querystring: CurrentBelegtextQuery,
        response: { 200: CurrentBelegtextResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const language = req.query.language ?? 'de';
      const [row] = await app.db
        .select({ bodyText: belegtextTemplates.bodyText })
        .from(belegtextTemplates)
        .where(
          and(
            eq(belegtextTemplates.kind, req.query.kind),
            eq(belegtextTemplates.language, language),
            drizzleSql`${belegtextTemplates.validTo} IS NULL`,
          ),
        )
        .limit(1);

      return reply.status(200).send({
        kind: req.query.kind,
        language,
        bodyText: row?.bodyText ?? null,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/belegtext-templates/resolve?taxTreatmentCode=&language=
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TResolveBelegtextQuery }>(
    '/api/belegtext-templates/resolve',
    {
      schema: {
        tags: ['belegtext'],
        summary: 'Resolve the current belegtext for a tax_treatment_codes.code.',
        description:
          'Uses the SQL helper resolve_belegtext_for_tax_treatment(code, language). ' +
          'Returns NULL when no template is configured.',
        querystring: ResolveBelegtextQuery,
        response: { 200: ResolveBelegtextResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const language = req.query.language ?? 'de';
      const rows = await app.db.execute<{ body: string | null }>(
        drizzleSql`SELECT resolve_belegtext_for_tax_treatment(${req.query.taxTreatmentCode}, ${language}) AS body`,
      );
      const row = (rows as unknown as Array<{ body: string | null }>)[0];
      return reply.status(200).send({
        taxTreatmentCode: req.query.taxTreatmentCode,
        language,
        bodyText: row?.body ?? null,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/belegtext-templates  (Owner)
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TPublishBelegtextBody }>(
    '/api/belegtext-templates',
    {
      schema: {
        tags: ['belegtext'],
        summary: 'Publish a new belegtext version (close-out + insert).',
        description:
          'Owner-only. In one DB transaction, the existing ' +
          'CURRENT row for (kind, language) is closed with valid_to = now() and ' +
          'a new CURRENT row is inserted. Writes `belegtext.published` audit_log.',
        body: PublishBelegtextBody,
        response: {
          200: PublishBelegtextResponse,
          400: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwner(req);

      const { deviceId } = req;
      if (deviceId == null) {
        throw new DeviceRequiredError('Publishing belegtexts requires an mTLS-paired device.');
      }
      const actorId = req.actor.id;
      const language = req.body.language ?? 'de';

      const result = await app.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            id: belegtextTemplates.id,
            bodyText: belegtextTemplates.bodyText,
          })
          .from(belegtextTemplates)
          .where(
            and(
              eq(belegtextTemplates.kind, req.body.kind),
              eq(belegtextTemplates.language, language),
              drizzleSql`${belegtextTemplates.validTo} IS NULL`,
            ),
          )
          .limit(1);

        if (current) {
          await tx
            .update(belegtextTemplates)
            .set({ validTo: drizzleSql`now()` })
            .where(eq(belegtextTemplates.id, current.id));
        }

        const [inserted] = await tx
          .insert(belegtextTemplates)
          .values({
            kind: req.body.kind,
            language,
            bodyText: req.body.bodyText,
            createdByUserId: actorId,
            notes: req.body.notes ?? null,
          })
          .returning({
            kind: belegtextTemplates.kind,
            language: belegtextTemplates.language,
            validFrom: belegtextTemplates.validFrom,
          });
        if (!inserted) throw new Error('belegtext_templates INSERT returned no row');

        await tx.insert(auditLog).values({
          eventType: 'belegtext.published',
          actorUserId: actorId,
          deviceId,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            kind: req.body.kind,
            language,
            bodyTextLength: req.body.bodyText.length,
            replacedPrevious: current != null,
          },
        });

        return {
          kind: inserted.kind,
          language: inserted.language,
          validFrom: inserted.validFrom.toISOString(),
          previousBodyText: current?.bodyText ?? null,
        };
      });

      return reply.status(200).send(result);
    },
  );
};

export default belegtextRoutes;
