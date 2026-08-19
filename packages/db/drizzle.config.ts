import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit configuration.
 *
 * Migrations live in ./migrations and are hand-written SQL (per ADR-0008 §9 discipline).
 * drizzle-kit's `migrate` subcommand applies them in numeric order using the
 * connection in `DATABASE_URL` — which MUST be a warehouse14_migrator credential
 * (ADR-0008 §3). NEVER point this at a warehouse14_app credential; migrations
 * would fail with permission denied (which is the intended safety net).
 *
 * The default below is the local-dev migrator URL matching
 * infrastructure/docker/postgres/initdb.d/00-create-migrator-role.sh.
 * In CI/production set DATABASE_URL from secrets.
 */

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://warehouse14_migrator:warehouse14_migrator_dev_pw@localhost:5432/warehouse14_dev';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
