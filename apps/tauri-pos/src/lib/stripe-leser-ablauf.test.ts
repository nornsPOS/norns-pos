/**
 * Der Zustandsautomat der EINEN GESTE (Stripe-Leser im Bezahldialog) — rot
 * geschrieben, BEVOR die Fläche ihn benutzt.
 *
 * Warum diese Tests hart auf Wortlaute prüfen: „Karte abgelehnt" ist nicht
 * „Verbindung gestört". Der Kassierer sagt dem wartenden Kunden genau das,
 * was hier steht — ein falsches Fehlerbild kostet an der teuersten Stelle
 * des Ladens Vertrauen.
 */
import { describe, expect, it } from 'vitest';

import { ApiError, type TerminalLeser } from '@norns/api-client';

import {
  LESER_POLL_TAKT_MS,
  beschreibeStartFehler,
  deuteStand,
  positionenDeckenBetrag,
  stripeZahlartSichtbar,
  terminalPositionen,
  waehleLeser,
} from './stripe-leser-ablauf.js';

function leser(teil: Partial<TerminalLeser>): TerminalLeser {
  return {
    id: 'l-1',
    providerReaderId: 'tmr_1',
    bezeichnung: 'Tresen links',
    geraetetyp: 'bbpos_wisepos_e',
    seriennummer: null,
    status: 'online',
    registriertAm: '2026-07-27T09:00:00Z',
    ...teil,
  };
}

describe('Sichtbarkeit: der Weg erscheint NUR mit registriertem Leser', () => {
  it('null (Liste nicht geladen/abrufbar) → unsichtbar', () => {
    expect(stripeZahlartSichtbar(null)).toBe(false);
    expect(stripeZahlartSichtbar(undefined)).toBe(false);
  });

  it('leere Liste → unsichtbar (Roman sieht ohne Einrichtung schlicht nichts)', () => {
    expect(stripeZahlartSichtbar([])).toBe(false);
  });

  it('mindestens ein Leser → sichtbar', () => {
    expect(stripeZahlartSichtbar([leser({})])).toBe(true);
  });
});

describe('waehleLeser: der Leser der Geste', () => {
  it('bevorzugt einen online gemeldeten Leser', () => {
    const offline = leser({ id: 'a', status: 'offline' });
    const online = leser({ id: 'b', status: 'online' });
    expect(waehleLeser([offline, online])?.id).toBe('b');
  });

  it('faellt auf den ersten zurueck, wenn keiner online gemeldet ist (der Stand ist Auskunft, keine Wahrheit)', () => {
    const a = leser({ id: 'a', status: 'offline' });
    const b = leser({ id: 'b', status: null });
    expect(waehleLeser([a, b])?.id).toBe('a');
  });

  it('keine Leser → null', () => {
    expect(waehleLeser([])).toBeNull();
    expect(waehleLeser(null)).toBeNull();
  });
});

describe('terminalPositionen: die echten Warenkorbzeilen, in ganzen Cent', () => {
  it('uebersetzt Name und Zeilenbetrag, Menge ist 1 (Einzelstuecke)', () => {
    const positionen = terminalPositionen([
      { name: 'Goldring 585', lineTotalCents: 24900n },
      { name: 'Kette Silber', lineTotalCents: 7950n },
    ]);
    expect(positionen).toEqual([
      { bezeichnung: 'Goldring 585', menge: 1, betragCents: 24900 },
      { bezeichnung: 'Kette Silber', menge: 1, betragCents: 7950 },
    ]);
  });

  it('positionenDeckenBetrag: die Zeilen muessen den Betrag EXAKT ergeben', () => {
    const positionen = terminalPositionen([
      { name: 'A', lineTotalCents: 100n },
      { name: 'B', lineTotalCents: 250n },
    ]);
    expect(positionenDeckenBetrag(positionen, 350)).toBe(true);
    expect(positionenDeckenBetrag(positionen, 351)).toBe(false);
    expect(positionenDeckenBetrag([], 0)).toBe(false);
  });
});

describe('deuteStand: die Fehlerbilder WAHR benennen', () => {
  it('PROCESSING ohne weiche Ablehnung → warten, ohne Hinweis', () => {
    const d = deuteStand({
      status: 'PROCESSING',
      fehlerbild: null,
      fehlerMeldung: null,
      weicheAblehnungen: 0,
    });
    expect(d).toEqual({ art: 'WARTEN', hinweis: null });
  });

  it('PROCESSING mit weicher girocard-Ablehnung → warten, MIT Hinweis (kein zweiter Anlauf!)', () => {
    const d = deuteStand({
      status: 'PROCESSING',
      fehlerbild: null,
      fehlerMeldung: null,
      weicheAblehnungen: 1,
    });
    expect(d.art).toBe('WARTEN');
    if (d.art === 'WARTEN') {
      expect(d.hinweis).toContain('abgelehnt');
      expect(d.hinweis).toContain('andere Karte');
    }
  });

  it('SUCCEEDED → Erfolg', () => {
    expect(
      deuteStand({ status: 'SUCCEEDED', fehlerbild: null, fehlerMeldung: null }),
    ).toEqual({ art: 'ERFOLG' });
  });

  it('KARTE_ABGELEHNT heisst „Karte abgelehnt", NIEMALS „Verbindung gestört"', () => {
    const d = deuteStand({
      status: 'FAILED',
      fehlerbild: 'KARTE_ABGELEHNT',
      fehlerMeldung: null,
    });
    expect(d.art).toBe('GESCHEITERT');
    if (d.art === 'GESCHEITERT') {
      expect(d.meldung).toContain('Karte abgelehnt');
      expect(d.meldung).not.toContain('Verbindung');
    }
  });

  it('ZEITUEBERSCHREITUNG sagt, dass KEINE Karte kam', () => {
    const d = deuteStand({
      status: 'FAILED',
      fehlerbild: 'ZEITUEBERSCHREITUNG',
      fehlerMeldung: null,
    });
    expect(d.art).toBe('GESCHEITERT');
    if (d.art === 'GESCHEITERT') expect(d.meldung).toContain('keine Karte');
  });

  it('ABBRUCH_AM_GERAET benennt den Abbruch am Leser', () => {
    const d = deuteStand({
      status: 'FAILED',
      fehlerbild: 'ABBRUCH_AM_GERAET',
      fehlerMeldung: null,
    });
    expect(d.art).toBe('GESCHEITERT');
    if (d.art === 'GESCHEITERT') expect(d.meldung).toContain('am Leser abgebrochen');
  });

  it('LESER_OFFLINE benennt den Leser, nicht die Karte', () => {
    const d = deuteStand({
      status: 'FAILED',
      fehlerbild: 'LESER_OFFLINE',
      fehlerMeldung: null,
    });
    expect(d.art).toBe('GESCHEITERT');
    if (d.art === 'GESCHEITERT') {
      expect(d.meldung).toContain('Leser');
      expect(d.meldung).toContain('nicht erreichbar');
    }
  });

  it('CANCELED (unser Abbrechen-Knopf) → ehrlich: abgebrochen, keine Belastung', () => {
    const d = deuteStand({ status: 'CANCELED', fehlerbild: null, fehlerMeldung: null });
    expect(d.art).toBe('GESCHEITERT');
    if (d.art === 'GESCHEITERT') {
      expect(d.meldung).toContain('abgebrochen');
      expect(d.meldung).toContain('Keine Belastung');
    }
  });

  /**
   * ⚠️ 01.08.2026: Hier stand ein Satz namens „FAILED ohne Fehlerbild traegt
   * die Server-Meldung woertlich weiter". Er gab `fehlerMeldung` einen
   * DEUTSCHEN Prüfwert („Der Anbieter hat die Zahlung verweigert.") und
   * verlangte, dass er unverändert auf dem Schirm landet.
   *
   * Der Prüfwert war höflicher als die Wirklichkeit. Das Feld wird auf dem
   * Server aus drei Stellen gefüllt, und alle drei sind Stripes eigener Text:
   *
   *   `lib/leser-zahlung-ereignis.ts:61`   fehler?.message
   *   `lib/leser-zahlung-ereignis.ts:74`   action?.failure_message
   *   `routes/stripe-terminal.ts:662`      start.detail
   *
   * Im Betrieb steht dort also „Your card was declined." Der Test hat den
   * englischen Durchgriff nicht nur übersehen, er hat ihn festgeschrieben.
   *
   * Nicht zu verwechseln mit `beschreibeStartFehler` weiter unten: dort ist
   * die Quelle `ApiError.message` vom EIGENEN Server, und der ist deutsch.
   * Der wörtliche Durchgriff dort bleibt richtig und unangetastet.
   */
  it('FAILED ohne Fehlerbild: Stripes englischer Satz erreicht den Schirm NICHT', () => {
    const d = deuteStand({
      status: 'FAILED',
      fehlerbild: null,
      // Wörtlich das, was Stripe in `failure_message` schickt.
      fehlerMeldung: 'Your card was declined.',
    });
    expect(d.art).toBe('GESCHEITERT');
    if (d.art === 'GESCHEITERT') {
      expect(d.meldung).not.toContain('declined');
      expect(d.meldung).toBe('Die Zahlung ist fehlgeschlagen. Keine Belastung erfolgt.');
      // Verloren ist er nicht: für die Fehlersuche liegt er in `technik`.
      expect(d.technik).toBe('Your card was declined.');
    }
  });

  it('ein bekanntes Fehlerbild schlägt Stripes Text weiterhin', () => {
    // Die Reihenfolge bleibt: kuratiertes deutsches Fehlerbild zuerst.
    const d = deuteStand({
      status: 'FAILED',
      fehlerbild: 'LESER_OFFLINE',
      fehlerMeldung: 'Your card was declined.',
    });
    if (d.art === 'GESCHEITERT') {
      // Der kuratierte deutsche Satz gewinnt; welcher genau, prüfen die Sätze
      // weiter oben. Hier zählt nur: Stripes Text ist es NICHT.
      expect(d.meldung).not.toContain('declined');
      expect(d.meldung).toMatch(/Leser|Kartenleser/);
      expect(d.technik).toBe('Your card was declined.');
    }
  });

  it('ohne Stripe-Text ist technik schlicht leer, nicht die Zeichenkette „null"', () => {
    const d = deuteStand({ status: 'FAILED', fehlerbild: null, fehlerMeldung: null });
    if (d.art === 'GESCHEITERT') expect(d.technik).toBeNull();
  });
});

describe('beschreibeStartFehler: ehrliche Saetze vor der ersten Belastung', () => {
  it('SERVICE_UNAVAILABLE (kein Stripe-Schluessel) → ruhige Erklaerung, kein Technik-Kauderwelsch', () => {
    const err = new ApiError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Stripe ist nicht konfiguriert',
      httpStatus: 503,
    });
    const text = beschreibeStartFehler(err);
    expect(text).toContain('Stripe');
    expect(text).toContain('nicht eingerichtet');
  });

  it('CONFLICT gibt den deutschen Server-Satz woertlich weiter', () => {
    const err = new ApiError({
      code: 'CONFLICT',
      message: 'Nur eine erfolgreiche Zahlung kann erstattet werden.',
      httpStatus: 409,
    });
    expect(beschreibeStartFehler(err)).toBe('Nur eine erfolgreiche Zahlung kann erstattet werden.');
  });
});

describe('der ruhige Takt', () => {
  it('pollt gemaechlich, nicht haemmernd (>= 1 Sekunde)', () => {
    expect(LESER_POLL_TAKT_MS).toBeGreaterThanOrEqual(1000);
  });
});
