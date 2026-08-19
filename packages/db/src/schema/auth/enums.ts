/**
 * PostgreSQL enum types used by the auth schema.
 *
 * Created as native PG enums in migration 0004_auth.sql. Drizzle's `pgEnum`
 * matches the existing types (it does NOT re-create them — drizzle-kit
 * generate would, but we're hand-writing migrations).
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['ADMIN', 'CASHIER', 'READONLY']);

export const deviceClass = pgEnum('device_class', [
  'POS_TERMINAL',
  'CONTROL_DESKTOP',
  'ADMIN_WEB_BROWSER',
  'WORKER',
]);

export const deviceStatus = pgEnum('device_status', ['active', 'revoked', 'expired']);
