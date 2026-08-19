/**
 * ════════════════════════════════════════════════════════════════════════
 *  Wer Geld bewegt oder Klartext liest, braucht eine ROLLE
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Zwei Stellen, dieselbe Lücke: `requireAuth` allein.
 *
 * **Der Kartenleser.** Das REGISTRIEREN eines Lesers verlangte ADMIN, das
 * BEWEGEN VON GELD verlangte gar nichts weiter:
 *
 *     POST /api/stripe/terminal/payments          belasten   — nur requireAuth
 *     POST /api/stripe/terminal/payments/:id/cancel  abbrechen — nur requireAuth
 *     POST /api/stripe/terminal/payments/:id/refund  erstatten — nur requireAuth
 *
 * **Das Support-Postfach.** Seine Abfragen rufen `decrypt_pii` auf
 * Kundennamen, Absender, Empfänger und Nachrichtentexte. Jeder Träger
 * irgendeiner gültigen Anmeldung bekam sie im Klartext — auch ein
 * Programmschlüssel, der für etwas ganz anderes ausgestellt wurde.
 *
 * ── ⚠️ ROLLE UND BESTÄTIGUNG SIND ZWEI VERSCHIEDENE FRAGEN ─────────────
 *
 * `requireRole` sagt WER. `requireStepUp` sagt, DASS ER ES GERADE WILL.
 * In diesem Haus wurde schon einmal das eine durch das andere ERSETZT, und
 * das riss an sechs Stellen ein Loch. Hier wird nichts ersetzt: an den
 * betroffenen Wegen stand vorher WEDER das eine NOCH das andere.
 *
 * Die Erstattung bekommt beides. Sie schickt Geld hinaus, und der Storno
 * verlangt im selben Haus die Bestätigung ohne Ausnahme und ohne
 * Betragsgrenze.
 *
 * ── WARUM DIESER WÄCHTER DIE DATEIEN LIEST ─────────────────────────────
 *
 * Eine abgeschriebene Liste von Routennamen driftet. Gelesen wird der echte
 * Quelltext: jeder Weg in diesen Dateien MUSS eine Rolle nennen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTEN = join(HIER, '../../src/routes');

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⚠️ WEDER FESTE FENSTER NOCH KOMMENTARE. BEFUND VOM 13.08.2026.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Dieser Wächter mass an drei Stellen über eine feste Zeichenzahl
 * (`slice(0, 400)`, `slice(i, i + 1800)`, `slice(i, i + 1200)`) und las den
 * Quelltext MIT Kommentaren. Das ergibt beide Fehlerrichtungen:
 *
 * FALSCH ROT. Zwischen `requireAuth` und `requireRole` darf nichts Längeres
 * stehen als 400 Zeichen. In diesem Haus steht dort aber regelmässig ein
 * erklärender Absatz. Wer den Grund einer Rollenwahl aufschreibt, macht den
 * Wächter rot, ohne die Sicherung anzufassen.
 *
 * FALSCH GRÜN. Ein Kommentar, der `requireRole(req,` bloss ERWÄHNT, etwa um
 * zu erklären, warum er hier fehlt, erfüllte die Prüfung.
 *
 * Und die Zerlegung am `requireAuth` hat einen dritten blinden Fleck: ein Weg
 * GANZ OHNE `requireAuth` erzeugt keinen Abschnitt und wird deshalb überhaupt
 * nicht geprüft. Das wäre der schlimmste Fund gewesen.
 *
 * Zerlegt wird jetzt an der ROUTENANMELDUNG, gemessen wird der ganze
 * Abschnitt bis zur nächsten, und zwar ohne Kommentare.
 */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Die Abschnitte einer Datei, zerlegt an der Routenanmeldung. */
function abschnitte(quelle: string): string[] {
  const anmeldung = /\b(?:app|fastify|server)\s*\.\s*(?:get|post|put|patch|delete)\b/g;
  const stellen = [...quelle.matchAll(anmeldung)].map((m) => m.index ?? 0);
  return stellen.map((start, i) => quelle.slice(start, stellen[i + 1] ?? quelle.length));
}

/** Der Abschnitt, in dem dieser Pfad angemeldet wird. Kein festes Fenster. */
function abschnittMitPfad(quelle: string, pfad: string): string | undefined {
  return abschnitte(quelle).find((a) => a.includes(pfad));
}

describe('⛔ Der Kartenleser: jeder Weg nennt eine Rolle', () => {
  const quelle = ohneKommentare(readFileSync(join(ROUTEN, 'stripe-terminal.ts'), 'utf8'));

  it('findet überhaupt Wege — sonst misst dieser Wächter nichts', () => {
    expect(abschnitte(quelle).length, 'keine Route gefunden').toBeGreaterThanOrEqual(5);
  });

  it('⛔ JEDER angemeldete Weg nennt eine Rolle, auch einer ohne requireAuth', () => {
    const ohne = abschnitte(quelle).filter(
      (a) => !/requireRole\s*\(\s*req\s*,/.test(a),
    );
    expect(
      ohne.length,
      `${ohne.length} Weg(e) im Kartenleser ohne Rollenprüfung. Der erste beginnt mit:\n` +
        `${ohne[0]?.slice(0, 200) ?? ''}`,
    ).toBe(0);
  });

  it('⚠️ die ERSTATTUNG verlangt zusätzlich die Bestätigung am Gerät', () => {
    // Geld geht hinaus. Der Storno verlangt sie im selben Haus ohne Ausnahme.
    const abschnitt = abschnittMitPfad(quelle, "'/api/stripe/terminal/payments/:id/refund'");
    expect(abschnitt, 'die Erstattungsroute fehlt').toBeDefined();
    expect(/requireStepUp\s*\(\s*req\s*\)/.test(abschnitt ?? ''), 'keine Bestätigung').toBe(true);
    // ⚠️ Und die Rolle steht DANEBEN, nicht anstelle. Genau dieser Tausch hat
    // in diesem Haus schon einmal ein Loch gerissen.
    expect(/requireRole\s*\(\s*req\s*,/.test(abschnitt ?? ''), 'die Rolle wurde ersetzt').toBe(true);
  });

  // 14.08.2026: der support-tickets-Fall stand hier; die Route fiel mit dem
  // Messenger-Buendel bei der Trennung von warehouse14.


  it('⛔ JEDER angemeldete Weg nennt eine Rolle, auch einer ohne requireAuth', () => {
    const ohne = abschnitte(quelle).filter(
      (a) => !/requireRole\s*\(\s*req\s*,/.test(a),
    );
    expect(
      ohne.length,
      `${ohne.length} Weg(e) im Postfach ohne Rollenprüfung. Der erste beginnt mit:\n` +
        `${ohne[0]?.slice(0, 200) ?? ''}`,
    ).toBe(0);
  });

  it('⚠️ und zwar für CASHIER UND ADMIN, nicht nur den Inhaber', () => {
    // Die Anfragenfläche der Kasse ist absichtlich gebaut. Ein Riegel, der
    // die tägliche Arbeit sperrt, wird abgeschaltet, und dann schützt er
    // gar nichts mehr.
    expect(quelle).toMatch(/requireRole\s*\(\s*req\s*,\s*'CASHIER'\s*,\s*'ADMIN'\s*\)/);
  });
});
