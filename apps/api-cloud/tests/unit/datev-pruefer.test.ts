/**
 * Der Prüfer wird an DATEVs eigener Datei GEEICHT.
 *
 * ── DIE REGEL, die diesen Test trägt ───────────────────────────────────────
 * Ein Prüfer, der zu streng ist, blockiert richtige Dateien, und man schaltet
 * ihn ab. Einer, der zu lasch ist, nützt nichts. Es braucht einen Massstab,
 * der nicht von unserer Meinung abhängt, und es gibt genau einen:
 *
 *     Der Prüfer MUSS DATEVs Musterdatei fehlerfrei durchlassen.
 *
 * Meldet er über `EXTF_Buchungsstapel.csv` auch nur einen Fehler, ist NICHT
 * die Datei falsch, sondern der Prüfer.
 *
 * Danach erst die zweite Frage: findet er die Fehler, die wir kennen? Dafür
 * werden richtige Dateien absichtlich kaputtgemacht, jede auf genau eine Art.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  type DatevMandant,
  FELD,
  baueBuchungsstapel,
} from '../../src/lib/datev-format.js';
import { nurFehler, pruefeBuchungsstapel } from '../../src/lib/datev-pruefer.js';

const VORLAGE = new URL('../vorlagen/EXTF_Buchungsstapel_DATEV_Muster.csv', import.meta.url).pathname;

const MANDANT: DatevMandant = {
  beraternummer: 29098,
  mandantennummer: 55003,
  wirtschaftsjahrBeginn: '2026-01-01',
  sachkontenlaenge: 4,
  festschreibung: false,
  sachkontenrahmen: '03',
};
const ZEITRAUM = { von: '2026-05-01', bis: '2026-05-31' };

function zeile() {
  return new Map<number, string>([
    [FELD.UMSATZ, '900,00'],
    [FELD.SOLL_HABEN, 'S'],
    [FELD.WKZ_UMSATZ, 'EUR'],
    [FELD.KONTO, '1000'],
    [FELD.GEGENKONTO, '8400'],
    [FELD.BELEGDATUM, '2905'],
    [FELD.BELEGFELD_1, 'VK-2026-000123'],
    [FELD.BUCHUNGSTEXT, 'Verkauf VK-2026-000123 bar'],
  ]);
}

function unsereDatei(): string {
  return baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [zeile()], new Date());
}

describe('die Eichung an DATEVs eigener Datei', () => {
  it('laesst DATEVs Musterdatei OHNE einen einzigen Fehler durch', () => {
    const muster = readFileSync(VORLAGE, 'utf8');
    const fehler = nurFehler(pruefeBuchungsstapel(muster));
    // Schlaegt das fehl, ist der Pruefer zu streng — nicht die Datei falsch.
    expect(
      fehler.map((f) => `Zeile ${f.zeile} Feld ${f.feld}: ${f.text}`),
    ).toEqual([]);
  });

  it('laesst unsere eigene Datei ebenso durch', () => {
    expect(nurFehler(pruefeBuchungsstapel(unsereDatei()))).toEqual([]);
  });
});

describe('und er findet, was kaputt ist', () => {
  it('eine zwoelfspaltige Datei — genau der Zustand bis zum 26.07.2026', () => {
    const alt =
      'EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;;;;;;;;;\r\n' +
      'Umsatz;Soll/Haben;WKZ;Kurs;Basis-Umsatz;WKZ Basis-Umsatz;Konto;Gegenkonto;' +
      'BU-Schlüssel;Belegdatum;Belegfeld1;Buchungstext\r\n' +
      '"1234,56";"S";"EUR";;;;"1000";"8400";"3";"2905";"RCP-1";"Verkauf"\r\n';
    const f = nurFehler(pruefeBuchungsstapel(alt));
    expect(f.length).toBeGreaterThan(0);
    expect(f.some((x) => /Spaltenzeile hat 12/.test(x.text))).toBe(true);
    expect(f.some((x) => /12 Felder statt 125/.test(x.text))).toBe(true);
  });

  it('eine Kopfzeile ohne Beraternummer', () => {
    const kaputt = unsereDatei().replace(/;29098;/, ';;');
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => x.feld === 11)).toBe(true);
  });

  it('ein Betrag mit Punkt statt Komma', () => {
    const kaputt = unsereDatei().replace('900,00', '900.00');
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => x.feld === 1)).toBe(true);
  });

  it('ein Betrag mit Vorzeichen — die Richtung gehoert in Feld 2', () => {
    const kaputt = unsereDatei().replace('900,00', '-900,00');
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => x.feld === 1)).toBe(true);
  });

  it('ein Konto in Anfuehrungszeichen', () => {
    const kaputt = unsereDatei().replace(';1000;8400;', ';"1000";8400;');
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => x.feld === 7)).toBe(true);
  });

  it('ein Belegdatum mit Jahr statt TTMM', () => {
    const kaputt = unsereDatei().replace(';2905;', ';29052026;');
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => x.feld === 10)).toBe(true);
  });

  it('ein unmoeglicher Monat', () => {
    const kaputt = unsereDatei().replace(';2905;', ';2913;');
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => x.feld === 10)).toBe(true);
  });

  it('eine Datei ohne abschliessendes CR LF', () => {
    const kaputt = unsereDatei().replace(/\r\n$/, '');
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => /CR LF/.test(x.text))).toBe(true);
  });

  it('ein umbenannter Spaltenname — auch wenn er „aufgeraeumt" aussieht', () => {
    // DATEV schreibt Feld 49 als `Zusatzinformation- Inhalt 1`, ohne Leerzeichen
    // vor dem Bindestrich. Wer das begradigt, weicht von der Vorlage ab.
    const kaputt = unsereDatei().replace(
      'Zusatzinformation- Inhalt 1',
      'Zusatzinformation - Inhalt 1',
    );
    expect(nurFehler(pruefeBuchungsstapel(kaputt)).some((x) => x.zeile === 2)).toBe(true);
  });
});

describe('der Hinweis, der kein Fehler ist', () => {
  it('meldet ein LEERES Feld 114 als Hinweis, nicht als Fehler', () => {
    // Leer ist formal zulaessig, aber DATEV schreibt einen solchen Stapel
    // automatisch fest, ohne Rueckweg. Der Berater muss das wissen.
    const ohne = unsereDatei().split('\r\n');
    const f = ohne[2]!.split(';');
    f[113] = '';
    ohne[2] = f.join(';');
    const befunde = pruefeBuchungsstapel(ohne.join('\r\n'));
    expect(nurFehler(befunde)).toEqual([]);
    expect(befunde.some((x) => x.schwere === 'hinweis' && x.feld === 114)).toBe(true);
  });
});

describe('⛔ Die Sachkontenlaenge im Kopf gilt auch fuer die Zeilen', () => {
  /*
   * ── DER BEFUND ────────────────────────────────────────────────────────
   *
   * Kopf-Feld 14 sagt DATEV, wie viele Stellen ein Sachkonto hat. DATEV
   * unterscheidet Sachkonto und Personenkonto GENAU an dieser Laenge.
   * Der Pruefer mass jede Stelle fuer sich und diese BEZIEHUNG gar nicht.
   *
   * ── ⚠️ UND WARUM DIE ERSTE FASSUNG DIESES WAECHTERS FALSCH WAR ────────
   *
   * Er verlangte zuerst, dass ein KUERZERES Konto gemeldet wird. Die Eichung
   * an DATEVs eigener Musterdatei hat das sofort widerlegt: dort stehen bei
   * Sachkontenlaenge 4 die Konten 85, 320 und 980. Kuerzere Konten sind
   * regulaer. Was es nicht gibt, ist ein Konto laenger als n plus eins.
   *
   * Die Eichung hat hier einen Pruefer verhindert, der richtige Dateien
   * abgewiesen haette.
   */

  it('⛔ ein Konto, das LAENGER ist als Sachkonto und Personenkonto, wird gemeldet', () => {
    const zuLang = zeile();
    zuLang.set(FELD.KONTO, '100000'); // sechs Stellen bei Sachkontenlaenge 4
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [zuLang], new Date());

    const fehler = nurFehler(pruefeBuchungsstapel(datei));
    const treffer = fehler.filter((f) => /Sachkontenl(ä|ae)nge/i.test(f.text));

    expect(
      treffer.length,
      'der Pruefer misst die Kontenlaenge des Kopfes nicht gegen die Zeilen: ' +
        JSON.stringify(fehler.map((f) => f.text)),
    ).toBeGreaterThan(0);
    expect(treffer[0]!.text).toMatch(/100000/);
  });

  it('⚠️ das Personenkonto mit einer Stelle mehr bleibt erlaubt', () => {
    const mitDebitor = zeile();
    mitDebitor.set(FELD.KONTO, '10001'); // fuenf Stellen bei Sachkontenlaenge 4
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [mitDebitor], new Date());

    expect(
      nurFehler(pruefeBuchungsstapel(datei)).filter((f) => /Sachkontenl(ä|ae)nge/i.test(f.text)),
      'ein Personenkonto wurde faelschlich als Fehler gemeldet',
    ).toEqual([]);
  });

  it('⚠️ und ein KUERZERES Konto ebenfalls, DATEVs eigene Datei hat welche', () => {
    const kurz = zeile();
    kurz.set(FELD.GEGENKONTO, '85'); // steht so in EXTF_Buchungsstapel_DATEV_Muster.csv
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [kurz], new Date());

    expect(
      nurFehler(pruefeBuchungsstapel(datei)).filter((f) => /Sachkontenl(ä|ae)nge/i.test(f.text)),
      'ein kurzes Konto wurde gemeldet, obwohl DATEVs Musterdatei welche enthaelt',
    ).toEqual([]);
  });

  it('⚠️ und unsere richtige Datei bleibt ohne diesen Fehler', () => {
    expect(
      nurFehler(pruefeBuchungsstapel(unsereDatei())).filter((f) =>
        /Sachkontenl(ä|ae)nge/i.test(f.text),
      ),
    ).toEqual([]);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE ZWEI REGELN VOM 19.08.2026
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Beide Fehler hat der Export ein Jahr lang wirklich gemacht, und dieser
 * Prüfer liess beide mit null Befunden durch. Der Steuerschlüssel auf dem
 * Automatikkonto stand sogar in unseren eigenen Tests als Sollzustand.
 */
describe('⛔ Steuerschluessel auf Automatikkonto', () => {
  it('meldet Schluessel 3 auf 8400 — der Fehler, der bis 19.08.2026 in jeder Datei stand', () => {
    const z = zeile();
    z.set(FELD.BU_SCHLUESSEL, '3');
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [z], new Date());
    const f = nurFehler(pruefeBuchungsstapel(datei));
    expect(f.some((x) => /Automatikkonto 8400/.test(x.text) && /REW00305/.test(x.text))).toBe(true);
  });

  it('laesst Schluessel 40 auf 8400 durch — Aufhebung der Automatik ist dort ERLAUBT', () => {
    // DATEVs Musterdatei setzt 40 zweimal auf 8400. Ein Pruefer, der das
    // meldet, weist die Datei des Herstellers zurueck und ist selbst falsch.
    const z = zeile();
    z.set(FELD.BU_SCHLUESSEL, '40');
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [z], new Date());
    expect(nurFehler(pruefeBuchungsstapel(datei))).toEqual([]);
  });

  it('laesst Schluessel 3 auf 8200 durch — ein Konto OHNE Automatik braucht ihn', () => {
    const z = zeile();
    z.set(FELD.GEGENKONTO, '8200');
    z.set(FELD.BU_SCHLUESSEL, '3');
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [z], new Date());
    expect(nurFehler(pruefeBuchungsstapel(datei))).toEqual([]);
  });
});

describe('⛔ Storno ohne Generalumkehr', () => {
  it('meldet eine STORNO-Zeile ohne Feld 118', () => {
    const z = zeile();
    z.set(FELD.BUCHUNGSTEXT, 'STORNO VERKAUF RCP-2026-000123 (STANDARD_19)');
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [z], new Date());
    const f = nurFehler(pruefeBuchungsstapel(datei));
    expect(f.some((x) => /Generalumkehr/.test(x.text))).toBe(true);
  });

  it('laesst dieselbe Zeile MIT der Marke durch', () => {
    const z = zeile();
    z.set(FELD.BUCHUNGSTEXT, 'STORNO VERKAUF RCP-2026-000123 (STANDARD_19)');
    z.set(FELD.GENERALUMKEHR, '1');
    const datei = baueBuchungsstapel(MANDANT, ZEITRAUM, 'Kasse Mai 2026', [z], new Date());
    expect(nurFehler(pruefeBuchungsstapel(datei))).toEqual([]);
  });
});
