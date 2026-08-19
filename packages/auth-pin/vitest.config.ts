import { defineConfig } from 'vitest/config';

/**
 * Pure-function unit tests — no testcontainers, no I/O. Runs fast in-process.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
