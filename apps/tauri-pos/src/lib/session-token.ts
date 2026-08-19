/**
 * Session bearer-token store for the Tauri webview.
 *
 * Why this exists: the cloud session is a `SameSite=None; Secure; HttpOnly`
 * cookie. That works on macOS (the webview origin `tauri://localhost` is a
 * secure context) but on Windows WebView2 the origin is the NON-secure
 * `http://tauri.localhost`, where a cross-site `Secure; SameSite=None` cookie
 * is dropped (third-party-cookie policy). So the POS ALSO carries the session
 * token as an `Authorization: Bearer` header, which is immune to cookie
 * policy. The api-client reads this via `getAuthToken()` on every request, and
 * the SSE stream passes it as an `access_token` query param.
 *
 * The token mirrors the cookie value (same `sessions.token`) and is persisted
 * to localStorage so the session survives an app restart, matching the
 * cookie's lifetime.
 *
 * SECURITY (go-live TODO): move this to the Tauri OS keychain (as the Fiskaly
 * keys were) so an XSS cannot read it. Acceptable for now under the strict
 * webview CSP (no third-party script execution) + test mode.
 */

const KEY = 'w14.session-token';

let cached: string | null | undefined;

/** A change listener: receives the NEW token value (null on sign-out). */
type TokenListener = (token: string | null) => void;
const listeners = new Set<TokenListener>();

/**
 * Subscribe to token changes — login, mid-shift RENEWAL, and sign-out all flow
 * through here. Returns an unsubscribe.
 * A listener that throws can never break the token write or sibling listeners.
 */
export function onSessionTokenChange(fn: TokenListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The current session token, or null when signed out. */
export function getSessionToken(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Persist (or clear, when null) the session token. Notifies listeners on change. */
export function setSessionToken(token: string | null): void {
  // Normalise the prior value (undefined = never read) so the first set fires.
  const prev = cached === undefined ? null : cached;
  cached = token;
  try {
    if (typeof localStorage !== 'undefined') {
      if (token) localStorage.setItem(KEY, token);
      else localStorage.removeItem(KEY);
    }
  } catch {
    /* localStorage unavailable — the in-memory cache still serves this run */
  }
  if (prev !== token) {
    for (const fn of listeners) {
      try {
        fn(token);
      } catch {
        /* a listener must NEVER break the token write or the other listeners */
      }
    }
  }
}

/** Clear the session token (sign-out cascade). */
export function clearSessionToken(): void {
  setSessionToken(null);
}
