/**
 * Outbox replay engine (ADR-0044 §6 — action items 4 & 5). Pure orchestration:
 * given a durable `OutboxStore` and an injected `replay` function (which the
 * app layer backs with `client.request(...)`), this drains pending mutations
 * in strict FIFO order and applies the conflict-resolution policy.
 *
 * No Tauri, no React, no network — fully unit-testable. The app layer
 * (`apps/tauri-pos/src/lib/offline-replay.ts`) wires the network-status
 * listeners, the real client, and the single-flight lock around `drainOutbox`.
 *
 * Policy (ADR-0044 §6):
 *   • success            → `markSucceeded`, advance to next row.
 *   • transient failure  → ABORT the run, leave the row `pending`. Retry on
 *     the next connectivity event. (ApiNetworkError, ApiCircuitOpenError, and
 *     5xx/429 — infrastructure, not intent, is at fault.)
 *   • auth gap           → ABORT the run, leave `pending`. A replayed request
 *     hitting UNAUTHORIZED / STEP_UP_REQUIRED means there is no session to
 *     replay under; it is not a divergence. (Step-up is skipped during replay,
 *     so it cannot be answered in the background.)
 *   • anything else      → HALT: mark the row `conflict`, emit `onConflict`,
 *     and STOP. Subsequent rows stay `pending` behind it. Strict FIFO halt is
 *     the safe default for a fiscal ledger — applying mutation N+1 while N is
 *     unresolved can produce nonsensical states (a Storno before its parent
 *     sale reconciles, a cash-movement across a closed Tagesabschluss).
 */

import {
  ApiCircuitOpenError,
  ApiError,
  ApiNetworkError,
  ApiOutboxConflictError,
} from '../errors.js';
import type { OutboxRecord, OutboxStore } from './offline-queue.js';

/** Outcome of one drain pass. */
export type ReplayOutcome =
  | { readonly kind: 'drained'; readonly succeeded: number }
  | {
      readonly kind: 'aborted';
      readonly succeeded: number;
      readonly record: OutboxRecord;
      readonly error: unknown;
      /**
       * WARUM pausiert wurde. Bis zum 26.07.2026 gab es diesen Unterschied
       * nicht, und genau das war der Schaden: eine fehlende Anmeldung und ein
       * abgerissenes Netz sahen für die Oberfläche gleich aus. Sie meldete in
       * beiden Fällen „Die Warteschlange wird gerade abgearbeitet", während in
       * Wahrheit nichts mehr lief.
       *
       * `auth`      — es gibt keine Sitzung, unter der nachgespielt werden
       *               könnte. Das Warten ist RICHTIG, aber es muss so heissen.
       * `transport` — Netz oder Server nicht erreichbar. Löst sich von selbst.
       */
      readonly reason: 'auth' | 'transport';
      /** Wie lange die BLOCKIERENDE Zeile schon liegt (ms, Geräteuhr). */
      readonly blockedForMs: number;
      /**
       * Über der Schwelle: das ist kein Warten mehr, sondern ein Stau, und ein
       * Mensch muss es sehen.
       *
       * Auf der Windows-Kasse ist der Stau bei `auth` ENDGÜLTIG: die
       * Wiederholung trägt den beim Einreihen versiegelten Bearer, und der ist
       * abgelaufen. Auf dem Mac löst er sich bei der nächsten Anmeldung von
       * selbst — deshalb fiel es nie auf.
       */
      readonly needsAttention: boolean;
    }
  | {
      readonly kind: 'halted';
      readonly succeeded: number;
      readonly record: OutboxRecord;
      readonly error: ApiOutboxConflictError;
    };

/**
 * Ab wann ein pausierter Ausgangskorb kein Warten mehr ist, sondern ein Stau.
 *
 * Eine Anmeldelücke ist kurz normal: die Kassiererin ist abgemeldet und meldet
 * sich gleich wieder an. Sechs Stunden sind keine Lücke mehr. Der Wert ist
 * bewusst grosszügig, damit ein Feierabend keinen Alarm auslöst, und trotzdem
 * eng genug, dass ein echter Stau denselben Tag nicht überlebt.
 */
export const STAU_SCHWELLE_MS = 6 * 60 * 60 * 1000;

export interface ReplayDependencies {
  store: OutboxStore;
  /**
   * Replay a single sealed mutation against the server. Resolves with the
   * server response on 2xx; throws `ApiError` / `ApiNetworkError` /
   * `ApiCircuitOpenError` otherwise. The app backs this with
   * `client.request(record.method, record.path, record.body, { headers, custom: { skipOfflineQueue: true, skipStepUp: true, idempotencyKey } })`.
   */
  replay: (record: OutboxRecord) => Promise<unknown>;
  /** Fired once when a conflict halts the queue — UI surfaces the Compliance Inbox. */
  onConflict?: (record: OutboxRecord, error: ApiOutboxConflictError) => void;
  /**
   * Die Uhr, hereingereicht statt gelesen. Ohne das liesse sich „seit sechs
   * Stunden blockiert" nicht prüfen, ohne sechs Stunden zu warten.
   */
  now?: () => number;
}

/** Auth-shaped codes: no session to replay under — leave pending, don't halt. */
const AUTH_GAP_CODES = new Set(['UNAUTHORIZED', 'STEP_UP_REQUIRED', 'DEVICE_NOT_AUTHORIZED']);

/** Transient = infrastructure unreachability, retry later; never a conflict. */
function isTransient(err: unknown): boolean {
  if (err instanceof ApiNetworkError || err instanceof ApiCircuitOpenError) return true;
  if (err instanceof ApiError) {
    if (AUTH_GAP_CODES.has(err.code)) return true;
    return err.httpStatus === 429 || err.httpStatus >= 500;
  }
  return false;
}

function toConflictError(err: unknown, idempotencyKey: string): ApiOutboxConflictError {
  if (err instanceof ApiError) {
    return new ApiOutboxConflictError({
      idempotencyKey,
      serverCode: err.code,
      serverDetails: err.details,
      message: err.message,
    });
  }
  return new ApiOutboxConflictError({
    idempotencyKey,
    serverCode: 'UNKNOWN',
    serverDetails: err,
    message: err instanceof Error ? err.message : String(err),
  });
}

/**
 * Drain the outbox once, FIFO. Single-flight is the caller's responsibility
 * (the app-layer controller guards against overlapping runs).
 */
export async function drainOutbox(deps: ReplayDependencies): Promise<ReplayOutcome> {
  const jetzt = deps.now ?? (() => Date.now());
  const pending = await deps.store.listPending();
  let succeeded = 0;

  for (const record of pending) {
    try {
      const response = await deps.replay(record);
      await deps.store.markSucceeded(record.idempotencyKey, response);
      succeeded += 1;
    } catch (err) {
      if (isTransient(err)) {
        // Der Unterschied, der bisher fehlte: eine Anmeldelücke ist etwas
        // anderes als ein Netzausfall, auch wenn beide zum Warten führen.
        const reason: 'auth' | 'transport' =
          err instanceof ApiError && AUTH_GAP_CODES.has(err.code) ? 'auth' : 'transport';

        // `enqueuedAt` steht auf jeder Zeile und musste dafür nicht erfunden
        // werden. Gemessen wird die KOPFZEILE: sie blockiert alles dahinter,
        // denn die Reihenfolge ist streng und muss es bleiben (fiskalische
        // Vorgänge dürfen ihre Reihenfolge nicht verlieren).
        const blockedForMs = Math.max(0, jetzt() - record.enqueuedAt);

        return {
          kind: 'aborted',
          succeeded,
          record,
          error: err,
          reason,
          blockedForMs,
          needsAttention: blockedForMs > STAU_SCHWELLE_MS,
        };
      }
      const conflict = toConflictError(err, record.idempotencyKey);
      await deps.store.markConflict(record.idempotencyKey, conflict);
      deps.onConflict?.(record, conflict);
      return { kind: 'halted', succeeded, record, error: conflict };
    }
  }

  return { kind: 'drained', succeeded };
}
