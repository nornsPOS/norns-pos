/**
 * Ein Storno hat GENAU EINE Tür.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * `POST /api/transactions/finalize` nahm einen Storno entgegen, sobald
 * `stornoOfTransactionId` im Rumpf stand. Damit gab es zwei Wege für dieselbe
 * fiskalische Handlung, verschieden verriegelt:
 *
 *   transactions-storno.ts          finalize
 *   ─────────────────────────       ─────────────────────────────────────────
 *   requireStepUp IMMER             nur oberhalb der Betragsschwelle
 *   Pflichtgrund ab 8 Zeichen       kein Grund
 *   Tagebuchzeile mit Grund         keine
 *
 * Und der GESAMTE Riegelblock hing in `if (body.stornoOfTransactionId == null)`.
 * Übersprungen wurden damit: § 146a AO (die TSE), der Umsatzsteuer-Status nach
 * § 19, § 13b, § 10 GwG und § 259 StGB.
 *
 * Am Tresen: eine Kassiererin konnte den 400-Euro-Verkauf von gestern
 * zurückbuchen, ohne die zweite Bestätigung, ohne einen Satz zu hinterlassen,
 * warum. Und eine Kasse ohne eingerichtete Sicherungseinrichtung, die KEINEN
 * Verkauf abschliessen darf, konnte sehr wohl stornieren.
 *
 * ── WAS DIESER WÄCHTER SCHÜTZT ────────────────────────────────────────────
 *
 * Nicht den Wortlaut der Absage. Die EIGENSCHAFT: im Abschlussweg gibt es
 * KEINEN Zweig mehr, der wegen eines Stornos eine Prüfung überspringt. Wer
 * einen wieder einbaut, wird hier rot.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const FINALIZE = resolve(HIER, '../../src/routes/transactions-finalize.ts');
const STORNO = resolve(HIER, '../../src/routes/transactions-storno.ts');

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Ein Storno hat genau eine Tür', () => {
  const finalizeRoh = readFileSync(FINALIZE, 'utf8');
  const finalize = ohneKommentare(finalizeRoh);
  const storno = ohneKommentare(readFileSync(STORNO, 'utf8'));

  it('der Abschlussweg WEIST einen Storno ab', () => {
    expect(finalize).toMatch(/if\s*\(\s*body\.stornoOfTransactionId\s*!=\s*null\s*\)/);
    expect(finalize).toMatch(/throw new StornoGehoertAufDenStornowegError\(/);
  });

  /**
   * ⚠️ DER EIGENTLICHE SATZ.
   *
   * Nicht „die Absage existiert", sondern: es gibt KEINE Bedingung mehr, die
   * wegen eines Stornos etwas überspringt. Genau diese Form hatte den Schaden
   * angerichtet, und genau sie darf nicht zurückkommen.
   */
  it('⛔ KEIN Zweig überspringt wegen eines Stornos noch eine Prüfung', () => {
    const ueberspringt = /stornoOfTransactionId\s*==\s*null/;
    expect(
      finalize,
      'Im Abschlussweg steht wieder eine Bedingung der Form ' +
        '`stornoOfTransactionId == null`. Genau so wurde der ganze Riegelblock ' +
        'übersprungen: § 146a AO, § 19, § 13b, § 10 GwG, § 259 StGB.',
    ).not.toMatch(ueberspringt);
  });

  it('die Absage steht VOR der ersten fiskalischen Prüfung', () => {
    // Eine Absage hinter dem Riegelblock wäre wirkungslos für alles, was
    // davor läuft. Die Reihenfolge ist Teil der Eigenschaft.
    const iAbsage = finalize.indexOf('StornoGehoertAufDenStornowegError(');
    const iTse = finalize.indexOf('istSicherungseinrichtungEingerichtet(app.db)');
    const iStepUp = finalize.indexOf('totalExceedsStepUpThreshold(');
    expect(iAbsage).toBeGreaterThan(-1);
    expect(iTse).toBeGreaterThan(-1);
    expect(iStepUp).toBeGreaterThan(-1);
    expect(iAbsage, 'die Absage steht hinter dem TSE-Riegel').toBeLessThan(iTse);
    expect(iAbsage, 'die Absage steht hinter der Betragsschwelle').toBeLessThan(iStepUp);
  });

  it('die Absage NENNT den richtigen Weg, sie ist kein blosses Nein', () => {
    // Eine Sperre ohne Ausgang ist die Fehlerklasse, die dieses Haus schon
    // mehrfach getroffen hat. Der Satz muss sagen, wohin.
    const satz = /Eine Stornierung wird nicht über den Abschluss gebucht[\s\S]{0,400}?Rückgabe-Weg/;
    expect(finalizeRoh).toMatch(satz);
  });

  it('der ECHTE Storno-Weg trägt die Riegel, die der andere nicht hatte', () => {
    // Sonst wäre die Absage eine Verlegung des Problems, keine Behebung.
    expect(storno, 'Zweitbestätigung fehlt').toMatch(/requireStepUp/);
    expect(storno, 'Pflichtgrund fehlt').toMatch(/reason/);
    expect(storno, 'die Tagebuchzeile fehlt').toMatch(/stornoed_with_reason|ledgerEvents|auditLog/);
  });

  it('die Zweitbestätigung im Storno-Weg hängt NICHT an einem Betrag', () => {
    // Der Kern der Asymmetrie: im Abschlussweg galt sie erst ab der Schwelle.
    // Im Storno-Weg darf sie an keiner Bedingung hängen.
    const i = storno.indexOf('requireStepUp');
    expect(i).toBeGreaterThan(-1);
    const davor = storno.slice(Math.max(0, i - 300), i);
    expect(
      davor,
      'vor requireStepUp steht eine Betragsprüfung; damit wäre der Storno-Weg ' +
        'genauso durchlässig wie der Abschlussweg es war',
    ).not.toMatch(/totalExceedsStepUpThreshold|STEP_UP_THRESHOLD/);
  });
});
