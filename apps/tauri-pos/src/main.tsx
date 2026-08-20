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

/*
 * ── ⛔ DER MOTOR WOHNT IM GERAET — „OFFLINE" GEHT IHN NICHTS AN ────────────
 *
 * DER BEFUND (20.08.2026, an der laufenden Kasse gemessen): die Ankaufsflaeche
 * zeigte eine LEERE linke Spalte. Im Abfragespeicher stand
 *
 *     status: 'pending'   fetchStatus: 'paused'   fehlversuche: 1
 *
 * react-query PAUSIERT einen Wiederholungsversuch, solange sein
 * `onlineManager` die Anwendung fuer offline haelt — und der war auf offline
 * gesprungen, obwohl `navigator.onLine` in demselben Augenblick `true`
 * meldete und der Motor die Metallkurse munter weiterlieferte. Ein einziges
 * verirrtes `offline`-Ereignis genuegt; zurueck springt er erst bei einem
 * `online`-Ereignis, das nie kommen muss.
 *
 * Fuer DIESE Anwendung ist die Frage ohnehin falsch gestellt. Der Motor ist
 * ein Beiprogramm auf demselben Geraet; ob das Haus am Netz haengt, sagt
 * nichts darueber, ob er antwortet. Eine Kasse, die ausdruecklich OHNE Netz
 * arbeitet, darf ihre Abfragen nicht an einer Netzvermutung aufhaengen.
 *
 * `networkMode: 'always'` heisst deshalb: immer versuchen, und ehrlich
 * scheitern, wenn der Motor schweigt. Die Haltbarkeit besorgt die Kasse
 * selbst — die eigene Ausgangswarteschlange und der Sicherungsschalter in
 * `lib/api-context.tsx`. Zwei Mechanismen fuer dieselbe Sache waren einer zu
 * viel, und der geliehene war der schlechtere.
 *
 * ⚠️ Der zweite Teil der Antwort steht in `lib/abfragestand.ts`: eine Flaeche
 * darf auch dann nicht stumm bleiben, wenn eine Abfrage in einen Zustand
 * faellt, den ihre drei Zweige nicht kennen.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
      networkMode: 'always',
    },
    mutations: { retry: 0, networkMode: 'always' },
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
