/**
 * categories/ — Day-13 commerce taxonomy.
 *
 * 2-level hierarchy (`categories.parent_id` self-FK) + M:N product join
 * (`product_categories`) with partial UNIQUE primary flag. Migration
 * 0025 added both tables. See memory.md §17.
 */

export * from './categories.js';
export * from './productCategories.js';
