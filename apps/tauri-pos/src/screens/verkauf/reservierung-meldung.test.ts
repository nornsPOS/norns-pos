/**
 * Der Weg der Kassiererin: ohne Netz einen Artikel antippen.
 *
 * ── WARUM ES DIESEN TEST BISHER NICHT GAB ───────────────────────────────────
 * Unter `screens/verkauf` stand am 26.07.2026 GENAU EINE Testdatei
 * (`split-payment.test.ts`) und NULL Tests für Reservierung plus Netzausfall.
 * Genau deshalb konnte der Halt entstehen, der ein Stück zwölf Stunden
 * einfriert — und deshalb konnte die Kassiererin ein halbes Jahr lang „Verbindung
 * gestört / Reservierung konnte nicht gesetzt werden." lesen, während die
 * Reservierung in Wahrheit im dauerhaften Ausgangskorb lag und später WIRKLICH
 * abgespielt wurde.
 *
 * ── DER FEHLER, DEN DIESER TEST FESTNAGELT ──────────────────────────────────
 * `ApiOfflineQueuedError` erbt von `Error` und NICHT von `ApiError` (siehe
 * `src/lib/eingereiht.ts`, wo dieselbe Verwechslung in fünf Masken beschrieben
 * ist). Die drei `instanceof ApiError`-Zweige in `Verkauf.tsx` greifen darum
 * nicht, und alles fiel in den `else`-Zweig mit einem Satz, der falsch war.
 *
 * Ein Text ist hier kein Schmuck: er ist die einzige Information, nach der die
 * Kassiererin handelt. „konnte nicht gesetzt werden" heisst für sie „das Stück
 * ist frei" — und wenn es in Wahrheit gleich gesperrt wird, verkauft sie einem
 * Kunden etwas, das die Kasse ihr Minuten später verweigert.
 *
 * ── WAS HIER ECHT IST ───────────────────────────────────────────────────────
 * Die Kette ist echt: `createApiClient` mit dem echten `offlineQueueMiddleware`,
 * der echte `productsApi.reserve`, der echte Ausgangskorb `TauriSqlOutboxStore`
 * auf echtem SQLite mit der echten Wanderung. Der Fehler, den die Fläche deutet,
 * ist also DER Fehler, den die Kasse im Laden wirklich fängt — nicht ein von
 * Hand gebauter. Und `reservierungsFehlerDeuten` ist dieselbe Funktion, die
 * `Verkauf.tsx` aufruft; der letzte Test hier wacht darüber, dass das so bleibt.
 *
 * ⚠️ `apps/tauri-pos` liest `@norns/api-client` als GEBAUTES Paket:
 * vor jedem Rot/Grün `pnpm --filter @norns/api-client build`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  };
};

import {
  type ApiClient,
  ApiError,
  ApiOfflineQueuedError,
  createApiClient,
  isGobdRelevantPath,
  offlineQueueMiddleware,
  productsApi,
} from '@norns/api-client';

import { TauriSqlOutboxStore } from '../../lib/outbox-store.js';
import { useCartStore } from '../../state/cart-store.js';

import { reservierungsFehlerDeuten } from './reservierung-meldung.js';

const MIGRATION_URL = new URL('../../../src-tauri/migrations/0001_outbox.sql', import.meta.url);

function echteAblage(): { execute: unknown; select: unknown } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(MIGRATION_URL, 'utf8'));
  const toQ = (sql: string): string => sql.replace(/\$\d+/g, '?');
  return {
    async execute(sql: string, params: unknown[] = []) {
      const r = sqlite.prepare(toQ(sql)).run(...(params as never[])) as { changes?: number | bigint };
      return { rowsAffected: Number(r.changes ?? 0), lastInsertId: 0 };
    },
    async select(sql: string, params: unknown[] = []) {
      return sqlite.prepare(toQ(sql)).all(...(params as never[]));
    },
  };
}

const h = vi.hoisted(() => ({ current: null as ReturnType<typeof echteAblage> | null }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => h.current } }));

const SKU = 'W14-0815';
const PRODUKT = '11111111-1111-4111-8111-111111111111';

/**
 * Die Karte hält sich in `localStorage`; im Knoten-Lauf gibt es keinen. Der
 * Ersatz steht in `vi.hoisted`, weil der Kartenspeicher beim IMPORT anlegt und
 * liest — ein `stubGlobal` im `beforeEach` käme zu spät.
 */
const kartenAblage = vi.hoisted(() => {
  const ablage = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => ablage.get(k) ?? null,
    setItem: (k: string, v: string) => ablage.set(k, v),
    removeItem: (k: string) => ablage.delete(k),
    clear: () => ablage.clear(),
    key: () => null,
    length: 0,
  };
  return ablage;
});

describe('Artikel antippen, wenn das Netz weg ist', () => {
  let store: TauriSqlOutboxStore;
  let api: ApiClient;

  beforeEach(() => {
    kartenAblage.clear();
    h.current = echteAblage();
    store = new TauriSqlOutboxStore();
    api = createApiClient({
      baseUrl: 'http://localhost:3001',
      middlewares: [
        offlineQueueMiddleware({
          store,
          isOnline: () => false,
          deviceId: 'tresen-01',
          classifyGobdRelevant: (path) => isGobdRelevantPath(path),
        }),
      ],
    });
    useCartStore.getState().clearCart();
  });
  afterEach(() => {
    h.current = null;
    useCartStore.getState().clearCart();
    vi.clearAllMocks();
  });

  it('sagt die WAHRHEIT: nicht reserviert, Stück bleibt frei, später erneut antippen', async () => {
    let gefangen: unknown;
    try {
      // Genau der Aufruf aus Verkauf.tsx:205, vor `addLine`.
      await productsApi.reserve(api, {
        productId: PRODUKT,
        channel: 'POS',
        sessionId: '22222222-2222-4222-8222-222222222222',
      });
    } catch (err) {
      gefangen = err;
    }

    const { hinweis, katalogAuffrischen } = reservierungsFehlerDeuten(gefangen, SKU);

    expect(hinweis).not.toBeNull();
    expect(hinweis?.title).toBe('Ohne Verbindung keine Reservierung');
    expect(hinweis?.body).toBe(
      `${SKU} wurde NICHT reserviert und bleibt für andere frei. Sobald die Verbindung zurück ist, erneut antippen.`,
    );
    // Der alte Satz behauptete etwas, das er nicht wissen konnte.
    expect(hinweis?.body).not.toContain('konnte nicht gesetzt werden');
    expect(katalogAuffrischen).toBe(false);
  });

  it('legt nichts in den Ausgangskorb und nichts in die Karte', async () => {
    await expect(
      productsApi.reserve(api, {
        productId: PRODUKT,
        channel: 'POS',
        sessionId: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toThrow();

    // Der Korb: `addLine` steht in Verkauf.tsx NACH dem erwarteten `reserve`,
    // der Wurf überspringt ihn also. Belegt am echten Speicher der Karte.
    expect(useCartStore.getState().lines).toHaveLength(0);
    expect(await store.listPending()).toHaveLength(0);
  });

  /**
   * Der Fall, den die Wurzelbehebung ausschliesst — hier trotzdem festgenagelt.
   * Käme ein Halt je doch eingereiht zurück (jemand nimmt `/api/inventory/
   * reserve` aus `FLUECHTIGE_PFADE`), darf die Fläche NICHT den ruhigen
   * „alles gut"-Hinweis zeigen, den `eingereihtHinweis` für Belege gibt. Für
   * einen Halt ist Einreihen kein Erfolg.
   */
  it('ein eingereihter Halt wird nicht als Erfolg ausgegeben', () => {
    const eingereiht = new ApiOfflineQueuedError('key-1', Date.now());
    const { hinweis } = reservierungsFehlerDeuten(eingereiht, SKU);

    expect(hinweis?.tone).toBe('alert');
    expect(hinweis?.body).toContain('NICHT gehalten');
    expect(hinweis?.body).not.toContain('Wird übertragen');
  });

  it('die echten Fachfehler bleiben unangetastet', () => {
    const belegt = new ApiError({
      code: 'PRODUCT_NOT_RESERVABLE',
      message: 'reserved',
      httpStatus: 409,
    });
    const a = reservierungsFehlerDeuten(belegt, SKU);
    expect(a.hinweis?.title).toBe('Bereits anderswo reserviert');
    expect(a.katalogAuffrischen).toBe(true);

    const stepUp = new ApiError({
      code: 'STEP_UP_REQUIRED',
      message: 'step up',
      httpStatus: 401,
    });
    // Abgebrochene Aufforderung: bewusst still, kein Hinweis.
    expect(reservierungsFehlerDeuten(stepUp, SKU).hinweis).toBeNull();
  });

  /**
   * Wächter gegen den stillen Rückfall: die Fläche muss diese Deutung WIRKLICH
   * benutzen. Ohne ihn könnte jemand die Zweige zurück in `Verkauf.tsx`
   * schreiben, und dieser Test bliebe grün über einer toten Datei.
   */
  it('Verkauf.tsx benutzt diese Deutung und trägt den falschen Satz nicht mehr', () => {
    const quelle = readFileSync(
      fileURLToPath(new URL('./Verkauf.tsx', import.meta.url)),
      'utf8',
    );
    // Als boolean geprüft, damit ein Fehlschlag nicht die ganze Datei ausgibt.
    expect(quelle.includes('reservierungsFehlerDeuten')).toBe(true);
    expect(quelle.includes('Reservierung konnte nicht gesetzt werden.')).toBe(false);
  });
});
