/**
 * @norns/db
 *
 * Drizzle ORM schema, hand-written SQL migrations, and connection clients for Warehouse14.
 *
 * Public surface:
 *   import { connectApp, connectMigrator } from '@norns/db/client';
 *   import * as schema                      from '@norns/db/schema';
 *   import { withPiiKey }                   from '@norns/db';
 *
 * Migrations live in `./migrations` and are applied via `pnpm db:migrate`
 * (delegates to `drizzle-kit migrate`). Migrations MUST run as the
 * `warehouse14_migrator` role — see ADR-0008 §3 + ADR-0018 §10.
 */

export * from './client.js';
export * from './pii.js';
