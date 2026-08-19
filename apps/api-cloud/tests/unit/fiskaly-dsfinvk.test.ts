/**
 * Der DSFinV-K-Weg meldet sich mit einem TOKEN an, nicht mit dem Schlüssel.
 *
 * ── DER FUND (26.07.2026) ──────────────────────────────────────────────────
 * Der Weg schickte Basic-Auth. Gemessen gegen das echte fiskaly, mit Basels
 * Testzugang:
 *
 *   GET /api/v1/exports  Authorization: Basic base64(key:secret)
 *   → 401  "Authorization header must follow the format
 *           \"Authorization: Bearer ...\""
 *
 * Der Weg konnte also NIE etwas hochladen. Und die frühere Fassung dieser
 * Datei hat den Fehler nicht nur übersehen, sie hat ihn VERLANGT:
 *
 *   expect(calls[0]?.headers?.Authorization).toMatch(/^Basic /);
 *
 * Ein Test, der die falsche Sache festschreibt, ist schlimmer als keiner: er
 * macht die Reparatur zum Testbruch. Genau diese Falle steht schon zweimal im
 * Gedächtnis dieses Hauses.
 *
 * ── WARUM DIESER MITSPIELER SO STRENG IST ──────────────────────────────────
 * Der frühere Mitspieler gab auf JEDE Anfrage dieselbe Antwort, egal welche
 * Adresse und egal welche Ausweisung. Gegen so einen ist Basic-Auth genauso
 * grün wie ein Token. Der hiesige Mitspieler verhält sich wie der echte
 * Dienst: er kennt `/auth`, gibt dort ein Token aus, und verlangt danach
 * GENAU dieses Token. Ein roher Schlüssel bekommt dieselbe 401 mit demselben
 * Wortlaut wie beim Anbieter.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  type FiskalyConfig,
  type FiskalyFetch,
  _tokenSpeicherLeeren,
  isFiskalyConfigured,
  isFiskalyError,
  pushCashPointClosing,
  triggerExport,
} from '../../src/lib/fiskaly-dsfinvk.js';

const CONFIGURED: FiskalyConfig = { apiKey: 'key', apiSecret: 'secret' };

/** Der Wortlaut, mit dem das echte fiskaly Basic-Auth abweist. */
const FISKALY_401 = 'Authorization header must follow the format "Authorization: Bearer ..."';

interface Aufruf {
  url: string;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
}

/**
 * Ein Mitspieler, der sich wie fiskaly benimmt.
 *
 * `antwort` ist die Nutzlast für die FACHLICHE Adresse; `/auth` bedient der
 * Mitspieler selbst.
 */
function fiskalyMitspieler(
  antwort: unknown,
  status = 200,
): { fetchImpl: FiskalyFetch; calls: Aufruf[] } {
  const calls: Aufruf[] = [];
  let ausgegebenesToken: string | null = null;

  const fetchImpl: FiskalyFetch = (url, init) => {
    calls.push({ url, headers: init?.headers, body: init?.body });

    if (url.endsWith('/auth')) {
      const gesendet = JSON.parse(init?.body ?? '{}') as {
        api_key?: string;
        api_secret?: string;
      };
      if (gesendet.api_key !== CONFIGURED.apiKey || gesendet.api_secret !== CONFIGURED.apiSecret) {
        return Promise.resolve(
          new Response(JSON.stringify({ message: 'invalid credentials' }), { status: 401 }),
        );
      }
      ausgegebenesToken = `tok_${gesendet.api_key}`;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: ausgegebenesToken, expires_in: 3600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }

    // Jede fachliche Adresse verlangt GENAU das ausgegebene Token.
    const auth = init?.headers?.Authorization ?? '';
    if (!auth.startsWith('Bearer ')) {
      return Promise.resolve(
        new Response(JSON.stringify({ status_code: 401, message: FISKALY_401 }), { status: 401 }),
      );
    }
    if (auth.slice('Bearer '.length) !== ausgegebenesToken) {
      return Promise.resolve(
        new Response(JSON.stringify({ status_code: 401, message: 'could not parse jwt' }), {
          status: 401,
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(antwort), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetchImpl, calls };
}

beforeEach(() => {
  _tokenSpeicherLeeren();
});

describe('isFiskalyConfigured', () => {
  it('verlangt Schluessel UND Geheimnis', () => {
    expect(isFiskalyConfigured(CONFIGURED)).toBe(true);
    expect(isFiskalyConfigured({ apiKey: '', apiSecret: 's' })).toBe(false);
    expect(isFiskalyConfigured({ apiKey: 'k', apiSecret: '' })).toBe(false);
  });
});

describe('ohne Zugang wird gar nicht erst gefragt', () => {
  it('pushCashPointClosing schweigt und meldet ehrlich', async () => {
    const { fetchImpl, calls } = fiskalyMitspieler({});
    const result = await pushCashPointClosing(
      { apiKey: '', apiSecret: '' },
      'cpc_1',
      { business_day: '2026-05-29' },
      { fetchImpl },
    );
    expect(result).toEqual({ error: 'fiskaly not configured' });
    expect(calls.length).toBe(0);
  });

  it('triggerExport ebenso', async () => {
    const { fetchImpl, calls } = fiskalyMitspieler({});
    const result = await triggerExport({ apiKey: '', apiSecret: '' }, 'cpc_1', { fetchImpl });
    expect(result).toEqual({ error: 'fiskaly not configured' });
    expect(calls.length).toBe(0);
  });
});

describe('der Schluessel wird gegen ein Token getauscht', () => {
  it('tauscht ZUERST und schickt danach ein Bearer-Token', async () => {
    const { fetchImpl, calls } = fiskalyMitspieler({ _id: 'cpc_123' });
    const result = await pushCashPointClosing(
      CONFIGURED,
      'cpc_1',
      { business_day: '2026-05-29' },
      { fetchImpl },
    );

    expect(result).toEqual({ exportId: 'cpc_123' });
    expect(calls[0]?.url).toContain('/auth');
    expect(calls[1]?.url).toContain('/cash_point_closings');
    expect(calls[1]?.headers?.Authorization).toBe('Bearer tok_key');
  });

  it('schickt NIEMALS den rohen Schluessel als Ausweisung', async () => {
    // Dies ist der Waechter. Faellt jemand auf Basic-Auth zurueck, antwortet
    // der Mitspieler mit derselben 401 wie das echte fiskaly, und dieser Test
    // wird rot statt gruen.
    const { fetchImpl, calls } = fiskalyMitspieler({ _id: 'cpc_123' });
    await pushCashPointClosing(CONFIGURED, 'cpc_1', {}, { fetchImpl });
    for (const c of calls) {
      const auth = c.headers?.Authorization ?? '';
      expect(auth.startsWith('Basic ')).toBe(false);
      expect(auth).not.toContain(CONFIGURED.apiSecret);
    }
  });

  it('triggerExport geht denselben Weg und meldet den ZUSTAND, nicht eine Adresse', async () => {
    // Ein angestossener Auszug ist nicht fertig. Die alte Fassung las
    // `download_url` aus einer Antwort, die dieses Feld nie trug.
    const { fetchImpl, calls } = fiskalyMitspieler({ state: 'PENDING', _id: 'exp_1' });
    const result = await triggerExport(CONFIGURED, 'exp_1', { fetchImpl });
    expect(result).toEqual({ exportId: 'exp_1', state: 'PENDING' });
    expect(calls[0]?.url).toContain('/auth');
    expect(calls[1]?.url).toMatch(/\/exports\/exp_1$/);
    expect(calls[1]?.headers?.Authorization).toBe('Bearer tok_key');
  });

  it('tauscht beim ZWEITEN Aufruf nicht erneut', async () => {
    // Je Tagesabschluss zweimal anzumelden ist nicht falsch, aber es
    // verdoppelt die Angriffsflaeche und die Wartezeit ohne Nutzen.
    const { fetchImpl, calls } = fiskalyMitspieler({ _id: 'cpc_1' });
    await pushCashPointClosing(CONFIGURED, 'cpc_1', {}, { fetchImpl });
    await pushCashPointClosing(CONFIGURED, 'cpc_1', {}, { fetchImpl });
    expect(calls.filter((c) => c.url.endsWith('/auth')).length).toBe(1);
  });
});

describe('nichts wirft, egal was schiefgeht', () => {
  it('gescheiterte Anmeldung wird zu { error }', async () => {
    const fetchImpl: FiskalyFetch = (url) =>
      Promise.resolve(
        url.endsWith('/auth')
          ? new Response(JSON.stringify({ message: 'nope' }), { status: 401 })
          : new Response('{}', { status: 200 }),
      );
    const result = await pushCashPointClosing(CONFIGURED, 'cpc_1', {}, { fetchImpl });
    expect(isFiskalyError(result)).toBe(true);
    expect((result as { error: string }).error).toContain('auth');
  });

  it('eine 500 der Fachadresse wird zu { error }', async () => {
    const { fetchImpl } = fiskalyMitspieler({}, 500);
    const result = await pushCashPointClosing(CONFIGURED, 'cpc_1', {}, { fetchImpl });
    expect(isFiskalyError(result)).toBe(true);
  });

  it('ein Netzfehler wird zu { error }', async () => {
    const fetchImpl: FiskalyFetch = () => Promise.reject(new Error('ECONNREFUSED'));
    const result = await pushCashPointClosing(CONFIGURED, 'cpc_1', {}, { fetchImpl });
    expect(isFiskalyError(result)).toBe(true);
    expect((result as { error: string }).error).toContain('unreachable');
  });
});
