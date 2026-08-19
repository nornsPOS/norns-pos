/**
 * tse-queue-drain-hook — the app-layer driver for the TSE replay queue (Phase
 * 1.3, Step 5b). Owns the single-flight controller + 5s heartbeat + online
 * listener + startup sweep, mirroring `useOfflineReplay` but as its OWN,
 * independent hook: neither drain's `running` flag can starve the other, and the
 * CI-guarded middleware order (`api-context`, `production-middleware-order.test`)
 * stays untouched.
 *
 * Kept in a sibling of `tse-queue-drain.ts` so the pure drain engine (+ its unit
 * tests) never transitively pulls in React / the api-context / the Tauri bridge.
 */

import { useEffect, useState } from 'react';

import { transactionsApi } from '@norns/api-client';
import type { ApiClient } from '@norns/api-client';

import { useApiClient } from './api-context.js';
import { tseClient } from './hardware-client.js';
import { drainTseQueue, type TseDrainDeps } from './tse-queue-drain.js';
import { tseQueueStore, type TseQueueStats } from './tse-queue-store.js';

export interface TseDrainController {
  start(): void;
  stop(): void;
  trigger(): Promise<void>;
}

/** Conservative online probe — treat "unknown" as online (same as the outbox drain). */
function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Build the drain seams from the live client + Tauri bridge. */
function buildDeps(client: ApiClient): TseDrainDeps {
  return {
    store: tseQueueStore,
    // Path (a): re-invoke FINISH. The row carries everything needed; the empty
    // processDataBase64 mirrors the online path (tse-service.closeTseSession),
    // and the Fiskaly secrets are hydrated Rust-side from the OS keychain.
    finish: (entry) =>
      tseClient.finish({
        config: { tssId: entry.tssId, clientId: entry.clientId },
        intentionId: entry.intentionId,
        fiskalyTransactionId: entry.fiskalyTransactionId,
        amountCents: entry.amountCents,
        paymentKind: entry.paymentKind,
        processDataBase64: '',
        processType: entry.processType,
        amountsPerVatRate: entry.amountsPerVatRate,
        receiptType: entry.receiptType,
      }),
    // The idempotent server-record leg. Numeric counters go over the wire as
    // decimal STRINGS (bigint-safe), matching the online BezahlenDialog path.
    record: async (entry, signature) => {
      await transactionsApi.recordTseSignature(client, entry.serverTransactionId, {
        fiskalyTssId: entry.tssId,
        fiskalyClientId: entry.clientId,
        fiskalyTransactionId: entry.fiskalyTransactionId,
        fiskalyTransactionNumber: String(signature.transactionNumber),
        signatureValue: signature.signatureValue,
        signatureCounter: String(signature.signatureCounter),
        signatureAlgorithm: signature.signatureAlgorithm,
        // Auch der Nachreicher meldet die zwei Angaben mit, sonst bliebe
        // die `tse.csv` genau für die Belege leer, die offline entstanden
        // sind — und das sind die, bei denen ein Prüfer am genauesten hinsieht.
        tssSerialNumber: signature.tssSerialNumber,
        signaturePublicKey: signature.signaturePublicKey,
        processType: entry.processType,
        qrCodeData: signature.qrCodePayload,
        tseStartTime: signature.startedAt,
        tseEndTime: signature.finishedAt,
      });
    },
    now: () => Date.now(),
  };
}

/** A single-flight controller — one drain at a time, retriggered by online + heartbeat. */
export function createTseQueueDrainController(deps: TseDrainDeps): TseDrainController {
  let running = false;
  let started = false;

  async function trigger(): Promise<void> {
    if (running || !isOnline()) return;
    running = true;
    try {
      await drainTseQueue(deps);
    } catch {
      // listDrainable / store I/O failure (e.g. browser: Db.load rejects) —
      // swallow; the next heartbeat/online event retries. Never throw from a
      // background driver.
    } finally {
      running = false;
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
      // Startup sweep: rows left by a previous crash / offline session.
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
 * Drain the durable TSE queue while authenticated. Mounted in App.tsx NEXT TO
 * `useOfflineReplay` (not folded in) so the two background drains stay fully
 * independent. One controller instance backs both the online listener and the
 * 5s heartbeat, so its single `running` flag prevents any overlap.
 */
export function useTseQueueDrain(enabled: boolean): void {
  const client = useApiClient();

  useEffect(() => {
    if (!enabled) return;
    const controller = createTseQueueDrainController(buildDeps(client));
    controller.start();
    const id = setInterval(() => {
      void controller.trigger();
    }, 5000);
    return () => {
      clearInterval(id);
      controller.stop();
    };
  }, [enabled, client]);
}

/**
 * Live TSE replay-queue backlog for the Gerätemanager badge. Polls
 * `tseQueueStore.getStats()` on mount + every 5s. Degrades to `null` (the
 * honest "no local records" state) when the store is unavailable (browser /
 * Db.load rejects) — the badge simply shows nothing rather than a fake zero.
 */
export function useTseQueueStats(pollMs = 5000): TseQueueStats | null {
  const [stats, setStats] = useState<TseQueueStats | null>(null);

  useEffect(() => {
    let alive = true;
    const read = async (): Promise<void> => {
      try {
        const s = await tseQueueStore.getStats();
        if (alive) setStats(s);
      } catch {
        if (alive) setStats(null);
      }
    };
    void read();
    const id = setInterval(() => void read(), pollMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return stats;
}
