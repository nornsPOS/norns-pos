/**
 * Shared test-only migration applier for the api-cloud integration suites.
 *
 * Mirrors the proven runner in `packages/db/tests/helpers/testDb.ts` so every
 * api-cloud suite applies migrations with the SAME production fidelity as the
 * db package's own tests. Two behaviours are essential and were missing from
 * the per-file inline appliers (which sent each whole file as one message with
 * default body-checking):
 *
 *   1. `SET check_function_bodies = off` — production applies migrations via
 *      migrate.sh with `PGOPTIONS=-c check_function_bodies=off`. Some SQL
 *      helper bodies (e.g. `blind_index` → pgcrypto `hmac`) are only resolved
 *      at call time; with body-checking ON, `CREATE FUNCTION` fails with
 *      `function hmac(bytea, text, unknown) does not exist` at migration 0007.
 *
 *   2. Per-statement application (psql -f semantics, no -1) — sending a whole
 *      file as ONE postgres.js message wraps it in a single implicit
 *      transaction, which breaks files that `ALTER TYPE … ADD VALUE` and then
 *      USE that value in the same file (0039): Postgres rejects "unsafe use of
 *      new value …". psql autocommits per statement so the ADD VALUE commits
 *      first; files that need atomicity open their own BEGIN/COMMIT (honoured
 *      here because the migrator connection is max:1).
 *
 * This is TEST INFRASTRUCTURE ONLY — it does not change any migration, role,
 * grant, or app code.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Sql } from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** packages/db/migrations relative to apps/api-cloud/tests/integration/. */
export const MIGRATIONS_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'db',
  'migrations',
);

/**
 * Apply every `NNNN_*.sql` migration (sorted numerically) against the test DB,
 * with production fidelity (body-checking off + per-statement, psql-style).
 *
 * Pass `upTo` to stop at an inclusive migration number; omit it to apply all.
 */
export async function applyAllMigrations(sql: Sql, upTo = Number.POSITIVE_INFINITY): Promise<void> {
  // Set once at session level — persists across every statement because the
  // migrator connection is pooled at max:1.
  await sql.unsafe('SET check_function_bodies = off');

  const all = await readdir(MIGRATIONS_DIR);
  const files = all
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .filter((name) => Number.parseInt(name.slice(0, 4), 10) <= upTo)
    .sort();

  for (const file of files) {
    const sqlText = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    for (const statement of splitSqlStatements(sqlText)) {
      await sql.unsafe(statement);
    }
  }
}

/**
 * Split a SQL migration file into individual statements the way `psql -f` does,
 * so each runs autocommitted unless the file opens an explicit BEGIN/COMMIT.
 *
 * Only a semicolon in *normal* context terminates a statement. The scanner
 * skips constructs where `;` is not a terminator:
 *   • line comments  -- … ⏎
 *   • block comments (these NEST in PostgreSQL)
 *   • single-quoted strings '…'  (with '' escapes)
 *   • double-quoted identifiers "…"  (with "" escapes)
 *   • dollar-quoted bodies $$ … $$ / $tag$ … $tag$ (function bodies, which
 *     contain their own BEGIN/COMMIT/semicolons that must NOT split)
 *
 * Copied verbatim from packages/db/tests/helpers/testDb.ts.
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
