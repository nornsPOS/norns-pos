/**
 * Single source of truth for "which URL prefixes skip authentication".
 *
 * Used by both plugins/auth.ts (better-auth + actor preHandler) and
 * plugins/mtls.ts (device-cert preHandler). Adding a new public route
 * was a two-place edit pre-audit; this module collapses it to one.
 *
 * **Adding a new public path:** edit `PUBLIC_PREFIXES` here. Both plugins
 * pick it up automatically. Tests for the change live in
 * `tests/auth-public-routes.test.ts` (Phase 1.5 backlog #I-2 if missing).
 */

export const PUBLIC_PREFIXES = [
  '/health',
  '/metrics',
  '/docs',
  '/openapi.json',
  // better-auth mounts its own session endpoints under /api/auth/*
  '/api/auth/',
  // Webhooks sind unauthentifizierte Rueckrufe (heute: der Kartenleser-Webhook
  // /api/webhooks/stripe, HMAC-gesichert in der Route selbst). Sie muessen am
  // Sitzungs-preHandler UND am mTLS-preHandler vorbei (kein Geraetezertifikat
  // im Spiel). Die Bahn '/api/storefront/' stand hier bis zum 14.08.2026 und
  // fiel mit der Trennung von warehouse14.
  '/api/webhooks/',
  // Phase 1 — staff/owner Sign-in-with-Google. Only the OAuth start + callback
  // live under this prefix; both must run unauthenticated and WITHOUT the mTLS
  // device gate (the browser round-trip carries no session and no device cert).
  // The callback's own users-table lookup is the authorisation gate. No other
  // /api/admin/* route sits under this prefix, so nothing else is exposed.
  '/api/admin/auth/google/',
  // ⚠️ NUR die beiden Rueckwege der Stripe-Einrichtung. Stripe schickt den
  // Haendler dorthin, und der bringt weder Sitzung noch Geraetezertifikat mit.
  //
  // Sie sind AUSDRUECKLICH einzeln aufgezaehlt, nicht als Praefix
  // `/api/stripe/connect/` — sonst laegen `account`, `onboarding` und `status`
  // gleich mit offen, und die legen Konten an. Der Schutz von `refresh` ist ein
  // signiertes, an EINE Kontokennung gebundenes Zeichen; `fertig` zeigt nur Text.
  '/api/stripe/connect/refresh',
  '/api/stripe/connect/fertig',
] as const;

/**
 * Exceptions under a public prefix that nevertheless require `req.actor`
 * to be populated. Audit-driven catch (memory.md #76): the old prefix-only
 * match silently denied auth on step-up + sign-out + session probe even
 * though their handlers called `requireAuth(req)`.
 *
 * To add a new authenticated route under `/api/auth/*`, append its exact
 * path here. better-auth's `/api/auth/sign-in`, `/api/auth/sign-up`,
 * `/api/auth/forget-password` etc. stay public.
 */
/**
 * Public paths that carry a dynamic id segment and therefore can't be matched
 * by `PUBLIC_PREFIXES` (a prefix `/api/photos/` would also expose the gated
 * upload + usage routes). These two serve LOCAL product-photo bytes via an
 * `<img src>` tag, which cannot send an `Authorization: Bearer` header and
 * whose cross-site session cookie is dropped by Windows WebView2 — so the
 * request always arrives unauthenticated. The id (an unguessable UUID) is the
 * capability. The handler still 404s anything that isn't a `storage_kind='local'`
 * product photo. KYC/Ausweis evidence lives in the separate `kyc_documents`
 * table + a separate KYC_PHOTOS_DIR (AES-256-GCM-encrypted at rest, served ONLY
 * via the private ADMIN + step-up route GET /api/customers/:id/kyc-documents/
 * :docId/image — NEVER public, never here), so these routes cannot leak PII.
 *
 * Matched against the path (querystring already stripped) by `isPublicRoute`.
 */
export const PUBLIC_PATH_PATTERNS: readonly RegExp[] = [
  /^\/api\/photos\/[^/]+\/raw$/,
  /^\/api\/photos\/[^/]+\/thumb$/,
  // iCalendar feed (CONTRACT 3): calendar subscription clients (Google/Apple/
  // Outlook) can send neither a session cookie nor an mTLS client cert. The
  // 64-hex CSPRNG token in the querystring IS the capability — the handler
  // constant-time-compares it against system_settings and 401s otherwise
  // (routes/appointments.ts). No PII beyond shortened contact names is emitted.
  /^\/api\/appointments\/feed\.ics$/,
  // Google Calendar events.watch push callback: Google POSTs here with no
  // session cookie / device cert. The capability is the X-Goog-Channel-Token
  // header (constant-compared in routes/calendar.ts); an invalid token is a
  // silent 200 no-op. Body is empty — no PII is involved.
  /^\/api\/calendar\/notifications$/,
];

export const AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX: ReadonlySet<string> = new Set([
  '/api/auth/session',
  '/api/auth/sign-out',
  // sign-out-all (security review 2026-07-21) reads req.actor + req.session to
  // revoke every session of the current user; like sign-out it MUST be pulled
  // back out of the public prefix so the auth preHandler populates them —
  // otherwise it fails closed with "No active session".
  '/api/auth/sign-out-all',
  '/api/auth/step-up',
  // Die Bestätigung mit dem Gerätecode (23.07.2026). Sie ruft requireAuth, also
  // MUSS sie aus dem öffentlichen Vorsatz herausgezogen werden — sonst wäre
  // req.actor nie gefüllt und der Weg antwortete für immer mit 401. Genau das
  // hat der Wächter in tests/auth-public-routes.test.ts hier abgefangen,
  // eine Stunde bevor es jemandem am Tresen aufgefallen wäre.
  '/api/auth/step-up/device',
  // PIN login needs the mTLS preHandler to populate req.deviceId so it can
  // resolve which user is paired with this terminal. The route itself does
  // not call requireAuth (the actor doesn't exist yet) but it does require
  // the device fingerprint to be loaded.
  '/api/auth/pin-login',
  // Both PIN-setting routes call requireAuth(req) in their handlers, so without
  // an entry here the preHandler skipped them, req.actor was never populated and
  // requireAuth always threw: the routes failed CLOSED and were unusable. That is
  // catch #76 all over again — it silently cost staff the ability to change their
  // POS PIN at all, and to set or rotate the DURESS PIN, which is the safety
  // control for an armed robbery. Fails-closed is not a hole, but a safety
  // control nobody can arm is its own emergency. Guarded by
  // tests/auth-public-routes.test.ts so a third one cannot slip in.
  '/api/auth/pin/set',
  '/api/auth/duress-pin/set',
]);

/**
 * Returns true when the path (URL minus querystring) is exempt from the
 * staff-auth + mTLS preHandlers.
 *
 * `/` (root) is treated as public so health-check probes land cleanly.
 * A path that matches a public prefix is still treated as authenticated
 * when it appears in `AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX`.
 */
export function isPublicRoute(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (path === '/' || path === '') return true;
  if (AUTHENTICATED_PATHS_UNDER_PUBLIC_PREFIX.has(path)) return false;
  if (PUBLIC_PATH_PATTERNS.some((re) => re.test(path))) return true;
  return PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p));
}
