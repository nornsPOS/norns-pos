/**
 * ⛔ OHNE NETZ WIRD KEIN GUTSCHEIN ANGENOMMEN
 *
 * Der Befund vom 12.08.2026: offline ging der Beleg samt VOUCHER-Zahlungsbein
 * in den Ausgangskorb, die Fläche versprach „wird erst beim Synchronisieren
 * verbucht" — und NICHTS bucht ihn. Der Kunde bezahlte mit dem Gutschein, das
 * Guthaben blieb voll. Echter Geldverlust bei jedem Netzausfall.
 *
 * Diese Sätze halten die Regel fest UND ihre Grenze: der Offline-Verkauf ohne
 * Gutschein bleibt ausdrücklich erlaubt, sonst hätte der Riegel mehr kaputt
 * gemacht als geheilt.
 */

import { describe, expect, it } from 'vitest';

import { pruefeGutscheinBrauchtNetz } from './gutschein-braucht-netz.js';

describe('⛔ ein Gutschein ohne Netz', () => {
  it('wird abgewiesen, statt still ein Guthaben zu verschenken', () => {
    const u = pruefeGutscheinBrauchtNetz({
      gutscheinAngewandt: true,
      gutscheinCents: 5000n,
      amNetz: false,
    });
    expect(u.erlaubt).toBe(false);
    // Der Satz nennt den WEG, nicht nur die Absage.
    expect(u.satz).toContain('bar oder mit Karte');
    expect(u.satz).toContain('entfernen');
  });

  it('am Netz ist derselbe Gutschein selbstverständlich erlaubt', () => {
    const u = pruefeGutscheinBrauchtNetz({
      gutscheinAngewandt: true,
      gutscheinCents: 5000n,
      amNetz: true,
    });
    expect(u.erlaubt).toBe(true);
    expect(u.satz).toBe('');
  });

  it('⚠️ der Offline-Verkauf OHNE Gutschein bleibt erlaubt — er ist der Sinn des Korbs', () => {
    const u = pruefeGutscheinBrauchtNetz({
      gutscheinAngewandt: false,
      gutscheinCents: 0n,
      amNetz: false,
    });
    expect(u.erlaubt, 'der Riegel sperrt mehr, als er darf').toBe(true);
  });

  it('ein Gutschein über 0,00 EUR ist kein Zahlungsmittel und sperrt nichts', () => {
    // Kann entstehen, wenn der Betrag schon anderweitig gedeckt ist.
    const u = pruefeGutscheinBrauchtNetz({
      gutscheinAngewandt: true,
      gutscheinCents: 0n,
      amNetz: false,
    });
    expect(u.erlaubt).toBe(true);
  });
});
