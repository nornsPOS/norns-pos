/**
 * ════════════════════════════════════════════════════════════════════════
 *  DER AUSGANGSKORB DARF DEN SITZUNGSSCHLÜSSEL NICHT MITVERSIEGELN
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────
 *
 * `offlineQueueMiddleware` versiegelte `{ ...req.headers }` in die Zeile —
 * einschliesslich `Authorization: Bearer <Sitzung>`. Gemessen:
 *
 *     Versiegelter Kopf in der Zeile: Bearer TOKEN-VON-MONTAG
 *     Was WIRKLICH über die Leitung ging: Bearer TOKEN-VON-MONTAG
 *     Aktueller Schlüssel im Speicher: TOKEN-VON-DIENSTAG
 *
 *     drainOutbox: { kind: 'aborted', reason: 'auth', needsAttention: true }
 *     überhaupt versucht: [ 1 ]   noch in der Warteschlange: [ 'V-1','V-2','V-3' ]
 *
 * Die Personal-Sitzung läuft nach acht Stunden ab. Eine Kasse, die um 17 Uhr
 * ohne Netz einen Verkauf einreiht und am nächsten Morgen hochfährt, schickt
 * den toten Schlüssel von gestern. Der Server nimmt sonst den Keks — aber
 * genau der wird auf Windows-WebView2 verworfen, deshalb existiert der Bearer
 * überhaupt, und Windows ist das ausgelieferte Ziel. Ergebnis: 401,
 * `drainOutbox` bricht mit `reason: 'auth'` ab, die Reihenfolge ist streng,
 * und ALLES dahinter wird nicht einmal versucht. Jede neue Anmeldung erzeugt
 * einen neuen Schlüssel, während die Zeile den alten mitschleppt: die
 * Warteschlange löst sich nie von selbst.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ───────────────────────────────
 *
 * „Beim Abspielen einfach den frischen Schlüssel danebenlegen" wirkt nicht:
 * der Klient setzt den Bearer nur, wenn NOCH KEINER da ist — und in der Zeile
 * ist einer. Der versiegelte gewinnt. Deshalb zwei Riegel, nicht einer:
 *
 *   1. er wird gar nicht erst eingereiht (neue Zeilen sind sauber)
 *   2. der lebende Schlüssel gewinnt gegen einen mitgeschleppten (die Zeilen,
 *      die auf ausgelieferten Kassen HEUTE schon liegen, lösen sich)
 *
 * ── WAS DIESER WÄCHTER MISST ────────────────────────────────────────────
 *
 * Nicht die Erwähnung eines Feldnamens, sondern (a) die Kopfzeilen der
 * WIRKLICH eingereihten Zeile und (b) den Bearer, der WIRKLICH über die
 * Leitung geht, und (c) ob ein voller Rückstau am nächsten Morgen abfliesst.
 *
 * ⚠️ `apps/tauri-pos` liest `@norns/api-client` als GEBAUTES Paket. Wer
 * diese Datei rot/grün fahren will, muss den Klienten VORHER neu bauen
 * (`pnpm --filter @norns/api-client build`), sonst prüft er einen alten
 * Stand und der Lauf sagt nichts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiOfflineQueuedError,
  type OutboxRecord,
  type OutboxStore,
  createApiClient,
  drainOutbox,
  offlineQueueMiddleware,
} from '@norns/api-client';

const GESTERN = 'SCHLUESSEL-VON-GESTERN';
const HEUTE = 'SCHLUESSEL-VON-HEUTE';

/** Ein Ausgangskorb im Arbeitsspeicher, mit der FIFO-Reihenfolge des echten. */
function korb(): { store: OutboxStore; zeilen: OutboxRecord[]; erledigt: string[] } {
  const zeilen: OutboxRecord[] = [];
  const erledigt: string[] = [];
  const store: OutboxStore = {
    enqueue: async (record) => {
      zeilen.push(record);
    },
    markSucceeded: async (key) => {
      erledigt.push(key);
      const i = zeilen.findIndex((z) => z.idempotencyKey === key);
      if (i >= 0) zeilen.splice(i, 1);
    },
    markConflict: async () => {},
    listPending: async () => [...zeilen],
  };
  return { store, zeilen, erledigt };
}

/** Der Verkehrsmitschnitt: was ging WIRKLICH über die Leitung? */
interface Fahrt {
  url: string;
  auth: string | null;
}

function leitung(antwort: (auth: string | null) => Response): {
  fahrten: Fahrt[];
  fetch: typeof globalThis.fetch;
} {
  const fahrten: Fahrt[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const kopf = (init.headers ?? {}) as Record<string, string>;
    const auth = kopf['Authorization'] ?? kopf['authorization'] ?? null;
    fahrten.push({ url: String(url), auth });
    return antwort(auth);
  }) as unknown as typeof globalThis.fetch;
  return { fahrten, fetch: f };
}

function ok(): Response {
  return new Response(JSON.stringify({ id: 'tx-1' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function abgelehnt(): Response {
  return new Response(
    JSON.stringify({
      error: { code: 'UNAUTHORIZED', message: 'Sitzung abgelaufen', requestId: 'r-1' },
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

const echtesFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = echtesFetch;
  vi.restoreAllMocks();
});

describe('⛔ Was in den Korb gelegt wird', () => {
  let ablage: ReturnType<typeof korb>;

  beforeEach(() => {
    ablage = korb();
  });

  it('⚠️ DER KERN: die eingereihte Zeile trägt KEINEN Sitzungsschlüssel', async () => {
    const client = createApiClient({
      baseUrl: 'http://server.ungueltig',
      getAuthToken: () => GESTERN,
      middlewares: [
        offlineQueueMiddleware({
          store: ablage.store,
          isOnline: () => false, // bekannt offline: es wird sofort eingereiht
          deviceId: 'kasse-1',
        }),
      ],
    });

    await expect(
      client.request('POST', '/api/transactions/finalize', { totalEur: '19.90' }, {
        custom: { idempotencyKey: 'K-1' },
      }),
    ).rejects.toBeInstanceOf(ApiOfflineQueuedError);

    expect(ablage.zeilen).toHaveLength(1);
    const kopf = ablage.zeilen[0]!.headers;
    const schluesselFelder = Object.keys(kopf).filter((k) =>
      ['authorization', 'cookie'].includes(k.toLowerCase()),
    );
    expect(schluesselFelder, `versiegelt wurde: ${JSON.stringify(kopf)}`).toEqual([]);
    // Was der Server WIRKLICH braucht, bleibt versiegelt: der Idempotenzschlüssel.
    expect(kopf['idempotency-key']).toBe('K-1');
  });
});

describe('⛔ Was beim Abspielen über die Leitung geht', () => {
  it('⚠️ ein mitgeschleppter Schlüssel darf den lebenden nicht verdrängen', async () => {
    // Genau die Zeile, die auf einer ausgelieferten Windows-Kasse HEUTE liegt.
    const { fahrten, fetch } = leitung(() => ok());
    globalThis.fetch = fetch;

    const client = createApiClient({
      baseUrl: 'http://server.ungueltig',
      getAuthToken: () => HEUTE,
    });

    await client.request('POST', '/api/transactions/finalize', { totalEur: '19.90' }, {
      headers: { Authorization: `Bearer ${GESTERN}`, 'idempotency-key': 'K-ALT' },
      custom: { skipOfflineQueue: true },
    });

    expect(fahrten).toHaveLength(1);
    expect(fahrten[0]!.auth).toBe(`Bearer ${HEUTE}`);
  });

  it('ohne lebende Sitzung wird gar kein Schlüssel geschickt, nie ein toter', async () => {
    const { fahrten, fetch } = leitung(() => ok());
    globalThis.fetch = fetch;

    const client = createApiClient({
      baseUrl: 'http://server.ungueltig',
      getAuthToken: () => null,
    });

    await client.request('POST', '/api/transactions/finalize', { totalEur: '1.00' }, {
      headers: { Authorization: `Bearer ${GESTERN}` },
      custom: { skipOfflineQueue: true },
    });

    expect(fahrten[0]!.auth).toBeNull();
  });
});

describe('⛔ Der nächste Morgen: fliesst der Rückstau ab?', () => {
  it('⚠️ drei gestern eingereihte Belege gehen durch, statt für immer zu stehen', async () => {
    const ablage = korb();

    // ── Gestern, 17 Uhr, kein Netz ────────────────────────────────────
    const gestrigerKlient = createApiClient({
      baseUrl: 'http://server.ungueltig',
      getAuthToken: () => GESTERN,
      middlewares: [
        offlineQueueMiddleware({
          store: ablage.store,
          isOnline: () => false,
          deviceId: 'kasse-1',
        }),
      ],
    });
    for (const k of ['V-1', 'V-2', 'V-3']) {
      await expect(
        gestrigerKlient.request('POST', '/api/transactions/finalize', { beleg: k }, {
          custom: { idempotencyKey: k },
        }),
      ).rejects.toBeInstanceOf(ApiOfflineQueuedError);
    }
    expect(ablage.zeilen.map((z) => z.idempotencyKey)).toEqual(['V-1', 'V-2', 'V-3']);

    // ── Heute früh, frisch angemeldet ─────────────────────────────────
    // Der Server nimmt NUR den heutigen Schlüssel an. Genau so verhält sich
    // eine abgelaufene Personal-Sitzung.
    const { fahrten, fetch } = leitung((auth) => (auth === `Bearer ${HEUTE}` ? ok() : abgelehnt()));
    globalThis.fetch = fetch;

    const heutigerKlient = createApiClient({
      baseUrl: 'http://server.ungueltig',
      getAuthToken: () => HEUTE,
    });

    const ergebnis = await drainOutbox({
      store: ablage.store,
      replay: (record) =>
        heutigerKlient.request(record.method, record.path, record.body, {
          headers: record.headers,
          custom: { skipOfflineQueue: true, skipStepUp: true, idempotent: true },
        }),
    });

    expect(ergebnis.kind, `Ausgang: ${JSON.stringify(ergebnis)}`).toBe('drained');
    expect(ablage.erledigt).toEqual(['V-1', 'V-2', 'V-3']);
    expect(fahrten.map((f) => f.auth)).toEqual([
      `Bearer ${HEUTE}`,
      `Bearer ${HEUTE}`,
      `Bearer ${HEUTE}`,
    ]);
  });
});
