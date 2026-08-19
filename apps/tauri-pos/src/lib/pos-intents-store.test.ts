/**
 * Phase 1.4 — the caller-side pos_intents crash-recovery store.
 *
 * Runs the store's real SQL against the real `0001_outbox.sql` DDL via
 * node:sqlite (not a fake): create is idempotent on the PK key; listUnresolved
 * excludes resolved / handed-off / failed rows; the sealed request round-trips
 * verbatim so Step 8's reconcile can rebuild an outbox row from it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TauriSqlPosIntentsStore,
  sealFiscalRequest,
  sealedToOutboxRecord,
} from './pos-intents-store.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

const MIGRATION_URL = new URL('../../src-tauri/migrations/0001_outbox.sql', import.meta.url);

function makeFakeDb(): { execute: unknown; select: unknown } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(MIGRATION_URL, 'utf8'));
  const toQ = (sql: string): string => sql.replace(/\$\d+/g, '?');
  return {
    async execute(sql: string, params: unknown[] = []) {
      sqlite.prepare(toQ(sql)).run(...(params as never[]));
      return { rowsAffected: 1, lastInsertId: 0 };
    },
    async select(sql: string, params: unknown[] = []) {
      return sqlite.prepare(toQ(sql)).all(...(params as never[]));
    },
  };
}

const h = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeDb> | null }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => h.current } }));

const SEALED = JSON.stringify({
  method: 'POST',
  path: '/api/transactions/finalize',
  url: 'https://api.warehouse14.de/api/transactions/finalize',
  headers: { 'Idempotency-Key': 'idem-1' },
  body: { totalEur: '19.90', idempotencyKey: 'idem-1' },
  deviceId: 'dev-1',
  idempotencyKey: 'idem-1',
  gobdRelevant: true,
});

function newIntent(key: string, over: Record<string, unknown> = {}) {
  return {
    key,
    intentType: 'sale' as const,
    sealedRequestJson: SEALED,
    createdAt: 1_000_000,
    ...over,
  };
}

describe('TauriSqlPosIntentsStore', () => {
  let store: TauriSqlPosIntentsStore;
  beforeEach(() => {
    h.current = makeFakeDb();
    store = new TauriSqlPosIntentsStore();
  });
  afterEach(() => vi.clearAllMocks());

  it('create → listUnresolved returns the intent with the sealed request verbatim', async () => {
    await store.create(newIntent('idem-1'));
    const un = await store.listUnresolved();
    expect(un).toHaveLength(1);
    expect(un[0]).toMatchObject({ key: 'idem-1', intentType: 'sale', sealedRequestJson: SEALED });
    // The sealed request round-trips every NOT-NULL outbox field the reconcile needs.
    const sealed = JSON.parse(un[0]!.sealedRequestJson);
    expect(sealed).toMatchObject({ method: 'POST', url: expect.any(String), headers: expect.any(Object), deviceId: 'dev-1' });
  });

  it('re-seals the body on a retry while the intent is unresolved (latest body wins)', async () => {
    await store.create(newIntent('idem-1', { sealedRequestJson: '{"v":1}' }));
    // Operator edits the cart and retries under the SAME frozen key → the persisted
    // sealed request must be the retry's body, never the stale first one.
    await store.create(newIntent('idem-1', { sealedRequestJson: '{"v":2}', createdAt: 2_000_000 }));
    const un = await store.listUnresolved();
    expect(un).toHaveLength(1);
    expect(un[0]!.sealedRequestJson).toBe('{"v":2}');
    expect(un[0]!.createdAt).toBe(2_000_000);
  });

  it('never resurrects or overwrites a resolved intent', async () => {
    await store.create(newIntent('idem-1', { sealedRequestJson: '{"v":1}' }));
    await store.markResolved('idem-1', {});
    // A late duplicate create with a new body must NOT re-open or mutate it.
    await store.create(newIntent('idem-1', { sealedRequestJson: '{"v":2}', createdAt: 2_000_000 }));
    expect(await store.listUnresolved()).toHaveLength(0);
  });

  it('markResolved removes the intent from the unresolved set', async () => {
    await store.create(newIntent('idem-1'));
    await store.markResolved('idem-1', { transaction: { id: 'srv-1' } });
    expect(await store.listUnresolved()).toHaveLength(0);
  });

  it('markHandedOff removes it too (the outbox now owns the key — not a failure)', async () => {
    await store.create(newIntent('idem-1'));
    await store.markHandedOff('idem-1');
    expect(await store.listUnresolved()).toHaveLength(0);
  });

  it('markFailed removes it from the unresolved set', async () => {
    await store.create(newIntent('idem-1'));
    await store.markFailed('idem-1', new Error('permanent'));
    expect(await store.listUnresolved()).toHaveLength(0);
  });

  it('listUnresolved is FIFO by created_at and keeps only truly-open intents', async () => {
    await store.create(newIntent('a', { createdAt: 1_000_001 }));
    await store.create(newIntent('b', { createdAt: 1_000_000 }));
    await store.create(newIntent('c', { createdAt: 1_000_002, intentType: 'ankauf' }));
    await store.markResolved('a', {});
    const un = await store.listUnresolved();
    expect(un.map((i) => i.key)).toEqual(['b', 'c']); // a resolved, b before c
  });

  it('round-trips a real intent through seal → store → reconcile into a valid OutboxRecord', async () => {
    const sealed = sealFiscalRequest({
      baseUrl: 'https://api.warehouse14.de/',
      path: '/api/transactions/finalize',
      body: { totalEur: '19.90', idempotencyKey: 'idem-x' },
      idempotencyKey: 'idem-x',
      deviceId: 'dev-9',
    });
    await store.create({ key: 'idem-x', intentType: 'sale', sealedRequestJson: JSON.stringify(sealed), createdAt: 5_000 });

    const [intent] = await store.listUnresolved();
    const record = sealedToOutboxRecord(JSON.parse(intent!.sealedRequestJson), intent!.createdAt);
    // Every NOT-NULL outbox column is populated from the sealed request.
    expect(record).toEqual({
      idempotencyKey: 'idem-x',
      traceId: null,
      method: 'POST',
      path: '/api/transactions/finalize',
      url: 'https://api.warehouse14.de/api/transactions/finalize', // trailing slash collapsed
      headers: { 'Idempotency-Key': 'idem-x' },
      body: { totalEur: '19.90', idempotencyKey: 'idem-x' },
      enqueuedAt: 5_000,
      gobdRelevant: true,
      callerSuppliedKey: true,
      deviceId: 'dev-9',
    });
  });
});

describe('sealFiscalRequest', () => {
  it('collapses a trailing slash on baseUrl and seals only the Idempotency-Key header', () => {
    const s = sealFiscalRequest({
      baseUrl: 'https://x.de//',
      path: '/api/transactions/ankauf',
      body: { a: 1 },
      idempotencyKey: 'k',
      deviceId: 'd',
    });
    expect(s.url).toBe('https://x.de/api/transactions/ankauf');
    expect(s.headers).toEqual({ 'Idempotency-Key': 'k' });
    expect(s.gobdRelevant).toBe(true);
    expect(s.method).toBe('POST');
  });
});
