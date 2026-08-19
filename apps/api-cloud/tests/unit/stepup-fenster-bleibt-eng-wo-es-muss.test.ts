/**
 * ════════════════════════════════════════════════════════════════════════
 *  Das längere Step-up-Fenster erreicht KEINE fiskalische Tür
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * `requireStepUp` nimmt seit jeher ein `maxAgeMinutes`. Gemessen: 17
 * Aufrufstellen, NULL davon setzte es. Ein Regler, gebaut und nirgends
 * angeschlossen — deshalb kostete das zweite Anlegen eines Mitarbeiters
 * innerhalb einer Stunde dieselbe Codeeingabe wie ein Storno.
 *
 * ── ⚠️ WARUM DIESER WÄCHTER WICHTIGER IST ALS DER FIX ──────────────────
 *
 * Ein längeres Fenster ist eine Lockerung. Wandert es je auf den
 * Tagesabschluss, den Storno, einen Pflichtauszug oder das Scharfschalten
 * der TSE, ist ein Riegel nach § 146 Abs. 4 AO weicher geworden, und
 * niemand merkt es: die Fläche sieht danach genauso aus.
 *
 * Hier wird gemessen, dass genau das nicht passiert.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ROUTEN = join(HIER, '../../src/routes');

/**
 * Die Türen, die ihr enges Fenster BEHALTEN müssen.
 *
 * ⚠️ Diese Liste ist bewusst eine Datei-Liste und keine Namensliste: eine
 * Namensliste wird blind, sobald jemand eine Datei umbenennt. Deshalb prüft
 * der letzte Fall zusätzlich, dass jede genannte Datei WIRKLICH existiert.
 */
const ENG: readonly string[] = [
  'closing-export.ts', // die drei Pflichtauszuege
  'closings-finalize.ts', // Tagesabschluss, § 146 Abs. 1 Satz 2 AO
  'transactions-storno.ts', // Storno
  'tse-einrichtung.ts', // die Kasse fiskalisch scharf schalten
  'customer-erasure.ts', // unwiderrufliche Loeschung
  'customer-kyc-documents.ts', // Ausweisbilder
  'stripe-terminal.ts', // der Geldweg
  'compliance.ts',
  'api-keys.ts', // ein Zugang, der das Haus VERLAESST
];

function lies(datei: string): string {
  return readFileSync(join(ROUTEN, datei), 'utf8');
}

describe('⛔ Die fiskalischen Türen behalten ihr enges Fenster', () => {
  it('⚠️ jede genannte Datei gibt es wirklich', () => {
    /**
     * Ein Wächter mit einer Namensliste wird blind, sobald ein Eintrag ins
     * Leere zeigt: er prüft dann nichts und bleibt grün. Diese Falle hat im
     * Haus schon einmal zugeschlagen.
     */
    const vorhanden = new Set(readdirSync(ROUTEN));
    for (const d of ENG) {
      expect(vorhanden.has(d), `${d} steht in der Liste, aber nicht im Ordner`).toBe(true);
    }
  });

  it('⛔ keine dieser Türen setzt ein längeres Fenster', () => {
    for (const d of ENG) {
      const q = lies(d);
      expect(q, `${d} hat ein laengeres Step-up-Fenster bekommen`).not.toMatch(
        /requireStepUp\(\s*req\s*,/,
      );
      expect(q, `${d} nennt die Verwaltungsfrist`).not.toContain('STEP_UP_VERWALTUNG_MINUTEN');
    }
  });

  it('⚠️ und es gibt sie überhaupt noch, diese Türen', () => {
    // null ist nicht grün: verschwände `requireStepUp` aus einer Datei, wäre
    // der Fall oben auch erfüllt — und ein Riegel wäre ganz weg.
    for (const d of ENG) {
      expect(lies(d), `${d} hat gar keinen Step-up mehr`).toContain('requireStepUp(req)');
    }
  });
});

describe('⚠️ Und der Regler bleibt ungenutzt — als Entscheidung', () => {
  it('⛔ keine einzige Route setzt ein längeres Fenster', () => {
    /**
     * Am 08.08.2026 wurde der Umbau gemacht: `admin-staff` und `products`
     * bekamen 30 Minuten. Der Wächter `code-nur-fuer-unwiderrufliches` wurde
     * ROT — die vier Türen stehen mit eigener Begründung auf Basels Liste
     * vom 05.08.2026 („Macht über andere: wer darf handeln, und womit").
     *
     * Der Umbau wurde zurückgenommen. Diese Zeile hält fest, dass er nicht
     * durch eine Hintertür zurückkommt.
     */
    const alle = readdirSync(ROUTEN).filter((d) => d.endsWith('.ts') && !d.includes('.test.'));
    const mitFenster = alle.filter((d) => /requireStepUp\(\s*req\s*,/.test(lies(d)));
    expect(mitFenster, 'eine Route hat ein laengeres Step-up-Fenster bekommen').toEqual([]);
  });

  it('⚠️ und es gibt überhaupt Routen mit Step-up', () => {
    // null ist nicht grün: verschwände `requireStepUp` ganz, wäre der Fall
    // oben auch erfüllt.
    const alle = readdirSync(ROUTEN).filter((d) => d.endsWith('.ts') && !d.includes('.test.'));
    const mitCode = alle.filter((d) => lies(d).includes('requireStepUp(req)'));
    expect(mitCode.length).toBeGreaterThanOrEqual(9);
  });
});
