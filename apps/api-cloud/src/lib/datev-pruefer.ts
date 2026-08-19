/**
 * Ein Prüfer für den Buchungsstapel — und seine eigene Eichung.
 *
 * ── WARUM ES IHN GIBT (26.07.2026) ─────────────────────────────────────────
 * Die zwölfspaltige Fassung, die es bis heute gab, hatte einen grünen Test.
 * Der Test prüfte, was der Code tat. Niemand hielt die Datei gegen das, was
 * DATEV verlangt, und deshalb konnte ein Jahr lang eine Datei entstehen, die
 * kein Steuerberater hätte einlesen können.
 *
 * Dieser Prüfer schliesst die Lücke: er liest eine fertige Datei und sagt,
 * was DATEV daran auszusetzen hätte.
 *
 * ── DIE EICHUNG, ohne die ein Prüfer wertlos ist ───────────────────────────
 * Ein Prüfer, der zu streng ist, ist genauso schlimm wie einer, der zu
 * lasch ist: er blockiert richtige Dateien und man schaltet ihn ab. Deshalb
 * gilt hier eine Regel, die im Wächtertest festgehalten ist:
 *
 *     Dieser Prüfer MUSS DATEVs eigene Musterdatei fehlerfrei durchlassen.
 *
 * Sagt er über `EXTF_Buchungsstapel.csv` auch nur einen Fehler, ist NICHT die
 * Datei falsch, sondern der Prüfer. Das ist der einzige Massstab, der nicht
 * von unserer eigenen Meinung abhängt.
 */

import { DATEV_FELDER, DATEV_SPALTEN } from './datev-spalten.generiert.js';

/**
 * ⛔ ZERLEGT WIE DATEV, NICHT WIE EIN NAIVES split (19.08.2026).
 *
 * ── DER FUND DER BOESWILLIGEN PRUEFUNG ─────────────────────────────────────
 *
 * Der Pruefer trennte die Zeile mit `z.split(';')` und zaehlte die Stuecke.
 * Ein Semikolon IN einem Textfeld („Tresor; Rest" als Grund einer
 * Bargeldbewegung) ist aber voellig gueltig — es steht in Anfuehrungszeichen,
 * genau dafuer sind sie da. Das naive Trennen sah 126 statt 125 Felder und
 * warf die Datei weg: der Haendler bekam eine Fehlermeldung ueber UNSER
 * Erzeugen, und der ganze Tagesexport war blockiert, bis jemand die Notiz
 * fand und aenderte.
 *
 * Getrennt wird deshalb nur an Semikola AUSSERHALB von Anfuehrungszeichen,
 * und `""` gilt innerhalb als ein eingebettetes Anfuehrungszeichen — dieselbe
 * Regel, nach der der Schreiber fasst.
 */
export function felderVonZeile(zeile: string): string[] {
  /*
   * ⚠️ Der Rueckgabewert traegt die Anfuehrungszeichen MIT. Die Pruefungen
   * darunter fragen naemlich unter anderem „ist dieses Textfeld eingefasst?"
   * — ein Zerleger, der die Fassung entfernt, machte genau diese Pruefung
   * blind. Getrennt wird also nur, nie gesaeubert.
   */
  const felder: string[] = [];
  let feld = '';
  let inAnfuehrung = false;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (c === '"') {
      // Verdoppeltes Anfuehrungszeichen INNERHALB der Fassung: beide Zeichen
      // gehoeren zum Feld, die Fassung bleibt offen.
      if (inAnfuehrung && zeile[i + 1] === '"') {
        feld += '""';
        i++;
        continue;
      }
      inAnfuehrung = !inAnfuehrung;
      feld += c;
      continue;
    }
    if (c === ';' && !inAnfuehrung) {
      felder.push(feld);
      feld = '';
      continue;
    }
    feld += c;
  }
  felder.push(feld);
  return felder;
}

export type Schwere = 'fehler' | 'hinweis';

export interface Befund {
  readonly schwere: Schwere;
  /** 1-basiert, wie ein Mensch zählt. 1 ist die Kopfzeile. */
  readonly zeile: number;
  /** 1-basiert, oder 0 wenn der Befund die ganze Zeile betrifft. */
  readonly feld: number;
  readonly text: string;
}

/**
 * Die Kopfzeile, Feld für Feld.
 *
 * Die Ausdrücke stammen aus DATEVs Formatbeschreibung. Wo dort `{0,n}` steht,
 * ist das Feld optional; wo `{1,n}` steht, Pflicht. Die Reservefelder sind
 * bewusst als „muss leer sein" geführt: DATEVs eigene Musterdatei hält sich
 * daran, und ein Wert dort verschiebt die Bedeutung aller folgenden.
 */
const KOPF_REGELN: ReadonlyArray<{
  nr: number;
  name: string;
  muster: RegExp;
  pflicht: boolean;
}> = [
  { nr: 1, name: 'Kennzeichen', muster: /^"(EXTF|DTVF)"$/, pflicht: true },
  { nr: 2, name: 'Versionsnummer', muster: /^700$/, pflicht: true },
  { nr: 3, name: 'Formatkategorie', muster: /^(16|20|21|46|48|65)$/, pflicht: true },
  { nr: 4, name: 'Formatname', muster: /^"[\wäöüÄÖÜß -]{1,30}"$/, pflicht: true },
  { nr: 5, name: 'Formatversion', muster: /^\d{1,2}$/, pflicht: true },
  { nr: 6, name: 'Erzeugt am', muster: /^\d{17}$/, pflicht: true },
  { nr: 7, name: 'Importiert', muster: /^$/, pflicht: false },
  { nr: 8, name: 'Herkunft', muster: /^"\w{0,2}"$/, pflicht: false },
  { nr: 9, name: 'Exportiert von', muster: /^"\w{0,25}"$/, pflicht: false },
  { nr: 10, name: 'Importiert von', muster: /^"\w{0,25}"$/, pflicht: false },
  { nr: 11, name: 'Beraternummer', muster: /^\d{4,7}$/, pflicht: true },
  { nr: 12, name: 'Mandantennummer', muster: /^\d{1,5}$/, pflicht: true },
  { nr: 13, name: 'Wirtschaftsjahresbeginn', muster: /^\d{8}$/, pflicht: true },
  { nr: 14, name: 'Sachkontenlänge', muster: /^[4-8]$/, pflicht: true },
  { nr: 15, name: 'Datum von', muster: /^\d{8}$/, pflicht: true },
  { nr: 16, name: 'Datum bis', muster: /^\d{8}$/, pflicht: true },
  { nr: 17, name: 'Bezeichnung', muster: /^".{0,30}"$/, pflicht: false },
  { nr: 18, name: 'Diktatkürzel', muster: /^"([A-Za-z]{2}){0,2}"$/, pflicht: false },
  { nr: 19, name: 'Buchungstyp', muster: /^[1-2]$/, pflicht: true },
  { nr: 20, name: 'Rechnungslegungszweck', muster: /^(0|30|40|50|64)$/, pflicht: true },
  { nr: 21, name: 'Festschreibung', muster: /^[01]$/, pflicht: true },
  { nr: 22, name: 'Währungskennzeichen', muster: /^"[A-Z]{3}"$/, pflicht: true },
  { nr: 23, name: 'Reserviert', muster: /^$/, pflicht: false },
  { nr: 24, name: 'Derivatskennzeichen', muster: /^"[^"]*"$/, pflicht: false },
  { nr: 25, name: 'Reserviert', muster: /^$/, pflicht: false },
  { nr: 26, name: 'Reserviert', muster: /^$/, pflicht: false },
  { nr: 27, name: 'Sachkontenrahmen', muster: /^"(\d{2})?"$/, pflicht: false },
  { nr: 28, name: 'ID der Branchenlösung', muster: /^\d{0,4}$/, pflicht: false },
  { nr: 29, name: 'Reserviert', muster: /^$/, pflicht: false },
  { nr: 30, name: 'Reserviert', muster: /^"[^"]*"$/, pflicht: false },
  { nr: 31, name: 'Anwendungsinformation', muster: /^".{0,16}"$/, pflicht: false },
];

const TYP = new Map(DATEV_FELDER.map((f) => [f.nr, f.typ]));
const LAENGE = new Map(DATEV_FELDER.map((f) => [f.nr, f.laenge]));
const PFLICHT = DATEV_FELDER.filter((f) => f.pflicht).map((f) => f.nr);

/**
 * Die zwei Kontospalten einer Buchungszeile, aus der erzeugten Spaltenliste
 * ABGELEITET statt getippt. Eine getippte Zahl veraltet still, wenn DATEV das
 * Format aendert; diese hier wird beim Bauen rot.
 */
const FELD_KONTO = DATEV_SPALTEN.indexOf('Konto') + 1;
const FELD_GEGENKONTO = DATEV_SPALTEN.indexOf('Gegenkonto (ohne BU-Schlüssel)') + 1;
const FELD_BU = DATEV_SPALTEN.indexOf('BU-Schlüssel') + 1;
const FELD_TEXT = DATEV_SPALTEN.indexOf('Buchungstext') + 1;
const FELD_GU = DATEV_SPALTEN.indexOf('Generalumkehr (GU)') + 1;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ZWEI REGELN, DIE DIESEM PRÜFER GEFEHLT HABEN (19.08.2026)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Der Prüfer mass jedes Feld für sich und war damit blind für genau die zwei
 * Fehler, die der Export ein Jahr lang gemacht hat: einen Steuerschlüssel auf
 * einem Automatikkonto, und Stornozeilen ohne Generalumkehr-Marke. Beide
 * Dateien gingen hier mit NULL Befunden durch.
 *
 * ── Regel 1: kein Steuerschlüssel auf einem Automatikkonto ───────────────
 *
 * DATEV wörtlich (Dok.-Nr. 0907048, Kap. 6.1): „Steuerschlüssel können nur
 * in Verbindung mit Konten ohne Automatik-Funktion genutzt werden." Beim
 * Import heisst der Fehler REW00305, „Steuerschlüssel beim Automatikkonto
 * zuviel".
 *
 * BUCHUNGSSCHLÜSSEL (20 Generalumkehr, 40 Aufhebung der Automatik) bleiben
 * erlaubt — DATEVs eigene Musterdatei setzt beide auf 8400, und der Wächter
 * verlangt, dass sie fehlerfrei durchgeht. Gesperrt sind nur die reinen
 * STEUERSCHLÜSSEL: die einstelligen 1-9 und ihre dokumentierten
 * dreistelligen Entsprechungen.
 *
 * Die Kontenliste trägt nur Nummern, deren AM-Marke („Automatische
 * Errechnung der Umsatzsteuer") im amtlichen Kontenrahmen 2026 nachgelesen
 * wurde — beide Rahmen, jede Zeile einzeln. Wer hier eine Nummer ergänzt,
 * schlägt sie dort nach.
 */
const AUTOMATIKKONTEN: ReadonlySet<string> = new Set([
  // SKR03: „U AM" bzw. „AM" im amtlichen Rahmen (Art.-Nr. 11174, 2026)
  ...Array.from({ length: 10 }, (_, i) => String(8400 + i)), // Erlöse 19 %
  ...Array.from({ length: 10 }, (_, i) => String(8300 + i)), // Erlöse 7 %
  '8150', // Sonstige steuerfreie Umsätze (§ 4 Nr. 2-7)
  '8191', // §§ 25/25a 19 % — die Margenzeile
  '8337', // § 13b Reverse Charge
  // SKR04 (Art.-Nr. 11175, 2026)
  ...Array.from({ length: 10 }, (_, i) => String(4400 + i)),
  ...Array.from({ length: 10 }, (_, i) => String(4300 + i)),
  '4150',
  '4136',
  '4337',
]);

/** Die reinen Steuerschlüssel — Buchungsschlüssel (20, 40, …) stehen NICHT hier. */
const STEUERSCHLUESSEL = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '101', '102', '171', '401', '402']);


/** Ein Textfeld ist eingefasst; sein Inhalt steht zwischen den Anführungszeichen. */
function inhalt(wert: string): string {
  return wert.startsWith('"') && wert.endsWith('"') && wert.length >= 2
    ? wert.slice(1, -1).replace(/""/g, '"')
    : wert;
}

/**
 * Eine fertige Datei prüfen.
 *
 * Erwartet den TEXT, nicht die Bytes: der Zeichensatz ist eine eigene Frage
 * und wird beim Schreiben entschieden. Hier geht es um Struktur und Inhalt.
 */
export function pruefeBuchungsstapel(text: string): Befund[] {
  const b: Befund[] = [];
  const roh = text.split('\r\n');
  // Eine Datei, die richtig endet, hat nach dem letzten CRLF ein leeres Stück.
  if (roh.length > 0 && roh[roh.length - 1] === '') roh.pop();
  else b.push({ schwere: 'fehler', zeile: 0, feld: 0, text: 'Die Datei endet nicht mit CR LF.' });

  if (roh.length < 2) {
    b.push({
      schwere: 'fehler',
      zeile: 0,
      feld: 0,
      text: 'Die Datei hat weniger als zwei Zeilen; Kopf und Spaltenzeile sind Pflicht.',
    });
    return b;
  }

  // ── Zeile 1: der Kopf ────────────────────────────────────────────────────
  const kopf = roh[0]!.split(';');
  if (kopf.length !== 31) {
    b.push({
      schwere: 'fehler',
      zeile: 1,
      feld: 0,
      text: `Die Kopfzeile hat ${kopf.length} Felder, DATEV verlangt 31.`,
    });
  } else {
    for (const r of KOPF_REGELN) {
      const w = kopf[r.nr - 1] ?? '';
      if (w === '' && !r.pflicht && r.muster.source !== '^$') continue;
      if (!r.muster.test(w)) {
        b.push({
          schwere: 'fehler',
          zeile: 1,
          feld: r.nr,
          text: `Kopf-Feld ${r.nr} (${r.name}): „${w}" passt nicht zu dem, was DATEV dort erwartet.`,
        });
      }
    }
    /**
     * ⛔ DER ZEITRAUM MUSS IM WIRTSCHAFTSJAHR LIEGEN
     *
     * ── WARUM DIESE REGEL FEHLTE, UND WAS DAS KOSTETE ───────────────────
     *
     * DATEV wörtlich: „Das Jahr wird immer aus dem Feld #13 des Headers
     * ermittelt." Das Belegdatum einer Buchungszeile ist nur `TTMM`.
     *
     * Am 05.08.2026 gemessen: Kopf-Feld 13 stand auf 20260101, Feld 15 und 16
     * auf 20270315, die Belegzeile trug 1503. DATEV liest daraus den
     * 15.03.2026 — ein Jahr, das beim Berater längst festgeschrieben ist. Der
     * Prüfer meldete dabei NULL Befunde, weil er jedes Feld nur für sich
     * ansah und nie zwei gegeneinander.
     *
     * Ein Buchungsstapel gehört in GENAU EIN Wirtschaftsjahr. Liegt sein
     * Zeitraum ausserhalb der zwölf Monate ab Feld 13, ist die Datei still
     * falsch — und still ist hier das Schlimmste.
     */
    const wjRoh = kopf[12] ?? '';
    for (const [nr, name] of [
      [15, 'Datum von'],
      [16, 'Datum bis'],
    ] as const) {
      const dRoh = kopf[nr - 1] ?? '';
      if (!/^\d{8}$/.test(wjRoh) || !/^\d{8}$/.test(dRoh)) continue;
      const wj = new Date(
        Date.UTC(Number(wjRoh.slice(0, 4)), Number(wjRoh.slice(4, 6)) - 1, Number(wjRoh.slice(6, 8))),
      );
      const ende = new Date(wj);
      ende.setUTCFullYear(ende.getUTCFullYear() + 1);
      const d = new Date(
        Date.UTC(Number(dRoh.slice(0, 4)), Number(dRoh.slice(4, 6)) - 1, Number(dRoh.slice(6, 8))),
      );
      if (d < wj || d >= ende) {
        b.push({
          schwere: 'fehler',
          zeile: 1,
          feld: nr,
          text:
            `Kopf-Feld ${nr} (${name}) trägt ${dRoh}, das Wirtschaftsjahr in Feld 13 beginnt aber ` +
            `am ${wjRoh}. DATEV entnimmt das JAHR jeder Buchung dem Feld 13; ein Zeitraum ` +
            'ausserhalb dieser zwölf Monate wird still in ein falsches Jahr gebucht.',
        });
      }
    }
  }

  // ── Zeile 2: die Spaltenzeile ───────────────────────────────────────────
  const spalten = roh[1]!.split(';');
  if (spalten.length !== 125) {
    b.push({
      schwere: 'fehler',
      zeile: 2,
      feld: 0,
      text: `Die Spaltenzeile hat ${spalten.length} Spalten, das Format hat 125.`,
    });
  } else {
    for (let i = 0; i < 125; i += 1) {
      if (spalten[i] !== DATEV_SPALTEN[i]) {
        b.push({
          schwere: 'fehler',
          zeile: 2,
          feld: i + 1,
          text: `Spalte ${i + 1} heisst „${spalten[i]}", DATEV nennt sie „${DATEV_SPALTEN[i]}".`,
        });
      }
    }
  }

  // ── Ab Zeile 3: die Buchungen ───────────────────────────────────────────
  /**
   * Kopf-Feld 14. Die Form ist weiter oben geprueft (`/^[4-8]$/`); ist sie
   * kaputt, steht der Fehler schon da und diese Regel schweigt, statt einen
   * zweiten, verwirrenden Fehler danebenzulegen.
   */
  const sachkontenlaenge = Number.parseInt(inhalt(kopf[13] ?? '').trim(), 10);

  const buchungen = roh.slice(2);
  if (buchungen.length > 99_999) {
    b.push({
      schwere: 'fehler',
      zeile: 0,
      feld: 0,
      text: `${buchungen.length} Buchungszeilen; DATEV nimmt höchstens 99.999 je Datei.`,
    });
  }


  buchungen.forEach((z, i) => {
    const nr = i + 3;
    const f = felderVonZeile(z);
    if (f.length !== 125) {
      b.push({
        schwere: 'fehler',
        zeile: nr,
        feld: 0,
        text: `${f.length} Felder statt 125. Das Format ist positionsbasiert: ein fehlendes Feld verschiebt alle danach.`,
      });
      return;
    }

    /*
     * ── DIE EINE BEZIEHUNG ZWISCHEN KOPF UND ZEILE ────────────────────────
     *
     * Kopf-Feld 14 sagt DATEV, wie viele Stellen ein Sachkonto hat, und DATEV
     * unterscheidet Sachkonto und Personenkonto GENAU an dieser Laenge:
     * Sachkonto n Stellen, Debitor und Kreditor n plus eins. Stimmt die
     * Angabe nicht, landet der Import auf anderen Konten als gedacht.
     *
     * Bis zum 11.08.2026 mass dieser Pruefer jede Stelle FUER SICH. Diese
     * Beziehung hatte keine Regel, obwohl der Inhaber die Laenge selbst
     * einstellt und sie damit falsch einstellen kann.
     *
     * ── ⚠️ DIE ERSTE FASSUNG DIESER REGEL WAR FALSCH ─────────────────────
     *
     * Sie meldete jedes Konto, das KUERZER war als die angesagte Laenge. Die
     * Eichung an DATEVs eigener Musterdatei hat sie sofort widerlegt. Dort
     * steht bei Sachkontenlaenge 4 (gezaehlt ueber beide Kontospalten):
     *
     *     2 Stellen :   1     z. B. 85
     *     3 Stellen :   3     z. B. 320, 980
     *     4 Stellen :  64     das Sachkonto
     *     5 Stellen :  40     das Personenkonto
     *     laenger   :   0
     *
     * Kuerzere Konten sind also voellig regulaer. Was es NICHT gibt, ist ein
     * Konto mit mehr als n plus eins Stellen: das waere weder Sachkonto noch
     * Personenkonto. Nur DAS wird gemeldet.
     *
     * Ohne die Eichung waere ein Pruefer entstanden, der richtige Dateien
     * abweist, und der waere binnen einer Woche abgeschaltet worden.
     */
    if (Number.isInteger(sachkontenlaenge) && sachkontenlaenge > 0) {
      const hoechstlaenge = sachkontenlaenge + 1;
      for (const feldNr of [FELD_KONTO, FELD_GEGENKONTO]) {
        const konto = inhalt(f[feldNr - 1] ?? '').trim();
        if (konto !== '' && /^\d+$/.test(konto) && konto.length > hoechstlaenge) {
          b.push({
            schwere: 'fehler',
            zeile: nr,
            feld: feldNr,
            text:
              `Konto ${konto} hat ${konto.length} Stellen. Der Kopf sagt Sachkontenlänge ` +
              `${sachkontenlaenge}; damit sind höchstens ${hoechstlaenge} Stellen möglich ` +
              `(Sachkonto ${sachkontenlaenge}, Personenkonto ${hoechstlaenge}).`,
          });
        }
      }
    }

    for (const p of PFLICHT) {
      if (inhalt(f[p - 1] ?? '').trim() === '') {
        b.push({
          schwere: 'fehler',
          zeile: nr,
          feld: p,
          text: `Pflichtfeld ${p} (${DATEV_SPALTEN[p - 1]}) ist leer.`,
        });
      }
    }

    // ── Regel 1: kein Steuerschlüssel auf einem Automatikkonto ───────────
    // Begründung und Quellen an AUTOMATIKKONTEN oben.
    {
      const bu = inhalt(f[FELD_BU - 1] ?? '').trim();
      if (STEUERSCHLUESSEL.has(bu)) {
        for (const feldNr of [FELD_KONTO, FELD_GEGENKONTO]) {
          const konto = inhalt(f[feldNr - 1] ?? '').trim();
          if (AUTOMATIKKONTEN.has(konto)) {
            b.push({
              schwere: 'fehler',
              zeile: nr,
              feld: FELD_BU,
              text:
                `Steuerschlüssel ${bu} auf dem Automatikkonto ${konto}. Das Konto rechnet ` +
                'die Steuer selbst (AM-Funktion); DATEV weist die Zeile beim Import zurück ' +
                '(REW00305). Feld 9 muss hier leer bleiben.',
            });
            break;
          }
        }
      }
    }

    // ── Regel 2: eine Stornozeile trägt die Generalumkehr-Marke ──────────
    //
    // Hausregel, nicht DATEV-Regel: UNSERE Stornozeilen beginnen ihren
    // Buchungstext mit „STORNO ". Eine solche Zeile ohne Feld 118 = 1 bläht
    // die Jahresverkehrszahlen auf, statt die Ursprungsbuchung zu mindern
    // (DATEV Dok.-Nr. 1070379, Kap. 3.2). Die Eichung bleibt unberührt:
    // DATEVs Musterdatei enthält keinen solchen Buchungstext.
    {
      const textFeld = inhalt(f[FELD_TEXT - 1] ?? '');
      const gu = inhalt(f[FELD_GU - 1] ?? '').trim();
      if (textFeld.startsWith('STORNO ') && gu !== '1') {
        b.push({
          schwere: 'fehler',
          zeile: nr,
          feld: FELD_GU,
          text:
            'Die Zeile ist als STORNO beschriftet, trägt aber keine Generalumkehr ' +
            '(Feld 118 = 1). Ohne die Marke erzeugt der Storno frischen Umsatz auf der ' +
            'Gegenseite, statt die Ursprungsbuchung zu mindern.',
        });
      }
    }

    f.forEach((w, k) => {
      const feldNr = k + 1;
      const typ = TYP.get(feldNr);
      const eingefasst = w.startsWith('"');
      if (typ === 'Text' && !eingefasst) {
        b.push({
          schwere: 'fehler',
          zeile: nr,
          feld: feldNr,
          text: `Feld ${feldNr} (${DATEV_SPALTEN[k]}) ist ein Textfeld und muss eingefasst sein.`,
        });
      }
      if (typ !== 'Text' && eingefasst && w !== '""') {
        b.push({
          schwere: 'fehler',
          zeile: nr,
          feld: feldNr,
          text: `Feld ${feldNr} (${DATEV_SPALTEN[k]}) ist kein Textfeld und darf keine Anführungszeichen tragen.`,
        });
      }
      const max = LAENGE.get(feldNr) ?? 0;
      if (max > 0 && typ === 'Text' && inhalt(w).length > max) {
        b.push({
          schwere: 'fehler',
          zeile: nr,
          feld: feldNr,
          text: `Feld ${feldNr} (${DATEV_SPALTEN[k]}): ${inhalt(w).length} Zeichen, erlaubt sind ${max}.`,
        });
      }
    });

    // ── Feld 1: Betrag, ohne Vorzeichen ─────────────────────────────────
    // Die Nachkommastellen sind OPTIONAL. Das ist nicht geraten: DATEVs
    // eigene Musterdatei schreibt in einer ihrer 54 Zeilen `64083` ohne
    // Komma, und ein Prüfer, der die Datei des Herstellers zurückweist, ist
    // selbst der Fehler. Genau das hat die Eichung an dieser Stelle gefangen.
    //
    // WIR schreiben trotzdem immer zwei Nachkommastellen, weil `64083` sich
    // als 64.083 lesen liesse. Die Regel für unser Schreiben steht in
    // `datev-format.ts`; hier geht es darum, was DATEV ANNIMMT.
    const umsatz = f[0] ?? '';
    if (umsatz !== '' && !/^\d{1,10}(,\d{1,2})?$/.test(umsatz)) {
      b.push({
        schwere: 'fehler',
        zeile: nr,
        feld: 1,
        text: `Umsatz „${umsatz}": erwartet ist ein Betrag ohne Vorzeichen, das Komma als Trenner.`,
      });
    }
    const sh = inhalt(f[1] ?? '');
    if (sh !== 'S' && sh !== 'H') {
      b.push({
        schwere: 'fehler',
        zeile: nr,
        feld: 2,
        text: `Soll/Haben-Kennzeichen „${sh}": erlaubt sind nur S und H.`,
      });
    }
    // Feld 10 ist TTMM. Das Jahr steht im Kopf; hier prüfen wir nur die Form
    // und dass der Tag existieren kann.
    const datum = f[9] ?? '';
    if (!/^\d{4}$/.test(datum)) {
      b.push({
        schwere: 'fehler',
        zeile: nr,
        feld: 10,
        text: `Belegdatum „${datum}": erwartet sind vier Ziffern als TTMM.`,
      });
    } else {
      const tag = Number(datum.slice(0, 2));
      const monat = Number(datum.slice(2, 4));
      if (tag < 1 || tag > 31 || monat < 1 || monat > 12) {
        b.push({
          schwere: 'fehler',
          zeile: nr,
          feld: 10,
          text: `Belegdatum „${datum}" ergibt Tag ${tag}, Monat ${monat}.`,
        });
      }
    }
    // Feld 114: leer bedeutet bei DATEV automatische Festschreibung ohne
    // Rückweg. Das ist kein Formfehler, aber ein Hinweis, den der Berater
    // kennen muss.
    const fest = f[113] ?? '';
    if (fest === '') {
      b.push({
        schwere: 'hinweis',
        zeile: nr,
        feld: 114,
        text:
          'Feld 114 (Festschreibung) ist leer. DATEV schreibt einen solchen Stapel automatisch ' +
          'fest; er lässt sich danach nicht entsperren und nicht an einen bestehenden anhängen.',
      });
    }
  });

  return b;
}

/** Nur die echten Fehler, ohne die Hinweise. */
export function nurFehler(befunde: readonly Befund[]): Befund[] {
  return befunde.filter((x) => x.schwere === 'fehler');
}
