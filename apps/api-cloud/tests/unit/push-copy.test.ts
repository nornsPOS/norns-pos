/**
 * Die Kurztexte für Kunden-Benachrichtigungen — vollständig in JEDER Sprache.
 *
 * WARUM ES DIESEN TEST GIBT
 * `customerPushCopy` liest aus einer Tabelle pro Sprache. Fehlt in einer davon
 * ein Anlass, liefert der Zugriff `undefined`, und der Aufruf von `.body(ref)`
 * wirft — mitten im Einreihen einer Meldung, also im worker, also erst in der
 * Produktion und nur für die eine betroffene Sprache. Bis zum 25.07.2026 gab es
 * für diese Tabellen KEINEN einzigen Test; ein vergessenes Arabisch wäre still
 * durchgegangen. Genau das prüft diese Datei, für alle Anlässe und alle
 * dreizehn Sprachen auf einmal.
 *
 * Der Test kennt die Liste der Sprachen NICHT auswendig, sondern leitet sie aus
 * einer Sprache ab, die sicher vollständig ist (Deutsch, die Rückfallsprache).
 * So kann er nicht dadurch grün bleiben, dass jemand eine Sprache samt Eintrag
 * in der Erwartungsliste entfernt.
 */
import { describe, expect, it } from 'vitest';

import { type CustomerPushKind, customerPushCopy } from '@norns/email';

/** Alle Anlässe. Kommt ein neuer dazu, MUSS er hier stehen, sonst prüft ihn niemand. */
const ANLAESSE: CustomerPushKind[] = [
  'order_accepted',
  'order_ready',
  'order_cancelled',
  'reservation_expiring',
];

/** Die Sprachen des Shops. */
const SPRACHEN = [
  'de',
  'en',
  'ar',
  'tr',
  'fr',
  'es',
  'it',
  'nl',
  'pl',
  'pt',
  'da',
  'sv',
  'uk',
] as const;

describe('customerPushCopy', () => {
  it('liefert für JEDEN Anlass in JEDER Sprache echten Text', () => {
    const luecken: string[] = [];
    for (const sprache of SPRACHEN) {
      for (const anlass of ANLAESSE) {
        const c = customerPushCopy(anlass, sprache).ref('BST-0001');
        if (!c.title || c.title.trim().length === 0) luecken.push(`${sprache}/${anlass}: Titel leer`);
        if (!c.body || c.body.trim().length === 0) luecken.push(`${sprache}/${anlass}: Text leer`);
        if (c.title?.includes('undefined') || c.body?.includes('undefined')) {
          luecken.push(`${sprache}/${anlass}: enthält "undefined"`);
        }
      }
    }
    expect(luecken).toEqual([]);
  });

  it('trägt die Bestellnummer IM Text, damit die Meldung ungeöffnet etwas sagt', () => {
    for (const sprache of SPRACHEN) {
      for (const anlass of ANLAESSE) {
        const c = customerPushCopy(anlass, sprache).ref('BST-4711');
        expect(c.body, `${sprache}/${anlass} nennt die Nummer nicht`).toContain('BST-4711');
      }
    }
  });

  it('fällt bei unbekannter Sprache auf Deutsch, nie auf Leere', () => {
    for (const anlass of ANLAESSE) {
      const de = customerPushCopy(anlass, 'de').ref('BST-1');
      for (const unbekannt of ['kl', 'xx-YZ', '', null, undefined]) {
        const c = customerPushCopy(anlass, unbekannt).ref('BST-1');
        expect(c.title).toBe(de.title);
        expect(c.body).toBe(de.body);
      }
    }
  });

  it('die Fristmeldung sagt NICHT "morgen" — das Fenster ist vierundzwanzig Stunden', () => {
    // Der Job erinnert, sobald die Frist innerhalb der nächsten 24 Stunden
    // endet. Sie kann also in zwei Stunden enden. Ein Text, der "morgen" oder
    // "tomorrow" verspricht, wäre dann schlicht falsch.
    const verboten = /\bmorgen\b|\btomorrow\b|\bmañana\b|\bdemain\b|\bdomani\b/i;
    for (const sprache of SPRACHEN) {
      const c = customerPushCopy('reservation_expiring', sprache).ref('BST-9');
      expect(`${c.title} ${c.body}`, `${sprache} verspricht einen konkreten Tag`).not.toMatch(
        verboten,
      );
    }
  });
});
