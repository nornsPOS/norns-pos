/**
 * Bearer-token auth fallback (durable login on Windows WebView2, where the
 * cross-site SameSite=None;Secure session cookie is dropped). The client must
 * attach `Authorization: Bearer <token>` from `getAuthToken()` on every
 * request — unless the caller set its own Authorization header.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../src/client.js';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'rid-1' },
  });
}

function lastFetchHeaders(spy: ReturnType<typeof vi.fn>): Record<string, string> {
  const call = spy.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  return (call[1] as RequestInit).headers as Record<string, string>;
}

describe('createApiClient — Bearer auth fallback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('attaches Authorization: Bearer <token> when getAuthToken returns one', async () => {
    const fetchSpy = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createApiClient({
      baseUrl: 'http://localhost:3001',
      getAuthToken: () => 'tok-abc-123',
    });
    await client.request('GET', '/api/test');
    expect(lastFetchHeaders(fetchSpy).Authorization).toBe('Bearer tok-abc-123');
  });

  it('sends NO Authorization header when getAuthToken returns null', async () => {
    const fetchSpy = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createApiClient({ baseUrl: 'http://localhost:3001', getAuthToken: () => null });
    await client.request('GET', '/api/test');
    expect(lastFetchHeaders(fetchSpy).Authorization).toBeUndefined();
  });

  it('⛔ der LEBENDE Schlüssel gewinnt gegen einen mitgebrachten', async () => {
    /*
     * ── DIESER SATZ STAND FRÜHER AUF DEM KOPF ───────────────────────────
     *
     * Er hiess „does not override a caller-supplied Authorization header"
     * und verlangte, dass ein mitgebrachter Kopf gewinnt. Genau EIN Aufrufer
     * brachte je einen mit: der Abspieler des Ausgangskorbs, mit dem
     * Schlüssel, der GESTERN in die Zeile versiegelt wurde. Der tote
     * Schlüssel gewann damit gegen den lebenden, die Windows-Kasse bekam
     * 401, und weil die Reihenfolge im Korb streng ist, stand alles dahinter.
     *
     * Der Satz pinnte also den Defekt fest, den 9c89833 behoben hat —
     * Hausklasse „Prüfstand macht denselben Fehler". Gemessen, bevor er
     * umgedreht wurde: KEIN Aufrufer des api-client setzt `Authorization`
     * selbst (die Treffer im `worker` gehen über `httpFetch` an fiskaly,
     * nicht über diesen Klienten).
     */
    const fetchSpy = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createApiClient({
      baseUrl: 'http://localhost:3001',
      getAuthToken: () => 'tok-abc-123',
    });
    await client.request('GET', '/api/test', undefined, {
      headers: { Authorization: 'Bearer TOTER-SCHLUESSEL-VON-GESTERN' },
    });
    expect(
      lastFetchHeaders(fetchSpy).Authorization,
      'ein versiegelter Schlüssel von gestern ging über die Leitung',
    ).toBe('Bearer tok-abc-123');
  });

  it('⛔ ohne Sitzung geht GAR KEIN mitgebrachter Schlüssel hinaus', async () => {
    // Der zweite Riegel derselben Ampel: ist keine Sitzung da, darf der
    // versiegelte Kopf nicht als Rückfall einspringen. Ein ehrlicher 401 ist
    // besser als eine Anfrage, die mit einem toten Schlüssel durchgeht.
    const fetchSpy = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createApiClient({ baseUrl: 'http://localhost:3001', getAuthToken: () => null });
    await client.request('GET', '/api/test', undefined, {
      headers: { Authorization: 'Bearer TOTER-SCHLUESSEL-VON-GESTERN' },
    });
    expect(lastFetchHeaders(fetchSpy).Authorization).toBeUndefined();
  });

  it('re-evaluates the token each request (reflects login/logout)', async () => {
    const fetchSpy = vi.fn(async () => okJson({ ok: true }));
    vi.stubGlobal('fetch', fetchSpy);
    let token: string | null = null;
    const client = createApiClient({ baseUrl: 'http://localhost:3001', getAuthToken: () => token });
    await client.request('GET', '/api/a');
    expect(lastFetchHeaders(fetchSpy).Authorization).toBeUndefined();
    token = 'after-login';
    await client.request('GET', '/api/b');
    expect(lastFetchHeaders(fetchSpy).Authorization).toBe('Bearer after-login');
  });
});
