/**
 * Phase 1.4 Step 8 — startup reconcile funnels pos_intents into the outbox.
 *
 * An unresolved crash-window intent produces exactly ONE insert-or-ignore on the
 * SAME idempotency key (so drainOutbox carries it and the server dedups → no
 * double-finalize); a second run is a no-op; a malformed sealed request is failed
 * terminally, not looped; a transient enqueue error leaves the intent for retry.
 */
import { describe, expect, it, vi } from 'vitest';

import type { OutboxRecord } from '@norns/api-client';

import { reconcilePosIntents } from './offline-replay.js';
import {
  type PosIntentsStore,
  type UnresolvedPosIntent,
  sealFiscalRequest,
} from './pos-intents-store.js';

function sealedJson(key: string): string {
  return JSON.stringify(
    sealFiscalRequest({
      baseUrl: 'https://api.warehouse14.de',
      path: '/api/transactions/finalize',
      body: { totalEur: '19.90', idempotencyKey: key },
      idempotencyKey: key,
      deviceId: 'dev-1',
    }),
  );
}

function fakeIntents(initial: UnresolvedPosIntent[]) {
  const rows = [...initial];
  const store: PosIntentsStore & {
    resolved: string[];
    failed: string[];
  } = {
    resolved: [],
    failed: [],
    create: vi.fn(async () => {}),
    listUnresolved: vi.fn(async () => rows.filter((r) => !store.resolved.includes(r.key) && !store.failed.includes(r.key))),
    markResolved: vi.fn(async (key: string) => {
      store.resolved.push(key);
    }),
    markHandedOff: vi.fn(async () => {}),
    markFailed: vi.fn(async (key: string) => {
      store.failed.push(key);
    }),
  };
  return store;
}

describe('reconcilePosIntents', () => {
  it('turns each unresolved intent into ONE outbox row on the same key, then resolves it', async () => {
    const intents = fakeIntents([
      { key: 'idem-a', intentType: 'sale', sealedRequestJson: sealedJson('idem-a'), createdAt: 1000 },
      { key: 'idem-b', intentType: 'ankauf', sealedRequestJson: sealedJson('idem-b'), createdAt: 2000 },
    ]);
    const enqueued: OutboxRecord[] = [];
    const outbox = { enqueue: vi.fn(async (r: OutboxRecord) => void enqueued.push(r)) };

    await reconcilePosIntents(intents, outbox);

    expect(outbox.enqueue).toHaveBeenCalledTimes(2);
    expect(enqueued.map((r) => r.idempotencyKey)).toEqual(['idem-a', 'idem-b']); // SAME keys
    expect(enqueued[0]).toMatchObject({ method: 'POST', url: expect.stringContaining('/finalize'), deviceId: 'dev-1', callerSuppliedKey: true });
    expect(intents.resolved).toEqual(['idem-a', 'idem-b']);
  });

  it('is a no-op on a second run (resolved intents leave the unresolved set)', async () => {
    const intents = fakeIntents([
      { key: 'idem-a', intentType: 'sale', sealedRequestJson: sealedJson('idem-a'), createdAt: 1000 },
    ]);
    const outbox = { enqueue: vi.fn(async () => {}) };

    await reconcilePosIntents(intents, outbox);
    await reconcilePosIntents(intents, outbox); // second run

    expect(outbox.enqueue).toHaveBeenCalledTimes(1); // not re-enqueued
  });

  it('fails a malformed sealed request terminally without blocking the others', async () => {
    const intents = fakeIntents([
      { key: 'bad', intentType: 'sale', sealedRequestJson: '{not json', createdAt: 1000 },
      { key: 'good', intentType: 'sale', sealedRequestJson: sealedJson('good'), createdAt: 2000 },
    ]);
    const outbox = { enqueue: vi.fn(async () => {}) };

    await reconcilePosIntents(intents, outbox);

    expect(intents.failed).toEqual(['bad']);
    expect(intents.resolved).toEqual(['good']); // the good one still reconciled
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  it('leaves an intent unresolved when the outbox enqueue fails transiently', async () => {
    const intents = fakeIntents([
      { key: 'idem-a', intentType: 'sale', sealedRequestJson: sealedJson('idem-a'), createdAt: 1000 },
    ]);
    const outbox = { enqueue: vi.fn(async () => { throw new Error('DB locked'); }) };

    await reconcilePosIntents(intents, outbox);

    expect(intents.resolved).toEqual([]); // not resolved → next startup retries
    expect(intents.failed).toEqual([]); // not terminal — it was transient
  });

  it('degrades to a no-op when listUnresolved rejects (browser / no DB)', async () => {
    const intents = fakeIntents([]);
    intents.listUnresolved = vi.fn(async () => { throw new Error('Db.load rejected'); });
    const outbox = { enqueue: vi.fn(async () => {}) };
    await expect(reconcilePosIntents(intents, outbox)).resolves.toBeUndefined();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
