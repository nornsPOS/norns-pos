/**
 * Offline replay controller (ADR-0044 §6 — action items 4 & 5), app layer.
 *
 * The pure FIFO/conflict policy lives in `drainOutbox` (api-client). This file
 * supplies the three things only the app knows: the real `ApiClient` to replay
 * through, the connectivity listeners that trigger a drain, and the
 * single-flight lock that keeps overlapping `online` events from double-draining.
 *
 * A replayed request is pushed back through the SAME production chain, but with
 * `meta.custom` flags that make it inert at the layers that would misbehave in
 * the background:
 *   • skipOfflineQueue — so offline-queue passes it through (no re-enqueue loop)
 *   • skipStepUp       — so a STEP_UP_REQUIRED can't try to open a PIN modal
 *   • idempotent       — so retry may safely re-attempt a 5xx (the sealed
 *                        Idempotency-Key guarantees at-most-once server-side)
 */

import { useEffect } from 'react';

import {
  type ApiClient,
  type OutboxRecord,
  type OutboxStore,
  drainOutbox,
} from '@norns/api-client';

import { useSyncStore } from '../state/sync-store.js';
import { useToastStore } from '../state/toast-store.js';
import { outboxStore, useApiClient } from './api-context.js';
import {
  type PosIntentsStore,
  type SealedFiscalRequest,
  posIntentsStore,
  sealedToOutboxRecord,
} from './pos-intents-store.js';

export interface ReplayController {
  /** Begin listening for connectivity + run an initial startup sweep. */
  start(): void;
  /** Detach listeners. */
  stop(): void;
  /** Drain now (single-flight). Resolves when this run settles. */
  trigger(): Promise<void>;
}

export interface OfflineReplayOptions {
  /** Surface a halted-queue conflict to the operator (Compliance Inbox cue). */
  onConflict?: (record: OutboxRecord, serverCode: string) => void;
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Heartbeat cadence (Phase 6.4): brisk while there is work to reflect, slow when
 *  the queue is idle so we don't poll SQLite twelve times a minute for nothing. */
const ACTIVE_HEARTBEAT_MS = 5_000;
const IDLE_HEARTBEAT_MS = 30_000;

/**
 * Phase 1.4 startup reconcile — funnel unresolved `pos_intents` (the pre-request
 * crash window) into the outbox on the SAME idempotency key, then let
 * `drainOutbox` carry them. Recovery rides the one at-most-once FIFO path and the
 * server's partial-UNIQUE index dedups on the shared key → never a double-finalize.
 * Runs BEFORE the first drain. Idempotent: `INSERT OR IGNORE` + `markResolved`,
 * so a re-run (or a crash between enqueue and mark) is a no-op.
 */
export async function reconcilePosIntents(
  intents: PosIntentsStore,
  outbox: Pick<OutboxStore, 'enqueue'>,
): Promise<void> {
  let unresolved: Awaited<ReturnType<PosIntentsStore['listUnresolved']>>;
  try {
    unresolved = await intents.listUnresolved();
  } catch {
    return; // browser / DB unavailable — nothing to reconcile
  }
  for (const intent of unresolved) {
    let sealed: SealedFiscalRequest;
    try {
      sealed = JSON.parse(intent.sealedRequestJson) as SealedFiscalRequest;
    } catch (parseErr) {
      // A malformed sealed request can never be replayed — fail it terminally so
      // it's surfaced (never retried forever), without blocking the other intents.
      try {
        await intents.markFailed(intent.key, parseErr);
      } catch {
        /* ignore */
      }
      continue;
    }
    try {
      await outbox.enqueue(sealedToOutboxRecord(sealed, intent.createdAt));
      await intents.markResolved(intent.key, { reconciledIntoOutbox: true });
    } catch {
      // Transient DB error — leave the intent unresolved; the next startup retries.
      // A re-enqueue is a no-op (INSERT OR IGNORE on the shared idempotency key).
    }
  }
}

export function createOfflineReplay(
  client: ApiClient,
  store: OutboxStore,
  options: OfflineReplayOptions = {},
): ReplayController {
  let running = false;
  let started = false;

  const replay = (record: OutboxRecord): Promise<unknown> =>
    client.request(record.method, record.path, record.body, {
      headers: record.headers,
      custom: {
        skipOfflineQueue: true,
        skipStepUp: true,
        idempotent: true,
        idempotencyKey: record.idempotencyKey,
        gobdRelevant: record.gobdRelevant,
      },
    });

  async function trigger(): Promise<void> {
    if (running || !isOnline()) return;
    running = true;
    // Surface "Synchronisiert" while the queue drains (header badge, ADR-0044 §6).
    useSyncStore.getState().setSyncing(true);
    try {
      const outcome = await drainOutbox({
        store,
        replay,
        onConflict: (record, error) => options.onConflict?.(record, error.serverCode),
      });
      if (outcome.kind === 'halted') {
        // Queue is now stopped behind a conflict — nothing more to do until the
        // Owner resolves it; the next online event will NOT advance past it.
      }
    } catch {
      // listPending / markSucceeded I/O failure — swallow; the next
      // connectivity event retries. Never throw from a background listener.
    } finally {
      running = false;
      const sync = useSyncStore.getState();
      sync.setSyncing(false);
      // Refresh after every drain — captures successful / failed / conflict rows.
      void sync.refreshStats();
    }
  }

  const onOnline = (): void => {
    void trigger();
  };

  return {
    start(): void {
      if (started || typeof window === 'undefined') return;
      started = true;
      window.addEventListener('online', onOnline);
      // Startup sweep: the app may launch already-online with rows left by a
      // previous crash or offline session (ADR-0044 §4 crash-recovery).
      void trigger();
    },
    stop(): void {
      if (!started || typeof window === 'undefined') return;
      started = false;
      window.removeEventListener('online', onOnline);
    },
    trigger,
  };
}

/**
 * Drive the replay controller from React. Pass `enabled = true` only once the
 * session is authenticated — a replay under no session would 401 (handled as a
 * transient abort, but pointless to attempt).
 */
export function useOfflineReplay(enabled: boolean): void {
  const client = useApiClient();
  const addToast = useToastStore((s) => s.addToast);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = createOfflineReplay(client, outboxStore, {
      onConflict: (record, serverCode) => {
        // A halted-queue conflict — refresh the badge so it flips to red.
        void useSyncStore.getState().refreshStats();
        addToast({
          tone: 'alert',
          title: 'Synchronisierungskonflikt',
          body: `Ein Offline-Vorgang (${record.path}) weicht vom Server ab (${serverCode}) und muss geprüft werden.`,
        });
      },
    });
    // Retention housekeeping (Phase 6.4): drop expired, non-fiscal, succeeded rows
    // so the outbox never grows without bound. Best-effort + independent of the
    // drain (it only deletes SUCCEEDED rows, never a pending/conflict/fiscal one).
    void outboxStore.pruneExpired().catch(() => {});
    // Reconcile crash-window pos_intents INTO the outbox first, THEN start the
    // controller (its startup sweep drains the just-reconciled rows). If the hook
    // unmounts mid-reconcile, don't start a controller we're about to drop.
    void reconcilePosIntents(posIntentsStore, outboxStore).then(() => {
      if (!cancelled) controller.start();
    });
    return () => {
      cancelled = true;
      controller.stop();
    };
  }, [enabled, client, addToast]);

  // Lightweight heartbeat: keep the header badge counts + online flag fresh
  // (covers enqueues, which happen inside the api-client middleware out-of-band).
  // Self-scheduling so the cadence can BACK OFF when the queue is idle (Phase 6.4)
  // — a brisk 5s while there is work, a calm 30s when there is nothing to reflect.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const s = useSyncStore.getState();
      s.setOnline(isOnline());
      await s.refreshStats();
      if (cancelled) return;
      const { pendingCount, conflictCount } = useSyncStore.getState();
      const idle = pendingCount === 0 && conflictCount === 0;
      timer = setTimeout(() => void tick(), idle ? IDLE_HEARTBEAT_MS : ACTIVE_HEARTBEAT_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled]);
}
