/**
 * Der Leser-Zahlungsweg darf NIEMALS in den Ausgangskorb.
 *
 * Der gefürchtete Fall (rot geschrieben, bevor der Bezahldialog den Weg
 * benutzt): die Kassiererin drückt „Kartenzahlung starten", das Netz ist
 * gerade weg, das Mittelstück reiht den POST ein und sagt zu. Stunden später
 * kommt das Netz zurück, `drainOutbox` spielt den Start WIRKLICH ab — und der
 * Leser am Tresen verlangt Geld für einen Kunden, der längst gegangen ist.
 * Ein Vorgang am Leser zählt nur JETZT, mit dem Kunden vor dem Gerät
 * (Faustregel Probe 1 und 3 in offline-queue.ts).
 */
import { describe, expect, it } from 'vitest';

import { istFluechtigerPfad } from './offline-queue.js';

describe('Stripe-Leser-Wege sind flüchtig', () => {
  it('Zahlung starten wird ohne Netz sofort und ehrlich abgelehnt, nie eingereiht', () => {
    expect(istFluechtigerPfad('/api/stripe/terminal/payments')).toBe(true);
  });

  it('Abbrechen und Erstatten ebenso (die Antwort zählt, der Kunde steht am Tresen)', () => {
    expect(istFluechtigerPfad('/api/stripe/terminal/payments/00000000-0000-0000-0000-000000000000/cancel')).toBe(true);
    expect(istFluechtigerPfad('/api/stripe/terminal/payments/00000000-0000-0000-0000-000000000000/refund')).toBe(true);
  });

  it('Leser-Verwaltung (registrieren/entfernen) ebenso — Stufenanhebung und Code verfallen', () => {
    expect(istFluechtigerPfad('/api/stripe/terminal/readers')).toBe(true);
  });

  it('die fiskalischen Wege bleiben unberührt einreihbar', () => {
    expect(istFluechtigerPfad('/api/transactions/finalize')).toBe(false);
    expect(istFluechtigerPfad('/api/transactions/storno')).toBe(false);
  });
});
