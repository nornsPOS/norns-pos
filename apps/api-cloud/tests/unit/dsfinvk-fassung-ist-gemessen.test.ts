/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE FASSUNG IM PRÜFERPAKET MUSS GEMESSEN SEIN, NICHT EINGETIPPT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND (04.08.2026, gemessen) ──────────────────────────────────────
 *
 * `apps/tauri-pos/src-tauri/tauri.conf.json` sagt: die Kasse ist `0.0.2`.
 * `cashregister.csv` im Prüferpaket sagte: `KASSE_SW_VERSION` ist `1.0.0`.
 *
 * Der Wert kam aus dieser Zeile in `routes/closing-export.ts`:
 *
 *     softwareVersion: process.env.APP_VERSION ?? '1.0.0',
 *
 * `APP_VERSION` wird im ganzen Baum nirgends gesetzt. Der Ersatzwert griff
 * also IMMER. Jedes je gezogene Paket nannte dem Finanzamt eine Fassung, die
 * es nie gegeben hat — eine unwahre Angabe in einem amtlichen Dokument.
 *
 * ── WAS DIESE PRÜFUNG BEWACHT ──────────────────────────────────────────────
 *
 * Vier Zusagen, und keine davon hängt an einer Namensliste:
 *
 *   1. Unbekannt heisst LEER. Der Motor erfindet keine Zahl.
 *   2. Bekannt heisst WÖRTLICH. Was hereinkommt, steht unverändert in der
 *      Spalte — kein Umformen, kein Runden, kein Abschneiden.
 *   3. Im GANZEN Quellbaum steht nirgends eine eingetippte Fassung an einem
 *      Fassungsfeld. Die Dateiliste wird beim Lauf ERLAUFEN, nicht
 *      aufgezählt: eine neue Datei mit demselben Fehler fällt auf, ohne dass
 *      jemand diese Prüfung nachzieht.
 *   4. Der Weg zur wahren Quelle steht: der Sidecar setzt die Fassung aus
 *      `tauri.conf.json`, nicht aus einem Literal.
 *
 * ⚠️ Und die Prüfung prüft SICH SELBST: das Muster aus Zusage 3 muss die
 * historisch echte Fehlerzeile erkennen. Ohne diesen Schritt wäre ein
 * Tippfehler im Muster ein für immer grüner Wächter, der nichts bewacht.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  formeDaten,
  kassensoftwareFassung,
  type MenschlicheAngaben,
} from '../../src/lib/dsfinvk-daten.js';
import { baueAlleDateien } from '../../src/lib/dsfinvk-dateien.js';
import type { DsfinvkBundleInput } from '../../src/lib/dsfinvk-export.js';
import { leseTaxonomie } from '../../src/lib/dsfinvk-taxonomie.js';
import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';

const TAX = leseTaxonomie(
  readFileSync(new URL('../../src/fiskal/dsfinvk-2.4/index.xml', import.meta.url), 'utf8'),
);

const lies = (pfad: string): string =>
  readFileSync(new URL(pfad, import.meta.url), 'utf8');

/**
 * Kommentare raus, bevor der Quelltext befragt wird.
 *
 * ⚠️ Tragend, nicht kosmetisch: die Dateien, die hier geprüft werden, tragen
 * die alte Fehlerzeile absichtlich WÖRTLICH in ihren Kommentaren, damit der
 * nächste Leser sie sieht. Ohne diesen Schnitt wäre die Prüfung von ihrem
 * eigenen Hausbrauch dauerhaft rot.
 */
const ohneKommentare = (q: string): string =>
  q
    .split('\n')
    .filter((z) => !/^\s*(\/\/|\*|\/\*)/.test(z))
    .join('\n');

// ═══════════════════════════════════════════════════════════════════════════
//  1 + 2 — DAS VERHALTEN, DURCH DEN ECHTEN ERZEUGER
// ═══════════════════════════════════════════════════════════════════════════

/** Ein Tag ohne Belege. Er genügt: geprüft wird die Stammzeile der Kasse. */
const TAG: DsfinvkBundleInput = {
  businessDay: '2026-06-19',
  closing: {
    zNr: '15',
    finalizedAt: '2026-06-19T20:00:00.000Z',
    grossVerkaufEur: '0.00',
    grossAnkaufEur: '0.00',
    netVerkaufEur: '0.00',
    netAnkaufEur: '0.00',
    vatByTreatment: {},
    paymentsByMethod: {},
    cashCountedEur: '0.00',
  },
  cashRegister: { id: 'POS-1', serialNumber: 'SN-1', brand: 'Norns', model: 'Tresen' },
  receipts: [],
};

const mensch = (fassung: string): MenschlicheAngaben => ({
  gvTypAnkauf: 'Auszahlung',
  stammdaten: leseStammdaten({
    'shop.legal_name': 'Muster e. K.',
    'shop.street': 'Musterstraße 1',
    'shop.postal_code': '73614',
    'shop.city': 'Schorndorf',
    'shop.country_code': 'DEU',
    'shop.tax_number': '12345/67890',
  }),
  eigeneUstSchluessel: {},
  eigeneUstSaetze: {},
  kassenSeriennummer: 'KS-1',
  taxonomieVersion: '2.4',
  softwareVersion: fassung,
});

/** Die Spalte, die der Betriebsprüfer liest — aus dem echten Erzeuger. */
const gemeldeteFassung = (fassung: string): string => {
  const datei = baueAlleDateien(TAX, formeDaten(TAG, mensch(fassung))).find(
    (d) => d.name === 'cashregister.csv',
  );
  expect(datei, 'cashregister.csv fehlt im Paket').toBeDefined();
  const zeilen = datei!.content.split('\r\n').filter((z) => z !== '');
  const kopf = (zeilen[0] ?? '').split(';');
  const spalte = kopf.indexOf('KASSE_SW_VERSION');
  expect(spalte, 'die Spalte KASSE_SW_VERSION fehlt').toBeGreaterThanOrEqual(0);
  return (zeilen[1] ?? '').split(';')[spalte] ?? '';
};

describe('⛔ die Fassung im amtlichen Paket', () => {
  it('unbekannt heisst LEER, nicht erfunden', () => {
    // Der Prüfer sieht dann eine Lücke. Eine Lücke ist erklärbar; eine
    // falsche Zahl ist eine unwahre Angabe.
    expect(gemeldeteFassung('')).toBe('');
    expect(gemeldeteFassung('   ')).toBe('');
  });

  it('bekannt heisst WÖRTLICH — Zeichen für Zeichen', () => {
    expect(gemeldeteFassung('0.0.2')).toBe('0.0.2');
    expect(gemeldeteFassung('1.4.11-rc.2')).toBe('1.4.11-rc.2');
  });

  it('⛔ und die Kasse meldet NIE ihre eigene Behauptung von 1.0.0', () => {
    // Der ganze Befund in einem Satz: ohne Angabe darf dort niemals wieder
    // eine Fassung stehen.
    expect(gemeldeteFassung('')).not.toBe('1.0.0');
  });
});

describe('⛔ woher die Fassung kommen darf', () => {
  it('aus der Umgebung, die der Sidecar setzt', () => {
    expect(kassensoftwareFassung({ NORNS_KASSE_VERSION: '0.0.2' })).toBe('0.0.2');
  });

  it('ersatzweise aus APP_VERSION, für eine Aufstellung ohne Sidecar', () => {
    expect(kassensoftwareFassung({ APP_VERSION: '3.2.1' })).toBe('3.2.1');
  });

  it('die Kasse gewinnt gegen den allgemeinen Weg', () => {
    expect(
      kassensoftwareFassung({ NORNS_KASSE_VERSION: '0.0.2', APP_VERSION: '9.9.9' }),
    ).toBe('0.0.2');
  });

  it('⛔ aus NICHTS wird nichts', () => {
    expect(kassensoftwareFassung({})).toBe('');
  });

  it('⛔ was keine Fassung ist, wird auch nicht als solche gemeldet', () => {
    // Ein versehentlich gesetztes Wort, ein Pfad, ein halber Wert: alles
    // besser leer als auf dem Prüferdatenträger.
    for (const müll of ['true', 'latest', '/opt/norns', 'v0.0.2 (dev)', '0.0', 'null']) {
      expect(kassensoftwareFassung({ NORNS_KASSE_VERSION: müll }), müll).toBe('');
    }
  });

  it('⛔ und eine Fassung über 50 Zeichen bleibt leer statt abgeschnitten', () => {
    // MaxLength 50 laut der mitgelieferten amtlichen Beschreibung. Ein
    // abgeschnittener Wert wäre eine ANDERE Fassung, also wieder eine
    // unwahre Angabe.
    const lang = `1.0.0-${'a'.repeat(60)}`;
    expect(kassensoftwareFassung({ NORNS_KASSE_VERSION: lang })).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  3 — DER GANZE QUELLBAUM, ERLAUFEN STATT AUFGEZÄHLT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Eine eingetippte Fassung an einem Fassungsfeld.
 *
 * Trifft `swVersion = '1.0.0'`, `softwareVersion: "2.1"`, `appVersion ?? '1.0'`
 * und jede Schreibweise dazwischen. Trifft ABSICHTLICH NICHT Zeilen wie
 * `'User-Agent': 'Warehouse14/1.0.0'` — dort steht die Zahl nicht an einem
 * Fassungsfeld, sondern in einem Text.
 */
const EINGETIPPTE_FASSUNG = /(?:sw|software|app|kasse_sw)_?version\s*[:=]\s*[^;\n]*?['"`]\d+\.\d+/i;

const SRC = fileURLToPath(new URL('../../src', import.meta.url));

/** Alle `.ts` unter `src`, ERLAUFEN. Eine neue Datei ist von selbst dabei. */
const alleQuellen = (ordner: string): string[] => {
  const raus: string[] = [];
  for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
    const pfad = join(ordner, eintrag.name);
    if (eintrag.isDirectory()) raus.push(...alleQuellen(pfad));
    else if (pfad.endsWith('.ts')) raus.push(pfad);
  }
  return raus;
};

describe('⛔ nirgends im Motor steht eine eingetippte Fassung', () => {
  it('das Muster erkennt die ECHTE Fehlerzeile von damals', () => {
    // ⚠️ Ohne diesen Schritt wäre ein Tippfehler im Muster ein für immer
    // grüner Wächter. Die Zeile ist die historische, wörtlich.
    expect(
      EINGETIPPTE_FASSUNG.test("          softwareVersion: process.env.APP_VERSION ?? '1.0.0',"),
    ).toBe(true);
    expect(EINGETIPPTE_FASSUNG.test('  swVersion = "2.1.0"')).toBe(true);
    // Und es schlägt NICHT bei einer Zahl an, die keine Fassungsangabe ist.
    expect(EINGETIPPTE_FASSUNG.test("  'User-Agent': 'Warehouse14/1.0.0',")).toBe(false);
  });

  it('⛔ und findet im ganzen Quellbaum keine einzige', () => {
    const quellen = alleQuellen(SRC);
    // Die Liste muss plausibel gross sein — ein kaputter Läufer, der null
    // Dateien findet, wäre sonst grün und blind.
    expect(quellen.length, 'der Quellbaum wurde nicht erlaufen').toBeGreaterThan(50);

    const treffer: string[] = [];
    for (const datei of quellen) {
      const zeilen = ohneKommentare(readFileSync(datei, 'utf8')).split('\n');
      zeilen.forEach((zeile, i) => {
        if (EINGETIPPTE_FASSUNG.test(zeile)) {
          treffer.push(`${datei.slice(SRC.length + 1)}:${i + 1}  ${zeile.trim()}`);
        }
      });
    }
    // ⚠️ ALLE Treffer auf einmal melden. Ein Wächter, der beim ersten
    // stehenbleibt, verdeckt den zweiten.
    expect(treffer, `eingetippte Fassung gefunden:\n${treffer.join('\n')}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  4 — DER WEG ZUR WAHREN QUELLE STEHT
// ═══════════════════════════════════════════════════════════════════════════

describe('⛔ der Weg von der wahren Quelle bis in die Spalte', () => {
  it('die Exportroute reicht keinen eigenen Wert mehr herein', () => {
    // Auf die EIGENSCHAFT prüfen, nicht auf den Funktionsnamen: was auch
    // immer dort steht, es darf keine Zeichenkette sein. Damit bleibt die
    // Prüfung gültig, wenn jemand den Erzeuger umbenennt.
    // ⚠️ 18.08.2026: der Rumpf wohnt in lib/dsfinvk-tag.ts; beide lesen.
    const q = ohneKommentare(
      lies('../../src/lib/dsfinvk-tag.ts') + '\n' + lies('../../src/routes/closing-export.ts'),
    );
    const m = /softwareVersion:\s*([^,\n]*)/.exec(q);
    expect(m, 'die Route setzt softwareVersion gar nicht mehr').not.toBeNull();
    const wert = m![1] ?? '';
    expect(wert, 'die Route tippt die Fassung wieder von Hand ein').not.toMatch(/['"`]/);
  });

  it('der Sidecar setzt die Fassung, und zwar aus tauri.conf.json', () => {
    const roh = lies('../../sidecar/norns-sidecar.mjs');
    const q = ohneKommentare(roh);

    // a) Er bindet die kanonische Datei ein — und niemand anderen.
    const einbindung = /import\s+([A-Za-z_$][\w$]*)\s+from\s+'([^']*tauri\.conf\.json)'/.exec(q);
    expect(einbindung, 'der Sidecar liest die kanonische Fassung nicht ein').not.toBeNull();
    const [, name, pfad] = einbindung!;

    // b) Der Pfad zeigt auf die Datei, die es wirklich gibt, und ihre
    //    Fassung ist eine, die diese Prüfung durchlässt. Damit hängt der
    //    Wächter an der ECHTEN Quelle, nicht an einer Schreibweise.
    const konf = JSON.parse(
      readFileSync(new URL(`../../sidecar/${pfad}`, import.meta.url), 'utf8'),
    ) as { version?: string };
    expect(typeof konf.version, 'tauri.conf.json nennt keine Fassung').toBe('string');
    expect(kassensoftwareFassung({ NORNS_KASSE_VERSION: konf.version })).toBe(konf.version);

    // c) Und er gibt sie weiter, ohne dabei eine Zahl einzutippen.
    const weitergabe = /NORNS_KASSE_VERSION:\s*([\s\S]*?),\n/.exec(q);
    expect(weitergabe, 'der Sidecar reicht die Fassung nicht weiter').not.toBeNull();
    const wert = weitergabe![1] ?? '';
    expect(wert, 'der Sidecar nennt die eingebundene Fassung nicht').toContain(name!);
    expect(wert, 'der Sidecar tippt die Fassung von Hand ein').not.toMatch(/\d+\.\d+/);
  });
});
