/**
 * Phase 1.3 — tse-service enqueues failed TSE signatures to the DURABLE queue.
 *
 * The volatile localStorage queue is gone (its validation is now the durable
 * store's job — see tse-queue-store.test.ts). What tse-service still owns is the
 * MAPPING from a finalize context to an enriched queue entry: the finish-failed
 * path (closeTseSession, signature NULL) and the record-failed path
 * (enqueueSignatureRecordOnly, signature populated). These tests lock both
 * mappings against the store seam.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TseIntention, TseSignature } from './hardware-client.js';

const h = vi.hoisted(() => ({
  enqueue: vi.fn(async (_entry: Record<string, unknown>) => {}),
  finish: vi.fn(async (): Promise<TseSignature> => signature),
  isRunningInTauri: vi.fn(() => true),
}));

vi.mock('./tse-queue-store.js', () => ({
  tseQueueStore: { enqueue: h.enqueue },
}));
vi.mock('./hardware-client.js', () => ({
  isRunningInTauri: h.isRunningInTauri,
  tseClient: { finish: h.finish, start: vi.fn() },
}));

import { closeTseSession, enqueueSignatureRecordOnly } from './tse-service.js';

const intention: TseIntention = {
  intentionId: 'int-1',
  fiskalyTransactionId: 'ftx-1',
  startedAt: '2026-07-06T10:00:00.000Z',
};

const signature: TseSignature = {
  signatureValue: 'sig-1',
  signatureCounter: 42,
  signatureAlgorithm: 'ecdsa-plain-SHA256',
    signaturePublicKey: 'MUSTER-PUBLIC-KEY',
    tssSerialNumber: 'MUSTER-TSE-SERIAL',
  transactionNumber: 7,
  startedAt: '2026-07-06T10:00:00.000Z',
  finishedAt: '2026-07-06T10:00:01.000Z',
  qrCodePayload: 'qr-1',
};

const baseClose = {
  config: { tssId: 'tss-1', clientId: 'cli-1' },
  intentionId: 'int-1',
  receiptLocator: 'RCP-1',
  paymentKind: 'CASH' as const,
  intention,
  amountCents: 1990,
  serverTransactionId: 'srv-1',
  amountsPerVatRate: [{ vatRate: 'NORMAL' as const, amountCents: 1990 }],
};

afterEach(() => {
  h.enqueue.mockClear();
  h.enqueue.mockResolvedValue(undefined);
  h.finish.mockReset();
  h.finish.mockResolvedValue(signature);
});

describe('closeTseSession — finish-failed durable enqueue (path a)', () => {
  it('on FINISH failure enqueues a NULL-signature entry with the full replay context', async () => {
    h.finish.mockRejectedValueOnce(new Error('fiskaly unreachable'));

    const res = await closeTseSession(baseClose);

    expect(res.kind).toBe('queued_offline');
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    const entry = h.enqueue.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      intentionId: 'int-1',
      fiskalyTransactionId: 'ftx-1',
      tssId: 'tss-1',
      clientId: 'cli-1',
      serverTransactionId: 'srv-1', // threaded from the finalized transaction
      amountCents: 1990,
      paymentKind: 'CASH',
  receiptType: 'RECEIPT' as const,
      amountsPerVatRate: [{ vatRate: 'NORMAL' as const, amountCents: 1990 }],
      processType: 'Kassenbeleg-V1',
      receiptLocator: 'RCP-1',
      signature: null, // path (a): re-FINISH on replay
    });
    expect(typeof entry.createdAt).toBe('number');
  });

  it('on FINISH success returns signed and does NOT enqueue', async () => {
    h.finish.mockResolvedValueOnce(signature);
    const res = await closeTseSession(baseClose);
    expect(res.kind).toBe('signed');
    expect(h.enqueue).not.toHaveBeenCalled();
  });

  it('a store write failure never throws into the (finalized) sale', async () => {
    h.finish.mockRejectedValueOnce(new Error('fiskaly down'));
    h.enqueue.mockRejectedValueOnce(new Error('DB locked'));
    const res = await closeTseSession(baseClose);
    expect(res.kind).toBe('queued_offline'); // swallowed
  });
});

describe('enqueueSignatureRecordOnly — record-failed durable enqueue (path b)', () => {
  const recordOnlyInput = {
    config: { tssId: 'tss-1', clientId: 'cli-1' },
    intention,
    serverTransactionId: 'srv-9',
    amountCents: 4500,
    paymentKind: 'NON_CASH' as const,
    amountsPerVatRate: [{ vatRate: 'NULL' as const, amountCents: 4500 }],
    receiptLocator: 'RCP-9',
    signature,
  };

  it('enqueues the SIGNED entry (drain re-POSTs only) and returns true on success', async () => {
    const ok = await enqueueSignatureRecordOnly(recordOnlyInput);
    expect(ok).toBe(true);
    expect(h.enqueue).toHaveBeenCalledTimes(1);
    const entry = h.enqueue.mock.calls[0]![0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      intentionId: 'int-1',
      serverTransactionId: 'srv-9',
      paymentKind: 'NON_CASH',
      amountsPerVatRate: [{ vatRate: 'NULL' as const, amountCents: 4500 }],
      processType: 'Kassenbeleg-V1',
    });
    expect((entry.signature as TseSignature).signatureCounter).toBe(42); // the held signature
  });

  it('returns false (never throws) when the durable write itself fails — honest surface', async () => {
    h.enqueue.mockRejectedValueOnce(new Error('DB locked'));
    const ok = await enqueueSignatureRecordOnly(recordOnlyInput);
    expect(ok).toBe(false); // caller shows "bitte den gedruckten Beleg aufbewahren"
  });
});
