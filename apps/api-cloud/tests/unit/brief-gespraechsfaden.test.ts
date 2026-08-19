/**
 * Ein Vorgang, ein Gespraech.
 *
 * Zu EINER Reservierung schreibt das Haus bis zu fuenf Mal: bestaetigt,
 * angenommen, abholbereit, die Frist laeuft, abgesagt. Ohne einen gemeinsamen
 * Schluessel legte jedes Postfach fuenf getrennte Gespraeche an — die Absage
 * stand ganz woanders als die Bestaetigung, die sie aufhebt.
 *
 * Dieser Test haelt fest, WELCHE Briefe den Faden tragen muessen und welche
 * bewusst allein stehen. Er prueft die Verfassung, nicht die Zustellung; die
 * Kopfzeilen daraus prueft `apps/worker/tests/unit/mail-zustellung.test.ts`.
 *
 * ⚠ EINE FALLE BEIM PRUEFEN DIESES TESTS
 * `@norns/email` loest hier auf das GEBAUTE `dist` auf, nicht auf die
 * Quelle. Wer eine Aenderung an `packages/email/src` gegenpruefen will (etwa
 * um zu sehen, ob dieser Test sie wirklich faengt), MUSS vorher bauen:
 *
 *   pnpm --filter @norns/email build
 *
 * Sonst laeuft der Test gegen den alten Stand und meldet gruen, obwohl die
 * Quelle laengst kaputt ist. Genau das ist am 25.07.2026 einmal passiert und
 * haette eine Rot-Gruen-Probe als bestanden durchgehen lassen.
 */
import { describe, expect, it } from 'vitest';

import {
  composeBroadcast,
  composeDeadlineExtended,
  composeExpiryReminder,
  composeItemRemoved,
  composeOrderAccepted,
  composeOrderReady,
  composeReservationCancelled,
  composeReservationConfirmed,
  composeReservationExpired,
  composeSupportReply,
  composeWelcome,
} from '@norns/email';

const BESTELLUNG = 'BST-2026-000042';
const FRIST = new Date('2026-07-28T15:00:00Z');

describe('Der Gespraechsfaden eines Briefes', () => {
  it('traegt bei JEDEM Brief zur Bestellung dieselbe Bestellnummer', () => {
    const briefe = [
      composeReservationConfirmed('Basel', BESTELLUNG, 2, '560.50', 'de', undefined, FRIST),
      composeOrderAccepted('Basel', BESTELLUNG, 'de'),
      composeOrderReady('Basel', BESTELLUNG, 'de'),
      composeItemRemoved('Basel', BESTELLUNG, 'Preussen 1867', 2, 'de'),
      composeDeadlineExtended('Basel', BESTELLUNG, FRIST, 'de'),
      composeExpiryReminder('Basel', BESTELLUNG, FRIST, 'de'),
      composeReservationCancelled('Basel', BESTELLUNG, 'de', 'im Laden verkauft'),
      composeReservationExpired('Basel', BESTELLUNG, 'de'),
    ];
    for (const brief of briefe) {
      expect(brief.threadKey, brief.template).toBe(BESTELLUNG);
    }
  });

  it('haelt den Faden in JEDER Sprache, auch von rechts nach links', () => {
    // Der Faden ist eine Kennung, keine Uebersetzung. Ginge er in einer
    // Sprache verloren, saehe ein arabischer Leser fuenf Gespraeche und ein
    // deutscher eines — und niemand wuerde es je bemerken.
    for (const sprache of ['de', 'en', 'ar', 'tr', 'ru']) {
      expect(composeOrderReady('Basel', BESTELLUNG, sprache).threadKey, sprache).toBe(BESTELLUNG);
    }
  });

  it('haengt eine Antwort an die Anfrage, die sie beantwortet', () => {
    const antwort = composeSupportReply('Basel', 'TIC-2026-000001', 'Gern, kommen Sie vorbei.', 'de');
    expect(antwort.threadKey).toBe('TIC-2026-000001');
  });

  it('laesst Willkommen und Rundschreiben bewusst allein stehen', () => {
    // Beide gehoeren zu keinem Vorgang. Sie an irgendetwas zu haengen waere
    // erfunden, nicht hilfreich.
    expect(composeWelcome('Basel', 'de').threadKey).toBeUndefined();
    expect(composeBroadcast('Frohe Ostern', 'Wir haben Neues.', 'Basel', 'de').threadKey).toBeUndefined();
  });

  it('laesst einen unbrauchbaren Bezug lieber weg als ihn zu verstuemmeln', () => {
    // Der CHECK auf email_outbox.thread_key erlaubt nur [A-Za-z0-9._-]. Ein
    // halb abgeschnittener Bezug wuerde zwei fremde Vorgaenge in EIN Gespraech
    // fassen — schlimmer als gar kein Faden.
    expect(composeOrderReady('Basel', 'BST 2026 mit Leerzeichen', 'de').threadKey).toBeUndefined();
    expect(composeOrderReady('Basel', '', 'de').threadKey).toBeUndefined();
    expect(composeOrderReady('Basel', 'x'.repeat(121), 'de').threadKey).toBeUndefined();
  });
});
