/**
 * Post-build helper — copies CSS sources from `src/` to `dist/`.
 *
 * `tsc` only emits .js/.d.ts. The brand stylesheet (styles.css →
 * @imports tokens.css + typography.css) is hand-authored CSS and must
 * land in `dist/` so the package.json `exports` map resolves at build
 * time of consumers (vite/rollup).
 *
 * Idempotent + dependency-free; runs in any Node ≥ 18.
 */

import { cpSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '..', 'src');
const distDir = resolve(here, '..', 'dist');

mkdirSync(distDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(srcDir)) {
  if (!entry.endsWith('.css')) continue;
  const from = join(srcDir, entry);
  if (!statSync(from).isFile()) continue;
  const to = join(distDir, entry);
  cpSync(from, to);
  copied += 1;
}

// eslint-disable-next-line no-console
console.log(`ui-kit: copied ${copied} CSS files → dist/`);
