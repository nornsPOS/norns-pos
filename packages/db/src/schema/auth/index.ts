/**
 * auth/ — authentication, identity, and device pairing schema.
 *
 * Order matters for the FK graph (drizzle reads this barrel to derive the
 * generation/inference DAG):
 *
 *   users      → no FKs out
 *   devices    → users (paired_by_user_id)
 *   accounts   → users
 *   sessions   → users, devices
 *   verifications  → no FKs out
 *   two_factors    → users
 *
 * See migration 0004_auth.sql for the corresponding SQL schema.
 */

export * from './enums.js';
export * from './users.js';
export * from './devices.js';
export * from './accounts.js';
export * from './sessions.js';
export * from './verifications.js';
export * from './twoFactors.js';
export * from './apiKeys.js';
