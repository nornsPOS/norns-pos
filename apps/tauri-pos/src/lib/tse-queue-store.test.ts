/**
 * Phase 1.3 — the durable TSE signature replay queue store.
 *
 * These tests run the store's REAL SQL (and the REAL `0003_tse_queue.sql`
 * migration DDL, STRICT and all) against a genuine in-memory SQLite via
 * `node:sqlite` — not a hand-rolled fake that re-implements UPSERT semantics.
 * That means the UPSERT-promote, the FIFO order, the stale-in_flight
 * re-selection, and the STRICT integer-cents guarantee are validated against
 * the same engine that runs on the till, so a passing test is a real proof.
 *
 * The only shim is an adapter mapping tauri-plugin-sql's `execute`/`select` +
 * `$N` placeholders onto node:sqlite's `run`/`all` + `?` placeholders. Every
 * `$N` in the store appears exactly once and in ascending order (the ON CONFLICT
 * clause references `excluded.*`, never re-bound params), so `$N → ?` positional
 * substitution is faithful.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `node:sqlite` is a recent built-in that Vite's resolver doesn't yet recognise,
// so a static `import` fails to externalise. Load it at runtime instead.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

import type { TseSignature } from './hardware-client.js';
import {
  MAX_ATTEMPTS,
  STALE_MS,
  TauriSqlTseQueueStore,
  type EnrichedTseQueueEntry,
} from './tse-queue-store.js';

/**
 * ⚠️ HIER STAND EIN EINZELNER DATEINAME.
 *
 * Am 08.08.2026 kam `0004` dazu, und der Nachbau kannte sie nicht: die Tabelle
 * im Test hatte die neue Spalte nicht, das echte Programm schon. Genau die
 * Klasse „Wächter mit Namensliste wird blind" — ein Test, der EINE Wanderung
 * beim Namen nennt, misst ab der zweiten eine andere Datenbank als die Kasse.
 *
 * Jetzt werden ALLE Wanderungen gelesen, die den Tisch betreffen, in ihrer
 * Reihenfolge. Eine neue Wanderung wird ohne Zutun mitgeprüft.
 */
const MIGRATIONS_DIR = new URL('../../src-tauri/migrations/', import.meta.url);

function alleWanderungen(): string[] {
  const namen = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const texte = namen.map((n) => readFileSync(new URL(n, MIGRATIONS_DIR), 'utf8'));
  // Nur die, die diesen Tisch anlegen oder ändern. Die anderen brauchen
  // Tabellen, die dieser Test bewusst nicht baut.
  const treffer = texte.filter((s) => s.includes('tse_signature_queue'));
  if (treffer.length === 0) {
    throw new Error('keine Wanderung fuer tse_signature_queue gefunden');
  }
  return treffer;
}

/** A tauri-plugin-sql-shaped adapter backed by a real node:sqlite database. */
function makeFakeDb(): { execute: unknown; select: unknown } {
  const sqlite = new DatabaseSync(':memory:');
  for (const sql of alleWanderungen()) sqlite.exec(sql); // die ECHTEN Wanderungen
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

// The current fake db — refreshed per test so state never leaks across cases.
const h = vi.hoisted(() => ({ current: null as ReturnType<typeof makeFakeDb> | null }));
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: async () => h.current },
}));

const signature = (counter: number): TseSignature => ({
  signatureValue: `sig-${counter}`,
  signatureCounter: counter,
  signatureAlgorithm: 'ecdsa-plain-SHA256',
    signaturePublicKey: 'MUSTER-PUBLIC-KEY',
    tssSerialNumber: 'MUSTER-TSE-SERIAL',
  transactionNumber: counter,
  startedAt: '2026-07-06T10:00:00.000Z',
  finishedAt: '2026-07-06T10:00:01.000Z',
  qrCodePayload: `qr-${counter}`,
});

function baseEntry(over: Partial<EnrichedTseQueueEntry> = {}): EnrichedTseQueueEntry {
  return {
    intentionId: 'int-1',
    fiskalyTransactionId: 'ftx-1',
    tssId: 'tss-1',
    clientId: 'cli-1',
    serverTransactionId: 'srv-1',
    amountCents: 1990,
    paymentKind: 'CASH',
  receiptType: 'RECEIPT' as const,
    amountsPerVatRate: [{ vatRate: 'NORMAL', amountCents: 1990 }],
    processType: 'Kassenbeleg-V1',
    receiptLocator: 'RCP-1',
    signature: null,
    createdAt: 1_000_000,
    ...over,
  };
}

describe('TauriSqlTseQueueStore', () => {
  let store: TauriSqlTseQueueStore;

  beforeEach(() => {
    h.current = makeFakeDb();
    store = new TauriSqlTseQueueStore();
  });
  afterEach(() => vi.clearAllMocks());

  it('enqueue → listDrainable returns the entry in FIFO (monotonic_seq) order', async () => {
    await store.enqueue(baseEntry({ intentionId: 'int-a' }));
    await store.enqueue(baseEntry({ intentionId: 'int-b', createdAt: 1_000_001 }));
    await store.enqueue(baseEntry({ intentionId: 'int-c', createdAt: 1_000_002 }));

    const drainable = await store.listDrainable(2_000_000);
    expect(drainable.map((d) => d.intentionId)).toEqual(['int-a', 'int-b', 'int-c']);
    // The parsed shape round-trips the integer-cents money + vat buckets.
    expect(drainable[0]?.amountCents).toBe(1990);
    expect(drainable[0]?.amountsPerVatRate).toEqual([{ vatRate: 'NORMAL', amountCents: 1990 }]);
    expect(drainable[0]?.signature).toBeNull();
  });

  it('UPSERT-promote: a finish-failed (NULL) row is promoted to signed, never dropped', async () => {
    await store.enqueue(baseEntry({ signature: null })); // path (a): finish-failed
    await store.enqueue(baseEntry({ signature: signature(7) })); // path (b): record-failed, same intention

    const drainable = await store.listDrainable(2_000_000);
    expect(drainable).toHaveLength(1); // still ONE fiscal row for the intention
    expect(drainable[0]?.signature?.signatureCounter).toBe(7); // promoted to the signed one
  });

  it('UPSERT-promote: a real signature is NEVER overwritten by a later NULL', async () => {
    await store.enqueue(baseEntry({ signature: signature(7) }));
    await store.enqueue(baseEntry({ signature: null })); // must not clobber

    const drainable = await store.listDrainable(2_000_000);
    expect(drainable).toHaveLength(1);
    expect(drainable[0]?.signature?.signatureCounter).toBe(7);
  });

  it('UPSERT: a pure duplicate (both NULL) collapses to one row', async () => {
    await store.enqueue(baseEntry({ signature: null }));
    await store.enqueue(baseEntry({ signature: null }));
    expect(await store.listDrainable(2_000_000)).toHaveLength(1);
  });

  it('markInFlight removes a row from the drain window; markSucceeded retains it out of stats', async () => {
    await store.enqueue(baseEntry());
    const [entry] = await store.listDrainable(2_000_000);
    expect(entry).toBeDefined();

    await store.markInFlight(entry!.id, 2_000_000);
    // Fresh in_flight (last_attempt_at just now) is NOT re-selected.
    expect(await store.listDrainable(2_000_000)).toHaveLength(0);
    expect(await store.getStats()).toEqual({ pending: 0, inFlight: 1, failedTerminal: 0 });

    await store.markSucceeded(entry!.id, 2_000_100);
    expect(await store.listDrainable(3_000_000)).toHaveLength(0);
    // succeeded is excluded from stats (D6) → badge clears.
    expect(await store.getStats()).toEqual({ pending: 0, inFlight: 0, failedTerminal: 0 });
  });

  it('re-selects a stale in_flight row exactly past the STALE_MS boundary', async () => {
    await store.enqueue(baseEntry());
    const [entry] = await store.listDrainable(10_000_000);
    await store.markInFlight(entry!.id, 10_000_000);

    // Exactly at the boundary: last_attempt_at === now - STALE_MS → NOT yet stale
    // (selection is strict `<`), so still hidden.
    expect(await store.listDrainable(10_000_000 + STALE_MS)).toHaveLength(0);
    // One ms past → re-selected.
    const restaled = await store.listDrainable(10_000_000 + STALE_MS + 1);
    expect(restaled).toHaveLength(1);
    expect(restaled[0]?.id).toBe(entry!.id);
  });

  it('incrementAttempt re-arms to pending and bumps the count; markFailedTerminal ends draining', async () => {
    await store.enqueue(baseEntry());
    let [entry] = await store.listDrainable(2_000_000);

    await store.markInFlight(entry!.id, 2_000_000);
    await store.incrementAttempt(entry!.id, new Error('fiskaly 503'), 2_000_500);

    [entry] = await store.listDrainable(3_000_000);
    expect(entry?.attemptCount).toBe(1); // bumped, and re-armed to pending (re-selected)

    await store.markFailedTerminal(entry!.id, new Error('permanent'), 3_000_000);
    expect(await store.listDrainable(9_000_000)).toHaveLength(0); // terminal → not drainable
    expect(await store.getStats()).toEqual({ pending: 0, inFlight: 0, failedTerminal: 1 });
  });

  it('persistSignature signs an in_flight row without re-arming it to pending (B1)', async () => {
    await store.enqueue(baseEntry({ signature: null }));
    const [entry] = await store.listDrainable(2_000_000);
    await store.markInFlight(entry!.id, 2_000_000);
    await store.persistSignature(entry!.id, signature(9));

    // Still in_flight (not re-armed), so hidden until the row goes stale…
    expect(await store.listDrainable(2_000_000)).toHaveLength(0);
    // …and once re-selected it is now the record-only (signed) path, never a re-FINISH.
    const restaled = await store.listDrainable(2_000_000 + STALE_MS + 1);
    expect(restaled).toHaveLength(1);
    expect(restaled[0]?.signature?.signatureCounter).toBe(9);
  });

  it('the MAX_ATTEMPTS cap is a real number the drain can act on', () => {
    // The store exposes the cap; the drain (Step 5) enforces it. Guard the value.
    expect(MAX_ATTEMPTS).toBeGreaterThanOrEqual(3);
    expect(Number.isInteger(MAX_ATTEMPTS)).toBe(true);
  });

  it('STRICT rejects a non-integer amount_cents (money-integrity guarantee)', async () => {
    // A lossy float must be REJECTED at write time, not silently coerced — this
    // is why the table is STRICT. Proves the DDL, not just the app code.
    await expect(store.enqueue(baseEntry({ amountCents: 19.9 as number }))).rejects.toThrow();
  });
});
