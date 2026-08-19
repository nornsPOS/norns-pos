/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ JEDER AUSGANG SPEICHERT. AUCH DER, DER RÜCKWÄRTS FÜHRT.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 14.08.2026 ─────────────────────────────────────────────
 *
 * Der Assistent hatte VIER Ausgänge und speicherte an EINEM:
 *
 *     weiter              speicherte
 *     Zurück              rief blank `setWo(wo - 1)`
 *     Später einrichten   rief blank `onVerlassen()`
 *     Fertig              lief über `weiter`, also gedeckt
 *
 * Wer die Steuernummer eintippte und dann zurückblätterte, um den
 * Firmennamen zu berichtigen, verlor die Steuernummer. Ohne Meldung, ohne
 * Spur, und beim nächsten Vorwärtsblättern stand das Feld wieder leer.
 *
 * ── WARUM DAS SCHWERER WIEGT ALS EIN GEWÖHNLICHER FEHLER ──────────────────
 *
 * Der Kopf derselben Datei verspricht wörtlich:
 *
 *     „JEDER SCHRITT SPEICHERT FÜR SICH. Nicht erst am Ende. Wer bei
 *      Schritt drei das Fenster schliesst, findet beim nächsten Start die
 *      ersten zwei ausgefüllt vor."
 *
 * Zwei von vier Ausgängen hielten dieses Versprechen nicht. Das ist die
 * Hausklasse „Dokument verspricht, was der Code nicht tut", und sie stand
 * hier in der Datei selbst, drei Bildschirme über der Stelle.
 *
 * ── WAS DIESER WÄCHTER MISST ──────────────────────────────────────────────
 *
 * Nicht, dass das Wort „speichern" irgendwo vorkommt. Sondern dass KEIN
 * Ausgang an der einen Tür vorbeigeht.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ASSISTENT = resolve(HIER, 'EinrichtungsAssistent.tsx');

/** Kommentare weg, Zeilenumbrüche behalten. Eine Erwähnung ist kein Gebrauch. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => davor);
}

describe('⛔ Der Einrichtungsassistent verliert keine Eingabe', () => {
  const roh = readFileSync(ASSISTENT, 'utf8');
  const quelle = ohneKommentare(roh);

  it('es gibt überhaupt einen Assistenten zu messen', () => {
    // „null ist nicht grün": wäre die Datei leer, wäre alles unten trivial.
    expect(roh.length).toBeGreaterThan(4000);
    expect(quelle).toContain('EinrichtungsAssistent');
  });

  it('⛔ es gibt EINE Tür, durch die jeder Ausgang geht', () => {
    expect(
      /const\s+ausgang\s*=/.test(quelle),
      'Es gibt keine gemeinsame Ausgangstür. Dann muss jeder einzelne Ausgang ' +
        'ans Speichern denken, und genau das hat am 14.08.2026 zweimal gefehlt.',
    ).toBe(true);
    // Und sie speichert wirklich, statt nur zu heissen.
    const tuer = quelle.slice(quelle.indexOf('const ausgang'), quelle.indexOf('const ausgang') + 700);
    expect(tuer, 'die Ausgangstür speichert nicht').toMatch(/speichern\.mutateAsync/);
  });

  it('⛔ KEIN Ausgang blättert oder verlässt an der Tür vorbei', () => {
    /*
     * Gemessen wird der GEBRAUCH: ein blankes `setWo(...)` oder ein blankes
     * `onVerlassen()` in einem Knopf ist genau der Fehler. Erlaubt sind sie
     * nur INNERHALB der Tür und in der Wiederaufnahme beim Laden.
     */
    const verstoesse: string[] = [];
    for (const m of quelle.matchAll(/onClick=\{([^}]*)\}/g)) {
      const griff = m[1] ?? '';
      const zeile = quelle.slice(0, m.index ?? 0).split('\n').length;
      const blankSetWo = /setWo\(/.test(griff) && !/ausgang|zurueck|weiter/.test(griff);
      const blankVerlassen = /onVerlassen\b/.test(griff) && !/ausgang|spaeter/.test(griff);
      if (blankSetWo || blankVerlassen) verstoesse.push(`Zeile ${zeile}: ${griff.trim().slice(0, 70)}`);
    }
    expect(
      verstoesse,
      'Diese Knöpfe blättern oder verlassen, OHNE vorher zu speichern. Wer auf ' +
        'diesem Schritt etwas getippt hat, verliert es lautlos. Sie müssen über ' +
        '`ausgang(...)` gehen.',
    ).toEqual([]);
  });

  it('⛔ alle drei benannten Ausgänge existieren wirklich', () => {
    // Sonst wäre der Satz oben grün, weil es gar keine Knöpfe mehr gibt.
    for (const name of ['const weiter', 'const zurueck', 'const spaeter']) {
      expect(quelle, `${name} fehlt`).toContain(name);
    }
    expect(quelle).toContain('void zurueck()');
    expect(quelle).toContain('void spaeter()');
  });

  it('⛔ und die Werkbank zeigt den Beleg WIRKLICH', () => {
    /*
     * Basels Klage war die fehlende Bildsprache. Eine Zeichnungsdatei, die
     * niemand einbindet, wäre die Hausklasse „Schalter ohne Ausgang": schön
     * gebaut, nie gesehen.
     */
    expect(quelle).toContain('<Belegstreifen');
    expect(quelle).toContain('<Faden');
    // Und der Beleg liest den ENTWURF, sonst bewegt er sich erst beim Blättern.
    expect(quelle).toMatch(/ladenname=\{[^}]*entwurf\[/);
  });
});
