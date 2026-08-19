/**
 * Der Stand-Automat der Leser-Zahlung — rein, ohne Datenbank, ohne Netz.
 *
 * DER DOPPELBELASTUNGS-RIEGEL (Koordination §9): eine girocard-Zahlung mit
 * PIN erzeugt bei Stripe ZWEI Belastungen — erst eine weich abgelehnte mit
 * `online_or_offline_pin_required`, dann die echte. Dieser Automat ist die
 * eine Stelle, die entscheidet, was daraus im Kassenbuch wird. Die Tafeln
 * hier sind VON HAND geschrieben, nicht aus dem Modul eingelesen.
 */

import { describe, expect, it } from 'vitest';

import {
  WEICHE_ABLEHNUNG,
  naechsterStand,
} from '../../src/lib/leser-zahlung-stand.js';

describe('naechsterStand — der Stand-Automat der Leser-Zahlung', () => {
  // ── DER RIEGEL ───────────────────────────────────────────────────────────

  it('bucht die weiche girocard-Ablehnung NIE als Fehlschlag, sondern zaehlt sie nur', () => {
    const u = naechsterStand('PROCESSING', {
      typ: 'fehlschlag',
      code: WEICHE_ABLEHNUNG,
      meldung: 'The card requires online or offline PIN entry.',
    });
    expect(u).toEqual({ geaendert: false, weicheAblehnung: true });
  });

  it('laesst aus SUCCEEDED keinen Weg mehr heraus — auch nicht durch spaete Fehlschlaege', () => {
    expect(
      naechsterStand('SUCCEEDED', { typ: 'fehlschlag', code: 'generic_decline' }),
    ).toEqual({ geaendert: false, weicheAblehnung: false });
    expect(naechsterStand('SUCCEEDED', { typ: 'storniert' })).toEqual({
      geaendert: false,
      weicheAblehnung: false,
    });
    expect(naechsterStand('SUCCEEDED', { typ: 'erfolg' })).toEqual({
      geaendert: false,
      weicheAblehnung: false,
    });
  });

  // ── Die gewoehnlichen Uebergaenge ────────────────────────────────────────

  it('macht aus PROCESSING + Erfolg genau SUCCEEDED', () => {
    expect(naechsterStand('PROCESSING', { typ: 'erfolg' })).toEqual({
      geaendert: true,
      stand: 'SUCCEEDED',
      fehlerbild: null,
      meldung: null,
    });
  });

  it('macht aus einer harten Ablehnung FAILED mit dem Fehlerbild KARTE_ABGELEHNT', () => {
    const u = naechsterStand('PROCESSING', {
      typ: 'fehlschlag',
      code: 'generic_decline',
      meldung: 'Your card was declined.',
    });
    expect(u).toEqual({
      geaendert: true,
      stand: 'FAILED',
      fehlerbild: 'KARTE_ABGELEHNT',
      meldung: 'Your card was declined.',
    });
  });

  it('erlaubt nach einer harten Ablehnung noch den Erfolg — der Kunde darf eine andere Karte ziehen', () => {
    // Der Leser sammelt nach einer Ablehnung weiter; eine zweite Karte kann
    // die Zahlung noch retten. Nur CANCELED ist dafuer zu spaet.
    expect(naechsterStand('FAILED', { typ: 'erfolg' })).toEqual({
      geaendert: true,
      stand: 'SUCCEEDED',
      fehlerbild: null,
      meldung: null,
    });
    expect(naechsterStand('CANCELED', { typ: 'erfolg' })).toEqual({
      geaendert: false,
      weicheAblehnung: false,
    });
  });

  it('macht aus dem Storno CANCELED, aus PROCESSING wie aus FAILED', () => {
    expect(naechsterStand('PROCESSING', { typ: 'storniert' })).toEqual({
      geaendert: true,
      stand: 'CANCELED',
      fehlerbild: null,
      meldung: null,
    });
    expect(naechsterStand('FAILED', { typ: 'storniert' })).toEqual({
      geaendert: true,
      stand: 'CANCELED',
      fehlerbild: null,
      meldung: null,
    });
  });

  it('uebersetzt die verstrichene Leser-Aktion in ZEITUEBERSCHREITUNG', () => {
    const u = naechsterStand('PROCESSING', {
      typ: 'aktion_fehlgeschlagen',
      code: 'session_timed_out',
      meldung: 'The collection timed out before a card was presented.',
    });
    expect(u).toEqual({
      geaendert: true,
      stand: 'FAILED',
      fehlerbild: 'ZEITUEBERSCHREITUNG',
      meldung: 'The collection timed out before a card was presented.',
    });
  });

  it('uebersetzt den Abbruch am Geraet in CANCELED mit ABBRUCH_AM_GERAET', () => {
    const u = naechsterStand('PROCESSING', {
      typ: 'aktion_fehlgeschlagen',
      code: 'customer_canceled',
    });
    expect(u).toEqual({
      geaendert: true,
      stand: 'CANCELED',
      fehlerbild: 'ABBRUCH_AM_GERAET',
      meldung: null,
    });
  });

  it('macht aus einer unbekannten Aktions-Stoerung FAILED ohne erfundenes Fehlerbild', () => {
    const u = naechsterStand('PROCESSING', {
      typ: 'aktion_fehlgeschlagen',
      code: 'irgendwas_neues',
      meldung: 'x',
    });
    expect(u).toEqual({ geaendert: true, stand: 'FAILED', fehlerbild: null, meldung: 'x' });
  });
});
