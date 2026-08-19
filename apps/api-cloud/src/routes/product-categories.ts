/**
 * POST /api/products/:id/categories — Day 13.
 *
 * Atomic replace-all of category assignments. Body:
 *   { categoryIds: string[], primaryCategoryId: string | null }
 *
 * primaryCategoryId, when set, MUST appear in categoryIds. The route:
 *   1. Validates input (FKs + primary subset)
 *   2. DELETE existing rows for this product
 *   3. INSERT new rows with is_primary=TRUE for the chosen primary
 *   4. Returns the resolved category refs (with i18n names)
 *
 * All inside one DB transaction → the partial UNIQUE
 * `product_categories_one_primary_uq` never sees a transient
 * two-primaries state.
 */

import { Type } from '@sinclair/typebox';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  categories as categoriesTable,
  productCategories as productCategoriesTable,
  products,
} from '@norns/db/schema';

import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import {
  SetProductCategoriesBody,
  SetProductCategoriesResponse,
  type TSetProductCategoriesBody,
} from '../schemas/category.js';

class ProductNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class CategoryValidationError extends DomainError {
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

const productCategoriesRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string }; Body: TSetProductCategoriesBody }>(
    '/api/products/:id/categories',
    {
      schema: {
        tags: ['products'],
        summary: 'Atomic replace-all of category assignments for a product.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: SetProductCategoriesBody,
        response: {
          200: SetProductCategoriesResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const { id: productId } = req.params;
      const body = req.body;

      // Validate primary ⊆ categoryIds
      if (body.primaryCategoryId !== null && !body.categoryIds.includes(body.primaryCategoryId)) {
        throw new CategoryValidationError(
          'primaryCategoryId',
          'primaryCategoryId must appear in categoryIds.',
        );
      }
      // Reject duplicate categoryIds
      const unique = new Set(body.categoryIds);
      if (unique.size !== body.categoryIds.length) {
        throw new CategoryValidationError('categoryIds', 'Duplicate category ids are not allowed.');
      }

      const result = await app.db.transaction(async (tx) => {
        // 1. Product must exist.
        const [exists] = await tx
          .select({ id: products.id })
          .from(products)
          .where(eq(products.id, productId))
          .limit(1);
        if (!exists) throw new ProductNotFoundError(`Product ${productId} not found.`);

        // 2. Validate categoryIds reference real rows. One query.
        if (body.categoryIds.length > 0) {
          const found = await tx
            .select({ id: categoriesTable.id })
            .from(categoriesTable)
            .where(inArray(categoriesTable.id, body.categoryIds));
          if (found.length !== body.categoryIds.length) {
            const foundSet = new Set(found.map((r) => r.id));
            const missing = body.categoryIds.filter((id) => !foundSet.has(id));
            throw new CategoryValidationError(
              'categoryIds',
              `Unknown category ids: ${missing.join(', ')}`,
            );
          }
        }

        // 3. Replace-all.
        await tx
          .delete(productCategoriesTable)
          .where(eq(productCategoriesTable.productId, productId));

        if (body.categoryIds.length > 0) {
          await tx.insert(productCategoriesTable).values(
            body.categoryIds.map((categoryId) => ({
              productId,
              categoryId,
              isPrimary: categoryId === body.primaryCategoryId,
            })),
          );
        }

        // 4. Resolve refs for the response.
        if (body.categoryIds.length === 0) return [];
        const refs = await tx
          .select({
            id: categoriesTable.id,
            slug: categoriesTable.slug,
            nameDe: categoriesTable.nameDe,
            nameEn: categoriesTable.nameEn,
          })
          .from(categoriesTable)
          .where(inArray(categoriesTable.id, body.categoryIds));
        return refs.map((r) => ({
          id: r.id,
          slug: r.slug,
          nameDe: r.nameDe,
          nameEn: r.nameEn,
          isPrimary: r.id === body.primaryCategoryId,
        }));
      });

      return reply.status(200).send({ productId, categories: result });
    },
  );
};

export default productCategoriesRoute;
