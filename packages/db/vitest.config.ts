import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for @norns/db.
 *
 * Tests use testcontainers to spin up a fresh PostgreSQL 17 container per
 * suite. First-time runs pull the image (~150 MB) and take ~30s; subsequent
 * runs reuse the cached image and are ~5s per suite.
 *
 * Network availability is required (Docker socket must be reachable).
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 60_000, // headroom for testcontainers warm-up
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true }, // share container across files in one run
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts'],
    },
  },
});
