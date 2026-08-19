/**
 * Connection clients for Warehouse14.
 *
 * Three database roles are defined in migration 0003_roles.sql (per ADR-0008 §3):
 *
 *   warehouse14_app        Runtime API. SELECT, INSERT, narrow UPDATE. NEVER DELETE.
 *   warehouse14_migrator   Deploy-time only. Full DDL + DML. Never used by the API runtime.
 *   warehouse14_security   NOLOGIN. Owns security-critical objects (ledger trigger fn from 0008).
 *
 * This module exposes exactly two client constructors. The discipline:
 *
 *   apps/api-cloud, apps/worker            →  connectApp(...)
 *   drizzle-kit / programmatic migrations  →  connectMigrator(...)
 *
 * There is NO third constructor. Code that needs other privileges does not
 * belong in this codebase.
 *
 * Both constructors return both a Drizzle `db` (typed against `./schema`) and
 * the underlying `postgres` Sql tag — the latter is needed for LISTEN/NOTIFY
 * (ADR-0001 #13) and for raw SQL where Drizzle's surface is too narrow.
 */

import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema/index.js';

export type AppDb = PostgresJsDatabase<typeof schema>;
export type MigratorDb = PostgresJsDatabase<typeof schema>;

export interface ConnectionConfig {
  /**
   * Full Postgres URL: `postgres://user:pw@host:port/db?…`.
   * When provided, all other fields are ignored.
   */
  url?: string;
  /** Hostname. Default: `localhost`. */
  host?: string;
  /** TCP port. Default: `5432`. */
  port?: number;
  /** Database name. Default: `warehouse14_dev`. */
  database?: string;
  /** Username. Default: role-specific (see constructor). */
  user?: string;
  /** Password. Required unless `url` is given. */
  password?: string;
  /** Pool size. Default: app=10, migrator=1. */
  max?: number;
  /** ms to wait when acquiring a connection. Default: app=10_000, migrator=30_000. */
  connectionTimeoutMs?: number;
  /**
   * Application name surfaced in pg_stat_activity. Useful for distinguishing
   * api vs worker connections in the Grafana dashboards (ADR-0012 §6).
   */
  applicationName?: string;
}

interface ResolvedUrl {
  url: string;
  max: number;
}

function buildUrl(cfg: ConnectionConfig, defaultUser: string, defaultMax: number): ResolvedUrl {
  if (cfg.url) return { url: cfg.url, max: cfg.max ?? defaultMax };
  const host = cfg.host ?? 'localhost';
  const port = cfg.port ?? 5432;
  const database = cfg.database ?? 'warehouse14_dev';
  const user = cfg.user ?? defaultUser;
  if (!cfg.password) {
    throw new Error(
      `[@norns/db] No password provided for role "${user}". ` +
        'Pass cfg.password or cfg.url (with embedded credentials).',
    );
  }
  const auth = `${encodeURIComponent(user)}:${encodeURIComponent(cfg.password)}`;
  return {
    url: `postgres://${auth}@${host}:${port}/${database}`,
    max: cfg.max ?? defaultMax,
  };
}

/**
 * Open a Drizzle client bound to the runtime `warehouse14_app` role.
 *
 * Use from apps/api-cloud and apps/worker. NEVER use from migration code.
 *
 * @example
 *   const { db, sql } = connectApp({ url: process.env.DATABASE_URL });
 *   // Drizzle queries:
 *   const products = await db.select().from(schema.products).limit(10);
 *   // LISTEN/NOTIFY:
 *   await sql.listen('live_events', (payload) => handle(payload));
 */
export function connectApp(cfg: ConnectionConfig): { db: AppDb; sql: Sql } {
  const { url, max } = buildUrl(cfg, 'warehouse14_app', 10);
  const sql = postgres(url, {
    max,
    connect_timeout: Math.max(1, Math.round((cfg.connectionTimeoutMs ?? 10_000) / 1000)),
    prepare: true,
    connection: {
      application_name: cfg.applicationName ?? 'warehouse14_app',
    },
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema }), sql };
}

/**
 * Open a Drizzle client bound to the deploy-time `warehouse14_migrator` role.
 *
 * Used ONLY by drizzle-kit migrate and programmatic migration runners.
 * The API runtime must not import or call this.
 */
export function connectMigrator(cfg: ConnectionConfig): {
  db: MigratorDb;
  sql: Sql;
} {
  const { url, max } = buildUrl(cfg, 'warehouse14_migrator', 1);
  const sql = postgres(url, {
    max,
    connect_timeout: Math.max(1, Math.round((cfg.connectionTimeoutMs ?? 30_000) / 1000)),
    prepare: false, // DDL via prepared statements is fragile across PG versions
    connection: {
      application_name: cfg.applicationName ?? 'warehouse14_migrator',
    },
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema }), sql };
}

export type WorkerDb = PostgresJsDatabase<typeof schema>;

/**
 * Open a Drizzle client bound to the `warehouse14_worker` role used by
 * `apps/worker`. Same default-deny posture as `warehouse14_app`; gets
 * explicit UPDATE on worker_job_runs / worker_job_dlq / domain mutables
 * per migration 0017.
 */
export function connectWorker(cfg: ConnectionConfig): { db: WorkerDb; sql: Sql } {
  const { url, max } = buildUrl(cfg, 'warehouse14_worker', 5);
  const sql = postgres(url, {
    max,
    connect_timeout: Math.max(1, Math.round((cfg.connectionTimeoutMs ?? 10_000) / 1000)),
    prepare: true,
    connection: {
      application_name: cfg.applicationName ?? 'warehouse14_worker',
    },
    onnotice: () => {},
  });
  return { db: drizzle(sql, { schema }), sql };
}

/**
 * A Drizzle transaction handle as seen inside `db.transaction(async (tx) => …)`.
 * Surfaced so libraries (e.g. `@norns/inventory-lock`, `@norns/audit`)
 * can accept either the root client or a tx without callers needing `as never`.
 *
 * Derived from `AppDb['transaction']` so it stays in sync with Drizzle upgrades.
 */
export type DrizzleTransaction = Parameters<Parameters<AppDb['transaction']>[0]>[0];

/**
 * Universal "you can run queries here" type.
 *
 *   • `AppDb`            — runtime API role
 *   • `WorkerDb`         — daemon role
 *   • `MigratorDb`       — deploy-time role
 *   • `DrizzleTransaction` — a tx callback param of any of the above
 *
 * Use this in shared helpers (audit emit, inventory-lock, withPii). Callers
 * pass either `app.db` or a `tx` argument — no cast required.
 *
 * **Audit-driven (2026-05-26):** consolidated the prior `AppDb | MigratorDb`
 * definition that lived in pii.ts with the new tx-aware one — see
 * memory.md #73.
 */
export type AnyDb = AppDb | WorkerDb | MigratorDb | DrizzleTransaction;

/**
 * A root connection client that owns a real BEGIN/COMMIT — never a
 * `DrizzleTransaction`. Use where a helper must open its own top-level
 * transaction (e.g. `withPiiKey`): a tx passed in would nest as a SAVEPOINT
 * and mis-scope `SET LOCAL`, so it is excluded at the type level.
 */
export type RootDb = Exclude<AnyDb, DrizzleTransaction>;
