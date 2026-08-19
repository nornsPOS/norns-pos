/**
 * Die Signaturprüfung ist der ganze Schutz des nativen Anmeldewegs: der Token
 * kommt aus einer App, also von einem fremden Gerät. Wer hier durchkommt, ist
 * angemeldet. Diese Tests bauen darum ECHTE Token mit einem EIGENEN
 * RSA-Schlüssel, hängen den passenden öffentlichen Schlüssel in den JWKS-Cache
 * (über einen abgefangenen `fetch`) und prüfen, was durchgeht und was nicht.
 */
import { generateKeyPairSync, createSign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyGoogleIdToken } from '../../src/lib/google-id-token.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'test-key-1';
const OUR_ANDROID = '981358618745-android.apps.googleusercontent.com';
const OUR_WEB = '981358618745-web.apps.googleusercontent.com';

/** Den öffentlichen Schlüssel als JWK, wie Google ihn ausliefert. */
function jwks(): { keys: unknown[] } {
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { keys: [{ ...jwk, kid: KID, alg: 'RS256', use: 'sig' }] };
}

function b64(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url');
}

/** Einen echten, signierten Token bauen (mit unserem Testschlüssel). */
function makeToken(
  claims: Record<string, unknown>,
  opts: { kid?: string; alg?: string; sign?: boolean } = {},
): string {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? KID, typ: 'JWT' };
  const head = b64(header);
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: OUR_ANDROID,
    sub: '1234567890',
    email: 'chef@warehouse14.de',
    email_verified: true,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  if (opts.sign === false) return `${head}.${body}.${'A'.repeat(342)}`;
  const s = createSign('RSA-SHA256');
  s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign(privateKey).toString('base64url')}`;
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(jwks()), { status: 200 })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyGoogleIdToken — was durchgehen DARF', () => {
  it('nimmt einen echten Token für unsere Android-Kennung an', async () => {
    const r = await verifyGoogleIdToken(makeToken({}), [OUR_ANDROID, OUR_WEB]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.identity.email).toBe('chef@warehouse14.de');
      expect(r.identity.sub).toBe('1234567890');
    }
  });

  it('nimmt auch die Web-Kennung als Empfänger an', async () => {
    const r = await verifyGoogleIdToken(makeToken({ aud: OUR_WEB }), [OUR_ANDROID, OUR_WEB]);
    expect(r.ok).toBe(true);
  });

  it('schreibt die E-Mail klein (ein Konto, nicht zwei)', async () => {
    const r = await verifyGoogleIdToken(makeToken({ email: 'Chef@Warehouse14.DE' }), [OUR_ANDROID]);
    expect(r.ok && r.identity.email).toBe('chef@warehouse14.de');
  });
});

describe('verifyGoogleIdToken — was NIE durchgehen darf', () => {
  it('weist eine gefälschte Signatur ab', async () => {
    const r = await verifyGoogleIdToken(makeToken({}, { sign: false }), [OUR_ANDROID]);
    expect(r).toEqual({ ok: false, error: 'BAD_SIGNATURE' });
  });

  it('weist einen manipulierten Rumpf ab (Signatur passt dann nicht mehr)', async () => {
    const good = makeToken({});
    const [h, , s] = good.split('.') as [string, string, string];
    const tampered = `${h}.${b64({
      iss: 'https://accounts.google.com',
      aud: OUR_ANDROID,
      sub: 'angreifer',
      email: 'chef@warehouse14.de',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.${s}`;
    const r = await verifyGoogleIdToken(tampered, [OUR_ANDROID]);
    expect(r).toEqual({ ok: false, error: 'BAD_SIGNATURE' });
  });

  it('weist „alg: none" ab (der klassische Umgehungsversuch)', async () => {
    const r = await verifyGoogleIdToken(makeToken({}, { alg: 'none', sign: false }), [OUR_ANDROID]);
    expect(r).toEqual({ ok: false, error: 'UNSUPPORTED_ALG' });
  });

  it('weist einen Token für eine FREMDE App ab', async () => {
    // Echt von Google, echt signiert — aber für die App eines anderen
    // ausgestellt. Ohne diese Prüfung meldet sich damit jeder bei uns an.
    const r = await verifyGoogleIdToken(makeToken({ aud: 'fremde-app.apps.googleusercontent.com' }), [
      OUR_ANDROID,
      OUR_WEB,
    ]);
    expect(r).toEqual({ ok: false, error: 'BAD_AUDIENCE' });
  });

  it('weist einen fremden Aussteller ab', async () => {
    const r = await verifyGoogleIdToken(makeToken({ iss: 'https://evil.example' }), [OUR_ANDROID]);
    expect(r).toEqual({ ok: false, error: 'BAD_ISSUER' });
  });

  it('weist einen abgelaufenen Token ab', async () => {
    const r = await verifyGoogleIdToken(
      makeToken({ exp: Math.floor(Date.now() / 1000) - 3600 }),
      [OUR_ANDROID],
    );
    expect(r).toEqual({ ok: false, error: 'EXPIRED' });
  });

  it('weist eine unbestätigte E-Mail ab', async () => {
    const r = await verifyGoogleIdToken(makeToken({ email_verified: false }), [OUR_ANDROID]);
    expect(r).toEqual({ ok: false, error: 'EMAIL_UNVERIFIED' });
  });

  it('weist einen unbekannten Schlüssel ab', async () => {
    const r = await verifyGoogleIdToken(makeToken({}, { kid: 'fremder-schluessel' }), [OUR_ANDROID]);
    expect(r).toEqual({ ok: false, error: 'UNKNOWN_KEY' });
  });

  it('weist Unsinn ab', async () => {
    expect(await verifyGoogleIdToken('kein.jwt', [OUR_ANDROID])).toEqual({
      ok: false,
      error: 'MALFORMED',
    });
  });

  it('lässt OHNE konfigurierte Kennung NICHTS durch (kein stilles Durchwinken)', async () => {
    const r = await verifyGoogleIdToken(makeToken({}), ['', '   ']);
    expect(r).toEqual({ ok: false, error: 'BAD_AUDIENCE' });
  });
});
