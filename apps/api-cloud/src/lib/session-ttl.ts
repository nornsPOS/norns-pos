/**
 * Session lifetime — one source of truth for session TTLs and the sliding
 * (rolling) refresh window.
 *
 * SICHERHEITS-AUDIT 24.07.2026 — zwei Befunde behoben:
 *
 *  1. DIE INVERSION. Die Owner-Sitzung war 7 Tage, die Personalsitzung 8
 *     Stunden — die HÖCHSTE Berechtigung trug also das LÄNGSTE Fenster. Gegen
 *     „höchste Berechtigung = kürzestes Token" war das rückwärts. Owner ist
 *     jetzt ebenfalls 8 Stunden. Das ist zumutbar, weil (a) die Anmeldung ein
 *     Fingertipp über Google + Biometrie ist, (b) die App bei JEDEM Start lokal
 *     sperrt (LocalLockGate), und (c) jede gefährliche Handlung ohnehin einen
 *     frischen Step-up (10 Min.) verlangt.
 *
 *  2. „ROLLING" WAR EINE LÜGE. Die 30-Tage-Kundensitzung hiess „rolling", aber
 *     nichts erneuerte je das Ablaufdatum — es war ein festes Fenster. Jetzt
 *     GLEITET es wirklich: bei Nutzung wird `expires_at` nachgeführt, gedrosselt
 *     über `SESSION_SLIDE_GAP_MS`. So bleibt eine kurze Grund-TTL trotzdem
 *     bequem für den, der die App benutzt, und ein liegengelassenes Token
 *     verfällt schnell.
 *
 * Der Widerruf (`sessions.revoked_at` 0089, `shopper_sessions.revoked_at` 0106)
 * bleibt der SOFORTIGE Ausschalter; diese TTL ist der passive Riegel.
 */

/** Owner session lifetime — no longer longer than staff. */
export const OWNER_SESSION_TTL_MS = 8 * 60 * 60_000; // 8 hours

/** Staff (cashier) session lifetime — a work shift. */
export const STAFF_SESSION_TTL_MS = 8 * 60 * 60_000; // 8 hours

/** Customer (shopper) session lifetime. Longer for convenience — a customer is
 *  the LOWEST-privilege actor — but now genuinely sliding AND revocable. */
export const SHOPPER_SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days

/** The TTL for a freshly minted staff/owner session, by actor kind. */
export function sessionTtlMs(isOwner: boolean): number {
  return isOwner ? OWNER_SESSION_TTL_MS : STAFF_SESSION_TTL_MS;
}

/**
 * Only refresh the sliding expiry once the session has burned this much of its
 * life, so an active user does not trigger a write on every single request. A
 * refresh moves `expires_at` back to `now + TTL`.
 */
export const SESSION_SLIDE_GAP_MS = 15 * 60_000; // 15 minutes

/**
 * Should the sliding expiry be nudged? True once the remaining life has dropped
 * more than one gap below the full TTL — i.e. the session has been alive (or
 * idle-but-used) at least `SESSION_SLIDE_GAP_MS`.
 *
 * Pure, so it is testable without a clock: pass `now` and the row's `expiresAt`.
 */
export function shouldSlide(expiresAt: Date, ttlMs: number, now: number): boolean {
  const remaining = expiresAt.getTime() - now;
  return remaining < ttlMs - SESSION_SLIDE_GAP_MS;
}
