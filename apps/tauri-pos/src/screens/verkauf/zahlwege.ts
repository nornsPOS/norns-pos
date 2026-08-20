/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Die drei Zahlwege und die Schritte am Kartenleser
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── WARUM AN EINEM NEUTRALEN ORT (20.08.2026) ─────────────────────────────
 *
 * Diese Vokabel brauchen BEIDE Seiten: die Zahlfläche (`BezahlenDialog`) und
 * ihr Eingabefeld (`PaymentInput`). Bliebe sie im Rumpf, müsste das Blatt
 * seinen eigenen Rumpf einführen — ein Ring, den man später nicht mehr
 * auseinanderbekommt.
 */

export type Zahlwahl = 'CASH' | 'ZVT_CARD' | 'STRIPE_TERMINAL';

/**
 * Die sichtbaren Schritte der einen Geste am Stripe-Leser. Jeder Schritt
 * steht wörtlich auf der Fläche — der Kassierer sieht, was gerade geschieht,
 * und der Abbrechen-Knopf ist während des Wartens jederzeit erreichbar.
 */
export type StripeSchritt =
  | { art: 'RUHT' }
  | { art: 'TROCKENLAUF' }
  | { art: 'STARTEN' }
  /** Der Kundenschirm des Lesers trägt jetzt die echten Zeilen. */
  | { art: 'WARTEN'; hinweis: string | null }
  | { art: 'BUCHEN' };

/** Ruhige Pause zwischen zwei Stand-Abfragen (der Stand kommt vom Webhook). */
