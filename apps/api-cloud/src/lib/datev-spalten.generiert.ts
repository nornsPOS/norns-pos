/**
 * Die 125 Spalten des DATEV-Buchungsstapels — ABGESCHRIEBEN, nicht nachgebaut.
 *
 * ── HERKUNFT, damit sie nachprüfbar bleibt ─────────────────────────────────
 * Erzeugt am 26.07.2026 aus ZWEI amtlichen Quellen von DATEV, die
 * unabhängig voneinander dasselbe sagen:
 *
 *   1. `EXTF_Buchungsstapel.csv` aus dem Musterdatenpaket
 *      https://developer.datev.de/assets/Musterdaten_DATEV_Format_0_7f9322b9cc.zip
 *      Zeile 2 dieser Datei ist die Spaltenzeile. Sie ist hier WÖRTLICH
 *      übernommen, samt DATEVs eigener Uneinheitlichkeit: Feld 48 heisst
 *      `Zusatzinformation - Art 1` mit Leerzeichen vor dem Bindestrich,
 *      Feld 49 `Zusatzinformation- Inhalt 1` ohne. Wer das „aufräumt",
 *      weicht von der Vorlage ab.
 *
 *   2. `Format_Buchungsstapel.xml` aus dem DATEV-Prüfprogramm 2.2.3.0
 *      https://developer.datev.de/assets/Datev_Format_Pruefprogramm_2_2_3_0_76439824cb.zip
 *      Datei vom 21.10.2025. Sie liefert Typ, Länge und Pflicht je Feld.
 *
 * Beide zählen 125 Felder. Sie weichen an genau FÜNF Stellen in der
 * Schreibweise ab (7, 37, 38, 96, 104); massgeblich für die Spaltenzeile der
 * Datei ist die CSV-Schreibweise, weil das die Datei ist, die DATEV selbst
 * ausliefert.
 *
 * ── DIESE DATEI WIRD NICHT VON HAND GEPFLEGT ───────────────────────────────
 * Ändert DATEV das Format, wird sie neu erzeugt. Ein Wächter vergleicht sie
 * gegen die Vorlage; siehe `datev-format.test.ts`.
 */

/** Die Spaltenzeile, wörtlich aus DATEVs eigener Musterdatei. */
export const DATEV_SPALTEN: readonly string[] = [
  'Umsatz (ohne Soll/Haben-Kz)', // 1
  'Soll/Haben-Kennzeichen', // 2
  'WKZ Umsatz', // 3
  'Kurs', // 4
  'Basis-Umsatz', // 5
  'WKZ Basis-Umsatz', // 6
  'Konto', // 7
  'Gegenkonto (ohne BU-Schlüssel)', // 8
  'BU-Schlüssel', // 9
  'Belegdatum', // 10
  'Belegfeld 1', // 11
  'Belegfeld 2', // 12
  'Skonto', // 13
  'Buchungstext', // 14
  'Postensperre', // 15
  'Diverse Adressnummer', // 16
  'Geschäftspartnerbank', // 17
  'Sachverhalt', // 18
  'Zinssperre', // 19
  'Beleglink', // 20
  'Beleginfo - Art 1', // 21
  'Beleginfo - Inhalt 1', // 22
  'Beleginfo - Art 2', // 23
  'Beleginfo - Inhalt 2', // 24
  'Beleginfo - Art 3', // 25
  'Beleginfo - Inhalt 3', // 26
  'Beleginfo - Art 4', // 27
  'Beleginfo - Inhalt 4', // 28
  'Beleginfo - Art 5', // 29
  'Beleginfo - Inhalt 5', // 30
  'Beleginfo - Art 6', // 31
  'Beleginfo - Inhalt 6', // 32
  'Beleginfo - Art 7', // 33
  'Beleginfo - Inhalt 7', // 34
  'Beleginfo - Art 8', // 35
  'Beleginfo - Inhalt 8', // 36
  'KOST1 - Kostenstelle', // 37
  'KOST2 - Kostenstelle', // 38
  'Kost-Menge', // 39
  'EU-Land u. UStID (Bestimmung)', // 40
  'EU-Steuersatz (Bestimmung)', // 41
  'Abw. Versteuerungsart', // 42
  'Sachverhalt L+L', // 43
  'Funktionsergänzung L+L', // 44
  'BU 49 Hauptfunktionstyp', // 45
  'BU 49 Hauptfunktionsnummer', // 46
  'BU 49 Funktionsergänzung', // 47
  'Zusatzinformation - Art 1', // 48
  'Zusatzinformation- Inhalt 1', // 49
  'Zusatzinformation - Art 2', // 50
  'Zusatzinformation- Inhalt 2', // 51
  'Zusatzinformation - Art 3', // 52
  'Zusatzinformation- Inhalt 3', // 53
  'Zusatzinformation - Art 4', // 54
  'Zusatzinformation- Inhalt 4', // 55
  'Zusatzinformation - Art 5', // 56
  'Zusatzinformation- Inhalt 5', // 57
  'Zusatzinformation - Art 6', // 58
  'Zusatzinformation- Inhalt 6', // 59
  'Zusatzinformation - Art 7', // 60
  'Zusatzinformation- Inhalt 7', // 61
  'Zusatzinformation - Art 8', // 62
  'Zusatzinformation- Inhalt 8', // 63
  'Zusatzinformation - Art 9', // 64
  'Zusatzinformation- Inhalt 9', // 65
  'Zusatzinformation - Art 10', // 66
  'Zusatzinformation- Inhalt 10', // 67
  'Zusatzinformation - Art 11', // 68
  'Zusatzinformation- Inhalt 11', // 69
  'Zusatzinformation - Art 12', // 70
  'Zusatzinformation- Inhalt 12', // 71
  'Zusatzinformation - Art 13', // 72
  'Zusatzinformation- Inhalt 13', // 73
  'Zusatzinformation - Art 14', // 74
  'Zusatzinformation- Inhalt 14', // 75
  'Zusatzinformation - Art 15', // 76
  'Zusatzinformation- Inhalt 15', // 77
  'Zusatzinformation - Art 16', // 78
  'Zusatzinformation- Inhalt 16', // 79
  'Zusatzinformation - Art 17', // 80
  'Zusatzinformation- Inhalt 17', // 81
  'Zusatzinformation - Art 18', // 82
  'Zusatzinformation- Inhalt 18', // 83
  'Zusatzinformation - Art 19', // 84
  'Zusatzinformation- Inhalt 19', // 85
  'Zusatzinformation - Art 20', // 86
  'Zusatzinformation- Inhalt 20', // 87
  'Stück', // 88
  'Gewicht', // 89
  'Zahlweise', // 90
  'Forderungsart', // 91
  'Veranlagungsjahr', // 92
  'Zugeordnete Fälligkeit', // 93
  'Skontotyp', // 94
  'Auftragsnummer', // 95
  'Buchungstyp', // 96
  'USt-Schlüssel (Anzahlungen)', // 97
  'EU-Land (Anzahlungen)', // 98
  'Sachverhalt L+L (Anzahlungen)', // 99
  'EU-Steuersatz (Anzahlungen)', // 100
  'Erlöskonto (Anzahlungen)', // 101
  'Herkunft-Kz', // 102
  'Buchungs GUID', // 103
  'KOST-Datum', // 104
  'SEPA-Mandatsreferenz', // 105
  'Skontosperre', // 106
  'Gesellschaftername', // 107
  'Beteiligtennummer', // 108
  'Identifikationsnummer', // 109
  'Zeichnernummer', // 110
  'Postensperre bis', // 111
  'Bezeichnung SoBil-Sachverhalt', // 112
  'Kennzeichen SoBil-Buchung', // 113
  'Festschreibung', // 114
  'Leistungsdatum', // 115
  'Datum Zuord. Steuerperiode', // 116
  'Fälligkeit', // 117
  'Generalumkehr (GU)', // 118
  'Steuersatz', // 119
  'Land', // 120
  'Abrechnungsreferenz', // 121
  'BVV-Position', // 122
  'EU-Land u. UStID (Ursprung)', // 123
  'EU-Steuersatz (Ursprung)', // 124
  'Abw. Skontokonto', // 125
];

/**
 * Der Feldtyp entscheidet über die Anführungszeichen.
 *
 * Gemessen an allen 54 Datenzeilen der Musterdatei, also 6.750 Feldern:
 *   • `Text`  → IMMER eingefasst, auch wenn leer (`""`)
 *   • sonst   → roh; ein leeres Feld ist wirklich leer
 * Kein einziges Nicht-Text-Feld mit Inhalt trägt Anführungszeichen.
 */
export type DatevFeldTyp = 'Text' | 'Betrag' | 'Konto' | 'Datum' | 'Zahl';

export interface DatevFeld {
  /** Position, 1-basiert, wie in DATEVs Zählung. */
  readonly nr: number;
  readonly label: string;
  readonly typ: DatevFeldTyp;
  readonly laenge: number;
  readonly nachkomma: number;
  /** Nur FÜNF der 125 Felder sind Pflicht; alle anderen dürfen leer bleiben,
   *  müssen aber als Feld dastehen, weil das Format positionsbasiert ist. */
  readonly pflicht: boolean;
}

export const DATEV_FELDER: readonly DatevFeld[] = [
  { nr: 1, label: 'Umsatz (ohne Soll/Haben-Kz)', typ: 'Betrag', laenge: 10, nachkomma: 2, pflicht: true },
  { nr: 2, label: 'Soll/Haben-Kennzeichen', typ: 'Text', laenge: 1, nachkomma: 0, pflicht: true },
  { nr: 3, label: 'WKZ Umsatz', typ: 'Text', laenge: 3, nachkomma: 0, pflicht: false },
  { nr: 4, label: 'Kurs', typ: 'Zahl', laenge: 5, nachkomma: 6, pflicht: false },
  { nr: 5, label: 'Basis-Umsatz', typ: 'Betrag', laenge: 10, nachkomma: 2, pflicht: false },
  { nr: 6, label: 'WKZ Basis-Umsatz', typ: 'Text', laenge: 3, nachkomma: 0, pflicht: false },
  { nr: 7, label: 'Kontonummer', typ: 'Konto', laenge: 9, nachkomma: 0, pflicht: true },
  { nr: 8, label: 'Gegenkonto (ohne BU-Schlüssel)', typ: 'Konto', laenge: 9, nachkomma: 0, pflicht: true },
  { nr: 9, label: 'BU-Schlüssel', typ: 'Text', laenge: 4, nachkomma: 0, pflicht: false },
  { nr: 10, label: 'Belegdatum', typ: 'Datum', laenge: 8, nachkomma: 0, pflicht: true },
  { nr: 11, label: 'Belegfeld 1', typ: 'Text', laenge: 36, nachkomma: 0, pflicht: false },
  { nr: 12, label: 'Belegfeld 2', typ: 'Text', laenge: 12, nachkomma: 0, pflicht: false },
  { nr: 13, label: 'Skonto', typ: 'Betrag', laenge: 8, nachkomma: 2, pflicht: false },
  { nr: 14, label: 'Buchungstext', typ: 'Text', laenge: 60, nachkomma: 0, pflicht: false },
  { nr: 15, label: 'Postensperre', typ: 'Zahl', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 16, label: 'Diverse Adressnummer', typ: 'Text', laenge: 9, nachkomma: 0, pflicht: false },
  { nr: 17, label: 'Geschäftspartnerbank', typ: 'Zahl', laenge: 3, nachkomma: 0, pflicht: false },
  { nr: 18, label: 'Sachverhalt', typ: 'Zahl', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 19, label: 'Zinssperre', typ: 'Zahl', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 20, label: 'Beleglink', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 21, label: 'Beleginfo - Art 1', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 22, label: 'Beleginfo - Inhalt 1', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 23, label: 'Beleginfo - Art 2', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 24, label: 'Beleginfo - Inhalt 2', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 25, label: 'Beleginfo - Art 3', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 26, label: 'Beleginfo - Inhalt 3', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 27, label: 'Beleginfo - Art 4', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 28, label: 'Beleginfo - Inhalt 4', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 29, label: 'Beleginfo - Art 5', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 30, label: 'Beleginfo - Inhalt 5', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 31, label: 'Beleginfo - Art 6', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 32, label: 'Beleginfo - Inhalt 6', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 33, label: 'Beleginfo - Art 7', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 34, label: 'Beleginfo - Inhalt 7', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 35, label: 'Beleginfo - Art 8', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 36, label: 'Beleginfo - Inhalt 8', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 37, label: 'Kost 1 - Kostenstelle', typ: 'Text', laenge: 36, nachkomma: 0, pflicht: false },
  { nr: 38, label: 'Kost 2 - Kostenstelle', typ: 'Text', laenge: 36, nachkomma: 0, pflicht: false },
  { nr: 39, label: 'Kost-Menge', typ: 'Zahl', laenge: 12, nachkomma: 4, pflicht: false },
  { nr: 40, label: 'EU-Land u. UStID (Bestimmung)', typ: 'Text', laenge: 15, nachkomma: 0, pflicht: false },
  { nr: 41, label: 'EU-Steuersatz (Bestimmung)', typ: 'Zahl', laenge: 2, nachkomma: 2, pflicht: false },
  { nr: 42, label: 'Abw. Versteuerungsart', typ: 'Text', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 43, label: 'Sachverhalt L+L', typ: 'Zahl', laenge: 3, nachkomma: 0, pflicht: false },
  { nr: 44, label: 'Funktionsergänzung L+L', typ: 'Zahl', laenge: 3, nachkomma: 0, pflicht: false },
  { nr: 45, label: 'BU 49 Hauptfunktionstyp', typ: 'Zahl', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 46, label: 'BU 49 Hauptfunktionsnummer', typ: 'Zahl', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 47, label: 'BU 49 Funktionsergänzung', typ: 'Zahl', laenge: 3, nachkomma: 0, pflicht: false },
  { nr: 48, label: 'Zusatzinformation - Art 1', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 49, label: 'Zusatzinformation- Inhalt 1', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 50, label: 'Zusatzinformation - Art 2', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 51, label: 'Zusatzinformation- Inhalt 2', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 52, label: 'Zusatzinformation - Art 3', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 53, label: 'Zusatzinformation- Inhalt 3', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 54, label: 'Zusatzinformation - Art 4', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 55, label: 'Zusatzinformation- Inhalt 4', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 56, label: 'Zusatzinformation - Art 5', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 57, label: 'Zusatzinformation- Inhalt 5', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 58, label: 'Zusatzinformation - Art 6', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 59, label: 'Zusatzinformation- Inhalt 6', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 60, label: 'Zusatzinformation - Art 7', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 61, label: 'Zusatzinformation- Inhalt 7', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 62, label: 'Zusatzinformation - Art 8', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 63, label: 'Zusatzinformation- Inhalt 8', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 64, label: 'Zusatzinformation - Art 9', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 65, label: 'Zusatzinformation- Inhalt 9', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 66, label: 'Zusatzinformation - Art 10', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 67, label: 'Zusatzinformation- Inhalt 10', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 68, label: 'Zusatzinformation - Art 11', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 69, label: 'Zusatzinformation- Inhalt 11', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 70, label: 'Zusatzinformation - Art 12', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 71, label: 'Zusatzinformation- Inhalt 12', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 72, label: 'Zusatzinformation - Art 13', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 73, label: 'Zusatzinformation- Inhalt 13', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 74, label: 'Zusatzinformation - Art 14', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 75, label: 'Zusatzinformation- Inhalt 14', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 76, label: 'Zusatzinformation - Art 15', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 77, label: 'Zusatzinformation- Inhalt 15', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 78, label: 'Zusatzinformation - Art 16', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 79, label: 'Zusatzinformation- Inhalt 16', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 80, label: 'Zusatzinformation - Art 17', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 81, label: 'Zusatzinformation- Inhalt 17', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 82, label: 'Zusatzinformation - Art 18', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 83, label: 'Zusatzinformation- Inhalt 18', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 84, label: 'Zusatzinformation - Art 19', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 85, label: 'Zusatzinformation- Inhalt 19', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 86, label: 'Zusatzinformation - Art 20', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 87, label: 'Zusatzinformation- Inhalt 20', typ: 'Text', laenge: 210, nachkomma: 0, pflicht: false },
  { nr: 88, label: 'Stück', typ: 'Zahl', laenge: 8, nachkomma: 0, pflicht: false },
  { nr: 89, label: 'Gewicht', typ: 'Zahl', laenge: 8, nachkomma: 2, pflicht: false },
  { nr: 90, label: 'Zahlweise', typ: 'Zahl', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 91, label: 'Forderungsart', typ: 'Text', laenge: 10, nachkomma: 0, pflicht: false },
  { nr: 92, label: 'Veranlagungsjahr', typ: 'Zahl', laenge: 4, nachkomma: 0, pflicht: false },
  { nr: 93, label: 'Zugeordnete Fälligkeit', typ: 'Datum', laenge: 8, nachkomma: 0, pflicht: false },
  { nr: 94, label: 'Skontotyp', typ: 'Zahl', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 95, label: 'Auftragsnummer', typ: 'Text', laenge: 30, nachkomma: 0, pflicht: false },
  { nr: 96, label: 'Buchungstyp (Anzahlungen)', typ: 'Text', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 97, label: 'USt-Schlüssel (Anzahlungen)', typ: 'Zahl', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 98, label: 'EU-Land (Anzahlungen)', typ: 'Text', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 99, label: 'Sachverhalt L+L (Anzahlungen)', typ: 'Zahl', laenge: 3, nachkomma: 0, pflicht: false },
  { nr: 100, label: 'EU-Steuersatz (Anzahlungen)', typ: 'Zahl', laenge: 2, nachkomma: 2, pflicht: false },
  { nr: 101, label: 'Erlöskonto (Anzahlungen)', typ: 'Konto', laenge: 9, nachkomma: 0, pflicht: false },
  { nr: 102, label: 'Herkunft-Kz', typ: 'Text', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 103, label: 'Buchungs GUID', typ: 'Text', laenge: 36, nachkomma: 0, pflicht: false },
  { nr: 104, label: 'Kost-Datum', typ: 'Datum', laenge: 8, nachkomma: 0, pflicht: false },
  { nr: 105, label: 'SEPA-Mandatsreferenz', typ: 'Text', laenge: 35, nachkomma: 0, pflicht: false },
  { nr: 106, label: 'Skontosperre', typ: 'Zahl', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 107, label: 'Gesellschaftername', typ: 'Text', laenge: 76, nachkomma: 0, pflicht: false },
  { nr: 108, label: 'Beteiligtennummer', typ: 'Zahl', laenge: 4, nachkomma: 0, pflicht: false },
  { nr: 109, label: 'Identifikationsnummer', typ: 'Text', laenge: 11, nachkomma: 0, pflicht: false },
  { nr: 110, label: 'Zeichnernummer', typ: 'Text', laenge: 20, nachkomma: 0, pflicht: false },
  { nr: 111, label: 'Postensperre bis', typ: 'Datum', laenge: 8, nachkomma: 0, pflicht: false },
  { nr: 112, label: 'Bezeichnung SoBil-Sachverhalt', typ: 'Text', laenge: 30, nachkomma: 0, pflicht: false },
  { nr: 113, label: 'Kennzeichen SoBil-Buchung', typ: 'Zahl', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 114, label: 'Festschreibung', typ: 'Zahl', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 115, label: 'Leistungsdatum', typ: 'Datum', laenge: 8, nachkomma: 0, pflicht: false },
  { nr: 116, label: 'Datum Zuord. Steuerperiode', typ: 'Datum', laenge: 8, nachkomma: 0, pflicht: false },
  { nr: 117, label: 'Fälligkeit', typ: 'Datum', laenge: 8, nachkomma: 0, pflicht: false },
  { nr: 118, label: 'Generalumkehr (GU)', typ: 'Text', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 119, label: 'Steuersatz', typ: 'Zahl', laenge: 2, nachkomma: 2, pflicht: false },
  { nr: 120, label: 'Land', typ: 'Text', laenge: 2, nachkomma: 0, pflicht: false },
  { nr: 121, label: 'Abrechnungsreferenz', typ: 'Text', laenge: 50, nachkomma: 0, pflicht: false },
  { nr: 122, label: 'BVV-Position', typ: 'Zahl', laenge: 1, nachkomma: 0, pflicht: false },
  { nr: 123, label: 'EU-Land u. UStID (Ursprung)', typ: 'Text', laenge: 15, nachkomma: 0, pflicht: false },
  { nr: 124, label: 'EU-Steuersatz (Ursprung)', typ: 'Zahl', laenge: 2, nachkomma: 2, pflicht: false },
  { nr: 125, label: 'Abw. Skontokonto', typ: 'Konto', laenge: 8, nachkomma: 0, pflicht: false },
];

/** Die Positionen, die wir wirklich füllen. Namen statt Zahlen, damit eine
 *  Verschiebung im Quelltext auffällt und nicht erst beim Berater. */
export const FELD = {
  UMSATZ: 1,
  SOLL_HABEN: 2,
  WKZ_UMSATZ: 3,
  KONTO: 7,
  GEGENKONTO: 8,
  BU_SCHLUESSEL: 9,
  BELEGDATUM: 10,
  BELEGFELD_1: 11,
  BELEGFELD_2: 12,
  BUCHUNGSTEXT: 14,
  KOST1: 37,
  KOST2: 38,
  FESTSCHREIBUNG: 114,
  GENERALUMKEHR: 118,
} as const;
