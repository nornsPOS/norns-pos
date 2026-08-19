/**
 * React Context that exposes a singleton ApiClient to every screen.
 *
 *   const api = useApiClient();
 *   await authPin.login(api, { pin });
 *
 * The client is constructed once from the base URL passed in at <App />
 * mount, with the locked-order production middleware chain. The external
 * `wrapWithStepUp` decorator has been folded into the chain as
 * `stepUpMiddleware` (ADR-0043). The legacy `wrapWithStepUp.ts` file may
 * remain on disk for one release cycle but is no longer imported here.
 *
 * The session-probe hook bypasses step-up via `meta.custom.skipStepUp =
 * true`, not via constructing a separate raw client. Same surface, same
 * telemetry, same dedup, the only difference is that a 401 / step-up
 * response on the probe path does NOT open the PIN modal.
 */

import { type ReactNode, createContext, useContext, useMemo } from 'react';

import {
  type ApiClient,
  type Middleware,
  circuitBreakerMiddleware,
  createApiClient,
  inflightDedupMiddleware,
  isGobdRelevantPath,
  offlineQueueMiddleware,
  retryMiddleware,
  stepUpMiddleware,
  telemetryMiddleware,
  uuidv7,
} from '@norns/api-client';

import { TauriSqlOutboxStore } from './outbox-store.js';
import { getSessionToken } from './session-token.js';
import { stepUpService } from './stepUpService.js';
import { telemetrySink } from './telemetrySink.js';

/**
 * Stable per-install device id, embedded in every outbox row so a future
 * multi-till deployment can disambiguate idempotency keys (ADR-0044 §4).
 * In production mTLS carries the authoritative device identity; this id is
 * the client-side correlation handle, persisted once and reused.
 */
const DEVICE_ID_KEY = 'w14.device-id';
/** Exported for Phase 1.4: the fiscal dialogs seal this into a pos_intents row. */
export function resolveDeviceId(): string {
  if (typeof localStorage === 'undefined') return 'unknown-device';
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = uuidv7();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

/**
 * One durable outbox per app process (lazy-connects on first enqueue).
 * Exported so the replay controller (`offline-replay.ts`) shares the SAME
 * instance the middleware enqueues into.
 */
export const outboxStore = new TauriSqlOutboxStore();

const ApiClientContext = createContext<ApiClient | null>(null);

/**
 * Locked-order production middleware stack.
 *
 * ⚠️ Hier stand: „Order is asserted in CI by
 * `apps/tauri-pos/src/lib/__tests__/production-middleware-order.test.ts`".
 * Gemessen am 13.08.2026: diese Datei gibt es nicht, und den Ordner
 * `src/lib/__tests__/` gibt es auch nicht. Die Reihenfolge unten ist damit von
 * KEINEM Waechter gehalten, sie steht nur hier.
 *
 * Ein Kommentar ist kein Riegel, und dieser war schlimmer als keiner: er sagte
 * einem, man koenne aufhoeren zu suchen. Wer die Reihenfolge aendert, aendert
 * sie heute ohne jedes Rot.
 *
 * Outermost → innermost:
 *   step-up    UX replay on STEP_UP_REQUIRED (single shot, opens PIN modal)
 *   offline    Phase 3: durable enqueue on network/circuit failure (ADR-0044)
 *   retry      infra retry on idempotent + retryable (excludes STEP_UP_REQUIRED, CIRCUIT_OPEN)
 *   telemetry  per-attempt audit; logs even CIRCUIT_OPEN refusals (GoBD)
 *   circuit    per-bucket health; fast-fails inside cooldown
 *   dedup      coalesces concurrent identical GETs
 *
 * offline-queue sits at position 2 (after step-up, before retry) so it
 * catches both ApiNetworkError and ApiCircuitOpenError before retry burns
 * its budget on unreachable infra (ADR-0044 §3).
 */
export const productionMiddlewares: readonly Middleware[] = [
  stepUpMiddleware(stepUpService),
  offlineQueueMiddleware({
    store: outboxStore,
    isOnline: () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
    deviceId: resolveDeviceId(),
    classifyGobdRelevant: (path) => isGobdRelevantPath(path),
  }),
  retryMiddleware(),
  telemetryMiddleware({ sink: telemetrySink }),
  circuitBreakerMiddleware(),
  inflightDedupMiddleware(),
];

export interface ApiClientProviderProps {
  baseUrl: string;
  /**
   * Dev-mode device fingerprint. In production, mTLS handles device
   * identity via Cloudflare Access. In dev, the API expects the
   * fingerprint as a header so it can resolve which paired user lives
   * behind this terminal. Pulled from `VITE_DEV_DEVICE_FINGERPRINT` at
   * build time.
   */
  devDeviceFingerprint?: string;
  children: ReactNode;
}

export function ApiClientProvider({
  baseUrl,
  devDeviceFingerprint,
  children,
}: ApiClientProviderProps): JSX.Element {
  const client = useMemo(() => {
    const defaultHeaders: Record<string, string> = {};
    if (devDeviceFingerprint) {
      defaultHeaders['x-dev-device-fingerprint'] = devDeviceFingerprint;
    }
    return createApiClient({
      baseUrl,
      credentials: 'include',
      defaultHeaders,
      // Durable auth on Windows WebView2 (cross-site session cookie is dropped):
      // every request also carries the stored session token as a Bearer header.
      getAuthToken: getSessionToken,
      middlewares: productionMiddlewares,
    });
  }, [baseUrl, devDeviceFingerprint]);
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error('useApiClient must be called inside <ApiClientProvider>');
  }
  return client;
}
