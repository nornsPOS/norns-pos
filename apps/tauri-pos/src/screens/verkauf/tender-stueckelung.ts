/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die Scheine, die der Kassierer mit einem Griff nimmt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Aus `BezahlenDialog.tsx` ausgezogen (20.08.2026, Basels „nicht die Welt
 * ineinanderstopfen"): eine reine Rechnung, die die Zahlfläche braucht und
 * die sich für sich prüfen lässt. Zeile für Zeile unverändert.
 */

import { fromCents } from '../../lib/money-core.js';

const TENDER_DENOMINATIONS_CENTS: readonly bigint[] = [
  500n,
  1000n,
  2000n,
  5000n,
  10_000n,
  20_000n,
  50_000n,
];

export interface TenderChip {
  /** Canonical dot-decimal the chip writes into `cashReceivedEur`. */
  readonly valueEur: string;
  /** German label shown on the chip ("Passend" for the exact-due chip). */
  readonly label: string;
  /** True for the exact-tender chip (no change due). */
  readonly exact: boolean;
}

export function computeTenderChips(dueCents: bigint): readonly TenderChip[] {
  if (dueCents <= 0n) return [];
  const chips: TenderChip[] = [{ valueEur: fromCents(dueCents), label: 'Passend', exact: true }];
  for (const note of TENDER_DENOMINATIONS_CENTS) {
    if (note > dueCents) {
      chips.push({ valueEur: fromCents(note), label: '', exact: false });
      if (chips.length >= 5) break;
    }
  }
  return chips;
}

/**
 * Die wählbaren Zahlarten des Dialogs. `STRIPE_TERMINAL` (die eine Geste am
 * Stripe-Leser) erscheint im Wähler NUR, wenn die Leser-Abfrage mindestens
 * einen registrierten Leser meldet — ohne Einrichtung sieht Roman schlicht
 * nichts Neues. ZVT bleibt unverändert daneben.
 */
