/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ EINE WACHE MUSS ÜBER EINER FLÄCHE STEHEN, DIE JEMAND ERREICHT
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 22.08.2026 ─────────────────────────────────────────────
 *
 * Am 21.08. zog der Verkaufsaufschlag auf Basels Anweisung in den Kursraum.
 * Die alte Kachel `secondary/VerkaufsaufschlagSection.tsx` blieb im Baum
 * stehen und wurde von da an NIRGENDS mehr gerendert. Sechs Sätze in
 * `lager/tagespreis-anzeige.test.ts` lasen weiter ihren Text und hielten ihre
 * Zusagen in Schach — grün, vierundzwanzig Stunden lang, über einer Fläche
 * ohne Ausgang.
 *
 * ⚠️ DAS IST NICHT DIE BEKANNTE FALLE. Die heisst „Wächter zeigt auf eine
 * GELÖSCHTE Datei" und fällt sofort auf, denn `readFileSync` wirft. Hier war
 * die Datei da, das Lesen gelang, jeder Satz stimmte. Nur konnte niemand
 * die Fläche je sehen. Dieselbe Wirkung, ohne jedes Anzeichen.
 *
 * Und einer der sechs Sätze VERLANGTE eine Zusage, die inzwischen unwahr war
 * („Gebucht wird weiterhin der gespeicherte Preis"). Eine Wache über totem
 * Grund wird mit der Zeit nicht nur nutzlos, sondern falsch.
 *
 * ── WAS DIESE PROBE MISST ─────────────────────────────────────────────────
 *
 * Jede Probe im Haus, die den QUELLTEXT eines Bauteils liest, wird gefragt:
 * kann ein Händler dieses Bauteil überhaupt erreichen? Drei Wege gelten:
 *
 *   1. es wird irgendwo als `<Name` gerendert (ausserhalb seiner selbst und
 *      ausserhalb von Proben),
 *   2. es steht im Flächenregister (`surface-registry.ts`, auch faul geladen),
 *   3. es wird von `Einstellungen.tsx` gezeichnet UND sein Bereich steht in
 *      `NORNS_BEREICHE` — der Liste der Bereiche, die die AUSGELIEFERTE
 *      Kasse zeigt. Bereich weg heisst Fläche weg; genau das war der Befund
 *      vom 14.08.
 *
 * ⚠️ „null ist nicht grün": findet der Sammler keine bewachten Flächen, ist
 * das ein Fehler und keine bestandene Probe.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const WURZEL = resolve(HIER, '../../../../..');
const REGISTER = resolve(HIER, 'surface-registry.ts');
const EINSTELLUNGEN = resolve(HIER, '../../screens/secondary/Einstellungen.tsx');

/** Kommentare weg. Ein Dateiname in einer Erklärung ist kein Aufruf. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => davor);
}

/**
 * Die Leseaufrufe, mit denen Proben in diesem Haus an Quelltext kommen.
 *
 * ⚠️ Mehrteilige Pfade sind der Regelfall: `resolve(HIER, '..', 'X.tsx')` und
 * `flaechenText('..', 'secondary', 'Kurse.tsx')`. Wer nur das LETZTE Stück
 * nimmt, hält `screens/anmeldung/PinLogin.tsx` für vermisst, obwohl die Probe
 * sauber auf `screens/PinLogin.tsx` zeigt. Genau so hat sich der erste
 * Entwurf dieser Probe drei falsche Anzeigen geholt.
 */
const AUFRUFE = [
  /readFileSync\(\s*(?:new URL\(\s*)?((?:'[^']+'\s*,?\s*)+)/g,
  /readFileSync\(\s*resolve\(\s*[A-Za-z_$][\w$]*\s*,\s*((?:'[^']+'\s*,?\s*)+)\)/g,
  /(?:flaechenText|einzeilig)\(\s*((?:'[^']+'\s*,?\s*)+)\)/g,
  /=\s*\[\s*((?:'[^']+'\s*,?\s*)+)\]\s*as const/g,
];

/**
 * Aus den Zeichenketten EINES Aufrufs die Pfade machen, die er wirklich meint.
 *
 * ⚠️ Zwei Formen sehen gleich aus und meinen Gegenteiliges:
 *
 *     resolve(HIER, '..', 'secondary', 'Kurse.tsx')   EIN Pfad aus Stücken
 *     ['ZustandFehler.tsx', 'ZustandLeer.tsx']        ZWEI eigene Pfade
 *
 * Der erste Entwurf klebte beide zusammen und meldete Dateien als vermisst,
 * die es gibt — `.../ZustandFehler.tsx/ZustandLeer.tsx`. Die Regel, die beide
 * trennt: jede Zeichenkette, die auf `.tsx` endet, SCHLIESST einen Pfad ab;
 * was davor steht und nicht auf `.tsx` endet, ist Vorsatz dieses einen Pfads.
 */
function zuPfaden(worte: readonly string[]): string[] {
  const pfade: string[] = [];
  let vorsatz: string[] = [];
  for (const w of worte) {
    if (/\.tsx$/.test(w)) {
      pfade.push([...vorsatz, w].join('/'));
      vorsatz = [];
    } else {
      vorsatz.push(w);
    }
  }
  return pfade;
}

/**
 * Den Pfad gegen den Ort auflösen, den die Probe wirklich meint.
 *
 * ⚠️ Jede Probe bringt ihren eigenen Leser mit, und die Vorsätze gehen
 * auseinander: die einen rechnen ab ihrem eigenen Ordner, andere haben ein
 * `join(HIER, '../..', p)` im Haus (`lib/ohne-signatur-hinweis.test.ts`).
 * Wer nur EINEN Vorsatz kennt, meldet vorhandene Dateien als vermisst.
 *
 * Also wird von unten nach oben gesucht, bis eine Auflösung wirklich auf der
 * Platte liegt — dasselbe Vorgehen wie bei den Rückholbefehlen im Grabstein.
 * Findet keine, bleibt die unterste stehen und die Probe darüber meldet sie.
 */
function aufloesen(start: string, stueck: string): string {
  let ort = start;
  for (;;) {
    const versuch = resolve(ort, stueck);
    if (existsSync(versuch)) return versuch;
    if (ort === WURZEL) return resolve(start, stueck);
    ort = dirname(ort);
  }
}

/** Alle Proben des Hauses, aus git — nicht aus einer gepflegten Liste. */
function alleProben(): string[] {
  return execFileSync('git', ['ls-files', '*.test.ts', '*.test.tsx'], {
    cwd: WURZEL,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

/** Welche Bauteil-Dateien werden von welchen Proben als Quelltext gelesen? */
function bewachteFlaechen(): Map<string, string[]> {
  const gefunden = new Map<string, Set<string>>();
  for (const probe of alleProben()) {
    const abs = resolve(WURZEL, probe);
    const quelle = ohneKommentare(readFileSync(abs, 'utf8'));
    for (const muster of AUFRUFE) {
      for (const treffer of quelle.matchAll(muster)) {
        const worte = [...(treffer[1] ?? '').matchAll(/'([^']+)'/g)]
          .map((t) => t[1] ?? '')
          .filter((w) => w !== 'utf8');
        for (const stueck of zuPfaden(worte)) {
          // Nur Bauteile: Grossbuchstabe am Dateinamen, .tsx.
          const name = basename(stueck).replace(/\.tsx$/, '');
          if (!/^[A-Z]/.test(name)) continue;
          const ziel = aufloesen(dirname(abs), stueck);
          if (!gefunden.has(ziel)) gefunden.set(ziel, new Set());
          (gefunden.get(ziel) as Set<string>).add(probe);
        }
      }
    }
  }
  return new Map([...gefunden].map(([k, v]) => [k, [...v]]));
}

/** Wird das Bauteil irgendwo ausserhalb seiner selbst gerendert? */
function wirdGerendert(ziel: string, name: string): boolean {
  let roh = '';
  try {
    /*
     * ⚠️ NUR `.tsx`. Der erste Anlauf durchsuchte ALLE Dateien — und blieb
     * grün, weil `docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md` die Zeichenfolge
     * `<VerkaufsaufschlagSection` ZITIERT, in dem Satz, der erklärt, dass es
     * sie nirgends gibt. Der Wächter gegen „Erwähnung statt Benutzung" ist
     * genau daran gescheitert. Rendern kann nur eine `.tsx`.
     */
    roh = execFileSync('git', ['grep', '-l', '--', `<${name}`, '--', '*.tsx'], {
      cwd: WURZEL,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return false;
  }
  return roh
    .split('\n')
    .filter(Boolean)
    .some((f) => resolve(WURZEL, f) !== ziel && !/\.test\.tsx?$/.test(f));
}

/** Steht das Bauteil im Flächenregister — auch als fauler Nachlader? */
function stehtImRegister(name: string): boolean {
  const register = ohneKommentare(readFileSync(REGISTER, 'utf8'));
  return new RegExp(`\\bm\\.${name}\\b|\\bcomponent:\\s*${name}\\b`).test(register);
}

/**
 * Zeichnet `Einstellungen.tsx` das Bauteil in einem Bereich, den die
 * AUSGELIEFERTE Kasse zeigt? Ein Bereich, der aus `NORNS_BEREICHE` fällt,
 * nimmt seine Fläche mit — der Befund vom 14.08.2026.
 */
function stehtInEinemAusgelieferterBereich(name: string): boolean {
  const quelle = ohneKommentare(readFileSync(EINSTELLUNGEN, 'utf8'));
  const zeichnung = new RegExp(`activeSection === '([a-z-]+)' && <${name}\\b`).exec(quelle);
  if (!zeichnung?.[1]) return false;
  const liste = /const NORNS_BEREICHE[^=]*=\s*new Set<SectionId>\(\[([\s\S]*?)\]\)/.exec(quelle);
  const ausgeliefert = [...(liste?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((t) => t[1]);
  return ausgeliefert.includes(zeichnung[1]);
}

describe('⛔ Keine Wache über einer toten Fläche', () => {
  const bewacht = bewachteFlaechen();

  it('der Sammler findet überhaupt bewachte Flächen', () => {
    // Ohne diesen Satz wäre eine kaputte Sammlung eine bestandene Probe.
    expect(
      bewacht.size,
      'Kein einziges bewachtes Bauteil gefunden. Dann prüft alles darunter ' +
        'nichts, und diese Datei ist eine Beruhigung statt einer Wache.',
    ).toBeGreaterThan(5);
  });

  it('⛔ jede bewachte Fläche existiert noch', () => {
    const weg = [...bewacht].filter(([ziel]) => !existsSync(ziel));
    expect(
      weg.map(([z, w]) => `${z.replace(`${WURZEL}/`, '')} <- ${w.join(', ')}`),
      'Eine Probe liest den Quelltext einer Datei, die es nicht mehr gibt.',
    ).toEqual([]);
  });

  it('⛔ und ein Händler kann sie erreichen', () => {
    const verwaist: string[] = [];
    for (const [ziel, proben] of bewacht) {
      if (!existsSync(ziel)) continue;
      const name = basename(ziel).replace(/\.tsx$/, '');
      if (
        wirdGerendert(ziel, name) ||
        stehtImRegister(name) ||
        stehtInEinemAusgelieferterBereich(name)
      ) {
        continue;
      }
      verwaist.push(`${ziel.replace(`${WURZEL}/`, '')} <- ${proben.join(', ')}`);
    }
    expect(
      verwaist,
      'Diese Bauteile werden von Proben bewacht, aber von keiner Fläche ' +
        'gezeigt: kein <Name irgendwo, nicht im Flächenregister, und kein ' +
        'ausgelieferter Einstellungsbereich zeichnet sie. Die Sätze darüber ' +
        'sind grün und schützen nichts — genau der Befund vom 22.08.2026.',
    ).toEqual([]);
  });
});
