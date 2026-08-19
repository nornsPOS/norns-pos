/**
 * Duress PIN classification (Decision #37).
 *
 * Given the two boolean results of verifying an entered PIN against the user's
 * POS hash and duress hash, decide:
 *   • `pinCorrect` — whether to treat the attempt as a SUCCESSFUL login. A
 *     duress match counts as correct so the lockout counter never ticks and the
 *     attacker gets no timing/branch hint.
 *   • `isDuress` — whether the duress PIN was entered (→ fire the silent alarm).
 *
 * Pure + unit-tested; the route does the (async) argon2 verification and feeds
 * the booleans here. The DB CHECK `users_duress_pin_distinct` guarantees the two
 * hashes differ, so both can never match at once — but we still prefer the
 * non-alarm branch if they somehow did.
 */

export interface PinMatch {
  matchesPos: boolean;
  matchesDuress: boolean;
}

export interface PinClassification {
  /** Treat the attempt as a successful login (no lockout tick). */
  pinCorrect: boolean;
  /** The duress PIN was entered — fire the silent alarm. */
  isDuress: boolean;
}

export function classifyPinAttempt(match: PinMatch): PinClassification {
  return {
    pinCorrect: match.matchesPos || match.matchesDuress,
    isDuress: match.matchesDuress && !match.matchesPos,
  };
}
