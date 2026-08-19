/**
 * Phase 1.3 Step 5a — the pure TSE replay drain.
 *
 * Drives `drainTseQueue` against an in-memory fake store + fake finish/record
 * seams, proving the fiscal-critical invariants:
 *   • finish-failed row → FINISH, then the signature is persisted BEFORE the
 *     record leg (the B1 crash-window guard), then record.
 *   • record-failed (already-signed) row → record ONLY; FINISH is never called.
 *   • FINISH "already finished" → failed_terminal (bounded dead-end, no loop).
 *   • the MAX_ATTEMPTS cap turns a repeatedly-failing row terminal.
 *   • a transient failure leaves the row pending (retryable), not terminal.
 *   • independent rows: one failure does not abort the rest of the sweep.
 */
import { describe, expect, it, vi } from 'vitest';

import type { TseSignature } from './hardware-client.js';
import { drainTseQueue, type TseDrainDeps } from './tse-queue-drain.js';
import {
  type DrainableTseEntry,
  type EnrichedTseQueueEntry,
  type TseQueueStats,
  type TseQueueStore,
} from './tse-queue-store.js';

const sig = (n: number): TseSignature => ({
  signatureValue: `sig-${n}`,
  signatureCounter: n,
  signatureAlgorithm: 'ecdsa-plain-SHA256',
    signaturePublicKey: 'MUSTER-PUBLIC-KEY',
    tssSerialNumber: 'MUSTER-TSE-SERIAL',
  transactionNumber: n,
  startedAt: '2026-07-06T10:00:00.000Z',
  finishedAt: '2026-07-06T10:00:01.000Z',
  qrCodePayload: `qr-${n}`,
});

interface FakeRow extends DrainableTseEntry {
  status: 'pending' | 'in_flight' | 'succeeded' | 'failed_terminal';
}

function drainableFrom(id: number, over: Partial<DrainableTseEntry> = {}): FakeRow {
  return {
    id,
    monotonicSeq: id,
    intentionId: `int-${id}`,
    fiskalyTransactionId: `ftx-${id}`,
    tssId: 'tss-1',
    clientId: 'cli-1',
    serverTransactionId: `srv-${id}`,
    amountCents: 1990,
    paymentKind: 'CASH',
  receiptType: 'RECEIPT' as const,
  lastAttemptAt: null as number | null,
    amountsPerVatRate: [{ vatRate: 'NORMAL', amountCents: 1990 }],
    processType: 'Kassenbeleg-V1',
    receiptLocator: `RCP-${id}`,
    signature: null,
    status: 'pending',
    attemptCount: 0,
    ...over,
  };
}

/** In-memory store that records the call order so ordering invariants are testable. */
function makeFakeStore(rows: FakeRow[]) {
  const log: string[] = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const store: TseQueueStore = {
    enqueue: vi.fn(async (_e: EnrichedTseQueueEntry) => {}),
    listDrainable: vi.fn(async () => rows.filter((r) => r.status === 'pending' || r.status === 'in_flight')),
    markInFlight: vi.fn(async (id: number) => {
      log.push(`markInFlight:${id}`);
      const r = byId.get(id);
      if (r) r.status = 'in_flight';
    }),
    persistSignature: vi.fn(async (id: number, signature: TseSignature) => {
      log.push(`persistSignature:${id}`);
      const r = byId.get(id);
      if (r) r.signature = signature;
    }),
    incrementAttempt: vi.fn(async (id: number) => {
      log.push(`incrementAttempt:${id}`);
      const r = byId.get(id);
      if (r) {
        r.attemptCount += 1;
        r.status = 'pending';
      }
    }),
    markSucceeded: vi.fn(async (id: number) => {
      log.push(`markSucceeded:${id}`);
      const r = byId.get(id);
      if (r) r.status = 'succeeded';
    }),
    markFailedTerminal: vi.fn(async (id: number) => {
      log.push(`markFailedTerminal:${id}`);
      const r = byId.get(id);
      if (r) r.status = 'failed_terminal';
    }),
    getStats: vi.fn(async (): Promise<TseQueueStats> => ({ pending: 0, inFlight: 0, failedTerminal: 0 })),
  };
  return { store, log, byId };
}

function deps(over: Partial<TseDrainDeps>): TseDrainDeps {
  return {
    store: makeFakeStore([]).store,
    finish: vi.fn(async () => sig(1)),
    record: vi.fn(async () => {}),
    now: () => 1_000_000,
    ...over,
  };
}

describe('drainTseQueue', () => {
  it('finish-failed row: FINISH → persistSignature (before record) → record → succeeded', async () => {
    const { store, log, byId } = makeFakeStore([drainableFrom(1, { signature: null })]);
    const finish = vi.fn(async () => sig(5));
    const record = vi.fn(async () => {
      log.push('record:1'); // interleave into the same log to assert ordering
    });

    const outcome = await drainTseQueue(deps({ store, finish, record }));

    expect(finish).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    // The persist MUST precede the record leg (B1 crash-window guard).
    expect(log).toEqual([
      'markInFlight:1',
      'persistSignature:1',
      'record:1',
      'markSucceeded:1',
    ]);
    expect(byId.get(1)?.status).toBe('succeeded');
    expect(outcome).toEqual({ attempted: 1, succeeded: 1, terminal: 0, retryable: 0 });
  });

  it('already-signed row: record ONLY, FINISH never called', async () => {
    const { store } = makeFakeStore([drainableFrom(1, { signature: sig(7) })]);
    const finish = vi.fn(async () => sig(99));
    const record = vi.fn(async (entry: DrainableTseEntry, signature: TseSignature) => {
      expect(signature.signatureCounter).toBe(7); // the STORED signature, not a re-FINISH
      expect(entry.serverTransactionId).toBe('srv-1');
    });

    const outcome = await drainTseQueue(deps({ store, finish, record }));

    expect(finish).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledTimes(1);
    expect(outcome.succeeded).toBe(1);
  });

  it('a FINISH rejection is RETRIED (pending), never fast-terminaled on a heuristic', async () => {
    // Regression: a transient proxy wrapper like "connection already closed" must
    // NOT retire a finish-failed row on attempt 1 — the signature is still
    // recoverable on a later sweep. Only the MAX_ATTEMPTS cap terminates it.
    const { store, byId } = makeFakeStore([drainableFrom(1, { signature: null })]);
    const finish = vi.fn(async () => {
      throw new Error('connection already closed, please complete the request');
    });
    const record = vi.fn(async () => {});

    const outcome = await drainTseQueue(deps({ store, finish, record }));

    expect(record).not.toHaveBeenCalled();
    expect(byId.get(1)?.status).toBe('pending'); // retryable, NOT terminal
    expect(byId.get(1)?.attemptCount).toBe(1);
    expect(outcome).toEqual({ attempted: 1, succeeded: 0, terminal: 0, retryable: 1 });
  });

  it('a persistSignature failure still records the in-hand signature (no loss)', async () => {
    // finish() succeeds → the intention is consumed; if the local persist THROWS,
    // the drain must still record the in-memory signature (server = durable home),
    // not discard it and re-FINISH.
    const { store, byId } = makeFakeStore([drainableFrom(1, { signature: null })]);
    (store.persistSignature as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DB locked'));
    const finish = vi.fn(async () => sig(4));
    const record = vi.fn(async (_e: DrainableTseEntry, _s: TseSignature) => {});

    const outcome = await drainTseQueue(deps({ store, finish, record }));

    expect(record).toHaveBeenCalledTimes(1); // recorded despite the persist failure
    expect(record.mock.calls[0]![1].signatureCounter).toBe(4); // the in-hand signature
    expect(byId.get(1)?.status).toBe('succeeded');
    expect(outcome.succeeded).toBe(1);
  });

  it('⛔ ein FINISH, den die Gegenstelle dauerhaft ablehnt, geht auf failed_terminal', async () => {
    /**
     * ⚠️ Auch dieser Satz hing an der Versuchszahl („at the cap"). Der Grund,
     * aufzugeben, ist aber nicht WIE OFT es scheiterte, sondern WORAN:
     * „transaction already finished" ist ein 409 und wird beim tausendsten
     * Versuch genauso kommen.
     *
     * Der Unterschied ist nicht theoretisch. Vorher genügten acht
     * Netzhüpfer, um eine Signatur endgültig zu verlieren.
     */
    const { store, byId } = makeFakeStore([
      drainableFrom(1, { signature: null, attemptCount: 0 }),
    ]);
    const finish = vi.fn(async () => {
      throw Object.assign(new Error('transaction already finished'), { status: 409 });
    });

    const outcome = await drainTseQueue(deps({ store, finish, record: vi.fn(async () => {}) }));

    expect(byId.get(1)?.status).toBe('failed_terminal');
    expect(outcome.terminal).toBe(1);
  });

  it('a transient failure leaves the row pending (retryable), not terminal', async () => {
    const { store, byId } = makeFakeStore([drainableFrom(1, { signature: sig(3), attemptCount: 0 })]);
    const record = vi.fn(async () => {
      throw new Error('fiskaly 503');
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(byId.get(1)?.status).toBe('pending');
    expect(byId.get(1)?.attemptCount).toBe(1);
    expect(outcome).toEqual({ attempted: 1, succeeded: 0, terminal: 0, retryable: 1 });
  });

  it('⛔ auch nach vielen Versuchen bleibt eine VORÜBERGEHENDE Ablehnung wiederholbar', async () => {
    /**
     * ── DER BEFUND VOM 08.08.2026 ──────────────────────────────────────
     *
     * Dieser Satz verlangte bis heute das GEGENTEIL: bei `MAX_ATTEMPTS`
     * sollte die Zeile auf `failed_terminal` gehen. Acht Versuche im
     * Fünf-Sekunden-Takt sind rund 35 Sekunden, und danach wurde sie NIE
     * WIEDER ausgewählt, auch nicht nach einem Neustart der Kasse.
     *
     * Eine Wolken-TSE ist regelmässig länger als 35 Sekunden weg. Ein Netz,
     * das eine Minute hakt, kostete damit eine gesetzlich verlangte
     * Signatur für immer. § 146a AO kennt dafür keine Ausnahme.
     *
     * Der Test pinnte also den Fehler fest. Jetzt pinnt er die Regel:
     * aufgegeben wird nur bei DAUERHAFTER Ablehnung, und „kein Netz" ist
     * nicht dauerhaft — egal beim wievielten Versuch.
     */
    const { store, byId } = makeFakeStore([
      drainableFrom(1, { signature: sig(3), attemptCount: 99 }),
    ]);
    const record = vi.fn(async () => {
      throw new Error('fetch failed');
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(byId.get(1)?.status, 'die Zeile darf nicht aufgegeben werden').not.toBe(
      'failed_terminal',
    );
    expect(outcome.terminal).toBe(0);
    expect(outcome.retryable).toBe(1);
  });

  it('⛔ eine DAUERHAFTE Ablehnung geht sofort auf failed_terminal', async () => {
    // Ein falsch gebauter Rumpf wird beim tausendsten Versuch genauso
    // abgelehnt. Ihn ewig zu wiederholen versteckt den Fehler hinter Rauschen,
    // und der Händler sieht nie, dass er handeln muss.
    const { store, byId } = makeFakeStore([
      drainableFrom(1, { signature: sig(3), attemptCount: 0 }),
    ]);
    const record = vi.fn(async () => {
      throw Object.assign(new Error('Bad Request'), { status: 400 });
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(byId.get(1)?.status).toBe('failed_terminal');
    expect(outcome.terminal).toBe(1);
  });

  it('independent rows: one failure does not abort the rest of the sweep', async () => {
    const { store, byId } = makeFakeStore([
      drainableFrom(1, { signature: sig(1) }),
      drainableFrom(2, { signature: sig(2) }),
      drainableFrom(3, { signature: sig(3) }),
    ]);
    const record = vi.fn(async (entry: DrainableTseEntry) => {
      if (entry.id === 2) throw new Error('row 2 transient');
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(record).toHaveBeenCalledTimes(3); // all three attempted
    expect(byId.get(1)?.status).toBe('succeeded');
    expect(byId.get(2)?.status).toBe('pending'); // failed but retryable
    expect(byId.get(3)?.status).toBe('succeeded'); // NOT blocked by row 2
    expect(outcome).toEqual({ attempted: 3, succeeded: 2, terminal: 0, retryable: 1 });
  });
});
