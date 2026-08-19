import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration for @norns/api-cloud.
 *
 * Integration tests use testcontainers to spin up PostgreSQL 17 +
 * apply all migrations (1..N) against a fresh database per suite,
 * mirroring `packages/db`. `singleFork: true` shares one node worker
 * across files so we do not pay container startup more than once
 * per `pnpm test` invocation.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts', 'src/server.ts'],
    },
  },
});
