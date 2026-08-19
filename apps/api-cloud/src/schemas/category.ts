/**
 * TypeBox schemas for the Day-13 categories taxonomy routes.
 *
 *   GET    /api/categories                 — hierarchical tree
 *   POST   /api/categories                 — create
 *   PUT    /api/categories/:id             — update
 *   DELETE /api/categories/:id             — delete (404 if referenced)
 *
 * Plus the M:N assignment:
 *   POST   /api/products/:id/categories    — replace-all category assignments
 */

import { type Static, Type } from '@sinclair/typebox';

const Slug = Type.String({
  pattern: '^[a-z0-9]+(-[a-z0-9]+)*$',
  minLength: 1,
  maxLength: 64,
  description: 'URL-safe slug: lowercase, alphanumeric + dashes. Globally unique.',
});

export const CreateCategoryBody = Type.Object({
  slug: Slug,
  nameDe: Type.String({ minLength: 1, maxLength: 128 }),
  nameEn: Type.Optional(Type.String({ maxLength: 128 })),
  descriptionDe: Type.Optional(Type.String({ maxLength: 4096 })),
  descriptionEn: Type.Optional(Type.String({ maxLength: 4096 })),
  schemaOrgType: Type.Optional(Type.String({ maxLength: 64 })),
  displayOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 32767, default: 0 })),
  hiddenFromStorefront: Type.Optional(Type.Boolean({ default: false })),
  // A root (top-level) Sammlung has no parent: clients send `parentId: null`.
  // Accept null as well as a UUID (matching UpdateCategoryBody + the api-client
  // type `parentId?: string | null`); the handler already coalesces with `?? null`.
  // Without the Null() branch, creating a top-level category 400s on the operator.
  parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
});
export type TCreateCategoryBody = Static<typeof CreateCategoryBody>;

export const UpdateCategoryBody = Type.Object({
  slug: Type.Optional(Slug),
  nameDe: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  nameEn: Type.Optional(Type.Union([Type.String({ maxLength: 128 }), Type.Null()])),
  descriptionDe: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
  descriptionEn: Type.Optional(Type.Union([Type.String({ maxLength: 4096 }), Type.Null()])),
  schemaOrgType: Type.Optional(Type.Union([Type.String({ maxLength: 64 }), Type.Null()])),
  displayOrder: Type.Optional(Type.Integer({ minimum: 0, maximum: 32767 })),
  hiddenFromStorefront: Type.Optional(Type.Boolean()),
  parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
});
export type TUpdateCategoryBody = Static<typeof UpdateCategoryBody>;

// Tree node response shape — recursive via children: CategoryNode[].
// Defined as a forward ref so we can carry children typed cleanly.
export interface CategoryNodeShape {
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
  productCount: number;
  children: CategoryNodeShape[];
  createdAt: string;
  updatedAt: string;
}

// TypeBox cannot model recursive types perfectly; we use `Any` for `children`
// at the schema layer (route response runtime-validates via JSON shape).
export const CategoryNode = Type.Object({
  id: Type.String({ format: 'uuid' }),
  parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  slug: Type.String(),
  nameDe: Type.String(),
  nameEn: Type.Union([Type.String(), Type.Null()]),
  descriptionDe: Type.Union([Type.String(), Type.Null()]),
  descriptionEn: Type.Union([Type.String(), Type.Null()]),
  schemaOrgType: Type.Union([Type.String(), Type.Null()]),
  displayOrder: Type.Integer(),
  hiddenFromStorefront: Type.Boolean(),
  productCount: Type.Integer({ minimum: 0 }),
  children: Type.Array(Type.Any()),
  createdAt: Type.String({ format: 'date-time' }),
  updatedAt: Type.String({ format: 'date-time' }),
});

export const CategoryTreeResponse = Type.Object({
  roots: Type.Array(CategoryNode),
});

export const CategoryRefView = Type.Object({
  id: Type.String({ format: 'uuid' }),
  slug: Type.String(),
  nameDe: Type.String(),
  nameEn: Type.Union([Type.String(), Type.Null()]),
  isPrimary: Type.Boolean(),
});

// POST /api/products/:id/categories
export const SetProductCategoriesBody = Type.Object({
  categoryIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 32 }),
  primaryCategoryId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
});
export type TSetProductCategoriesBody = Static<typeof SetProductCategoriesBody>;

export const SetProductCategoriesResponse = Type.Object({
  productId: Type.String({ format: 'uuid' }),
  categories: Type.Array(CategoryRefView),
});
