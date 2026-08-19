/**
 * Zustand store — current operator session.
 *
 * The Tauri webview cookie store persists across reloads, so on cold start
 * we probe `/api/auth/session` to know whether a session is still alive
 * (see `useSessionProbe`). Until that round-trip resolves, `status` is
 * `'unknown'`. The login screen owns the transition from `'unauthenticated'`
 * to `'authenticated'`.
 */

import { create } from 'zustand';

import type { AuthProfile, AuthSessionResponse, PinLoginResponse, SessionActor } from '@norns/api-client';

import { readProfileCache, writeProfileCache } from '../lib/profile-cache.js';

/**
 * `unreachable` is distinct from `unauthenticated`: the cold-start probe could
 * not reach the server at all (network / circuit-open), so we must NOT show the
 * PIN pad (which implies "your session ended — log in again"). Instead App.tsx
 * renders a "Keine Verbindung zum Server" screen with a retry. From there the
 * operator can re-probe, which resolves to authenticated / unauthenticated.
 */
export type SessionStatus = 'unknown' | 'unauthenticated' | 'unreachable' | 'authenticated';

interface SessionState {
  status: SessionStatus;
  actor: SessionActor | null;
  /** Who is signed in (email + Google name/picture), for the header profile. */
  profile: AuthProfile | null;
  lastPinStepUpAt: string | null;
  sessionExpiresAt: string | null;

  /** Called by PinLogin after a successful POST /api/auth/pin-login. */
  setFromLogin: (payload: PinLoginResponse) => void;
  /** Called by useSessionProbe after a cold-start probe found a live session. */
  setFromProbe: (payload: AuthSessionResponse) => void;
  /**
   * ⚠️ Ist die Kasse seit diesem Programmstart schon einmal mit dem
   * Kassencode geöffnet worden?
   *
   * ── DER BEFUND VOM 09.08.2026 ───────────────────────────────────────
   *
   * Es gab ZWEI Ziffernschlösser mit ZWEI Geheimnissen: den Kassencode
   * (argon2 im Motor, benennt den MENSCHEN, der auf jedem Beleg steht) und
   * einen Gerätecode (PBKDF2 im Fensterspeicher, benennt NIEMANDEN). Jeden
   * Morgen zwei Masken vor dem ersten Kunden, beim Einrichten drei
   * Eingaben.
   *
   * Basels Anordnung vom 05.08.2026: „ein Code, einmal, fertig."
   *
   * ⚠️ Der Gerätecode fiel weg, NICHT die Eingabe. Der Sitzungsschlüssel
   * liegt im Speicher der Fensterschale und überlebt einen Kaltstart —
   * ohne dieses Feld öffnete sich die Kasse nach einem Neustart GANZ OHNE
   * Code, weil die Sitzung noch acht Stunden gilt. Ein Tresen mit Gold in
   * der Lade darf nicht offen sein, nur weil gestern jemand angemeldet war.
   *
   * Deshalb: beim Programmstart `false`, und nur eine erfolgreiche
   * Codeeingabe setzt es. Die Sitzungsprüfung tut es NICHT.
   */
  posEntsperrt: boolean;
  /** Called by the step-up modal after a successful POST /api/auth/step-up. */
  recordStepUp: (lastPinStepUpAt: string) => void;
  setUnauthenticated: () => void;
  /** Cold-start probe could not reach the server (network / circuit). */
  setUnreachable: () => void;
  /** Re-run the cold-start probe (drives status back to 'unknown'). */
  retryProbe: () => void;
  setStatus: (status: SessionStatus) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'unknown',
  // Jeder Programmstart beginnt gesperrt. Siehe die Begründung oben.
  posEntsperrt: false,
  actor: null,
  // Hydrate the last-known profile so the header shows the operator instantly.
  profile: readProfileCache(),
  lastPinStepUpAt: null,
  sessionExpiresAt: null,

  setFromLogin: (payload) => {
    if (payload.profile) writeProfileCache(payload.profile);
    set((s) => ({
      status: 'authenticated',
      // ⚠️ NUR hier. Die Sitzungsprüfung darf das nicht setzen, sonst
      // öffnet ein Kaltstart die Kasse ohne jede Codeeingabe.
      posEntsperrt: true,
      actor: payload.actor,
      // Prefer the fresh profile; keep the cached one if the server omitted it.
      profile: payload.profile ?? s.profile,
      // PIN login itself is a step-up — the server stamps `lastPinStepUpAt`
      // server-side; we surface "now" for the client clock too.
      lastPinStepUpAt: new Date().toISOString(),
      sessionExpiresAt: payload.sessionExpiresAt,
    }));
  },
  setFromProbe: (payload) => {
    if (payload.profile) writeProfileCache(payload.profile);
    set((s) => ({
      status: 'authenticated',
      actor: payload.actor,
      profile: payload.profile ?? s.profile,
      lastPinStepUpAt: payload.lastPinStepUpAt,
      sessionExpiresAt: payload.expiresAt,
    }));
  },
  recordStepUp: (lastPinStepUpAt) => set({ lastPinStepUpAt }),
  setUnauthenticated: () => {
    writeProfileCache(null);
    set({
      status: 'unauthenticated',
      // Abmelden heisst gesperrt: sonst bliebe die Kasse nach dem Abmelden
      // und einem erneuten Anmelden ohne Codeeingabe offen.
      posEntsperrt: false,
      actor: null,
      profile: null,
      lastPinStepUpAt: null,
      sessionExpiresAt: null,
    });
  },
  // Server unreachable ≠ signed out: keep the cached profile so a retry that
  // reconnects doesn't flash an empty identity.
  setUnreachable: () =>
    set({
      status: 'unreachable',
      actor: null,
      lastPinStepUpAt: null,
      sessionExpiresAt: null,
    }),
  retryProbe: () => set({ status: 'unknown' }),
  setStatus: (status) => set({ status }),
}));
