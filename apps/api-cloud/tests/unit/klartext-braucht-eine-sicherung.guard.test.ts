/**
 * ════════════════════════════════════════════════════════════════════════
 *  JEDER WEG, DER KLARTEXT ENTSCHLUESSELT, IST GESICHERT
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 13.08.2026 ──────────────────────────────────────────────
 *
 * `geld-und-klartext-brauchen-eine-rolle.guard.test.ts` gibt es seit dem
 * 08.08.2026, und sein eigener Kopf sagt richtig:
 *
 *     „Eine abgeschriebene Liste von Routennamen driftet. Gelesen wird der
 *      echte Quelltext."
 *
 * Er liest den echten Quelltext, aber von genau ZWEI Dateien
 * (`stripe-terminal.ts`, `support-tickets.ts`). Auf Dateiebene ist er selbst
 * eine Namensliste. Gemessen:
 *
 *     grep -ln decrypt_pii apps/api-cloud/src/routes/*.ts   →  16 Dateien
 *
 * Fuenfzehn davon sieht er nie. `decrypt_pii` holt den Klartext eines
 * Kundennamens, einer Anschrift, einer Telefonnummer aus der Datenbank. Ein
 * ungesicherter Weg dorthin ist ein Datenleck, nicht ein Schoenheitsfehler.
 *
 * ── DREI SICHERUNGEN, ALLE DREI RICHTIG ────────────────────────────────────
 *
 * Gemessen an den 16 Dateien gibt es drei legitime Familien, und ein Waechter,
 * der nur eine kennt, meldet die anderen faelschlich als Loch:
 *
 *   PERSONAL   `requireAuth` + `requireRole`. Die Wege der Kasse und der
 *              Inhaber-App.
 *   KUNDE      `requireShopper`. Die Wege des Ladens im Netz. Sie haben
 *              bewusst KEINE Rolle: ein Kunde ist kein Personal. Sie binden
 *              statt dessen jede Abfrage an `req.shopper.id`.
 *   MASCHINE   Die Unterschrift des Absenders (`verifyStripeSignature`). Ein
 *              Webhook hat keinen Menschen, den man nach einer Rolle fragen
 *              koennte.
 *
 * ── WAS DIESER WAECHTER MISST ──────────────────────────────────────────────
 *
 * Er fegt ALLE Wege, die `decrypt_pii` benutzen, zerlegt sie an der
 * Routenanmeldung (`app.get`, `app.post`, …) und verlangt in JEDEM Abschnitt
 * eine der drei Sicherungen. Keine ist bevorzugt, aber KEINE ist auch keine.
 *
 * ⚠️ Er ersetzt den aelteren Waechter NICHT. Der misst zusaetzlich, WELCHE
 * Rolle an den Geldwegen steht und dass die Erstattung eine Bestaetigung am
 * Geraet verlangt. Das ist die schaerfere Frage an einer engeren Stelle;
 * dieser hier ist die breite Grundpflicht.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTEN = join(HIER, '../../src/routes');

/** Alle Wegdateien, die wirklich Klartext holen. Gefegt, nicht aufgezaehlt. */
function wegeMitKlartext(): Array<{ name: string; quelle: string }> {
  return readdirSync(ROUTEN)
    .filter((n) => n.endsWith('.ts'))
    .map((n) => ({ name: n, quelle: readFileSync(join(ROUTEN, n), 'utf8') }))
    .filter((d) => d.quelle.includes('decrypt_pii'));
}

/**
 * Die Abschnitte einer Datei, zerlegt an der ROUTENANMELDUNG.
 *
 * ⚠️ Absichtlich nicht an `requireAuth`, wie es der aeltere Waechter tut. Wer
 * an `requireAuth` zerlegt, sieht einen Weg, der GAR KEIN `requireAuth` hat,
 * ueberhaupt nicht, und genau der waere der schlimmste Fund.
 */
function wegabschnitte(quelle: string): string[] {
  const anmeldung = /\b(?:app|fastify|server)\s*\.\s*(?:get|post|put|patch|delete)\b/g;
  const stellen = [...quelle.matchAll(anmeldung)].map((m) => m.index ?? 0);
  return stellen.map((start, i) => quelle.slice(start, stellen[i + 1] ?? quelle.length));
}

/** Die drei Sicherungen, die dieses Haus kennt. */
const SICHERUNGEN: Array<{ name: string; muster: RegExp }> = [
  { name: 'Personal (Rolle)', muster: /requireRole\s*\(\s*req\s*,/ },
  { name: 'Kunde (Ladensitzung)', muster: /requireShopper\s*\(\s*req\s*\)/ },
  { name: 'Maschine (Unterschrift)', muster: /verifyStripeSignature|constructEvent/ },
];

describe('⛔ Jeder Weg, der Klartext entschluesselt, nennt eine Sicherung', () => {
  const dateien = wegeMitKlartext();

  it('es gibt ueberhaupt Wege mit Klartext zu messen', () => {
    // „null ist nicht gruen": faende die Suche nichts, waere alles unten
    // trivial erfuellt. Am 13.08.2026 waren es 16.
    expect(
      dateien.length,
      'Keine einzige Wegdatei benutzt `decrypt_pii`. Entweder wurde der Zugriff ' +
        'gekapselt, dann gehoert dieser Waechter umgestellt, oder er misst ins Leere.',
    ).toBeGreaterThanOrEqual(
      /*
       * 14.08.2026: die Untergrenze hiess 10. Mit der Trennung von warehouse14
       * fielen die Messenger-, Storefront- und Support-Wege, die Klartext
       * lasen; uebrig sind die Wege der Kasse selbst (gemessen: 7). Die
       * Grenze prueft weiterhin "null ist nicht gruen", nicht eine Anzahl.
       */
      5,
    );
  });

  it('und jede von ihnen hat ueberhaupt Wege', () => {
    const ohneWege = dateien.filter((d) => wegabschnitte(d.quelle).length === 0);
    expect(
      ohneWege.map((d) => d.name),
      'In diesen Dateien findet die Zerlegung keinen einzigen Weg. Dann misst ' +
        'sie dort nichts, und das faellt sonst niemandem auf.',
    ).toEqual([]);
  });

  it.each(dateien.map((d) => ({ name: d.name, quelle: d.quelle })))(
    '⛔ $name',
    ({ name, quelle }) => {
      const ungesichert: string[] = [];
      for (const abschnitt of wegabschnitte(quelle)) {
        if (SICHERUNGEN.some((s) => s.muster.test(abschnitt))) continue;
        // Der Anfang des Abschnitts nennt den Pfad; das reicht zum Finden.
        const kopf = abschnitt.slice(0, 160).replace(/\s+/g, ' ').trim();
        ungesichert.push(kopf);
      }
      expect(
        ungesichert,
        `In \`${name}\` gibt es Wege ohne jede Sicherung, und die Datei holt ` +
          'Klartext aus der Datenbank (`decrypt_pii`): Kundenname, Anschrift, ' +
          'Telefonnummer. Zulaessig ist genau eines von dreien: `requireRole` ' +
          'fuer Personal, `requireShopper` fuer einen Kunden im Laden, oder die ' +
          'Unterschrift des Absenders bei einem Webhook. Keine davon ist ' +
          'bevorzugt, aber KEINE ist auch keine.',
      ).toEqual([]);
    },
  );
});
