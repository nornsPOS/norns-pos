/**
 * PIN-auth domain client. Mirrors the actual `apps/api-cloud/src/routes/
 * auth-pin.ts` and `auth-session.ts` wire shapes.
 *
 * Corrected 2026-05-26 (memory.md #76): the prior version used the wrong
 * paths (`/api/auth/pin/login`) and body (`{ email, pin }`). The real
 * server uses `POST /api/auth/pin-login` with `{ pin }` only — mTLS
 * resolves the user via the device cert.
 */

import type { ApiClient } from '../client.js';
import { AuthFlowCoordinator } from '../internal/auth-flow.js';

export type ActorRole = 'ADMIN' | 'CASHIER' | 'READONLY';

export interface SessionActor {
  id: string;
  role: ActorRole;
  isOwner: boolean;
}

/**
 * Human-facing profile of the signed-in operator — kept OUT of `SessionActor`
 * (which is deliberately PII-free) and carried alongside it so the shell can
 * show who is logged in. For a Google sign-in this is the verified Google
 * identity; a PIN session carries the email only.
 */
export interface AuthProfile {
  /** The verified account email. */
  email: string;
  /** Google display name; null for a PIN session (no Google identity). */
  displayName: string | null;
  /** Google profile-picture URL; null when unavailable. */
  avatarUrl: string | null;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/auth/pin-login
// ────────────────────────────────────────────────────────────────────────

export interface PinLoginRequest {
  /** Der Kassencode, genau sechs Ziffern (18.08.2026; die Anmeldung duldet aeltere laengere). */
  pin: string;
  /**
   * WER sich anmeldet.
   *
   * ⚠️ 02.08.2026: Ohne dieses Feld loeste der Server den Menschen allein
   * ueber `devices.paired_by_user_id` auf — ein Geraet, ein Mensch, fuer
   * immer. Jeder angelegte Mitarbeiter konnte sich strukturell nie anmelden,
   * und jede fiskalische Zeile trug denselben Menschen.
   *
   * Fehlt es, bleibt es beim gepaarten Menschen: das ganze bisherige
   * Verhalten.
   */
  userId?: string;
}

/** Ein Mensch, den die Anmeldemaske zur Wahl stellen kann. */
export interface AnmeldbarePerson {
  id: string;
  name: string;
  role: ActorRole;
  isOwner: boolean;
  /**
   * Ohne Code fuehrt die Wahl zum EINRICHTEN, nicht zur Zifferntastatur.
   * Der Hash selbst verlaesst den Server nie.
   */
  hatCode: boolean;
}

export interface PinLoginResponse {
  ok: true;
  sessionExpiresAt: string;
  actor: SessionActor;
  /** Who signed in (Google identity or the staff email). Optional for back-compat. */
  profile?: AuthProfile;
  /**
   * The session token (same value as the `warehouse14.session` cookie). The
   * POS stores this and sends it as `Authorization: Bearer` so auth survives
   * on Windows WebView2, where the cross-site session cookie is dropped.
   */
  token: string;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/auth/step-up
// ────────────────────────────────────────────────────────────────────────

export interface PinStepUpRequest {
  pin: string;
}

export interface PinStepUpResponse {
  ok: true;
  lastPinStepUpAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// GET /api/auth/session
// ────────────────────────────────────────────────────────────────────────

export interface AuthSessionResponse {
  ok: true;
  actor: SessionActor;
  /** Who is signed in. Optional for back-compat with older servers. */
  profile?: AuthProfile;
  lastPinStepUpAt: string | null;
  expiresAt: string;
}

// ────────────────────────────────────────────────────────────────────────
// POST /api/auth/sign-out
// ────────────────────────────────────────────────────────────────────────

export interface SignOutResponse {
  ok: true;
}

// ────────────────────────────────────────────────────────────────────────
// Reliability coordinators (shared by the Owner app + the cashier POS).
//
// One module-scoped coordinator per logical auth family. They are stateless
// between settled calls except for the session probe's short cooldown, so a
// single pair is safe for the whole process (there is exactly one live API
// origin per app). See internal/auth-flow.ts for the full rationale.
//
//   • login   — coalesces a double-submit of the SAME pin onto one POST and
//               silently re-issues once on a transient transport blip. A
//               different pin is an independent attempt.
//   • session — coalesces concurrent cold-start probes AND holds a 1.5s
//               cooldown after one settles, so a 401 can't re-loop into the
//               /api/auth/session storm the prod logs showed.
// ────────────────────────────────────────────────────────────────────────
const loginFlow = new AuthFlowCoordinator();
const sessionFlow = new AuthFlowCoordinator({ cooldownMs: 1_500 });

export const authPin = {
  /** RAW login POST. Prefer `loginSafe` from the UI — it is what guards the
   *  double-submit / re-render-abort / transient-blip failure modes. */
  login(client: ApiClient, body: PinLoginRequest): Promise<PinLoginResponse> {
    return client.request<PinLoginResponse>('POST', '/api/auth/pin-login', body);
  },
  /**
   * The reliable login the UI should call. It:
   *   • runs DETACHED from any caller AbortSignal — a re-render the operator
   *     triggered (StrictMode, theme flip, keyboard inset, a cache signal)
   *     can NEVER abort a login they committed to;
   *   • coalesces a double-submit of the same PIN onto a single in-flight POST
   *     (protects the backend's 10/min budget → no spurious RATE_LIMITED);
   *   • silently re-issues exactly once on a transient network/timeout blip;
   *   • surfaces a REAL server answer (401 / PIN_LOCKED / RATE_LIMITED / …)
   *     unchanged — those are never retried.
   */
  loginSafe(client: ApiClient, body: PinLoginRequest): Promise<PinLoginResponse> {
    return loginFlow.run(`pin:${body.pin}`, () =>
      client.request<PinLoginResponse>('POST', '/api/auth/pin-login', body),
    );
  },
  /**
   * POST /api/auth/pin/set — den Anmeldecode setzen.
   *
   * ── DIE ERSTE INBESITZNAHME (30.07.2026, Norns POS) ────────────────────────
   *
   * Diese Route erlaubt den Aufruf OHNE Sitzung, aber nur unter drei
   * Bedingungen zugleich (Sitzung A, live gemessen): nur vom gepaarten Gerät,
   * nur für dessen Inhaber, und nur solange KEIN Geheimnis existiert. Mit dem
   * ersten Hash schliesst das Fenster; ein zweiter Aufruf ohne Sitzung ist 401.
   *
   * Das ist der einzige Weg, wie eine frisch installierte Kasse offline in
   * Betrieb geht: es gibt keine Vorgabe, die man kennen könnte, und ohne Netz
   * gibt es niemanden, der einen Code herausgeben würde.
   *
   * Der Server verlangt SECHS bis ZWÖLF Ziffern und weist bekannte
   * Gassenhauer ab. Die Oberfläche prüft die Länge mit, damit der Händler den
   * Grund vor dem Absenden sieht, aber die Wahrheit steht auf dem Server.
   */
  /**
   * Wer kann sich an diesem Geraet anmelden?
   *
   * Zeigt AUCH, wer noch keinen Code hat: sonst erschiene ein frisch
   * angelegter Mitarbeiter nirgends und kaeme nie zu seinem ersten Code.
   */
  anmeldbarePersonen(client: ApiClient): Promise<{ personen: AnmeldbarePerson[] }> {
    return client.request('GET', '/api/auth/anmeldbare-personen');
  },

  /**
   * Den Kassencode eines Mitarbeiters LOESCHEN, damit er selbst einen setzen
   * kann. Der Inhaber tippt nie einen fremden Code ein — kennte er ihn, waere
   * die Bedienerzuordnung nach Paragraph 146a AO wertlos.
   */
  kassencodeLoeschen(client: ApiClient, userId: string): Promise<{ ok: true }> {
    return client.request('POST', `/api/admin/staff/${userId}/kassencode-loeschen`);
  },

  setzeCode(client: ApiClient, body: { pin: string; userId?: string }): Promise<{ ok: true }> {
    // ⚠️ 31.07.2026: hier ging `{ pin }` hinaus, die Route verlangt aber
    // `newPin` (`apps/api-cloud/src/routes/auth-pin.ts:87`). Jeder Versuch,
    // den ersten Kassencode zu setzen, endete in HTTP 400 — und weil die
    // Fläche daraus „Dieser Code ist zu leicht zu erraten" machte, suchte der
    // Händler stundenlang nach einem besseren Code statt nach einem Fehler.
    return client.request('POST', '/api/auth/pin/set', {
      newPin: body.pin,
      ...(body.userId !== undefined ? { userId: body.userId } : {}),
    });
  },

  stepUp(client: ApiClient, body: PinStepUpRequest): Promise<PinStepUpResponse> {
    return client.request<PinStepUpResponse>('POST', '/api/auth/step-up', body);
  },
  /**
   * Nachbestätigen mit dem GERÄTECODE, also derselben Bildschirmsperre, die
   * die Person am Tresen beim Öffnen der App eingibt.
   *
   * Der Code wird NICHT mitgeschickt und darf es nicht: er ist ein Geheimnis
   * des Geräts, wird dort mit PBKDF2 geprüft und nach zehn Fehlversuchen
   * gelöscht. Diese Anfrage sagt dem Server nur, dass die Prüfung bestanden
   * wurde, damit er das Zeitfenster stempelt. Vorher MUSS der Aufrufer den
   * Code lokal geprüft haben.
   */
  stepUpDevice(client: ApiClient): Promise<PinStepUpResponse> {
    return client.request<PinStepUpResponse>('POST', '/api/auth/step-up/device');
  },
  /** RAW session GET. Prefer `sessionSafe` for the cold-start probe. */
  session(client: ApiClient): Promise<AuthSessionResponse> {
    return client.request<AuthSessionResponse>('GET', '/api/auth/session', undefined, {
      custom: { skipStepUp: true },
    });
  },
  /**
   * The reliable cold-start session probe. Coalesces concurrent probes and
   * holds a short cooldown after one settles, so a 401 cannot re-loop into the
   * /api/auth/session storm. `skipStepUp` keeps a 401 here from opening the PIN
   * modal — it just means "no session". A transient transport blip retries
   * once silently; a real ApiError (incl. 401) surfaces as-is so the caller can
   * tell "no session" (ApiError) from "server unreachable" (ApiNetworkError).
   */
  sessionSafe(client: ApiClient): Promise<AuthSessionResponse> {
    return sessionFlow.run('session', () =>
      client.request<AuthSessionResponse>('GET', '/api/auth/session', undefined, {
        custom: { skipStepUp: true },
      }),
    );
  },
  signOut(client: ApiClient): Promise<SignOutResponse> {
    return client.request<SignOutResponse>('POST', '/api/auth/sign-out');
  },
  /**
   * Revoke ALL of the current user's sessions on every device (the lost-device
   * kill switch, security review 2026-07-21). Returns how many were revoked.
   */
  signOutAll(client: ApiClient): Promise<{ ok: true; revoked: number }> {
    return client.request<{ ok: true; revoked: number }>('POST', '/api/auth/sign-out-all');
  },
};
