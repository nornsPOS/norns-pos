/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ JEDER FEHLVERSUCH LEGTE EINE EIGENE ZEILE IN DEN AUSGANGSKORB
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND (Tiefenjagd 11.08.2026) ────────────────────────────────────
 *
 * `transactionsApi.recordTseSignature` reichte kein `custom` weiter. Jeder
 * gescheiterte Versuch bekam damit einen FRISCHEN Idempotenzschlüssel und
 * legte eine EIGENE Zeile an. Gemessen mit echtem Klienten, echtem
 * Mittelstück und totem Transport: 39 Versuche, 39 Zeilen, 39 Schlüssel.
 *
 * Die 39 ist keine gegriffene Zahl: das ist, was die echte
 * Verzögerungsstaffel des Nachreichers (5 s, verdoppelnd bis 15 min) in acht
 * Stunden Ausfall ergibt. Bei zehn hängenden Belegen also rund 390 Zeilen.
 *
 * ── WAS DIESER WÄCHTER MISST ─────────────────────────────────────────────
 *
 * Nicht den Quelltext. Er fährt den ECHTEN Weg: echtes
 * `transactionsApi.recordTseSignature`, echtes `createApiClient` mit echtem
 * `offlineQueueMiddleware`, `fetch` wirft. Dann zählt er, was WIRKLICH
 * eingereiht wurde.
 *
 * ── ZWEI ENTSCHEIDUNGEN, DIE EIN SKEPTIKER ERZWUNGEN HAT ─────────────────
 *
 * 1. DER KORB IST EINE `Map`, KEIN `node:sqlite`. Der erste Entwurf wollte
 *    den echten SQLite-Speicher hier nachbauen. Gemessen: `node:sqlite`
 *    löst im Aufbau dieses Pakets gar nicht auf, und `.nvmrc` steht auf
 *    20.18.0, während es dieses Modul erst ab Node 22.5 gibt. Ein Wächter,
 *    der still nicht läuft, ist schlimmer als keiner. Die `Map` hält genau
 *    die Zusage, die `offline-queue.ts` von jedem Speicher verlangt
 *    (einfügen-oder-übergehen auf dem Schlüssel). Dass die ECHTE Anweisung
 *    das auch tut, hält der Schwesterwächter in
 *    `apps/tauri-pos/src/lib/outbox-store.test.ts` fest — der eine beweist
 *    EIN Schlüssel, der andere EINE Zeile.
 *
 * 2. KEINE ZUSICHERUNG AUF `callerSuppliedKey`. Sie fing keine einzige der
 *    fünf Sabotagen und wurde ROT bei einer VERBESSERUNG (dem stabilen
 *    Schlüssel im Mittelstück statt im Wrapper). Ein Wächter, der den WEG
 *    pinnt statt die WIRKUNG, blockiert den besseren Griff.
 */

import { describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../src/client.js';
import { transactionsApi } from '../src/domains/transactions.js';
import type { OutboxRecord, OutboxStore } from '../src/middleware/offline-queue.js';
import { offlineQueueMiddleware } from '../src/middleware/offline-queue.js';

/** Ein Korb, der die Zusage der Schnittstelle hält: einfügen oder übergehen. */
function korb(): OutboxStore & { zeilen: Map<string, OutboxRecord> } {
  const zeilen = new Map<string, OutboxRecord>();
  return {
    zeilen,
    async enqueue(r: OutboxRecord) {
      if (!zeilen.has(r.idempotencyKey)) zeilen.set(r.idempotencyKey, r);
    },
    async markSucceeded() {},
    async markConflict() {},
    async listPending() {
      return [...zeilen.values()];
    },
  } as unknown as OutboxStore & { zeilen: Map<string, OutboxRecord> };
}

const VORGANG = '11111111-2222-3333-4444-555555555555';
const ZWEITER = '99999999-8888-7777-6666-555555555555';

const KOERPER = {
  fiskalyTssId: 'a',
  fiskalyClientId: 'b',
  fiskalyTransactionId: 'c',
  fiskalyTransactionNumber: '1',
  signatureValue: 'sig',
  signatureCounter: '1',
  signatureAlgorithm: 'ecdsa-plain-SHA256',
  processType: 'Kassenbeleg-V1',
} as never;

/** `versuche` Anläufe bei totem Transport, wie der Nachreicher sie fährt. */
async function fahre(
  transactionId: string,
  speicher: OutboxStore,
  versuche: number,
): Promise<void> {
  // Genau die Verdrahtung, die die Kasse fährt: das ECHTE Mittelstück am
  // ECHTEN Klienten. `isOnline: true` ist Absicht — der Ausfall zeigt sich
  // hier am toten Transport, nicht an einer Ampel.
  const client = createApiClient({
    baseUrl: 'http://kasse.local',
    middlewares: [
      offlineQueueMiddleware({ store: speicher, isOnline: () => true, deviceId: 'kasse-01' }),
    ],
  } as never);
  for (let i = 0; i < versuche; i += 1) {
    // Jeder Anlauf scheitert am Netz — genau der Zustand während des Ausfalls.
    await transactionsApi.recordTseSignature(client, transactionId, KOERPER).catch(() => undefined);
  }
}

describe('⛔ die TSE-Signatur bekommt EINEN Schlüssel je Vorgang', () => {
  it('39 Versuche ergeben genau EINE Zeile mit EINEM Schlüssel', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const speicher = korb();
    await fahre(VORGANG, speicher, 39);

    const zeilen = await speicher.listPending();
    expect(zeilen.length, 'jeder Fehlversuch legt wieder eine eigene Zeile an').toBe(1);

    const zeile = zeilen[0];
    expect(zeile, 'es wurde gar nichts eingereiht — misst dieser Satz noch etwas?').toBeDefined();
    // Der Riegel gegen einen Wächter, der nichts fährt und trotzdem grün ist:
    expect(zeile?.path, 'der eingereihte Weg ist gar nicht die Signatur').toContain(
      '/tse-signature',
    );
    expect(
      zeile?.idempotencyKey,
      'der Schlüssel trägt die Vorgangskennung nicht — zwei Vorgänge teilten sich eine Zeile',
    ).toContain(VORGANG);
    expect(
      zeile?.headers['idempotency-key'],
      'der versiegelte Kopf trägt einen ANDEREN Schlüssel als die Zeile',
    ).toBe(zeile?.idempotencyKey);

    vi.unstubAllGlobals();
  });

  it('zwei Vorgänge ergeben zwei Zeilen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const speicher = korb();
    await fahre(VORGANG, speicher, 5);
    await fahre(ZWEITER, speicher, 5);

    const schluessel = (await speicher.listPending()).map((z) => z.idempotencyKey).sort();
    expect(schluessel.length, 'ein KONSTANTER Schlüssel liesse beide Vorgänge kollidieren').toBe(2);
    expect(new Set(schluessel).size).toBe(2);

    vi.unstubAllGlobals();
  });
});
