/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  zahlungsfehler — was der Mensch am Tresen lesen soll, wenn es klemmt
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM DAS EIN EIGENES STÜCK IST (20.08.2026) ──────────────────────────
 *
 * Basel, mehrfach: „nicht die Welt ineinanderstopfen." `BezahlenDialog.tsx`
 * trug 4018 Zeilen — die Zahlfläche, ihre fünf Bauteile, die Steuertexte, die
 * Scheinstückelung und diese zwei Helfer, alles in einer Datei.
 *
 * Diese beiden gehören für sich: sie sind REIN (kein Zustand, keine Fläche),
 * sie werden vom Zahlweg an fünf Stellen gebraucht, und sie tragen eine
 * Unterscheidung, die man nicht beim Vorbeilesen mitnimmt.
 */

import { ApiError } from '@norns/api-client';
import { describeError } from '@norns/i18n-de';

import { ohneApiFehlerSatz } from '../../lib/eingereiht.js';
import { isStepUpCancelled } from '../../state/step-up-store.js';

/** Verlangt der Vorgang eine Ausweisprüfung nach § 10 GwG? */
export function isKycRequiredError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'KYC_REQUIRED';
}

/** Der Satz, den die Fläche zeigt. */
export function formatPaymentError(err: unknown): string {
  // A cancelled PIN modal rejects with a plain StepUpCancelledError (the step-up
  // middleware propagates it AS-IS), so it must be caught BEFORE the generic
  // `instanceof Error` branch — otherwise a deliberate cancel is misreported as
  // a payment/network failure.
  if (isStepUpCancelled(err)) return 'PIN-Bestätigung wurde abgebrochen.';
  if (err instanceof ApiError) {
    if (err.code === 'STEP_UP_REQUIRED') return 'PIN-Bestätigung wurde abgebrochen.';
    if (err.code === 'KYC_REQUIRED')
      return 'Käufer muss per Ausweis geprüft werden. Bitte Kunden zuordnen.';
    if (err.code === 'PRODUCT_NOT_RESERVABLE')
      return 'Mindestens ein Stück ist nicht mehr reserviert. Karte leeren und neu wählen.';
    return describeError(err);
  }
  // ⚠️ Hier stand `if (err instanceof Error) return describeError(err)` VOR
  // jeder Unterscheidung. `describeError` kennt aber nur `ApiNetworkError`;
  // alles andere fiel auf „Es ist ein Fehler aufgetreten. Bitte erneut
  // versuchen." zusammen. Damit verschwanden zwei Lagen, die verschiedene
  // Handgriffe verlangen: ein sicher eingereihter Vorgang (auf KEINEN Fall
  // wiederholen) und eine angehaltene Übertragung (warten, nicht drücken).
  //
  // `ohneApiFehlerSatz` unterscheidet beide. Die Buchungswege oben fangen den
  // eingereihten Fall schon vorher ab; dieser Rückfall ist das Netz darunter.
  if (typeof err === 'string') return err;
  return ohneApiFehlerSatz(err);
}

