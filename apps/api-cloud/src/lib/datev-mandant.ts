/**
 * Die fünf Zahlen, die nur der Steuerberater kennt — und was passiert, wenn
 * eine fehlt.
 *
 * ── WARUM DAS EINE EIGENE DATEI IST (26.07.2026) ───────────────────────────
 * Der DATEV-Buchungsstapel trägt in seiner Kopfzeile Ordnungsbegriffe, die
 * NICHT aus unseren Daten kommen können: unter welcher Beraternummer geliefert
 * wird, welche Mandantennummer der Laden im Bestand des Beraters hat, wann
 * sein Wirtschaftsjahr beginnt, wie viele Stellen seine Sachkonten haben, und
 * ob der Stapel festgeschrieben ankommen soll.
 *
 * Bis heute stand dafür eine feste Zeichenkette im Quelltext, in der alle fünf
 * leer waren, mit einem Kommentar, DATEV fülle sie beim Import. Das tut DATEV
 * nicht. Der Kommentar war das Gefährlichste an der Stelle: er beruhigte über
 * einen echten Defekt.
 *
 * ── DIE HALTUNG ───────────────────────────────────────────────────────────
 * Fehlt eine der fünf, wird KEINE Datei erzeugt, und die Meldung nennt genau
 * die fehlenden Schlüssel im Klartext, damit der Inhaber seinen Steuerberater
 * EINMAL fragen kann statt dreimal. Ein Stapel mit leeren Ordnungsbegriffen
 * sieht aus wie ein Export und ist keiner; das ist dieselbe Fehlerklasse, die
 * in diesem Haus schon dreimal aufgetreten ist.
 */

import { sql } from 'drizzle-orm';

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';
import type { DatevMandant } from './datev-format.js';
import { normalisiereRahmen } from './kontenrahmen.js';

/** Die Schlüssel in `system_settings`. Kleinbuchstaben mit Punkt, wie das Schema verlangt. */
export const DATEV_SCHLUESSEL = {
  beraternummer: 'datev.beraternummer',
  mandantennummer: 'datev.mandantennummer',
  wirtschaftsjahrBeginn: 'datev.wirtschaftsjahr_beginn',
  sachkontenlaenge: 'datev.sachkontenlaenge',
  festschreibung: 'datev.festschreibung',
  sachkontenrahmen: 'datev.sachkontenrahmen',
} as const;

/** Was der Inhaber lesen soll, wenn eine Angabe fehlt. */
export const KLARTEXT: Record<string, string> = {
  [DATEV_SCHLUESSEL.beraternummer]: 'Beraternummer Ihres Steuerberaters',
  [DATEV_SCHLUESSEL.mandantennummer]: 'Mandantennummer dieses Ladens in seinem Bestand',
  [DATEV_SCHLUESSEL.wirtschaftsjahrBeginn]: // ⚠️ 12.08.2026: hier stand „als MM-TT (Regelfall 01-01)" — die Schreibroute
    // verlangt aber JJJJ-MM-TT (`kontenrahmen.ts`). Wer der Meldung folgte, tippte
    // einen Wert, den der Server ablehnt.
    'Beginn des Wirtschaftsjahres, als JJJJ-MM-TT (Regelfall der 1. Januar)',
  [DATEV_SCHLUESSEL.sachkontenlaenge]: 'Länge der Sachkonten, vier bis acht Stellen',
  [DATEV_SCHLUESSEL.festschreibung]: 'Festschreibung: ja oder nein',
  [DATEV_SCHLUESSEL.sachkontenrahmen]: 'Kontenrahmen: SKR03 oder SKR04',
};

export class DatevNichtEingerichtetError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * Eine Angabe FEHLT — der Regelfall bei jedem neuen Laden.
 *
 * ── WARUM DAS EINEN EIGENEN CODE BEKOMMT (26.07.2026) ──────────────────────
 * Seit Wanderung 0117 steht in keiner Wanderung mehr eine Beraternummer und
 * keine Mandantennummer. Sie gehoeren dem Haendler, nicht dem Erzeugnis: Norns
 * ist ein Softwarehaus, und der zweite Laden hat einen anderen Steuerberater
 * als der erste. Also fehlen sie bei jedem neuen Kunden, bis er sie eintraegt
 * — das ist ab jetzt der HAUPTWEG, nicht der Ausnahmefall.
 *
 * Ein Hauptweg darf sich nicht wie ein Fehler anfuehlen. Die Oberflaeche
 * erkennt diesen Fall an `DATEV_MANDANT_FEHLT` und zeigt darauf das
 * Einrichtungsformular an Ort und Stelle, statt einer roten Meldung. Gefragt
 * wird beim ERSTEN Export, nicht beim Anlegen des Kontos: dort hat der
 * Haendler die Zahlen meist noch gar nicht, er muss erst seinen Berater
 * fragen. Wer DATEV nie benutzt, wird nie gefragt.
 *
 * Erbt bewusst von `DatevNichtEingerichtetError`: der Aufrufer, der beide
 * Faelle gleich behandeln will, braucht dafuer nur die eine Klasse.
 */
export class DatevMandantFehltError extends DatevNichtEingerichtetError {
  public override readonly code: ApiErrorCode = 'DATEV_MANDANT_FEHLT';
}

/**
 * Minimaler Ausschnitt, den diese Datei von der Datenbank braucht.
 *
 * Bewusst mit `Record<string, unknown>` statt einem eigenen Typparameter: die
 * Datenbankschicht des Hauses gibt genau das zurück, und ein enger Typ hier
 * hätte den Aufrufer zu einer Typzusicherung gezwungen. Eine Zusicherung an
 * der Nahtstelle ist genau die Stelle, an der später etwas Falsches
 * durchrutscht.
 */
export interface DatenbankLeser {
  execute(abfrage: ReturnType<typeof sql>): Promise<Record<string, unknown>[]>;
}

/**
 * Die Mandantenangaben laden.
 *
 * Wirft mit einer Meldung, die JEDE fehlende Angabe nennt — nicht die erste,
 * die auffällt. Wer eine Liste bekommt, fragt einmal nach; wer eine einzelne
 * Meldung bekommt, fragt fünfmal.
 *
 * ── DIE ERGÄNZUNG VOM 26.07.2026: der Rahmen darf beim Export gewählt werden ─
 * `rahmenWunsch` überstimmt die gespeicherte Einstellung für DIESEN einen
 * Abruf. Damit kann der Inhaber denselben Tag einmal in SKR03 und einmal in
 * SKR04 ziehen, ohne etwas umzustellen — sein Steuerberater sagt ihm dann,
 * welcher der beiden in seinen Bestand passt. Ein unbekannter Wert wird als
 * Eingabefehler abgewiesen (400), nicht als Serverfehler.
 *
 * Gespeichert wird dabei NICHTS. Die Wahl beim Export ist eine Wahl beim
 * Export; was dauerhaft gilt, ändert der Inhaber in den Einstellungen.
 *
 * ── DIE VERWEIGERUNG IST DER HAUPTWEG, NICHT DER AUSNAHMEFALL (0117) ───────
 * Wanderung 0115 hatte Beraternummer 1001 und Mandantennummer 1 als
 * Vorgabewerte angelegt, damit der Export nicht mehr blockiert. Das war die
 * Anschrift EINES Steuerbüros, eingebacken in ein Erzeugnis, das bei jedem
 * künftigen Kunden mitläuft. Wanderung 0117 hat beide wieder herausgenommen.
 *
 * Seither fehlen sie bei jedem neuen Laden, bis der Händler sie einträgt —
 * und genau dann schlägt diese Wand an, mit `DATEV_MANDANT_FEHLT`. Die
 * Oberfläche zeigt darauf ein Einrichtungsformular an Ort und Stelle statt
 * einer roten Meldung. Ein Stapel mit erfundenen Ordnungsbegriffen sieht aus
 * wie ein Export und ist keiner; eine falsche Mandantennummer lädt die
 * Buchungen still in die Bücher eines fremden Betriebs.
 */
export async function ladeDatevMandant(
  db: DatenbankLeser,
  rahmenWunsch?: string | undefined,
): Promise<DatevMandant> {
  // Als Array-LITERAL in EINEM Parameter, nicht als JS-Array. Drizzle würde
  // ein JS-Array in N Einzelparameter zerlegen und aus `ANY($1::text[])` würde
  // `ANY($1, $2, …::text[])` — ein Fehler, den kein Typprüfer sieht und der
  // erst am ersten echten Tag auftritt. Diese Fehlerklasse hat dieses Haus
  // fünfmal getroffen, dreimal in genau dieser Exportdatei; siehe den Wächter
  // `no-array-spread.test.ts`.
  const namen = `{${Object.values(DATEV_SCHLUESSEL).join(',')}}`;
  const zeilen = await db.execute(sql`
    SELECT key, value FROM system_settings WHERE key = ANY(${namen}::text[])`);

  const werte = new Map(zeilen.map((z) => [String(z.key), z.value]));
  const fehlend: string[] = [];

  function pflicht(schluessel: string): unknown {
    const v = werte.get(schluessel);
    if (v === undefined || v === null || v === '') {
      fehlend.push(schluessel);
      return undefined;
    }
    return v;
  }

  const beraternummer = pflicht(DATEV_SCHLUESSEL.beraternummer);
  const mandantennummer = pflicht(DATEV_SCHLUESSEL.mandantennummer);
  const wjBeginn = pflicht(DATEV_SCHLUESSEL.wirtschaftsjahrBeginn);
  const sachkontenlaenge = pflicht(DATEV_SCHLUESSEL.sachkontenlaenge);
  const festschreibung = pflicht(DATEV_SCHLUESSEL.festschreibung);
  const rahmen = pflicht(DATEV_SCHLUESSEL.sachkontenrahmen);

  if (fehlend.length > 0) {
    const liste = fehlend.map((k) => `• ${KLARTEXT[k] ?? k}`).join('\n');

    // Die zwei Ordnungsnummern bekommen ihren eigenen Absatz — aber nur, wenn
    // wirklich eine von ihnen fehlt. Wer nur den Kontenrahmen vergessen hat,
    // soll keinen Vortrag über DATEVs Adressierung lesen.
    const ordnungsnummernFehlen =
      fehlend.includes(DATEV_SCHLUESSEL.beraternummer) ||
      fehlend.includes(DATEV_SCHLUESSEL.mandantennummer);

    const woher = ordnungsnummernFehlen
      ? '\nWoher Sie die zwei Nummern bekommen: beide von Ihrem Steuerberater. Die ' +
        'Beraternummer vergibt DATEV an seine Kanzlei; sie steht auf jedem seiner ' +
        'Schreiben. Die Mandantennummer vergibt die Kanzlei an diesen Laden, es ist ' +
        'Ihre Nummer in seinem Bestand.\n' +
        '\nWarum es ohne sie nicht geht: die beiden Zahlen sind die Anschrift, an die ' +
        'DATEV die Buchungen liefert. Eine falsche Mandantennummer lädt sie STILL in ' +
        'die Bücher eines fremden Betriebs, auffallen würde das erst beim ' +
        'Jahresabschluss. Deshalb wird ohne sie keine Datei erzeugt.\n'
      : '\nOhne diese Angabe hätte keine Buchung der Datei ein Wirtschaftsjahr, und ' +
        'DATEV würde sie nicht einlesen.\n';

    throw new DatevMandantFehltError(
      'Der DATEV-Export ist noch nicht eingerichtet. Diese Angaben fehlen und müssen ' +
        `vom Steuerberater kommen:\n${liste}\n${woher}` +
        'Tragen Sie die Angaben einmal ein; danach läuft jeder weitere Export ohne ' +
        'Nachfrage.',
    );
  }

  const laenge = Number(sachkontenlaenge);
  if (!Number.isInteger(laenge) || laenge < 4 || laenge > 8) {
    throw new DatevNichtEingerichtetError(
      `Die Sachkontenlänge muss vier bis acht Stellen haben; eingetragen ist „${String(sachkontenlaenge)}". ` +
        'Der Wert muss zum Bestand Ihres Steuerberaters passen.',
    );
  }
  // Der Wunsch beim Export sticht die Einstellung — aber nur für diesen Abruf,
  // und nur, wenn er ein bekannter Rahmen ist. `normalisiereRahmen` wirft
  // sonst mit 400 und einer deutschen Meldung.
  const rahmenRoh = rahmenWunsch !== undefined && rahmenWunsch !== '' ? rahmenWunsch : rahmen;
  const rahmenText = String(rahmenRoh).replace(/^SKR/i, '');
  if (rahmenText !== '03' && rahmenText !== '04') {
    if (rahmenWunsch !== undefined && rahmenWunsch !== '') {
      // Ein falscher Abfrageparameter ist ein Eingabefehler des Bedieners,
      // kein Einrichtungsmangel des Mandanten.
      normalisiereRahmen(rahmenWunsch);
    }
    throw new DatevNichtEingerichtetError(
      `Der Kontenrahmen muss SKR03 oder SKR04 sein; eingetragen ist „${String(rahmen)}".`,
    );
  }

  return {
    beraternummer: Number(beraternummer),
    mandantennummer: Number(mandantennummer),
    wirtschaftsjahrBeginn: String(wjBeginn),
    sachkontenlaenge: laenge,
    festschreibung: festschreibung === true || String(festschreibung) === 'true',
    sachkontenrahmen: rahmenText,
  };
}
