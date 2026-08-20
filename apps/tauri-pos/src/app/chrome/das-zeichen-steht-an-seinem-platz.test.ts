/**
 * Das Zeichen des Hauses steht, wo der Händler es sieht.
 *
 * ── DIE GESCHICHTE DER FORM, in zwei Anweisungen ───────────────────────────
 *
 * 04.08.2026, Basel: das N mit dem roten Faden IST das Logo. Nicht verändern.
 * (Ich hatte damals eigenmächtig einen Entwurf gebaut; er wurde zurückgenommen,
 * denn die Identität des Hauses gehört nicht dem Quelltext.)
 *
 * 19.08.2026, Basel, und diese Anweisung hebt die vom 04.08. auf: das volle N
 * mit dem QUER liegenden Faden (links unten nach rechts oben) las sich als
 * DURCHGESTRICHENES N — ein Verbotszeichen als Marke, ihm eine Last bei jedem
 * Öffnen. Die neue Form: der Faden IST die Schräge des N. Zwei Stämme in
 * Tinte, die Diagonale in Weinrot, nichts kreuzt mehr.
 *
 * ── WAS DIESER WÄCHTER FESTHÄLT ────────────────────────────────────────────
 *
 * 1. Das Bauteil ist eine ABSCHRIFT des Erzeugers, keine eigene Form. Driften
 *    die Masse, trägt die Fensterleiste ein anderes Zeichen als die Kasse.
 * 2. Es steht wirklich auf den drei Flächen, auf denen die Marke gehört.
 * 3. Der Faden bleibt weinrot und ist die EINZIGE Schräge: kein Tintenbalken
 *    darunter (sonst wird der Faden wieder zur Streichung), kein Gold, keine
 *    andere Farbe.
 */

import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const lies = (p: string): string => readFileSync(resolve(HIER, p), 'utf8');

/**
 * Nur das, was wirklich läuft. Kommentare und JSX-Kommentare fliegen raus.
 *
 * ⚠️ 04.08.2026, beim ersten Lauf der beiden Wächter darunter: sie meldeten
 * drei Verstösse, und ALLE DREI standen in den Erklärungen, die ich selbst
 * daneben geschrieben hatte („hier stand `<Seal tone=gold />`"). Ein Wächter,
 * der die Beschreibung eines beseitigten Fehlers für den Fehler hält, ist ein
 * Fehlalarm, und ein Fehlalarm macht den nächsten ECHTEN Fund unsichtbar.
 * Dieses Haus hat das schon einmal bezahlt.
 */
function ohneKommentare(quelle: string): string {
  return (
    quelle
      // ⚠️ ERST die Blockkommentare, DANN die leeren Klammerpaare.
      //
      // Der erste Entwurf nahm zuerst `/\{\s*\/\*[\s\S]*?\*\/\s*\}/`, um
      // `{/* … */}` zu treffen. Das `\s*` erlaubt einen Zeilenumbruch, und
      // damit passte auch `export interface SealProps {` gefolgt von `/**`.
      // Der nicht gierige Teil suchte dann das nächste `*/` MIT `}` dahinter
      // und frass dabei alles dazwischen, `const MARKE` eingeschlossen.
      //
      // Der Wächter meldete darauf „die Vorgabe ist nicht auffindbar". Das war
      // Glück. Hätte er stattdessen ein Siegel verschluckt, wäre er GRÜN
      // gewesen, ohne etwas geprüft zu haben, und niemandem wäre es
      // aufgefallen.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      // Was von einem `{/* … */}` übrig bleibt, ist ein leeres Klammerpaar.
      .replace(/\{\s*\}/g, '')
  );
}

/**
 * Jeder öffnende `<Seal …>`-Winkel, VOLLSTÄNDIG.
 *
 * ⚠️ Der erste Entwurf nahm `/<Seal\b[\s\S]*?(?:\/>|>)/`. Das hört beim ERSTEN
 * Winkel auf, und der steckt bei einem mehrzeiligen Aufruf oft mitten in einem
 * `style={{ … }}`. Ein `label=` DAHINTER wäre nie gesehen worden: ein Wächter,
 * der zu früh aufhört und dann Alarm schlägt, meldet Unschuldige. Deshalb wird
 * hier über die Klammern gezählt.
 */
function oeffnendeSiegel(quelle: string): string[] {
  const raus: string[] = [];
  for (let i = quelle.indexOf('<Seal'); i !== -1; i = quelle.indexOf('<Seal', i + 1)) {
    if (/[A-Za-z]/.test(quelle[i + 5] ?? '')) continue; // <SealSonstwas
    let tiefe = 0;
    for (let j = i + 5; j < quelle.length; j++) {
      const c = quelle[j];
      if (c === '{') tiefe++;
      else if (c === '}') tiefe--;
      else if (c === '>' && tiefe === 0) {
        raus.push(quelle.slice(i, j + 1));
        break;
      }
    }
  }
  return raus;
}

const BAUTEIL = lies('../../../../../packages/ui-kit/src/components/NornsZeichen.tsx');
const ERZEUGER = lies('../../../src-tauri/icons/generate.py');

/** Die drei Flächen, auf denen die Marke des Hauses steht. */
const FLAECHEN = [
  ['die Zifferntür', '../../screens/PinLogin.tsx'],
  ['der Motorstart', '../Motorstart.tsx'],
  ['das Startbild', './Splash.tsx'],
] as const;

describe('Das Zeichen von Norns', () => {
  it('⛔ das Bauteil ist eine ABSCHRIFT, kein eigener Entwurf', () => {
    // Jede Zahl muss auch im Erzeuger stehen. Sonst sind es zwei Zeichen.
    // 20.08.2026: die Dicke der Schräge steht hier NICHT mehr als Zahl. Sie
    // ist abgeleitet (`STRICH / KOSINUS`), damit die Schräge senkrecht
    // gemessen genau so dick ist wie ein Stamm; der eigene Satz weiter
    // unten prüft die Ableitung in beiden Dateien. Eine gewählte Zahl an
    // dieser Stelle war der Grund, warum sich das Zeichen als aufgelegter
    // Strich las.
    for (const [was, faktor] of [
      ['Höhe', '0.60'],
      ['Breite', '0.78'],
      ['Strichdicke', '0.16'],
    ] as const) {
      expect(ERZEUGER, `${was} fehlt im Erzeuger`).toContain(faktor.replace(/0$/, ''));
      expect(BAUTEIL, `${was} fehlt im Bauteil`).toContain(
        faktor.startsWith('0.6') ? '0.6' : faktor,
      );
    }
    // Und die Farben sind wörtlich die des Erzeugers.
    expect(BAUTEIL).toContain("NORNS_TINTE = '#262019'");
    expect(BAUTEIL).toContain("NORNS_FADEN = '#9c2630'");
    expect(ERZEUGER).toContain('0x26, 0x20, 0x19');
    expect(ERZEUGER).toContain('0x9C, 0x26, 0x30');
  });

  it('⛔ der Faden ist weinrot und ist die EINZIGE Schräge des N', () => {
    // Kein Gold, keine andere Farbe — und kein Tintenbalken unter dem Faden.
    const rumpf = BAUTEIL.slice(BAUTEIL.indexOf('return ('));
    /*
     * 19.08.2026: der Faden ist ein Parameter mit NORNS_FADEN als Vorgabe —
     * fest #9c2630 mass im Dunkelthema nur 2,40:1, die Kasse reicht seither
     * die Themen-Marke. Der Waechter prueft BEIDES: die Vorgabe bleibt
     * woertlich das Weinrot des Erzeugers, und der Strich haengt am Parameter.
     */
    expect(BAUTEIL).toContain('faden = NORNS_FADEN');
    // 20.08.2026: die Schräge ist ein gefülltes Vieleck, kein Strich mehr.
    expect(BAUTEIL).toContain('<polygon points={schraege} fill={faden} />');
    expect(rumpf, 'im Zeichen hat Gold nichts zu suchen').not.toMatch(/gilt|gold/i);
    /*
     * ⚠️ DER KERN VON BASELS ANWEISUNG VOM 19.08.2026: sobald wieder eine
     * TINTENSCHRÄGE unter dem Faden liegt, kreuzen sich zwei Diagonalen,
     * und das Zeichen liest sich erneut als durchgestrichen.
     *
     * ── 20.08.2026: DIESER SATZ WAR ZU GROB GEFASST ──────────────────────
     *
     * Er verbot JEDES <polygon> und jedes z.polygon. Gemeint war die
     * Tintenschräge; getroffen hätte es auch die Schräge SELBST. Und genau
     * die ist heute ein Vieleck geworden: Basels Anweisung vom 20.08. macht
     * den Faden zur echten Schräge des N — ein Parallelogramm mit
     * senkrechten Schnitten statt eines runden Strichs, der oben auf den
     * Stämmen lag.
     *
     * Der Satz misst deshalb jetzt die GEFAHR statt der Bauform: eine
     * Schräge in TINTE. Die Schräge in Weinrot ist erlaubt, und dass es bei
     * EINER bleibt, prüft der Satz darunter.
     */
    const tintenschraege = /<polygon[^>]*fill=\{tinte\}/.test(rumpf);
    expect(tintenschraege, 'eine Tintenschräge macht den Faden wieder zur Streichung').toBe(
      false,
    );
    expect(ERZEUGER, 'die Tintenschräge ist auch im Erzeuger verboten').not.toMatch(
      /z\.polygon\([^)]*fill=TINTE/s,
    );

    /*
     * Und es bleibt bei EINER Schräge. Zwei wären wieder ein X — egal in
     * welcher Farbe.
     */
    const schraegenImErzeuger = (ERZEUGER.match(/z\.polygon\(/g) ?? []).length;
    expect(schraegenImErzeuger, 'zwei Schrägen ergeben wieder ein X').toBeLessThanOrEqual(1);
    expect(ERZEUGER, 'die runden Kappen sind seit dem 20.08. abgeschafft').not.toContain(
      'z.ellipse',
    );
  });

  it('⛔ die Schräge des SYMBOLS ist abgeleitet, nicht geraten', () => {
    /*
     * 20.08.2026: der alte Faden war senkrecht gemessen 0,079 der Höhe dick,
     * ein Stamm 0,16 — er las sich als dünner Stab quer über zwei Pfosten.
     * Im Symbolschnitt macht `stamm / kosinus` die Schräge senkrecht
     * gemessen genau so dick wie ein Stamm. Steht dort wieder eine gewählte
     * Zahl, ist das Zeichen wieder ein aufgelegter Strich.
     */
    expect(BAUTEIL).toContain('const kosinus = 1 / Math.hypot(breite, 1)');
    expect(BAUTEIL).toContain('schraege: stamm / kosinus');
    expect(ERZEUGER).toContain('kosinus = s / math.hypot(w, s)');
    expect(ERZEUGER).toContain('d / kosinus');
  });

  it('⛔ der SCHRIFTZUG-Schnitt trägt die GEMESSENEN Verhältnisse des Hausschnitts', () => {
    /*
     * ── BASELS ANWEISUNG VOM 20.08.2026 ──────────────────────────────────
     *
     * „Das Zeichen soll mit dem Wort verschmelzen wie bei einer grossen
     * Firma, zwei Fliegen mit einer Klappe."
     *
     * Am laufenden Bild gemessen (Fraunces 500), über DREI Grössen (70, 36,
     * 26 Punkt), damit die Rasterung nicht mitmisst: Tintenbreite 0,993 der
     * Versalhöhe, Stämme 0,086, Schräge 0,243. Das ist die klassische
     * römische Antiqua — DÜNNE Stämme, DICKE Schräge. Das Zeichen trug die
     * Verhältnisse genau andersherum und stand deshalb als schmales,
     * schweres N vor vier breiten, leichten Buchstaben.
     *
     * Wer diese Zahlen ändert, ändert nicht den Geschmack, sondern hebt
     * eine MESSUNG auf. Dann bitte neu messen und die neue Zahl hier
     * eintragen.
     */
    expect(BAUTEIL).toContain('breite: 0.993');
    expect(BAUTEIL).toContain('stamm: 0.086');
    expect(BAUTEIL).toContain('schraege: 0.243');

    const marke = lies('../../../../../packages/ui-kit/src/components/NornsWortmarke.tsx');
    expect(
      marke,
      'Der Schriftzug setzt wieder den Symbolschnitt — das N steht dann als ' +
        'Fremdkörper zwischen O R N S.',
    ).toContain('SCHNITT_WORT');
  });

  it('⛔ es steht auf allen drei Flächen, auf denen die Marke gehört', () => {
    /*
     * ── 20.08.2026, BASELS ANWEISUNG, ZWEIMAL GESAGT ─────────────────────
     *
     * „Das normale N entfernen und das Zeichen an seine Stelle setzen."
     * Bis heute stand auf diesen Flächen das Zeichen ÜBER dem Schriftzug,
     * und der Schriftzug trug ein gewöhnliches N: die Marke stand zweimal
     * untereinander. Jetzt trägt jede Fläche EIN Wort, dessen erster
     * Buchstabe das Zeichen selbst ist (`NornsWortmarke`).
     *
     * Der Wächter prüft deshalb ab jetzt die WORTMARKE, und zusätzlich, dass
     * daneben kein gesetztes „NORNS" mehr steht — sonst wäre die alte
     * Dopplung stillschweigend zurück.
     */
    for (const [name, pfad] of FLAECHEN) {
      const f = lies(pfad);
      expect(f, `${name} zeigt die Wortmarke nicht`).toContain('<NornsWortmarke');
      // Die Tinte folgt dem Thema: auf dunklem Grund hell.
      expect(f, `${name}: die Tinte folgt dem Thema nicht`).toContain(
        'tinte="var(--w14-ink)"',
      );
      // Und NIRGENDS ein zweites, gesetztes NORNS daneben.
      const sichtbar = ohneKommentare(f);
      expect(
        sichtbar,
        `${name}: neben der Wortmarke steht wieder ein gesetztes NORNS`,
      ).not.toMatch(/>\s*NORNS\s*</);
    }
  });

  it('⛔ die Wortmarke setzt das Zeichen als Buchstaben, nicht als Bild daneben', () => {
    const marke = lies('../../../../../packages/ui-kit/src/components/NornsWortmarke.tsx');
    /*
     * ── 20.08.2026: SIE ZEICHNET GAR NICHT MEHR SELBST ──────────────────
     *
     * Bis heute standen hier dieselben Rechtecke und dieselbe Schräge ein
     * ZWEITES Mal, mit den Zahlen von Hand abgeschrieben („26.6", „9.6",
     * „31.4"…). Der alte Satz hat das sogar geprüft — er verlangte `<rect`
     * in der Wortmarke und hielt die Abschrift damit fest.
     *
     * Zwei Zeichnungen desselben Zeichens driften. Eine Änderung am Zeichen
     * hätte die Wortmarke unverändert gelassen, und in der Kopfleiste
     * stünde ein anderes N als auf dem Programmsymbol. Sie setzt jetzt
     * DIESELBE Gestalt und unterscheidet sich nur im Ausschnitt.
     */
    expect(marke).toContain('ZeichenGestalt');
    expect(
      /<rect|<polygon|<line/.test(marke),
      'Die Wortmarke zeichnet das Zeichen wieder selbst. Zwei Zeichnungen ' +
        'desselben Zeichens driften auseinander.',
    ).toBe(false);
    expect(marke).toContain('ZEICHEN_KASTEN');
    // Der Rest des Namens ist gesetzte Schrift.
    expect(marke).toContain('ORNS');
  });

  it('⛔ KEIN Siegel ohne Beschriftung: sonst wird der Ring zur Marke', () => {
    // ── DER FUND VOM 04.08.2026, UND DAS VERSAGEN DIESES WÄCHTERS ──────────
    //
    // ⚠️ Basel startete die Kasse und sah ein N IM KREIS. Der Test darüber
    // war grün. Er prüfte „steht `<NornsZeichen` in der Datei" — und das
    // stimmte. Nur stand auf dem Startbild DIREKT DARÜBER noch das alte
    // Siegel, und auf der Fehlerfläche „Keine Verbindung" stand es allein.
    //
    // Anwesenheit ist keine Ausschliesslichkeit. Ein Wächter, der das
    // Vorhandensein prüft statt der Eigenschaft, ist grün aus dem falschen
    // Grund. Genau diese Klasse Fehler kennt dieses Haus schon.
    //
    // Die Ursache lag eine Ebene tiefer: `Seal` fiel ohne `label` auf `'N'`
    // zurück. Sieben Flächen liessen `label` weg, eine davon in Gilt: ein
    // GOLDENES N, das eine Bild, das Basel ausdrücklich ausgeschlossen hat.
    //
    // Der Ring ist ab jetzt ein Medaillon um ein eigenes Zeichen der Fläche.
    // Die Marke ist `NornsZeichen`. Wer `label` weglässt UND keine Kinder
    // hineinlegt, macht den Ring wieder zur Marke, und das wird hier ROT.
    const dateien = globSync('**/*.tsx', {
      cwd: resolve(HIER, '../..'),
      ignore: ['**/*.stories.tsx'],
    });
    const nackt: string[] = [];
    for (const p of dateien) {
      const inhalt = ohneKommentare(lies(resolve(HIER, '../..', p)));
      for (const treffer of oeffnendeSiegel(inhalt)) {
        const hatBeschriftung = /\blabel=/.test(treffer);
        const hatKinder = !treffer.trimEnd().endsWith('/>');
        if (!hatBeschriftung && !hatKinder) {
          nackt.push(`${p}: ${treffer.replace(/\s+/g, ' ').slice(0, 70)}`);
        }
      }
    }
    expect(nackt, `Siegel ohne eigenes Zeichen:\n${nackt.join('\n')}`).toEqual([]);
  });

  it('⛔ die Vorgabe des Siegels ist KEIN Buchstabe', () => {
    // Der zweite Riegel, falls jemand den ersten umgeht: selbst wenn wieder
    // ein Siegel nackt dasteht, darf daraus nie ein Buchstabe werden.
    const siegel = ohneKommentare(
      lies('../../../../../packages/ui-kit/src/components/Seal.tsx'),
    );
    const m = /const MARKE = '(.+?)'/.exec(siegel);
    expect(m, 'die Vorgabe des Siegels ist nicht mehr auffindbar').not.toBeNull();
    expect(m![1], 'die Vorgabe ist wieder ein Buchstabe').not.toMatch(/[A-Za-z0-9]/);
  });

  it('⛔ keine fremde Marke, die ein Händler sehen könnte', () => {
    // Der alte Ladenname darf in keinem sichtbaren Text stehen. Kommentare
    // und Prüfsätze dürfen ihn nennen: sie erklären, was NICHT sein soll.
    for (const [name, pfad] of FLAECHEN) {
      const f = lies(pfad);
      const sichtbar = f
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        // ⚠️ `@norns/` ist der Name des Pakets, nicht der des Ladens.
        // Der erste Entwurf dieses Satzes fiel darüber, und ein Fehlalarm
        // hätte den echten Treffer unsichtbar gemacht.
        .replace(/@warehouse14\//g, '');
      expect(sichtbar, `${name} trägt die alte Marke`).not.toMatch(/WAREHOUSE\s*14/i);
    }
  });
});
