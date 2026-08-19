/**
 * Test-database bootstrapping via @testcontainers/postgresql.
 *
 * Spins up a single `pgvector/pgvector:pg17` container per test run (singleFork
 * in vitest.config.ts) so all migration suites share one container. Each suite
 * applies migrations 0001..N against a fresh schema.
 *
 * The migrator role is created in the initdb step so migration 0003 can
 * assume it exists — matching the production discipline (see
 * infrastructure/docker/postgres/initdb.d/README.md).
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import postgres, { type Sql } from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');

/**
 * Initdb fragment that creates the warehouse14_migrator role before any
 * migration runs. Matches the dev script
 * infrastructure/docker/postgres/initdb.d/00-create-migrator-role.sh.
 */
const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

export interface TestDb {
  container: StartedPostgreSqlContainer;
  /** Connection as warehouse14_migrator — use to apply migrations and inspect state. */
  migratorSql: Sql;
  /**
   * Lazy constructor for a warehouse14_app connection.
   *
   * The app role does not exist until migration 0003 has run. Tests that need
   * to assert "the app role cannot DELETE" call appSql() AFTER migrating up
   * past 0003 AND after `setAppPasswordForTest(migratorSql)`.
   *
   * Each call returns a fresh `postgres` Sql tag; the caller is responsible
   * for `.end()` when done.
   */
  appSql: () => Sql;
  /** Tear down: close migrator connection + stop the container. Safe to call multiple times. */
  cleanup: () => Promise<void>;
}

/**
 * Start a fresh Postgres container with pgvector + pg_stat_statements
 * preloaded, plus the warehouse14_migrator role pre-created.
 */
export async function startTestDb(): Promise<TestDb> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase('warehouse14_test')
    .withUsername('postgres')
    .withPassword('postgres_test_pw')
    .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
    .withCopyContentToContainer([
      {
        content: INITDB_SQL,
        target: '/docker-entrypoint-initdb.d/00-create-migrator-role.sql',
      },
    ])
    .start();

  const migratorSql = postgres({
    host: container.getHost(),
    port: container.getPort(),
    database: 'warehouse14_test',
    username: 'warehouse14_migrator',
    password: 'warehouse14_migrator_test_pw',
    max: 1,
    onnotice: () => {},
  });

  const host = container.getHost();
  const port = container.getPort();

  const appSqlFactory = (): Sql =>
    postgres({
      host,
      port,
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 1,
      onnotice: () => {},
    });

  let stopped = false;
  return {
    container,
    migratorSql,
    appSql: appSqlFactory,
    cleanup: async () => {
      if (stopped) return;
      stopped = true;
      await migratorSql.end({ timeout: 5 }).catch(() => {});
      await container.stop().catch(() => {});
    },
  };
}

/**
 * Apply migrations 0001 .. upTo (inclusive) against the test DB.
 *
 * `upTo` is the integer migration number (e.g. 3 for `0003_roles.sql`).
 * The runner reads every file matching `NNNN_*.sql`, sorts numerically, and
 * skips files whose number exceeds `upTo`.
 *
 * Re-runnable: idempotent migrations can be applied repeatedly. Non-idempotent
 * migrations will fail on the second run — that is the migration's bug, not
 * the runner's.
 */
export async function applyMigrations(sql: Sql, upTo: number): Promise<void> {
  // Mirror production migration behaviour: some SQL helper bodies reference
  // pgcrypto overloads that are only resolved at call time (e.g. blind_index →
  // hmac), so the migrations are applied with body-checking off — exactly how
  // they landed in prod (migrate.sh exports PGOPTIONS=-c check_function_bodies=off).
  // Set once at session level on the single pooled connection (max:1) so it
  // persists across every file/statement below.
  await sql.unsafe('SET check_function_bodies = off');
  const all = await readdir(MIGRATIONS_DIR);
  const files = all
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .filter((name) => Number.parseInt(name.slice(0, 4), 10) <= upTo)
    .sort();
  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    // Apply each statement separately — psql -f semantics (migrate.sh, no -1).
    // Sending a whole file as ONE postgres.js message wraps it in a single
    // implicit transaction, which breaks files that do `ALTER TYPE … ADD VALUE`
    // and then USE that value in the same file (0039): Postgres rejects "unsafe
    // use of new value …". psql commits the ADD VALUE first because it
    // autocommits per statement; files that need atomicity open their own
    // explicit BEGIN/COMMIT (honoured here since max:1 keeps one connection).
    for (const statement of splitSqlStatements(sqlText)) {
      await sql.unsafe(statement);
    }
  }
}

/**
 * Split a SQL migration file into individual statements the way `psql -f` does,
 * so each runs autocommitted unless the file opens an explicit BEGIN/COMMIT.
 * This is the production fidelity fix: migrate.sh applies via `psql -f` (no -1),
 * where an `ALTER TYPE … ADD VALUE` commits before a later statement uses it.
 *
 * Only a semicolon in *normal* context terminates a statement. The scanner skips
 * over the constructs where a `;` is not a terminator:
 *   • line comments  -- … ⏎
 *   • block comments /* … *​/  (these NEST in PostgreSQL)
 *   • single-quoted strings '…'  (with '' escapes)
 *   • double-quoted identifiers "…"  (with "" escapes)
 *   • dollar-quoted bodies $$ … $$ and $tag$ … $tag$ (function bodies — which
 *     also contain their own BEGIN/COMMIT/semicolons that must NOT split)
 * Exported for direct unit testing.
 */
export function splitSqlStatements(text: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    const next = i + 1 < n ? text[i + 1] : '';

    // line comment → consume to end of line
    if (ch === '-' && next === '-') {
      const nl = text.indexOf('\n', i);
      const stop = nl === -1 ? n : nl;
      buf += text.slice(i, stop);
      i = stop;
      continue;
    }

    // block comment (nestable in PostgreSQL)
    if (ch === '/' && next === '*') {
      let depth = 1;
      buf += '/*';
      let j = i + 2;
      while (j < n && depth > 0) {
        if (text[j] === '/' && text[j + 1] === '*') {
          depth++;
          buf += '/*';
          j += 2;
        } else if (text[j] === '*' && text[j + 1] === '/') {
          depth--;
          buf += '*/';
          j += 2;
        } else {
          buf += text[j];
          j++;
        }
      }
      i = j;
      continue;
    }

    // single-quoted string ('' is an escaped quote)
    if (ch === "'") {
      buf += ch;
      i++;
      while (i < n) {
        if (text[i] === "'" && text[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        if (text[i] === "'") {
          buf += "'";
          i++;
          break;
        }
        buf += text[i];
        i++;
      }
      continue;
    }

    // double-quoted identifier ("" is an escaped quote)
    if (ch === '"') {
      buf += ch;
      i++;
      while (i < n) {
        if (text[i] === '"' && text[i + 1] === '"') {
          buf += '""';
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          buf += '"';
          i++;
          break;
        }
        buf += text[i];
        i++;
      }
      continue;
    }

    // dollar-quoted string: $$ … $$ or $tag$ … $tag$ (tag = empty or identifier)
    if (ch === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        if (close !== -1) {
          const end = close + tag.length;
          buf += text.slice(i, end);
          i = end;
          continue;
        }
      }
      // not a dollar quote (e.g. a $1 placeholder) — treat as a normal char
      buf += ch;
      i++;
      continue;
    }

    // statement terminator
    if (ch === ';') {
      const trimmed = buf.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      buf = '';
      i++;
      continue;
    }

    buf += ch;
    i++;
  }

  const tail = buf.trim();
  if (tail.length > 0) statements.push(tail);
  return statements;
}

/**
 * After migration 0003 runs, warehouse14_app exists with no password set.
 * This sets a known dev/test password so the app-role connection factory can
 * authenticate. Production uses Oracle Vault and is out of scope here.
 */
export async function setAppPasswordForTest(migratorSql: Sql): Promise<void> {
  await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);
}
