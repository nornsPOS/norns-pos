/**
 * tauri-pos — entry point. Stays small on purpose: wires the providers
 * (TanStack Query, Router), mounts <App />, and crashes loud on missing
 * env. No business logic here.
 */

import * as Sentry from '@sentry/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Brand stylesheet — loads tokens + @font-face (local fonts only).
import '@norns/ui-kit/styles.css';

import { Bewegung } from '@norns/ui-kit';

import { App } from './app/App.js';
import { Motorstart } from './app/Motorstart.js';
import { ApiClientProvider } from './lib/api-context.js';
import { installDurableReadCache } from './offline/read-cache-sqlite.js';
import { initTheme } from './state/theme-store.js';
import { initTextScale } from './state/text-scale.js';

// Apply the persisted light/dark theme before the first paint (single source of
// truth — the same store the toggle + Cmd+Shift+D read, Phase 7.1).
initTheme();
initTextScale();

// Make the last-good read cache durable across cold starts (auto-update, crash,
// morning reboot). Installs a throwaway SQLite table via the already-shipped
// plugin; outside a Tauri webview it no-ops and the cache stays memory-only.
installDurableReadCache();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { retry: 0 },
  },
});

const env = (
  import.meta as unknown as {
    env: {
      VITE_API_BASE_URL?: string;
      VITE_DEV_DEVICE_FINGERPRINT?: string;
      VITE_SENTRY_DSN?: string;
    };
  }
).env;
// ── NORNS POS: DER SERVER WOHNT IM GERÄT (30.07.2026) ────────────────────────
//
// In Warehouse14 stand hier die ferne Schnittstelle. Norns POS arbeitet
// offline: derselbe Server läuft samt seiner Datenbank auf DIESEM Gerät,
// gestartet vom Rumpf, und die Kasse spricht mit ihm über die Rückschleife.
//
// Die Anschrift kann NICHT hier stehen: der Rumpf lässt den Motor einen freien
// Port beim Betriebssystem holen (zwei Kassen auf einem Rechner stehen sonst
// einander im Weg) und kennt die Nummer erst, wenn der Motor sie meldet. Also
// fragt <Motorstart> danach und mountet die Kasse erst mit der Antwort.
//
// Eine feste Zahl an dieser Stelle wäre kein „Vorgabewert", sondern eine
// Kasse, die auf gut Glück an eine Tür klopft. Und ein Zeigen ins Internet
// wäre ein FEHLER, kein Rückfall: eine Kasse, die heimlich eine fremde Wolke
// fragt, ist nicht die Kasse, die verkauft wurde.
const entwicklerAdresse = env.VITE_API_BASE_URL ?? '';
const devDeviceFingerprint = env.VITE_DEV_DEVICE_FINGERPRINT ?? '';

// Telemetry (GlitchTip/Sentry) — optional + fail-safe: only init when a DSN is
// configured; a failure here must never block the POS from mounting.
const sentryDsn = env.VITE_SENTRY_DSN?.trim();
if (sentryDsn) {
  try {
    Sentry.init({ dsn: sentryDsn, tracesSampleRate: 0 });
  } catch {
    // Ignore — the app still boots without telemetry.
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing in index.html');

createRoot(root).render(
  <StrictMode>
    <Motorstart
      kind={(adresse) => (
        <ApiClientProvider
          // `adresse` ist die vom Motor gemeldete Anschrift. `null` heisst:
          // kein Rumpf, also Entwicklung im Browser gegen einen fremden Server.
          baseUrl={adresse ?? entwicklerAdresse}
          devDeviceFingerprint={devDeviceFingerprint}
        >
          <QueryClientProvider client={queryClient}>
            {/*
              Die Haussprache der Bewegung, EINMAL um die ganze Kasse gelegt:
              Dauer und Kurve aus den Marken, und die Ruecksicht auf „weniger
              Bewegung" aus dem Betriebssystem. Ohne diese Huelle liefe jede
              JS-Bewegung an der CSS-Regel in tokens.css vorbei — die zaehlt
              nur fuer CSS. Begruendung: ui-kit/components/Bewegung.tsx.
            */}
            <Bewegung>
              <App />
            </Bewegung>
          </QueryClientProvider>
        </ApiClientProvider>
      )}
    />
  </StrictMode>,
);
