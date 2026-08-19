import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

/**
 * ONE React, pinned by path.
 *
 * This package pins React 18.3.1 while the workspace root carries 19. Under
 * `node-linker=hoisted` (root .npmrc — it is there to fix a release-only
 * bundling crash and must not be undone) the declared devDependency
 * `@testing-library/react` gets hoisted to the root and resolves the ROOT's
 * React 19, while the components under test import this package's local
 * React 18. Two React instances share no hook dispatcher, so every render
 * died with `Cannot read properties of null (reading 'useState')` and the
 * whole suite (21 tests) had been red for weeks.
 *
 * Aliasing by resolved PATH, not by version range, forces the renderer and
 * the components onto the same copy. Test-only: nothing here reaches a build.
 */
// Resolve from the RENDERER's location, not this package's.
//
// Both copies are React 18.3.1 — the version was never the problem. They are
// two distinct FILES: one under packages/ui-kit/node_modules/react, one nested
// under node_modules/@testing-library/react/node_modules/react. A React
// instance keeps its hook dispatcher in module state, so a component built
// against copy A calling useId while copy B's renderer is driving finds a null
// dispatcher. The renderer is the one we cannot move, so the components come
// to it.
//
// EXACT matches (anchored RegExp), not the object form: a plain `react` key is
// a PREFIX rule, so it also swallows `react/jsx-dev-runtime` and rewrites it to
// `…/react/index.js/jsx-dev-runtime`, which resolves to nothing.
const rtl = require.resolve('@testing-library/react');
const fromRenderer = (spec: string): string => require.resolve(spec, { paths: [rtl] });

const reactPaths = [
  { find: /^react$/, replacement: fromRenderer('react') },
  { find: /^react-dom$/, replacement: fromRenderer('react-dom') },
  { find: /^react-dom\/client$/, replacement: fromRenderer('react-dom/client') },
  { find: /^react-dom\/test-utils$/, replacement: fromRenderer('react-dom/test-utils') },
  { find: /^react\/jsx-runtime$/, replacement: fromRenderer('react/jsx-runtime') },
  { find: /^react\/jsx-dev-runtime$/, replacement: fromRenderer('react/jsx-dev-runtime') },
];

/**
 * Vitest for @norns/ui-kit — behaviour-level component tests in jsdom.
 *
 * These prove the REAL accessibility + interaction contract of the shared
 * primitives (focus trap, focus restore, ESC / backdrop close, aria wiring,
 * Field error linkage) — not snapshots, not self-consistency.
 */
export default defineConfig({
  resolve: { alias: reactPaths },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
