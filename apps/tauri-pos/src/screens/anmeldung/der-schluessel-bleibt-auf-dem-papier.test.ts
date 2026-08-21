/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Der Notfallschlüssel bleibt auf dem Papier
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Ein Notfallschlüssel ist ein ZWEITES Geheimnis, das die Kasse öffnet. Seine
 * ganze Sicherheit hängt daran, dass es von ihm genau EINE Kopie gibt: die auf
 * dem Zettel im Tresor des Händlers.
 *
 * Jede zweite Kopie hebt das auf, und die naheliegenden Bequemlichkeiten sind
 * genau die gefährlichen:
 *
 *   • ein Knopf „Kopieren" legt ihn in die Zwischenablage, aus der ihn die
 *     nächste Anwendung liest,
 *   • `localStorage` überlebt jeden Neustart im Klartext auf der Platte,
 *   • ein `console.log` beim Suchen eines Fehlers landet im Protokoll,
 *   • und ein Zustandsspeicher trägt ihn quer durch die ganze Anwendung.
 *
 * Dieser Wächter liest die drei Flächen, die den Klartext überhaupt in die
 * Finger bekommen, und misst den GEBRAUCH — Kommentare zählen nicht, sonst
 * schlüge er auf diesem Kopf hier selbst an.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formeSchluessel, schluesselVollstaendig } from './SchluesselEinloesen.js';

const HIER = dirname(fileURLToPath(import.meta.url));

/** Die Flächen, durch die ein Schlüssel im Klartext hindurchgeht. */
const FLAECHEN = [
  resolve(HIER, 'SchluesselZettel.tsx'),
  resolve(HIER, 'SchluesselEinloesen.tsx'),
  resolve(HIER, '..', 'PinLogin.tsx'),
  resolve(HIER, '..', 'team', 'NotfallschluesselKarte.tsx'),
];

/** Nur der Code — der Wächter misst den Gebrauch, nicht die Erklärung. */
function ohneKommentare(inhalt: string): string {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .split('\n')
    .filter((z) => !z.trim().startsWith('//'))
    .join('\n');
}

describe('⛔ Der Notfallschlüssel bleibt auf dem Papier', () => {
  it('findet die Flächen wirklich — der Wächter darf nicht ins Leere greifen', () => {
    for (const f of FLAECHEN) {
      expect(readFileSync(f, 'utf8').length, `${f} ist leer oder fehlt`).toBeGreaterThan(200);
    }
  });

  it('⛔ legt ihn NIRGENDS in einen Speicher, der ihn überlebt', () => {
    const suender: string[] = [];
    for (const f of FLAECHEN) {
      const code = ohneKommentare(readFileSync(f, 'utf8'));
      for (const griff of [
        'localStorage',
        'sessionStorage',
        'navigator.clipboard',
        'writeText(',
        'document.cookie',
      ]) {
        if (code.includes(griff)) suender.push(`${f.split('/').slice(-2).join('/')}: ${griff}`);
      }
    }
    expect(
      suender,
      'Ein Notfallschlüssel darf genau EINE Kopie haben: die auf dem Zettel. ' +
        'Zwischenablage und Browserspeicher überleben die Fläche und machen daraus zwei.',
    ).toEqual([]);
  });

  it('⛔ schreibt ihn in kein Protokoll', () => {
    const suender: string[] = [];
    for (const f of FLAECHEN) {
      const code = ohneKommentare(readFileSync(f, 'utf8'));
      if (/console\.(log|info|warn|debug|error)/.test(code)) {
        suender.push(f.split('/').slice(-2).join('/'));
      }
    }
    expect(
      suender,
      'Auf einer Fläche, durch die ein Klartext-Schlüssel geht, ist jede Protokollzeile ' +
        'eine zweite Kopie — auch die, die beim Fehlersuchen „nur kurz" hineingerät.',
    ).toEqual([]);
  });

  it('⛔ die Anmeldung nennt den Weg zurück, den es WIRKLICH gibt', () => {
    // 20.08.2026 stand hier ein Satz über eine Google-Anmeldung, hinter der
    // niemand stand. Der Weg muss benannt sein UND gebaut.
    const code = ohneKommentare(readFileSync(resolve(HIER, '..', 'PinLogin.tsx'), 'utf8'));
    expect(code, 'der Ausgang fehlt auf der Anmeldung').toContain('Notfallschlüssel');
    expect(code, 'der Ausgang führt nirgendwohin').toContain('SchluesselEinloesen');
  });

  it('⛔ die Anmeldung wird NICHT durch das Einlösen erteilt', () => {
    // Der Kern der ganzen Abwägung: ein gefundener Zettel darf nichts buchen.
    const code = ohneKommentare(readFileSync(resolve(HIER, '..', 'PinLogin.tsx'), 'utf8'));
    const stelle = code.indexOf('onFertig');
    expect(stelle, 'onFertig fehlt — der Weg ist gar nicht verdrahtet').toBeGreaterThan(-1);
    const rumpf = code.slice(stelle, stelle + 900);
    expect(
      rumpf,
      'Nach dem Einlösen wird angemeldet. Damit öffnet ein gefundener Zettel die Kasse, ' +
        'und die Bedienerzuordnung nach § 146a AO ist wertlos.',
    ).not.toContain('setFromLogin');
  });
});

describe('Der Schlüssel formt sich beim Abtippen', () => {
  it('macht aus dem, was jemand tippt, die Form vom Zettel', () => {
    expect(formeSchluessel('4k7m9pqr2xyz3abc')).toBe('NORNS-4K7M-9PQR-2XYZ-3ABC');
    // Mit Vorwort, klein, mit Strichen, mit Leerzeichen: dasselbe Ergebnis.
    expect(formeSchluessel('norns-4k7m 9pqr-2xyz3abc')).toBe('NORNS-4K7M-9PQR-2XYZ-3ABC');
  });

  it('⛔ hört nach sechzehn Zeichen auf zu wachsen', () => {
    // Sonst tippt jemand weiter, sieht die Zeichen erscheinen und wundert
    // sich, warum der Schlüssel nicht stimmt.
    expect(formeSchluessel('4K7M9PQR2XYZ3ABCZZZZ')).toBe('NORNS-4K7M-9PQR-2XYZ-3ABC');
  });

  it('erkennt erst den vollständigen Schlüssel als vollständig', () => {
    expect(schluesselVollstaendig('NORNS-4K7M-9PQR-2XYZ-3AB')).toBe(false);
    expect(schluesselVollstaendig('NORNS-4K7M-9PQR-2XYZ-3ABC')).toBe(true);
    expect(schluesselVollstaendig('4k7m9pqr2xyz3abc')).toBe(true);
    expect(schluesselVollstaendig('')).toBe(false);
  });
});
