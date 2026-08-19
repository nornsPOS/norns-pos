/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Die Kreuzprobe der drei Exporte — EIN Tag, DREI Wege, dieselben Cent
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Das ist die Probe, die ein Betriebspruefer wirklich macht: er laesst sich
 * denselben Geschaeftstag dreimal geben und legt die Zahlen nebeneinander.
 *
 *   1. DATEV-Buchungsstapel   GET /api/closings/:id/export/datev
 *   2. DSFinV-K (ZIP, DFKA)   GET /api/closings/:id/export/dsfinvk
 *   3. Kassenbericht (Z-Bon)  GET /api/closings/:id/export/kassenbericht
 *
 * Alle drei laufen hier gegen ein ECHTES Postgres im Behaelter, durch die
 * ECHTE Fastify-Anwendung, ueber echte HTTP-Aufrufe. Keine Attrappe steht
 * zwischen der Rechnung und dem Ergebnis.
 *
 * ── WARUM DER ABSCHLUSS HIER NICHT VON HAND GESCHRIEBEN WIRD ───────────────
 * Die Buehne kann einen Tagesabschluss setzen (`legeAbschlussAn`). Genau das
 * tut diese Datei ABSICHTLICH NICHT: der Kassenbericht liest den Abschluss
 * Wort fuer Wort, und ein von Hand gesetzter Abschluss haette den
 * Kassenbericht zu einem Echo meiner eigenen Eingabe gemacht. Stattdessen
 * laeuft `POST /api/closings/finalize` — der ECHTE Weg, der den Tag aus den
 * Belegen zusammenrechnet. Damit sind es wirklich drei unabhaengige
 * Rechenwege, die gegen EINE von Hand nachgerechnete Wahrheit stehen.
 *
 * ── DER TAG, DER WEH TUT ──────────────────────────────────────────────────
 * 13 Belege: vier Steuerbehandlungen, zwei gemischte Belege, sechs Zahlarten,
 * zwei geteilte Zahlungen, zwei Ankaeufe, ein Storno, dazu die krummen
 * Betraege 33,33 / 19,99 / 0,01 / 444,44 / 77,77.
 *
 * JEDE Sollzahl in `SOLL` ist von Hand nachgerechnet; die Herleitung steht
 * als Kommentar daneben. Geld ist ueberall `bigint` in ganzen Cent.
 */

import { inflateRawSync } from 'node:zlib';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TSE_AUSFALL_VERMERK } from '../../src/lib/tse-ausfall.js';
import type { BelegAngaben, PositionAngabe } from '../helfer/fiskal-buehne.js';
import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

/** Ein Montag im Januar — also ECHTE Winterzeit (+01:00), nicht der Sommerfall. */
const TAG = '2026-01-19';

// ═══════════════════════════════════════════════════════════════════════════
//  Von Hand nachgerechnet — alles in ganzen Cent
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Die Sollwerte des Tages. Jede Zahl ist unten im Bauplan `TAGESPLAN`
 * nachzuvollziehen; die Additionen stehen als Kommentar dabei.
 */
const SOLL = {
  /** 10 Verkaeufe + 2 Ankaeufe + 1 Storno. */
  belege: 13,
  verkaufZahl: 10,
  ankaufZahl: 2,
  stornoZahl: 1,

  // 3333 + 1999 + 24900 + 185000 + 11900 + 75950 + 21400 + 1 + 44444 + 10230
  bruttoVerkaufVorStorno: 379157n,
  // Der eine Storno hebt B01 auf: 33,33 EUR.
  stornoVerkauf: 3333n,
  // 379157 − 3333
  bruttoVerkaufNachStorno: 375824n,
  // 2801 + 1868 + 23303 + 185000 + 10000 + 75000 + 19950 + 1 + 42138 + 9000
  nettoVerkauf: 369061n,
  /**
   * Der Storno hebt B01 vollstaendig auf, also auch dessen NETTO-Anteil:
   * B01 ist 33,33 brutto = 28,01 netto + 5,32 USt, B12 traegt −28,01.
   * Wanderung 0112 hat dem Storno nur eine BRUTTO-Spalte gegeben
   * (`storno_verkauf_eur`); der Nettoanteil steht ausschliesslich am Beleg.
   */
  stornoVerkaufNetto: 2801n,
  // 369061 − 2801
  nettoVerkaufNachStorno: 366260n,
  // 50000 + 7777 (Ankauf traegt keine Ausgangsumsatzsteuer, netto = brutto)
  bruttoAnkauf: 57777n,
  nettoAnkauf: 57777n,

  /**
   * Erloes je Steuerbehandlung, brutto, NACH Storno.
   *   STANDARD_19          3333 + 11900 + 5950 + 1 + 5950 − 3333 = 23801
   *   REDUCED_7            1999 + 10700 + 4280                   = 16979
   *   MARGIN_25A          24900 + 10700 + 44444                  = 80044
   *   INVESTMENT_GOLD_25C 185000 + 70000                         = 255000
   *   Summe                                                      = 375824
   */
  erloesJeBehandlung: {
    STANDARD_19: 23801n,
    REDUCED_7: 16979n,
    MARGIN_25A: 80044n,
    INVESTMENT_GOLD_25C: 255000n,
  },

  /**
   * Umsatzsteuer je Steuerbehandlung, auf Positionsebene, Storno abgezogen.
   *   STANDARD_19          532 + 1900 + 950 + 0 + 950 − 532 = 3800
   *   REDUCED_7            131 + 700 + 280                  = 1111
   *   MARGIN_25A          1597 + 750 + 2306                 = 4653
   *   INVESTMENT_GOLD_25C  0                                = 0
   *   Summe                                                 = 9564
   */
  ustJeBehandlung: {
    STANDARD_19: 3800n,
    REDUCED_7: 1111n,
    MARGIN_25A: 4653n,
    INVESTMENT_GOLD_25C: 0n,
  },
  ustGesamt: 9564n,

  /**
   * Zahlungen der VERKAUFSSEITE je Zahlart (der Storno mit Minus).
   *   CASH           3333 + 1999 + 4000 + 10700 + 10230 − 3333 = 26929
   *   ZVT_CARD      24900 + 7900                              = 32800
   *   SUMUP         75950                                     = 75950
   *   STRIPE        10700 + 1                                 = 10701
   *   BANK_TRANSFER 185000                                    = 185000
   *   EBAY          44444                                     = 44444
   *   Summe                                                   = 375824
   */
  verkaufJeZahlart: {
    CASH: 26929n,
    ZVT_CARD: 32800n,
    SUMUP: 75950n,
    STRIPE: 10701n,
    BANK_TRANSFER: 185000n,
    EBAY: 44444n,
  },

  /** Der Ankauf zahlt AUS: 500,00 bar und 77,77 per Ueberweisung. */
  ankaufBar: 50000n,
  ankaufUeberweisung: 7777n,

  /** Wareneingang (SKR03 3200) nimmt beide Ankaeufe auf: 50000 + 7777. */
  wareneingang: 57777n,

  /**
   * Was die Schublade an diesem Tag WIRKLICH bewegt:
   *   + 26929 (Bareinnahmen nach Storno)  − 50000 (Barankauf) = −23071
   */
  kassenbewegung: -23071n,

  /**
   * Summe ALLER Buchungsbetraege der DATEV-Datei (Feld 1, immer positiv).
   *   Verkaufsseite (inkl. der Stornozeile, positiv gebucht) 379157 + 3333
   *   Ankaufseite                                            57777
   *                                                        = 440267
   */
  summeAllerBuchungen: 440267n,

  /**
   * Sollsumme ueber alle Konten, mit WIRKUNG gerechnet: die Stornozeile
   * traegt seit dem 19.08.2026 die Generalumkehr-Marke und wirkt darum
   * NEGATIV auf ihrer Seite (DATEV Dok.-Nr. 1070379). Sie mindert die Summe
   * doppelt gegenueber der alten Kippung: einmal, weil sie nicht mehr als
   * frisches Soll auf dem Erloeskonto steht, und einmal, weil sie das Soll
   * der Kasse kuerzt.
   *   440267 − 2 × 3333 = 433601
   */
  sollsummeMitWirkung: 433601n,

  /**
   * Zeilen im Buchungsstapel.
   *
   * Bis zum 27.07.2026 waren es 19. Seither zerfaellt JEDE Verkaufsposition
   * nach § 25a in ZWEI Buchungsgruppen, Einkaufsanteil und Marge, und drei
   * Belege dieses Tages tragen so eine Position (B03, B07, B09). Neu gezaehlt:
   *
   *   9 einzeilige Belege ohne § 25a                                    =  6
   *       (B01, B02, B04, B08, B10, B11 — B10/B11 sind Ankaeufe und
   *        werden nicht aufgeteilt, siehe unten)
   *   B05  1 Behandlung x 2 Zahlarten                                   =  2
   *   B06  2 Behandlungen x 1 Zahlart                                   =  2
   *   B13  2 Behandlungen x 1 Zahlart                                   =  2
   *   B12  der Storno, 1 Behandlung x 1 Zahlart                         =  1
   *   B03  § 25a: Einkaufsanteil + Marge, x 1 Zahlart                   =  2
   *   B09  § 25a: Einkaufsanteil + Marge, x 1 Zahlart                   =  2
   *   B07  (7 % + Einkaufsanteil + Marge) x 2 Zahlarten                 =  6
   *                                                                      = 23
   *
   * Der ANKAUF wird nicht aufgeteilt: er bucht auf den Wareneingang und
   * traegt gar keinen Ausgangsumsatzsteuer-Schluessel.
   */
  datevZeilen: 23,

  /** 11 Belege sind signiert, B08 und B11 nicht. */
  tseSigniert: 11,
  tseOffen: 2,

  /** Der Anfangsbestand der Schublade: 1.000,00 EUR (siehe opening_float_eur). */
  anfangsbestandBar: 100000n,

  /**
   * Kassenbestand: Anfangsbestand 1.000,00 + Bareinnahmen 269,29
   * − Barankauf 500,00 = 769,29.
   */
  kasseErwartet: 76929n,
} as const;

/**
 * SKR03-Erloeskonten je Steuerbehandlung (so kontiert der Exportweg).
 *
 * ⚠️ Je Behandlung eine LISTE, nicht ein Konto. Seit dem 27.07.2026 zerfaellt
 * die Differenzbesteuerung in zwei Konten: der Einkaufsanteil geht auf 8193,
 * die Marge auf 8191 — beide ohne Buchungsschluessel, denn 8191 ist im
 * amtlichen SKR03 ein Automatikkonto (Marke „AM"). Vorher lag der
 * VOLLE Verkaufspreis auf 8200, steuerfrei und ohne Schluessel — auf Romans
 * Daten gemessen 5.393,19 EUR Umsatzsteuer, die in keiner Zeile vorkamen.
 * 8200 erscheint bei einem Verkauf deshalb gar nicht mehr.
 */
const ERLOESKONTO: Readonly<Record<string, readonly string[]>> = {
  STANDARD_19: ['8400'],
  REDUCED_7: ['8300'],
  MARGIN_25A: ['8193', '8191'],
  // 19.08.2026: 8150 → 8165. § 25c ist keine Befreiung nach § 4 Nr. 2-7;
  // DATEVs Kontenerlaeuterung Dok.-Nr. 5361613 nennt fuer Anlagegold 8165.
  INVESTMENT_GOLD_25C: ['8165'],
};

/** Alle Erloeskonten, ueber die der Tag laufen darf. */
const ALLE_ERLOESKONTEN = Object.values(ERLOESKONTO).flat();

/** Geldkonto je Zahlart. Nur die Kasse 1000 sieht echtes Bargeld. */
const GELDKONTO: Readonly<Record<string, string>> = {
  CASH: '1000',
  ZVT_CARD: '1361',
  SUMUP: '1362',
  STRIPE: '1364',
  BANK_TRANSFER: '1200',
  EBAY: '1365',
};

/**
 * DSFinV-K USt-Schluessel je Steuerbehandlung.
 *
 * ⚠️ Zwei davon waren erfunden, und beide sind seit dem 28.07.2026 berichtigt.
 *
 *   • Anlagegold stand auf 5. Anhang C fuehrt fuer den steuerfreien Umsatz
 *     die 6, und genau die schreibt `vat.csv` heute („Umsatzsteuerfrei").
 *   • § 25a stand auf 7. Fuer diese Zahl gab es nie einen Beleg. Die Norm
 *     haelt die Nummern unter 1000 fuer sich zurueck; welche Nummer der
 *     Differenzbesteuerung gilt, entscheidet der Steuerberater, und sie
 *     kommt aus der Einstellung `dsfinvk.ust_schluessel.margin_25a`. Die
 *     Buehne saet dort 1001 — ein Testwert, keine Rechtsauffassung.
 */
const UST_SCHLUESSEL: Readonly<Record<string, string>> = {
  STANDARD_19: '1',
  REDUCED_7: '2',
  INVESTMENT_GOLD_25C: '6',
  MARGIN_25A: '1001',
};

/**
 * Der amtliche ZAHLART_TYP je Zahlart des Hauses (Anhang D der Norm).
 *
 * Frueher stand hier nur „Bar" gegen „Unbar". Die geschlossene Liste ist
 * feiner: das Kartenterminal ist `ECKarte`, und alles, was ueber einen
 * Zahlungsdienstleister laeuft, ist `ElZahlungsdienstleister`. Nur die
 * Ueberweisung bleibt das allgemeine `Unbar`.
 */
const ZAHLART_TYP_AMTLICH: Readonly<Record<string, string>> = {
  CASH: 'Bar',
  ZVT_CARD: 'ECKarte',
  SUMUP: 'ElZahlungsdienstleister',
  STRIPE: 'ElZahlungsdienstleister',
  EBAY: 'ElZahlungsdienstleister',
  BANK_TRANSFER: 'Unbar',
};

/** Die Beschriftung, unter der der Kassenbericht eine Behandlung ausweist. */
const KASSENBERICHT_BEHANDLUNG: Readonly<Record<string, string>> = {
  STANDARD_19: 'Regelsteuersatz 19 %',
  REDUCED_7: 'Ermäßigter Steuersatz 7 %',
  MARGIN_25A: 'Differenzbesteuerung § 25a UStG',
  INVESTMENT_GOLD_25C: 'Anlagegold, steuerfrei § 25c UStG',
};

/** Die Beschriftung, unter der der Kassenbericht eine Zahlart ausweist. */
const KASSENBERICHT_ZAHLART: Readonly<Record<string, string>> = {
  CASH: 'Bar',
  ZVT_CARD: 'Kartenzahlung Terminal',
  SUMUP: 'SumUp',
  STRIPE: 'Stripe',
  BANK_TRANSFER: 'Überweisung',
  EBAY: 'eBay',
};

// ═══════════════════════════════════════════════════════════════════════════
//  Der Bauplan des Tages
// ═══════════════════════════════════════════════════════════════════════════

interface PositionPlan {
  readonly behandlung: string;
  /** NUMERIC(5,4) oder null — null ist der Fall der Differenzbesteuerung. */
  readonly satz: string | null;
  readonly netto: string;
  readonly ust: string;
  readonly brutto: string;
  /** § 25a braucht Einkaufspreis UND Marge, oder keines von beiden. */
  readonly einkauf: string | null;
  readonly marge: string | null;
  readonly ware: string;
}

interface BelegPlan {
  readonly kurz: string;
  readonly richtung: 'VERKAUF' | 'ANKAUF';
  /** Kopfbehandlung; 'MIXED', wenn die Positionen sich unterscheiden. */
  readonly kopfBehandlung: string;
  readonly netto: string;
  readonly ust: string;
  readonly brutto: string;
  readonly stunde: number;
  readonly minute: number;
  readonly kanal: string;
  readonly mitKunde: boolean;
  /** Kurzname des Belegs, den dieser Beleg aufhebt. */
  readonly stornoVon: string | null;
  readonly signiert: boolean;
  readonly zahlungen: readonly { readonly art: string; readonly betrag: string }[];
  readonly positionen: readonly PositionPlan[];
}

function pos(
  behandlung: string,
  satz: string | null,
  netto: string,
  ust: string,
  brutto: string,
  ware: string,
  einkauf: string | null = null,
  marge: string | null = null,
): PositionPlan {
  return { behandlung, satz, netto, ust, brutto, ware, einkauf, marge };
}

/**
 * Die 13 Belege des Tages.
 *
 * Zwei Entwurfsentscheidungen, die man kennen muss:
 *
 * 1. Ein GEMISCHTER Beleg mit GETEILTER Zahlung (B07) traegt hier bewusst
 *    zwei gleich grosse Behandlungsanteile. Der Exportweg verteilt jede
 *    Zahlung anteilig auf die Behandlungen und gibt den Rest der groessten;
 *    bei ungleichen Anteilen bleibt je Zahlung bis zu ein Cent Rundungsrest
 *    an der falschen Behandlung haengen (so steht es auch im Einzeltest
 *    `tests/unit/datev-kontierung.test.ts`, der bis zu zwei Cent zulaesst).
 *    Mit 107,00 zu 107,00 geht die Teilung glatt auf, und die Kreuzprobe
 *    misst dann WIRKLICH die Kontierung und nicht den Rundungsrest.
 *
 * 2. Alle Betraege bleiben unter der GwG-Schwelle von 2.000 EUR, ausser wo
 *    ein ausweisgeprueter Kunde am Beleg haengt. Sonst weist die Datenbank
 *    den Beleg zu Recht zurueck.
 */
const TAGESPLAN: readonly BelegPlan[] = [
  {
    // 33,33 brutto: 33,33 / 1,19 = 28,0084 → 28,01 netto, 5,32 USt.
    kurz: 'B01',
    richtung: 'VERKAUF',
    kopfBehandlung: 'STANDARD_19',
    netto: '28.01',
    ust: '5.32',
    brutto: '33.33',
    stunde: 9,
    minute: 5,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'CASH', betrag: '33.33' }],
    positionen: [pos('STANDARD_19', '0.1900', '28.01', '5.32', '33.33', 'Silberkette 925')],
  },
  {
    // 19,99 brutto: 19,99 / 1,07 = 18,6822 → 18,68 netto, 1,31 USt.
    kurz: 'B02',
    richtung: 'VERKAUF',
    kopfBehandlung: 'REDUCED_7',
    netto: '18.68',
    ust: '1.31',
    brutto: '19.99',
    stunde: 9,
    minute: 20,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'CASH', betrag: '19.99' }],
    positionen: [pos('REDUCED_7', '0.0700', '18.68', '1.31', '19.99', 'Katalog Muenzkunde')],
  },
  {
    // § 25a: Marge 100,00 → USt = 100,00 x 19 / 119 = 15,966 → 15,97.
    // Netto = 249,00 − 15,97 = 233,03.
    kurz: 'B03',
    richtung: 'VERKAUF',
    kopfBehandlung: 'MARGIN_25A',
    netto: '233.03',
    ust: '15.97',
    brutto: '249.00',
    stunde: 10,
    minute: 0,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'ZVT_CARD', betrag: '249.00' }],
    positionen: [
      pos('MARGIN_25A', null, '233.03', '15.97', '249.00', 'Taschenuhr 1920', '149.00', '100.00'),
    ],
  },
  {
    // Anlagegold ist nach § 25c steuerfrei: USt 0,00, netto = brutto.
    // 1.850,00 bleibt unter der GwG-Schwelle von 2.000,00.
    kurz: 'B04',
    richtung: 'VERKAUF',
    kopfBehandlung: 'INVESTMENT_GOLD_25C',
    netto: '1850.00',
    ust: '0.00',
    brutto: '1850.00',
    stunde: 10,
    minute: 30,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'BANK_TRANSFER', betrag: '1850.00' }],
    positionen: [pos('INVESTMENT_GOLD_25C', '0.0000', '1850.00', '0.00', '1850.00', 'Barren 25g')],
  },
  {
    // GETEILTE Zahlung, EINE Behandlung: 40,00 bar + 79,00 Karte = 119,00.
    kurz: 'B05',
    richtung: 'VERKAUF',
    kopfBehandlung: 'STANDARD_19',
    netto: '100.00',
    ust: '19.00',
    brutto: '119.00',
    stunde: 11,
    minute: 0,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [
      { art: 'CASH', betrag: '40.00' },
      { art: 'ZVT_CARD', betrag: '79.00' },
    ],
    positionen: [pos('STANDARD_19', '0.1900', '100.00', '19.00', '119.00', 'Ring 585 Gold')],
  },
  {
    // GEMISCHT (19 % + Anlagegold), EINE Zahlart.
    // Kopf: 50,00 + 700,00 = 750,00 netto; 9,50 + 0,00 = 9,50 USt; 759,50.
    kurz: 'B06',
    richtung: 'VERKAUF',
    kopfBehandlung: 'MIXED',
    netto: '750.00',
    ust: '9.50',
    brutto: '759.50',
    stunde: 11,
    minute: 45,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'SUMUP', betrag: '759.50' }],
    positionen: [
      pos('STANDARD_19', '0.1900', '50.00', '9.50', '59.50', 'Etui Leder'),
      pos('INVESTMENT_GOLD_25C', '0.0000', '700.00', '0.00', '700.00', 'Krugerrand 1oz'),
    ],
  },
  {
    // GEMISCHT UND GETEILT: 7 % (107,00) + § 25a (107,00), bezahlt 107,00 bar
    // und 107,00 per Stripe. § 25a: Marge 47,00 → USt = 47,00 x 19 / 119
    // = 7,504 → 7,50; netto 107,00 − 7,50 = 99,50.
    // Kopf: 100,00 + 99,50 = 199,50 netto; 7,00 + 7,50 = 14,50 USt; 214,00.
    kurz: 'B07',
    richtung: 'VERKAUF',
    kopfBehandlung: 'MIXED',
    netto: '199.50',
    ust: '14.50',
    brutto: '214.00',
    stunde: 12,
    minute: 30,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [
      { art: 'CASH', betrag: '107.00' },
      { art: 'STRIPE', betrag: '107.00' },
    ],
    positionen: [
      pos('REDUCED_7', '0.0700', '100.00', '7.00', '107.00', 'Bildband Uhren'),
      pos('MARGIN_25A', null, '99.50', '7.50', '107.00', 'Manschettenknoepfe', '60.00', '47.00'),
    ],
  },
  {
    // Der kleinste denkbare Beleg: 0,01. 0,01 / 1,19 = 0,0084 → netto 0,01,
    // USt 0,00. Ueber das Netz, also mit Versandzustand.
    kurz: 'B08',
    richtung: 'VERKAUF',
    kopfBehandlung: 'STANDARD_19',
    netto: '0.01',
    ust: '0.00',
    brutto: '0.01',
    stunde: 13,
    minute: 15,
    kanal: 'WEB',
    mitKunde: false,
    stornoVon: null,
    signiert: false,
    zahlungen: [{ art: 'STRIPE', betrag: '0.01' }],
    positionen: [pos('STANDARD_19', '0.1900', '0.01', '0.00', '0.01', 'Restposten Beilage')],
  },
  {
    // § 25a ueber eBay: Marge 144,44 → USt = 144,44 x 19 / 119 = 23,061
    // → 23,06; netto 444,44 − 23,06 = 421,38.
    kurz: 'B09',
    richtung: 'VERKAUF',
    kopfBehandlung: 'MARGIN_25A',
    netto: '421.38',
    ust: '23.06',
    brutto: '444.44',
    stunde: 14,
    minute: 0,
    kanal: 'EBAY',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'EBAY', betrag: '444.44' }],
    positionen: [
      pos('MARGIN_25A', null, '421.38', '23.06', '444.44', 'Brosche Jugendstil', '300.00', '144.44'),
    ],
  },
  {
    // ANKAUF vom Privatverkaeufer: kein Vorsteuerausweis, netto = brutto.
    // Bar bezahlt — das Geld verlaesst die Schublade.
    kurz: 'B10',
    richtung: 'ANKAUF',
    kopfBehandlung: 'MARGIN_25A',
    netto: '500.00',
    ust: '0.00',
    brutto: '500.00',
    stunde: 15,
    minute: 0,
    kanal: 'POS',
    mitKunde: true,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'CASH', betrag: '500.00' }],
    positionen: [pos('MARGIN_25A', null, '500.00', '0.00', '500.00', 'Konvolut Silberbesteck')],
  },
  {
    // Zweiter ANKAUF, krumm und per Ueberweisung — damit die Ankaufseite
    // nicht nur die Kasse beruehrt.
    kurz: 'B11',
    richtung: 'ANKAUF',
    kopfBehandlung: 'MARGIN_25A',
    netto: '77.77',
    ust: '0.00',
    brutto: '77.77',
    stunde: 15,
    minute: 30,
    kanal: 'POS',
    mitKunde: true,
    stornoVon: null,
    signiert: false,
    zahlungen: [{ art: 'BANK_TRANSFER', betrag: '77.77' }],
    positionen: [pos('MARGIN_25A', null, '77.77', '0.00', '77.77', 'Muenzrestposten')],
  },
  {
    // STORNO von B01. Eine NEUE Zeile mit negativem Betrag, kein Loeschen.
    kurz: 'B12',
    richtung: 'VERKAUF',
    kopfBehandlung: 'STANDARD_19',
    netto: '-28.01',
    ust: '-5.32',
    brutto: '-33.33',
    stunde: 16,
    minute: 0,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: 'B01',
    signiert: true,
    zahlungen: [{ art: 'CASH', betrag: '-33.33' }],
    positionen: [pos('STANDARD_19', '0.1900', '-28.01', '-5.32', '-33.33', 'Silberkette 925')],
  },
  {
    // Zweiter GEMISCHTER Beleg (19 % + 7 %), bar bezahlt.
    // Kopf: 50,00 + 40,00 = 90,00 netto; 9,50 + 2,80 = 12,30 USt; 102,30.
    kurz: 'B13',
    richtung: 'VERKAUF',
    kopfBehandlung: 'MIXED',
    netto: '90.00',
    ust: '12.30',
    brutto: '102.30',
    stunde: 17,
    minute: 0,
    kanal: 'POS',
    mitKunde: false,
    stornoVon: null,
    signiert: true,
    zahlungen: [{ art: 'CASH', betrag: '102.30' }],
    positionen: [
      pos('STANDARD_19', '0.1900', '50.00', '9.50', '59.50', 'Lupe Messing'),
      pos('REDUCED_7', '0.0700', '40.00', '2.80', '42.80', 'Fachbuch Silberpunzen'),
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════
//  Werkzeug: Cent, CSV, ZIP
// ═══════════════════════════════════════════════════════════════════════════

/** "1234.50" / "-33.33" → ganze Cent. Kein Fliesskomma. */
function zuCent(eur: string): bigint {
  const t = eur.trim();
  if (t.length === 0) return 0n;
  const neg = t.startsWith('-');
  const [ganz = '0', bruch = ''] = (neg ? t.slice(1) : t).split('.');
  const v = BigInt(ganz || '0') * 100n + BigInt(`${bruch}00`.slice(0, 2));
  return neg ? -v : v;
}

/** DATEV schreibt deutsch: "3758,24" → 375824 Cent. */
function zuCentDeutsch(betrag: string): bigint {
  return zuCent(betrag.trim().replace(/\./g, '').replace(',', '.'));
}

/** Der Kassenbericht schreibt "269,29 EUR". */
function zuCentAusBericht(wert: string): bigint {
  return zuCentDeutsch(wert.replace(/\s*EUR$/, ''));
}

/** Ganze Cent zurueck in die Schreibweise der Datenbank. */
function ausCent(cent: bigint): string {
  const neg = cent < 0n;
  const abs = neg ? -cent : cent;
  return `${neg ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

/** Eine gelesene CSV-Datei mit Spaltenzeile. */
interface Tabelle {
  readonly spalten: readonly string[];
  readonly zeilen: readonly (readonly string[])[];
  wert(zeile: readonly string[], spalte: string): string;
}

function leseTabelle(text: string): Tabelle {
  const alle = text
    .split(/\r\n|\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(';'));
  const spalten = alle[0] ?? [];
  return {
    spalten,
    zeilen: alle.slice(1),
    wert(zeile, spalte) {
      const i = spalten.indexOf(spalte);
      if (i < 0) throw new Error(`Die Spalte „${spalte}" gibt es in dieser Datei nicht.`);
      return zeile[i] ?? '';
    },
  };
}

/**
 * Das ZIP wirklich auspacken, nicht nur „sieht aus wie ein ZIP" pruefen.
 * Der Erzeuger schreibt STORE (0) oder rohes DEFLATE (8).
 */
function leseZip(buf: Buffer): Map<string, string> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('leseZip: kein Ende-Verzeichnis gefunden — das ist kein ZIP.');

  const anzahl = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  const raus = new Map<string, string>();
  for (let n = 0; n < anzahl; n++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) {
      throw new Error('leseZip: falsche Kennung im Zentralverzeichnis.');
    }
    const verfahren = buf.readUInt16LE(cd + 10);
    const packGroesse = buf.readUInt32LE(cd + 20);
    const namenLaenge = buf.readUInt16LE(cd + 28);
    const extraLaenge = buf.readUInt16LE(cd + 30);
    const kommentarLaenge = buf.readUInt16LE(cd + 32);
    const lokal = buf.readUInt32LE(cd + 42);
    const name = buf.toString('utf8', cd + 46, cd + 46 + namenLaenge);

    const lNamen = buf.readUInt16LE(lokal + 26);
    const lExtra = buf.readUInt16LE(lokal + 28);
    const start = lokal + 30 + lNamen + lExtra;
    const gepackt = buf.subarray(start, start + packGroesse);
    const roh = verfahren === 8 ? inflateRawSync(gepackt) : Buffer.from(gepackt);
    raus.set(name, roh.toString('utf8'));

    cd += 46 + namenLaenge + extraLaenge + kommentarLaenge;
  }
  return raus;
}

/** Eine Buchungszeile des DATEV-Stapels, so wie ein Berater sie liest. */
interface Buchung {
  readonly betrag: bigint;
  readonly sollHaben: string;
  readonly konto: string;
  readonly gegenkonto: string;
  readonly buSchluessel: string;
  readonly belegdatum: string;
  readonly beleg: string;
  readonly text: string;
  /** Feld 118 — '1' auf einer Generalumkehr, sonst leer. */
  readonly generalumkehr: string;
}

/**
 * Der Saldo eines Kontos ueber die ganze Datei, in ganzen Cent.
 *
 * Jede Zeile bucht ihren Betrag auf `Konto` (Seite laut Feld 2) UND auf
 * `Gegenkonto` (die andere Seite). Traegt sie die Generalumkehr-Marke
 * (Feld 118 = 1), wirkt der Betrag NEGATIV auf seiner Seite — DATEV
 * Dok.-Nr. 1070379: die Generalumkehr bucht „mit Minuszeichen auf der
 * GLEICHEN Soll-/Haben-Seite". Genau so liest DATEV die Zeile, und genau
 * so muss man rechnen, um an den Saldo eines Kontos zu kommen.
 */
function saldo(zeilen: readonly Buchung[], konto: string): { soll: bigint; haben: bigint } {
  let soll = 0n;
  let haben = 0n;
  for (const z of zeilen) {
    const istSoll = z.sollHaben === 'S';
    const betrag = z.generalumkehr === '1' ? -z.betrag : z.betrag;
    if (z.konto === konto) {
      if (istSoll) soll += betrag;
      else haben += betrag;
    }
    if (z.gegenkonto === konto) {
      if (istSoll) haben += betrag;
      else soll += betrag;
    }
  }
  return { soll, haben };
}

/** Habensaldo (Erloese stehen im Haben, ein Storno kuerzt sie). */
function habenSaldo(zeilen: readonly Buchung[], konto: string): bigint {
  const s = saldo(zeilen, konto);
  return s.haben - s.soll;
}

/** Sollsaldo (Geldzugang, Wareneingang). */
function sollSaldo(zeilen: readonly Buchung[], konto: string): bigint {
  const s = saldo(zeilen, konto);
  return s.soll - s.haben;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Die Buehne
// ═══════════════════════════════════════════════════════════════════════════

describe('Kreuzprobe: derselbe Geschaeftstag durch DATEV, DSFinV-K und Kassenbericht', () => {
  const buehne = baueFiskalBuehne({ geschaeftstag: TAG });

  /** Belegnummer je Kurzname (B01 …) und umgekehrt. */
  const belegJeKurz = new Map<string, string>();
  const kurzJeBeleg = new Map<string, string>();
  /** Richtung je Belegnummer — meine eigene Wahrheit, nicht aus dem Export. */
  const richtungJeBeleg = new Map<string, 'VERKAUF' | 'ANKAUF'>();
  /** Belegnummern, die zu einem Verkauf gehoeren (inklusive des Stornos). */
  const verkaufsBelege = new Set<string>();

  let buchungen: Buchung[] = [];
  let datevKopf = '';
  let dsfinvk = new Map<string, string>();
  let bericht: string[][] = [];

  beforeAll(async () => {
    await buehne.starten();
    await buehne.leeren();

    // ── 1. Die 13 Belege, in der Reihenfolge des Tages ────────────────────
    for (const plan of TAGESPLAN) {
      const positionen: PositionAngabe[] = [];
      for (const [i, p] of plan.positionen.entries()) {
        const produkt = await buehne.legeProduktAn({ name: p.ware, behandlung: p.behandlung });
        positionen.push({
          productId: produkt,
          treatment: p.behandlung,
          vatRate: p.satz,
          lineSubtotal: p.netto,
          lineVat: p.ust,
          lineTotal: p.brutto,
          acquisition: p.einkauf,
          margin: p.marge,
          displayOrder: i,
        });
      }

      const stornoVon =
        plan.stornoVon === null ? null : (belegJeKurz.get(`${plan.stornoVon}:id`) ?? null);

      const angaben: BelegAngaben = {
        direction: plan.richtung,
        treatment: plan.kopfBehandlung,
        subtotal: plan.netto,
        vat: plan.ust,
        total: plan.brutto,
        customerId: plan.mitKunde ? buehne.akteure.kundeId : null,
        finalizedAt: buehne.ts(plan.stunde, plan.minute),
        items: positionen,
        payments: plan.zahlungen.map((z) => ({ method: z.art, amount: z.betrag })),
        salesChannel: plan.kanal,
        stornoOf: stornoVon,
        tse: plan.signiert,
      };

      const beleg = await buehne.legeBelegAn(angaben);
      belegJeKurz.set(plan.kurz, beleg.locator);
      belegJeKurz.set(`${plan.kurz}:id`, beleg.id);
      kurzJeBeleg.set(beleg.locator, plan.kurz);
      richtungJeBeleg.set(beleg.locator, plan.richtung);
      if (plan.richtung === 'VERKAUF') verkaufsBelege.add(beleg.locator);
    }

    // ── 2. Die Schicht, ohne die kein Tag abgeschlossen werden darf ───────
    // Anfangsbestand 1.000,00 + Bareinnahmen 269,29 − Barankauf 500,00
    // = 769,29 erwartet; blind gezaehlt derselbe Betrag, also keine Differenz.
    await buehne.migratorSql`
      INSERT INTO shifts (device_id, opened_by_user_id, opened_at, opening_float_eur,
                          status, blind_count_eur, system_expected_eur,
                          closed_by_user_id, closed_at)
      VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.kassiererId},
              ${buehne.ts(8, 0)}::timestamptz, '1000.00',
              'CLOSED'::shift_status, ${ausCent(SOLL.kasseErwartet)}, ${ausCent(SOLL.kasseErwartet)},
              ${buehne.akteure.inhaberId}, ${buehne.ts(20, 30)}::timestamptz)`;

    // ── 3. Der ECHTE Tagesabschluss, nicht ein von Hand gesetzter ─────────
    //
    // ⚠️ `unsignierteBelegeBestaetigt` ist KEINE Abkuerzung um einen Riegel
    // herum, sondern genau der Weg, den der Riegel vorsieht. Der Tagesplan
    // dieses Szenarios laesst B08 und B11 mit Absicht ohne TSE-Signatur, weil
    // weiter unten gemessen wird, dass `tse.csv` fuer diese beiden WIRKLICH
    // keine Zeile traegt. Ein Tag mit einer solchen Luecke schliesst seit dem
    // Riegel in `closings-finalize.ts` nicht mehr aus Versehen: der Mensch am
    // Abschluss muss die Zahl gesehen und bestaetigt haben, und was er
    // bestaetigt, steht danach unveraenderlich in der Notiz der Abschlusszeile.
    // Die Buehne spielt hier diesen Menschen und sagt ausdruecklich ja.
    const abschluss = await buehne.sende('/api/closings/finalize', {
      businessDay: TAG,
      unsignierteBelegeBestaetigt: true,
    });
    if (abschluss.statusCode !== 200) {
      throw new Error(`Tagesabschluss scheiterte: ${abschluss.statusCode} ${abschluss.payload}`);
    }
    const abschlussId = (abschluss.json() as { id: string }).id;

    // ── 4. Die drei Ausgabewege, EINMAL gezogen ───────────────────────────
    const datevAntwort = await buehne.hol(`/api/closings/${abschlussId}/export/datev`);
    if (datevAntwort.statusCode !== 200) {
      throw new Error(`DATEV-Export scheiterte: ${datevAntwort.statusCode} ${datevAntwort.payload}`);
    }
    // Die Datei ist Windows-1252, also die ROHEN Bytes lesen.
    const datevText = Buffer.from(datevAntwort.rawPayload).toString('latin1');
    const datevZeilen = datevText.split('\r\n').filter((l) => l.length > 0);
    datevKopf = datevZeilen[0] ?? '';
    buchungen = datevZeilen.slice(2).map((zeile) => {
      const f = zeile.split(';').map((c) => c.replace(/^"|"$/g, ''));
      return {
        betrag: zuCentDeutsch(f[0] ?? '0,00'),
        sollHaben: f[1] ?? '',
        konto: f[6] ?? '',
        gegenkonto: f[7] ?? '',
        buSchluessel: f[8] ?? '',
        belegdatum: f[9] ?? '',
        beleg: f[10] ?? '',
        generalumkehr: f[117] ?? '',
        text: f[13] ?? '',
      };
    });

    const zipAntwort = await buehne.hol(`/api/closings/${abschlussId}/export/dsfinvk`);
    if (zipAntwort.statusCode !== 200) {
      throw new Error(`DSFinV-K-Export scheiterte: ${zipAntwort.statusCode}`);
    }
    dsfinvk = leseZip(Buffer.from(zipAntwort.rawPayload));

    const berichtAntwort = await buehne.hol(`/api/closings/${abschlussId}/export/kassenbericht`);
    if (berichtAntwort.statusCode !== 200) {
      throw new Error(`Kassenbericht scheiterte: ${berichtAntwort.statusCode}`);
    }
    bericht = berichtAntwort.payload
      .split(/\r\n|\n/)
      .filter((l) => l.length > 0)
      .map((l) => l.split(';'));
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  // ── kleine Leser auf die drei Ausgaben ──────────────────────────────────

  function tabelle(datei: string): Tabelle {
    const inhalt = dsfinvk.get(datei);
    if (inhalt === undefined) throw new Error(`Im DSFinV-K-Buendel fehlt „${datei}".`);
    return leseTabelle(inhalt);
  }

  /** Ein Wert des Kassenberichts: Abschnitt + Feldname → Wert. */
  function berichtWert(abschnitt: string, feld: string): string {
    const treffer = bericht.find((z) => z[0] === abschnitt && z[1] === feld);
    if (!treffer) throw new Error(`Im Kassenbericht fehlt „${abschnitt} / ${feld}".`);
    return treffer[2] ?? '';
  }

  /** Nur die Buchungszeilen der Verkaufsseite (inklusive der Stornozeile). */
  function verkaufsBuchungen(): Buchung[] {
    return buchungen.filter((b) => verkaufsBelege.has(b.beleg));
  }

  /** Habensaldo ueber ALLE Erloeskonten einer Steuerbehandlung. */
  function datevErloes(zeilen: readonly Buchung[], behandlung: string): bigint {
    const konten = ERLOESKONTO[behandlung];
    expect(konten).toBeDefined();
    return (konten as readonly string[]).reduce((s, k) => s + habenSaldo(zeilen, k), 0n);
  }

  /** Summe je Steuerbehandlung aus `lines_vat.csv`, nur Verkaufsbelege. */
  function dsfinvkJeBehandlung(spalte: 'POS_BRUTTO' | 'POS_NETTO' | 'POS_UST'): Map<string, bigint> {
    const t = tabelle('lines_vat.csv');
    const raus = new Map<string, bigint>();
    for (const zeile of t.zeilen) {
      const beleg = t.wert(zeile, 'BON_ID');
      if (!verkaufsBelege.has(beleg)) continue;
      const key = t.wert(zeile, 'UST_SCHLUESSEL');
      raus.set(key, (raus.get(key) ?? 0n) + zuCentDeutsch(t.wert(zeile, spalte)));
    }
    return raus;
  }

  /** Summe je Zahlart aus `datapayment.csv`, wahlweise nur die Verkaufsseite. */
  function dsfinvkJeZahlart(nurVerkauf: boolean): Map<string, bigint> {
    const t = tabelle('datapayment.csv');
    const raus = new Map<string, bigint>();
    for (const zeile of t.zeilen) {
      const beleg = t.wert(zeile, 'BON_ID');
      if (nurVerkauf && !verkaufsBelege.has(beleg)) continue;
      const art = t.wert(zeile, 'ZAHLART_NAME');
      // BASISWAEH_BETRAG ist der Betrag in der Basiswaehrung der Kasse. Die
      // frueher gelesene Spalte BETRAG kennt die Norm nicht.
      raus.set(art, (raus.get(art) ?? 0n) + zuCentDeutsch(t.wert(zeile, 'BASISWAEH_BETRAG')));
    }
    return raus;
  }

  /** Brutto je Beleg aus `transactions.csv` (der amtliche Bonkopf). */
  function bruttoJeBeleg(): Map<string, bigint> {
    const t = tabelle('transactions.csv');
    return new Map(
      t.zeilen.map((z) => [t.wert(z, 'BON_ID'), zuCentDeutsch(t.wert(z, 'UMS_BRUTTO'))]),
    );
  }

  /**
   * Netto und Umsatzsteuer je Beleg aus `transactions_vat.csv`.
   *
   * ⚠️ Der amtliche Bonkopf `transactions.csv` traegt NUR das Brutto
   * (UMS_BRUTTO). Netto und Steuer stehen je Beleg UND je Steuerschluessel in
   * `transactions_vat.csv`; wer sie je Beleg braucht, summiert dort.
   */
  function nettoUndUstJeBeleg(): Map<string, { netto: bigint; ust: bigint }> {
    const t = tabelle('transactions_vat.csv');
    const raus = new Map<string, { netto: bigint; ust: bigint }>();
    for (const z of t.zeilen) {
      const id = t.wert(z, 'BON_ID');
      const bisher = raus.get(id) ?? { netto: 0n, ust: 0n };
      raus.set(id, {
        netto: bisher.netto + zuCentDeutsch(t.wert(z, 'BON_NETTO')),
        ust: bisher.ust + zuCentDeutsch(t.wert(z, 'BON_UST')),
      });
    }
    return raus;
  }

  /**
   * Die Tagessummen des Kassenabschlusses aus `businesscases.csv`.
   *
   * ⚠️ Das ist der ERSATZ fuer die frueher gelesenen Spalten
   * GESAMT_BRUTTO_VERKAUF und GESAMT_NETTO_VERKAUF. Die Norm kennt sie nicht:
   * `cashpointclosing.csv` traegt nur Z_SE_ZAHLUNGEN und Z_SE_BARZAHLUNGEN,
   * und die Tagessummen je Geschaeftsvorfall stehen in `businesscases.csv`.
   */
  /**
   * ⚠️ Seit dem 06.08.2026 traegt `businesscases.csv` BEIDE Richtungen: der
   * Verkauf mit dem Geschaeftsvorfalltyp „Umsatz", der Ankauf mit seinem
   * eigenen Typ und negativen Betraegen. Wer nur die Gesamtsumme nimmt,
   * vergleicht Verkauf minus Ankauf mit einer reinen Verkaufszahl.
   *
   * Deshalb gibt es beide: `brutto` ist die Tagesbewegung ueber alle
   * Geschaeftsvorfaelle, `bruttoVerkauf` nur die Umsatzzeilen.
   */
  function tagessummen(): {
    brutto: bigint;
    netto: bigint;
    ust: bigint;
    bruttoVerkauf: bigint;
    nettoVerkauf: bigint;
  } {
    const t = tabelle('businesscases.csv');
    let brutto = 0n;
    let netto = 0n;
    let ust = 0n;
    let bruttoVerkauf = 0n;
    let nettoVerkauf = 0n;
    for (const z of t.zeilen) {
      const b = zuCentDeutsch(t.wert(z, 'Z_UMS_BRUTTO'));
      const n = zuCentDeutsch(t.wert(z, 'Z_UMS_NETTO'));
      brutto += b;
      netto += n;
      ust += zuCentDeutsch(t.wert(z, 'Z_UST'));
      if (t.wert(z, 'GV_TYP') === 'Umsatz') {
        bruttoVerkauf += b;
        nettoVerkauf += n;
      }
    }
    return { brutto, netto, ust, bruttoVerkauf, nettoVerkauf };
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  Die Kreuzprobe
  // ═════════════════════════════════════════════════════════════════════════

  it('alle drei Ausgaben zaehlen dieselben dreizehn Belege des Tages', () => {
    // DATEV: der Ordnungsbegriff ist Belegfeld 1.
    const ausDatev = new Set(buchungen.map((b) => b.beleg));
    expect(ausDatev.size).toBe(SOLL.belege);
    expect(buchungen.length).toBe(SOLL.datevZeilen);

    // DSFinV-K: eine Zeile je Beleg im amtlichen Bonkopf `transactions.csv`.
    const kopf = tabelle('transactions.csv');
    const ausDsfinvk = new Set(kopf.zeilen.map((z) => kopf.wert(z, 'BON_ID')));
    expect(kopf.zeilen.length).toBe(SOLL.belege);
    expect(ausDsfinvk).toEqual(ausDatev);

    // Und es sind WIRKLICH die 13, die ich angelegt habe.
    expect(ausDatev).toEqual(new Set(kurzJeBeleg.keys()));

    // Kassenbericht: 10 Verkaeufe + 2 Ankaeufe + 1 Storno = 13.
    expect(berichtWert('Belege', 'Verkäufe')).toBe(String(SOLL.verkaufZahl));
    expect(berichtWert('Belege', 'Ankäufe')).toBe(String(SOLL.ankaufZahl));
    expect(berichtWert('Belege', 'Stornos')).toBe(String(SOLL.stornoZahl));
    expect(SOLL.verkaufZahl + SOLL.ankaufZahl + SOLL.stornoZahl).toBe(SOLL.belege);
  });

  it('der Erloes je Steuerbehandlung ist in DATEV und DSFinV-K auf den Cent derselbe', () => {
    const zeilen = verkaufsBuchungen();
    const ausDsfinvk = dsfinvkJeBehandlung('POS_BRUTTO');

    let summeDatev = 0n;
    let summeDsfinvk = 0n;
    for (const [behandlung, sollWert] of Object.entries(SOLL.erloesJeBehandlung)) {
      // ⚠️ Die Differenzbesteuerung liegt auf ZWEI Konten (8193 + 8191). Ihre
      // Summe muss die Zahl der Behandlung sein — eine Aufteilung, die einen
      // Cent verliert, faellt genau hier auf.
      const ausDatev = datevErloes(zeilen, behandlung);
      const key = UST_SCHLUESSEL[behandlung] as string;
      const dsWert = ausDsfinvk.get(key) ?? 0n;

      // Von Hand nachgerechnet, siehe SOLL.erloesJeBehandlung.
      expect(`${behandlung}=${ausDatev}`).toBe(`${behandlung}=${sollWert}`);
      expect(`${behandlung}=${dsWert}`).toBe(`${behandlung}=${sollWert}`);

      summeDatev += ausDatev;
      summeDsfinvk += dsWert;
    }

    // 23801 + 16979 + 80044 + 255000 = 375824
    expect(summeDatev).toBe(SOLL.bruttoVerkaufNachStorno);
    expect(summeDsfinvk).toBe(SOLL.bruttoVerkaufNachStorno);

    // Kein Erloes darf auf dem Auffangkonto 8400 landen, der nicht dorthin
    // gehoert: 8400 traegt genau den 19-Prozent-Anteil und nichts sonst.
    expect(habenSaldo(zeilen, '8400')).toBe(SOLL.erloesJeBehandlung.STANDARD_19);

    // Und die Probe auf das ALTE Sammelkonto: seit der Aufteilung darf ueber
    // 8200 kein einziger Cent eines Verkaufs mehr laufen. Genau dort lag der
    // Fund vom 27.07.2026 — voller Verkaufspreis, steuerfrei, ohne Schluessel.
    expect(habenSaldo(buchungen, '8200')).toBe(0n);
    // Von Hand aus den Einkaufspreisen: B03 149,00 + B07 60,00 + B09 300,00
    // = 509,00 Einkaufsanteil, und der Rest 100,00 + 47,00 + 144,44 = 291,44
    // ist die Marge. 50900 + 29144 = 80044, die Zahl der Behandlung.
    expect(habenSaldo(zeilen, '8193')).toBe(50900n);
    expect(habenSaldo(zeilen, '8191')).toBe(29144n);
    expect(50900n + 29144n).toBe(SOLL.erloesJeBehandlung.MARGIN_25A);
  });

  it('die Umsatzsteuer je Behandlung stimmt zwischen Kassenbericht und DSFinV-K', () => {
    const ausDsfinvk = dsfinvkJeBehandlung('POS_UST');

    let summe = 0n;
    for (const [behandlung, sollWert] of Object.entries(SOLL.ustJeBehandlung)) {
      const key = UST_SCHLUESSEL[behandlung] as string;
      const dsWert = ausDsfinvk.get(key) ?? 0n;
      expect(`${behandlung}=${dsWert}`).toBe(`${behandlung}=${sollWert}`);

      const beschriftung = KASSENBERICHT_BEHANDLUNG[behandlung] as string;
      const ausBericht = zuCentAusBericht(berichtWert('Umsatzsteuer', beschriftung));
      expect(`${behandlung}=${ausBericht}`).toBe(`${behandlung}=${sollWert}`);

      summe += dsWert;
    }

    // 3800 + 1111 + 4653 + 0 = 9564
    expect(summe).toBe(SOLL.ustGesamt);
    expect(zuCentAusBericht(berichtWert('Umsatzsteuer', 'Summe'))).toBe(SOLL.ustGesamt);
  });

  it('das Geld je Zahlart ist in DATEV, DSFinV-K und Kassenbericht dieselbe Zahl', () => {
    const zeilen = verkaufsBuchungen();
    const ausDsfinvk = dsfinvkJeZahlart(true);

    let summe = 0n;
    for (const [zahlart, sollWert] of Object.entries(SOLL.verkaufJeZahlart)) {
      const konto = GELDKONTO[zahlart] as string;
      // Auf der Verkaufsseite steht das Geldkonto im Soll; der Storno kuerzt es.
      const ausDatev = sollSaldo(zeilen, konto);
      const dsWert = ausDsfinvk.get(zahlart) ?? 0n;
      const ausBericht = zuCentAusBericht(
        berichtWert('Zahlungsart', KASSENBERICHT_ZAHLART[zahlart] as string),
      );

      expect(`${zahlart}=${ausDatev}`).toBe(`${zahlart}=${sollWert}`);
      expect(`${zahlart}=${dsWert}`).toBe(`${zahlart}=${sollWert}`);
      expect(`${zahlart}=${ausBericht}`).toBe(`${zahlart}=${sollWert}`);

      summe += sollWert;
    }

    // 26929 + 32800 + 75950 + 10701 + 185000 + 44444 = 375824
    expect(summe).toBe(SOLL.bruttoVerkaufNachStorno);
    expect(zuCentAusBericht(berichtWert('Zahlungsart', 'Summe'))).toBe(
      SOLL.bruttoVerkaufNachStorno,
    );
  });

  it('nur Bargeld beruehrt das Konto 1000, und zwar in allen drei Ausgaben mit 269,29', () => {
    const zeilen = verkaufsBuchungen();

    // Waere auch nur ein Karten-Euro auf der Kasse gelandet, waere dieser
    // Sollsaldo groesser als die Barsumme — genau das ist die Probe.
    expect(sollSaldo(zeilen, '1000')).toBe(SOLL.verkaufJeZahlart.CASH);
    expect(dsfinvkJeZahlart(true).get('CASH')).toBe(SOLL.verkaufJeZahlart.CASH);
    expect(zuCentAusBericht(berichtWert('Zahlungsart', 'Bar'))).toBe(SOLL.verkaufJeZahlart.CASH);

    // Und umgekehrt: die unbaren Zahlarten liegen auf EIGENEN Geldkonten.
    for (const zahlart of ['ZVT_CARD', 'SUMUP', 'STRIPE', 'BANK_TRANSFER', 'EBAY']) {
      expect(GELDKONTO[zahlart]).not.toBe('1000');
    }

    // Jede Zahlart traegt den Typ, den Anhang D der Norm dafuer vorsieht.
    // Frueher stand hier nur Bar gegen Unbar; die geschlossene Liste ist
    // feiner, und ein Pruefwerkzeug trennt nach genau diesen Werten.
    const zahlungen = tabelle('datapayment.csv');
    for (const zeile of zahlungen.zeilen) {
      const art = zahlungen.wert(zeile, 'ZAHLART_NAME');
      const typ = zahlungen.wert(zeile, 'ZAHLART_TYP');
      const erwartet = ZAHLART_TYP_AMTLICH[art];
      expect(`${art} ist bekannt`).toBe(erwartet === undefined ? `${art} fehlt` : `${art} ist bekannt`);
      expect(`${art}:${typ}`).toBe(`${art}:${erwartet}`);
    }
    // Und nur EINE Zahlart darf „Bar" heissen, sonst waere die Trennung
    // zwischen Schublade und Konto in der Norm-Ansicht aufgehoben.
    const barArten = new Set(
      zahlungen.zeilen
        .filter((z) => zahlungen.wert(z, 'ZAHLART_TYP') === 'Bar')
        .map((z) => zahlungen.wert(z, 'ZAHLART_NAME')),
    );
    expect([...barArten]).toEqual(['CASH']);
  });

  it('Soll und Haben gleichen sich ueber die ganze DATEV-Datei aus', () => {
    // Die doppelte Buchfuehrung: jede Zeile bucht denselben Betrag einmal ins
    // Soll und einmal ins Haben. Ueber alle beruehrten Konten muss die Summe
    // beider Seiten gleich sein — sonst ist die Datei kein Buchungsstapel.
    const konten = new Set<string>();
    for (const b of buchungen) {
      konten.add(b.konto);
      konten.add(b.gegenkonto);
    }

    let soll = 0n;
    let haben = 0n;
    for (const konto of konten) {
      const s = saldo(buchungen, konto);
      soll += s.soll;
      haben += s.haben;
    }

    expect(soll).toBe(haben);
    // Mit Wirkung gerechnet (Generalumkehr mindert): 440267 − 2×3333 = 433601.
    expect(soll).toBe(SOLL.sollsummeMitWirkung);
    // Die ROHEN Betraege (Feld 1) bleiben davon unberuehrt — positiv, 440267.
    expect(buchungen.reduce((s, b) => s + b.betrag, 0n)).toBe(SOLL.summeAllerBuchungen);

    // Keine Buchung ueber 0,00 und keine mit negativem Umsatz: die Richtung
    // traegt ausschliesslich Feld 2.
    for (const b of buchungen) {
      expect(b.betrag > 0n).toBe(true);
      expect(['S', 'H']).toContain(b.sollHaben);
    }
  });

  it('der Ankauf verlaesst die Kasse und landet im Wareneingang', () => {
    // 500,00 bar + 77,77 per Ueberweisung → Wareneingang 3200 im Soll.
    expect(sollSaldo(buchungen, '3200')).toBe(SOLL.wareneingang);

    // Die Kasse gibt die 500,00 ab: Soll 30262 (Verkauf) − Haben 3333 (Storno)
    // − Haben 50000 (Ankauf) = −23071. Das ist die echte Tagesbewegung.
    expect(sollSaldo(buchungen, '1000')).toBe(SOLL.kassenbewegung);

    // Und die Ueberweisung des zweiten Ankaufs kuerzt das Bankkonto:
    // 185000 (Verkauf B04) − 7777 (Ankauf B11) = 177223.
    expect(sollSaldo(buchungen, '1200')).toBe(SOLL.verkaufJeZahlart.BANK_TRANSFER - SOLL.ankaufUeberweisung);

    // DSFinV-K fuehrt beide Ankaufzahlungen ebenfalls — und der Betrag MUSS
    // die Richtung tragen. Eine ANKAUF-Zahlung ist eine AUSzahlung: das Geld
    // verlaesst die Kasse, also steht sie NEGATIV in `datapayment.csv`. Die
    // Datei ist die Zahlartenaufstellung, aus der ein Pruefer je Zahlart
    // summiert; ohne Vorzeichen liest er eine Auszahlung als Einnahme.
    // (2026-07-26 gemessen: ohne Vorzeichen ergab Bar 76929 statt 26929 Cent.)
    //
    // ⚠️ 04.08.2026, ERNEUT GEMESSEN und ROT: der Betrag steht wieder mit
    // PLUS. Bar ueber alle Belege ergibt 76929 Cent statt −23071, also genau
    // die Zahl von damals. Der Weg ueber `lib/dsfinvk-export.ts` kehrte das
    // Vorzeichen um (`zahlungsBetrag`); der amtliche Erzeuger, der ihn am
    // 28.07.2026 abgeloest hat, schreibt in `lib/dsfinvk-daten.ts` nur noch
    // `betrag: betrag(p.amountEur)` und kennt die Richtung nicht mehr. Die
    // Zusage bleibt hier ABSICHTLICH stehen und ROT: sie beschreibt, was
    // richtig ist, und der Defekt gehoert in eine Aenderung an `src/`, nicht
    // in eine weichgemachte Erwartung.
    const alle = dsfinvkJeZahlart(false);
    const nurVerkauf = dsfinvkJeZahlart(true);
    expect((alle.get('CASH') ?? 0n) - (nurVerkauf.get('CASH') ?? 0n)).toBe(-SOLL.ankaufBar);
    expect((alle.get('BANK_TRANSFER') ?? 0n) - (nurVerkauf.get('BANK_TRANSFER') ?? 0n)).toBe(
      -SOLL.ankaufUeberweisung,
    );

    // Und die Probe, wofuer die Spalte da ist: Bar ueber ALLE Belege des Tages
    // ist genau die Tagesbewegung der Schublade, die auch DATEV auf 1000 fuehrt.
    // Von Hand: Verkaufsbar 3333 + 1999 + 4000 + 10700 + 10230 − 3333 (Storno)
    // = 26929, minus Barankauf 50000 = −23071 Cent = −230,71 EUR.
    expect(alle.get('CASH')).toBe(SOLL.kassenbewegung);
    expect(alle.get('CASH')).toBe(SOLL.verkaufJeZahlart.CASH - SOLL.ankaufBar);
    // Dieselbe Zahl traegt den Kassenbestand: 100000 Anfangsbestand − 23071.
    expect(SOLL.anfangsbestandBar + (alle.get('CASH') as bigint)).toBe(SOLL.kasseErwartet);

    // Ueberweisung ueber alle Belege: 185000 (B04) − 7777 (B11) = 177223,
    // dieselbe Zahl wie der Sollsaldo des Bankkontos 1200.
    expect(alle.get('BANK_TRANSFER')).toBe(
      SOLL.verkaufJeZahlart.BANK_TRANSFER - SOLL.ankaufUeberweisung,
    );

    // Der Kassenbericht weist den Ankauf als eigene Groesse aus.
    expect(zuCentAusBericht(berichtWert('Umsatz', 'Ankauf brutto vor Storno'))).toBe(
      SOLL.bruttoAnkauf,
    );
    expect(zuCentAusBericht(berichtWert('Umsatz', 'Ankauf netto vor Storno'))).toBe(SOLL.nettoAnkauf);
  });

  it('der Storno kehrt die Buchung um, statt einen negativen Umsatz zu schreiben', () => {
    const beleg = belegJeKurz.get('B12') as string;
    const zeilen = buchungen.filter((b) => b.beleg === beleg);
    expect(zeilen.length).toBe(1);
    const z = zeilen[0] as Buchung;

    // Betrag POSITIV, GLEICHE Seite wie das Original, Konten unveraendert —
    // das Minus traegt Feld 118 (Generalumkehr, DATEV Dok.-Nr. 1070379).
    expect(z.betrag).toBe(SOLL.stornoVerkauf);
    expect(z.sollHaben).toBe('S');
    expect(z.generalumkehr).toBe('1');
    expect(z.konto).toBe('1000');
    expect(z.gegenkonto).toBe('8400');
    // 19.08.2026: leer — 8400 ist Automatikkonto, siehe ERLOESKONTO oben.
    expect(z.buSchluessel).toBe('');
    expect(z.text.startsWith('STORNO VERKAUF')).toBe(true);

    // DSFinV-K traegt den Storno als eigene Bewegung mit negativem Betrag.
    //
    // ⚠️ Der Vorgangstyp ist „Beleg" und NICHT „Beleg-Storno". Zwei Gruende,
    // beide aus der Norm: „Beleg-Storno" gibt es in Anhang B gar nicht, dort
    // steht „AVBelegstorno" — und der ist fuer eine TSE-Kasse ausdruecklich
    // ausgeschlossen, weil jeder Beleg schon vor dem Storno signiert wurde.
    // Anhang B verlangt fuer die negative Darstellung woertlich den
    // Vorgangstyp „Beleg" mit umgekehrten Vorzeichen. Genau so schreibt es
    // dieses Haus: eine Gegenbuchung mit eigener Signatur.
    const kopf = tabelle('transactions.csv');
    const zeile = kopf.zeilen.find((r) => kopf.wert(r, 'BON_ID') === beleg);
    expect(zeile).toBeDefined();
    expect(kopf.wert(zeile as string[], 'BON_TYP')).toBe('Beleg');
    expect(zuCentDeutsch(kopf.wert(zeile as string[], 'UMS_BRUTTO'))).toBe(-SOLL.stornoVerkauf);

    // Der Bezug auf den Urbeleg steht in `references.csv` — Tz. 4.2.2 verlangt
    // ihn zwingend, sonst haengt der negative Beleg ohne Anker in der Luft.
    const verweise = tabelle('references.csv');
    const meiner = verweise.zeilen.filter((z) => verweise.wert(z, 'BON_ID') === beleg);
    expect(meiner.length).toBe(1);
    expect(verweise.wert(meiner[0] as string[], 'REF_BON_ID')).toBe(
      belegJeKurz.get('B01') as string,
    );

    // Der Kassenbericht weist den Betrag aus, nicht nur die Stueckzahl.
    expect(zuCentAusBericht(berichtWert('Umsatz', 'davon storniert'))).toBe(SOLL.stornoVerkauf);
    expect(zuCentAusBericht(berichtWert('Umsatz', 'Verkauf brutto vor Storno'))).toBe(
      SOLL.bruttoVerkaufVorStorno,
    );
    expect(zuCentAusBericht(berichtWert('Umsatz', 'Verkauf brutto nach Storno und Rücknahme'))).toBe(
      SOLL.bruttoVerkaufNachStorno,
    );
  });

  it('ein gemischter Beleg wird je Steuerbehandlung getrennt gebucht, nicht auf einen Satz gekippt', () => {
    // B06: 59,50 zu 19 Prozent und 700,00 steuerfreies Anlagegold, EINE Zahlart.
    const b06 = belegJeKurz.get('B06') as string;
    const zeilenB06 = buchungen.filter((b) => b.beleg === b06);
    expect(zeilenB06.length).toBe(2);
    const nachKonto = new Map(zeilenB06.map((z) => [z.gegenkonto, z]));
    expect(nachKonto.get('8400')?.betrag).toBe(5950n);
    expect(nachKonto.get('8165')?.betrag).toBe(70000n);
    // Beide Beine gehen auf dasselbe Geldkonto (SumUp 1362).
    expect(zeilenB06.every((z) => z.konto === '1362')).toBe(true);

    // B07: gemischt UND geteilt. Seit der § 25a-Aufteilung sind es DREI
    // Buchungsgruppen statt zwei, und damit 3 x 2 Zahlarten = 6 Zeilen.
    //
    // Von Hand, Beleg 214,00, bezahlt 107,00 bar und 107,00 per Stripe:
    //   7 %                  107,00                    → 8300
    //   § 25a Einkaufsanteil  60,00 (min(60,00; 107,00)) → 8193
    //   § 25a Marge           47,00 (der Rest)          → 8191
    // Jede Zahlung deckt genau die Haelfte, also je Zelle die Haelfte der
    // Spalte: 53,50 / 30,00 / 23,50. Zweimal gerechnet ergibt das die
    // Spaltenziele 107,00 / 60,00 / 47,00 ohne einen Cent Rest.
    const b07 = belegJeKurz.get('B07') as string;
    const zeilenB07 = buchungen.filter((b) => b.beleg === b07);
    expect(zeilenB07.length).toBe(6);
    expect(new Set(zeilenB07.map((z) => z.konto))).toEqual(new Set(['1000', '1364']));
    expect(new Set(zeilenB07.map((z) => z.gegenkonto))).toEqual(new Set(['8300', '8193', '8191']));
    for (const [konto, soll] of [
      ['8300', 10700n],
      ['8193', 6000n],
      ['8191', 4700n],
    ] as const) {
      const je = zeilenB07.filter((z) => z.gegenkonto === konto).reduce((s, z) => s + z.betrag, 0n);
      expect(`${konto}=${je}`).toBe(`${konto}=${soll}`);
      // Und je Zahlart die Haelfte: zwei Zeilen, beide gleich gross.
      const einzeln = zeilenB07.filter((z) => z.gegenkonto === konto).map((z) => z.betrag);
      expect(`${konto}=${einzeln.sort()}`).toBe(`${konto}=${[soll / 2n, soll / 2n]}`);
    }
    // Die Summe des Belegs bleibt unberuehrt: 10700 + 6000 + 4700 = 21400.
    expect(zeilenB07.reduce((s, z) => s + z.betrag, 0n)).toBe(21400n);

    // DSFinV-K teilt denselben Beleg nach USt-Schluessel auf — dort bleibt
    // § 25a EINE Gruppe, weil die Aufteilung eine reine Kontierungsfrage ist
    // und keine steuerliche: die Marge ist der Umsatz, nicht der Einkauf.
    const bonUst = tabelle('transactions_vat.csv');
    const zeilenUst = bonUst.zeilen.filter((z) => bonUst.wert(z, 'BON_ID') === b07);
    expect(zeilenUst.length).toBe(2);
    expect(new Set(zeilenUst.map((z) => bonUst.wert(z, 'UST_SCHLUESSEL')))).toEqual(
      new Set([UST_SCHLUESSEL.REDUCED_7 as string, UST_SCHLUESSEL.MARGIN_25A as string]),
    );
  });

  it('jeder Beleg gleicht sich in DSFinV-K selbst aus: Kopf gleich Summe seiner Positionen', () => {
    // Drei Dateien, drei Ebenen desselben Belegs:
    //   `transactions.csv`     der Kopf, aber NUR mit dem Brutto
    //   `transactions_vat.csv` je Beleg und Steuerschluessel: brutto/netto/ust
    //   `lines_vat.csv`        dasselbe je POSITION
    // Ein Beleg, der sich nicht selbst ausgleicht, faellt hier auf.
    const kopfBrutto = bruttoJeBeleg();
    const kopfSteuer = nettoUndUstJeBeleg();
    const posUst = tabelle('lines_vat.csv');

    const jeBeleg = new Map<string, { brutto: bigint; netto: bigint; ust: bigint }>();
    for (const zeile of posUst.zeilen) {
      const id = posUst.wert(zeile, 'BON_ID');
      const bisher = jeBeleg.get(id) ?? { brutto: 0n, netto: 0n, ust: 0n };
      jeBeleg.set(id, {
        brutto: bisher.brutto + zuCentDeutsch(posUst.wert(zeile, 'POS_BRUTTO')),
        netto: bisher.netto + zuCentDeutsch(posUst.wert(zeile, 'POS_NETTO')),
        ust: bisher.ust + zuCentDeutsch(posUst.wert(zeile, 'POS_UST')),
      });
    }

    expect(jeBeleg.size).toBe(SOLL.belege);
    expect(kopfBrutto.size).toBe(SOLL.belege);
    for (const [id, summe] of jeBeleg) {
      const kurz = kurzJeBeleg.get(id) ?? id;
      const steuer = kopfSteuer.get(id) as { netto: bigint; ust: bigint };
      expect(`${kurz} brutto=${kopfBrutto.get(id)}`).toBe(`${kurz} brutto=${summe.brutto}`);
      expect(`${kurz} netto=${steuer.netto}`).toBe(`${kurz} netto=${summe.netto}`);
      expect(`${kurz} ust=${steuer.ust}`).toBe(`${kurz} ust=${summe.ust}`);
      // Und die Bilanzgleichung des Belegs selbst.
      expect(`${kurz} summe=${steuer.netto + steuer.ust}`).toBe(`${kurz} summe=${summe.brutto}`);
    }
  });

  it('der Tagesumsatz nach Storno ist in allen drei Ausgaben dieselbe Zahl', () => {
    // 1. DATEV: die Summe aller Erloeskonten (§ 25a auf seinen zwei Konten).
    const zeilen = verkaufsBuchungen();
    const ausDatev = ALLE_ERLOESKONTEN.reduce((s, k) => s + habenSaldo(zeilen, k), 0n);

    // 2. DSFinV-K: die Summe der Verkaufsbelege im amtlichen Bonkopf.
    const kopfBrutto = bruttoJeBeleg();
    let ausDsfinvk = 0n;
    for (const [id, betrag] of kopfBrutto) if (verkaufsBelege.has(id)) ausDsfinvk += betrag;

    // 3. Kassenbericht: Verkauf brutto nach Storno — und, unabhaengig davon,
    //    die Summe der Zahlungsarten.
    const ausBericht = zuCentAusBericht(berichtWert('Umsatz', 'Verkauf brutto nach Storno und Rücknahme'));
    const ausBerichtZahlarten = zuCentAusBericht(berichtWert('Zahlungsart', 'Summe'));

    expect(ausDatev).toBe(SOLL.bruttoVerkaufNachStorno);
    expect(ausDsfinvk).toBe(SOLL.bruttoVerkaufNachStorno);
    expect(ausBericht).toBe(SOLL.bruttoVerkaufNachStorno);
    expect(ausBerichtZahlarten).toBe(SOLL.bruttoVerkaufNachStorno);

    // ── Und der KOPF des Buendels rechnet auf DERSELBEN Grundlage ──────────
    //
    // 26.07.2026 GEMESSEN: `cashpointclosing.csv` trug GESAMT_BRUTTO_VERKAUF
    // 379157 Cent, waehrend die Verkaufszeilen in `bon_kopf.csv` DESSELBEN ZIP
    // 375824 ergaben. Die Differenz war genau der Storno B12 ueber 3333 Cent.
    // Ein Pruefer rechnet als ERSTES die Einzelbewegungen gegen die Tagessumme;
    // diese Querrechnung ging nicht auf.
    //
    // DSFinV-K fuehrt eine Stornierung als EIGENE Bewegung mit negativem
    // Betrag (UMS_BRUTTO −33,33), nicht als Loeschung. Jede Summe ueber die
    // Einzelbewegungen traegt den Storno damit schon mit umgekehrtem
    // Vorzeichen — also muss ihn die Tagessumme desselben Abschlusses
    // ebenfalls tragen. Der Kopf gehoert NACH Storno.
    //
    // ⚠️ Gelesen wird jetzt `businesscases.csv`. Die frueher gelesenen Spalten
    // GESAMT_BRUTTO_VERKAUF und GESAMT_NETTO_VERKAUF standen in einer selbst
    // getippten Kopfzeile, die die Taxonomie nicht kennt; der amtliche
    // `cashpointclosing.csv` traegt sie nicht. Die Tagessummen je
    // Geschaeftsvorfall und Steuerschluessel gehoeren nach `businesscases.csv`.
    // ⚠️ 06.08.2026: `businesscases.csv` traegt seit heute BEIDE Richtungen.
    // Vorher entstand die Datei aus `closing.vatByTreatment` mit dem festen
    // Typ „Umsatz" und kannte den Ankauf nicht; ein Ankauf ueber 577,77 EUR
    // stand in KEINER Tagessumme, war aber in `transactions.csv` sichtbar.
    // Die Gesamtsumme ist deshalb jetzt Verkauf MINUS Ankauf, und die
    // Verkaufsseite wird ueber den Geschaeftsvorfalltyp herausgetrennt.
    const summen = tagessummen();
    const gesamtBrutto = summen.brutto;
    expect(gesamtBrutto).toBe(SOLL.bruttoVerkaufNachStorno - SOLL.bruttoAnkauf);
    // Und die Verkaufsseite allein ist unveraendert die Zahl von vorher.
    expect(summen.bruttoVerkauf).toBe(SOLL.bruttoVerkaufNachStorno);
    expect(summen.bruttoVerkauf).toBe(ausDsfinvk);
    expect(SOLL.bruttoVerkaufVorStorno - SOLL.stornoVerkauf).toBe(summen.bruttoVerkauf);

    // Und die Zahlungsseite desselben Abschlusskopfes: Z_SE_ZAHLUNGEN ist die
    // Summe aller Zahlungen des Tages, Z_SE_BARZAHLUNGEN nur die baren.
    const abschluss = tabelle('cashpointclosing.csv');
    const kopfzeile = abschluss.zeilen[0] as string[];
    expect(zuCentDeutsch(abschluss.wert(kopfzeile, 'Z_SE_ZAHLUNGEN'))).toBe(gesamtBrutto);
    // ⚠️ 06.08.2026: alte Zusage war `SOLL.verkaufJeZahlart.CASH` (26929n),
    // aus der Zeit, in der `Z_SE_BARZAHLUNGEN` nur die Verkaufsseite kannte.
    // Seit `dsfinvk-daten.ts` jede Zahlung nach ihrer Richtung vorzeichnet
    // (`nachRichtung`), summiert `Z_SE_BARZAHLUNGEN` ALLE Barzahlungen des
    // Tages, Verkauf UND Ankauf. Von Hand: Barverkauf nach Storno 26929,
    // minus Barankauf B10 50000 ist −23071, dieselbe Zahl wie
    // `SOLL.kassenbewegung` und wie der Sollsaldo des Kontos 1000 in DATEV.
    expect(zuCentDeutsch(abschluss.wert(kopfzeile, 'Z_SE_BARZAHLUNGEN'))).toBe(
      SOLL.kassenbewegung,
    );

    // ⚠️ 06.08.2026, VIERTER FUND, VOM DRITTEN VERDECKT: dieselbe Verwechslung
    // wie oben bei `gesamtBrutto`, nur auf der Nettoseite, und beim ersten
    // Testlauf UNSICHTBAR, weil derselbe it-Block beim vorigen, damals noch
    // roten `Z_SE_BARZAHLUNGEN`-Treffer abbrach; was danach steht, lief nie
    // mit. Erst nach dessen Behebung wurde dieser zweite Treffer im selben
    // Block sichtbar.
    //
    // Alte Zusage: `gesamtNetto` war `summen.netto`, verglichen mit
    // `SOLL.nettoVerkaufNachStorno` (366260n). Seit `businesscases.csv` beide
    // Richtungen traegt, ist `summen.netto` aber die Bewegung ueber ALLE
    // Geschaeftsvorfaelle, Verkauf UND Ankauf, genau die Verwechslung, vor der
    // `tagessummen()` oben ausdruecklich warnt. Von Hand: 366260 (Verkauf
    // netto nach Storno) minus 57777 (Ankauf netto) ist 308483.
    const gesamtNetto = summen.netto;
    expect(gesamtNetto).toBe(SOLL.nettoVerkaufNachStorno - SOLL.nettoAnkauf);
    expect(zuCentAusBericht(berichtWert('Umsatz', 'Verkauf netto vor Storno'))).toBe(
      SOLL.nettoVerkauf,
    );
    // Und seit dem 26.07.2026 steht daneben die Zahl, die zum Kopf des
    // DSFinV-K-Buendels und zu DATEV passt: dieselbe Grundlage, dieselbe Zahl.
    expect(zuCentAusBericht(berichtWert('Umsatz', 'Verkauf netto nach Storno'))).toBe(
      SOLL.nettoVerkaufNachStorno,
    );
    // Die Probe, dass die Verkaufsseite ALLEIN nur den Storno traegt und
    // keinen Ankaufsanteil: 369061 minus 2801 ist 366260. Dafuer wird bewusst
    // `summen.nettoVerkauf` genommen, nicht das kombinierte `gesamtNetto` von
    // oben, sonst waere der Abstand hier 60578 (Storno 2801 plus Ankauf
    // 57777) statt der reinen 2801, und die Probe wuerde zwei verschiedene
    // Ursachen in einer Zahl vermischen.
    expect(SOLL.nettoVerkauf - summen.nettoVerkauf).toBe(SOLL.stornoVerkaufNetto);

    // Die Probe, die den ganzen Kopf zusammenhaelt: Brutto minus Netto ist die
    // Umsatzsteuer des Tages NACH Storno. Von Hand: 3800 + 1111 + 4653 + 0
    // = 9564 Cent, und 375824 − 366260 = 9564. Stuende eine Seite vor und die
    // andere nach Storno, kaeme hier 6763 oder 10096 heraus. (Die Zahl steht
    // hier absichtlich fuer sich, damit diese Probe nicht davon abhaengt,
    // welche Grundlage `vat_by_treatment` des Abschlusses gerade waehlt.)
    const ustNachStorno = 9564n;
    expect(gesamtBrutto - gesamtNetto).toBe(ustNachStorno);
    // Und dieselbe Zahl steht ausdruecklich in der Steuerspalte, nicht nur
    // als Differenz — sonst koennte sich ein Fehler in beiden Summen kuerzen.
    expect(summen.ust).toBe(ustNachStorno);
    expect(summen.ust).toBe(SOLL.ustGesamt);

    // ⚠️ 06.08.2026, FUENFTER FUND, EBENFALLS VOM DRITTEN VERDECKT: alte
    // Zusage war `SOLL.bruttoAnkauf` (57777n, positiv), aus der Zeit, in der
    // UMS_BRUTTO in `transactions.csv` fuer jeden Beleg positiv stand. Seit
    // `dsfinvk-daten.ts` den Kopf nach Richtung vorzeichnet
    // (`umsatzBrutto: nachRichtung(r.direction, ...)`), stehen B10 und B11
    // dort NEGATIV: 50000 + 7777 ist 57777, mit Minus −57777. Die
    // Ankaufseite bleibt an diesem Tag ohne Storno unveraendert dem Betrag
    // nach, nur das Vorzeichen kommt seit heute dazu, und deckungsgleich
    // bleibt es mit den beiden Ankaufbelegen im selben Buendel.
    let ausDsfinvkAnkauf = 0n;
    for (const [id, betrag] of kopfBrutto) if (!verkaufsBelege.has(id)) ausDsfinvkAnkauf += betrag;
    expect(ausDsfinvkAnkauf).toBe(-SOLL.bruttoAnkauf);
  });

  /**
   * GEGENPROBE zur Kopf-Behebung vom 26.07.2026 — die NETTO-Seite.
   *
   * Warum eine eigene Zusage: im Kopf stehen Brutto und Netto zwar
   * nebeneinander, sie kommen aber aus ZWEI verschiedenen Quellen.
   * `GESAMT_BRUTTO_VERKAUF` rechnet aus den Spalten der Wanderung 0112
   * (`gross_verkauf_eur` − `storno_verkauf_eur`), `GESAMT_NETTO_VERKAUF`
   * dagegen aus `net_verkauf_eur` minus einem Nettoanteil, den 0112 NICHT
   * als Spalte angelegt hat und der deshalb aus den Belegzeilen gelesen wird.
   * Ein Vorzeichenfehler, ein vergessener Beleg oder ein versehentlich
   * gelesenes `vatEur` faellt hier auf — und nur hier, denn die obige Zusage
   * vergleicht Netto gegen eine Handzahl, nicht gegen die Belege.
   *
   * Von Hand aus `bon_kopf.csv`, Spalte BON_GESAMT_NETTO, in ganzen Cent:
   *   VERKAUF  2801 + 1868 + 23303 + 185000 + 10000 + 75000 + 19950 + 1
   *            + 42138 + 9000 = 369061, dazu die Stornozeile B12 mit −2801
   *                                                          = 366260
   *   ANKAUF   50000 + 7777                                  =  57777
   * Dieselben Zahlen muessen im Kopf desselben ZIP stehen.
   */
  it('auch das NETTO des Kopfes ist die Summe der Belegzeilen desselben Buendels', () => {
    const steuerJeBeleg = nettoUndUstJeBeleg();

    const nettoAusBelegen = (verkauf: boolean): bigint => {
      let summe = 0n;
      for (const [id, wert] of steuerJeBeleg) {
        if (verkaufsBelege.has(id) === verkauf) summe += wert.netto;
      }
      return summe;
    };

    // 369061 − 2801 = 366260
    expect(nettoAusBelegen(true)).toBe(SOLL.nettoVerkaufNachStorno);
    // ⚠️ 06.08.2026: die Tagessumme traegt jetzt beide Richtungen, also wird
    // die Verkaufsseite herausgetrennt. Siehe die Begruendung oben.
    expect(tagessummen().nettoVerkauf).toBe(nettoAusBelegen(true));
    expect(tagessummen().netto).toBe(nettoAusBelegen(true) - SOLL.nettoAnkauf);

    // 50000 + 7777 = 57777, an diesem Tag ohne Ankaufstorno.
    //
    // ⚠️ 06.08.2026: alte Zusage war `SOLL.nettoAnkauf` (57777n, positiv). Die
    // Begruendung stand hier frueher so: gegen den Kopf des Buendels liesse
    // sich die Zahl NICHT pruefen, weil `businesscases.csv` damals nur den
    // Geschaeftsvorfalltyp „Umsatz" kannte und der Ankauf in keiner Tagessumme
    // stand. Beides stimmt nicht mehr.
    //
    // Seit `dsfinvk-daten.ts` die Richtung durchgaengig traegt (`nachRichtung`
    // in `belegUst`), steht das BON_NETTO der beiden Ankaufbelege B10 und B11
    // in `transactions_vat.csv` NEGATIV, also −57777. Und `businesscases.csv`
    // kennt den Ankauf seit heute auch: die Zeile direkt darueber
    // (`tagessummen().netto`) zieht genau denselben `SOLL.nettoAnkauf` von der
    // Verkaufsseite ab. Die neue Zusage ist deshalb `-SOLL.nettoAnkauf`.
    expect(nettoAusBelegen(false)).toBe(-SOLL.nettoAnkauf);

    // Und die Randfaelle desselben Tages, die durch dieselbe Rechnung laufen:
    // der KLEINSTE Beleg B08 (1 Cent brutto, 1 Cent netto, 0 USt) und der
    // NEGATIVE Beleg B12 (−3333 / −2801) stehen in den Belegzeilen, nicht
    // daneben.
    expect(steuerJeBeleg.get(belegJeKurz.get('B08') as string)?.netto).toBe(1n);
    expect(steuerJeBeleg.get(belegJeKurz.get('B12') as string)?.netto).toBe(-2801n);
  });

  it('krumme Betraege ueberstehen alle drei Wege ohne einen verlorenen Cent', () => {
    const kopf = tabelle('transactions.csv');
    const geschriebenJeBeleg = new Map(
      kopf.zeilen.map((z) => [kopf.wert(z, 'BON_ID'), kopf.wert(z, 'UMS_BRUTTO')]),
    );

    // 33,33 · 19,99 · 0,01 · 444,44 · 77,77 — jeder Betrag wortgleich in
    // DSFinV-K und als Summe seiner DATEV-Zeilen wieder. Die Norm schreibt
    // den Betrag deutsch mit Komma, nicht mit Punkt.
    const proben: readonly (readonly [string, string, bigint])[] = [
      ['B01', '33,33', 3333n],
      ['B02', '19,99', 1999n],
      ['B08', '0,01', 1n],
      ['B09', '444,44', 44444n],
      // ⚠️ B11 ist ein ANKAUF. Seit dem 06.08.2026 traegt er in DSFinV-K
      // durchgaengig ein Minus: Geld verlaesst die Kasse. Vorher stand im
      // Belegkopf ein Plus und in der Zahlungszeile ein Minus, und die
      // Querrechnung je Beleg brach an jedem einzelnen Ankauf.
      ['B11', '-77,77', 7777n],
    ];
    for (const [kurz, geschrieben, cent] of proben) {
      const beleg = belegJeKurz.get(kurz) as string;
      expect(`${kurz}=${geschriebenJeBeleg.get(beleg)}`).toBe(`${kurz}=${geschrieben}`);
      const ausDatev = buchungen
        .filter((b) => b.beleg === beleg)
        .reduce((s, b) => s + b.betrag, 0n);
      expect(`${kurz}=${ausDatev}`).toBe(`${kurz}=${cent}`);
    }

    // Und die Gesamtprobe: die Summe ALLER Belegbetraege der DSFinV-K-Koepfe.
    //
    // ⚠️ 06.08.2026: alte Zusage war `SOLL.bruttoVerkaufNachStorno +
    // SOLL.bruttoAnkauf` (433601n), aus der Zeit, in der UMS_BRUTTO in
    // `transactions.csv` fuer jeden Beleg positiv stand, gleich welche
    // Richtung. Seit `dsfinvk-daten.ts` den Kopf ebenfalls vorzeichnet
    // (`umsatzBrutto: nachRichtung(r.direction, ...)`), tragen B10 und B11
    // dort ein Minus, und die Summe ALLER Koepfe wird Verkauf MINUS Ankauf:
    // 375824 (Verkauf nach Storno) minus 57777 (Ankauf) ist 318047.
    //
    // Dieselbe Zahl liefert unabhaengig davon `tagessummen().brutto` aus
    // `businesscases.csv` (siehe `gesamtBrutto` oben in diesem Testlauf), also
    // stuetzen sich zwei Dateien desselben Buendels gegenseitig.
    let summeKoepfe = 0n;
    for (const betrag of bruttoJeBeleg().values()) summeKoepfe += betrag;
    expect(summeKoepfe).toBe(SOLL.bruttoVerkaufNachStorno - SOLL.bruttoAnkauf);
  });

  it('die TSE-Zaehlung des Abschlusses deckt sich mit den Zeilen in transactions_tse.csv', () => {
    // ⚠️ NICHT `tse.csv`. Die amtliche `tse.csv` fuehrt die Sicherungs-
    // einrichtungen selbst (Seriennummer, Algorithmus, Zertifikat); die
    // Signatur JE BELEG steht in `transactions_tse.csv`, und nur dort gibt es
    // ueberhaupt eine Spalte BON_ID.
    const tse = tabelle('transactions_tse.csv');
    expect(berichtWert('TSE', 'Signiert')).toBe(String(SOLL.tseSigniert));
    expect(berichtWert('TSE', 'Ausstehend')).toBe(String(SOLL.tseOffen));
    expect(SOLL.tseSigniert + SOLL.tseOffen).toBe(SOLL.belege);

    /**
     * ⛔ 08.08.2026 — DIESE PRUEFUNG STAND UMGEKEHRT UND HIELT DEN FEHLER FEST.
     *
     * Sie verlangte, dass die beiden unsignierten Belege GAR KEINE Zeile
     * haben. Das war der Defekt, in einer Pruefung festgeschrieben: fiel die
     * TSE aus, verschwanden die betroffenen Belege lautlos aus dem Auszug,
     * und der sah dann aus wie ein Tag, an dem jeder Beleg sauber signiert
     * wurde. Nicht falsch, sondern still.
     *
     * Jetzt hat JEDER Beleg eine Zeile. Die unsignierten tragen leere
     * Signaturfelder und den Ausfallvermerk in TSE_TA_FEHLER.
     */
    expect(tse.zeilen.length).toBe(SOLL.belege);

    const zeileJeBon = new Map(tse.zeilen.map((z) => [tse.wert(z, 'BON_ID'), z]));
    for (const kurz of ['B08', 'B11'] as const) {
      const zeile = zeileJeBon.get(belegJeKurz.get(kurz) as string);
      expect(zeile, `${kurz} fehlt in transactions_tse.csv`).toBeDefined();
      // Nichts erfunden: kein Signaturzaehler, keine Transaktionsnummer.
      expect(tse.wert(zeile as string[], 'TSE_TA_SIG')).toBe('');
      expect(tse.wert(zeile as string[], 'TSE_TA_SIGZ')).toBe('');
      expect(tse.wert(zeile as string[], 'TSE_TANR')).toBe('');
      // Und der Grund steht daneben, statt dass die Zeile schweigt.
      expect(tse.wert(zeile as string[], 'TSE_TA_FEHLER')).toBe(TSE_AUSFALL_VERMERK);
    }

    const signiert = zeileJeBon.get(belegJeKurz.get('B01') as string);
    expect(signiert).toBeDefined();
    expect(tse.wert(signiert as string[], 'TSE_TA_SIG')).not.toBe('');
    expect(tse.wert(signiert as string[], 'TSE_TA_FEHLER')).toBe('');
  });

  it('alle drei Ausgaben schreiben denselben Berliner Geschaeftstag', () => {
    // DATEV: Belegdatum ist vierstellig TTMM, das Jahr steht im Kopf.
    for (const b of buchungen) {
      expect(b.belegdatum).toBe('1901');
    }
    expect(datevKopf).toContain(';20260119;20260119;');

    // DSFinV-K: Buchungstag und Z-Nummer.
    const abschluss = tabelle('cashpointclosing.csv');
    const zeile = abschluss.zeilen[0] as string[];
    expect(abschluss.wert(zeile, 'Z_BUCHUNGSTAG')).toBe(TAG);
    // ⚠️ Z_NR ist NICHT das Datum. Bis zur Wanderung 0124 stand hier der
    // Geschaeftstag, und das war falsch: Z_NR ist die FORTLAUFENDE Nummer des
    // Kassenabschlusses je Kasse, und jede andere Datei des Buendels zeigt
    // darauf. Ein Datum an dieser Stelle verbirgt eine Luecke in der Folge —
    // ein Pruefer sieht dann nicht, dass Abschlusstage fehlen. Diese Buehne
    // schliesst genau EINEN Tag ab, also ist es die Eins.
    expect(abschluss.wert(zeile, 'Z_NR')).toBe('1');
    /**
     * ⚠️ ENTSCHIEDEN AM 06.08.2026: `cash_per_currency.csv` traegt die
     * BARZAHLUNGEN je Waehrung, nicht den gezaehlten Bestand.
     *
     * Hier stand der gezaehlte Bestand, und die Frage war offen. Beide
     * Lesarten liessen sich vertreten:
     *
     *   FUER den Bestand spricht der Wortlaut der Norm zu dieser Datei,
     *   in `docs/fiskal/recherche/pruefer-und-kassenbericht.md` Nr. 14
     *   zitiert: „Damit stellt diese Datei eine jederzeitige
     *   Kassensturzfaehigkeit her."
     *
     *   FUER die Barzahlungen spricht, wo die Datei STEHT und wie ihr Feld
     *   HEISST: `Z_Waehrungen` folgt in der Taxonomie unmittelbar auf
     *   `Z_Zahlart` (`payment.csv`), und die Spalte ist
     *   `ZAHLART_BETRAG_WAEH` — ein Betrag je ZAHLART und Waehrung, kein
     *   Bestand. Die Kassensturzfaehigkeit folgt daraus: Anfangsbestand plus
     *   die Barbewegungen je Waehrung ergeben, was in der Lade liegen muss.
     *
     * Den Ausschlag gab eine Messung vom 05.08.2026: mit dem Bestand nannte
     * EIN Paket DREI Zahlen fuer die Barsumme desselben Tages
     * (`Z_SE_BARZAHLUNGEN` 200,00 · `payment.csv` 200,00 · Summe
     * `datapayment.csv` −100,00 · `cash_per_currency.csv` 350,00). Ein
     * Pruefer stellt genau diese gegeneinander.
     *
     * Der gezaehlte Bestand steht weiterhin im Kassenbericht. Er gehoert als
     * eigener Geschaeftsvorfall `DifferenzSollIst` ins Paket (Anhang C); der
     * fehlt noch, und solange der Anfangsbestand der Lade nicht sauber
     * gefuehrt wird, ist keine Zeile besser als eine erfundene.
     */
    const bestand = tabelle('cash_per_currency.csv');
    const bestandZeile = bestand.zeilen[0] as string[];
    expect(bestand.wert(bestandZeile, 'ZAHLART_WAEH')).toBe('EUR');
    expect(zuCentDeutsch(bestand.wert(bestandZeile, 'ZAHLART_BETRAG_WAEH'))).toBe(
      SOLL.kassenbewegung,
    );
    // Und die Kassensturzfaehigkeit bleibt: Anfangsbestand plus Bewegung
    // ergibt den erwarteten Bestand, dieselbe Zahl wie zuvor.
    expect(SOLL.anfangsbestandBar + SOLL.kassenbewegung).toBe(SOLL.kasseErwartet);

    // Kassenbericht: deutsches Datum, abgeschlossen.
    expect(bericht[0]?.[1]).toBe('19.01.2026');
    expect(berichtWert('Abschluss', 'Status')).toBe('abgeschlossen');

    /**
     * ⚠️ DIE ALTE ZUSAGE UND DIE NEUE (07.08.2026)
     *
     * Bis heute stand hier:
     *   Kasse;Erwartet bar    = SOLL.kasseErwartet (76929)
     *   Kasse;Differenz       = 0
     *
     * `Kasse` trug damals nur die drei Endzahlen und LAS `cashExpectedEur`
     * direkt durch — deshalb traf die alte Zusage. Seit `baueKassenrechnung`
     * (`lib/kassenrechnung.ts`) angeschlossen ist, RECHNET der Abschnitt den
     * erwarteten Bestand selbst aus Anfangsbestand + Bareinnahmen − Barankauf
     * ± Bewegungen her, und genau DABEI zeigt sich ein echter, gemessener
     * Befund:
     *
     * Diese Bühne setzt die Schicht per Hand-SQL (Zeile ~811 oben) — mit
     * `opening_float_eur = 1000.00`, aber OHNE eine `cash_movements`-Zeile.
     * Geprüft: KEIN Schreibpfad im ganzen Haus fügt beim Öffnen einer Schicht
     * je eine `OPENING_FLOAT`-Bewegung ein (`POST /api/shifts/open` schreibt
     * nur die Spalte `shifts.opening_float_eur`). Die Rechnung sieht den
     * ⚠️ 06.08.2026, ZWEITE FASSUNG. Die erste las den Anfangsbestand nur aus
     * `cash_movements` und bekam 0, weil dort NIE eine `OPENING_FLOAT`-Zeile
     * entsteht: `POST /api/shifts/open` schreibt den Betrag allein auf
     * `shifts.opening_float_eur`. Das Blatt wies dadurch eine Abweichung von
     * 1.000,00 EUR aus, die es gar nicht gab — der Händler hätte Geld gesucht,
     * das nie gefehlt hat.
     *
     * Der Bericht liest den Anfangsbestand jetzt dort, wo er WIRKLICH steht.
     * Jede Zahl unten ist von Hand nachgerechnet.
     */
    expect(zuCentAusBericht(berichtWert('Kasse', 'Anfangsbestand (Wechselgeld)'))).toBe(
      SOLL.anfangsbestandBar,
    );
    // 1.000,00 Anfang + 269,29 bar ein − 500,00 Barankauf = 769,29, und das
    // ist genau die beim Abschluss festgeschriebene Zahl. Keine Abweichung.
    expect(zuCentAusBericht(berichtWert('Kasse', 'Erwarteter Endbestand'))).toBe(
      SOLL.anfangsbestandBar + SOLL.verkaufJeZahlart.CASH - SOLL.ankaufBar,
    );
    expect(zuCentAusBericht(berichtWert('Kasse', 'Bareinnahmen'))).toBe(SOLL.verkaufJeZahlart.CASH);
    expect(zuCentAusBericht(berichtWert('Kasse', 'Barauszahlung Ankauf'))).toBe(-SOLL.ankaufBar);
    // 100.000 + 26.929 − 50.000 = 76.929 Cent, dieselbe Zahl wie der gezählte
    // Bestand und wie die beim Abschluss festgeschriebene.
    expect(zuCentAusBericht(berichtWert('Kasse', 'Gezählter Endbestand'))).toBe(SOLL.kasseErwartet);
    expect(zuCentAusBericht(berichtWert('Kasse', 'Differenz'))).toBe(0n);
    // ⛔ UND KEINE Gegenprobe-Zeile: Rechnung und festgeschriebene Zahl stimmen
    // überein. Stünde sie da, wäre das eine Abweichung, die niemand erklärt hat.
    // `berichtWert` wirft, wenn die Zeile fehlt — hier ist das FEHLEN der
    // Beweis, also wird auf dem rohen Bericht gesucht.
    const kassenzeilen = bericht.filter((z) => z[0] === 'Kasse').map((z) => z[1]);
    expect(kassenzeilen).not.toContain('Beim Abschluss festgeschrieben');
    expect(kassenzeilen).not.toContain('Abweichung zur Rechnung oben');
  });

  it('jede Position traegt genau ein Stueck und ihre eigene Steuerbehandlung', () => {
    // Ein Posten ist ein Einzelstueck — es gibt keine Menge groesser eins.
    const bonPos = tabelle('lines.csv');
    // Von Hand gezaehlt: 10 einzeilige Belege + DREI gemischte (B06, B07, B13)
    // mit je zwei Positionen = 10 + 6 = 16.
    expect(bonPos.zeilen.length).toBe(16);
    for (const zeile of bonPos.zeilen) {
      // Deutsche Schreibweise mit Komma, wie die ganze Datei.
      expect(bonPos.wert(zeile, 'MENGE')).toBe('1,000');
    }

    // Und die Richtung steht auf JEDER Position, nicht nur im Kopf.
    //
    // ⚠️ Der ANKAUF heisst „Auszahlung" und NICHT „Einkauf". „Einkauf" kommt
    // im ganzen Normtext null Mal als Geschaeftsvorfalltyp vor; Anhang C ist
    // eine geschlossene Liste, und ein Wert daneben laesst ein Pruefwerkzeug
    // den Datentraeger zurueckweisen. Welcher Wert der Liste gilt, ist eine
    // steuerliche Auslegung und gehoert dem Steuerberater — sie steht deshalb
    // in der Einstellung `dsfinvk.gv_typ.ankauf`, die die Buehne saet.
    for (const zeile of bonPos.zeilen) {
      const beleg = bonPos.wert(zeile, 'BON_ID');
      const richtung = richtungJeBeleg.get(beleg);
      const erwartet = richtung === 'ANKAUF' ? 'Auszahlung' : 'Umsatz';
      expect(`${beleg}:${bonPos.wert(zeile, 'GV_TYP')}`).toBe(`${beleg}:${erwartet}`);
    }

    // Die Ware steht mit Namen da, nicht als Kennung.
    const namen = new Set(bonPos.zeilen.map((z) => bonPos.wert(z, 'ARTIKELTEXT')));
    expect(namen.has('Krugerrand 1oz')).toBe(true);
    expect(namen.has('Konvolut Silberbesteck')).toBe(true);
  });
});
