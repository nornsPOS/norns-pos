/**
 * Document-attachments routes — Single-Operator Assistance (Day 25).
 *
 *   POST /api/documents                — create attachment row pointing at
 *                                        an already-uploaded R2 object,
 *                                        auto-linked to ONE entity
 *   GET  /api/documents                — list/filter (category + entity)
 *   GET  /api/customers/:id/documents  — sugar: filter by customer
 *   GET  /api/products/:id/documents   — sugar: filter by product
 *   GET  /api/transactions/:id/documents
 *   GET  /api/appraisals/:id/documents
 *   POST /api/documents/:id/archive    — Owner-only soft-delete, audited
 *
 * The R2 byte stream is uploaded by the Tauri client via a signed URL
 * (R2 client lives in apps/api-cloud/src/lib/r2.ts). This route only
 * touches metadata + the audit_log row that links the upload to an actor.
 */

import { Type } from '@sinclair/typebox';
import { type SQL, and, count, desc, sql as drizzleSql, eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog, documentAttachments } from '@norns/db/schema';

import { requireAuth, requireOwner, requireRole } from '../lib/auth-policy.js';
import { DocumentLinkError, resolveDocumentLink } from '../lib/auto-fill.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  CreateDocumentBody,
  CreateDocumentResponse,
  DocumentIdParams,
  ListDocumentsQuery,
  ListDocumentsResponse,
  type TCreateDocumentBody,
  type TDocumentIdParams,
  type TListDocumentsQuery,
} from '../schemas/documents.js';

class DocumentNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class DocumentValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

type DocRowDb = typeof documentAttachments.$inferSelect;

function serializeDoc(row: DocRowDb): Record<string, unknown> {
  return {
    id: row.id,
    category: row.category,
    r2Key: row.r2Key,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes.toString(),
    sha256Hex: row.sha256Hex,
    customerId: row.customerId,
    productId: row.productId,
    transactionId: row.transactionId,
    appraisalId: row.appraisalId,
    uploadedByUserId: row.uploadedByUserId,
    notes: row.notes,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const documentsRoutes: FastifyPluginAsync = async (app) => {
  // ────────────────────────────────────────────────────────────────────
  // POST /api/documents
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Body: TCreateDocumentBody }>(
    '/api/documents',
    {
      schema: {
        tags: ['documents'],
        summary: 'Register an uploaded R2 object as a typed attachment.',
        description:
          'V1 flow: client (Tauri) PUTs bytes to R2 via signed URL, then POSTs ' +
          'metadata here. Exactly ONE of customerId / productId / transactionId / ' +
          'appraisalId must be set; category-specific link discipline enforced.',
        body: CreateDocumentBody,
        response: {
          200: CreateDocumentResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const body = req.body;
      const actorId = req.actor.id;

      let link;
      try {
        link = resolveDocumentLink({
          customerId: body.customerId ?? null,
          productId: body.productId ?? null,
          transactionId: body.transactionId ?? null,
          appraisalId: body.appraisalId ?? null,
        });
      } catch (err) {
        if (err instanceof DocumentLinkError) {
          throw new DocumentValidationError(err.message);
        }
        throw err;
      }

      const result = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(documentAttachments)
          .values({
            category: body.category,
            r2Key: body.r2Key,
            fileName: body.fileName,
            mimeType: body.mimeType,
            sizeBytes: BigInt(body.sizeBytes),
            sha256Hex: body.sha256Hex ?? null,
            customerId: link.customerId,
            productId: link.productId,
            transactionId: link.transactionId,
            appraisalId: link.appraisalId,
            uploadedByUserId: actorId,
            notes: body.notes ?? null,
          })
          .returning();
        if (!row) throw new Error('document_attachments INSERT returned no row');

        await tx.insert(auditLog).values({
          eventType: 'document.uploaded',
          actorUserId: actorId,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: {
            documentId: row.id,
            category: row.category,
            fileName: row.fileName,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes.toString(),
            customerId: row.customerId,
            productId: row.productId,
            transactionId: row.transactionId,
            appraisalId: row.appraisalId,
          },
        });

        return row;
      });

      return reply.status(200).send(serializeDoc(result));
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // GET /api/documents (with filters)
  // ────────────────────────────────────────────────────────────────────
  app.get<{ Querystring: TListDocumentsQuery }>(
    '/api/documents',
    {
      schema: {
        tags: ['documents'],
        summary: 'List documents (paged, filtered).',
        querystring: ListDocumentsQuery,
        response: { 200: ListDocumentsResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const q = req.query;
      const limit = q.limit ?? 50;
      const offset = q.offset ?? 0;
      const includeArchived = q.includeArchived ?? false;

      const preds: Array<SQL | undefined> = [
        q.category !== undefined ? eq(documentAttachments.category, q.category) : undefined,
        q.customerId !== undefined ? eq(documentAttachments.customerId, q.customerId) : undefined,
        q.productId !== undefined ? eq(documentAttachments.productId, q.productId) : undefined,
        q.transactionId !== undefined
          ? eq(documentAttachments.transactionId, q.transactionId)
          : undefined,
        q.appraisalId !== undefined
          ? eq(documentAttachments.appraisalId, q.appraisalId)
          : undefined,
        includeArchived ? undefined : drizzleSql`${documentAttachments.archivedAt} IS NULL`,
      ];
      const whereClause = preds.some((p) => p !== undefined) ? and(...preds) : undefined;

      const [rows, totalRow] = await Promise.all([
        app.db
          .select()
          .from(documentAttachments)
          .where(whereClause)
          .orderBy(desc(documentAttachments.createdAt))
          .limit(limit)
          .offset(offset),
        app.db.select({ n: count() }).from(documentAttachments).where(whereClause),
      ]);

      const total = Number(totalRow[0]?.n ?? 0);
      return reply.status(200).send({
        items: rows.map(serializeDoc),
        total,
        limit,
        offset,
        hasMore: offset + rows.length < total,
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // Sugar endpoints: /api/<entity>/:id/documents
  // ────────────────────────────────────────────────────────────────────

  const sugarParams = Type.Object({ id: Type.String({ format: 'uuid' }) });
  type SugarParams = { id: string };

  async function fetchByLink(
    column: 'customerId' | 'productId' | 'transactionId' | 'appraisalId',
    id: string,
  ) {
    const rows = await app.db
      .select()
      .from(documentAttachments)
      .where(
        and(
          eq(documentAttachments[column], id),
          drizzleSql`${documentAttachments.archivedAt} IS NULL`,
        ),
      )
      .orderBy(desc(documentAttachments.createdAt));
    return rows.map(serializeDoc);
  }

  app.get<{ Params: SugarParams }>(
    '/api/customers/:id/documents',
    {
      schema: {
        tags: ['documents', 'customers'],
        summary: 'All non-archived documents pinned to this customer.',
        params: sugarParams,
        response: { 200: Type.Object({ items: Type.Array(Type.Unknown()) }) },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      return reply.status(200).send({ items: await fetchByLink('customerId', req.params.id) });
    },
  );

  app.get<{ Params: SugarParams }>(
    '/api/products/:id/documents',
    {
      schema: {
        tags: ['documents', 'products'],
        summary: 'All non-archived documents pinned to this product.',
        params: sugarParams,
        response: { 200: Type.Object({ items: Type.Array(Type.Unknown()) }) },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      return reply.status(200).send({ items: await fetchByLink('productId', req.params.id) });
    },
  );

  app.get<{ Params: SugarParams }>(
    '/api/transactions/:id/documents',
    {
      schema: {
        tags: ['documents', 'transactions'],
        summary: 'All non-archived documents pinned to this transaction.',
        params: sugarParams,
        response: { 200: Type.Object({ items: Type.Array(Type.Unknown()) }) },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      return reply.status(200).send({ items: await fetchByLink('transactionId', req.params.id) });
    },
  );

  app.get<{ Params: SugarParams }>(
    '/api/appraisals/:id/documents',
    {
      schema: {
        tags: ['documents', 'appraisals'],
        summary: 'All non-archived documents pinned to this appraisal.',
        params: sugarParams,
        response: { 200: Type.Object({ items: Type.Array(Type.Unknown()) }) },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');
      return reply.status(200).send({ items: await fetchByLink('appraisalId', req.params.id) });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // POST /api/documents/:id/archive (Owner-only)
  // ────────────────────────────────────────────────────────────────────
  app.post<{ Params: TDocumentIdParams }>(
    '/api/documents/:id/archive',
    {
      schema: {
        tags: ['documents'],
        summary: 'Soft-delete a document (Owner-only). Audited.',
        params: DocumentIdParams,
        response: { 200: Type.Object({ archivedAt: Type.String() }), 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireOwner(req);

      const result = await app.db.transaction(async (tx) => {
        const [row] = await tx
          .update(documentAttachments)
          .set({ archivedAt: drizzleSql`now()` })
          .where(
            and(
              eq(documentAttachments.id, req.params.id),
              drizzleSql`${documentAttachments.archivedAt} IS NULL`,
            ),
          )
          .returning({ id: documentAttachments.id, archivedAt: documentAttachments.archivedAt });
        if (!row)
          throw new DocumentNotFoundError(
            `Document ${req.params.id} not found or already archived`,
          );

        await tx.insert(auditLog).values({
          eventType: 'document.archived',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          payload: { documentId: row.id },
        });
        return row;
      });

      return reply.status(200).send({
        archivedAt: result.archivedAt!.toISOString(),
      });
    },
  );
};

export default documentsRoutes;
