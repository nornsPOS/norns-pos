/**
 * session-actions — a tiny registry so screens that aren't wired into the
 * AppShell prop tree (e.g. the routed Einstellungen surface) can still trigger
 * the full sign-out. AppShell owns the real `handleSignOut` (store resets +
 * authPin.signOut) and registers it here on mount; Einstellungen's "Abmelden"
 * button calls `requestSignOut()`. The sign-out lock was removed from the
 * header, so this keeps logout reachable.
 */

let signOutFn: (() => void) | null = null;

export function registerSignOut(fn: () => void): () => void {
  signOutFn = fn;
  return () => {
    if (signOutFn === fn) signOutFn = null;
  };
}

/** Triggers the registered sign-out. No-op if the AppShell hasn't mounted. */
export function requestSignOut(): void {
  signOutFn?.();
}
