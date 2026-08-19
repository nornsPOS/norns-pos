/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Array-spread regression guard — the systematic defence for a bug class that
 *  hit production FIVE times and is INVISIBLE to TypeScript.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * THE BUG (drizzle `sql` template array-spread → Postgres 42846/22P02):
 *
 *   When a JavaScript array is interpolated into a drizzle `sql` (or postgres.js)
 *   template tag, drizzle SPREADS it into N comma-separated *scalar* bind params:
 *
 *       const ids = ['a', 'b'];           // string[]
 *       sql`… WHERE id = ANY(${ids}::uuid[])`
 *       //                    ^^^ becomes  ANY($1, $2 ::uuid[])  ← WRONG
 *
 *   For a multi-element array this produces a syntax error; for a SINGLE-element
 *   array it silently casts a scalar/record to `uuid[]` and throws 42846
 *   ("cannot cast type record to uuid[]") / 22P02 at RUNTIME on the first real
 *   non-empty day — never at compile time, never in a unit test that mocks the
 *   DB. It hit: transactions-finalize (eBay delist), closing-export ×3 (DATEV +
 *   DSFinV-K item/payment/tse reads), storefront-webhook (product lookup), and
 *   customers customer_tags. Each was a live-only 500.
 *
 * THE SAFE FORMS (must NOT be flagged):
 *
 *   1. Array-LITERAL string bound as ONE param:
 *        const idArray = `{${ids.join(',')}}`;   // '{a,b}' — one text param
 *        sql`… ANY(${idArray}::uuid[])`          // ← interpolated value is the
 *                                                 //   literal string, not the array
 *   2. Per-element binding via `sql.join(...)` inside an `ARRAY[...]` constructor:
 *        sql`customer_tags = ARRAY[${sql.join(tags, sql`, `)}]::text[]`
 *   3. A literal empty array constructor: `ARRAY[]::text[]`.
 *   4. SQL-side aggregation: `array_agg(...)`, `COALESCE(..., ARRAY[]::text[])`.
 *
 * THE GUARD:
 *
 *   A static scan of `apps/api-cloud/src/**\/*.ts` that FAILS if it finds a
 *   dangerous interpolation:
 *     (a)  ANY(${X}…)            where X is a bare JS array-typed variable
 *     (b)  ${X}::TYPE[]          where X is a bare JS array-typed variable
 *   "Bare JS array" = the interpolated identifier is NOT assigned an
 *   array-literal template string (`\`{…}\``) anywhere in the same file, AND the
 *   interpolation is not an inline `sql.join(...)` / `ARRAY[...]` form.
 *
 *   This is precise enough to PASS on every already-fixed site (they all assign
 *   `const X = \`{${a.join(',')}}\``) and to FAIL on a reintroduced raw spread.
 *   A built-in self-test feeds synthetic dangerous + safe snippets through the
 *   same analyzer to prove it catches the bug and does not false-positive.
 *
 * TEST INFRASTRUCTURE ONLY — scans source, never edits it, never touches the DB.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** apps/api-cloud/src relative to apps/api-cloud/tests/unit/. */
const SRC_DIR = resolve(__dirname, '..', '..', 'src');

// ── Source walk ─────────────────────────────────────────────────────────────

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ── Analyzer ─────────────────────────────────────────────────────────────────
//
// Pure over a single file's text. Returns the list of dangerous occurrences
// (empty = clean). Local (not exported) so the in-file self-test can drive it
// directly without tripping noExportsInTest.

interface ArraySpreadFinding {
  /** The matched identifier interpolated unsafely. */
  identifier: string;
  /** 1-based line number of the match. */
  line: number;
  /** The offending source line, trimmed. */
  snippet: string;
  /** Which rule fired. */
  kind: 'ANY' | 'CAST';
}

/**
 * Strip `//` line comments and `/* *\/` block comments so a documented example
 * of the bug (e.g. the explanatory comment above the fix) is never flagged.
 * Keeps newlines so line numbers are preserved.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  let inLine = false;
  let inBlock = false;
  let inStr: string | null = null; // ', ", or `
  while (i < n) {
    const ch = src[i] as string;
    const next = i + 1 < n ? (src[i + 1] as string) : '';
    if (inLine) {
      if (ch === '\n') {
        inLine = false;
        out += ch;
      } else {
        out += ch === '\t' ? '\t' : ' ';
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        out += '  ';
        i += 2;
      } else {
        out += ch === '\n' ? '\n' : ' ';
        i++;
      }
      continue;
    }
    if (inStr) {
      out += ch;
      if (ch === '\\') {
        // keep the escaped char verbatim
        if (i + 1 < n) {
          out += src[i + 1];
          i += 2;
          continue;
        }
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    // not in a comment or string
    if (ch === '/' && next === '/') {
      inLine = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlock = true;
      out += '  ';
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Identifiers in this file that are KNOWN-SAFE because they are assigned a
 * Postgres array-LITERAL template string somewhere in the file, e.g.
 *   const txIdArray = `{${txIds.join(',')}}`;
 * The leading `{` inside the template backtick is the array-literal marker.
 */
function safeArrayLiteralIdentifiers(src: string): Set<string> {
  const safe = new Set<string>();
  // const|let X = `{ …
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*`\{/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop.
  while ((m = re.exec(src)) !== null) {
    safe.add(m[1] as string);
  }
  return safe;
}

/** Resolve a 0-based index to a 1-based line number. */
function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

/** Trim the source line containing `index`. */
function snippetAt(src: string, index: number): string {
  const start = src.lastIndexOf('\n', index) + 1;
  let end = src.indexOf('\n', index);
  if (end === -1) end = src.length;
  return src.slice(start, end).trim();
}

/**
 * Analyze one file's source for dangerous array-spread interpolations.
 *
 * The analyzer runs on the COMMENT-STRIPPED text (so documentation of the bug
 * never trips it) and treats an interpolation as dangerous when the
 * interpolated expression is a BARE identifier (a JS array variable) that is
 * NOT in the file's safe-array-literal set. Inline `sql.join(...)` /
 * `ARRAY[...]` forms have a non-identifier expression and are never flagged.
 */
function analyzeSource(rawSrc: string): ArraySpreadFinding[] {
  const src = stripComments(rawSrc);
  const safe = safeArrayLiteralIdentifiers(src);
  const findings: ArraySpreadFinding[] = [];

  // The interpolated expression we treat as a "bare JS array variable" is a
  // single dotted/identifier token with NO call, NO template, NO array literal:
  //   ${ids}            ✗ dangerous (bare)
  //   ${a.b.ids}        ✗ dangerous (bare member access)
  //   ${idArray}        ✓ safe IF idArray ∈ safe-literal set
  //   ${ids.join(',')}  — has '(' → not a bare identifier → never matched here
  //   ${sql.join(...)}  — has '(' → not matched
  //   ${`{${x}}`}       — starts with '`' → not matched
  const BARE = '\\$\\{\\s*([A-Za-z_$][\\w$.]*)\\s*\\}';

  // Rule (a): ANY(${X}…)  — X bound directly inside ANY(...).
  const anyRe = new RegExp(`ANY\\(\\s*${BARE}`, 'g');
  // Rule (b): ${X}::TYPE[]  — X cast straight to a Postgres array type.
  const castRe = new RegExp(`${BARE}\\s*::\\s*[A-Za-z_][\\w]*\\s*\\[\\s*\\]`, 'g');

  for (const [kind, re] of [
    ['ANY', anyRe],
    ['CAST', castRe],
  ] as const) {
    let m: RegExpExecArray | null;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec loop.
    while ((m = re.exec(src)) !== null) {
      const ident = m[1] as string;
      // The leaf identifier is what carries the (array) type; resolving member
      // chains fully is out of scope — we use the root token for the safe-set
      // lookup, which is exactly how the fixed sites name their literal vars.
      const root = ident.split('.')[0] as string;
      if (safe.has(ident) || safe.has(root)) continue; // assigned `{…}` literal → safe
      findings.push({
        identifier: ident,
        line: lineAt(src, m.index),
        snippet: snippetAt(src, m.index),
        kind,
      });
    }
  }
  return findings;
}

// ── The guard ────────────────────────────────────────────────────────────────

describe('array-spread regression guard (drizzle sql template)', () => {
  it('finds the api-cloud src tree', () => {
    const files = listTsFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(20);
  });

  it('no production source interpolates a bare JS array into ANY(...) or ::TYPE[]', () => {
    const files = listTsFiles(SRC_DIR);
    const allFindings: { file: string; finding: ArraySpreadFinding }[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const finding of analyzeSource(src)) {
        allFindings.push({ file: file.replace(SRC_DIR, 'src'), finding });
      }
    }

    if (allFindings.length > 0) {
      const fix = "const arr = `{${ids.join(',')}}`; … ANY(${arr}::uuid[])";
      const report = allFindings
        .flatMap(({ file, finding }) => [
          `  • ${file}:${finding.line} [${finding.kind}] \`${finding.identifier}\``,
          `      ${finding.snippet}`,
          `      → bind a Postgres array-literal instead: ${fix}`,
        ])
        .join('\n');
      const header =
        'Dangerous drizzle array-spread interpolation(s) found ' +
        '(invisible to TypeScript, 500s at runtime on the first non-empty day):';
      throw new Error(`${header}\n${report}`);
    }

    expect(allFindings).toHaveLength(0);
  });

  // ── Self-test: prove the analyzer catches the bug AND does not over-fire ──
  describe('analyzer self-test (synthetic snippets)', () => {
    it('FLAGS a bare JS array spread into ANY(...)', () => {
      const bad = [
        'const ids = rows.map((r) => r.id);',
        'await db.execute(sql`SELECT * FROM t WHERE id = ANY(${ids}::uuid[])`);',
      ].join('\n');
      const f = analyzeSource(bad);
      // Both the ANY rule and the CAST rule see the bare `ids` → at least one.
      expect(f.length).toBeGreaterThanOrEqual(1);
      expect(f.some((x) => x.identifier === 'ids')).toBe(true);
    });

    it('FLAGS a bare JS array cast to ::int[]', () => {
      const bad = 'sql`WHERE n = ANY(${nums}::int[])`';
      const f = analyzeSource(bad);
      expect(f.some((x) => x.identifier === 'nums')).toBe(true);
    });

    it("does NOT flag the array-literal-string fix (`{${ids.join(',')}}`)", () => {
      const good = [
        "const txIdArray = `{${txIds.join(',')}}`;",
        'await db.execute(sql`WHERE id = ANY(${txIdArray}::uuid[])`);',
      ].join('\n');
      expect(analyzeSource(good)).toHaveLength(0);
    });

    it('does NOT flag the sql.join(...) ARRAY[...] form', () => {
      const good = 'sql`customer_tags = ARRAY[${sql.join(tags, sql`, `)}]::text[]`';
      expect(analyzeSource(good)).toHaveLength(0);
    });

    it('does NOT flag the literal empty ARRAY[]::text[] form', () => {
      const good = 'sql`customer_tags = ARRAY[]::text[]`';
      expect(analyzeSource(good)).toHaveLength(0);
    });

    it('does NOT flag an `ids.join(...)` call interpolation', () => {
      const good = 'sql`WHERE id = ANY((${ids.join(",")})::uuid[])`';
      // `ids.join(',')` has a call paren → not a bare identifier → not matched.
      expect(analyzeSource(good)).toHaveLength(0);
    });

    it('does NOT flag a documented bug example living inside a comment', () => {
      const good = [
        '// BAD: sql`WHERE id = ANY(${ids}::uuid[])` spreads the array — never do this.',
        '/* also ${ids}::uuid[] in a block comment must be ignored */',
        "const arr = `{${ids.join(',')}}`;",
        'sql`WHERE id = ANY(${arr}::uuid[])`',
      ].join('\n');
      expect(analyzeSource(good)).toHaveLength(0);
    });
  });
});
