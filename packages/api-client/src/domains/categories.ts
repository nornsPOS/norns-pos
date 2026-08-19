/**
 * Categories domain client (Day 13, Phase 2.B kick-off).
 *
 *   tree()                — GET    /api/categories
 *   create(body)          — POST   /api/categories                ADMIN
 *   update(id, body)      — PUT    /api/categories/:id            ADMIN
 *   remove(id)            — DELETE /api/categories/:id            ADMIN
 *   setForProduct(id, b)  — POST   /api/products/:id/categories   atomic replace
 *
 * 2-level hierarchy:
 *   • Roots have parent_id === null.
 *   • Leaf nodes have parent_id pointing to a root.
 *   • The backend trigger refuses any attempt at grandchildren — see
 *     `enforce_no_grandparent_category` in migration 0025.
 *
 * No step-up required — taxonomy is operator-curated; no PII / fiscal impact.
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// Tree response (recursive 2-level structure)
// ────────────────────────────────────────────────────────────────────────

export interface CategoryNode {
  id: string;
  parentId: string | null;
  slug: string;
  nameDe: string;
  nameEn: string | null;
  descriptionDe: string | null;
  descriptionEn: string | null;
  schemaOrgType: string | null;
  displayOrder: number;
  hiddenFromStorefront: boolean;
  /** Count of products filed under this node (NOT inclusive of children). */
  productCount: number;
  children: CategoryNode[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryTreeResponse {
  /** Top-level (parentId === null) nodes. Each may carry children[]. */
  roots: CategoryNode[];
  /** Server-side computed total — useful for "X Sammlungen" hints. */
  totalCount: number;
}

// ────────────────────────────────────────────────────────────────────────
// CRUD bodies
// ────────────────────────────────────────────────────────────────────────

export interface CreateCategoryBody {
  /** URL-friendly identifier: ^[a-z0-9]+(-[a-z0-9]+)*$ */
  slug: string;
  nameDe: string;
  nameEn?: string | null;
  descriptionDe?: string | null;
  descriptionEn?: string | null;
  /** null = root node; otherwise must reference an existing root. */
  parentId?: string | null;
  /** Schema.org type for storefront JSON-LD (e.g. "Product", "Collection"). */
  schemaOrgType?: string | null;
  displayOrder?: number;
  hiddenFromStorefront?: boolean;
}

export interface CreateCategoryResponse {
  id: string;
  slug: string;
  createdAt: string;
}

export interface UpdateCategoryBody {
  slug?: string;
  nameDe?: string;
  nameEn?: string | null;
  descriptionDe?: string | null;
  descriptionEn?: string | null;
  /** Pass null to promote to root; pass another root's id to re-parent. */
  parentId?: string | null;
  schemaOrgType?: string | null;
  displayOrder?: number;
  hiddenFromStorefront?: boolean;
}

export interface UpdateCategoryResponse {
  id: string;
  updatedAt: string;
  changedFields: string[];
}

export interface DeleteCategoryResponse {
  id: string;
  deletedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Product ↔ Category assignment (REPLACE-ALL semantics)
// ────────────────────────────────────────────────────────────────────────

export interface SetProductCategoriesBody {
  /**
   * Full set of category ids the product should belong to AFTER the call.
   * Pass `[]` to clear all assignments.
   */
  categoryIds: string[];
  /**
   * Which of `categoryIds` is the "primary" category. Surfaces in the
   * storefront breadcrumb hint. MUST be present in `categoryIds` if
   * categoryIds is non-empty.
   */
  primaryCategoryId: string | null;
}

export interface SetProductCategoriesResponse {
  productId: string;
  assignments: Array<{
    categoryId: string;
    isPrimary: boolean;
  }>;
  updatedAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// Methods
// ────────────────────────────────────────────────────────────────────────

export const categoriesApi = {
  tree(client: ApiClient): Promise<CategoryTreeResponse> {
    return client.request<CategoryTreeResponse>('GET', '/api/categories');
  },
  create(client: ApiClient, body: CreateCategoryBody): Promise<CreateCategoryResponse> {
    return client.request<CreateCategoryResponse>('POST', '/api/categories', body);
  },
  update(client: ApiClient, id: string, body: UpdateCategoryBody): Promise<UpdateCategoryResponse> {
    return client.request<UpdateCategoryResponse>(
      'PUT',
      `/api/categories/${encodeURIComponent(id)}`,
      body,
    );
  },
  remove(client: ApiClient, id: string): Promise<DeleteCategoryResponse> {
    return client.request<DeleteCategoryResponse>(
      'DELETE',
      `/api/categories/${encodeURIComponent(id)}`,
    );
  },
  setForProduct(
    client: ApiClient,
    productId: string,
    body: SetProductCategoriesBody,
  ): Promise<SetProductCategoriesResponse> {
    return client.request<SetProductCategoriesResponse>(
      'POST',
      `/api/products/${encodeURIComponent(productId)}/categories`,
      body,
    );
  },
};
