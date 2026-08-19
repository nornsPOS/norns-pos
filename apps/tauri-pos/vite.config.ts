/**
 * Vite — feeds both the Tauri webview (`tauri dev`) and the browser
 * preview (`vite dev`). Tauri-specific tweaks: fixed dev port, no HMR
 * over WS when wrapped, env files prefixed `NORNS_PUBLIC_*`.
 */

import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig(() => {
  const serverConfig: import('vite').ServerOptions = {
    port: 1420,
    strictPort: true,
    host: host || false,
    watch: { ignored: ['**/src-tauri/**'] },
  };
  if (host) {
    serverConfig.hmr = { protocol: 'ws', host, port: 1421 };
  }
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    clearScreen: false,
    envPrefix: ['VITE_', 'NORNS_PUBLIC_'],
    server: serverConfig,
    build: {
      target: 'es2022',
      minify: 'esbuild' as const,
      // ⚠️ 30.07.2026: Quellkarten reisten bis heute MIT ins Händlerpaket —
      // 91 Dateien, die Hälfte davon Karten, und eine Karte trägt den
      // vollständigen Quelltext. Ein Norns-Käufer bekam damit unseren Code
      // frei Haus, und das Paket war doppelt so schwer wie nötig.
      //
      // Für die Fehlersuche brauchen wir sie im Entwicklungsbau; im
      // Auslieferungsbau nicht.
      sourcemap: process.env.NODE_ENV !== 'production',
      outDir: 'dist',
    },
  };
});
