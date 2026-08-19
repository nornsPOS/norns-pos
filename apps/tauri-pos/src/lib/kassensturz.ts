/**
 * kassensturz — pure close-out (Kassensturz) classification for the Z-Bon
 * readout (UX §4.3). Plain-language daily ritual: the app shows Erwartet
 * (server `systemExpectedEur`), the operator's Gezählt (server `blindCountEur`),
 * and the Differenz — computed here as `counted − expected` (a math identity
 * equal to the server's generated `varianceEur`) with an honest over/short/ok
 * classification against the visible tolerance.
 *
 * No facade: this NEVER invents the expected figure (it comes from the server)
 * and NEVER hides a real shortage — the signed Differenz is always returned.
 * bigint-cents, German-comma tolerant.
 */
import { fromCents, toCents } from './intake-math.js';

export type DifferenzTone = 'ok' | 'short' | 'over';

export interface DifferenzInput {
  /** Operator's counted drawer cash (server `blindCountEur`). */
  countedEur: string | null;
  /** Server-computed expected drawer cash (`systemExpectedEur`). */
  expectedEur: string | null;
  /** Visible comfort tolerance (`cash_drawer.variance_alert_threshold_eur`). */
  toleranceEur: string;
}

export interface Differenz {
  /** Signed decimal-string `counted − expected`; null when not computable. */
  differenzEur: string | null;
  tone: DifferenzTone;
  withinTolerance: boolean;
}

/** Comma → dot without mis-reading a plain dot-decimal (mirror intake-math). */
function commaToDot(s: string): string {
  return s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
}

function parseCentsOrNull(s: string | null): bigint | null {
  if (s === null) return null;
  const n = commaToDot(s.trim());
  if (!/^-?\d+(\.\d+)?$/.test(n)) return null;
  return toCents(n);
}

export function classifyDifferenz(input: DifferenzInput): Differenz {
  const counted = parseCentsOrNull(input.countedEur);
  const expected = parseCentsOrNull(input.expectedEur);
  if (counted === null || expected === null) {
    return { differenzEur: null, tone: 'ok', withinTolerance: true };
  }

  const diff = counted - expected;
  const tolCents = parseCentsOrNull(input.toleranceEur) ?? 0n;
  const absTol = tolCents < 0n ? -tolCents : tolCents;
  const absDiff = diff < 0n ? -diff : diff;
  const withinTolerance = absDiff <= absTol;
  const tone: DifferenzTone = withinTolerance ? 'ok' : diff < 0n ? 'short' : 'over';

  return { differenzEur: fromCents(diff), tone, withinTolerance };
}
