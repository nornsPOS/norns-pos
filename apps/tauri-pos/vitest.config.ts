import { defineConfig } from 'vitest/config';

/**
 * Vitest for tauri-pos — pure-logic unit tests only (no DOM/Tauri runtime).
 * The MRZ parser wrapper and other framework-free helpers are covered here;
 * component + native-bridge code is exercised in the app itself.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
