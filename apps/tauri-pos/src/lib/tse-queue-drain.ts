/**
 * tse-queue-drain — one FIFO pass over the durable TSE replay queue (Phase 1.3,
 * Step 5a). The pure engine, mirroring `drainOutbox` in the api-client: no
 * timers, no listeners, never throws. The single-flight `running` flag + 5s
 * heartbeat + online-listener + startup sweep live in the `useTseQueueDrain`
 * hook (Step 5b), exactly as `drainOutbox` is driven by `useOfflineReplay`.
 *
 * Two replay paths per row (keyed on `signature`):
 *   (a) finish-failed (signature NULL) → re-invoke Fiskaly FINISH, PERSIST the
 *       signature onto the row BEFORE the record leg (so a crash in between can
 *       only ever leave a record-only row — never a re-FINISH of an already-
 *       finished intention), then POST it to the server.
 *   (b) record-failed (signature populated) → POST only; NEVER re-FINISH.
 *
 * The record leg is server-idempotent (`transactionsApi.recordTseSignature`,
 * "Idempotent — safe to retry"), so re-running it is safe.
 *
 * A FINISH that keeps rejecting (e.g. the intention really was already finished
 * server-side, so the signature is unreconstructable) is NOT fast-terminaled on
 * a heuristic — that risks discarding a still-recoverable signature when the
 * rejection is only a transient proxy/gateway wrapper. Instead every FINISH
 * rejection is retried, and the MAX_ATTEMPTS cap is the sole backstop: a truly
 * dead intention reaches `failed_terminal` after the cap (bounded, surfaced via
 * the Gerätemanager badge), while a transient one is recovered on a later sweep.
 *
 * Rows are independent fiscal records (distinct transactions), so a failure on
 * one row does NOT abort the sweep — unlike the outbox, whose FIFO mutations can
 * depend on each other. Each failure is per-row: increment, or at the cap go
 * terminal, then continue to the next row.
 */

import { istDauerhaftAbgelehnt } from './tse-nachreichen-regel.js';
import type { DrainableTseEntry, TseQueueStore } from './tse-queue-store.js';
import type { TseSignature } from './hardware-client.js';

export interface TseDrainDeps {
  store: TseQueueStore;
  /**
   * Path (a): re-invoke Fiskaly FINISH for a finish-failed row. Resolves with
   * the signature; rejects with the underlying error. A rejection — INCLUDING a
   * genuine "already finished" — routes through the retry/cap path, never a
   * fast-terminal (a heuristic false-positive must not discard a recoverable
   * signature; the MAX_ATTEMPTS cap is the sole backstop).
   */
  finish: (entry: DrainableTseEntry) => Promise<TseSignature>;
  /**
   * The server-record leg (idempotent). Records `signature` against the row's
   * server transaction. Rejects on any non-2xx.
   */
  record: (entry: DrainableTseEntry, signature: TseSignature) => Promise<void>;
  /** Injected clock (testability); Step 5b passes `Date.now`. */
  now: () => number;
}

export interface TseDrainOutcome {
  /** Rows examined this pass. */
  attempted: number;
  /** Fully replayed (finished if needed + recorded). */
  succeeded: number;
  /** Moved to `failed_terminal` this pass (cap hit or unreconstructable FINISH). */
  terminal: number;
  /** Failed transiently, left `pending` for the next sweep. */
  retryable: number;
}

/**
 * Drain the TSE queue once, FIFO. Never throws: a store-write failure while
 * handling a row is swallowed (best-effort) so one bad row can't wedge the
 * sweep or crash the driving hook. A rejection from `store.listDrainable`
 * itself propagates — the hook's try/finally owns that.
 */
export async function drainTseQueue(deps: TseDrainDeps): Promise<TseDrainOutcome> {
  const { store, finish, record, now } = deps;
  const outcome: TseDrainOutcome = { attempted: 0, succeeded: 0, terminal: 0, retryable: 0 };

  const drainable = await store.listDrainable(now());
  for (const entry of drainable) {
    outcome.attempted += 1;
    try {
      await store.markInFlight(entry.id, now());

      let signature = entry.signature;
      if (signature === null) {
        // Path (a): finish-failed — re-invoke FINISH. Any rejection (INCLUDING a
        // genuine "already finished") falls to the outer catch → retry/cap. A
        // transient wrapper gets retried (finish may then succeed → signature
        // recovered); a truly-consumed intention keeps failing until the cap →
        // terminal. We never fast-terminal on a heuristic (B1): that would
        // discard a still-recoverable signature.
        signature = await finish(entry);
        // Persist BEFORE the record leg so a hard CRASH here degrades to a
        // record-only replay (never a re-FINISH). If the persist itself THROWS
        // (local DB error, not a crash), keep the in-hand signature and still
        // record it — the server is its durable home; only a persist AND record
        // double-failure can lose it.
        try {
          await store.persistSignature(entry.id, signature);
        } catch {
          /* proceed to record with the in-memory signature */
        }
      }

      // Record leg (idempotent), for BOTH paths.
      await record(entry, signature);
      await store.markSucceeded(entry.id, now());
      outcome.succeeded += 1;
    } catch (err) {
      // Per-row failure. At the cap the row becomes a surfaced dead-end; else it
      // is re-armed to pending for the next heartbeat. Swallow a store-write
      // failure so it can't wedge the remaining rows.
      try {
        // ═══════════════════════════════════════════════════════════════
        //  ⚠️ HIER STAND `entry.attemptCount + 1 >= MAX_ATTEMPTS`
        // ═══════════════════════════════════════════════════════════════
        //
        // Acht Versuche im Fuenf-Sekunden-Takt sind rund 35 Sekunden. Danach
        // stand die Zeile auf `failed_terminal` und wurde NIE WIEDER
        // ausgewaehlt, auch nicht nach einem Neustart der Kasse. Eine
        // Wolken-TSE ist regelmaessig laenger als 35 Sekunden weg; ein Netz,
        // das eine Minute hakt, kostete damit eine Signatur fuer immer — und
        // § 146a AO kennt dafuer keine Ausnahme.
        //
        // Aufgegeben wird jetzt NUR noch, wenn die Gegenstelle den Rumpf
        // DAUERHAFT ablehnt. Ein falsch gebauter Rumpf wird beim tausendsten
        // Versuch genauso abgelehnt, und ihn ewig zu wiederholen versteckt den
        // Fehler hinter Rauschen. Alles andere — kein Netz, Zeitueberschreitung,
        // 5xx, „zu viele Anfragen" — wird ewig wiederholt, mit wachsendem
        // Abstand. Siehe `tse-nachreichen-regel.ts`.
        if (istDauerhaftAbgelehnt(err)) {
          await store.markFailedTerminal(entry.id, err, now());
          outcome.terminal += 1;
        } else {
          await store.incrementAttempt(entry.id, err, now());
          outcome.retryable += 1;
        }
      } catch {
        // best-effort; the row stays in_flight and the stale re-selection recovers it.
      }
    }
  }

  return outcome;
}
