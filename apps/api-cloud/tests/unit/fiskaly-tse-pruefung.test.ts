/**
 * ════════════════════════════════════════════════════════════════════════
 *  Eine Kasse darf sich nicht scharf nennen, ohne die TSE gefragt zu haben
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── ⚠️ DIE ECHTE MESSUNG VOM 05.08.2026 ─────────────────────────────────
 *
 * Gegen fiskalys TEST-Umgebung, mit Basels Schlüsseln:
 *
 *   POST /auth                          → HTTP 200, Marke erhalten
 *   GET  /tss                           → eine Einheit, Zustand CREATED
 *   PATCH /tss/{id} {state:UNINITIALIZED}
 *                                       → HTTP 502
 *                                         {"code":"E_SMAERS",
 *                                          "message":"storage error (66)"}
 *
 * Dreimal wiederholt, danach auf einer BRANDNEUEN Einheit dreimal wiederholt:
 * immer derselbe Fehler. Diese TSE kann nichts signieren.
 *
 * Bis heute hätte `POST /api/tse/einrichten` genau diese Kennung entgegen-
 * genommen und „fiskalisch scharf" gemeldet. Die Antworten unten sind die
 * ECHTEN Formen, die fiskaly zurückgibt — keine erfundenen Attrappen.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import {
  _markeVergessen,
  pruefeTse,
  tseSatz,
  tseZugangVorhanden,
  type TseFetch,
} from '../../src/lib/fiskaly-tse-pruefung.js';

const ZUGANG = { apiKey: 'schluessel', apiSecret: 'geheimnis' };
const BASIS = 'https://beispiel.test/api/v2';

/** Eine Antwort bauen, wie `fetch` sie liefert. */
function antwort(status: number, koerper: unknown): Response {
  return new Response(JSON.stringify(koerper), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Eine protokolltreue Attrappe: sie beantwortet die drei Adressen, die die
 * echte Schnittstelle kennt, und wirft bei jeder anderen. Eine Attrappe, die
 * alles freundlich beantwortet, würde einen falschen Weg nie auffallen lassen.
 */
function attrappe(plan: {
  auth?: () => Response;
  tss?: () => Response;
  client?: () => Response;
}): { hole: TseFetch; gerufen: string[] } {
  const gerufen: string[] = [];
  const hole: TseFetch = async (adresse) => {
    gerufen.push(adresse);
    if (adresse.endsWith('/auth')) return (plan.auth ?? (() => antwort(200, { access_token: 'marke', access_token_expires_in: 3600 })))();
    if (/\/tss\/[^/]+\/client\/[^/]+$/.test(adresse)) {
      if (!plan.client) throw new Error(`Unerwarteter Klienten-Aufruf: ${adresse}`);
      return plan.client();
    }
    if (/\/tss\/[^/]+$/.test(adresse)) {
      if (!plan.tss) throw new Error(`Unerwarteter TSE-Aufruf: ${adresse}`);
      return plan.tss();
    }
    throw new Error(`Unbekannte Adresse: ${adresse}`);
  };
  return { hole, gerufen };
}

beforeEach(() => _markeVergessen());

describe('Ohne Zugangsdaten wird nichts behauptet', () => {
  it('meldet kein_zugang statt bereit', async () => {
    const p = await pruefeTse('t', 'c', { apiKey: '', apiSecret: '' });
    expect(p.art).toBe('kein_zugang');
  });

  it('erkennt leere und nur-Leerzeichen-Schlüssel', () => {
    expect(tseZugangVorhanden({ apiKey: '', apiSecret: 'x' })).toBe(false);
    expect(tseZugangVorhanden({ apiKey: '   ', apiSecret: 'x' })).toBe(false);
    expect(tseZugangVorhanden({ apiKey: 'x', apiSecret: 'x' })).toBe(true);
  });
});

describe('Der Zustand der TSE entscheidet', () => {
  it('⚠️ CREATED ist NICHT scharf — genau die Einheit vom 05.08.2026', async () => {
    const { hole } = attrappe({ tss: () => antwort(200, { state: 'CREATED' }) });
    const p = await pruefeTse('aa6dd5b6-380b-4d4f-b4aa-8ee10170f7a6', 'kasse-1', ZUGANG, {
      basis: BASIS,
      fetchImpl: hole,
    });
    expect(p.art).toBe('tss_nicht_scharf');
    expect(p).toMatchObject({ zustand: 'CREATED' });
    expect(tseSatz(p)).toContain('CREATED');
    expect(tseSatz(p)).toContain('kann noch nicht signieren');
  });

  it('UNINITIALIZED ist ebenfalls nicht scharf', async () => {
    const { hole } = attrappe({ tss: () => antwort(200, { state: 'UNINITIALIZED' }) });
    const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p.art).toBe('tss_nicht_scharf');
  });

  it('DISABLED ist nicht scharf — eine stillgelegte TSE signiert nie wieder', async () => {
    const { hole } = attrappe({ tss: () => antwort(200, { state: 'DISABLED' }) });
    const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p).toMatchObject({ art: 'tss_nicht_scharf', zustand: 'DISABLED' });
  });

  it('eine unbekannte Kennung ist ein eigener Grund, kein Netzfehler', async () => {
    const { hole } = attrappe({ tss: () => antwort(404, { message: 'not found' }) });
    const p = await pruefeTse('gibt-es-nicht', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p.art).toBe('tss_unbekannt');
    expect(tseSatz(p)).toContain('findet fiskaly keine TSE');
  });
});

describe('Der Kassenklient muss dort registriert sein', () => {
  it('ein fehlender Klient ist ein eigener Grund', async () => {
    const { hole } = attrappe({
      tss: () => antwort(200, { state: 'INITIALIZED' }),
      client: () => antwort(404, { message: 'not found' }),
    });
    const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p.art).toBe('client_unbekannt');
  });

  it('ein Klient in einem anderen Zustand als REGISTERED zählt nicht', async () => {
    const { hole } = attrappe({
      tss: () => antwort(200, { state: 'INITIALIZED' }),
      client: () => antwort(200, { state: 'DEREGISTERED' }),
    });
    const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p).toMatchObject({ art: 'client_nicht_registriert', zustand: 'DEREGISTERED' });
  });
});

describe('Nur beides zusammen ist bereit', () => {
  it('INITIALIZED plus REGISTERED ergibt bereit, mit Seriennummer', async () => {
    const { hole, gerufen } = attrappe({
      tss: () => antwort(200, { state: 'INITIALIZED', serial_number: 'ABC123' }),
      client: () => antwort(200, { state: 'REGISTERED' }),
    });
    const p = await pruefeTse('t-1', 'kasse-1', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p).toEqual({
      art: 'bereit',
      tssZustand: 'INITIALIZED',
      clientZustand: 'REGISTERED',
      seriennummer: 'ABC123',
    });
    // BEIDE Fragen müssen wirklich gestellt worden sein.
    expect(gerufen.some((a) => a.endsWith('/tss/t-1'))).toBe(true);
    expect(gerufen.some((a) => a.endsWith('/tss/t-1/client/kasse-1'))).toBe(true);
  });

  it('Kennungen mit Sonderzeichen werden für die Adresse verpackt', async () => {
    const { hole, gerufen } = attrappe({
      tss: () => antwort(200, { state: 'INITIALIZED' }),
      client: () => antwort(200, { state: 'REGISTERED' }),
    });
    await pruefeTse('a/b', 'c d', ZUGANG, { basis: BASIS, fetchImpl: hole });
    // Ohne Verpackung wäre aus `a/b` ein zweites Adressglied geworden und die
    // Anfrage hätte eine ganz andere TSE getroffen.
    expect(gerufen.some((a) => a.includes('/tss/a%2Fb'))).toBe(true);
    expect(gerufen.some((a) => a.includes('/client/c%20d'))).toBe(true);
  });
});

describe('⚠️ Eine Störung ist NIEMALS ein Erfolg', () => {
  it('das ECHTE E_SMAERS 502 vom 05.08.2026 ergibt nicht_erreichbar', async () => {
    const { hole } = attrappe({
      tss: () =>
        antwort(502, {
          code: 'E_SMAERS',
          message: 'storage error (66)',
          status_code: 502,
          error: 'Bad Gateway',
        }),
    });
    const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p.art).toBe('nicht_erreichbar');
    expect(tseSatz(p)).toContain('NICHT übernommen');
  });

  it('eine abgelehnte Anmeldung ergibt nicht_erreichbar, nicht bereit', async () => {
    const { hole } = attrappe({ auth: () => antwort(401, { error: 'Unauthorized' }) });
    const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p.art).toBe('nicht_erreichbar');
  });

  it('ein Netzabbruch ergibt nicht_erreichbar, nicht bereit', async () => {
    const hole: TseFetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
    expect(p).toMatchObject({ art: 'nicht_erreichbar' });
  });

  it('KEIN Ausgang dieser Funktion ist versehentlich bereit', async () => {
    // Der Riegel gegen den stillen Rückfall: falls jemand später einen Zweig
    // hinzufügt und dabei `bereit` als Vorgabe nimmt, wird das hier rot.
    const laesst: Array<[string, Parameters<typeof attrappe>[0]]> = [
      ['TSE 500', { tss: () => antwort(500, {}) }],
      ['TSE 403', { tss: () => antwort(403, {}) }],
      ['TSE ohne Zustandsfeld', { tss: () => antwort(200, {}) }],
      ['Klient 500', { tss: () => antwort(200, { state: 'INITIALIZED' }), client: () => antwort(500, {}) }],
      ['Klient ohne Zustandsfeld', { tss: () => antwort(200, { state: 'INITIALIZED' }), client: () => antwort(200, {}) }],
    ];
    for (const [name, plan] of laesst) {
      const { hole } = attrappe(plan);
      const p = await pruefeTse('t', 'c', ZUGANG, { basis: BASIS, fetchImpl: hole });
      expect(p.art, `${name} darf nicht bereit ergeben`).not.toBe('bereit');
    }
  });
});

describe('Jeder Ausgang hat einen deutschen Satz', () => {
  it('kein Ausgang bleibt ohne Erklärung, und keiner nennt einen Rohbegriff', () => {
    const alle = [
      { art: 'bereit', tssZustand: 'INITIALIZED', clientZustand: 'REGISTERED', seriennummer: null },
      { art: 'kein_zugang' },
      { art: 'tss_unbekannt' },
      { art: 'tss_nicht_scharf', zustand: 'CREATED' },
      { art: 'client_unbekannt' },
      { art: 'client_nicht_registriert', zustand: 'DEREGISTERED' },
      { art: 'nicht_erreichbar', grund: 'HTTP 502' },
    ] as const;
    for (const p of alle) {
      const s = tseSatz(p);
      expect(s.length, `${p.art} ohne Satz`).toBeGreaterThan(20);
      // Der Rohbegriff selbst darf nie im Satz stehen; er ist kein Deutsch.
      expect(s, `${p.art} zeigt den Rohbegriff`).not.toContain(p.art);
    }
  });
});
