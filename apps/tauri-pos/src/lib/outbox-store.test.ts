/**
 * Phase 6.1 — the Compliance-Inbox half of the offline outbox store.
 *
 * These tests run the store's REAL SQL (and the REAL `0001_outbox.sql` migration
 * DDL) against a genuine in-memory SQLite via `node:sqlite` — not a fake that
 * re-implements the semantics. The safety-critical property proven here is that
 * `discardConflict` / `retryConflict` are scoped to `status='conflict'` and can
 * therefore NEVER mutate a pending, in-flight, succeeded or fiscal row.
 *
 * The only shim maps tauri-plugin-sql's `execute`/`select` + `$N` placeholders
 * onto node:sqlite's `run`/`all` + `?` placeholders. Every `$N` in these methods
 * appears once, in ascending order, so `$N → ?` positional substitution is exact.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

import type { OutboxRecord } from '@norns/api-client';

import { TauriSqlOutboxStore } from './outbox-store.js';

const MIGRATION_URL = new URL('../../src-tauri/migrations/0001_outbox.sql', import.meta.url);

/** A tauri-plugin-sql-shaped adapter backed by a real node:sqlite database. */
function makeFakeDb(): { execute: unknown; select: unknown } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(MIGRATION_URL, 'utf8')); // the REAL migration
  const toQ = (sql: string): string => sql.replace(/\$\d+/g, '?');
  return {
    async execute(sql: string, params: unknown[] = []) {
      // Return node:sqlite's REAL affected-row count so pruneExpired's return
      // value is meaningful (a hardcoded 1 would make the count untestable).
      const r = sqlite.prepare(toQ(sql)).run(...(params as never[])) as {
        changes?: number | bigint;
        lastInsertRowid?: number | bigint;
      };
      return { rowsAffected: Number(r.changes ?? 0), lastInsertId: Number(r.lastInsertRowid ?? 0) };
    },
    async select(sql: string, params: unknown[] = []) {
      return sqlite.prepare(toQ(sql)).all(...(params as never[]));
    },
  };
}

const h = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeDb> | null }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => h.current } }));

function rec(key: string): OutboxRecord {
  return recAt(key, 1_700_000_000_000, true);
}

/** Build a record with an explicit enqueuedAt + fiscal flag — the enqueue path
 *  derives retention_until from these, which is what the pruner filters on. */
function recAt(key: string, enqueuedAt: number, gobdRelevant: boolean): OutboxRecord {
  return {
    idempotencyKey: key,
    traceId: `trace-${key}`,
    method: 'POST',
    path: '/api/transactions/finalize',
    url: 'https://api.warehouse14.de/api/transactions/finalize',
    headers: {},
    body: { key },
    enqueuedAt,
    gobdRelevant,
    callerSuppliedKey: true,
    deviceId: 'device-1',
  };
}

describe('TauriSqlOutboxStore — Compliance Inbox', () => {
  let store: TauriSqlOutboxStore;

  beforeEach(() => {
    h.current = makeFakeDb();
    store = new TauriSqlOutboxStore();
  });
  afterEach(() => {
    h.current = null;
    vi.clearAllMocks();
  });

  it('lists only conflict rows, oldest-first (FIFO)', async () => {
    await store.enqueue(rec('a'));
    await store.enqueue(rec('b'));
    await store.enqueue(rec('c'));
    // c and a diverge; b stays pending. (order of marking is not enqueue order)
    await store.markConflict('c', { message: 'later', serverCode: 'CONFLICT' });
    await store.markConflict('a', { message: 'earlier', serverCode: 'ALREADY_FINALIZED' });

    const conflicts = await store.listConflicts();
    expect(conflicts.map((c) => c.idempotencyKey)).toEqual(['a', 'c']); // monotonic_seq order
    expect(conflicts[0]?.serverCode).toBe('ALREADY_FINALIZED');
    expect(conflicts[0]?.gobdRelevant).toBe(true);
    expect((await store.getStats()).conflict).toBe(2);
    expect((await store.getStats()).pending).toBe(1);
  });

  it('discardConflict closes the conflict without touching the pending rows', async () => {
    await store.enqueue(rec('a'));
    await store.enqueue(rec('b'));
    await store.markConflict('b', { message: 'divergence', serverCode: 'CONFLICT' });

    await store.discardConflict('b');

    expect(await store.listConflicts()).toEqual([]);
    expect((await store.getStats()).conflict).toBe(0);
    // a is untouched — still pending, still drainable.
    expect((await store.listPending()).map((r) => r.idempotencyKey)).toEqual(['a']);
    // b is terminally closed — NOT resurrected as pending.
    expect((await store.getStats()).pending).toBe(1);
  });

  it('retryConflict re-queues the conflict as pending at its original position', async () => {
    await store.enqueue(rec('a'));
    await store.markConflict('a', { message: 'transient?', serverCode: 'CONFLICT' });
    expect((await store.getStats()).pending).toBe(0);

    await store.retryConflict('a');

    expect(await store.listConflicts()).toEqual([]);
    expect((await store.listPending()).map((r) => r.idempotencyKey)).toEqual(['a']);
  });

  it('SAFETY: discard/retry are no-ops on a non-conflict row', async () => {
    await store.enqueue(rec('a')); // pending
    await store.enqueue(rec('done'));
    await store.markSucceeded('done', { ok: true });

    // Neither resolve action may mutate a pending or succeeded row.
    await store.discardConflict('a');
    await store.retryConflict('a');
    await store.discardConflict('done');
    await store.retryConflict('done');

    expect((await store.listPending()).map((r) => r.idempotencyKey)).toEqual(['a']); // a untouched
    expect((await store.getStats()).pending).toBe(1); // 'done' not resurrected
    expect((await store.getStats()).conflict).toBe(0);
  });
});

describe('TauriSqlOutboxStore — pruneExpired retention (Phase 6.4)', () => {
  let store: TauriSqlOutboxStore;
  const DAY = 86_400_000;
  const NOW = 1_800_000_000_000;

  beforeEach(() => {
    h.current = makeFakeDb();
    store = new TauriSqlOutboxStore();
  });
  afterEach(() => {
    h.current = null;
    vi.clearAllMocks();
  });

  it('removes ONLY expired, non-fiscal, succeeded rows — never fiscal or live rows', async () => {
    // (1) non-fiscal, succeeded, expired → the only row that may be pruned.
    await store.enqueue(recAt('stale-ok', NOW - 31 * DAY, false));
    await store.markSucceeded('stale-ok', { ok: true });
    // (2) non-fiscal, succeeded, still within its 30-day window → keep.
    await store.enqueue(recAt('fresh-ok', NOW, false));
    await store.markSucceeded('fresh-ok', { ok: true });
    // (3) FISCAL (GoBD), succeeded, retention forced past by an 11-year-old ts → keep.
    await store.enqueue(recAt('fiscal', NOW - 11 * 365 * DAY, true));
    await store.markSucceeded('fiscal', { ok: true });
    // (4) non-fiscal, PENDING, "expired" ts → keep (not succeeded).
    await store.enqueue(recAt('pending', NOW - 31 * DAY, false));
    // (5) non-fiscal, CONFLICT, "expired" ts → keep (not succeeded).
    await store.enqueue(recAt('conflict', NOW - 31 * DAY, false));
    await store.markConflict('conflict', { serverCode: 'CONFLICT' });

    const removed = await store.pruneExpired(NOW);

    expect(removed).toBe(1); // exactly the one prunable row
    // Live rows survive:
    expect((await store.getStats()).pending).toBe(1); // 'pending'
    expect((await store.getStats()).conflict).toBe(1); // 'conflict'
    // The fiscal succeeded row is NOT resurrected as pending/conflict and NOT gone
    // improperly — assert directly that it still exists.
    const stillThere = await (h.current as { select: (s: string) => Promise<unknown[]> }).select(
      "SELECT idempotency_key FROM outbox_mutations WHERE idempotency_key IN ('fiscal','fresh-ok') ORDER BY idempotency_key",
    );
    expect(stillThere).toEqual([{ idempotency_key: 'fiscal' }, { idempotency_key: 'fresh-ok' }]);
    // The stale non-fiscal row is gone.
    const stale = await (h.current as { select: (s: string) => Promise<unknown[]> }).select(
      "SELECT idempotency_key FROM outbox_mutations WHERE idempotency_key = 'stale-ok'",
    );
    expect(stale).toEqual([]);
  });

  it('⛔ zweimal DERSELBE Schlüssel ergibt EINE Zeile, nicht zwei', async () => {
    /*
     * ── WARUM DIESER SATZ SEIT DEM 11.08.2026 TRÄGT ───────────────────────
     *
     * `recordTseSignature` setzt seit heute einen STABILEN Idempotenz-
     * schlüssel je Vorgang (`tse-sig:<Vorgang>`), damit 39 Fehlversuche in
     * einem achtstündigen Ausfall EINE Zeile ergeben statt 39. Diese Zusage
     * hängt vollständig am Wort `OR IGNORE` in `enqueue` — und genau das war
     * bis heute UNBEWACHT: in keinem Test des Hauses wurde je zweimal
     * derselbe Schlüssel eingereiht.
     *
     * Gemessen: nimmt man das `OR IGNORE` heraus, blieb der ganze
     * tauri-pos-Lauf Zeichen für Zeichen gleich grün. Der Schwesterwächter
     * in `packages/api-client` beweist, dass EIN Schlüssel entsteht; dieser
     * hier beweist, dass daraus EINE Zeile wird. Erst beide zusammen decken
     * die Zusage.
     *
     * Und er misst das ECHTE SQL gegen die ECHTE Wanderung `0001_outbox.sql`.
     */
    await store.enqueue(rec('tse-sig:11111111-2222-3333-4444-555555555555'));
    await store.enqueue(rec('tse-sig:11111111-2222-3333-4444-555555555555'));

    const offen = await store.listPending();
    expect(
      offen.map((r) => r.idempotencyKey),
      'derselbe Schlüssel legte eine ZWEITE Zeile an — der Ausgangskorb wächst wieder',
    ).toEqual(['tse-sig:11111111-2222-3333-4444-555555555555']);
  });

  it('is a no-op when nothing is expired', async () => {
    await store.enqueue(recAt('fresh', NOW, false));
    await store.markSucceeded('fresh', { ok: true });
    expect(await store.pruneExpired(NOW)).toBe(0);
  });
});
