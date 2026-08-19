/**
 * sync-store — offline-queue health + REAL request reachability for the header
 * status badge (ADR-0044 §6).
 *
 * Mirrors the local SQLite outbox state the cashier needs at a glance:
 *   • `online`        — browser connectivity (tracks `navigator.onLine` + events)
 *   • `syncing`       — the replay loop is draining the queue right now
 *   • `pendingCount`  — rows still awaiting replay
 *   • `conflictCount` — rows halted on a divergence (→ Compliance Inbox)
 *
 * `navigator.onLine` only knows whether the OS has *a* network interface — it
 * stays `true` while the API/tunnel is unreachable, so the badge used to show a
 * green "Bereit" during a real outage. We now ALSO track real request health
 * (`apiReachable`), fed by the api-client telemetry sink on every success /
 * network-or-circuit failure, and surface a distinct "API nicht erreichbar"
 * state. See `classifyConnectionHealth` (pure, unit-tested).
 *
 * The replay controller (offline-replay.ts) drives `syncing` + calls
 * `refreshStats()`; a 5s tick in `useOfflineReplay` keeps the counts fresh.
 */

import { create } from 'zustand';

import { outboxStore } from '../lib/api-context.js';

/** A transport-level failure that means the server itself is unreachable. */
export type RequestFailureKind = 'network' | 'circuit';

/**
 * The honest connection state the header badge renders. Distinct from the
 * offline-queue state: `unreachable` means real requests are failing at the
 * transport even though the OS still reports a network interface.
 */
export type ConnectionHealth =
  | 'conflict'
  | 'offline'
  | 'unreachable'
  /**
   * Die Warteschlange STEHT. Nicht „arbeitet gerade", sondern kommt nicht
   * voran, und zwar so lange, dass es kein Warten mehr ist.
   *
   * Bis zum 26.07.2026 gab es diesen Zustand nicht. Eine Anmeldelücke liess
   * den Ausgangskorb pausieren, und die Anzeige meldete weiter
   * „Die Warteschlange wird gerade abgearbeitet" — für die Kassiererin
   * ununterscheidbar von einem gesunden Lauf. Auf der Windows-Kasse ist der
   * Stau endgültig, weil die Wiederholung den beim Einreihen versiegelten,
   * inzwischen abgelaufenen Bearer trägt.
   */
  | 'blocked'
  | 'syncing'
  | 'ready';

export interface ConnectionHealthInput {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  conflictCount: number;
  /**
   * `false` once a transport-level request failure (network/circuit) has been
   * seen with no later success; `true` after any successful response. `null`
   * before the first request resolves — treated as healthy (optimistic).
   */
  apiReachable: boolean | null;
  /**
   * Warum der Ausgangskorb zuletzt pausiert hat, oder `null`, wenn er läuft.
   * Kommt aus `drainOutbox` (`reason` im Ergebnis `aborted`).
   */
  blockedReason?: 'auth' | 'transport' | null;
  /**
   * Der Ausgangskorb steht länger als die Stauschwelle. Kommt ebenfalls aus
   * `drainOutbox` (`needsAttention`).
   */
  blockedNeedsAttention?: boolean;
}

/**
 * Pure classifier — maps the raw store fields to the single badge state.
 * Priority: data-integrity (conflict) → OS offline → API unreachable →
 * actively syncing → ready. Kept pure + exported so it is unit-testable
 * without a React/Tauri runtime.
 */
export function classifyConnectionHealth(s: ConnectionHealthInput): ConnectionHealth {
  if (s.conflictCount > 0) return 'conflict';
  if (!s.online) return 'offline';
  // Real transport health beats the optimistic `navigator.onLine` flag: the OS
  // can report a live interface while the tunnel/API is down.
  if (s.apiReachable === false) return 'unreachable';
  // Ein Stau schlägt „syncing", denn „syncing" wäre hier schlicht unwahr.
  // Bewusst NUR über der Schwelle: ein kurzes Warten während einer Anmeldung
  // ist normal und soll niemanden beunruhigen.
  if (s.blockedNeedsAttention && s.pendingCount > 0) return 'blocked';
  if (s.syncing || s.pendingCount > 0) return 'syncing';
  return 'ready';
}

interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingCount: number;
  conflictCount: number;
  /** Real request reachability — see `ConnectionHealthInput.apiReachable`. */
  apiReachable: boolean | null;
  /**
   * Warum der Ausgangskorb zuletzt pausiert hat, oder `null`, wenn er läuft.
   * Kommt aus `drainOutbox` (`reason` im Ergebnis `aborted`).
   */
  blockedReason?: 'auth' | 'transport' | null;
  /**
   * Der Ausgangskorb steht länger als die Stauschwelle. Kommt ebenfalls aus
   * `drainOutbox` (`needsAttention`).
   */
  blockedNeedsAttention?: boolean;
  /** Epoch ms of the last successful API response (telemetry-fed). */
  lastSuccessAt: number | null;
  /** Epoch ms of the last transport-level failure (telemetry-fed). */
  lastFailureAt: number | null;
  setOnline: (online: boolean) => void;
  setSyncing: (syncing: boolean) => void;
  /** Telemetry hook: a request reached the server and returned a response. */
  recordRequestSuccess: () => void;
  /** Telemetry hook: a request failed at the transport (network / circuit). */
  recordRequestFailure: (kind: RequestFailureKind) => void;
  /** Pull the latest pending/conflict counts from the durable outbox. */
  refreshStats: () => Promise<void>;
}

const initialOnline = typeof navigator === 'undefined' ? true : navigator.onLine;

export const useSyncStore = create<SyncState>((set) => ({
  online: initialOnline,
  syncing: false,
  pendingCount: 0,
  conflictCount: 0,
  apiReachable: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  recordRequestSuccess: () => set({ apiReachable: true, lastSuccessAt: Date.now() }),
  recordRequestFailure: () => set({ apiReachable: false, lastFailureAt: Date.now() }),
  refreshStats: async () => {
    // `getStats` is optional on the OutboxStore contract; the Tauri store
    // implements it. Outside a Tauri webview it may reject (no SQLite) — keep
    // the last known counts and let the next tick retry.
    if (!outboxStore.getStats) return;
    try {
      const stats = await outboxStore.getStats();
      set({ pendingCount: stats.pending, conflictCount: stats.conflict });
    } catch {
      // SQLite unavailable / not ready — silent; counts refresh on the next tick.
    }
  },
}));

// Keep `online` in lock-step with the browser's connectivity (guarded for SSR /
// test environments without a window). On a reconnect we optimistically clear a
// stale `apiReachable=false` so the next real request decides — the badge won't
// stay red purely because the OS bounced the interface.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    useSyncStore.setState({ online: true, apiReachable: null });
  });
  window.addEventListener('offline', () => useSyncStore.getState().setOnline(false));
}
