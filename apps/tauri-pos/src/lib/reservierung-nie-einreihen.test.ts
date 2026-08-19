/**
 * Ein Halt darf NIEMALS im Ausgangskorb landen.
 *
 * ── WAS AM 26.07.2026 AN DER KASSE AM TRESEN GEMESSEN WURDE ─────────────────
 * Die Kassiererin tippt ohne Netz ein Stück an. `Verkauf.tsx` ruft
 * `productsApi.reserve` VOR `addLine`, das Offline-Mittelstück reiht die
 * Anfrage in den dauerhaften Ausgangskorb ein und wirft
 * `ApiOfflineQueuedError`. Der Verkauf findet nie statt — die Sitzungskennung
 * war eine örtliche Konstante in einem Bildschirm, den es Sekunden später nicht
 * mehr gab.
 *
 * Stunden später kommt das Netz zurück. `drainOutbox` spielt die Reservierung
 * WIRKLICH ab. Das Stück steht auf RESERVIERT, und weil niemand mehr die
 * Sitzungskennung hat, kann es niemand freigeben. Der Aufräumer
 * `pos-reservation-sweeper` greift erst nach 720 Minuten. Der Kunde, der ohne
 * Netz kaufen wollte, kann das Stück danach einen halben Tag lang NICHT kaufen
 * — auch nicht mit Netz. Drei angetippte Artikel sind drei blockierte Stücke.
 *
 * ── WARUM DIESER TEST GEGEN DIE ECHTE ABLAGE FÄHRT ──────────────────────────
 * Eine Attrappe des Ausgangskorbs würde genau die Frage nicht beantworten, um
 * die es geht: liegt hinterher eine ZEILE da, die der Abspieler findet? Deshalb
 * läuft hier der echte `TauriSqlOutboxStore` gegen ein echtes SQLite
 * (`node:sqlite`) mit der ECHTEN Wanderung `0001_outbox.sql` — dieselbe Ablage,
 * die auf der Kasse liegt, nur im Arbeitsspeicher. Gefragt wird sie mit
 * `listPending()`, also mit derselben Abfrage, die der Abspieler benutzt.
 *
 * Auch die Kette ist echt: `createApiClient` mit dem echten
 * `offlineQueueMiddleware` und dem echten `productsApi.reserve`. Erfunden ist
 * nur die Antwort des Netzes — und die soll ja gerade ausbleiben.
 *
 * ⚠️ `apps/tauri-pos` liest `@norns/api-client` als GEBAUTES Paket. Wer
 * diese Datei rot/grün fahren will, muss den Klienten VORHER neu bauen
 * (`pnpm --filter @norns/api-client build`), sonst prüft er einen alten
 * Stand und der Lauf sagt nichts.
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

import {
  type ApiClient,
  ApiOfflineQueuedError,
  createApiClient,
  isGobdRelevantPath,
  offlineQueueMiddleware,
  productsApi,
  transactionsApi,
} from '@norns/api-client';

import { TauriSqlOutboxStore } from './outbox-store.js';

const MIGRATION_URL = new URL('../../src-tauri/migrations/0001_outbox.sql', import.meta.url);

/** Ein tauri-plugin-sql-förmiger Adapter auf einem ECHTEN node:sqlite. */
function echteAblage(): { execute: unknown; select: unknown } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(MIGRATION_URL, 'utf8')); // die ECHTE Wanderung
  const toQ = (sql: string): string => sql.replace(/\$\d+/g, '?');
  return {
    async execute(sql: string, params: unknown[] = []) {
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

const h = vi.hoisted(() => ({ current: null as ReturnType<typeof echteAblage> | null }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => h.current } }));

describe('Reservierung ohne Netz — nichts darf in den Ausgangskorb', () => {
  let store: TauriSqlOutboxStore;
  let api: ApiClient;

  beforeEach(() => {
    h.current = echteAblage();
    store = new TauriSqlOutboxStore();
    api = createApiClient({
      baseUrl: 'http://localhost:3001',
      middlewares: [
        offlineQueueMiddleware({
          store,
          // Das Netz ist weg. Genau der gemessene Fall.
          isOnline: () => false,
          deviceId: 'tresen-01',
          classifyGobdRelevant: (path) => isGobdRelevantPath(path),
        }),
      ],
    });
  });
  afterEach(() => {
    h.current = null;
    vi.clearAllMocks();
  });

  it('reserve ohne Netz legt KEINE Zeile in den echten Ausgangskorb', async () => {
    await expect(
      productsApi.reserve(api, {
        productId: '11111111-1111-4111-8111-111111111111',
        channel: 'POS',
        sessionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow();

    const offen = await store.listPending();
    expect(offen.map((r) => r.path)).toEqual([]);
  });

  it('reserve ohne Netz meldet NICHT „sicher eingereiht"', async () => {
    let gefangen: unknown;
    try {
      await productsApi.reserve(api, {
        productId: '11111111-1111-4111-8111-111111111111',
        channel: 'POS',
        sessionId: '22222222-2222-4222-8222-222222222222',
      });
    } catch (err) {
      gefangen = err;
    }
    // Eine Zusage, die niemand halten kann, ist schlimmer als ein Fehler.
    expect(gefangen).not.toBeInstanceOf(ApiOfflineQueuedError);
    expect(gefangen).toBeInstanceOf(Error);
  });

  it('release ohne Netz legt ebenfalls KEINE Zeile ab', async () => {
    await expect(
      productsApi.release(api, {
        productId: '11111111-1111-4111-8111-111111111111',
        sessionId: '22222222-2222-4222-8222-222222222222',
        reason: 'pos_cart_cleared',
      }),
    ).rejects.toThrow();

    expect(await store.listPending()).toHaveLength(0);
  });

  /**
   * Die Gegenprobe, und sie ist tragend: ohne sie wäre ein Test grün, der
   * überhaupt nichts sieht — etwa weil die Ablage gar nicht schreibt oder die
   * Kette nie durchlaufen wird. Ein Beleg MUSS eingereiht werden (GoBD §146),
   * und zwar mit zehnjähriger Aufbewahrung.
   */
  it('Gegenprobe: der Beleg wird sehr wohl eingereiht (sonst sieht dieser Test nichts)', async () => {
    await expect(
      transactionsApi.finalize(api, {
        direction: 'VERKAUF',
        customerId: null,
        subtotalEur: '100.00',
        vatEur: '19.00',
        totalEur: '119.00',
        taxTreatmentCode: 'STANDARD_19',
        items: [],
        payments: [],
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toBeInstanceOf(ApiOfflineQueuedError);

    const offen = await store.listPending();
    expect(offen).toHaveLength(1);
    expect(offen[0]?.path).toBe('/api/transactions/finalize');
    expect(offen[0]?.gobdRelevant).toBe(true);
  });
});
