/**
 * Der Stau im Ausgangskorb, und warum er vierzehn Stunden unsichtbar war.
 *
 * `STEP_UP_REQUIRED` zählt zu den Anmeldelücken. Der Ausgangskorb pausiert
 * dann — richtig so, es gibt keine Sitzung, unter der nachgespielt werden
 * könnte. Falsch war, dass die Oberfläche das nicht von einem Netzausfall
 * unterscheiden konnte: sie meldete in beiden Fällen „Die Warteschlange wird
 * gerade abgearbeitet", während in Wahrheit nichts mehr lief.
 *
 * Auf dem Mac löst sich der Stau bei der nächsten Anmeldung von selbst, und
 * genau deshalb fiel er nie auf. Auf der Windows-Kasse ist er ENDGÜLTIG: die
 * Wiederholung trägt den beim Einreihen versiegelten Bearer, und der ist
 * abgelaufen.
 *
 * Die Reihenfolge bleibt streng. Fiskalische Vorgänge dürfen sie nicht
 * verlieren, also wird NICHT vorbeigeräumt — es wird nur ehrlich benannt.
 */

import { describe, expect, it, vi } from 'vitest';

import { ApiError, ApiNetworkError } from '../errors.js';
import type { OutboxRecord } from './offline-queue.js';
import { drainOutbox, STAU_SCHWELLE_MS } from './offline-replay.js';

const JETZT = 1_800_000_000_000;

const zeile = (key: string, enqueuedAt: number): OutboxRecord => ({
  idempotencyKey: key,
  traceId: null,
  method: 'POST',
  path: '/api/shifts/x/close',
  url: 'https://api.warehouse14.de/api/shifts/x/close',
  headers: { authorization: 'Bearer versiegelt-und-abgelaufen' },
  body: {},
  enqueuedAt,
  gobdRelevant: true,
  callerSuppliedKey: true,
  deviceId: 'kasse-1',
});

function korb(zeilen: OutboxRecord[], fehler: unknown) {
  return {
    store: {
      listPending: async () => zeilen,
      markSucceeded: vi.fn(async () => {}),
      markConflict: vi.fn(async () => {}),
    } as never,
    replay: async () => {
      throw fehler;
    },
    now: () => JETZT,
  };
}

describe('eine Anmeldeluecke heisst jetzt auch so', () => {
  it('STEP_UP_REQUIRED wird als `auth` gemeldet, nicht als Netzproblem', async () => {
    const e = await drainOutbox(
      korb(
        [zeile('a', JETZT - 60_000)],
        new ApiError({ code: 'STEP_UP_REQUIRED', message: 'PIN', httpStatus: 403 }),
      ),
    );

    expect(e.kind).toBe('aborted');
    if (e.kind !== 'aborted') return;
    expect(e.reason).toBe('auth');
  });

  it('ein Netzabriss bleibt `transport`', async () => {
    const e = await drainOutbox(korb([zeile('a', JETZT - 60_000)], new ApiNetworkError('weg')));
    expect(e.kind).toBe('aborted');
    if (e.kind !== 'aborted') return;
    expect(e.reason).toBe('transport');
  });

  it('UNAUTHORIZED und DEVICE_NOT_AUTHORIZED ebenfalls `auth`', async () => {
    for (const code of ['UNAUTHORIZED', 'DEVICE_NOT_AUTHORIZED'] as const) {
      const e = await drainOutbox(
        korb([zeile('a', JETZT - 60_000)], new ApiError({ code, message: 'x', httpStatus: 401 })),
      );
      if (e.kind !== 'aborted') throw new Error('erwartet: aborted');
      expect(e.reason, code).toBe('auth');
    }
  });
});

describe('ab wann Warten ein Stau ist', () => {
  const stepUp = new ApiError({ code: 'STEP_UP_REQUIRED', message: 'PIN', httpStatus: 403 });

  it('eine Minute ist normales Warten', async () => {
    const e = await drainOutbox(korb([zeile('a', JETZT - 60_000)], stepUp));
    if (e.kind !== 'aborted') throw new Error('erwartet: aborted');
    expect(e.needsAttention).toBe(false);
    expect(e.blockedForMs).toBe(60_000);
  });

  it('ueber der Schwelle muss es ein Mensch sehen', async () => {
    const e = await drainOutbox(korb([zeile('a', JETZT - STAU_SCHWELLE_MS - 1000)], stepUp));
    if (e.kind !== 'aborted') throw new Error('erwartet: aborted');
    expect(e.needsAttention).toBe(true);
  });

  it('gemessen wird die KOPFZEILE, denn sie blockiert alles dahinter', async () => {
    // Die Reihenfolge ist streng und bleibt es. Eine junge Zeile hinter einer
    // uralten darf nicht darueber hinwegtaeuschen, dass der Korb steht.
    const e = await drainOutbox(
      korb([zeile('alt', JETZT - 20 * 3_600_000), zeile('neu', JETZT - 1000)], stepUp),
    );
    if (e.kind !== 'aborted') throw new Error('erwartet: aborted');
    expect(e.record.idempotencyKey).toBe('alt');
    expect(e.needsAttention).toBe(true);
  });

  it('eine Geraeteuhr, die zurueckspringt, ergibt kein negatives Alter', async () => {
    const e = await drainOutbox(korb([zeile('a', JETZT + 5_000)], stepUp));
    if (e.kind !== 'aborted') throw new Error('erwartet: aborted');
    expect(e.blockedForMs).toBe(0);
    expect(e.needsAttention).toBe(false);
  });
});

describe('was sich NICHT aendert', () => {
  it('die Reihenfolge bleibt streng: es wird nicht vorbeigeraeumt', async () => {
    const stepUp = new ApiError({ code: 'STEP_UP_REQUIRED', message: 'PIN', httpStatus: 403 });
    const versucht: string[] = [];
    const e = await drainOutbox({
      store: {
        listPending: async () => [zeile('erste', JETZT - 1000), zeile('zweite', JETZT - 500)],
        markSucceeded: vi.fn(async () => {}),
        markConflict: vi.fn(async () => {}),
      } as never,
      replay: async (r) => {
        versucht.push(r.idempotencyKey);
        throw stepUp;
      },
      now: () => JETZT,
    });

    // NUR die erste wurde versucht. Fiskalische Vorgaenge duerfen ihre
    // Reihenfolge nicht verlieren, also wird bei der Kopfzeile gestoppt.
    expect(versucht).toEqual(['erste']);
    expect(e.kind).toBe('aborted');
  });

  it('ein echter Konflikt haelt weiterhin an und wandert ins Postfach', async () => {
    const markConflict = vi.fn(async () => {});
    const e = await drainOutbox({
      store: {
        listPending: async () => [zeile('a', JETZT - 1000)],
        markSucceeded: vi.fn(async () => {}),
        markConflict,
      } as never,
      replay: async () => {
        throw new ApiError({ code: 'CONFLICT', message: 'schon gebucht', httpStatus: 409 });
      },
      now: () => JETZT,
    });
    expect(e.kind).toBe('halted');
    expect(markConflict).toHaveBeenCalledOnce();
  });
});
