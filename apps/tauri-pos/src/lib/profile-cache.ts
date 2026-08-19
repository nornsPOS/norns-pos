/**
 * The signed-in operator's human profile (email + Google name/picture), cached
 * on THIS device so the header can show who is logged in immediately on a cold
 * start — before the session probe round-trips, and even if an older server
 * omits `profile` from the restore response. It is display-only, never an auth
 * secret, and is cleared on sign-out.
 */

import type { AuthProfile } from '@norns/api-client';

const KEY = 'w14.profile';

export function readProfileCache(): AuthProfile | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<AuthProfile>;
    if (typeof p.email !== 'string') return null;
    return { email: p.email, displayName: p.displayName ?? null, avatarUrl: p.avatarUrl ?? null };
  } catch {
    return null;
  }
}

export function writeProfileCache(profile: AuthProfile | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (profile) localStorage.setItem(KEY, JSON.stringify(profile));
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage unavailable — the store still holds it in memory this run */
  }
}
