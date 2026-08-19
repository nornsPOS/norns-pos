/**
 * Categories routes (Day 13, Phase 2.B kick-off).
 *
 *   GET    /api/categories             — hierarchical tree (cashier + admin)
 *   POST   /api/categories             — create (ADMIN)
 *   PUT    /api/categories/:id         — update (ADMIN)
 *   DELETE /api/categories/:id         — delete (ADMIN). FK ON DELETE RESTRICT
 *                                        surfaces as 409 CONFLICT when
 *                                        product_categories references the id.
 *
 * Hierarchy cap: the DB trigger `enforce_no_grandparent_category` (relaxed
 * to 3 levels in migration 0063 — Briefmarken → Altdeutschland → states)
 * refuses any INSERT/UPDATE that would create a 4th level. Route also
 * pre-checks for a friendlier 400 message.
 *
 * No step-up — categories are operator-curated, not security-sensitive
 * (no PII, no fiscal impact, no inventory mutation).
 */

import { Type } from '@sinclair/typebox';
import { count, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  categories as categoriesTable,
  productCategories as productCategoriesTable,
} from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  type CategoryNodeShape,
  CategoryTreeResponse,
  CreateCategoryBody,
  type TCreateCategoryBody,
  type TUpdateCategoryBody,
  UpdateCategoryBody,
} from '../schemas/category.js';

class CategoryNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class CategoryConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class CategoryValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: { field: string; reason: string };
  public constructor(field: string, reason: string) {
    super(`Category validation failed for "${field}": ${reason}`);
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

// Use `type` (not `interface`) + intersection so Drizzle's
// `execute<T extends Record<string, unknown>>` constraint is satisfied
// while keeping precise per-column types.
type FlatCategoryRow = {
  id: string;
  parent_id: string | null;
  slug: string;
  name_de: string;
  name_en: string | null;
  description_de: string | null;
  description_en: string | null;
  schema_org_type: string | null;
  display_order: number;
  hidden_from_storefront: boolean;
  product_count: number;
  created_at: Date;
  updated_at: Date;
} & Record<string, unknown>;

function rowToNode(row: FlatCategoryRow): CategoryNodeShape {
  return {
    id: row.id,
    parentId: row.parent_id,
    slug: row.slug,
    nameDe: row.name_de,
    nameEn: row.name_en,
    descriptionDe: row.description_de,
    descriptionEn: row.description_en,
    schemaOrgType: row.schema_org_type,
    displayOrder: row.display_order,
    hiddenFromStorefront: row.hidden_from_storefront,
    productCount: Number(row.product_count),
    children: [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function composeTree(rows: FlatCategoryRow[]): CategoryNodeShape[] {
  const byId = new Map<string, CategoryNodeShape>();
  for (const r of rows) byId.set(r.id, rowToNode(r));

  const roots: CategoryNodeShape[] = [];
  for (const node of byId.values()) {
    if (node.parentId === null) {
      roots.push(node);
    } else {
      const parent = byId.get(node.parentId);
      if (parent) parent.children.push(node);
      else roots.push(node); // orphan — should not happen but render defensively
    }
  }
  return roots;
}

const categoriesRoutes: FastifyPluginAsync = async (app) => {
  // ════════════════════════════════════════════════════════════════════
  // GET /api/categories — hierarchical tree
  // ════════════════════════════════════════════════════════════════════
  app.get(
    '/api/categories',
    {
      schema: {
        tags: ['categories'],
        summary: 'Hierarchical category tree with product counts.',
        response: { 200: CategoryTreeResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // Single query: categories + product-count via LEFT JOIN GROUP BY.
      const rows = await app.db.execute<FlatCategoryRow>(sql`
      SELECT
        c.id,
        c.parent_id,
        c.slug,
        c.name_de,
        c.name_en,
        c.description_de,
        c.description_en,
        c.schema_org_type,
        c.display_order,
        c.hidden_from_storefront,
        COALESCE(pc.product_count, 0)::int AS product_count,
        c.created_at,
        c.updated_at
      FROM categories c
      LEFT JOIN (
        SELECT category_id, COUNT(*) AS product_count
        FROM product_categories
        GROUP BY category_id
      ) pc ON pc.category_id = c.id
      ORDER BY c.parent_id NULLS FIRST, c.display_order, c.name_de
    `);

      const tree = composeTree(Array.from(rows));
      return reply.status(200).send({ roots: tree });
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // POST /api/categories — create
  // ════════════════════════════════════════════════════════════════════
  app.post<{ Body: TCreateCategoryBody }>(
    '/api/categories',
    {
      schema: {
        tags: ['categories'],
        summary: 'Create a category (ADMIN). Hierarchy capped at 3 levels.',
        body: CreateCategoryBody,
        response: {
          200: Type.Object({ id: Type.String({ format: 'uuid' }) }),
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const body = req.body;

      // Pre-check 3-level cap for a friendlier error (the DB trigger is the
      // authoritative gate). A parent at depth 1 or 2 is fine; a parent at
      // depth 3 (its grandparent exists) would create a 4th level.
      if (body.parentId) {
        const [parent] = await app.db
          .select({ parentId: categoriesTable.parentId })
          .from(categoriesTable)
          .where(eq(categoriesTable.id, body.parentId))
          .limit(1);
        if (!parent) {
          throw new CategoryValidationError('parentId', 'Parent category not found.');
        }
        if (parent.parentId !== null) {
          const [grandparent] = await app.db
            .select({ parentId: categoriesTable.parentId })
            .from(categoriesTable)
            .where(eq(categoriesTable.id, parent.parentId))
            .limit(1);
          if (grandparent && grandparent.parentId !== null) {
            throw new CategoryValidationError(
              'parentId',
              'Hierarchy capped at 3 levels — cannot nest a 4th level.',
            );
          }
        }
      }

      try {
        const [row] = await app.db
          .insert(categoriesTable)
          .values({
            slug: body.slug,
            nameDe: body.nameDe,
            nameEn: body.nameEn ?? null,
            descriptionDe: body.descriptionDe ?? null,
            descriptionEn: body.descriptionEn ?? null,
            schemaOrgType: body.schemaOrgType ?? null,
            displayOrder: body.displayOrder ?? 0,
            hiddenFromStorefront: body.hiddenFromStorefront ?? false,
            parentId: body.parentId ?? null,
          })
          .returning({ id: categoriesTable.id });
        if (!row) throw new Error('category INSERT returned no row');
        return reply.status(200).send({ id: row.id });
      } catch (err) {
        // 23505 = unique_violation (slug already exists)
        if (err instanceof Error && err.message.includes('categories_slug_uq')) {
          throw new CategoryConflictError(`Slug "${body.slug}" already exists.`);
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // PUT /api/categories/:id — update
  // ════════════════════════════════════════════════════════════════════
  app.put<{ Params: { id: string }; Body: TUpdateCategoryBody }>(
    '/api/categories/:id',
    {
      schema: {
        tags: ['categories'],
        summary: 'Update a category (ADMIN).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: UpdateCategoryBody,
        response: {
          200: Type.Object({ id: Type.String({ format: 'uuid' }) }),
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const body = req.body;
      const id = req.params.id;

      if (Object.keys(body).length === 0) {
        throw new CategoryValidationError('body', 'At least one field is required.');
      }

      // Pre-check 3-level cap when parent_id changes.
      if (body.parentId !== undefined && body.parentId !== null) {
        if (body.parentId === id) {
          throw new CategoryValidationError('parentId', 'A category cannot be its own parent.');
        }
        const [parent] = await app.db
          .select({ parentId: categoriesTable.parentId })
          .from(categoriesTable)
          .where(eq(categoriesTable.id, body.parentId))
          .limit(1);
        if (!parent) throw new CategoryValidationError('parentId', 'Parent category not found.');
        if (parent.parentId !== null) {
          const [grandparent] = await app.db
            .select({ parentId: categoriesTable.parentId })
            .from(categoriesTable)
            .where(eq(categoriesTable.id, parent.parentId))
            .limit(1);
          if (grandparent && grandparent.parentId !== null) {
            throw new CategoryValidationError(
              'parentId',
              'Hierarchy capped at 3 levels — cannot nest a 4th level.',
            );
          }
        }
      }

      const updates: Partial<typeof categoriesTable.$inferInsert> = {};
      if (body.slug !== undefined) updates.slug = body.slug;
      if (body.nameDe !== undefined) updates.nameDe = body.nameDe;
      if (body.nameEn !== undefined) updates.nameEn = body.nameEn;
      if (body.descriptionDe !== undefined) updates.descriptionDe = body.descriptionDe;
      if (body.descriptionEn !== undefined) updates.descriptionEn = body.descriptionEn;
      if (body.schemaOrgType !== undefined) updates.schemaOrgType = body.schemaOrgType;
      if (body.displayOrder !== undefined) updates.displayOrder = body.displayOrder;
      if (body.hiddenFromStorefront !== undefined)
        updates.hiddenFromStorefront = body.hiddenFromStorefront;
      if (body.parentId !== undefined) updates.parentId = body.parentId;

      try {
        const result = await app.db
          .update(categoriesTable)
          .set(updates)
          .where(eq(categoriesTable.id, id))
          .returning({ id: categoriesTable.id });
        const updated = result[0];
        if (!updated) throw new CategoryNotFoundError(`Category ${id} not found.`);
        return reply.status(200).send({ id: updated.id });
      } catch (err) {
        if (err instanceof Error && err.message.includes('categories_slug_uq')) {
          throw new CategoryConflictError(`Slug "${body.slug}" already exists.`);
        }
        throw err;
      }
    },
  );

  // ════════════════════════════════════════════════════════════════════
  // DELETE /api/categories/:id
  // ════════════════════════════════════════════════════════════════════
  app.delete<{ Params: { id: string } }>(
    '/api/categories/:id',
    {
      schema: {
        tags: ['categories'],
        summary: 'Delete a category (ADMIN). Refuses when products reference it.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: {
          204: Type.Null(),
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      const id = req.params.id;

      // Friendly 409 if any product points at this category — beats raw 23503.
      const [referenced] = await app.db
        .select({ n: count() })
        .from(productCategoriesTable)
        .where(eq(productCategoriesTable.categoryId, id));
      if (referenced && Number(referenced.n) > 0) {
        throw new CategoryConflictError(
          `Category ${id} is assigned to ${referenced.n} product(s). Unassign first.`,
        );
      }

      // Also refuse if a child category exists (ON DELETE RESTRICT would
      // throw 23503 — we surface friendlier).
      const [childCount] = await app.db
        .select({ n: count() })
        .from(categoriesTable)
        .where(eq(categoriesTable.parentId, id));
      if (childCount && Number(childCount.n) > 0) {
        throw new CategoryConflictError(
          `Category ${id} has ${childCount.n} subcategory/-ies. Delete or re-parent first.`,
        );
      }

      const result = await app.db
        .delete(categoriesTable)
        .where(eq(categoriesTable.id, id))
        .returning({ id: categoriesTable.id });
      if (!result[0]) throw new CategoryNotFoundError(`Category ${id} not found.`);

      return reply.status(204).send();
    },
  );

  // Silence the unused isNull import in tree-only paths.
  void isNull;
};

export default categoriesRoutes;
