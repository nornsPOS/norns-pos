/**
 * Der QR-Zeichner gegen VERÖFFENTLICHTE Zahlen, nicht gegen sich selbst.
 *
 * ── WARUM DIESE PRÜFUNG SO AUSSIEHT ─────────────────────────────────────────
 * Am 25.07.2026 lieferte dieser Zeichner beim ersten Anlauf einen Code, der
 * strukturell TADELLOS war: drei Sucherkreuze, saubere Taktlinien, das dunkle
 * Modul an der richtigen Stelle, und ein Formatzeichen, das sich in beiden
 * Kopien zu demselben gültigen Wert zurücklesen liess (0x5e7c, Stufe M,
 * Maske 2). Er sah aus wie ein QR-Code, und kein Lesegerät der Welt konnte ihn
 * entziffern.
 *
 * Der Fehler lag EINE Ebene tiefer: das Generatorpolynom kam in steigender
 * Ordnung aus der Schleife, die Division brauchte es in fallender. Kein
 * struktureller Test hätte das gefunden — die Struktur war ja richtig. Nur der
 * Vergleich der Fehlerkorrekturbytes mit einem veröffentlichten Vektor zeigt
 * es, und nur ein echtes Zurücklesen beweist das Ganze.
 *
 * Deshalb prüft diese Datei ZWEI Dinge, die man nicht selbst erfinden kann:
 *   1. Die Reed-Solomon-Bytes gegen das bekannte Lehrbeispiel „HELLO WORLD"
 *      in Version 1-Q (15 Datenbytes → 13 Fehlerbytes).
 *   2. Die Struktur, die man ohne Lesegerät prüfen kann.
 *
 * Das ZURÜCKLESEN mit einem echten Lesegerät läuft im Browser
 * (`BarcodeDetector`) und ist im Sitzungsprotokoll festgehalten; es gehört
 * nicht in eine Node-Prüfung, weil dort kein Lesegerät existiert.
 */
import { describe, expect, it } from 'vitest';

import {
  type QrGitter,
  alphanumerikTauglich,
  fehlerbytes,
  generator,
  qrGitter,
  qrSvgPfad,
} from './qr.js';

/* ─────────────────────────────────────────────────────────────────────────────
 * EIN ECHTES LESEGERÄT, IN DIESER DATEI GEBAUT
 *
 * Der Kopf dieser Datei sagte bis zum 26.07.2026, das Zurücklesen gehöre nicht
 * in eine Node-Prüfung, weil dort kein Lesegerät existiert. Das war der bequeme
 * Teil der Wahrheit: ein Lesegerät MUSS man nicht mitbringen, man kann es
 * schreiben. Und es muss geschrieben werden, sobald der QR ein tragender Code
 * auf einem 17,6 mm breiten Etikett wird und nicht mehr Beiwerk auf einem Beleg.
 *
 * Der Leser hier ist bewusst UNABHÄNGIG vom Zeichner gebaut:
 *   • Die Lage der Ausrichtungsmuster wird GERECHNET (Anhang E der Norm), nicht
 *     aus der Tabelle des Zeichners übernommen. Genau dort sass 2026 der
 *     Verschiebungsfehler um eine Version.
 *   • Das Formatzeichen wird aus dem Bild gelesen, entschlüsselt und sein
 *     BCH-Rest NEU gerechnet. Der Zeichner benutzt eine fertige Tabelle; hier
 *     wird sie nachgerechnet.
 *   • Jeder Block wird als Reed-Solomon-Wort geprüft (alle Syndrome null). Das
 *     beweist die Fehlerkorrekturbytes UND die Verschränkung zugleich: eine
 *     falsch entflochtene Blockgrenze macht die Syndrome sofort ungleich null.
 *
 * EHRLICHE GRENZE: die Kapazitätstabelle (Tabelle 9 der Norm) steht hier ein
 * zweites Mal. Wäre sie in BEIDEN Dateien gleich falsch abgeschrieben, sähe der
 * Leser nichts. Dagegen steht der veröffentlichte Vektor weiter oben und der
 * Umstand, dass eine falsche Kapazität die Syndrome zerreissen würde.
 * ────────────────────────────────────────────────────────────────────────── */

/** Je Version bei Stufe M: [Datenbytes gesamt, EK-Bytes je Block, Blöcke G1, Blöcke G2]. */
const M_TABELLE: readonly (readonly [number, number, number, number])[] = [
  [16, 10, 1, 0], [28, 16, 1, 0], [44, 26, 1, 0], [64, 18, 2, 0], [86, 24, 2, 0],
  [108, 16, 4, 0], [124, 18, 4, 0], [154, 22, 2, 2], [182, 22, 3, 2], [216, 26, 4, 1],
  [254, 30, 1, 4], [290, 22, 6, 2], [334, 22, 8, 1], [365, 24, 4, 5], [415, 24, 5, 5],
  [453, 28, 7, 3], [507, 28, 10, 1], [563, 26, 9, 4], [627, 26, 3, 11], [669, 26, 3, 13],
];

const ALNUM_TABELLE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

// ── Ein eigenes GF(256) für den Leser ───────────────────────────────────────
const G_EXP = new Uint8Array(512);
const G_LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    G_EXP[i] = x;
    G_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) G_EXP[i] = G_EXP[i - 255] as number;
}
function gmul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return G_EXP[(G_LOG[a] as number) + (G_LOG[b] as number)] as number;
}

/**
 * Die Lage der Ausrichtungsmuster, GERECHNET statt abgeschrieben (Anhang E).
 * Erstes Feld immer 6, letztes immer Kantenlänge minus 7, dazwischen gleiche
 * Abstände, auf eine gerade Zahl aufgerundet.
 */
function ausrichtungsOrte(version: number): number[] {
  if (version === 1) return [];
  const anzahl = Math.floor(version / 7) + 2;
  const schritt = Math.floor((version * 4 + anzahl * 2 + 1) / (anzahl * 2 - 2)) * 2;
  const orte: number[] = [];
  for (let ort = version * 4 + 10; orte.length < anzahl - 1; ort -= schritt) orte.unshift(ort);
  orte.unshift(6);
  return orte;
}

/** Die acht Maskenformeln der Norm (Tabelle 10). */
function maske(m: number, x: number, y: number): boolean {
  switch (m) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

interface Gelesen {
  version: number;
  maskennummer: number;
  modus: 'alphanumerik' | 'byte';
  text: string;
}

/**
 * Ein QR-Gitter zurücklesen — Format, Maske, Verschränkung, Syndrome, Modus,
 * Zähler, Nutzdaten. Wirft mit einem sprechenden Grund, sobald etwas nicht
 * stimmt; darum ist jeder Aufruf schon für sich eine Prüfung.
 */
function leseQr(gitter: QrGitter): Gelesen {
  const n = gitter.groesse;
  if ((n - 17) % 4 !== 0) throw new Error(`Leser: Kantenlänge ${n} gehört zu keiner Version`);
  const version = (n - 17) / 4;
  const an = (x: number, y: number): boolean => gitter.module[y * n + x] === true;

  // ── Formatzeichen: beide Kopien lesen, vergleichen, BCH nachrechnen ────────
  const kopie1: number[] = [];
  for (let i = 0; i < 6; i += 1) kopie1.push(an(8, i) ? 1 : 0);
  kopie1.push(an(8, 7) ? 1 : 0, an(8, 8) ? 1 : 0, an(7, 8) ? 1 : 0);
  for (let i = 9; i < 15; i += 1) kopie1.push(an(14 - i, 8) ? 1 : 0);
  const kopie2: number[] = [];
  for (let i = 0; i < 8; i += 1) kopie2.push(an(n - 1 - i, 8) ? 1 : 0);
  for (let i = 8; i < 15; i += 1) kopie2.push(an(8, n - 15 + i) ? 1 : 0);
  if (kopie1.join('') !== kopie2.join('')) {
    throw new Error('Leser: die beiden Formatzeichen sind verschieden');
  }
  let roh = 0;
  for (let i = 0; i < 15; i += 1) roh |= (kopie1[i] as number) << i;
  const entlarvt = roh ^ 0x5412;
  const nutz = entlarvt >> 10;
  // Den 10-Bit-BCH-Rest neu rechnen (Generator 0x537) und das Ganze vergleichen.
  let rest = nutz;
  for (let i = 0; i < 10; i += 1) rest = ((rest << 1) ^ ((rest >>> 9) * 0x537)) & 0x7ff;
  const erwartet = (((nutz << 10) | (rest & 0x3ff)) ^ 0x5412) & 0x7fff;
  if (erwartet !== roh) throw new Error('Leser: das Formatzeichen hält seiner BCH-Prüfung nicht');
  const stufe = nutz >> 3;
  if (stufe !== 0b00) throw new Error(`Leser: Fehlerkorrekturstufe ${stufe} ist nicht M`);
  const maskennummer = nutz & 0b111;

  // ── Die Funktionsfelder bestimmen (alles, was keine Daten trägt) ───────────
  const fest: boolean[] = new Array(n * n).fill(false);
  const sperre = (x: number, y: number): void => {
    if (x >= 0 && y >= 0 && x < n && y < n) fest[y * n + x] = true;
  };
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      sperre(x, y);
      sperre(n - 1 - x, y);
      sperre(x, n - 1 - y);
    }
  }
  for (let i = 0; i <= 8; i += 1) {
    sperre(8, i);
    sperre(i, 8);
  }
  for (let i = 0; i < 8; i += 1) {
    sperre(n - 1 - i, 8);
    sperre(8, n - 1 - i);
  }
  for (let i = 0; i < n; i += 1) {
    sperre(i, 6);
    sperre(6, i);
  }
  const orte = ausrichtungsOrte(version);
  for (const cy of orte) {
    for (const cx of orte) {
      const beiSucher = (cx <= 8 && cy <= 8) || (cx >= n - 9 && cy <= 8) || (cx <= 8 && cy >= n - 9);
      if (beiSucher) continue;
      for (let y = -2; y <= 2; y += 1) for (let x = -2; x <= 2; x += 1) sperre(cx + x, cy + y);
    }
  }
  if (version >= 7) {
    for (let i = 0; i < 18; i += 1) {
      sperre(Math.floor(i / 3), n - 11 + (i % 3));
      sperre(n - 11 + (i % 3), Math.floor(i / 3));
    }
  }

  // ── Den Zickzack ablaufen und dabei die Maske abziehen ─────────────────────
  const bits: number[] = [];
  for (let rechts = n - 1; rechts >= 1; rechts -= 2) {
    if (rechts === 6) rechts = 5;
    for (let lauf = 0; lauf < n; lauf += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = rechts - j;
        const aufwaerts = ((rechts + 1) & 2) === 0;
        const y = aufwaerts ? n - 1 - lauf : lauf;
        if (fest[y * n + x]) continue;
        bits.push((an(x, y) !== maske(maskennummer, x, y)) ? 1 : 0);
      }
    }
  }

  const [kapazitaet, ekProBlock, blockG1, blockG2] = M_TABELLE[version - 1] as readonly [
    number, number, number, number,
  ];
  const bloecke = blockG1 + blockG2;
  const gesamtBytes = kapazitaet + ekProBlock * bloecke;
  if (bits.length < gesamtBytes * 8) {
    throw new Error(`Leser: nur ${bits.length} Bit gefunden, ${gesamtBytes * 8} erwartet`);
  }
  const strom: number[] = [];
  for (let i = 0; i < gesamtBytes; i += 1) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | (bits[i * 8 + j] as number);
    strom.push(b);
  }

  // ── Die Verschränkung rückgängig machen ───────────────────────────────────
  const kurz = Math.floor(kapazitaet / bloecke);
  const laengen = Array.from({ length: bloecke }, (_, i) => (i < blockG1 ? kurz : kurz + 1));
  const daten: number[][] = laengen.map(() => []);
  let ort = 0;
  for (let i = 0; i < kurz + 1; i += 1) {
    for (let b = 0; b < bloecke; b += 1) {
      if (i < (laengen[b] as number)) {
        (daten[b] as number[]).push(strom[ort] as number);
        ort += 1;
      }
    }
  }
  const ek: number[][] = laengen.map(() => []);
  for (let i = 0; i < ekProBlock; i += 1) {
    for (let b = 0; b < bloecke; b += 1) {
      (ek[b] as number[]).push(strom[ort] as number);
      ort += 1;
    }
  }

  // ── Jeder Block muss ein gültiges Reed-Solomon-Wort sein ──────────────────
  for (let b = 0; b < bloecke; b += 1) {
    const wort = [...(daten[b] as number[]), ...(ek[b] as number[])];
    for (let k = 0; k < ekProBlock; k += 1) {
      const stelle = G_EXP[k] as number;
      let acc = 0;
      for (const c of wort) acc = gmul(acc, stelle) ^ c;
      if (acc !== 0) throw new Error(`Leser: Block ${b} ist kein gültiges RS-Wort (Syndrom ${k})`);
    }
  }

  // ── Den Datenstrom auslesen ───────────────────────────────────────────────
  const datenBits: number[] = [];
  for (const block of daten) {
    for (const byte of block) for (let i = 7; i >= 0; i -= 1) datenBits.push((byte >> i) & 1);
  }
  let p = 0;
  const nimm = (anzahl: number): number => {
    let wert = 0;
    for (let i = 0; i < anzahl; i += 1) wert = (wert << 1) | (datenBits[p + i] as number);
    p += anzahl;
    return wert;
  };
  const moduskopf = nimm(4);
  if (moduskopf === 0b0010) {
    const anzahl = nimm(version < 10 ? 9 : 11);
    let text = '';
    let übrig = anzahl;
    while (übrig >= 2) {
      const paar = nimm(11);
      if (paar >= 45 * 45) throw new Error(`Leser: Paarwert ${paar} liegt ausserhalb der Tabelle`);
      text += ALNUM_TABELLE[Math.floor(paar / 45)];
      text += ALNUM_TABELLE[paar % 45];
      übrig -= 2;
    }
    if (übrig === 1) {
      const einzeln = nimm(6);
      if (einzeln >= 45) throw new Error(`Leser: Einzelwert ${einzeln} liegt ausserhalb der Tabelle`);
      text += ALNUM_TABELLE[einzeln];
    }
    return { version, maskennummer, modus: 'alphanumerik', text };
  }
  if (moduskopf === 0b0100) {
    const anzahl = nimm(version < 10 ? 8 : 16);
    const bytes = new Uint8Array(anzahl);
    for (let i = 0; i < anzahl; i += 1) bytes[i] = nimm(8);
    return { version, maskennummer, modus: 'byte', text: new TextDecoder().decode(bytes) };
  }
  throw new Error(`Leser: unbekannter Moduskopf ${moduskopf.toString(2)}`);
}

/** Der längste Text, den eine Version im jeweiligen Modus noch trägt. */
function längsteProbe(version: number, modus: 'alphanumerik' | 'byte'): string {
  const [kapazitaet] = M_TABELLE[version - 1] as readonly [number, number, number, number];
  if (modus === 'byte') {
    const zaehler = version < 10 ? 8 : 16;
    const anzahl = Math.floor((kapazitaet * 8 - 4 - zaehler) / 8);
    return 'w'.repeat(anzahl); // klein geschrieben: erzwingt den Byte-Modus
  }
  const zaehler = version < 10 ? 9 : 11;
  const frei = kapazitaet * 8 - 4 - zaehler;
  let anzahl = Math.floor(frei / 11) * 2;
  if (frei - (anzahl / 2) * 11 >= 6) anzahl += 1;
  const muster = 'W14-AU-750-0012 $%*+-./:';
  return Array.from({ length: anzahl }, (_, i) => muster[i % muster.length]).join('');
}

describe('Reed-Solomon', () => {
  it('trifft den veröffentlichten Vektor „HELLO WORLD" (1-M, 16 Daten → 10 Fehler)', () => {
    // Das meistzitierte Beispiel der Norm-Literatur. Die Zahlen sind NICHT aus
    // diesem Zeichner: sie sind der Prüfstein, gegen den er gehalten wird.
    //
    // ⚠ Und die Version zählt: mein erster Anlauf nahm den Vektor eines
    // 5-Q-Blocks (15 Daten → 18 Fehler) und prüfte ihn gegen 13 Fehlerbytes.
    // Der Test wurde rot, das Rechenwerk war aber richtig. Eine Prüfzahl ohne
    // ihre Version ist keine Prüfzahl.
    const daten = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    const erwartet = [196, 35, 39, 119, 235, 215, 231, 226, 93, 23];
    expect(fehlerbytes(daten, 10)).toEqual(erwartet);
  });

  it('trifft die veröffentlichten Exponenten des Generatorpolynoms (Grad 13)', () => {
    // α-Exponenten aus der Norm-Tabelle. Prüft die Ordnung UND die Werte.
    const EXP = new Uint8Array(512);
    const LOG = new Uint8Array(256);
    let x = 1;
    for (let i = 0; i < 255; i += 1) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    const exponenten = generator(13).map((v) => LOG[v]);
    expect(exponenten).toEqual([0, 74, 152, 176, 100, 86, 100, 106, 104, 130, 218, 206, 140, 78]);
  });

  it('liefert das Generatorpolynom in FALLENDER Ordnung', () => {
    // (x + 1)(x + α) = x² + 3x + 2 → [1, 3, 2], nicht [2, 3, 1].
    // Genau diese Umkehrung war der Fehler, der einen unlesbaren Code erzeugte.
    expect(generator(1)).toEqual([1, 1]);
    expect(generator(2)).toEqual([1, 3, 2]);
    expect(generator(10)[0]).toBe(1);
  });
});

describe('qrGitter — die Struktur', () => {
  it('wählt die kleinste Version, die reicht', () => {
    expect(qrGitter('W14').version).toBe(1);
    expect(qrGitter('x'.repeat(20)).version).toBeGreaterThanOrEqual(2);
    // Ein echter TSE-Bezug ist lang, muss aber noch bequem passen.
    expect(qrGitter('x'.repeat(340)).version).toBeLessThanOrEqual(20);
  });

  it('hat die Kantenlänge der Norm: Version mal vier plus siebzehn', () => {
    for (const text of ['W14', 'x'.repeat(50), 'y'.repeat(200)]) {
      const g = qrGitter(text);
      expect(g.groesse).toBe(g.version * 4 + 17);
      expect(g.module.length).toBe(g.groesse * g.groesse);
    }
  });

  it('trägt drei Sucherkreuze an den richtigen Ecken', () => {
    const g = qrGitter('W14');
    const an = (x: number, y: number): boolean => g.module[y * g.groesse + x] === true;
    for (const [ox, oy] of [
      [0, 0],
      [g.groesse - 7, 0],
      [0, g.groesse - 7],
    ] as const) {
      // Aussenring dunkel, Trennring hell, Kern dunkel.
      expect(an(ox + 0, oy + 0), 'Aussenecke').toBe(true);
      expect(an(ox + 1, oy + 1), 'Trennring').toBe(false);
      expect(an(ox + 3, oy + 3), 'Kern').toBe(true);
    }
  });

  it('trägt die beiden Taktlinien im Wechsel', () => {
    const g = qrGitter('W14');
    const an = (x: number, y: number): boolean => g.module[y * g.groesse + x] === true;
    for (let i = 8; i < g.groesse - 8; i += 1) {
      expect(an(i, 6), `waagerecht bei ${i}`).toBe(i % 2 === 0);
      expect(an(6, i), `senkrecht bei ${i}`).toBe(i % 2 === 0);
    }
  });

  it('trägt das eine immer dunkle Modul', () => {
    const g = qrGitter('W14');
    expect(g.module[(g.groesse - 8) * g.groesse + 8]).toBe(true);
  });

  it('legt in beide Kopien DASSELBE gültige Formatzeichen der Stufe M', () => {
    const g = qrGitter('W14');
    const n = g.groesse;
    const lies = (stellen: (i: number) => number): number => {
      let wert = 0;
      for (let i = 0; i < 15; i += 1) if (g.module[stellen(i)]) wert |= 1 << i;
      return wert;
    };
    const senkrecht = lies((i) => (i < 6 ? i : i < 8 ? i + 1 : n - 15 + i) * n + 8);
    const waagerecht = lies((i) => 8 * n + (i < 8 ? n - 1 - i : i < 9 ? 7 : 15 - i - 1));
    expect(senkrecht).toBe(waagerecht);
    // Die acht gültigen Zeichen der Stufe M (Tabelle C.1 der Norm).
    expect([0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0]).toContain(senkrecht);
  });

  it('wirft ehrlich, statt einen unlesbaren Code zu zeichnen', () => {
    expect(() => qrGitter('x'.repeat(700))).toThrow(/passen nicht/);
  });

  it('behandelt Umlaute als UTF-8-Bytes, nicht als Zeichen', () => {
    // „ä" ist ZWEI Bytes. Wer hier nach Zeichen zählt, baut einen Code, dessen
    // Längenfeld lügt — und der ist unlesbar.
    const nurAscii = qrGitter('aaa');
    const mitUmlaut = qrGitter('äää');
    expect(mitUmlaut.version).toBeGreaterThanOrEqual(nurAscii.version);
  });
});

describe('alphanumerikTauglich', () => {
  it('erkennt genau die 45 Zeichen der Tabelle', () => {
    expect(alphanumerikTauglich(ALNUM_TABELLE)).toBe(true);
    expect(alphanumerikTauglich('HTTPS://WAREHOUSE14.DE/P/MZ-0042')).toBe(true);
  });

  it('lehnt Kleinbuchstaben und alles Fremde ab', () => {
    expect(alphanumerikTauglich('https://warehouse14.de/p/MZ-0042')).toBe(false);
    expect(alphanumerikTauglich('MÜNZE')).toBe(false);
    expect(alphanumerikTauglich('W14?')).toBe(false); // das Fragezeichen fehlt in der Tabelle
    expect(alphanumerikTauglich('MZ-0042!')).toBe(false);
    expect(alphanumerikTauglich('')).toBe(false);
  });
});

/*
 * ── DAS ZURÜCKLESEN ─────────────────────────────────────────────────────────
 * Ab hier prüft nicht mehr die Struktur, sondern der Leser oben. Er bricht bei
 * jedem Formatfehler, jedem zerrissenen Reed-Solomon-Block, jedem falschen
 * Zähler ab — deshalb ist schon ein Aufruf ohne Ausnahme ein Beweis.
 */
describe('Zurücklesen mit einem eigenen Leser', () => {
  it('liest den Verweis des kleinen Etiketts und zwar in Version 2', () => {
    // DER FALL, DER DEN MODUS ÜBERHAUPT ERZWUNGEN HAT. In Grossschrift trägt
    // Version 2 diesen Verweis; als Bytes wäre es Version 3, und auf 100
    // Druckpunkten hiesse das 0,254 mm statt 0,33867 mm je Modul.
    const verweis = 'HTTPS://WAREHOUSE14.DE/P/MZ-0042';
    const gitter = qrGitter(verweis);
    expect(gitter.modus).toBe('alphanumerik');
    expect(gitter.version).toBe(2);
    const gelesen = leseQr(gitter);
    expect(gelesen.modus).toBe('alphanumerik');
    expect(gelesen.text).toBe(verweis);

    // Und der Beleg, dass der Modus nicht bloss Zierde ist:
    const alsBytes = qrGitter('https://warehouse14.de/p/MZ-0042');
    expect(alsBytes.modus).toBe('byte');
    expect(alsBytes.version).toBe(3);
    expect(leseQr(alsBytes).text).toBe('https://warehouse14.de/p/MZ-0042');
  });

  it('liest jede Version 1 bis 20 im Alphanumerik-Modus zurück', () => {
    for (let v = 1; v <= 20; v += 1) {
      const text = längsteProbe(v, 'alphanumerik');
      const gitter = qrGitter(text);
      expect(gitter.version, `Version ${v} randvoll`).toBe(v);
      expect(gitter.modus).toBe('alphanumerik');
      const gelesen = leseQr(gitter);
      expect(gelesen.version).toBe(v);
      expect(gelesen.modus).toBe('alphanumerik');
      expect(gelesen.text).toBe(text);
    }
  });

  it('liest jede Version 1 bis 20 im Byte-Modus zurück', () => {
    for (let v = 1; v <= 20; v += 1) {
      const text = längsteProbe(v, 'byte');
      const gitter = qrGitter(text);
      expect(gitter.version, `Version ${v} randvoll`).toBe(v);
      expect(gitter.modus).toBe('byte');
      const gelesen = leseQr(gitter);
      expect(gelesen.version).toBe(v);
      expect(gelesen.modus).toBe('byte');
      expect(gelesen.text).toBe(text);
    }
  });

  it('liest eine UNGERADE Zeichenzahl zurück (das Restzeichen zu sechs Bit)', () => {
    // Ein Paar sind elf Bit, ein einzelnes Restzeichen sechs. Wer dem Rest elf
    // gibt, schiebt alles Folgende um fünf Bit — und der Code sieht dabei
    // vollkommen normal aus.
    for (const text of ['W', 'W14', 'MZ-0042', 'W14 AU 750 0012 A']) {
      expect(text.length % 2, `${text} muss ungerade sein`).toBe(1);
      const gelesen = leseQr(qrGitter(text));
      expect(gelesen.modus).toBe('alphanumerik');
      expect(gelesen.text).toBe(text);
    }
  });

  it('liest alle 45 Zeichen der Tabelle an ihrer richtigen Stelle zurück', () => {
    // Fängt einen nach ASCII sortierten Nachbau der Tabelle: dort stünde etwa
    // das Leerzeichen vor dem Doppelpunkt an anderer Stelle.
    const gelesen = leseQr(qrGitter(ALNUM_TABELLE));
    expect(gelesen.text).toBe(ALNUM_TABELLE);
    // Jedes einzelne Zeichen auch allein, damit ein Verrutschen um eine Stelle
    // nicht in einem langen Text untergeht.
    for (const zeichen of ALNUM_TABELLE) {
      expect(leseQr(qrGitter(zeichen)).text, `Zeichen „${zeichen}"`).toBe(zeichen);
    }
  });

  it('liest Umlaute als UTF-8 zurück (Byte-Modus)', () => {
    const text = 'Münze 20 Mark, geprägt 1913 — Zustand: schön';
    const gelesen = leseQr(qrGitter(text));
    expect(gelesen.modus).toBe('byte');
    expect(gelesen.text).toBe(text);
  });

  it('liest den Verweis, den die Kasse heute druckt', () => {
    // `qrVerweis` liefert `w14://p/<Artikelnummer>` — klein geschrieben, also
    // Byte-Modus. Auch der muss zurücklesbar sein.
    const gelesen = leseQr(qrGitter('w14://p/W14-AU-750-0012'));
    expect(gelesen.modus).toBe('byte');
    expect(gelesen.text).toBe('w14://p/W14-AU-750-0012');
  });
});

describe('qrSvgPfad', () => {
  it('zeichnet genau so viele Quadrate, wie dunkle Module da sind', () => {
    const g = qrGitter('W14');
    const dunkel = g.module.filter(Boolean).length;
    const quadrate = (qrSvgPfad(g).match(/M\d+ \d+h1v1h-1z/g) ?? []).length;
    expect(quadrate).toBe(dunkel);
  });

  it('baut EINEN Pfad, nicht tausend Knoten', () => {
    // Ein QR der Version 10 hat 3481 Module. Dreitausend <rect> in einer
    // Belegvorschau kosten sichtbar Zeit beim Zeichnen.
    const pfad = qrSvgPfad(qrGitter('x'.repeat(200)));
    expect(pfad).not.toContain('<');
    expect(pfad.startsWith('M')).toBe(true);
  });
});
