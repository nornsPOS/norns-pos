/**
 * ⛔ JEDER ABSCHLUSSWEG NIMMT DEN GUTSCHEIN-RIEGEL
 *
 * ── DER BEFUND VOM 12.08.2026 ────────────────────────────────────────────
 *
 * Fiel das Netz aus, während ein Gutschein angewandt war, ging der Beleg samt
 * VOUCHER-Zahlungsbein in den Ausgangskorb — und NICHTS buchte das Guthaben
 * ab. Der Abzug geschieht ausschliesslich in der redeem-Route, und die
 * braucht eine Vorgangskennung, die es offline nicht gibt. Der Kunde bezahlte
 * mit dem Gutschein, das Guthaben blieb voll: Geldverlust in Gutscheinhöhe.
 *
 * Der Riegel steht in `lib/gutschein-braucht-netz.ts`. Vier Wege führen zum
 * Abschluss (bar, geteilt, Karte, Stripe-Leser). Ein Riegel an drei von vier
 * wäre die Hausklasse „der halbe Fix an derselben Ampel" — und genau die hat
 * diesen Befund überhaupt erst erzeugt.
 *
 * ── WAS DIESER WÄCHTER MISST ─────────────────────────────────────────────
 *
 * Jede Stelle, die den Mutex `inFlightRef.current = true` setzt, ist ein
 * Abschlussweg. Über JEDER muss der Riegel stehen. Keine Namensliste: ein
 * fünfter Weg, den jemand morgen baut, wird mitgeprüft.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIALOG = resolve(HIER, 'BezahlenDialog.tsx');

describe('⛔ kein Abschlussweg ohne Gutschein-Riegel', () => {
  it('über JEDEM Mutex steht die Prüfung', () => {
    const zeilen = readFileSync(DIALOG, 'utf8').split('\n');
    const ungeschuetzt: string[] = [];
    let gefunden = 0;

    for (const [i, zeile] of zeilen.entries()) {
      if (!zeile.includes('inFlightRef.current = true;')) continue;
      gefunden += 1;
      // Die Prüfung muss unmittelbar davor stehen. Zehn Zeilen Fenster, und
      // Kommentarzeilen zählen NICHT — der Wächter misst den Gebrauch, nicht
      // die Erwähnung.
      const von = Math.max(0, i - 10);
      const davor = zeilen
        .slice(von, i)
        .filter((z) => {
          const t = z.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
      if (!davor.includes('gutscheinRiegelHaelt()')) {
        ungeschuetzt.push(`Zeile ${i + 1}`);
      }
    }

    expect(
      gefunden,
      'kein einziger Abschlussweg gefunden — misst dieser Wächter noch etwas?',
    ).toBeGreaterThan(0);
    expect(
      ungeschuetzt,
      `Diese Abschlusswege prüfen den Gutschein-Riegel NICHT. Fällt dort das Netz aus, während ein Gutschein angewandt ist, zahlt der Kunde mit einem Guthaben, das nie abgebucht wird:\n  ${ungeschuetzt.join('\n  ')}`,
    ).toEqual([]);
  });

  it('⚠️ und die falsche Zusage steht nirgends mehr', () => {
    // „Gutschein wird erst beim Synchronisieren verbucht" war gelogen: nichts
    // verbuchte ihn. Ein Satz, der etwas verspricht, das der Code nicht tut,
    // ist schlimmer als gar keiner.
    const inhalt = readFileSync(DIALOG, 'utf8');
    expect(inhalt).not.toContain('wird erst beim Synchronisieren verbucht');
  });
});
