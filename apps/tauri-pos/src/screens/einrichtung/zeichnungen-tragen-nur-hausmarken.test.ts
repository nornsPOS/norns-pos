/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DIE ZEICHNUNGEN TRAGEN NUR HAUSMARKEN, UND ZWAR VORHANDENE
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── ZWEI WUNDEN DIESES HAUSES, BEIDE HIER MÖGLICH ─────────────────────────
 *
 * ⚠️ 1. EINE ROHE FARBE. Ein `#c8a34a` in einer Zeichnung wäre eine zweite
 *    Wahrheit neben `--w14-gilt`. Beim nächsten Themenwechsel bliebe genau
 *    diese Datei zurück, und niemand suchte sie dort.
 *
 * ⚠️ 2. EINE MARKE, DIE ES NICHT GIBT. Das ist die schlimmere: `var(--w14-tinte)`
 *    ohne Rückfallwert lässt der Browser die GANZE Deklaration fallen. Die
 *    Linie ist dann nicht falsch gefärbt, sondern UNSICHTBAR, und nichts
 *    meldet etwas. Dieses Haus hatte diesen Fehler sechsmal in einer Datei.
 *
 * Beides misst dieser Wächter gegen `tokens.css`, also gegen die Quelle
 * selbst und nicht gegen eine gepflegte Liste, die veralten könnte.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const ZEICHNUNGEN = resolve(HIER, 'einrichtungs-zeichnungen.tsx');
const MARKEN = resolve(HIER, '../../../../../packages/ui-kit/src/tokens.css');

/**
 * Kommentare weg, Zeilenumbrüche behalten.
 *
 * ⚠️ OHNE DIESEN SCHRITT MELDET DER WÄCHTER SEINE EIGENE ERKLÄRUNG. Der Kopf
 * der Zeichnungsdatei nennt `#c8a34a` als BEISPIEL für das, was verboten ist.
 * Ein Wächter, der das als Verstoss liest, zwingt den nächsten Menschen, die
 * Begründung zu löschen, um ihn grün zu bekommen. Dann steht die Regel ohne
 * ihren Grund da, und der nächste baut sie wieder ein.
 */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => davor);
}

describe('⛔ Die Zeichnungen der Erstinbetriebnahme', () => {
  const roh = readFileSync(ZEICHNUNGEN, 'utf8');
  const quelle = ohneKommentare(roh);
  const marken = readFileSync(MARKEN, 'utf8');

  it('es gibt überhaupt Zeichnungen zu messen', () => {
    // „null ist nicht grün": wäre die Datei leer oder umbenannt, wäre alles
    // unten trivial erfüllt.
    expect(roh.length).toBeGreaterThan(2000);
    expect(quelle).toContain('export function Belegstreifen');
    expect(quelle).toContain('export function Faden');
    expect(quelle).toContain('export function Buchseite');
    expect(quelle).toContain('export function Leerstelle');
  });

  it('⛔ der Fegezug misst nicht die eigene Erklärung', () => {
    // Selbstprüfung zu `ohneKommentare`. Der Kopf der Datei NENNT eine rohe
    // Farbe als Beispiel; sie darf nicht als Verstoss zählen.
    expect(roh).toContain('#c8a34a');
    expect(quelle).not.toContain('#c8a34a');
    // Und ein echter Gebrauch überlebt.
    expect(ohneKommentare('const a = "#ff0000";')).toContain('#ff0000');
  });

  it('⛔ keine rohe Farbe, nirgends', () => {
    const treffer = [...quelle.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)].map((m) => {
      const zeile = quelle.slice(0, m.index ?? 0).split('\n').length;
      return `Zeile ${zeile}: ${m[0]}`;
    });
    expect(
      treffer,
      'Eine rohe Farbe in einer Zeichnung ist eine zweite Wahrheit neben der ' +
        'Hausmarke. Beim nächsten Themenwechsel bleibt genau diese Datei zurück.',
    ).toEqual([]);
  });

  it('⛔ jede benutzte Marke steht WIRKLICH in tokens.css', () => {
    const benutzt = [...new Set([...quelle.matchAll(/var\((--w14-[a-z0-9-]+)\)/g)].map((m) => m[1]))];
    // „null ist nicht grün": ohne benutzte Marken wäre die Schleife leer.
    expect(benutzt.length, 'die Zeichnungen nennen gar keine Hausmarke').toBeGreaterThan(8);

    const fehlend = benutzt.filter((m) => !marken.includes(`${m}:`));
    expect(
      fehlend,
      'Diese Marken gibt es in tokens.css NICHT. Eine var() ohne Rückfallwert ' +
        'auf eine unbekannte Marke lässt der Browser samt ihrer ganzen ' +
        'Deklaration fallen: die Linie ist dann nicht falsch gefärbt, sondern ' +
        'unsichtbar, und nichts meldet etwas.',
    ).toEqual([]);
  });

  it('⛔ der gezeichnete Beleg erfindet keinen Betrag und keinen Artikel', () => {
    /*
     * Ein Papier, das wie ein echter Beleg aussieht und „Goldring 480,00"
     * trägt, ist ein Versprechen über Zahlen, die es nicht gibt. Der Händler
     * sieht sein erstes Papier und liest eine Summe, die niemand verkauft hat.
     */
    const geldmuster = /\d+[.,]\d{2}\s*(?:€|EUR)/;
    expect(
      geldmuster.test(quelle),
      'Der gezeichnete Beleg trägt einen Betrag. Er darf keinen tragen.',
    ).toBe(false);
    // Und das Positionsband bleibt wirklich leer: nur Linien, kein Wort.
    expect(quelle).toContain('POSITIONSBAND');
  });

  it('⛔ keine neue Abhängigkeit und kein Bild aus dem Netz', () => {
    // Eine Kasse steht im Laden auch ohne Netz. Ein Bild von aussen wäre
    // dort ein leeres Rechteck.
    expect(quelle).not.toMatch(/https?:\/\//);
    expect(quelle).not.toMatch(/from\s+'(?!react|node:)/);
  });

  it('⛔ kein Gedankenstrich in sichtbarem Text', () => {
    // Hausregel. Gilt auch für die Beschriftungen in den Zeichnungen.
    const sichtbar = [...quelle.matchAll(/>([^<>{}]{3,})</g)].map((m) => m[1] ?? '');
    for (const s of sichtbar) {
      expect(s, `Gedankenstrich in: ${s.trim().slice(0, 60)}`).not.toMatch(/[—–]/);
    }
  });
});
