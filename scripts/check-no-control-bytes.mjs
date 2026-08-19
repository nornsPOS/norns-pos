#!/usr/bin/env node
/**
 * Refuse source files containing bytes that no source file should contain.
 *
 * WHY THIS EXISTS: a single NUL byte once sat inside a template literal in
 * apps/worker/src/jobs/product-translator.ts, exactly where a separating
 * space belonged. Consequences, in order of nastiness:
 *
 *   • Invisible in every editor and in the file diff.
 *   • tsc compiled it happily. The types were fine; the STRING was wrong.
 *   • `grep` silently treated the entire file as binary and reported NO
 *     MATCHES for text plainly present in it, which made the file lie to
 *     every later investigation.
 *   • In production the job hashed "name\0" while its own SQL hashed
 *     "name ", so every cached row looked stale forever. The sweep spent a
 *     paid translation call on the same fifteen pairs every five minutes,
 *     logged success every time, and never translated anything new.
 *
 * A bug that survives the compiler, hides from the editor and disables the
 * search tool deserves its own gate. Control characters have no legitimate
 * place in this repo's source: tab, newline and carriage return are the only
 * ones allowed.
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|sql|json|md|yml|yaml|css|html|sh)$/;
/** Allowed control bytes: tab (9), newline (10), carriage return (13). */
const ALLOWED = new Set([9, 10, 13]);

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && EXTENSIONS.test(f));

const problems = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue; // deleted or unreadable in this checkout
  }
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i];
    if (byte < 32 && !ALLOWED.has(byte)) {
      // Report the line so the fix is one edit away, not a hunt.
      const line = buf.subarray(0, i).toString('utf8').split('\n').length;
      problems.push(
        `${file}:${line}  byte 0x${byte.toString(16).padStart(2, '0')} ` +
          `(${byte === 0 ? 'NUL' : 'control character'})`,
      );
      break; // one report per file is enough to act on
    }
  }
}

if (problems.length > 0) {
  console.error('Control bytes found in source files:\n');
  for (const p of problems) console.error('  ' + p);
  console.error(
    '\nThese survive the compiler, hide in editors and make grep treat the\n' +
      'whole file as binary. Replace the byte with the character it should be.',
  );
  process.exit(1);
}

console.log(`✓ No control bytes in ${files.length} source files`);
