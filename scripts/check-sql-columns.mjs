#!/usr/bin/env node
/**
 * Refuse raw SQL that references a column the database does not have.
 *
 * WHY THIS EXISTS: in one feature, four column names were written from memory
 * instead of from the schema, and every one of them passed `tsc` cleanly:
 *
 *   carts.expires_at          the pickup deadline lives on products
 *   cart_items.created_at     the column is added_at
 *   products.reserved_until   the column is reservation_expires_at
 *   shopper_sessions.revoked_at   that column belongs to the STAFF sessions
 *                                 table; this one never had it
 *
 * The last one was the worst: it sat inside a SECURITY DEFINER function, so
 * `CREATE OR REPLACE FUNCTION` accepted it happily (Postgres parses the body,
 * it does not resolve columns) and the migration applied cleanly while leaving
 * erasure dead for every caller. TypeScript cannot see inside a SQL string and
 * a migration that applies is not a migration that works, so this gate is the
 * only thing standing between "it compiled" and "it runs".
 *
 * How it works: for each raw SQL literal, resolve table aliases from FROM,
 * JOIN, UPDATE, DELETE FROM and USING clauses, then check every `alias.column`
 * against a snapshot of the real schema. Unknown aliases are skipped rather
 * than guessed at, so CTEs and subquery aliases produce no false alarms.
 *
 * The snapshot lives in packages/db/schema-snapshot/columns.json. Refresh it
 * with: npm run schema:snapshot
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SNAPSHOT = join(ROOT, 'packages/db/schema-snapshot/columns.json');

/** @type {Record<string, string[]>} */
const schema = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
const columnsOf = new Map(Object.entries(schema).map(([t, c]) => [t, new Set(c)]));

/** Words that follow a table name but are not aliases. */
const NOT_AN_ALIAS = new Set([
  'set', 'where', 'on', 'using', 'join', 'inner', 'left', 'right', 'full',
  'outer', 'cross', 'group', 'order', 'limit', 'returning', 'values', 'as',
  'select', 'from', 'and', 'or', 'union', 'having', 'window', 'for', 'lateral',
]);

/**
 * Pull every raw SQL string out of a TypeScript source file.
 *
 * The first version of this used one regex, `/(?:sql|drizzleSql|tx|s)\s*`
 * ([\s\S]*?)`/g`, and it silently missed statements. Two faults, both fatal:
 *
 *  1. The alternative `s` matches the last letter of ANY identifier that ends
 *     in "s" before a backtick, so a plain JS template literal opened a bogus
 *     "SQL" literal.
 *  2. The lazy `[\s\S]*?` stops at the FIRST backtick, but a SQL template
 *     regularly nests one inside an interpolation
 *     (`${cond ? drizzleSql`AND …` : drizzleSql``}`). The scan then ended
 *     early, resumed in the middle of the statement, and the REAL statement
 *     was never seen as a whole.
 *
 * The consequence was measured on 2026-07-23: `products.price_eur` (the column
 * is `list_price_eur`) sat in `storefront-reserve.ts` and this gate reported
 * everything valid, while production answered 42703 and the shop could not
 * take a single reservation. The gate was not wrong about the schema; it never
 * read the statement.
 *
 * So: find the tag with a word boundary, then walk the characters and track
 * `${…}` depth and nested backticks, ending only at the matching backtick.
 */
const SQL_TAGS = /\b(?:drizzleSql|sql|tx)\s*`/g;

function sqlLiterals(source) {
  const out = [];
  SQL_TAGS.lastIndex = 0;
  let m;
  while ((m = SQL_TAGS.exec(source)) !== null) {
    const open = SQL_TAGS.lastIndex - 1; // Position des öffnenden Backticks
    let i = open + 1;
    let depth = 0; // Verschachtelungstiefe von ${ … }
    let end = -1;
    while (i < source.length) {
      const ch = source[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '$' && source[i + 1] === '{') {
        depth += 1;
        i += 2;
        continue;
      }
      if (ch === '}' && depth > 0) {
        depth -= 1;
        i += 1;
        continue;
      }
      if (ch === '`') {
        if (depth === 0) {
          end = i;
          break;
        }
        // Ein Backtick INNERHALB einer Interpolation gehört zu einem
        // verschachtelten Template. Überspringe es bis zu seinem Partner.
        let j = i + 1;
        let innerDepth = 0;
        while (j < source.length) {
          if (source[j] === '\\') { j += 2; continue; }
          if (source[j] === '$' && source[j + 1] === '{') { innerDepth += 1; j += 2; continue; }
          if (source[j] === '}' && innerDepth > 0) { innerDepth -= 1; j += 1; continue; }
          if (source[j] === '`' && innerDepth === 0) break;
          j += 1;
        }
        i = j + 1;
        continue;
      }
      i += 1;
    }
    if (end === -1) continue; // unausgeglichen: lieber überspringen als raten
    out.push({
      text: source.slice(open + 1, end),
      line: source.slice(0, open).split('\n').length,
    });
    SQL_TAGS.lastIndex = end + 1;
  }
  return out;
}

/** alias -> table, from the clauses that actually introduce a table. */
function aliasMap(sql) {
  const map = new Map();
  const re =
    /\b(?:from|join|update|delete\s+from|using|into)\s+(?:only\s+)?([a-z_][a-z0-9_]*)\s*(?:\bas\b\s+)?([a-z_][a-z0-9_]*)?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].toLowerCase();
    if (!columnsOf.has(table)) continue; // CTE, function, or unknown: skip
    map.set(table, table); // the table name is always a valid qualifier
    const alias = (m[2] ?? '').toLowerCase();
    if (alias && !NOT_AN_ALIAS.has(alias)) map.set(alias, table);
  }
  return map;
}

/** Strip comments and placeholders so they cannot look like references. */
function normalise(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$\{[^}]*\}/g, ' ? ');
}

function scanFile(file) {
  const source = readFileSync(file, 'utf8');
  const problems = [];
  for (const { text, line } of sqlLiterals(source)) {
    const sql = normalise(text);
    if (!/\b(select|insert|update|delete)\b/i.test(sql)) continue;
    const aliases = aliasMap(sql);
    if (aliases.size === 0) continue;

    // UPDATE <table> [alias] SET col = ..., col = ...
    // The assignment targets are UNQUALIFIED and belong unambiguously to the
    // updated table, so they can be checked directly. This is the shape that
    // hid products.reserved_until: qualified references were all correct
    // while the SET list named a column that does not exist.
    const setRe = /\bupdate\s+(?:only\s+)?([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s+set\b([\s\S]*?)(?=\bfrom\b|\bwhere\b|\breturning\b|$)/gi;
    let u;
    while ((u = setRe.exec(sql)) !== null) {
      const table = u[1].toLowerCase();
      const cols = columnsOf.get(table);
      if (!cols) continue;
      const assignRe = /(^|,)\s*([a-z_][a-z0-9_]*)\s*=/gi;
      let a;
      while ((a = assignRe.exec(u[2])) !== null) {
        const column = a[2].toLowerCase();
        if (cols.has(column)) continue;
        const near = [...cols]
          .filter((c) => c.includes(column.split('_')[0]) || column.includes(c.split('_')[0]))
          .slice(0, 3);
        problems.push({
          file: relative(ROOT, file),
          line: line + sql.slice(0, u.index).split('\n').length - 1,
          ref: `${table}.${column} (in SET)`,
          table,
          near,
        });
      }
    }

    const refRe = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi;
    let r;
    const seen = new Set();
    while ((r = refRe.exec(sql)) !== null) {
      const qualifier = r[1].toLowerCase();
      const column = r[2].toLowerCase();
      const table = aliases.get(qualifier);
      if (!table) continue; // unknown qualifier: not ours to judge
      const cols = columnsOf.get(table);
      if (!cols || cols.has(column)) continue;
      const key = `${qualifier}.${column}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Suggest the closest real column, which is usually the intended one.
      const near = [...cols]
        .filter((c) => c.includes(column.split('_')[0]) || column.includes(c.split('_')[0]))
        .slice(0, 3);
      problems.push({
        file: relative(ROOT, file),
        line: line + sql.slice(0, r.index).split('\n').length - 1,
        ref: key,
        table,
        near,
      });
    }
  }
  return problems;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (/\.ts$/.test(entry)) acc.push(full);
  }
  return acc;
}

// Die Server-Seiten UND die geteilten Pakete, die rohes SQL tragen. Am
// 23.07.2026 wanderte `email-outbox.ts` mit seinem INSERT in
// packages/email, und die Wache verlor die Anweisung lautlos aus dem Blick:
// die geprüfte Dateizahl fiel von 253 auf 252. Ein Umzug darf keine Deckung
// kosten, also stehen die Wurzeln hier vollständig.
const targets = [
  join(ROOT, 'apps/api-cloud/src'),
  join(ROOT, 'packages/email/src'),
  join(ROOT, 'packages/inventory-lock/src'),
  join(ROOT, 'packages/audit/src'),
  join(ROOT, 'packages/appointments/src'),
  // 14.08.2026: die Annahmestrecken-Hilfsbibliothek stand hier und fiel mit dem
  // Messenger-Buendel bei der Trennung von warehouse14.
];
// ⚠️ KEIN stilles `catch { return [] }` mehr (Befund 13.08.2026).
//
// Hier stand genau das, und es machte den Absatz darueber wirkungslos: er
// verspricht „Ein Umzug darf keine Deckung kosten", der Fangarm gab aber jedem
// verschwundenen Wurzelverzeichnis eine leere Liste, und das Tor meldete
// weiter GRUEN mit einer kleineren Dateizahl. Benennt jemand ein Paket um oder
// verschiebt es, faellt seine ganze SQL-Deckung lautlos weg, und die einzige
// Spur ist eine Zahl in einer Zeile, die niemand mit gestern vergleicht.
//
// Ein fehlendes Wurzelverzeichnis ist deshalb ein Abbruch mit Namen und Weg.
const files = targets.flatMap((t) => {
  try {
    return walk(t);
  } catch (fehler) {
    console.error(`⛔ Die SQL-Wache findet ein Wurzelverzeichnis nicht: ${t}`);
    console.error(`   ${fehler instanceof Error ? fehler.message : String(fehler)}`);
    console.error('');
    console.error('   Bisher wurde das still uebersprungen und die Wache blieb gruen,');
    console.error('   nur mit weniger geprueften Dateien. Wurde das Paket umbenannt oder');
    console.error('   verschoben, gehoert der neue Weg in die Liste `targets` in dieser');
    console.error('   Datei. Gibt es das Paket nicht mehr, gehoert die Zeile geloescht.');
    process.exit(1);
  }
});

const all = files.flatMap(scanFile);

if (all.length > 0) {
  console.error('SQL references columns that do not exist:\n');
  for (const p of all) {
    console.error(`  ${p.file}:${p.line}  ${p.ref}`);
    console.error(
      `      ${p.table} has no "${p.ref.split('.')[1]}"` +
        (p.near.length ? `. Did you mean: ${p.near.join(', ')}?` : '.'),
    );
  }
  console.error(
    `\nChecked ${files.length} files against ${columnsOf.size} tables.\n` +
      'If the schema changed, refresh the snapshot: npm run schema:snapshot',
  );
  process.exit(1);
}

console.log(`✓ SQL column references valid across ${files.length} files`);
