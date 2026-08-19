/**
 * Die gewählte Kursquelle muss WIRKEN, nicht nur dastehen.
 *
 * ── ZWEI ANWEISUNGEN, DIE ZWEITE HEBT DIE ERSTE AUF ────────────────────────
 *
 * 02.08.2026: der Inhaber soll die Quelle wählen und wechseln können, und
 * ohne Netz den Kurs von Hand eintragen. Auf dieser Anweisung stand 'HAND'
 * samt Dienst-Halt, und DIESER Wächter hat den Halt gepinnt.
 *
 * 18.08.2026: „Ein Goldpreis wird nicht von Hand eingetragen. Verboten."
 * Die neue Anweisung hebt die alte auf. Der Wächter ist deshalb NEU
 * geschrieben, nicht geflickt: er pinnt jetzt die Abschaffung genauso hart,
 * wie er vorher die Betriebsart gepinnt hat. Wer 'HAND' wieder einführen
 * will, muss hier vorbei und liest dann diese Geschichte.
 *
 * ── DIE FALLEN, DIE BLEIBEN ────────────────────────────────────────────────
 *
 * ⚠️ 1. DIE LISTEN DRIFTEN. Die Kennungen stehen dreimal: im Motor, im
 *    Kursdienst des Beipacks (eine eigenständige .mjs ohne Bündler) und in
 *    der Kasse (ein eigenes Bündel). Böte die Kasse eine Quelle an, die der
 *    Dienst nicht kennt, fiele der Dienst stillschweigend auf die Vorgabe
 *    zurück: der Händler stellte um, sähe die Umstellung bestätigt, und es
 *    änderte sich NICHTS. Nichts würde rot.
 *
 * ⚠️ 2. DER SCHALTER HAT KEINEN AUSGANG. `fx_quelle` wurde vom 31.07. bis
 *    05.08.2026 gelesen und befolgt, aber kein Feld konnte ihn setzen. Diese
 *    Klasse hat dieses Haus am häufigsten getroffen.
 *
 * ⚠️ 3. DIE ABSCHAFFUNG ROSTET. Ein gespeicherter Altwert 'HAND' liegt noch
 *    in mancher Datenbank. Fiele er STILL auf die Vorgabe, wunderte sich der
 *    Betreuer, warum die Quelle nicht die eingestellte ist. Der Dienst muss
 *    ihn LAUT übergehen.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FXQUELLE_VORGABE,
  FXQUELLEN,
  FXQUELLEN_KENNUNGEN,
  METALLQUELLE_VORGABE,
  METALLQUELLEN,
  METALLQUELLEN_KENNUNGEN,
  metallquelleAus,
  SCHLUESSEL_FXQUELLE,
  SCHLUESSEL_METALLQUELLE,
} from '../../src/lib/kursquellen.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const DIENST = readFileSync(resolve(HIER, '../../sidecar/norns-sidecar.mjs'), 'utf8');
const SETTINGS = readFileSync(resolve(HIER, '../../src/routes/settings.ts'), 'utf8');
const KURSROUTE = readFileSync(resolve(HIER, '../../src/routes/metal-prices.ts'), 'utf8');
const KASSE = readFileSync(
  resolve(HIER, '../../../tauri-pos/src/screens/secondary/kursquellen-vokabular.ts'),
  'utf8',
);
const KASSENFLAECHE = readFileSync(
  resolve(HIER, '../../../tauri-pos/src/screens/secondary/KursquelleSection.tsx'),
  'utf8',
);
const EINSTELLUNGEN = readFileSync(
  resolve(HIER, '../../../tauri-pos/src/screens/secondary/Einstellungen.tsx'),
  'utf8',
);

/** Liest eine Kennungsliste aus fremdem Quelltext, ohne ihn auszuführen. */
function kennungenAus(text: string, marke: string): string[] {
  const zeile = new RegExp(`${marke}\\s*=\\s*\\[([^\\]]*)\\]`).exec(text);
  const rumpf = zeile?.[1];
  if (rumpf === undefined) return [];
  return [...rumpf.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1] ?? '');
}

/** Nur echter Code zaehlt: Kommentare erzaehlen Geschichte und duerfen 'HAND' sagen. */
function ohneKommentare(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|\*).*$/gm, '');
}

describe('Die Wahl der Kursquelle', () => {
  it('⛔ Motor, Kursdienst und Kasse kennen DIESELBEN Quellen', () => {
    const imDienst = kennungenAus(DIENST, 'const METALLQUELLEN_KENNUNGEN');
    const inDerKasse = [...KASSE.matchAll(/kennung:\s*'([A-Z_]+)'/g)].map((m) => m[1] ?? '');

    // Ohne diese Sätze wäre der Vergleich auf leeren Listen grün.
    expect(imDienst.length, 'der Kursdienst führt keine Liste').toBeGreaterThan(0);
    expect(METALLQUELLEN_KENNUNGEN.length).toBeGreaterThan(1);
    expect(inDerKasse.length, 'die Kasse führt kein Vokabular').toBeGreaterThan(0);

    expect([...imDienst].sort()).toEqual([...METALLQUELLEN_KENNUNGEN].sort());
    expect(METALLQUELLEN.map((e) => e.kennung).sort()).toEqual(
      [...METALLQUELLEN_KENNUNGEN].sort(),
    );
    // Die Kasse zeigt GENAU die Kennungen beider Motorlisten und erfindet
    // keine dazu. Ein liegengebliebener HAND-Eintrag würde hier rot.
    expect([...inDerKasse].sort()).toEqual(
      [...METALLQUELLEN_KENNUNGEN, ...FXQUELLEN_KENNUNGEN].sort(),
    );
  });

  it('⛔ auch die Herkunft des Dollarkurses stimmt in beiden Häusern überein', () => {
    const imDienst = kennungenAus(DIENST, 'const FXQUELLEN_KENNUNGEN');
    expect(imDienst.length).toBeGreaterThan(0);
    expect([...imDienst].sort()).toEqual([...FXQUELLEN_KENNUNGEN].sort());
    expect(FXQUELLEN.map((e) => e.kennung).sort()).toEqual([...FXQUELLEN_KENNUNGEN].sort());
  });

  it('⛔ die Vorgaben sind in Motor UND Dienst dieselben', () => {
    // Fielen sie auseinander, hinge das Ergebnis davon ab, WER gerade fragt.
    expect(DIENST).toContain(`METALLQUELLEN_KENNUNGEN, '${METALLQUELLE_VORGABE}'`);
    expect(DIENST).toContain(`FXQUELLEN_KENNUNGEN, '${FXQUELLE_VORGABE}'`);
    expect(KASSE).toContain(`METALLQUELLE_VORGABE = '${METALLQUELLE_VORGABE}'`);
    expect(KASSE).toContain(`FXQUELLE_VORGABE = '${FXQUELLE_VORGABE}'`);
  });

  it('⛔ die Handeingabe ist ABGESCHAFFT, in allen drei Häusern (18.08.2026)', () => {
    // 1. Keine Liste bietet 'HAND' mehr an.
    expect(METALLQUELLEN_KENNUNGEN as readonly string[]).not.toContain('HAND');
    expect(kennungenAus(DIENST, 'const METALLQUELLEN_KENNUNGEN')).not.toContain('HAND');
    expect([...KASSE.matchAll(/kennung:\s*'([A-Z_]+)'/g)].map((m) => m[1])).not.toContain('HAND');

    // 2. Der Dienst hat KEINEN Halt mehr: kein Zweig, der bei HAND aussteigt.
    //    Genau dieser Zweig war bis 18.08. der Kern dieses Wächters.
    expect(
      /if\s*\(\s*metallQuelle\s*===\s*'HAND'\s*\)/.test(ohneKommentare(DIENST)),
      'der Kursdienst hält wieder bei HAND an, die Abschaffung ist rückgebaut',
    ).toBe(false);

    // 3. Ein gespeicherter Altwert wird LAUT übergangen, nicht still.
    expect(DIENST).toContain('Kursquelle HAND ist abgeschafft');

    // 4. Der Schreibweg antwortet endgültig: 410, eigener Code. Wer die Route
    //    still wiederbelebt, muss zuerst diesen Satz löschen.
    expect(KURSROUTE).toContain('MANUAL_PRICE_ABOLISHED');
    expect(KURSROUTE).toContain('.status(410)');

    // 5. Und der pure Leser behandelt den Altwert wie jeden unbekannten Wert.
    expect(metallquelleAus(' hand ')).toBe(METALLQUELLE_VORGABE);
    expect(metallquelleAus('"HAND"')).toBe(METALLQUELLE_VORGABE);
  });

  it('⛔ beide Schalter sind eintragbar, sonst wären sie Sperren ohne Ausgang', () => {
    expect(SETTINGS).toContain('SCHLUESSEL_METALLQUELLE');
    expect(SETTINGS).toContain('SCHLUESSEL_FXQUELLE');
    // Die Kasse SCHREIBT beide wirklich; ein Feld, das nur anzeigt, wäre
    // wieder eine Sperre ohne Ausgang.
    expect(KASSENFLAECHE).toMatch(
      /PATCH['"`],\s*`\/api\/settings\/\$\{SCHLUESSEL_METALLQUELLE\}`/,
    );
    expect(KASSENFLAECHE).toMatch(/PATCH['"`],\s*`\/api\/settings\/\$\{SCHLUESSEL_FXQUELLE\}`/);
    expect(KASSE).toContain(`'${SCHLUESSEL_METALLQUELLE}'`);
    expect(KASSE).toContain(`'${SCHLUESSEL_FXQUELLE}'`);
    expect(EINSTELLUNGEN).toContain('<KursquelleSection />');
  });

  it('unbekannte oder fehlende Werte fallen auf die Vorgabe, nie ins Leere', () => {
    expect(metallquelleAus(null)).toBe(METALLQUELLE_VORGABE);
    expect(metallquelleAus('')).toBe(METALLQUELLE_VORGABE);
    expect(metallquelleAus('"LBMA"')).toBe(METALLQUELLE_VORGABE);
    // Der Server liefert jsonb als Text, also mit Anführungszeichen.
    expect(metallquelleAus('"SWISSQUOTE"')).toBe('SWISSQUOTE');
  });

  it('jede Quelle erklärt sich in einem ganzen Satz, mit NEUTRALEM Namen', () => {
    for (const q of [...METALLQUELLEN, ...FXQUELLEN]) {
      expect(q.name.length, `${q.kennung} hat keinen Namen`).toBeGreaterThan(2);
      expect(q.was.endsWith('.'), `${q.kennung}: die Erklärung ist kein Satz`).toBe(true);
      // Hausregel: kein Gedankenstrich in sichtbarem Text.
      expect(q.was).not.toMatch(/[—–]/);
      // Und keine rohe Kennung im Fliesstext.
      expect(q.was).not.toContain('_');
      // Basels Anweisung vom 18.08.2026: der ANGEZEIGTE Name nennt keinen
      // fremden Anbieter beim Domainnamen. Die Kennung bleibt (gespeicherter
      // Zustand), der Name ist neutral.
      expect(q.name, `${q.kennung}: der Anzeigename trägt eine Domain`).not.toMatch(
        /\.(de|com|org|net)\b/i,
      );
    }
  });

  it('die Kasse verspricht nichts, was der Beipack nicht liefert', () => {
    // Swissquote liefert Gold und Silber direkt in Euro. Steht das in der
    // Kasse, muss der Dienst auch WIRKLICH zuerst gegen Euro fragen.
    expect(KASSE).toContain('direkt in Euro');
    expect(DIENST).toContain("strom('EUR')");
    expect(DIENST).toContain("strom('USD')");
    expect(DIENST.indexOf("strom('EUR')")).toBeLessThan(DIENST.indexOf("strom('USD')"));
  });

  it('der Schlüsselname ist in allen drei Häusern wörtlich derselbe', () => {
    expect(SCHLUESSEL_METALLQUELLE).toBe('kurs.metall_quelle');
    expect(SCHLUESSEL_FXQUELLE).toBe('kurs.fx_quelle');
    expect(DIENST).toContain("'kurs.metall_quelle'");
    expect(DIENST).toContain("'kurs.fx_quelle'");
    expect(KASSE).toContain("'kurs.metall_quelle'");
    expect(KASSE).toContain("'kurs.fx_quelle'");
  });
});
