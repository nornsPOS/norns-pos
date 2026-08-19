/**
 * Der Umsatzsteuer-Status muss einstellbar sein, und zwar mit GENAU den zwei
 * Werten, die der Riegel kennt.
 *
 * ── DER FUND VOM 01.08.2026 ─────────────────────────────────────────────────
 *
 * `lib/steuermodus.ts` ist sorgfältig gebaut. Sein Kopfkommentar sagt es
 * selbst: „REGELBESTEUERUNG ODER § 19? DAS DARF NIE GERATEN WERDEN." Der
 * Zustand `modus: null` heisst dort ausdrücklich „NIE beantwortet. Nicht
 * ‚vermutlich Regelbesteuerung'." Und `transactions-finalize.ts:269` liest den
 * Wert bei JEDEM Verkauf.
 *
 * Nur: `routes/settings.ts` kannte den Schlüssel nicht. Null Treffer auf
 * `steuer` in der ganzen Datei. Der Händler konnte den Wert also nirgends
 * setzen. Es fiel niemandem auf, weil die Erstsaat ihn auf Romans Wert
 * vorbelegte und der Riegel deshalb nie zuschlug.
 *
 * Seit die Saat mandantenneutral ist, ist der Wert LEER. Ohne diese Route wäre
 * das eine Sackgasse: eine frische Kasse, die jeden Verkauf verweigert, ohne
 * einen Weg heraus.
 *
 * ── WARUM DIESER WÄCHTER ZWEI DATEIEN VERGLEICHT ───────────────────────────
 *
 * Die zwei erlaubten Werte stehen jetzt an ZWEI Orten als Zeichenketten:
 *
 *   lib/steuermodus.ts     der Riegel, der sie beim Verkauf prüft
 *   routes/settings.ts     die Positivliste, die sie beim Speichern prüft
 *
 * Driften sie auseinander, entsteht der übelste Zustand von allen: die
 * Einstellung nimmt einen Wert an, den der Riegel danach nicht kennt. Der
 * Händler sieht eine erfolgreiche Speicherung und danach eine Kasse, die
 * jeden Verkauf verweigert, mit einer Meldung, die auf das falsche Problem
 * zeigt.
 *
 * Der Wächter liest deshalb beide Quellen und verlangt dieselbe Menge.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const SRC = join(HIER, '../../src');

const RIEGEL = join(SRC, 'lib/steuermodus.ts');
const POSITIVLISTE = join(SRC, 'routes/settings.ts');

function lies(pfad: string): string {
  return readFileSync(pfad, 'utf8');
}

/** Kommentare weg: eine Erklärung ist kein Quelltext. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Alle Werte, die wie ein Steuermodus aussehen, aus einer Datei sammeln. */
function modiIn(pfad: string): Set<string> {
  const text = ohneKommentare(lies(pfad));
  const gefunden = new Set<string>();
  for (const m of text.matchAll(/'(REGELBESTEUERUNG|KLEINUNTERNEHMER_\d+)'/g)) {
    if (m[1] !== undefined) gefunden.add(m[1]);
  }
  return gefunden;
}

describe('Der Umsatzsteuer-Status ist einstellbar', () => {
  it('findet beide Dateien — sonst prüft dieser Test nichts', () => {
    expect(lies(RIEGEL).length).toBeGreaterThan(500);
    expect(lies(POSITIVLISTE).length).toBeGreaterThan(500);
  });

  it('steht überhaupt in der Positivliste', () => {
    // Der eigentliche Fund: vor dem 01.08.2026 war die Antwort hier null.
    const text = lies(POSITIVLISTE);
    expect(text).toContain(`'steuer.modus'`);
    expect(text).toContain(`'steuer.modus_gilt_ab'`);
  });

  it('ist eine AUSWAHL, kein freier Text', () => {
    // Als freier Text würde ein Tippfehler angenommen, und ab da scheiterte
    // jeder Verkauf mit einer Meldung, die auf das falsche Problem zeigt.
    const text = lies(POSITIVLISTE);
    const eintrag = /'steuer\.modus':\s*\{[\s\S]*?\}/.exec(text);
    expect(eintrag, `der Eintrag steuer.modus fehlt`).not.toBeNull();
    expect(eintrag?.[0]).toContain(`kind: 'auswahl'`);
    expect(eintrag?.[0]).toContain('werte:');
  });

  it('Riegel und Positivliste kennen DIESELBEN Werte', () => {
    const imRiegel = modiIn(RIEGEL);
    const inDerListe = modiIn(POSITIVLISTE);

    // Beide müssen überhaupt welche kennen, sonst vergleicht der Satz zwei
    // leere Mengen und ist grün über nichts.
    expect(imRiegel.size, 'der Riegel kennt keinen Modus').toBeGreaterThan(0);
    expect(inDerListe.size, 'die Positivliste kennt keinen Modus').toBeGreaterThan(0);

    expect([...inDerListe].sort()).toEqual([...imRiegel].sort());
  });

  it('das Gültig-ab-Datum hat eine verlangte Form', () => {
    // Ein freier Text hier hiesse: „ab sofort" oder „01.01." landen in der
    // Datenbank, und der Riegel liest sie als ungültiges Datum.
    const text = lies(POSITIVLISTE);
    const eintrag = /'steuer\.modus_gilt_ab':\s*\{[\s\S]*?\n\s*\}/.exec(text);
    expect(eintrag, `der Eintrag steuer.modus_gilt_ab fehlt`).not.toBeNull();
    expect(eintrag?.[0]).toContain('muster:');
  });
});
