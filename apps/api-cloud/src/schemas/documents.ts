/**
 * TypeBox schemas for the document_attachments API surface (Day 25).
 */

import { type Static, Type } from '@sinclair/typebox';

const DOCUMENT_CATEGORY = Type.Union([
  Type.Literal('AUSWEIS'),
  Type.Literal('ANKAUFBELEG'),
  Type.Literal('RECHNUNG'),
  Type.Literal('EXPERTISE'),
  Type.Literal('ZERTIFIKAT'),
  Type.Literal('VERSANDBELEG'),
]);

// ────────────────────────────────────────────────────────────────────────
// POST /api/documents
//
// V1: the front-end PUTs the file to R2 directly (signed URL), then POSTs
// the metadata + the linked entity id here. One — and only one — of the
// four context ids must be set. The route validates link-discipline and
// the DB CHECK enforces it as a defence-in-depth.
// ────────────────────────────────────────────────────────────────────────

export const CreateDocumentBody = Type.Object({
  category: DOCUMENT_CATEGORY,

  r2Key: Type.String({ minLength: 1, maxLength: 1024 }),
  fileName: Type.String({ minLength: 1, maxLength: 255 }),
  mimeType: Type.String({ minLength: 1, maxLength: 255 }),
  sizeBytes: Type.Integer({ minimum: 1, maximum: 100 * 1024 * 1024 /* 100 MB */ }),
  sha256Hex: Type.Optional(Type.String({ pattern: '^[0-9a-fA-F]{64}$' })),

  /** Exactly ONE of these four must be set (router-level + DB CHECK). */
  customerId: Type.Optional(Type.String({ format: 'uuid' })),
  productId: Type.Optional(Type.String({ format: 'uuid' })),
  transactionId: Type.Optional(Type.String({ format: 'uuid' })),
  appraisalId: Type.Optional(Type.String({ format: 'uuid' })),

  notes: Type.Optional(Type.String({ maxLength: 2000 })),
});

export const DocumentRow = Type.Object({
  id: Type.String({ format: 'uuid' }),
  category: DOCUMENT_CATEGORY,
  r2Key: Type.String(),
  fileName: Type.String(),
  mimeType: Type.String(),
  sizeBytes: Type.String({ description: 'bigint as decimal string' }),
  sha256Hex: Type.Union([Type.String(), Type.Null()]),
  customerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  productId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  transactionId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  appraisalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  uploadedByUserId: Type.String({ format: 'uuid' }),
  notes: Type.Union([Type.String(), Type.Null()]),
  archivedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});

export const CreateDocumentResponse = DocumentRow;

// ────────────────────────────────────────────────────────────────────────
// GET /api/documents — filter by category + linked entity
// ────────────────────────────────────────────────────────────────────────

export const ListDocumentsQuery = Type.Object({
  category: Type.Optional(DOCUMENT_CATEGORY),
  customerId: Type.Optional(Type.String({ format: 'uuid' })),
  productId: Type.Optional(Type.String({ format: 'uuid' })),
  transactionId: Type.Optional(Type.String({ format: 'uuid' })),
  appraisalId: Type.Optional(Type.String({ format: 'uuid' })),
  includeArchived: Type.Optional(Type.Boolean({ default: false })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

export const ListDocumentsResponse = Type.Object({
  items: Type.Array(DocumentRow),
  total: Type.Integer(),
  limit: Type.Integer(),
  offset: Type.Integer(),
  hasMore: Type.Boolean(),
});

// ────────────────────────────────────────────────────────────────────────
// POST /api/documents/:id/archive
// ────────────────────────────────────────────────────────────────────────

export const DocumentIdParams = Type.Object({ id: Type.String({ format: 'uuid' }) });

export type TCreateDocumentBody = Static<typeof CreateDocumentBody>;
export type TListDocumentsQuery = Static<typeof ListDocumentsQuery>;
export type TDocumentIdParams = Static<typeof DocumentIdParams>;
