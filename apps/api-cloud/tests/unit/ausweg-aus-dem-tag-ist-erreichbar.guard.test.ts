/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Riegel ohne erreichbaren Ausweg ist eine Sackgasse
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Der Tagesabschluss hält an, wenn der Tag Belege ohne TSE-Signatur trägt,
 * und lässt ihn nur mit `unsignierteBelegeBestaetigt` durch
 * (`closings-finalize.ts:497`). Der Riegel ist richtig: ein Tag mit
 * fehlenden Signaturen soll nicht aus Versehen zugehen.
 *
 * Gezählt: `unsignierteBelegeBestaetigt` kam im ganzen Baum sieben Mal vor.
 * Fünf im Server, ZWEI in Verbundtests. In den Oberflächen und in
 * `packages/api-client`: **null Mal.**
 *
 * Der gemeinsame Wrapper konnte das Feld gar nicht tragen:
 *
 *     finalize(client, businessDay?) → Rumpf höchstens { businessDay }
 *
 * Damit war der Tag nicht geschützt, sondern für immer offen. Der Mensch
 * bekam einen verständlichen Satz und keinen Weg. § 146 Abs. 1 Satz 2 AO
 * verlangt aber, dass der Tag geschlossen wird.
 *
 * ── 14.08.2026: DIE KETTE ENDET JETZT IN DER KASSE ─────────────────────
 *
 * Der Ausweg hing zuerst an der Inhaber-App. Die gehörte zu warehouse14 und
 * ist mit der Trennung gefallen. Der Tagesabschluss der Kasse lebt seither in
 * `TagesabschlussDialog.tsx`, samt Rückfrage und ausdrücklichem Knopf, und
 * GENAU dorthin misst dieser Wächter jetzt. Fällt der Dialog oder verliert er
 * die Durchreichung, ist der Tag wieder für immer offen.
 *
 * ── WAS DIESER WÄCHTER MISST ───────────────────────────────────────────
 *
 * Nicht die Oberfläche, sondern die KETTE: Server kennt das Feld, der
 * gemeinsame Wrapper kann es senden, die Kasse reicht es durch. Reisst
 * ein Glied, ist der Ausweg wieder unerreichbar, und niemand merkt es —
 * genau das ist ein Jahr lang passiert.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');

const lies = (p: string): string => readFileSync(join(REPO, p), 'utf8');

const FELD = 'unsignierteBelegeBestaetigt';

describe('Die Kette vom Riegel bis zum Menschen', () => {
  it('1. der SERVER kennt den Ausweg und hält ohne ihn an', () => {
    const q = lies('apps/api-cloud/src/routes/closings-finalize.ts');
    expect(q, 'das Feld fehlt im Rumpfschema').toContain(FELD);
    // Der Riegel selbst: ohne Bestätigung und mit offenen Belegen → Abbruch.
    expect(/pending\s*>\s*0\s*&&\s*!\s*bestaetigt/.test(q), 'der Riegel fehlt').toBe(true);
  });

  it('⛔ 2. der gemeinsame Wrapper KANN die Bestätigung senden', () => {
    /**
     * Das war das gerissene Glied. Der Rumpf war `{ businessDay }` und sonst
     * nichts, also konnte kein Klient den Ausweg je nehmen.
     */
    const q = lies('packages/api-client/src/domains/closings.ts');
    expect(q, 'der Wrapper kennt das Feld nicht').toContain(FELD);
  });

  it('⛔ 3. die KASSE reicht sie durch', () => {
    const dialog = lies('apps/tauri-pos/src/screens/kasse/TagesabschlussDialog.tsx');
    // Nicht nur erwähnt: der Aufruf selbst trägt die Bestätigung als Argument.
    expect(
      /closingsApi\.finalize\(\s*api,\s*tag,\s*unsignierteBestaetigt\s*\)/.test(dialog),
      'der Abschlussaufruf der Kasse reicht die Bestätigung nicht durch',
    ).toBe(true);
  });

  it('⛔ 4. und die Fläche bietet dem Menschen wirklich einen Knopf', () => {
    // Ohne diesen Satz wäre die Kette technisch vollständig und der Mensch
    // stünde trotzdem vor derselben Sackgasse. Klasse „gebaut und nie
    // angeschlossen", nur eine Ebene höher.
    const dialog = lies('apps/tauri-pos/src/screens/kasse/TagesabschlussDialog.tsx');
    expect(dialog, 'kein Zustand für die Rückfrage').toContain('unsignierteFrage');
    expect(dialog, 'der Knopf trägt keinen deutschen Satz').toContain('Trotzdem abschließen');
  });

  it('⚠️ 5. der Ausweg erscheint NUR bei diesem einen Grund', () => {
    /**
     * Ein Knopf, der bei jedem Fehler erschiene, wäre keine Bestätigung mehr,
     * sondern ein zweiter Versuch — und der Riegel wäre entwertet.
     *
     * Die Kasse filtert über `betrifftUnsignierteBelege`, und das Merkmal ist
     * der Wortlaut des Servers („keine TSE-Signatur"), nicht ein Fehlercode:
     * derselbe `ClosingConflictError` kommt für vier verschiedene Gründe.
     */
    const dialog = lies('apps/tauri-pos/src/screens/kasse/TagesabschlussDialog.tsx');
    expect(
      /export function betrifftUnsignierteBelege[\s\S]{0,120}keine TSE-Signatur/.test(dialog),
      'der Filter auf den einen Grund fehlt',
    ).toBe(true);
    expect(
      /betrifftUnsignierteBelege\(/.test(dialog.slice(dialog.indexOf('function TagesabschlussDialog'))),
      'der Filter wird im Dialog nicht benutzt',
    ).toBe(true);
  });
});
