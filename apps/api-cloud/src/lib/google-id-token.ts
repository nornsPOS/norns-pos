/**
 * google-id-token — ECHTE Signaturprüfung eines Google-id_token.
 *
 * WARUM DIESE DATEI ÜBERHAUPT ENTSTEHT (24.07.2026)
 * Die bisherigen Google-Wege (Inhaber wie Shop) holen den Token SELBST bei
 * Google ab, über TLS, mit Client-Secret und PKCE. Dort genügt das blosse
 * Auslesen der Claims: der Transportweg IST der Beweis. Beim NATIVEN
 * Anmelden ist das Gegenteil wahr — der Token kommt aus einer App, also von
 * einem Gerät, das jeder kontrollieren kann. Wer hier nur die Claims liest,
 * lässt sich mit einer selbst gebauten Zeichenkette jede beliebige Identität
 * unterschieben. Darum wird hier die SIGNATUR gegen Googles öffentliche
 * Schlüssel geprüft, bevor irgendeine Sitzung entsteht.
 *
 * WAS GEPRÜFT WIRD (alle Punkte sind notwendig, keiner ist Zierde)
 *   • Signatur (RS256) gegen den passenden Schlüssel aus Googles JWKS.
 *   • `iss` ist Google.
 *   • `aud` steht in der Liste der EIGENEN Client-IDs (Web UND Android):
 *     sonst nimmt ein Angreifer einen echten Google-Token, den er für seine
 *     eigene App erhalten hat, und meldet sich damit bei uns an.
 *   • `exp` (mit kleiner Uhr-Toleranz) und `email_verified`.
 *
 * Ohne neue Abhängigkeit: Node bringt `crypto.createPublicKey` (JWK) und
 * `crypto.verify` mit. Der JWKS wird im Speicher gehalten und erst bei einer
 * unbekannten Schlüsselkennung neu geholt (Google rotiert die Schlüssel),
 * höchstens aber einmal pro Minute — ein unbekanntes `kid` darf kein Hebel
 * sein, um uns gegen Google zu fluten.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/** Googles JWKS-Endpunkt (die öffentlichen Schlüssel zu den id_token). */
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

/** Gültige Aussteller eines Google-id_token. */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Uhr-Toleranz: Geräteuhren gehen vor und nach. */
const CLOCK_SKEW_SEC = 120;

/** Frühestens nach dieser Zeit wird der JWKS erneut geholt. */
const JWKS_MIN_REFETCH_MS = 60_000;

interface JwkKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

let jwksCache: { keys: JwkKey[]; fetchedAt: number } | null = null;
let jwksInFlight: Promise<JwkKey[]> | null = null;

/** Den JWKS holen (mit Zusammenlegung paralleler Anfragen). */
async function fetchJwks(): Promise<JwkKey[]> {
  if (jwksInFlight) return jwksInFlight;
  jwksInFlight = (async () => {
    try {
      const res = await fetch(GOOGLE_JWKS_URL, { method: 'GET' });
      if (!res.ok) throw new Error(`JWKS ${res.status}`);
      const body = (await res.json()) as { keys?: JwkKey[] };
      const keys = Array.isArray(body.keys) ? body.keys : [];
      if (keys.length > 0) jwksCache = { keys, fetchedAt: Date.now() };
      return keys;
    } finally {
      jwksInFlight = null;
    }
  })();
  return jwksInFlight;
}

/**
 * Den Schlüssel zur Kennung finden. Ist er unbekannt, EINMAL neu holen
 * (Rotation), aber nicht öfter als der Mindestabstand erlaubt.
 */
async function keyForKid(kid: string): Promise<JwkKey | null> {
  const hit = jwksCache?.keys.find((k) => k.kid === kid);
  if (hit) return hit;
  const stale = !jwksCache || Date.now() - jwksCache.fetchedAt > JWKS_MIN_REFETCH_MS;
  if (!stale) return null;
  const keys = await fetchJwks();
  return keys.find((k) => k.kid === kid) ?? null;
}

/** Ein JOSE-Segment (base64url) als Buffer. */
function seg(part: string): Buffer {
  return Buffer.from(part, 'base64url');
}

/** Die geprüften Angaben, die eine Anmeldung tragen darf. */
export interface VerifiedGoogleIdentity {
  /** Googles stabile Kennung der Person — der Anker, nie die E-Mail. */
  sub: string;
  /** Die bestätigte E-Mail (kleingeschrieben). */
  email: string;
  /** Anzeigename, falls das Profil ihn hergibt. */
  name: string | null;
  /** Bildadresse, falls vorhanden. */
  picture: string | null;
  /** Die Client-ID, für die der Token ausgestellt wurde (Protokoll/Diagnose). */
  audience: string;
}

export type GoogleIdTokenError =
  | 'MALFORMED' // keine drei Segmente / kein JSON
  | 'UNSUPPORTED_ALG' // etwas anderes als RS256
  | 'UNKNOWN_KEY' // kid gehört zu keinem Google-Schlüssel
  | 'BAD_SIGNATURE' // Signatur passt nicht
  | 'BAD_ISSUER'
  | 'BAD_AUDIENCE' // nicht FÜR UNS ausgestellt
  | 'EXPIRED'
  | 'EMAIL_UNVERIFIED'
  | 'NO_SUBJECT';

export type GoogleIdTokenResult =
  | { ok: true; identity: VerifiedGoogleIdentity }
  | { ok: false; error: GoogleIdTokenError };

/**
 * Einen Google-id_token vollständig prüfen.
 *
 * @param idToken   die rohe Zeichenkette aus der App
 * @param audiences alle EIGENEN Client-IDs, für die ein Token gelten darf
 *                  (Web + Android; leere Einträge werden ignoriert)
 */
export async function verifyGoogleIdToken(
  idToken: string,
  audiences: readonly string[],
): Promise<GoogleIdTokenResult> {
  const allowed = audiences.map((a) => a.trim()).filter((a) => a.length > 0);
  // Ohne konfigurierte Client-ID gäbe es nichts, wogegen geprüft werden könnte:
  // dann NIE durchwinken, sondern ehrlich ablehnen.
  if (allowed.length === 0) return { ok: false, error: 'BAD_AUDIENCE' };

  const parts = String(idToken ?? '').split('.');
  if (parts.length !== 3) return { ok: false, error: 'MALFORMED' };
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(seg(h).toString('utf8')) as { alg?: string; kid?: string };
    claims = JSON.parse(seg(p).toString('utf8')) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'MALFORMED' };
  }

  // Nur RS256. „alg: none" und HMAC-Varianten sind die klassischen Umgehungen.
  if (header.alg !== 'RS256') return { ok: false, error: 'UNSUPPORTED_ALG' };
  if (!header.kid) return { ok: false, error: 'UNKNOWN_KEY' };

  const jwk = await keyForKid(header.kid);
  if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return { ok: false, error: 'UNKNOWN_KEY' };

  let signatureOk = false;
  try {
    const key = createPublicKey({ key: jwk as never, format: 'jwk' });
    signatureOk = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`, 'utf8'),
      key,
      seg(s),
    );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, error: 'BAD_SIGNATURE' };

  // Ab hier ist der Inhalt echt von Google. Jetzt: gilt er FÜR UNS, JETZT?
  if (!GOOGLE_ISSUERS.has(String(claims.iss ?? ''))) return { ok: false, error: 'BAD_ISSUER' };
  if (!allowed.includes(String(claims.aud ?? ''))) return { ok: false, error: 'BAD_AUDIENCE' };

  const exp = typeof claims.exp === 'number' ? claims.exp : 0;
  if (exp * 1000 < Date.now() - CLOCK_SKEW_SEC * 1000) return { ok: false, error: 'EXPIRED' };

  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const email = String(claims.email ?? '').trim().toLowerCase();
  if (!email || !emailVerified) return { ok: false, error: 'EMAIL_UNVERIFIED' };

  const sub = String(claims.sub ?? '').trim();
  if (!sub) return { ok: false, error: 'NO_SUBJECT' };

  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : null;
  const picture =
    typeof claims.picture === 'string' && claims.picture.trim() ? claims.picture.trim() : null;

  return {
    ok: true,
    identity: { sub, email, name, picture, audience: String(claims.aud) },
  };
}
