/**
 * Der DATEV-Buchungsstapel, gebaut nach DATEVs eigener Vorlage.
 *
 * ── WARUM ES DIESE DATEI GIBT (26.07.2026) ─────────────────────────────────
 * Was bis heute erzeugt wurde, war kein Buchungsstapel: zwölf Spalten mit
 * selbst erfundenen Namen, eine halb leere Kopfzeile mit einem um eine
 * Position verrutschten Feld, jedes Feld in Anführungszeichen, und ein
 * Dateiname, unter dem DATEV die Datei gar nicht erst anzeigt.
 *
 * Diese Fassung schreibt alle **125** Felder, die Kopfzeile mit allen **31**
 * Feldern, und hält sich an die Regeln, die aus DATEVs Musterdatei GEMESSEN
 * wurden, nicht aus einer Beschreibung abgeleitet. Die Spaltenliste steht in
 * `datev-spalten.generiert.ts`, dort auch die Herkunft.
 *
 * ── DIE ZWEI REGELN, die man nicht raten darf ──────────────────────────────
 *
 * 1. ANFÜHRUNGSZEICHEN FOLGEN DEM FELDTYP, nicht der Position.
 *    Gemessen an allen 54 Datenzeilen der Musterdatei, 6.750 Felder:
 *      • `Text` → IMMER eingefasst, auch wenn leer
 *      • sonst  → roh; leer heisst leer
 *    Kein einziges Nicht-Text-Feld mit Inhalt trägt Anführungszeichen.
 *
 * 2. DAS JAHR STEHT NUR IM KOPF.
 *    Das Belegdatum ist vierstellig `TTMM`, ohne Jahr. DATEV nimmt das Jahr
 *    aus Kopf-Feld 13, dem Wirtschaftsjahresbeginn. Solange dieses Feld leer
 *    ist, hat KEINE Buchung der Datei einen Jahresanker. Genau das war der
 *    Zustand: ein im Januar 2027 gezogener Export des 29.05.2026 wäre im
 *    Wirtschaftsjahr 2027 gelandet.
 *
 * ── UND DIE REGEL, DIE ÜBER ALLEM STEHT ────────────────────────────────────
 * Fehlt eine der fünf Angaben des Steuerberaters (Beraternummer,
 * Mandantennummer, Wirtschaftsjahresbeginn, Sachkontenlänge, Festschreibung),
 * wird KEINE Datei erzeugt. Ein Stapel mit leeren Ordnungsbegriffen sieht aus
 * wie ein Export und ist keiner — das ist dieselbe Fehlerklasse, die in
 * diesem Haus schon dreimal aufgetreten ist: etwas erfinden, statt zu sagen,
 * dass es nicht eingerichtet ist.
 */

import { DATEV_FELDER, DATEV_SPALTEN, FELD } from './datev-spalten.generiert.js';
import { wirtschaftsjahrFuer } from './datev-wirtschaftsjahr.js';

export { DATEV_SPALTEN, FELD };

/** Was der Steuerberater vorgibt. Ohne diese Angaben gibt es keine Datei. */
export interface DatevMandant {
  /** Kopf-Feld 11. Vier bis sieben Ziffern, 1001 bis 9999999. */
  readonly beraternummer: number;
  /** Kopf-Feld 12. Eine bis fünf Ziffern, 1 bis 99999. */
  readonly mandantennummer: number;
  /** Kopf-Feld 13, `YYYY-MM-DD`. Bestimmt das Jahr ALLER Belegdaten der Datei. */
  readonly wirtschaftsjahrBeginn: string;
  /** Kopf-Feld 14. Vier bis acht; muss zum Bestand des Beraters passen. */
  readonly sachkontenlaenge: number;
  /**
   * Kopf-Feld 21 und Satz-Feld 114.
   *
   * Leer zu lassen ist die schlechteste Wahl: ein Stapel ohne Kennzeichen
   * wird automatisch festgeschrieben, lässt sich nicht mehr entsperren und
   * auch nicht an einen bestehenden Stapel anhängen. Deshalb ist das hier
   * ein Pflichtwert, kein `undefined`.
   */
  readonly festschreibung: boolean;
  /** Kopf-Feld 27. `'03'` oder `'04'`. */
  readonly sachkontenrahmen: '03' | '04';
  /** Kopf-Feld 9, höchstens 25 Zeichen, NUR Wortzeichen, keine Leerzeichen. */
  readonly exportiertVon?: string;
}

export interface DatevZeitraum {
  /** `YYYY-MM-DD`, erster Tag. */
  readonly von: string;
  /** `YYYY-MM-DD`, letzter Tag. */
  readonly bis: string;
}

/** Eine Buchungszeile als Zuordnung Feldnummer → Wert. Nur Gefülltes steht drin. */
export type DatevZeile = ReadonlyMap<number, string>;

export class DatevFormatFehler extends Error {}

// ── Kleine Helfer, alle prüfbar ────────────────────────────────────────────

const TYP_JE_FELD = new Map(DATEV_FELDER.map((f) => [f.nr, f.typ]));
const LAENGE_JE_FELD = new Map(DATEV_FELDER.map((f) => [f.nr, f.laenge]));

/**
 * Belegfeld 1 ist der Ordnungsbegriff, unter dem der Berater den Beleg
 * wiederfindet. DATEV lässt dort nur Ziffern, Buchstaben und `$ & % * + - /`
 * zu. Ein Leerzeichen, ein Punkt oder ein Umlaut bricht den Import.
 *
 * Wir bereinigen NICHT still: eine stillschweigend geänderte Belegnummer ist
 * eine Belegnummer, die auf dem Papier anders lautet als in der Buchführung.
 */
const BELEGFELD_ERLAUBT = /^[0-9A-Za-z$&%*+\-/]*$/;

function nurZiffern(wert: number, stellenMin: number, stellenMax: number, feld: string): string {
  const s = String(wert);
  if (!/^\d+$/.test(s) || s.length < stellenMin || s.length > stellenMax) {
    throw new DatevFormatFehler(
      `${feld}: erwartet ${stellenMin} bis ${stellenMax} Ziffern, bekommen „${s}".`,
    );
  }
  return s;
}

/** `YYYY-MM-DD` → `YYYYMMDD`. */
function zuDatev8(iso: string, feld: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new DatevFormatFehler(`${feld}: erwartet YYYY-MM-DD, bekommen „${iso}".`);
  return `${m[1]}${m[2]}${m[3]}`;
}

/** `YYYY-MM-DD` → `TTMM`. Das Jahr kommt aus dem Kopf, siehe Dateikopf. */
export function zuBelegdatum(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) throw new DatevFormatFehler(`Belegdatum: erwartet YYYY-MM-DD, bekommen „${iso}".`);
  return `${m[3]}${m[2]}`;
}

/** "1234.50" → "1234,50". Immer positiv; die Richtung trägt Feld 2. */
export function zuDatevBetrag(eur: string): string {
  const t = eur.trim();
  const m = /^-?(\d+)(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) throw new DatevFormatFehler(`Umsatz: erwartet NUMERIC(18,2), bekommen „${eur}".`);
  const nachkomma = (m[2] ?? '').padEnd(2, '0');
  if (m[1] === '0' && nachkomma === '00') {
    // DATEV weist eine Buchung über null zurück, und sie wäre auch fachlich
    // sinnlos. Lieber hier laut werden als beim Berater.
    throw new DatevFormatFehler('Umsatz: eine Buchung über 0,00 ist nicht zulässig.');
  }
  return `${m[1]},${nachkomma}`;
}

/**
 * Ein Feld in seine Schreibweise bringen.
 *
 * Text wird eingefasst und ein enthaltenes Anführungszeichen verdoppelt.
 * Alles andere bleibt roh. Ein zu langer Wert bricht ab, statt beim Berader
 * abgeschnitten anzukommen.
 */
function schreibeFeld(nr: number, wert: string | undefined): string {
  const typ = TYP_JE_FELD.get(nr);
  if (typ === undefined) throw new DatevFormatFehler(`Feld ${nr} gibt es im Format nicht.`);
  const w = wert ?? '';
  const max = LAENGE_JE_FELD.get(nr) ?? 0;
  if (typ === 'Text') {
    if (max > 0 && w.length > max) {
      throw new DatevFormatFehler(
        `Feld ${nr} (${DATEV_SPALTEN[nr - 1]}): ${w.length} Zeichen, erlaubt sind ${max}.`,
      );
    }
    /*
     * ⛔ STEUERZEICHEN NIE INS FELD (19.08.2026, boeswillige Pruefung).
     *
     * Ein blosser Zeilenvorschub (0x0A) oder ein einzelnes 0x0D in einer
     * Notiz oder einem Bewegungsgrund wanderte bis hierher, wurde brav in
     * Anfuehrungszeichen gefasst — und die Selbstpruefung sah nichts: sie
     * trennt Zeilen an \r\n, ein blosses \n trennt dort also nicht, und die
     * Feldzahl blieb bei 125. Die Datei ging GRUEN hinaus und zerbrach beim
     * Steuerberater mitten im Satz: DATEV EXTF trennt Saetze mit CRLF und
     * duldet in einem Feld keinen Umbruch. Der Import bricht ab, oder die
     * Felder verschieben sich um Positionen (falscher Umsatz, falsches
     * Konto).
     *
     * Gesaeubert wird HIER, an der einen Stelle, durch die jeder Text muss:
     * Zeilenumbruch und Tabulator werden zu einem Leerzeichen (der Satz
     * bleibt lesbar), alle uebrigen C0-Zeichen und 0x7F fallen weg.
     * Anschliessend wird gefasst und das Anfuehrungszeichen verdoppelt.
     */
    const rein = w
      .replace(/[\r\n\t]+/g, ' ')
      // eslint-disable-next-line no-control-regex -- genau darum geht es hier
      .replace(/[\u0000-\u001f\u007f]/g, '');
    if (max > 0 && rein.length > max) {
      throw new DatevFormatFehler(
        `Feld ${nr} (${DATEV_SPALTEN[nr - 1]}): ${rein.length} Zeichen, erlaubt sind ${max}.`,
      );
    }
    return `"${rein.replace(/"/g, '""')}"`;
  }
  return w;
}

// ── Die Kopfzeile ──────────────────────────────────────────────────────────

/** Zeitstempel `YYYYMMDDHHMMSSFFF`, 17 Stellen, in Europa/Berlin. */
export function zuErzeugtAm(d: Date): string {
  const t = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const g = (n: string): string => t.find((p) => p.type === n)?.value ?? '00';
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  return `${g('year')}${g('month')}${g('day')}${g('hour')}${g('minute')}${g('second')}${ms}`;
}

/**
 * Die 31 Felder der Kopfzeile.
 *
 * Die Einteilung in eingefasst, roh und ECHT LEER ist aus DATEVs eigener
 * Musterdatei abgelesen. Felder 7, 23, 25, 26, 28 und 29 sind wirklich leer;
 * die Felder 9, 10, 24, 30 und 31 sind zwei Anführungszeichen. Das ist nicht
 * dasselbe, und beide Schreibweisen stehen so in der Vorlage.
 */
export function baueKopfzeile(
  mandant: DatevMandant,
  zeitraum: DatevZeitraum,
  bezeichnung: string,
  erzeugtAm: Date,
): string {
  const f: string[] = new Array<string>(31).fill('');

  f[0] = '"EXTF"';
  f[1] = '700'; // einzige zulässige Versionsnummer
  f[2] = '21'; // Formatkategorie Buchungsstapel
  f[3] = '"Buchungsstapel"';
  f[4] = '13'; // Formatversion, Stand der Definition vom 21.10.2025
  f[5] = zuErzeugtAm(erzeugtAm);
  f[6] = ''; // 7 Importiert — echt leer
  f[7] = '""'; // 8 Herkunft
  f[8] = `"${(mandant.exportiertVon ?? 'NornsKasse').replace(/\W/g, '').slice(0, 25)}"`;
  f[9] = '""'; // 10 Importiert von — DATEV füllt beim Import
  f[10] = nurZiffern(mandant.beraternummer, 4, 7, 'Beraternummer');
  f[11] = nurZiffern(mandant.mandantennummer, 1, 5, 'Mandantennummer');
  /**
   * ⚠️ Feld 13 wird GERECHNET, nicht abgeschrieben.
   *
   * DATEV wörtlich: „Das Jahr wird immer aus dem Feld #13 des Headers
   * ermittelt." Das Belegdatum der Buchungszeile ist nur `TTMM`. Stand hier
   * ein festes Jahr aus den Einstellungen, buchte DATEV ab dem 1. Januar des
   * zweiten Betriebsjahres JEDE Zeile ein Jahr zu früh — gemessen am
   * 05.08.2026, und der eigene Prüfer meldete dabei null Befunde.
   *
   * `altesDatumErlauben`: auf bestehenden Geräten steht in der Einstellung
   * noch ein volles Datum. Monat und Tag daraus gelten, das Jahr wird
   * verworfen; es hat nie gestimmt.
   */
  f[12] = zuDatev8(
    (() => {
      try {
        return wirtschaftsjahrFuer(mandant.wirtschaftsjahrBeginn, zeitraum.von, {
          altesDatumErlauben: true,
        });
      } catch (e) {
        // Der Grund bleibt WÖRTLICH erhalten, nur der Typ wird der des
        // Hauses: alles, was den Stapel abbricht, ist ein DatevFormatFehler,
        // und die Route fängt genau den.
        throw new DatevFormatFehler(e instanceof Error ? e.message : String(e));
      }
    })(),
    'Wirtschaftsjahresbeginn',
  );
  f[13] = nurZiffern(mandant.sachkontenlaenge, 1, 1, 'Sachkontenlänge');
  f[14] = zuDatev8(zeitraum.von, 'Datum von');
  f[15] = zuDatev8(zeitraum.bis, 'Datum bis');
  f[16] = `"${bezeichnung.slice(0, 30)}"`;
  f[17] = '""'; // 18 Diktatkürzel
  f[18] = '1'; // 19 Buchungstyp: Finanzbuchführung
  f[19] = '0'; // 20 Rechnungslegungszweck: unabhängig
  f[20] = mandant.festschreibung ? '1' : '0';
  f[21] = '"EUR"';
  f[22] = ''; // 23 reserviert — echt leer
  f[23] = '""'; // 24 Derivatskennzeichen
  f[24] = ''; // 25 reserviert — echt leer
  f[25] = ''; // 26 reserviert — echt leer
  f[26] = `"${mandant.sachkontenrahmen}"`;
  f[27] = ''; // 28 ID Branchenlösung
  f[28] = ''; // 29 reserviert — echt leer
  f[29] = '""'; // 30 reserviert
  f[30] = `"${zeitraum.von.slice(5, 7)}/${zeitraum.von.slice(0, 4)}"`;

  if (mandant.sachkontenlaenge < 4 || mandant.sachkontenlaenge > 8) {
    throw new DatevFormatFehler(
      `Sachkontenlänge: erlaubt sind 4 bis 8, bekommen ${mandant.sachkontenlaenge}.`,
    );
  }
  return f.join(';');
}

// ── Die Buchungszeilen ─────────────────────────────────────────────────────

/** Die Spaltenzeile, wörtlich aus der Vorlage. */
export function baueSpaltenzeile(): string {
  return DATEV_SPALTEN.join(';');
}

/**
 * Eine Buchungszeile mit allen 125 Feldern.
 *
 * Was nicht gesetzt ist, steht als leeres Feld da. Das ist der ganze Grund,
 * warum die zwölfspaltige Fassung nicht funktionieren konnte: das Format ist
 * positionsbasiert, ein fehlendes Feld verschiebt alle danach.
 */
export function baueBuchungszeile(zeile: DatevZeile, festschreibung: boolean): string {
  for (const f of DATEV_FELDER) {
    if (f.pflicht && !(zeile.get(f.nr) ?? '').trim()) {
      throw new DatevFormatFehler(`Pflichtfeld ${f.nr} (${f.label}) fehlt.`);
    }
  }
  const beleg = zeile.get(FELD.BELEGFELD_1) ?? '';
  if (!BELEGFELD_ERLAUBT.test(beleg)) {
    throw new DatevFormatFehler(
      `Belegfeld 1 „${beleg}" enthält ein Zeichen, das DATEV dort nicht zulässt. ` +
        'Erlaubt sind Ziffern, Buchstaben und $ & % * + - /.',
    );
  }

  const werte: string[] = [];
  for (let nr = 1; nr <= 125; nr += 1) {
    const eigen = nr === FELD.FESTSCHREIBUNG ? (festschreibung ? '1' : '0') : zeile.get(nr);
    werte.push(schreibeFeld(nr, eigen));
  }
  return werte.join(';');
}

/**
 * Die ganze Datei als Zeichenkette.
 *
 * Zeilenende ist CR LF, auch nach der letzten Zeile — so schreibt es DATEVs
 * eigene Vorlage.
 */
export function baueBuchungsstapel(
  mandant: DatevMandant,
  zeitraum: DatevZeitraum,
  bezeichnung: string,
  zeilen: readonly DatevZeile[],
  erzeugtAm: Date,
): string {
  if (zeilen.length > 99_999) {
    throw new DatevFormatFehler(
      `${zeilen.length} Buchungszeilen. DATEV nimmt höchstens 99.999 je Datei; ` +
        'der Zeitraum muss geteilt werden.',
    );
  }
  const teile = [
    baueKopfzeile(mandant, zeitraum, bezeichnung, erzeugtAm),
    baueSpaltenzeile(),
    ...zeilen.map((z) => baueBuchungszeile(z, mandant.festschreibung)),
  ];
  return `${teile.join('\r\n')}\r\n`;
}

/**
 * Der Dateiname ist Teil des Vertrags, nicht Kosmetik.
 *
 * Er muss mit `EXTF_` beginnen und auf `.csv` enden. Tut er das nicht,
 * erscheint die Datei in DATEVs Stapelverarbeitung überhaupt nicht, mit der
 * Meldung `REW04506` — eine sonst fehlerfreie Datei wirkt dann, als wäre sie
 * nie angekommen.
 */
export function datevDateiname(mandant: DatevMandant, zeitraum: DatevZeitraum): string {
  return `EXTF_Buchungsstapel_${mandant.beraternummer}_${mandant.mandantennummer}_${zeitraum.von}_${zeitraum.bis}.csv`;
}

/**
 * Nach Windows-1252 kodieren.
 *
 * ── ZWEI AMTLICHE QUELLEN, DIE SICH WIDERSPRECHEN ──────────────────────────
 * Die maschinenlesbare Formatdefinition, mit der DATEVs eigenes Prüfprogramm
 * arbeitet, sagt `<Coding>ANSI</Coding>`. DATEVs Musterdatei vom 18.06.2025
 * ist dagegen gemessen UTF-8 ohne Byte-Reihenfolge-Marke.
 *
 * Wir folgen der Formatdefinition, weil sie das ist, was prüft. Ein Zeichen,
 * das Windows-1252 nicht kennt, bricht hier ab, statt als Fragezeichen im
 * Buchungstext des Beraters zu landen.
 */
export function kodiereAnsi(text: string): Buffer {
  const funde = findeNichtKodierbare(text);
  if (funde.length > 0) throw new DatevFormatFehler(beschreibeFunde(funde));

  const bytes: number[] = [];
  for (const zeichen of text) {
    const p = zeichen.codePointAt(0) ?? 0;
    if (p <= 0xff && !(p >= 0x80 && p <= 0x9f)) {
      bytes.push(p);
      continue;
    }
    // `findeNichtKodierbare` hat oben schon jedes Zeichen geprüft; hier kann
    // nichts mehr fehlen. Der Rückfall bleibt trotzdem stehen, damit ein
    // künftiges Auseinanderdriften der beiden nicht still `undefined`
    // schreibt.
    const sonder = WIN1252_SONDER.get(p);
    if (sonder === undefined) throw new DatevFormatFehler(beschreibeFunde(findeNichtKodierbare(text)));
    bytes.push(sonder);
  }
  return Buffer.from(bytes);
}

/** Ein Zeichen, das DATEV nicht entgegennimmt, mit seinem Fundort. */
export interface NichtKodierbar {
  /** 1-basiert, gezählt über CRLF UND LF. */
  zeile: number;
  /** 1-basiert, in ZEICHEN gezählt, nicht in UTF-16-Einheiten. */
  spalte: number;
  zeichen: string;
  codepoint: number;
  /** Der Text der Zeile, gekürzt, damit der Händler ihn wiedererkennt. */
  auszug: string;
}

/**
 * Jede Stelle finden, die sich nicht nach Windows-1252 schreiben lässt.
 *
 * ── DER BEFUND VOM 08.08.2026 ─────────────────────────────────────────────
 *
 * `kodiereAnsi` läuft EINMAL über die fertige CSV. Der alte Abbruch nannte
 * das Zeichen und sonst nichts:
 *
 *     Das Zeichen „ş" (U+15F) lässt sich nicht nach Windows-1252 schreiben.
 *
 * Nicht die Zeile, nicht das Feld, nicht den Beleg. Der Händler hat einen
 * Monat mit vierhundert Buchungen und die Auskunft, dass irgendwo ein „ş"
 * steht. Ein einziger türkischer oder polnischer Kundenname genügt, und die
 * Ausfuhr scheitert bei jedem weiteren Versuch gleich, weil sich am Bestand
 * nichts ändert.
 *
 * ⚠️ Der ABBRUCH bleibt. Ein stilles Fragezeichen wäre ein falscher
 * Buchungstext beim Steuerberater, und die Entscheidung dagegen steht seit
 * jeher hier. Falsch war nur, dass das Nein nicht sagt, WO.
 *
 * Gemeldet werden ALLE Stellen, nicht nur die erste: sonst bessert der
 * Händler eine aus, startet neu, wartet, und bekommt die nächste.
 *
 * Rein: keine Uhr, kein Netz. Wirft nie.
 */
export function findeNichtKodierbare(text: string): NichtKodierbar[] {
  const funde: NichtKodierbar[] = [];
  let zeile = 1;
  let spalte = 0;

  // Über die ZEICHEN laufen, nicht über die UTF-16-Einheiten: ein Emoji
  // besteht aus zwei Einheiten und wäre sonst zwei Funde an falschen Spalten.
  const zeichenkette = [...text];
  for (let i = 0; i < zeichenkette.length; i++) {
    const zeichen = zeichenkette[i] as string;

    if (zeichen === '\n') {
      zeile++;
      spalte = 0;
      continue;
    }
    // CRLF zählt als EIN Zeilenumbruch. Die DATEV-Datei benutzt CRLF; wer nur
    // LF kennt, zählt in der echten Datei jede Zeile falsch, und eine falsche
    // Zeilennummer ist schlimmer als keine — der Händler sucht an der
    // falschen Stelle.
    if (zeichen === '\r') {
      if (zeichenkette[i + 1] === '\n') i++;
      zeile++;
      spalte = 0;
      continue;
    }

    spalte++;
    const p = zeichen.codePointAt(0) ?? 0;
    const kodierbar = (p <= 0xff && !(p >= 0x80 && p <= 0x9f)) || WIN1252_SONDER.has(p);
    if (kodierbar) continue;

    funde.push({
      zeile,
      spalte,
      zeichen,
      codepoint: p,
      auszug: zeileAuszug(text, zeile),
    });
  }
  return funde;
}

/** Die n-te Zeile, auf eine lesbare Länge gekürzt. */
function zeileAuszug(text: string, nummer: number): string {
  const zeilen = text.split(/\r\n|\r|\n/);
  const roh = zeilen[nummer - 1] ?? '';
  return roh.length <= 120 ? roh : `${roh.slice(0, 117)}…`;
}

/** Aus den Funden einen Satz machen, mit dem ein Mensch etwas anfangen kann. */
function beschreibeFunde(funde: readonly NichtKodierbar[]): string {
  // Mehr als zwanzig Stellen einzeln aufzuzählen hilft niemandem; dann ist
  // ohnehin etwas Grundsätzliches falsch. Die Zahl steht trotzdem da, damit
  // niemand denkt, es seien nur zwanzig.
  const GEZEIGT = 20;
  const zeilen = funde
    .slice(0, GEZEIGT)
    .map(
      (f) =>
        `  Zeile ${f.zeile}, Zeichen ${f.spalte}: „${f.zeichen}" ` +
        `(U+${f.codepoint.toString(16).toUpperCase()})\n    ${f.auszug}`,
    );
  const rest =
    funde.length > GEZEIGT ? `\n  … und ${funde.length - GEZEIGT} weitere Stellen.` : '';

  return (
    `Die DATEV-Datei enthält ${funde.length} Zeichen, die sich nicht nach ` +
    'Windows-1252 schreiben lassen. DATEV verlangt diese Kodierung, und ein ' +
    'stilles Fragezeichen wäre ein falscher Buchungstext beim Steuerberater.\n' +
    `${zeilen.join('\n')}${rest}\n` +
    'Bitte den Text an diesen Stellen anpassen, dann die Ausfuhr erneut starten.'
  );
}

/** Die 27 Stellen, an denen Windows-1252 von Latin-1 abweicht. */
const WIN1252_SONDER = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);
