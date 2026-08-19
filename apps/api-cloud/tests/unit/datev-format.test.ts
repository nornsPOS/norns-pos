/**
 * Unser Buchungsstapel wird gegen DATEVs EIGENE Datei gehalten, nicht gegen
 * eine Beschreibung davon.
 *
 * ── WARUM SO (26.07.2026) ──────────────────────────────────────────────────
 * Die vorherige Fassung schrieb zwölf Spalten mit selbst erfundenen Namen und
 * hatte einen grünen Test. Der Test prüfte, was der Code tat, nicht was DATEV
 * verlangt. Deshalb liegen unter `tests/vorlagen/` zwei unveränderte Dateien
 * von DATEV: die Musterdatei und die maschinenlesbare Formatdefinition. Jeder
 * Wächter hier misst gegen eine davon.
 */
import { readFileSync } from 'node:fs';
import { nurFehler, pruefeBuchungsstapel } from '../../src/lib/datev-pruefer.js';

import { describe, expect, it } from 'vitest';

import {
  DATEV_SPALTEN,
  type DatevMandant,
  DatevFormatFehler,
  FELD,
  baueBuchungsstapel,
  baueBuchungszeile,
  baueKopfzeile,
  baueSpaltenzeile,
  datevDateiname,
  kodiereAnsi,
  zuBelegdatum,
  zuDatevBetrag,
  zuErzeugtAm,
} from '../../src/lib/datev-format.js';

const VORLAGE = new URL('../vorlagen/EXTF_Buchungsstapel_DATEV_Muster.csv', import.meta.url).pathname;
const DEFINITION = new URL('../vorlagen/Format_Buchungsstapel_DATEV.xml', import.meta.url).pathname;

const musterZeilen = readFileSync(VORLAGE, 'utf8').split('\r\n');

const MANDANT: DatevMandant = {
  beraternummer: 29098,
  mandantennummer: 55003,
  wirtschaftsjahrBeginn: '2026-01-01',
  sachkontenlaenge: 4,
  festschreibung: false,
  sachkontenrahmen: '03',
};
const ZEITRAUM = { von: '2026-05-01', bis: '2026-05-31' };

describe('die Vorlagen sind da und sind die echten', () => {
  it('die Musterdatei traegt DATEVs Kopfzeile', () => {
    expect(musterZeilen[0]).toContain('"EXTF";700;21;"Buchungsstapel";13;');
  });

  it('die Formatdefinition kennt 125 Felder', () => {
    const xml = readFileSync(DEFINITION, 'utf8');
    expect((xml.match(/<Field\b/g) ?? []).length).toBe(125);
  });
});

describe('die Spaltenzeile', () => {
  it('ist WOERTLICH die von DATEV, Zeichen fuer Zeichen', () => {
    // Der eigentliche Wächter. Er faellt, sobald jemand einen Spaltennamen
    // „aufraeumt" — etwa DATEVs eigene Uneinheitlichkeit bei
    // `Zusatzinformation - Art 1` gegen `Zusatzinformation- Inhalt 1`.
    expect(baueSpaltenzeile()).toBe(musterZeilen[1]);
  });

  it('hat genau 125 Spalten', () => {
    expect(DATEV_SPALTEN.length).toBe(125);
    expect(baueSpaltenzeile().split(';').length).toBe(125);
  });
});

describe('die Kopfzeile', () => {
  const kopf = baueKopfzeile(MANDANT, ZEITRAUM, 'Kasse Mai 2026', new Date('2026-07-26T12:30:12.345Z'));
  const f = kopf.split(';');

  it('hat genau 31 Felder, wie DATEVs eigene', () => {
    expect(f.length).toBe(31);
    expect(musterZeilen[0]!.split(';').length).toBe(31);
  });

  it('traegt Version 700 und Formatversion 13', () => {
    expect(f[1]).toBe('700');
    expect(f[4]).toBe('13');
  });

  it('setzt die Sachkontenlaenge auf Feld 14, nicht auf 15', () => {
    // Genau der Fehler der alten Fassung: die 4 sass auf Position 15, also
    // im Feld „Datum von".
    expect(f[13]).toBe('4');
    expect(f[14]).toBe('20260501');
    expect(f[15]).toBe('20260531');
  });

  it('traegt die fuenf Ordnungsbegriffe des Steuerberaters', () => {
    expect(f[10]).toBe('29098'); // Beraternummer
    expect(f[11]).toBe('55003'); // Mandantennummer
    expect(f[12]).toBe('20260101'); // Wirtschaftsjahresbeginn
    expect(f[20]).toBe('0'); // Festschreibung
  });

  it('unterscheidet ECHT LEER von zwei Anfuehrungszeichen, wie die Vorlage', () => {
    const v = musterZeilen[0]!.split(';');
    for (const i of [6, 22, 24, 25, 27, 28]) {
      expect(f[i], `Feld ${i + 1} muss echt leer sein`).toBe('');
      expect(v[i], `Vorlage Feld ${i + 1}`).toBe('');
    }
    for (const i of [9, 23, 29]) {
      expect(f[i], `Feld ${i + 1} muss "" sein`).toBe('""');
      expect(v[i], `Vorlage Feld ${i + 1}`).toBe('""');
    }
  });

  it('bricht ab, wenn eine Angabe des Steuerberaters unbrauchbar ist', () => {
    // Ein Stapel mit leeren Ordnungsbegriffen sieht aus wie ein Export und
    // ist keiner. Lieber hier laut werden.
    expect(() => baueKopfzeile({ ...MANDANT, beraternummer: 12 }, ZEITRAUM, 'x', new Date())).toThrow(
      DatevFormatFehler,
    );
    expect(() =>
      baueKopfzeile({ ...MANDANT, sachkontenlaenge: 9 }, ZEITRAUM, 'x', new Date()),
    ).toThrow(DatevFormatFehler);
    expect(() =>
      baueKopfzeile({ ...MANDANT, wirtschaftsjahrBeginn: '01.01.2026' }, ZEITRAUM, 'x', new Date()),
    ).toThrow(DatevFormatFehler);
  });

  it('der Zeitstempel hat 17 Stellen', () => {
    expect(zuErzeugtAm(new Date('2026-01-30T13:04:40.439Z'))).toMatch(/^\d{17}$/);
  });
});

describe('eine Buchungszeile', () => {
  const zeile = new Map<number, string>([
    [FELD.UMSATZ, '900,00'],
    [FELD.SOLL_HABEN, 'S'],
    [FELD.WKZ_UMSATZ, 'EUR'],
    [FELD.KONTO, '1000'],
    [FELD.GEGENKONTO, '8400'],
    [FELD.BELEGDATUM, '2905'],
    [FELD.BELEGFELD_1, 'VK-2026-000123'],
    [FELD.BUCHUNGSTEXT, 'Verkauf VK-2026-000123 bar'],
  ]);

  it('hat genau 125 Felder', () => {
    expect(baueBuchungszeile(zeile, false).split(';').length).toBe(125);
  });

  it('fasst NUR Textfelder ein, Betrag und Konto bleiben roh', () => {
    const f = baueBuchungszeile(zeile, false).split(';');
    expect(f[0]).toBe('900,00'); // Umsatz, roh
    expect(f[1]).toBe('"S"'); // Soll/Haben, Text
    expect(f[6]).toBe('1000'); // Konto, roh
    expect(f[7]).toBe('8400'); // Gegenkonto, roh
    expect(f[9]).toBe('2905'); // Belegdatum, roh
    expect(f[10]).toBe('"VK-2026-000123"'); // Belegfeld 1, Text
  });

  it('schreibt die Festschreibung IMMER, nie leer', () => {
    // Leer heisst bei DATEV: automatisch festschreiben, ohne Rueckweg, und
    // der Stapel laesst sich nicht mehr an einen bestehenden anhaengen.
    expect(baueBuchungszeile(zeile, false).split(';')[113]).toBe('0');
    expect(baueBuchungszeile(zeile, true).split(';')[113]).toBe('1');
  });

  it('bricht ab, wenn ein Pflichtfeld fehlt', () => {
    const ohneKonto = new Map(zeile);
    ohneKonto.delete(FELD.KONTO);
    expect(() => baueBuchungszeile(ohneKonto, false)).toThrow(/Pflichtfeld 7/);
  });

  it('bricht ab bei einem Zeichen, das DATEV im Belegfeld nicht zulaesst', () => {
    // Still bereinigen waere schlimmer: die Belegnummer lautete dann auf dem
    // Papier anders als in der Buchfuehrung.
    const mitPunkt = new Map(zeile).set(FELD.BELEGFELD_1, 'VK 2026.123');
    expect(() => baueBuchungszeile(mitPunkt, false)).toThrow(/Belegfeld 1/);
  });

  it('bricht ab, wenn der Buchungstext zu lang ist', () => {
    const lang = new Map(zeile).set(FELD.BUCHUNGSTEXT, 'x'.repeat(61));
    expect(() => baueBuchungszeile(lang, false)).toThrow(/Feld 14/);
  });

  it('verdoppelt ein Anfuehrungszeichen im Text', () => {
    const mitZitat = new Map(zeile).set(FELD.BUCHUNGSTEXT, 'Ring "Rose"');
    expect(baueBuchungszeile(mitZitat, false).split(';')[13]).toBe('"Ring ""Rose"""');
  });
});

describe('die ganze Datei', () => {
  const zeile = new Map<number, string>([
    [FELD.UMSATZ, '900,00'],
    [FELD.SOLL_HABEN, 'S'],
    [FELD.KONTO, '1000'],
    [FELD.GEGENKONTO, '8400'],
    [FELD.BELEGDATUM, '2905'],
  ]);

  it('ist Kopf, Spalten, Buchungen — und endet mit CR LF', () => {
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [zeile], new Date());
    const zeilen = datei.split('\r\n');
    expect(zeilen[0]!.split(';').length).toBe(31);
    expect(zeilen[1]).toBe(musterZeilen[1]);
    expect(zeilen[2]!.split(';').length).toBe(125);
    expect(datei.endsWith('\r\n')).toBe(true);
  });

  it('weist mehr als 99.999 Buchungen zurueck statt sie abzuschneiden', () => {
    const viele = Array.from({ length: 100_000 }, () => zeile);
    expect(() => baueBuchungsstapel(MANDANT, ZEITRAUM, 'x', viele, new Date())).toThrow(/99.999/);
  });
});

describe('der Dateiname ist Teil des Vertrags', () => {
  it('beginnt mit EXTF_ und endet auf .csv', () => {
    const n = datevDateiname(MANDANT, ZEITRAUM);
    expect(n.startsWith('EXTF_')).toBe(true);
    expect(n.endsWith('.csv')).toBe(true);
    // Ohne das erscheint die Datei in DATEVs Stapelverarbeitung gar nicht,
    // Meldung REW04506 — sie wirkt, als waere sie nie angekommen.
  });
});

describe('die kleinen Umrechnungen', () => {
  it('Belegdatum ist TTMM, das Jahr steht nur im Kopf', () => {
    expect(zuBelegdatum('2026-05-29')).toBe('2905');
  });

  it('der Betrag traegt ein Komma und ist immer positiv', () => {
    expect(zuDatevBetrag('1234.5')).toBe('1234,50');
    expect(zuDatevBetrag('-900.00')).toBe('900,00');
  });

  it('eine Buchung ueber null wird zurueckgewiesen', () => {
    expect(() => zuDatevBetrag('0.00')).toThrow(DatevFormatFehler);
  });
});

describe('der Zeichensatz', () => {
  it('schreibt Umlaute als EIN Byte, wie ANSI es verlangt', () => {
    const b = kodiereAnsi('Schlüssel');
    expect(b.length).toBe(9);
    expect(b[4]).toBe(0xfc); // ü in Windows-1252
  });

  it('kennt das Eurozeichen', () => {
    expect(kodiereAnsi('€')[0]).toBe(0x80);
  });

  it('bricht ab statt ein Fragezeichen beim Berater abzuliefern', () => {
    expect(() => kodiereAnsi('Ring ♥')).toThrow(DatevFormatFehler);
  });
});

describe('⛔ Die Funde der boeswilligen Pruefung vom 19.08.2026', () => {
  /*
   * Beide Fehler betrafen TEXT aus der Hand des Haendlers (die Notiz einer
   * Ausgabe, der Grund einer Bargeldbewegung) — Felder ohne Zeichenfilter,
   * die bis in den Buchungstext durchreisen.
   */
  const zeileMit = (text: string): Map<number, string> =>
    new Map<number, string>([
      [FELD.UMSATZ, '120,00'],
      [FELD.SOLL_HABEN, 'S'],
      [FELD.WKZ_UMSATZ, 'EUR'],
      [FELD.KONTO, '4210'],
      [FELD.GEGENKONTO, '1200'],
      [FELD.BELEGDATUM, '1908'],
      [FELD.BUCHUNGSTEXT, text],
    ]);

  it('⛔ ein blosser Zeilenvorschub kommt NICHT in die Datei', () => {
    // \n ohne \r: genau die Luecke — der Pruefer trennte nur an \r\n und
    // zaehlte weiter 125 Felder, die Datei ging gruen hinaus und zerbrach
    // beim Steuerberater mitten im Satz.
    const roh = 'Miete Q1' + String.fromCharCode(10) + 'Rest' + String.fromCharCode(9) + 'Tab';
    const csv = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Probe', [zeileMit(roh)], new Date('2026-08-19'));
    expect(csv).toContain('Miete Q1 Rest Tab');
    const buchung = csv.split('\r\n').find((z) => z.includes('Miete Q1')) ?? '';
    // Kein rohes C0-Zeichen ueberlebt im Satz.
    // eslint-disable-next-line no-control-regex -- genau das ist die Pruefung
    expect(/[\u0000-\u001f]/.test(buchung), 'Steuerzeichen im Satz').toBe(false);
  });

  it('⛔ ein Semikolon im Buchungstext blockiert den Export NICHT mehr', () => {
    // In DATEV gueltig, solange gefasst. Der Pruefer zerlegte frueher naiv
    // mit split(';'), sah 126 Felder und sperrte den ganzen Tagesexport.
    const csv = baueBuchungsstapel(
      MANDANT,
      ZEITRAUM,
      'Probe',
      [zeileMit('Tresor; Rest und ein "Zitat"')],
      new Date('2026-08-19'),
    );
    const befunde = nurFehler(pruefeBuchungsstapel(csv));
    expect(befunde, JSON.stringify(befunde)).toEqual([]);
  });
});
