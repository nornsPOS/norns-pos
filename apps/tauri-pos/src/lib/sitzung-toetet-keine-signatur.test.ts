/**
 * ════════════════════════════════════════════════════════════════════════
 *  EINE ABGELAUFENE SITZUNG DARF KEINE EINZIGE TSE-SIGNATUR TOETEN
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND ──────────────────────────────────────────────────────────
 *
 * `istDauerhaftAbgelehnt` las JEDEN 4xx ausser 408 und 429 als endgueltig,
 * also auch 401 und 403. Gemessen am echten Weg:
 *
 *     HTTP 401 UNAUTHORIZED           -> dauerhaft abgelehnt = true
 *     HTTP 403 DEVICE_NOT_AUTHORIZED  -> dauerhaft abgelehnt = true
 *     HTTP 403 STEP_UP_REQUIRED       -> dauerhaft abgelehnt = true
 *
 *     Ergebnis der Runde: { attempted: 1, succeeded: 0, terminal: 1, retryable: 0 }
 *     Zeile: [ { status: 'failed_terminal', attempt_count: 0, hat_signatur: 1 } ]
 *     listDrainable jetzt+1 Jahr: 0 Zeilen
 *
 * Die Signatur lag also fertig auf der Zeile, es war nicht EIN Wiederholversuch
 * verbraucht, und ein Jahr spaeter wurde die Zeile trotzdem nie wieder gewaehlt.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ───────────────────────────────
 *
 * „4xx heisst: wir haben etwas falsch gemacht, also hilft Wiederholen nicht"
 * stimmt fuer den RUMPF, aber 401 und 403 sagen nichts ueber den Rumpf. Sie
 * sagen etwas ueber den ABSENDER: die Personal-Sitzung laeuft nach acht
 * Stunden ab, ein Kassierer ohne aufgeloeste Geraetekennung bekommt 403. Beides
 * kommt von selbst zurueck — die naechste Anmeldung reicht.
 *
 * Und der Nachreiche-Weg laeuft alle fuenf Sekunden ueber den GANZEN
 * Rueckstau. Faellt die Geraetekennung weg, stirbt in EINEM Durchlauf jede
 * wartende Zeile. § 146a AO kennt dafuer keine Ausnahme.
 *
 * ── WAS DIESER WAECHTER MISST ───────────────────────────────────────────
 *
 * Nicht die Erwaehnung einer Zahl, sondern den ZUSTAND der Zeile nach einem
 * echten Durchlauf der echten `drainTseQueue`: nach 401 und nach 403 muss sie
 * `pending` sein, der Versuchszaehler gestiegen, und `terminal` null.
 */

import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@norns/api-client';

import type { TseSignature } from './hardware-client.js';
import { istDauerhaftAbgelehnt } from './tse-nachreichen-regel.js';
import { type TseDrainDeps, drainTseQueue } from './tse-queue-drain.js';
import type {
  DrainableTseEntry,
  EnrichedTseQueueEntry,
  TseQueueStats,
  TseQueueStore,
} from './tse-queue-store.js';

const sig = (n: number): TseSignature => ({
  signatureValue: `sig-${n}`,
  signatureCounter: n,
  signatureAlgorithm: 'ecdsa-plain-SHA256',
  signaturePublicKey: 'MUSTER-PUBLIC-KEY',
  tssSerialNumber: 'MUSTER-TSE-SERIAL',
  transactionNumber: n,
  startedAt: '2026-08-11T10:00:00.000Z',
  finishedAt: '2026-08-11T10:00:01.000Z',
  qrCodePayload: `qr-${n}`,
});

interface FakeRow extends DrainableTseEntry {
  status: 'pending' | 'in_flight' | 'succeeded' | 'failed_terminal';
}

function zeile(id: number, over: Partial<DrainableTseEntry> = {}): FakeRow {
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
    // Die Signatur LIEGT bereits vor: nur die Aufzeichnung auf dem Server
    // fehlt noch. Genau das ist der Fall, in dem Aufgeben eine fertige,
    // gesetzlich verlangte Signatur vernichtet.
    signature: sig(id),
    status: 'pending',
    attemptCount: 0,
    ...over,
  };
}

function ablage(rows: FakeRow[]): { store: TseQueueStore; byId: Map<number, FakeRow> } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const store: TseQueueStore = {
    enqueue: vi.fn(async (_e: EnrichedTseQueueEntry) => {}),
    listDrainable: vi.fn(async () =>
      rows.filter((r) => r.status === 'pending' || r.status === 'in_flight'),
    ),
    markInFlight: vi.fn(async (id: number) => {
      const r = byId.get(id);
      if (r) r.status = 'in_flight';
    }),
    persistSignature: vi.fn(async (id: number, signature: TseSignature) => {
      const r = byId.get(id);
      if (r) r.signature = signature;
    }),
    incrementAttempt: vi.fn(async (id: number) => {
      const r = byId.get(id);
      if (r) {
        r.attemptCount += 1;
        r.status = 'pending';
      }
    }),
    markSucceeded: vi.fn(async (id: number) => {
      const r = byId.get(id);
      if (r) r.status = 'succeeded';
    }),
    markFailedTerminal: vi.fn(async (id: number) => {
      const r = byId.get(id);
      if (r) r.status = 'failed_terminal';
    }),
    getStats: vi.fn(
      async (): Promise<TseQueueStats> => ({ pending: 0, inFlight: 0, failedTerminal: 0 }),
    ),
  };
  return { store, byId };
}

function deps(over: Partial<TseDrainDeps>): TseDrainDeps {
  return {
    store: ablage([]).store,
    finish: vi.fn(async () => sig(1)),
    record: vi.fn(async () => {}),
    now: () => 1_000_000,
    ...over,
  };
}

/** Genau die Fehler, die der echte Motor auf dem Aufzeichnungs-Weg wirft. */
const abgelaufeneSitzung = new ApiError({
  code: 'UNAUTHORIZED',
  message: 'Sitzung abgelaufen',
  httpStatus: 401,
});
const geraetNichtFreigegeben = new ApiError({
  code: 'DEVICE_NOT_AUTHORIZED',
  message: 'Gerätekennung nicht aufgelöst',
  httpStatus: 403,
});
const stufeVerlangt = new ApiError({
  code: 'STEP_UP_REQUIRED',
  message: 'Erneute Freigabe nötig',
  httpStatus: 403,
});

describe('⛔ 401 und 403 sind VORÜBERGEHEND, nicht endgültig', () => {
  it('die Regel selbst gibt bei 401 nicht auf', () => {
    expect(istDauerhaftAbgelehnt(abgelaufeneSitzung)).toBe(false);
  });

  it('die Regel selbst gibt bei 403 nicht auf, in beiden Ausprägungen', () => {
    expect(istDauerhaftAbgelehnt(geraetNichtFreigegeben)).toBe(false);
    expect(istDauerhaftAbgelehnt(stufeVerlangt)).toBe(false);
  });
});

describe('⛔ Der Durchlauf: eine abgelaufene Sitzung tötet keine Zeile', () => {
  it('401 im Aufzeichnungs-Bein lässt die Zeile wiederholbar', async () => {
    const { store, byId } = ablage([zeile(1)]);
    const record = vi.fn(async () => {
      throw abgelaufeneSitzung;
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(byId.get(1)?.status, 'die Signatur darf nicht aufgegeben werden').toBe('pending');
    expect(byId.get(1)?.attemptCount).toBe(1);
    expect(outcome).toEqual({ attempted: 1, succeeded: 0, terminal: 0, retryable: 1 });
  });

  it('403 DEVICE_NOT_AUTHORIZED lässt die Zeile wiederholbar', async () => {
    const { store, byId } = ablage([zeile(1)]);
    const record = vi.fn(async () => {
      throw geraetNichtFreigegeben;
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(byId.get(1)?.status).toBe('pending');
    expect(outcome.terminal).toBe(0);
    expect(outcome.retryable).toBe(1);
  });

  it('⚠️ DER KERN: ein einziger Durchlauf ohne Sitzung tötet nicht den ganzen Rückstau', async () => {
    /**
     * Der Nachreiche-Weg läuft alle fünf Sekunden über ALLE wartenden Zeilen.
     * Fällt die Gerätekennung weg, traf es vorher in EINEM Durchlauf jede
     * einzelne davon — der komplette Rückstau ging auf `failed_terminal`, mit
     * fertiger Signatur auf jeder Zeile.
     */
    const { store, byId } = ablage([zeile(1), zeile(2), zeile(3)]);
    const record = vi.fn(async () => {
      throw geraetNichtFreigegeben;
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(outcome.attempted).toBe(3);
    expect(outcome.terminal, 'keine einzige Zeile darf sterben').toBe(0);
    expect(outcome.retryable).toBe(3);
    for (const id of [1, 2, 3]) {
      expect(byId.get(id)?.status, `Zeile ${id}`).toBe('pending');
      expect(byId.get(id)?.signature, `Signatur ${id}`).not.toBeNull();
    }
  });

  it('und der echte Fachfehler bleibt endgültig: ein falsch gebauter Rumpf', async () => {
    // Die Gegenprobe. Wäre alles vorübergehend, klopfte eine Zeile mit
    // dauerhaft falschem Rumpf bis in alle Ewigkeit an und der Händler sähe
    // nie, dass er handeln muss.
    const { store, byId } = ablage([zeile(1)]);
    const record = vi.fn(async () => {
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        message: 'body/amountCents muss ganzzahlig sein',
        httpStatus: 400,
      });
    });

    const outcome = await drainTseQueue(deps({ store, record }));

    expect(byId.get(1)?.status).toBe('failed_terminal');
    expect(outcome.terminal).toBe(1);
  });
});
