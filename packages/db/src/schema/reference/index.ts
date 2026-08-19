/**
 * reference/ — slowly-changing reference data shared across the schema.
 *
 * Discipline (Basel Day-3 directive 2026-05-24):
 *   • READ-ONLY for the runtime app role. SELECT only.
 *   • All updates land via migration (or a future admin-graented role).
 *
 * See migration 0005_reference.sql for the SQL + seed data.
 */

export * from './taxTreatmentCodes.js';
export * from './karatGrades.js';
export * from './hallmarks.js';
