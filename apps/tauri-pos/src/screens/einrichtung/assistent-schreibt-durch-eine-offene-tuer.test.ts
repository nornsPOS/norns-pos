/**
 * ════════════════════════════════════════════════════════════════════════
 *  ⛔ Jedes Feld des Assistenten geht durch eine OFFENE Tür
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 11.08.2026 ───────────────────────────────────────────
 *
 * Der vierte Schritt „Wer verantwortet" liess sich NICHT speichern. Gemessen
 * über die echten HTTP-Wege, jedes Feld genau so geschrieben, wie
 * `EinrichtungsAssistent.tsx` es schreibt:
 *
 *     betrieb.verantwortlich_aufzeichnungen -> 400
 *       {"error":{"code":"VALIDATION_ERROR",
 *         "message":"Setting \"…\" is not editable from the Owner Desktop."}}
 *     betrieb.geldwaeschebeauftragter       -> 400
 *     betrieb.sicherungsort                 -> 400
 *
 * Wanderung 0134 hatte die drei Fächer angelegt, `verfahrensdokumentation.ts`
 * liest sie — nur die Positivliste `EDITABLE_SETTINGS` in
 * `apps/api-cloud/src/routes/settings.ts` kannte sie nicht. Und weil der
 * Assistent bei einem Fehler abbricht, kam der Händler nicht weiter.
 *
 * ── WARUM DER BESTEHENDE WÄCHTER DAS NICHT SAH ─────────────────────────
 *
 * `einrichtungs-schluessel.test.ts` misst „liest der Motor diesen Schlüssel
 * irgendwo". Das war für alle drei WAHR — sie werden gelesen. Nur schreiben
 * konnte sie niemand. Zwischen „wird gelesen" und „darf geschrieben werden"
 * liegt genau eine Positivliste, und die stand nirgends unter Aufsicht.
 *
 * ── WAS DIESER WÄCHTER MISST ───────────────────────────────────────────
 *
 * Jeder Schlüssel, den der Assistent schreibt, muss in `EDITABLE_SETTINGS`
 * als EIGENSCHAFT stehen. Gemessen wird der GEBRAUCH, nicht die Erwähnung:
 * Kommentarzeilen werden vorher weggeschnitten, und gelesen wird nur der
 * Block zwischen `const EDITABLE_SETTINGS = {` und seiner schliessenden
 * Klammer — ein Schlüsselname, der irgendwo sonst in der Datei vorkommt,
 * zählt nicht.
 *
 * Der HTTP-Beweis dazu liegt in
 * `apps/api-cloud/tests/integration/belegkopf-gehoert-dem-haendler.test.ts`:
 * dort fährt jedes Feld wirklich als PATCH gegen den echten Server. Dieser
 * Wächter hier ist der schnelle, der beim Bearbeiten der Fragenliste sofort
 * anschlägt.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { alleSchluessel } from './einrichtungs-schritte.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const SETTINGS_TS = join(HIER, '../../../../api-cloud/src/routes/settings.ts');

/** Die Datei ohne Kommentarzeilen — sonst zählte eine Erwähnung als Gebrauch. */
function ohneKommentare(text: string): string {
  return text
    .split('\n')
    .filter((z) => {
      const t = z.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/**
 * Die Schlüssel, die `PATCH /api/settings/:key` wirklich annimmt.
 *
 * Gelesen wird ausschliesslich der Rumpf von `EDITABLE_SETTINGS`. Die Grenze
 * ist die erste Zeile, die auf Spalte 0 mit `};` endet — so wie die Datei sie
 * schreibt.
 */
function tuerOeffnetFuer(): Set<string> {
  const roh = readFileSync(SETTINGS_TS, 'utf8');
  const anfang = roh.indexOf('const EDITABLE_SETTINGS');
  if (anfang < 0) {
    throw new Error(
      `EDITABLE_SETTINGS nicht gefunden in ${SETTINGS_TS} — dieser Wächter misst dann nichts.`,
    );
  }
  const rest = roh.slice(anfang);
  const ende = rest.indexOf('\n};');
  if (ende < 0) {
    throw new Error('Das Ende von EDITABLE_SETTINGS nicht gefunden — Wächter blind.');
  }
  const block = ohneKommentare(rest.slice(0, ende));

  const gefunden = new Set<string>();
  // Eine Eigenschaft: 'schluessel': { …   oder   [KONSTANTE]: { …
  for (const t of block.matchAll(/'([a-z0-9_.]+)'\s*:\s*\{/g)) gefunden.add(t[1] as string);
  return gefunden;
}

describe('⛔ Der Assistent schreibt durch eine offene Tür', () => {
  it('die Positivliste wird überhaupt gefunden — sonst prüft dieser Satz nichts', () => {
    const offen = tuerOeffnetFuer();
    expect(offen.size, 'leere Positivliste gelesen').toBeGreaterThan(10);
    // Gegenprobe an einem Schlüssel, der dort seit dem 28.07.2026 steht.
    expect(offen.has('shop.legal_name')).toBe(true);
    // Und die Tür ist eine Tür: was nie in der Liste stand, ist nicht drin.
    expect(offen.has('shop.erfundenes_fach')).toBe(false);
  });

  it('⛔ KEIN Feld des Assistenten prallt an der Positivliste ab', () => {
    const offen = tuerOeffnetFuer();
    const zu = alleSchluessel().filter((k) => !offen.has(k));
    expect(
      zu,
      'Diese Felder schreibt der Assistent, und `PATCH /api/settings/:key` weist sie mit ' +
        'HTTP 400 ab („is not editable from the Owner Desktop"). Der Händler sieht nur ' +
        '„Eingabe ungültig" und kommt im Assistenten nicht weiter:\n  ' +
        zu.join('\n  '),
    ).toEqual([]);
  });
});
