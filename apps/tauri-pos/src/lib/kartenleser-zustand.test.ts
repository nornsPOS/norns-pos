/**
 * Zustandslogik der Gruppe „Kartenleser (Stripe)" im Gerätemanager.
 *
 * Der Massstab des Gewerks: der Zahlungsweg ERSCHEINT NUR, wenn Konto und
 * Leser wirklich eingerichtet sind. Ohne Stripe-Schlüssel sieht der Laden
 * eine ruhige Erklärung, kein Fehlerrot. Diese Tests halten die Ableitung
 * fest, BEVOR die Fläche gebaut wird (rot → grün).
 */
import { describe, expect, it } from 'vitest';

import { ApiError, type TerminalLeser } from '@norns/api-client';
import { PAYMENT_METHOD_LABEL } from '@norns/i18n-de';

import {
  anschriftAusLaden,
  beschreibeLeserAktionsFehler,
  geraeteTypText,
  istStripeNichtEingerichtet,
  kontoAuskunftAusFehler,
  kontoAuskunftAusStatus,
  leiteLeserGruppeAb,
  leserStandText,
  leserStandTon,
  pruefeRegistrierung,
} from './kartenleser-zustand.js';

function leser(status: string | null): TerminalLeser {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    providerReaderId: 'tmr_test',
    bezeichnung: 'Tresen links',
    geraetetyp: 'bbpos_wisepos_e',
    seriennummer: 'WSC123',
    status,
    registriertAm: '2026-07-27T10:00:00.000Z',
  };
}

const KONTO_BEREIT = {
  art: 'GELADEN',
  verbunden: true,
  bereit: true,
  hinweis: '',
} as const;

describe('leiteLeserGruppeAb — die drei ehrlichen Zustände', () => {
  it('meldet LAEDT, solange die Leser-Liste noch nicht da ist', () => {
    const g = leiteLeserGruppeAb({ istAdmin: true, konto: KONTO_BEREIT, leser: null });
    expect(g.art).toBe('LAEDT');
  });

  it('(a) Konto nicht verbunden: ruhige Erklärung, KEIN Fehlerbild', () => {
    const g = leiteLeserGruppeAb({
      istAdmin: true,
      konto: { art: 'GELADEN', verbunden: false, bereit: false, hinweis: 'Kein Konto.' },
      leser: [],
    });
    expect(g.art).toBe('OHNE_KONTO');
    if (g.art !== 'OHNE_KONTO') return;
    // Der Weg heisst auf der Fläche EXAKT so wie in der Zahlart-Beschriftung.
    expect(g.erklaerung).toContain(PAYMENT_METHOD_LABEL.STRIPE_TERMINAL);
    // Ruhig heisst: das Wort „Fehler" kommt nicht vor.
    expect(g.erklaerung.toLowerCase()).not.toContain('fehler');
  });

  it('(b) Konto da, kein Leser: die Registrierung wird angeboten', () => {
    const g = leiteLeserGruppeAb({ istAdmin: true, konto: KONTO_BEREIT, leser: [] });
    expect(g).toEqual({ art: 'REGISTRIERUNG', kontoHinweis: null });
  });

  it('(b, gebremst) Konto verbunden, aber nicht abbuchungsbereit: der Server-Hinweis steht dabei', () => {
    const g = leiteLeserGruppeAb({
      istAdmin: true,
      konto: {
        art: 'GELADEN',
        verbunden: true,
        bereit: false,
        hinweis: 'Die Einrichtung bei Stripe ist noch nicht abgeschlossen.',
      },
      leser: [],
    });
    expect(g).toEqual({
      art: 'REGISTRIERUNG',
      kontoHinweis: 'Die Einrichtung bei Stripe ist noch nicht abgeschlossen.',
    });
  });

  it('(c) Leser vorhanden: die Liste, auch für die Kassiererin (lesend)', () => {
    const g = leiteLeserGruppeAb({
      istAdmin: false,
      konto: { art: 'LAEDT' },
      leser: [leser('online')],
    });
    expect(g.art).toBe('LISTE');
    if (g.art !== 'LISTE') return;
    expect(g.registrierenErlaubt).toBe(false);
  });

  it('(c) Leser vorhanden + Inhaber + Konto bereit: registrieren bleibt möglich', () => {
    const g = leiteLeserGruppeAb({ istAdmin: true, konto: KONTO_BEREIT, leser: [leser('offline')] });
    expect(g).toEqual({ art: 'LISTE', kontoHinweis: null, registrierenErlaubt: true });
  });

  it('ohne Inhaberrecht und ohne Leser: ruhiger Hinweis statt toter Formulare', () => {
    const g = leiteLeserGruppeAb({ istAdmin: false, konto: { art: 'LAEDT' }, leser: [] });
    expect(g.art).toBe('NUR_INHABER');
  });

  it('Konto-Auskunft nur dem Inhaber erlaubt (403): derselbe ruhige Hinweis', () => {
    const g = leiteLeserGruppeAb({ istAdmin: true, konto: { art: 'NUR_INHABER' }, leser: [] });
    expect(g.art).toBe('NUR_INHABER');
  });

  it('Konto-Auskunft gestört (Netz): ehrlich benennen, nicht „nicht eingerichtet" behaupten', () => {
    const g = leiteLeserGruppeAb({ istAdmin: true, konto: { art: 'GESTOERT' }, leser: [] });
    expect(g.art).toBe('AUSKUNFT_GESTOERT');
  });

  it('Konto-Auskunft lädt noch, keine Leser: LAEDT statt vorschneller Erklärung', () => {
    const g = leiteLeserGruppeAb({ istAdmin: true, konto: { art: 'LAEDT' }, leser: [] });
    expect(g.art).toBe('LAEDT');
  });
});

describe('SCHLUESSEL_FEHLT — der Registrier-503 entlarvt die alte Kontozeile', () => {
  // 27.07.2026: eine alte Kontozeile in der Datenbank meldet connected=true,
  // obwohl der Server keinen Stripe-Schlüssel (mehr) trägt. Der Status-Weg
  // liefert dann den zuletzt bekannten, VERALTETEN Stand, und erst der 503
  // beim Registrieren sagt die Wahrheit. Ab da fällt die Gruppe in den
  // ruhigen Nicht-eingerichtet-Zustand, statt weiter ein Formular zu zeigen.
  it('erkennt NUR den 503 (SERVICE_UNAVAILABLE) als „nicht eingerichtet"', () => {
    expect(
      istStripeNichtEingerichtet(
        new ApiError({ code: 'SERVICE_UNAVAILABLE', message: 'kein Schlüssel', httpStatus: 503 }),
      ),
    ).toBe(true);
    expect(
      istStripeNichtEingerichtet(
        new ApiError({ code: 'CONFLICT', message: 'Zustand trägt nicht', httpStatus: 409 }),
      ),
    ).toBe(false);
    expect(istStripeNichtEingerichtet(new Error('offline'))).toBe(false);
  });

  it('ohne Leser: ruhiger Nicht-eingerichtet-Zustand mit ehrlichem Satz, kein Fehlerbild', () => {
    const g = leiteLeserGruppeAb({ istAdmin: true, konto: { art: 'SCHLUESSEL_FEHLT' }, leser: [] });
    expect(g.art).toBe('OHNE_KONTO');
    if (g.art !== 'OHNE_KONTO') return;
    // Der Satz benennt den fehlenden Schlüssel, damit niemand dem veralteten
    // Kontostand glaubt, und bleibt ruhig (das Wort „Fehler" kommt nicht vor).
    expect(g.erklaerung).toContain('Schlüssel');
    expect(g.erklaerung.toLowerCase()).not.toContain('fehler');
    expect(g.erklaerung).toContain(PAYMENT_METHOD_LABEL.STRIPE_TERMINAL);
  });

  it('mit Lesern: die Liste bleibt sichtbar, verwalten ist gesperrt, der Satz steht dabei', () => {
    const g = leiteLeserGruppeAb({
      istAdmin: true,
      konto: { art: 'SCHLUESSEL_FEHLT' },
      leser: [leser('online')],
    });
    expect(g.art).toBe('LISTE');
    if (g.art !== 'LISTE') return;
    expect(g.registrierenErlaubt).toBe(false);
    expect(g.kontoHinweis).toContain('Schlüssel');
  });
});

describe('kontoAuskunft — Übersetzung der Server-Antwort', () => {
  it('liest verbunden/bereit/hinweis aus dem Status-Payload', () => {
    expect(
      kontoAuskunftAusStatus({ connected: true, readyToCharge: false, hint: 'Noch offen.' }),
    ).toEqual({ art: 'GELADEN', verbunden: true, bereit: false, hinweis: 'Noch offen.' });
  });

  it('403 (kein Inhaber) wird NUR_INHABER, kein Fehlerbild', () => {
    const err = new ApiError({ code: 'FORBIDDEN', message: 'Owner-only', httpStatus: 403 });
    expect(kontoAuskunftAusFehler(err)).toEqual({ art: 'NUR_INHABER' });
  });

  it('jeder andere Fehler wird GESTOERT', () => {
    expect(kontoAuskunftAusFehler(new Error('offline'))).toEqual({ art: 'GESTOERT' });
  });
});

describe('pruefeRegistrierung — bevor irgendetwas den Server berührt', () => {
  it('verlangt den Registrierungscode', () => {
    const p = pruefeRegistrierung({ code: '   ', name: 'Tresen links' });
    expect(p.gueltig).toBe(false);
  });

  it('verlangt den Namen', () => {
    const p = pruefeRegistrierung({ code: 'apfel-birne-kirsche', name: '' });
    expect(p.gueltig).toBe(false);
  });

  it('hält die Server-Grenze von 100 Zeichen ein, statt sie erst dort zu reissen', () => {
    const p = pruefeRegistrierung({ code: 'x'.repeat(101), name: 'Tresen' });
    expect(p.gueltig).toBe(false);
  });

  it('Code und Name vorhanden: gültig', () => {
    expect(pruefeRegistrierung({ code: 'apfel-birne-kirsche', name: 'Tresen links' })).toEqual({
      gueltig: true,
    });
  });
});

describe('anschriftAusLaden — der Stripe-Standort kommt aus der Ladenidentität', () => {
  it('zerlegt „PLZ Ort" aus der letzten Anschriftzeile', () => {
    expect(
      anschriftAusLaden({ name: 'WAREHOUSE 14', address: ['Rosenstraße 40', '73614 Schorndorf'] }),
    ).toEqual({
      displayName: 'WAREHOUSE 14',
      line1: 'Rosenstraße 40',
      postalCode: '73614',
      city: 'Schorndorf',
    });
  });

  it('gibt null, wenn die Anschrift nicht trägt — statt Erfundenes zu senden', () => {
    expect(anschriftAusLaden({ name: 'X', address: ['Rosenstraße 40'] })).toBeNull();
    expect(anschriftAusLaden({ name: 'X', address: ['Rosenstraße 40', 'Schorndorf'] })).toBeNull();
  });
});

describe('leserStand — der zuletzt gesehene Gerätestand als Auskunft', () => {
  it('online/offline/unbekannt', () => {
    expect(leserStandTon('online')).toBe('online');
    expect(leserStandTon('offline')).toBe('offline');
    expect(leserStandTon(null)).toBe('pending');
    expect(leserStandText('online')).toBe('Online');
    expect(leserStandText('offline')).toBe('Offline');
    expect(leserStandText(null)).toBe('Stand unbekannt');
  });
});

describe('geraeteTypText — kein roher Stripe-Bezeichner auf der Fläche', () => {
  it('übersetzt die bekannten Gerätetypen', () => {
    expect(geraeteTypText('bbpos_wisepos_e')).toBe('BBPOS WisePOS E');
    expect(geraeteTypText('stripe_s700')).toBe('Stripe Reader S700');
    expect(geraeteTypText('simulated_wisepos_e')).toBe('Simulierter Leser (WisePOS E)');
  });

  it('lässt bei Unbekanntem NIE einen Unterstrich auf die Fläche', () => {
    expect(geraeteTypText('mystery_device_9')).not.toContain('_');
  });

  it('null bleibt null, die Zeile entfällt dann', () => {
    expect(geraeteTypText(null)).toBeNull();
  });
});

describe('beschreibeLeserAktionsFehler — ehrliche Sätze für die drei Fehlerbilder', () => {
  it('SERVICE_UNAVAILABLE (kein Stripe-Schlüssel): ruhig, ohne das Wort „Fehler" im Titel', () => {
    const b = beschreibeLeserAktionsFehler(
      new ApiError({ code: 'SERVICE_UNAVAILABLE', message: 'nope', httpStatus: 503 }),
    );
    expect(b.titel.toLowerCase()).not.toContain('fehler');
    expect(b.text).toContain(PAYMENT_METHOD_LABEL.STRIPE_TERMINAL);
  });

  it('CONFLICT: der deutsche Server-Satz wird wörtlich weitergegeben', () => {
    const b = beschreibeLeserAktionsFehler(
      new ApiError({
        code: 'CONFLICT',
        message: 'Es ist kein Stripe-Haendlerkonto verbunden.',
        httpStatus: 409,
      }),
    );
    expect(b.text).toBe('Es ist kein Stripe-Haendlerkonto verbunden.');
  });

  it('alles andere fällt auf describeError zurück und bleibt nicht leer', () => {
    const b = beschreibeLeserAktionsFehler(new Error('kaputt'));
    expect(b.text.length).toBeGreaterThan(0);
  });
});
