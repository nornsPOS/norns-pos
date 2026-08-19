/**
 * ⚠️ WÄCHTER: Der Kassenschluss muss die Sicherung wirklich anstossen.
 *
 * ── DER BEFUND VOM 13.08.2026 ───────────────────────────────────────────
 *
 * Es gab GENAU EINEN Auslöser für eine Sicherung im ganzen Baum: den Knopf
 * „Sicherung jetzt" in den Einstellungen. Kein Zeitgeber, kein Nachtlauf,
 * keine Erinnerung. Tagesabschluss und Sicherung waren zwei Flächen, die
 * einander nie riefen. Wer den Knopf nie drückte, hatte nie eine Sicherung
 * — und merkte es an dem Tag, an dem die Platte stirbt.
 *
 * § 147 AO verlangt zehn Jahre Vorlagefähigkeit. Eine Sicherung, die vom
 * Gedächtnis eines beschäftigten Händlers abhängt, ist keine.
 *
 * ── UND DIE ZWEITE HÄLFTE, DIE GENAUSO WICHTIG IST ─────────────────────
 *
 * Die Sicherung darf den Kassenschluss NIEMALS aufhalten. Deshalb prüft
 * dieser Wächter nicht nur DASS gerufen wird, sondern auch WIE: ohne
 * `await`, nach dem Buchen, im Erfolgszweig. Ein `await` davor würde den
 * Kassierer abends warten lassen, bis die ganze Datenbank auf einem USB-
 * Stick liegt — und ein Fehlschlag liesse den Abschluss als gescheitert
 * aussehen, obwohl er gebucht ist.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIALOG = join(HIER, 'ZBonDialog.tsx');

function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('⛔ Die Sicherung hängt am Kassenschluss', () => {
  const rumpf = ohneKommentare(readFileSync(DIALOG, 'utf8'));

  it('der Abschluss stösst sie überhaupt an', () => {
    expect(
      rumpf,
      'Der Z-Bon ruft die Sicherung nicht mehr. Dann hat der Händler nur noch ' +
        'den Knopf in den Einstellungen — und wer ihn nie drückt, hat nie eine ' +
        'Sicherung (§ 147 AO: zehn Jahre Vorlagefähigkeit).',
    ).toMatch(/sichereNachAbschluss\s*\(/);
  });

  it('⛔ und zwar OHNE await, damit sie den Kassierer nie aufhält', () => {
    const zeile = rumpf.split('\n').find((z) => z.includes('sichereNachAbschluss('));
    expect(zeile, 'Aufruf nicht gefunden').toBeDefined();
    expect(
      zeile,
      'Mit `await` wartet der Kassierer abends, bis die ganze Datenbank ' +
        'geschrieben ist — und ein Fehlschlag liesse den gebuchten Abschluss ' +
        'als gescheitert aussehen.',
    ).not.toMatch(/await\s+sichereNachAbschluss/);
    expect(zeile).toMatch(/void\s+sichereNachAbschluss/);
  });

  it('⛔ und NACH dem Buchen, nicht davor', () => {
    const buchen = rumpf.indexOf('shiftsApi.close(');
    const sichern = rumpf.indexOf('sichereNachAbschluss(');
    expect(buchen).toBeGreaterThan(-1);
    expect(
      sichern,
      'Die Sicherung steht vor dem Abschluss. Dann sichert sie einen Stand, ' +
        'den es noch nicht gibt — und der Kassensturz fehlt darin.',
    ).toBeGreaterThan(buchen);
  });
});
