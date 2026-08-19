/**
 * Der Kontenrahmen als EINSTELLUNG — und die Zahl, die sich nicht als sicher
 * ausgibt.
 *
 * ── WARUM ES DIESE DATEI GIBT (26.07.2026) ─────────────────────────────────
 * Bis heute standen 1000, 1200, 1361 ff., 3200, 8150, 8200, 8300 und 8400 als
 * feste Zeichenketten in `datev-kontierung.ts` und `closing-export.ts`. Damit
 * war der Laden auf SKR03 festgenagelt: führt der Steuerberater den Mandanten
 * in SKR04, ist jede einzelne Zahl falsch, und keine davon lässt sich ohne
 * neue Programmfassung ändern.
 *
 * Hier stehen deshalb LOGISCHE Konten — `kasse`, `wareneingang`,
 * `erloeseStandard19` — deren Nummer aus einer Vorlage kommt und die der
 * Inhaber aus der App heraus einzeln überschreiben kann.
 *
 * ── DIE HALTUNG, und sie ist der eigentliche Punkt ─────────────────────────
 * Eine Kontonummer, die dieses Haus vorschlägt, ist ein VORSCHLAG. Sie kommt
 * aus einer Recherche, nicht aus dem Bestand des Steuerberaters, und in
 * dessen Bestand entscheidet sich, ob sie stimmt. Eine falsche Nummer lädt
 * den Stapel auf ein fremdes Erlöskonto — das fällt beim Jahresabschluss auf,
 * nicht beim Export.
 *
 * Deshalb trägt JEDES Konto sein Merkmal mit sich:
 *   • `VORSCHLAG`   — der Wert stammt aus der Vorlage hier. Niemand hat ihn
 *                     bestätigt. Die Oberfläche sagt das dem Inhaber.
 *   • `BESTAETIGT`  — der Inhaber hat den Wert gespeichert. Damit gilt er als
 *                     bestätigt, weil ein Mensch ihn angefasst hat.
 * Nichts gibt vor, verbindlich zu sein, was es nicht ist. Das ist genau die
 * Fehlerklasse, die in diesem Haus schon mehrfach zugeschlagen hat: still
 * etwas erfinden, wo nichts eingerichtet ist.
 *
 * ── HERKUNFT JEDER ZAHL ────────────────────────────────────────────────────
 * SKR03 ist WÖRTLICH der Stand, der bis zum 26.07.2026 im Quelltext lief. Er
 * ist in Vorarbeit recherchiert (siehe `docs/fiskal/recherche/beraterpraxis.md`)
 * und wird hier NICHT verändert — sonst wanderte eine stille Änderung in die
 * laufende Buchführung.
 *
 * SKR04 ist neu. Zu jeder Zahl steht unten in `QUELLE` wörtlich, woher sie
 * stammt, oder ausdrücklich, dass sie unbelegt ist. Geraten wurde nichts
 * stillschweigend.
 */

import { sql } from 'drizzle-orm';

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

// ── Die zwei Rahmen ────────────────────────────────────────────────────────

export const KONTENRAHMEN = ['SKR03', 'SKR04'] as const;
export type KontenrahmenId = (typeof KONTENRAHMEN)[number];

/**
 * Ein unbrauchbarer Wert ist ein Eingabefehler des Bedieners, kein
 * Serverfehler. 400, damit die Oberfläche die deutsche Meldung zeigen kann
 * statt „500".
 */
export class DatevEinstellungError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

/** Ein Kontenrahmen, den es nicht gibt. */
export class KontenrahmenUnbekanntError extends DatevEinstellungError {}

/**
 * `SKR03`, `skr04`, `03`, `4` → `'SKR03' | 'SKR04'`.
 *
 * Wirft eine deutsche Meldung statt eines 500. Der Kopf des Buchungsstapels
 * trägt in Feld 27 nur `03` oder `04`; alles andere lehnt DATEV beim Import
 * ab, und zwar erst beim Steuerberater.
 */
export function normalisiereRahmen(wert: unknown): KontenrahmenId {
  const roh = String(wert ?? '').trim();
  const ziffern = roh.replace(/^skr/i, '').padStart(2, '0');
  if (ziffern === '03') return 'SKR03';
  if (ziffern === '04') return 'SKR04';
  throw new KontenrahmenUnbekanntError(
    `Der Kontenrahmen „${roh}" ist nicht bekannt. Möglich sind SKR03 und SKR04. ` +
      'Welchen Ihr Steuerberater führt, steht in seinem Mandantenstamm.',
  );
}

// ── Die logischen Konten ───────────────────────────────────────────────────

/**
 * Ein logisches Konto: der ZWECK, nicht die Nummer.
 *
 * `schluesselTeil` ist Kleinschrift mit Unterstrich, weil der Schlüssel in
 * `system_settings` das Muster `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$` einhalten
 * muss (Bedingung `system_settings_key_format`, Wanderung 0011).
 */
export interface KontoDefinition {
  readonly id: KontoId;
  readonly schluesselTeil: string;
  /** Was der Inhaber in der App liest. Deutsch, kein Rohbezeichner. */
  readonly label: string;
  /** Wofür das Konto im Export steht — eine Zeile für den Steuerberater. */
  readonly zweck: string;
}

export type KontoId =
  | 'kasse'
  | 'bank'
  | 'geldtransitKarte'
  | 'geldtransitSumUp'
  | 'geldtransitMollie'
  | 'geldtransitStripe'
  | 'geldtransitStripeTerminal'
  | 'geldtransitEbay'
  // 06.08.2026: der Weg zwischen Lade und Bank oder Tresor. Bis heute gab es
  // ihn nicht, und eine Bankabschöpfung erzeugte deshalb GAR KEINE
  // Buchungszeile — Konto 1000 bewegte sich in der Buchhaltung anders als die
  // Schublade im Laden.
  | 'geldtransit'
  // 12.08.2026: die Verbindlichkeit aus ausgegebenen Mehrzweck-Gutscheinen.
  // Bis heute gab es KEIN Konto — eine Zahlung per Gutschein brach die ganze
  // DATEV-Datei des Tages ab (ZahlartNichtKontiertError, Befund vom
  // 05.08.2026). Amtlich geprueft am 12.08.2026 gegen die offiziellen
  // Kontenrahmen 2025: SKR03 1796 / SKR04 3786 "Ausgegebene
  // Geschenkgutscheine", beide OHNE Automatikfunktion (DATEV-Buchungsbeispiel
  // Dok. 5305720). ⚠️ Das zunaechst angedachte SKR04-Konto 3270 war ein
  // AUTOMATIKKONTO (AM 16 % USt) und haette selbsttaetig Steuer gerechnet.
  | 'gutscheinMehrzweck'
  // ── 06.08.2026: die Aufwandskonten der Betriebsausgaben ────────────────
  //
  // Bis heute gab es KEINES. Eine bar bezahlte Betriebsausgabe konnte deshalb
  // in gar keine Buchungszeile münden, und der Export wies sie ab. Basel hat
  // die Zahlen ausdrücklich verlangt: „استخدم الارقام الافتراضية من الداتيف
  // نفسه". Jede unten ist bei ECOVIS RTS belegt, derselben Quelle, aus der
  // Kasse, Bank und Geldtransit stammen. Siehe `QUELLE`.
  //
  // `WARENEINKAUF` bekommt KEIN eigenes Konto: dafür gibt es `wareneingang`
  // (3200/5200) seit jeher, und zwei Konten für dieselbe Sache wären genau
  // die Hauskrankheit „zwei Listen driften".
  | 'aufwandMiete'
  | 'aufwandWerbung'
  | 'aufwandPorto'
  | 'aufwandBuerobedarf'
  | 'aufwandReparatur'
  | 'aufwandGebuehren'
  | 'aufwandReise'
  | 'aufwandSonstiges'
  | 'wareneingang'
  | 'erloeseStandard19'
  | 'erloeseReduced7'
  | 'erloeseMargin25a'
  | 'erloeseGold25c'
  // 26.07.2026 ergaenzt. Beide fehlten, und ein Umsatz mit diesen Schluesseln
  // fiel STILL auf `erloeseStandard19` — mit LEEREM Buchungsschluessel. Der
  // Steuerberater sah einen 19-Prozent-Erloes, wo keiner war.
  | 'erloeseReverseCharge13b'
  | 'erloeseKleinunternehmer19'
  // ── § 25a wird auf ZWEI Konten gebucht, nicht auf eines ─────────────────
  //
  // Haufe und die ECOVIS-Kontenliste stimmen ueberein: beim Verkauf geht der
  // EINKAUFSPREIS auf das Konto ohne USt und die DIFFERENZ auf das Konto mit
  // 19 Prozent. Zwei Zeilen je differenzbesteuertem Verkauf.
  // Belegt in docs/fiskal/recherche/beraterpraxis.md §3.1 und §3.2.
  | 'erloeseMargin25aEinkaufsanteil'
  | 'erloeseMargin25aMarge'
  /** Die Umsatzsteuer der Marge. Ohne dieses Konto taucht sie im Stapel nie auf. */
  | 'umsatzsteuer19';

export const KONTO_DEFINITIONEN: readonly KontoDefinition[] = [
  {
    id: 'kasse',
    schluesselTeil: 'kasse',
    label: 'Kasse',
    zweck: 'Barzahlung. Das einzige Konto, das echtes Bargeld sieht.',
  },
  {
    id: 'bank',
    schluesselTeil: 'bank',
    label: 'Bank',
    zweck: 'Überweisung, direkt auf dem Geschäftskonto.',
  },
  {
    id: 'geldtransitKarte',
    schluesselTeil: 'geldtransit_karte',
    label: 'Geldtransit Kartenterminal',
    zweck: 'Zahlung am Terminal. Liegt bis zur Gutschrift beim Akzeptanzweg.',
  },
  {
    id: 'geldtransitSumUp',
    schluesselTeil: 'geldtransit_sumup',
    label: 'Geldtransit SumUp',
    zweck: 'Zahlung über SumUp, bis zur Gutschrift auf dem Bankkonto.',
  },
  {
    id: 'geldtransitMollie',
    schluesselTeil: 'geldtransit_mollie',
    label: 'Geldtransit Mollie',
    zweck: 'Zahlung über Mollie, bis zur Gutschrift auf dem Bankkonto.',
  },
  {
    id: 'geldtransitStripe',
    schluesselTeil: 'geldtransit_stripe',
    label: 'Geldtransit Stripe',
    zweck: 'Zahlung über Stripe, bis zur Gutschrift auf dem Bankkonto.',
  },
  {
    // 26.07.2026 (Koordination §9): der Leser am Ladentisch. GETRENNT vom
    // Web-Shop-Stripe, obwohl derselbe Anbieter auszahlt — Terminal- und
    // Shop-Auszahlungen sind zwei Ströme, und der Berater stimmt je Weg
    // gegen den Bankauszug ab. Ein gemeinsames Konto machte das unmöglich.
    id: 'geldtransitStripeTerminal',
    schluesselTeil: 'geldtransit_stripe_terminal',
    label: 'Geldtransit Stripe Terminal',
    zweck: 'Kartenzahlung am Stripe-Leser im Laden, bis zur Gutschrift auf dem Bankkonto. Getrennt vom Web-Shop-Stripe.',
  },
  {
    id: 'geldtransitEbay',
    schluesselTeil: 'geldtransit_ebay',
    label: 'Geldtransit eBay',
    zweck: 'Zahlung über eBay, bis zur Gutschrift auf dem Bankkonto.',
  },
  {
    id: 'geldtransit',
    schluesselTeil: 'geldtransit',
    label: 'Geldtransit',
    zweck:
      'Bargeld auf dem Weg zwischen Lade und Bank oder Tresor. Bankabschöpfung, ' +
      'Tresortransit und Einlage laufen hierüber.',
  },
  {
    id: 'gutscheinMehrzweck',
    schluesselTeil: 'gutschein_mehrzweck',
    label: 'Gutscheine (Mehrzweck)',
    zweck:
      'Verbindlichkeit aus ausgegebenen Mehrzweck-Gutscheinen. Zahlt ein Kunde ' +
      'mit Gutschein, mindert sich dieses Konto; die Umsatzsteuer entsteht erst ' +
      'bei der Einlösung.',
  },
  {
    id: 'aufwandMiete',
    schluesselTeil: 'aufwand_miete',
    label: 'Miete',
    zweck: 'Miete der Geschäftsräume, unbewegliche Wirtschaftsgüter.',
  },
  {
    id: 'aufwandWerbung',
    schluesselTeil: 'aufwand_werbung',
    label: 'Werbekosten',
    zweck: 'Vermarktung, Anzeigen, Auftritt.',
  },
  {
    id: 'aufwandPorto',
    schluesselTeil: 'aufwand_porto',
    label: 'Porto und Versand',
    zweck: 'Porto, Versandkosten, Verpackung für den Versand.',
  },
  {
    id: 'aufwandBuerobedarf',
    schluesselTeil: 'aufwand_buerobedarf',
    label: 'Bürobedarf',
    zweck: 'Verbrauchsmaterial des Büroalltags.',
  },
  {
    id: 'aufwandReparatur',
    schluesselTeil: 'aufwand_reparatur',
    label: 'Reparatur und Instandhaltung',
    zweck: 'Ladeneinrichtung, Waage, Drucker, Vitrine.',
  },
  {
    id: 'aufwandGebuehren',
    schluesselTeil: 'aufwand_gebuehren',
    label: 'Gebühren',
    zweck: 'Nebenkosten des Geldverkehrs, Kontoführung, Zahlungsanbieter.',
  },
  {
    id: 'aufwandReise',
    schluesselTeil: 'aufwand_reise',
    label: 'Reisekosten',
    zweck: 'Reisekosten des Unternehmers.',
  },
  {
    id: 'aufwandSonstiges',
    schluesselTeil: 'aufwand_sonstiges',
    label: 'Sonstige betriebliche Aufwendungen',
    zweck: 'Was in keine der anderen Arten fällt.',
  },
  {
    id: 'wareneingang',
    schluesselTeil: 'wareneingang',
    label: 'Wareneingang',
    zweck: 'Ankauf von privat. Keine Vorsteuer.',
  },
  {
    id: 'erloeseStandard19',
    schluesselTeil: 'erloese_standard_19',
    label: 'Erlöse 19 Prozent',
    zweck: 'Regelbesteuerter Verkauf. Automatikkonto: DATEV rechnet die Steuer selbst heraus.',
  },
  {
    id: 'erloeseReduced7',
    schluesselTeil: 'erloese_reduced_7',
    label: 'Erlöse 7 Prozent',
    zweck: 'Ermässigt besteuerter Verkauf. Automatikkonto: DATEV rechnet die Steuer selbst heraus.',
  },
  {
    id: 'erloeseMargin25a',
    schluesselTeil: 'erloese_margin_25a',
    // ── 19.08.2026: ehrlich beschriftet ─────────────────────────────────
    // Bis heute hiess dieser Eintrag „Erlöse Differenzbesteuerung § 25a" —
    // aber seit der Zwei-Zeilen-Aufteilung (27.07.2026) erreicht KEIN
    // Verkauf dieses Konto mehr: `teileZeileAuf` zerlegt jeden § 25a-Umsatz
    // in Einkaufsanteil und Marge, und der einzige Pfad hierher wirft. Wer
    // in der Oberfläche „welches Konto für § 25a?" beantwortete, änderte
    // ein Konto, das nichts tut, während die zwei wirksamen weiter unten
    // standen. Amtlich heisst 8200 schlicht „Erlöse", ohne § 25a-Bedeutung.
    label: 'Erlöse (Sammelkonto, seit 27.07.2026 unbenutzt)',
    zweck:
      'Historisch: § 25a vor der Zwei-Zeilen-Aufteilung. Ein Verkauf erreicht dieses ' +
      'Konto nicht mehr; die wirksamen § 25a-Konten sind Einkaufsanteil und Marge.',
  },
  {
    id: 'erloeseGold25c',
    schluesselTeil: 'erloese_gold_25c',
    label: 'Erlöse Anlagegold § 25c',
    zweck: 'Steuerfreies Anlagegold nach § 25c UStG. Kein Buchungsschlüssel.',
  },
  {
    id: 'erloeseReverseCharge13b',
    schluesselTeil: 'erloese_reverse_charge_13b',
    label: 'Erlöse § 13b (Steuerschuldnerschaft des Leistungsempfängers)',
    zweck:
      'Die Steuerschuld geht auf den Kunden über. Der Verkäufer weist nichts aus, ' +
      'muss den Umsatz aber getrennt erklären, er gehört NICHT in die 19-Prozent-Erlöse.',
  },
  {
    id: 'erloeseMargin25aEinkaufsanteil',
    schluesselTeil: 'erloese_margin_25a_einkaufsanteil',
    label: 'Umsatzerlöse §§ 25/25a UStG ohne USt (Einkaufsanteil)',
    zweck:
      'Der Einkaufspreis eines differenzbesteuerten Stücks. Er trägt KEINE ' +
      'Umsatzsteuer, besteuert wird nur die Differenz zum Verkaufspreis.',
  },
  {
    id: 'erloeseMargin25aMarge',
    schluesselTeil: 'erloese_margin_25a_marge',
    label: 'Umsatzerlöse §§ 25/25a UStG 19 % USt (Marge)',
    zweck:
      'Die Differenz zwischen Verkaufs- und Einkaufspreis. NUR sie ist ' +
      'Bemessungsgrundlage nach § 25a Abs. 3 UStG.',
  },
  {
    id: 'umsatzsteuer19',
    schluesselTeil: 'umsatzsteuer_19',
    label: 'Umsatzsteuer 19 % (nur zur Ansicht)',
    // 19.08.2026 richtiggestellt: der zweite Halbsatz („die Marge braucht
    // einen eigenen Weg") beschrieb einen Weg, den es nie gab — kein Export
    // schreibt dieses Konto. Das ist auch RICHTIG so: 8191 ist im amtlichen
    // SKR03 ein Automatikkonto (AM), DATEV bucht die Margensteuer selbst auf
    // sein hinterlegtes Steuerkonto. Der Eintrag bleibt sichtbar, damit die
    // Kanzlei sieht, welches Konto das Haus MEINT — wirken tut er nirgends.
    zweck:
      'Das Steuerkonto. DATEV bebucht es selbst über die Automatikkonten; ' +
      'der Buchungsstapel der Kasse schreibt hierauf keine Zeile.',
  },
  {
    id: 'erloeseKleinunternehmer19',
    schluesselTeil: 'erloese_kleinunternehmer_19',
    label: 'Erlöse § 19 UStG (Kleinunternehmer)',
    zweck:
      'Ein Betrieb unter § 19 UStG weist keine Umsatzsteuer aus. Sein Umsatz gehört ' +
      'auf ein eigenes Konto, nicht in die steuerpflichtigen Erlöse.',
  },
] as const;

export const KONTO_IDS: readonly KontoId[] = KONTO_DEFINITIONEN.map((d) => d.id);

const DEFINITION_JE_ID = new Map(KONTO_DEFINITIONEN.map((d) => [d.id, d]));

// ── Die zwei Vorlagen ──────────────────────────────────────────────────────

/**
 * SKR03 — WÖRTLICH der Stand, der bis zum 26.07.2026 im Quelltext lief.
 *
 * Diese Spalte darf sich nicht ändern. Sie ist belegt (siehe `QUELLE`) und
 * läuft bereits; eine Änderung hier wäre eine stille Änderung an der
 * laufenden Buchführung.
 */
const VORLAGE_SKR03: Readonly<Record<KontoId, string>> = {
  kasse: '1000',
  bank: '1200',
  geldtransitKarte: '1361',
  geldtransitSumUp: '1362',
  geldtransitMollie: '1363',
  geldtransitStripe: '1364',
  // 26.07.2026: NEU, kein Alt-Stand. Fortgeführte Reihe 1361 ff., wie die
  // vier Konten davor. Ändert keine bestehende Zahl dieser Spalte.
  geldtransitStripeTerminal: '1366',
  geldtransitEbay: '1365',
  // 1360 ist im SKR03 das Geldtransitkonto. Für Bankabschöpfung, Tresor und
  // Einlage ist das kein Auslegungsfall: das Geld hat die Lade verlassen und
  // ist noch nicht auf dem Auszug, genau dafür steht das Konto.
  geldtransit: '1360',
  // 12.08.2026: NEU, kein Alt-Stand. 1796 "Ausgegebene Geschenkgutscheine"
  // steht woertlich im offiziellen SKR03 2025, ohne Automatikfunktion.
  gutscheinMehrzweck: '1796',
  aufwandMiete: '4210',
  aufwandWerbung: '4600',
  aufwandPorto: '4910',
  aufwandBuerobedarf: '4930',
  aufwandReparatur: '4805',
  aufwandGebuehren: '4970',
  aufwandReise: '4670',
  aufwandSonstiges: '4900',
  wareneingang: '3200',
  erloeseStandard19: '8400',
  erloeseReduced7: '8300',
  erloeseMargin25a: '8200',
  // ── 19.08.2026 berichtigt: 8150 → 8165 ─────────────────────────────────
  //
  // 8150 heisst amtlich „Sonstige steuerfreie Umsätze (z. B. § 4 Nr. 2 bis 7
  // UStG)". § 25c steht in Abschnitt VI des UStG und ist keine Befreiung nach
  // § 4 — das Konto war von Anfang an das falsche, und die QUELLE-Zeile
  // weiter unten sagte das auch. Nur stand die Zahl trotzdem im Betrieb.
  //
  // 8165 heisst „Steuerfreie Umsätze ohne Vorsteuerabzug zum Gesamtumsatz
  // gehörend" — ohne den Zusatz „§ 4 UStG", und genau das unterscheidet es von
  // 8160. DATEVs eigene Kontenerläuterung (Dok.-Nr. 5361613) nennt dafür
  // ausdrücklich die steuerfreie Lieferung von Anlagegold nach § 25c UStG.
  //
  // Für diesen Händler ist das keine Randnotiz: Anlagegold ist eine Hauptlinie,
  // und das Konto entscheidet, unter welcher Kennziffer der Umsatz ein ganzes
  // Jahr lang in der Umsatzsteuer-Voranmeldung erscheint (hier: Kz 48).
  erloeseGold25c: '8165',
  // 8337 ist im SKR03 fuer Erloese aus Leistungen, bei denen der
  // Leistungsempfaenger die Steuer schuldet, vorgesehen.
  erloeseReverseCharge13b: '8337',
  // 8195 fuehrt der SKR03 als steuerfreie Umsaetze ohne Vorsteuerabzug — der
  // Platz fuer den Kleinunternehmer.
  erloeseKleinunternehmer19: '8195',
  erloeseMargin25aEinkaufsanteil: '8193',
  erloeseMargin25aMarge: '8191',
  umsatzsteuer19: '1776',
};

/**
 * SKR04 — die Entsprechungen.
 *
 * Es ist KEINE Ziffernvertauschung. Kasse 1000 wird 1600, Wareneingang 3200
 * wird 5200, und die Differenzbesteuerung paart 8191 mit 4136 statt mit 8191
 * rückwärts gelesen. Wer hier ein Muster unterstellt, liegt falsch.
 *
 * Jede einzelne Zahl ist in `QUELLE` belegt oder ausdrücklich als unbelegt
 * gekennzeichnet. Die Oberfläche weist sie ohnehin allesamt als VORSCHLAG
 * aus, solange der Inhaber sie nicht gespeichert hat.
 */
const VORLAGE_SKR04: Readonly<Record<KontoId, string>> = {
  kasse: '1600',
  bank: '1800',
  geldtransitKarte: '1461',
  geldtransitSumUp: '1462',
  geldtransitMollie: '1463',
  geldtransitStripe: '1464',
  geldtransitStripeTerminal: '1466',
  geldtransitEbay: '1465',
  // Der SKR04 führt das Geldtransitkonto unter 1460, spiegelbildlich zur
  // Reihe 1461 ff. der Akzeptanzwege darüber.
  geldtransit: '1460',
  // 12.08.2026: 3786 "Ausgegebene Geschenkgutscheine" im offiziellen SKR04
  // 2025, ohne Automatikfunktion. ⚠️ NICHT 3270: das ist ein Automatikkonto
  // mit fester 16-Prozent-Umsatzsteuerfunktion.
  gutscheinMehrzweck: '3786',
  aufwandMiete: '6310',
  aufwandWerbung: '6600',
  aufwandPorto: '6800',
  aufwandBuerobedarf: '6815',
  // ⚠️ 6470, nicht 6485. Der SKR03 fasst mit 4805 „andere Anlagen UND
  // Betriebs- und Geschäftsausstattung" in EIN Konto; der SKR04 trennt sie:
  // 6470 ist die Betriebs- und Geschäftsausstattung, 6485 sind andere
  // Anlagen. Für einen Laden ist die Reparatur die der Ladeneinrichtung.
  aufwandReparatur: '6470',
  aufwandGebuehren: '6855',
  aufwandReise: '6670',
  aufwandSonstiges: '6300',
  wareneingang: '5200',
  erloeseStandard19: '4400',
  erloeseReduced7: '4300',
  erloeseMargin25a: '4200',
  erloeseGold25c: '4165', // Gegenstück zu SKR03 8165, siehe dort.
  erloeseReverseCharge13b: '4337',
  erloeseKleinunternehmer19: '4195',
  erloeseMargin25aEinkaufsanteil: '4138',
  erloeseMargin25aMarge: '4136',
  umsatzsteuer19: '3806',
};

export const VORLAGE: Readonly<Record<KontenrahmenId, Readonly<Record<KontoId, string>>>> = {
  SKR03: VORLAGE_SKR03,
  SKR04: VORLAGE_SKR04,
};

/**
 * Woher JEDE Zahl stammt. Wörtlich, damit sie nachprüfbar bleibt.
 *
 * Wo nichts zu belegen war, steht das auch so da. Eine unbelegte Zahl ist
 * nicht verboten — sie muss nur als solche erkennbar sein, damit der Inhaber
 * sie mit seinem Steuerberater durchgeht, statt sie für gesichert zu halten.
 */
export const QUELLE: Readonly<Record<KontenrahmenId, Readonly<Record<KontoId, string>>>> = {
  SKR03: {
    kasse: 'docs/fiskal/recherche/beraterpraxis.md §3.1 (ECOVIS RTS, SKR03 Klasse 1); seit 26.07.2026 im Quelltext in Betrieb',
    bank: 'docs/fiskal/recherche/beraterpraxis.md §3.1 (ECOVIS RTS, SKR03 Klasse 1); in Betrieb',
    geldtransitKarte:
      'docs/fiskal/recherche/beraterpraxis.md §3.1 und §6.3: Geldtransit 1360, je Akzeptanzweg 1361 ff., frei zu beschriften; in Betrieb',
    geldtransit:
      'BELEGT. docs/fiskal/recherche/beraterpraxis.md §3.1 und §6.3 nennen „Geldtransit 1360" woertlich. Fuer Bankabschoepfung, Tresortransit und Einlage ist das kein Auslegungsfall.',
    gutscheinMehrzweck:
      'BELEGT. Offizieller DATEV-Kontenrahmen SKR03 2025 (Art.-Nr. 11174), am 12.08.2026 im Original geprueft: 1796 „Ausgegebene Geschenkgutscheine", OHNE Automatikfunktion. DATEV-Buchungsbeispiel Dok. 5305720 bucht die Mehrzweck-Ausgabe woertlich „1000 Kasse an 1796". Fachlich Vorschlag: fuehrt die Kanzlei ein eigenes Konto, sticht das den Standard.',
    aufwandMiete:
      'BELEGT. ECOVIS RTS, Kontenrahmen SKR03 Klasse 4, am 06.08.2026 abgerufen: 4210 „Miete, unbewegliche Wirtschaftsgueter". Dieselbe Quelle wie Kasse, Bank und Geldtransit.',
    aufwandWerbung: 'BELEGT. ECOVIS RTS SKR03 Klasse 4: 4600 „Werbekosten".',
    aufwandPorto: 'BELEGT. ECOVIS RTS SKR03 Klasse 4: 4910 „Porto".',
    aufwandBuerobedarf: 'BELEGT. ECOVIS RTS SKR03 Klasse 4: 4930 „Buerobedarf".',
    aufwandReparatur:
      'BELEGT. buchungssatz.de SKR03 4805 „Reparaturen und Instandhaltungen von anderen Anlagen und Betriebs- und Geschaeftsausstattung". ⚠️ Der SKR03 fasst beides in EIN Konto; der SKR04 trennt es (siehe dort).',
    aufwandGebuehren: 'BELEGT. ECOVIS RTS SKR03 Klasse 4: 4970 „Nebenkosten des Geldverkehrs".',
    aufwandReise: 'BELEGT. ECOVIS RTS SKR03 Klasse 4: 4670 „Reisekosten Unternehmer".',
    aufwandSonstiges: 'BELEGT. ECOVIS RTS SKR03 Klasse 4: 4900 „Sonstige betriebliche Aufwendungen".',
    geldtransitSumUp: 'abgeleitet aus der Reihe 1361 ff. (frei beschriftbares Transitkonto); in Betrieb',
    geldtransitMollie: 'abgeleitet aus der Reihe 1361 ff. (frei beschriftbares Transitkonto); in Betrieb',
    geldtransitStripe: 'abgeleitet aus der Reihe 1361 ff. (frei beschriftbares Transitkonto); in Betrieb',
    geldtransitStripeTerminal:
      'abgeleitet aus der Reihe 1361 ff. (frei beschriftbares Transitkonto). NEU am 26.07.2026 fuer den Stripe-Leser im Laden, KEIN Alt-Stand, getrennt vom Web-Shop-Stripe 1364, damit der Berater beide Auszahlungsstroeme einzeln abstimmen kann.',
    geldtransitEbay: 'abgeleitet aus der Reihe 1361 ff. (frei beschriftbares Transitkonto); in Betrieb',
    wareneingang: 'docs/fiskal/recherche/beraterpraxis.md §3.1 (ECOVIS RTS); in Betrieb',
    erloeseStandard19:
      'docs/fiskal/recherche/beraterpraxis.md §3.1: Erlöse 19 Prozent, Automatikkonto; in Betrieb',
    erloeseReduced7:
      'docs/fiskal/recherche/beraterpraxis.md §3.1: Erlöse 7 Prozent, Automatikkonto; in Betrieb',
    erloeseMargin25a:
      'seit 26.07.2026 in Betrieb. ACHTUNG: docs/fiskal/recherche/beraterpraxis.md §7 hält fest, dass 8200 laut ECOVIS schlicht „Erlöse" 19 Prozent heisst und § 25a eigentlich auf 8193 (Einkaufsanteil) plus 8191 (Marge) gehört. Diese Aufteilung ist eine EIGENE Änderung und hier nicht enthalten.',
    erloeseGold25c:
      'BELEGT seit 19.08.2026, vorher falsch. Bis dahin stand hier 8150 „Sonstige steuerfreie Umsätze (z. B. § 4 Nr. 2-7 UStG)" — § 25c ist aber keine Befreiung nach § 4. Jetzt 8165 „Steuerfreie Umsätze ohne Vorsteuerabzug zum Gesamtumsatz gehörend": DATEVs Kontenerläuterung Dok.-Nr. 5361613 nennt dafür ausdrücklich die Lieferung von Anlagegold nach § 25c UStG. In der Voranmeldung Kz 48. ⚠️ Bleibt vorzulegen, falls der Händler nach § 25c Abs. 3 optiert — dann greift der Vorsteuerabzug nach Abs. 5 und das Konto wechselt die Seite.',
    erloeseReverseCharge13b:
      'BELEGT. docs/fiskal/recherche/beraterpraxis.md §3.2 zitiert ECOVIS: 8337 heisst „Erlöse aus Leistungen, für die der Leistungsempfänger die Umsatzsteuer nach § 13b UStG schuldet\u0022. ⚠️ Ich hatte die Zahl am 26.07.2026 zunächst als UNBELEGT eingetragen, ohne die Hausrecherche zu lesen, sie stand dort längst. Vorher fielen solche Umsätze still auf 8400 mit leerem Buchungsschlüssel.',
    erloeseKleinunternehmer19:
      '⚠️ 19.08.2026: BEIDE Zahlen sind im Jahrgang 2026 unbrauchbar und MÜSSEN vom Steuerberater ersetzt werden, bevor ein Kleinunternehmer exportiert. Im amtlichen SKR03 2026 ist 8195 als „R 8195-96" reserviert — reservierte Konten dürfen erst bebucht werden, wenn ihnen eine Funktion zugeteilt wurde. Im SKR04 gibt es 4195 überhaupt nicht; das Gegenstück zum alten 8195 war 4185, ebenfalls jetzt reserviert. Grund: seit 01.01.2025 ist der Kleinunternehmer-Umsatz steuerfrei statt nicht erhoben, DATEV hat die eigenen Konten dafür zurückgezogen. Welches Konto für steuerfreie Umsätze an ihre Stelle tritt, ist eine Entscheidung der Kanzlei — hier wird sie NICHT geraten. Die frühere Notiz („8195 führt der SKR03 als steuerfreie Umsätze ohne Vorsteuerabzug") beschrieb ohnehin ein anderes Konto: 8195 hiess bis 2025 „Erlöse als Kleinunternehmer i. S. d. § 19 Abs. 1 UStG".',
    erloeseMargin25aEinkaufsanteil:
      'BELEGT. beraterpraxis.md §3.1 und §3.2: Haufe Finance Office und die ECOVIS-Kontenliste nennen übereinstimmend 8193, amtliche Bezeichnung „Umsatzerlöse nach §§ 25 und 25a UStG ohne USt". Hierhin geht der EINKAUFSPREIS.',
    erloeseMargin25aMarge:
      'BELEGT, dieselbe Quelle: 8191, „Umsatzerlöse nach §§ 25 und 25a UStG 19 % USt". Hierhin geht die DIFFERENZ. ⚠️ Die Blog-Quelle mit 8420/Steuerschlüssel 76 und die mit 8337 sind beide widerlegt, 8337 ist § 13b, nicht § 25a.',
    umsatzsteuer19:
      'BELEGT. beraterpraxis.md §3.1: Umsatzsteuer 19 Prozent, SKR03 1776 (ECOVIS).',
  },
  SKR04: {
    kasse: 'docs/fiskal/recherche/beraterpraxis.md §3.1, Tabelle SKR03/SKR04 (Kontenplan SKR04 der Steuerberaterkammern, sbk-sachsen.de): Kasse 1000 zu 1600',
    bank: 'docs/fiskal/recherche/beraterpraxis.md §3.1: Bank 1200 zu 1800',
    geldtransitKarte:
      'docs/fiskal/recherche/beraterpraxis.md §3.1 und §6.3: Geldtransit 1360 zu 1460, je Akzeptanzweg 1361 ff. zu 1461 ff.',
    geldtransit:
      'BELEGT. docs/fiskal/recherche/beraterpraxis.md §3.1 und §6.3: „Geldtransit 1360 zu 1460".',
    gutscheinMehrzweck:
      'BELEGT. Offizieller DATEV-Kontenrahmen SKR04 2025 (Art.-Nr. 11175), am 12.08.2026 im Original geprueft: 3786 „Ausgegebene Geschenkgutscheine", OHNE Automatikfunktion. ⚠️ Das zunaechst angedachte 3270 ist dort „U AM 3270 Erhaltene, versteuerte Anzahlungen 16 % USt", ein AUTOMATIKKONTO — es haette bei jeder Gutscheinbuchung selbsttaetig 16 Prozent Steuer gerechnet und wird deshalb NICHT verwendet.',
    aufwandMiete: 'BELEGT. ECOVIS RTS, Kontenrahmen SKR04 Klasse 6, am 06.08.2026 abgerufen: 6310 „Miete, unbewegliche Wirtschaftsgueter".',
    aufwandWerbung: 'BELEGT. ECOVIS RTS SKR04 Klasse 6: 6600 „Werbekosten".',
    aufwandPorto: 'BELEGT. ECOVIS RTS SKR04 Klasse 6: 6800 „Porto".',
    aufwandBuerobedarf: 'BELEGT. ECOVIS RTS SKR04 Klasse 6: 6815 „Buerobedarf".',
    aufwandReparatur:
      '⚠️ BELEGT UND ENTSCHIEDEN. ECOVIS RTS SKR04 Klasse 6 fuehrt ZWEI Konten: 6470 „Reparatur/Instandh. Betriebs- u. Gesch." und 6485 „Reparatur/Instandh. andere Anlagen". Der SKR03 hat dafuer nur 4805 (beides zusammen). Gewaehlt ist 6470, weil die Reparatur eines Ladens die der Ladeneinrichtung ist (Waage, Drucker, Vitrine, Theke). Wer ueberwiegend andere Anlagen repariert, stellt es in den Einstellungen auf 6485 um.',
    aufwandGebuehren: 'BELEGT. ECOVIS RTS SKR04 Klasse 6: 6855 „Nebenkosten des Geldverkehrs".',
    aufwandReise: 'BELEGT. ECOVIS RTS SKR04 Klasse 6: 6670 „Reisekosten Unternehmer".',
    aufwandSonstiges: 'BELEGT. ECOVIS RTS SKR04 Klasse 6: 6300 „Sonstige betriebliche Aufwendungen".',
    geldtransitSumUp:
      'unbelegt, Vorschlag: fortgeführte Reihe 1461 ff. analog zu SKR03 1362. Das Transitkonto je Akzeptanzweg ist frei beschriftbar, die konkrete Nummer bestimmt der Steuerberater.',
    geldtransitMollie:
      'unbelegt, Vorschlag: fortgeführte Reihe 1461 ff. analog zu SKR03 1363. Frei beschriftbares Transitkonto.',
    geldtransitStripe:
      'unbelegt, Vorschlag: fortgeführte Reihe 1461 ff. analog zu SKR03 1364. Frei beschriftbares Transitkonto.',
    geldtransitStripeTerminal:
      'unbelegt, Vorschlag: fortgeführte Reihe 1461 ff. analog zu SKR03 1366. Frei beschriftbares Transitkonto; die konkrete Nummer bestimmt der Steuerberater.',
    geldtransitEbay:
      'unbelegt, Vorschlag: fortgeführte Reihe 1461 ff. analog zu SKR03 1365. Frei beschriftbares Transitkonto.',
    wareneingang: 'docs/fiskal/recherche/beraterpraxis.md §3.1: Wareneingang 3200 zu 5200',
    erloeseStandard19:
      'docs/fiskal/recherche/beraterpraxis.md §3.1: Erlöse 19 Prozent 8400 zu 4400, Automatikkonto',
    erloeseReduced7:
      'docs/fiskal/recherche/beraterpraxis.md §3.1: Erlöse 7 Prozent 8300 zu 4300, Automatikkonto',
    erloeseMargin25a:
      'Paarung 8200 zu 4200 belegt bei buchungssatz.de (SKR03 8200 / SKR04 4200, „Erlöse"), dieselbe Quelle, aus der die Hausrecherche schon 8200 nachschlug. Die EIGNUNG des Kontos für § 25a ist damit NICHT belegt; die Hausrecherche hält 4138 plus 4136 für richtig (Aufteilung, hier nicht enthalten). Als Zahl also belegt, fachlich Vorschlag.',
    erloeseGold25c:
      'Paarung 8150 zu 4150 belegt bei buchungssatz.de (beide „Sonstige steuerfreie Umsätze, z. B. § 4 Nr. 2-7 UStG"). Dass dieses Konto für Anlagegold nach § 25c das richtige ist, ist NICHT belegt und muss vom Steuerberater benannt werden.',
    erloeseReverseCharge13b:
      'BELEGT. beraterpraxis.md §3.2: der SKR04-Kontenplan der Steuerberaterkammer bestätigt 4337 für § 13b. Dieselbe Korrektur wie bei SKR03 8337.',
    erloeseKleinunternehmer19:
      '⚠️ 26.07.2026 ergänzt und NICHT belegt. 4195 führt der SKR04 als steuerfreie Umsätze ohne Vorsteuerabzug. Ob der Steuerberater den Kleinunternehmer-Umsatz dorthin oder auf ein eigenes Konto bucht, ist seine Entscheidung. Die Oberfläche weist die Zahl ohnehin als VORSCHLAG aus.',
    erloeseMargin25aEinkaufsanteil:
      'BELEGT. beraterpraxis.md §3.1: SKR04 4138, „Umsatzerlöse nach §§ 25 und 25a UStG ohne USt" (Haufe und ECOVIS übereinstimmend).',
    erloeseMargin25aMarge:
      'BELEGT, dieselbe Quelle: 4136, „… 19 % USt".',
    umsatzsteuer19:
      'BELEGT. beraterpraxis.md §3.1: SKR04 3806 (Sammelkonto 3800).',
  },
};

// ── Der Schlüssel in system_settings ───────────────────────────────────────

/** `datev.konto.skr03.kasse`. Kleinschrift mit Punkt, wie das Schema verlangt. */
export function kontoSchluessel(rahmen: KontenrahmenId, konto: KontoId): string {
  const def = DEFINITION_JE_ID.get(konto);
  if (!def) throw new Error(`kontenrahmen: unbekanntes Konto „${konto}".`);
  return `datev.konto.${rahmen.toLowerCase()}.${def.schluesselTeil}`;
}

/** Alle Schlüssel eines Rahmens, in der Reihenfolge der Definitionen. */
export function alleKontoSchluessel(rahmen: KontenrahmenId): string[] {
  return KONTO_DEFINITIONEN.map((d) => kontoSchluessel(rahmen, d.id));
}

/** Schlüssel → Rahmen und Konto, oder `null`, wenn es kein Kontoschlüssel ist. */
export function zerlegeKontoSchluessel(
  schluessel: string,
): { rahmen: KontenrahmenId; konto: KontoId } | null {
  const m = /^datev\.konto\.(skr03|skr04)\.([a-z0-9_]+)$/.exec(schluessel);
  if (!m) return null;
  const def = KONTO_DEFINITIONEN.find((d) => d.schluesselTeil === m[2]);
  if (!def) return null;
  return { rahmen: m[1] === 'skr03' ? 'SKR03' : 'SKR04', konto: def.id };
}

// ── Die Kontonummer selbst prüfen ──────────────────────────────────────────

/**
 * Eine Sachkontonummer ist eine Ziffernfolge, vier bis acht Stellen.
 *
 * Absichtlich NICHT gegen `datev.sachkontenlaenge` gegengeprüft: DATEV lässt
 * für Automatikkonten eine Stelle mehr zu, und ein Bestand mit fünfstelligen
 * Sachkonten ist normal. Wir lehnen nur ab, was in KEINEM Bestand ein Konto
 * sein kann — alles Weitere weiss der Steuerberater besser als wir.
 */
export function pruefeKontonummer(wert: unknown): string {
  const s = String(wert ?? '').trim();
  if (!/^\d{4,8}$/.test(s) || /^0+$/.test(s)) {
    throw new DatevEinstellungError(
      `„${s}" ist keine Kontonummer. Erwartet werden vier bis acht Ziffern, ` +
        'zum Beispiel 1000 oder 8400.',
    );
  }
  return s;
}

// ── Die sechs Angaben des Steuerberaters, als Einstellung ──────────────────

/**
 * Die Liste der Schlüssel, deren Wert nur ein VORGABEWERT ist.
 *
 * Angelegt von Wanderung 0115, gepflegt vom Änderungsweg: wer einen Wert
 * speichert, nimmt seinen Schlüssel daraus. Ohne diese Liste liesse sich bei
 * den Mandantenangaben nicht unterscheiden, ob ein Wert bestätigt wurde oder
 * nur dasteht — bei den Konten reicht dafür das blosse Vorhandensein der
 * Zeile, hier nicht, weil die Wanderung ja gerade Zeilen anlegt.
 */
export const PLATZHALTER_SCHLUESSEL = 'datev.platzhalter';

export type FeldArt = 'zahl' | 'text' | 'jaNein' | 'rahmen' | 'datum';

export interface MandantFeld {
  readonly schluessel: string;
  readonly label: string;
  readonly hinweis: string;
  readonly art: FeldArt;
}

/**
 * Die sechs Angaben, die der Kopf des Buchungsstapels trägt.
 *
 * Die Reihenfolge ist die der Kopffelder, damit der Inhaber sie in der App in
 * derselben Folge sieht, in der sie in der Datei stehen.
 */
export const MANDANT_FELDER: readonly MandantFeld[] = [
  {
    schluessel: 'datev.beraternummer',
    label: 'Beraternummer',
    hinweis:
      'Vergibt DATEV an die Kanzlei. Vier bis sieben Ziffern. Dieser Wert kann nur vom Steuerberater kommen.',
    art: 'zahl',
  },
  {
    schluessel: 'datev.mandantennummer',
    label: 'Mandantennummer',
    hinweis:
      'Die Nummer dieses Ladens im Bestand des Steuerberaters. Eine bis fünf Ziffern. Nur er kennt sie.',
    art: 'zahl',
  },
  {
    schluessel: 'datev.wirtschaftsjahr_beginn',
    label: 'Beginn des Wirtschaftsjahres',
    hinweis:
      'JJJJ-MM-TT, im Regelfall der 1. Januar. Bestimmt das Jahr ALLER Belegdaten der Datei, weil das Belegdatum nur Tag und Monat trägt.',
    art: 'datum',
  },
  {
    schluessel: 'datev.sachkontenlaenge',
    label: 'Länge der Sachkonten',
    hinweis: 'Vier bis acht Stellen. Muss zum Bestand des Steuerberaters passen.',
    art: 'zahl',
  },
  {
    schluessel: 'datev.festschreibung',
    label: 'Festschreibung',
    hinweis:
      'Ein festgeschriebener Stapel lässt sich beim Steuerberater nicht mehr ändern und nicht mehr anhängen.',
    art: 'jaNein',
  },
  {
    schluessel: 'datev.sachkontenrahmen',
    label: 'Kontenrahmen',
    hinweis: 'SKR03 oder SKR04. Welchen der Mandant führt, entscheidet der Steuerberater.',
    art: 'rahmen',
  },
];

const MANDANT_JE_SCHLUESSEL = new Map(MANDANT_FELDER.map((f) => [f.schluessel, f]));

/** Ein geprüfter Wert, fertig zum Schreiben — die Route baut daraus das jsonb. */
export type DatevWert =
  | { readonly art: 'text'; readonly wert: string }
  | { readonly art: 'zahl'; readonly wert: number }
  | { readonly art: 'jaNein'; readonly wert: boolean };

/** Ist der Schlüssel überhaupt einer, den dieser Weg ändern darf? */
export function istDatevSchluessel(schluessel: string): boolean {
  return MANDANT_JE_SCHLUESSEL.has(schluessel) || zerlegeKontoSchluessel(schluessel) !== null;
}

/**
 * Einen eingegebenen Wert prüfen, bevor er gespeichert wird.
 *
 * Jede Meldung ist deutsch und nennt, was erwartet wird. Geprüft wird auf
 * UNSINN, nicht auf Richtigkeit: ob 8400 in DIESEM Bestand das Erlöskonto
 * ist, weiss nur der Steuerberater, und das massen wir uns nicht an.
 */
export function pruefeDatevEinstellung(schluessel: string, eingabe: unknown): DatevWert {
  const konto = zerlegeKontoSchluessel(schluessel);
  if (konto) return { art: 'text', wert: pruefeKontonummer(eingabe) };

  const feld = MANDANT_JE_SCHLUESSEL.get(schluessel);
  if (!feld) {
    throw new DatevEinstellungError(
      `Die Einstellung „${schluessel}" gehört nicht zum DATEV-Export und wird hier nicht geändert.`,
    );
  }

  const roh = String(eingabe ?? '').trim();
  switch (feld.schluessel) {
    case 'datev.beraternummer': {
      if (!/^\d{4,7}$/.test(roh)) {
        throw new DatevEinstellungError(
          `Die Beraternummer hat vier bis sieben Ziffern; eingegeben wurde „${roh}". ` +
            'Sie steht auf jedem Schreiben Ihres Steuerberaters.',
        );
      }
      return { art: 'zahl', wert: Number(roh) };
    }
    case 'datev.mandantennummer': {
      if (!/^\d{1,5}$/.test(roh) || Number(roh) < 1) {
        throw new DatevEinstellungError(
          `Die Mandantennummer hat eine bis fünf Ziffern und ist mindestens 1; ` +
            `eingegeben wurde „${roh}".`,
        );
      }
      return { art: 'zahl', wert: Number(roh) };
    }
    case 'datev.sachkontenlaenge': {
      const n = Number(roh);
      if (!Number.isInteger(n) || n < 4 || n > 8) {
        throw new DatevEinstellungError(
          `Die Sachkontenlänge muss vier bis acht Stellen haben; eingegeben wurde „${roh}".`,
        );
      }
      return { art: 'zahl', wert: n };
    }
    case 'datev.festschreibung': {
      if (eingabe === true || roh === 'true') return { art: 'jaNein', wert: true };
      if (eingabe === false || roh === 'false') return { art: 'jaNein', wert: false };
      throw new DatevEinstellungError(
        `Die Festschreibung ist ja oder nein; eingegeben wurde „${roh}".`,
      );
    }
    case 'datev.wirtschaftsjahr_beginn': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(roh);
      if (!m) {
        throw new DatevEinstellungError(
          `Der Beginn des Wirtschaftsjahres wird als JJJJ-MM-TT eingegeben, ` +
            `zum Beispiel 2026-01-01; eingegeben wurde „${roh}".`,
        );
      }
      const monat = Number(m[2]);
      const tag = Number(m[3]);
      if (monat < 1 || monat > 12 || tag < 1 || tag > 31) {
        throw new DatevEinstellungError(`„${roh}" ist kein gültiges Datum.`);
      }
      return { art: 'text', wert: roh };
    }
    case 'datev.sachkontenrahmen': {
      return { art: 'text', wert: normalisiereRahmen(roh) };
    }
    default: {
      // Nicht erreichbar: die Liste oben deckt alle sechs Felder ab. Ohne
      // diesen Zweig würde ein später ergänztes Feld still ungeprüft durch.
      throw new DatevEinstellungError(
        `Für „${feld.schluessel}" ist keine Prüfung hinterlegt. Der Wert wurde NICHT gespeichert.`,
      );
    }
  }
}

// ── Der Kontenplan: Vorlage plus Überschreibung, mit dem Merkmal ───────────

/**
 * Woher ein Wert stammt — das ehrliche Merkmal, das die Oberfläche anzeigt.
 *
 *   VORSCHLAG   aus der Vorlage beziehungsweise dem Vorgabewert der Wanderung.
 *               NIEMAND hat ihn bestätigt.
 *   BESTAETIGT  der Inhaber hat ihn gespeichert.
 *   FEHLT       es gibt keinen Wert. Nur bei den Mandantenangaben möglich —
 *               und seit Wanderung 0117 der NORMALFALL für Beraternummer und
 *               Mandantennummer, bis der Händler sie einträgt. Die beiden
 *               gehören seinem Steuerberater, nicht diesem Erzeugnis, und
 *               dürfen deshalb in keiner Wanderung stehen.
 */
export type Herkunft = 'VORSCHLAG' | 'BESTAETIGT' | 'FEHLT';

export interface KontoEintrag {
  readonly konto: KontoId;
  readonly schluessel: string;
  readonly label: string;
  readonly zweck: string;
  /** Der geltende Wert: die Überschreibung, sonst die Vorlage. */
  readonly wert: string;
  /** Was die Vorlage sagt — auch dann, wenn überschrieben wurde. */
  readonly vorlagewert: string;
  /**
   * `VORSCHLAG`: niemand hat den Wert bestätigt, er stammt aus der Vorlage.
   * `BESTAETIGT`: der Inhaber hat ihn gespeichert.
   */
  readonly herkunft: Herkunft;
  /** Woher die Vorlagezahl stammt, wörtlich. */
  readonly quelle: string;
}

export interface Kontenplan {
  readonly rahmen: KontenrahmenId;
  readonly eintraege: readonly KontoEintrag[];
  /** Schneller Zugriff für den Export. */
  readonly werte: Readonly<Record<KontoId, string>>;
}

/** Der reine Vorlagenplan, ohne Datenbank. Alles ist VORSCHLAG. */
export function vorlagenplan(rahmen: KontenrahmenId): Kontenplan {
  return baueKontenplan(rahmen, new Map());
}

function baueKontenplan(rahmen: KontenrahmenId, gespeichert: Map<string, string>): Kontenplan {
  const eintraege: KontoEintrag[] = [];
  const werte = {} as Record<KontoId, string>;
  for (const def of KONTO_DEFINITIONEN) {
    const schluessel = kontoSchluessel(rahmen, def.id);
    const vorlagewert = VORLAGE[rahmen][def.id];
    const ueberschrieben = gespeichert.get(schluessel);
    const wert = ueberschrieben ?? vorlagewert;
    werte[def.id] = wert;
    eintraege.push({
      konto: def.id,
      schluessel,
      label: def.label,
      zweck: def.zweck,
      wert,
      vorlagewert,
      herkunft: ueberschrieben === undefined ? 'VORSCHLAG' : 'BESTAETIGT',
      quelle: QUELLE[rahmen][def.id],
    });
  }
  return { rahmen, eintraege, werte };
}

/** Minimaler Ausschnitt der Datenbank, wie ihn `datev-mandant.ts` benutzt. */
export interface DatenbankLeser {
  execute(abfrage: ReturnType<typeof sql>): Promise<Record<string, unknown>[]>;
}

/**
 * Den geltenden Kontenplan laden: Vorlage, darüber die Überschreibungen.
 *
 * Die Schlüssel gehen als EIN Array-LITERAL in EINEM Parameter hinein, nicht
 * als JS-Array. Drizzle würde ein JS-Array in N Einzelparameter zerlegen und
 * aus `ANY($1::text[])` würde `ANY($1, $2, …::text[])` — ein Fehler, den kein
 * Typprüfer sieht und der erst am ersten echten Tag auftritt. Diese
 * Fehlerklasse hat dieses Haus fünfmal getroffen; siehe den Wächter
 * `no-array-spread.test.ts`.
 */
export async function ladeKontenplan(
  db: DatenbankLeser,
  rahmen: KontenrahmenId,
): Promise<Kontenplan> {
  const namen = `{${alleKontoSchluessel(rahmen).join(',')}}`;
  const zeilen = await db.execute(sql`
    SELECT key, value #>> '{}' AS wert
      FROM system_settings
     WHERE key = ANY(${namen}::text[])`);

  const gespeichert = new Map<string, string>();
  for (const z of zeilen) {
    const wert = z.wert;
    if (wert === null || wert === undefined || String(wert).trim() === '') continue;
    gespeichert.set(String(z.key), String(wert).trim());
  }
  return baueKontenplan(rahmen, gespeichert);
}

/** Die Nummer eines logischen Kontos im geltenden Plan. */
export function konto(plan: Kontenplan, id: KontoId): string {
  return plan.werte[id];
}

// ── Die Mandantenangaben mit ihrem Merkmal ─────────────────────────────────

export interface MandantEintrag extends MandantFeld {
  /** Der gespeicherte Wert als Text, oder `null`, wenn es keine Zeile gibt. */
  readonly wert: string | null;
  readonly herkunft: Herkunft;
}

/**
 * Die sechs Angaben laden — MIT der Antwort auf die Frage, ob sie jemand
 * bestätigt hat.
 *
 * ── DER ENTWURFSVERMERK, UND WARUM ER WIEDER FORT IST (26.07.2026) ─────────
 * Hier standen bis heute `ordnungsnummernUnbestaetigt` und
 * `stapelBezeichnung`: sie setzten „ENTWURF" vor die Bezeichnung des Stapels,
 * solange Beraternummer oder Mandantennummer nur der Platzhalter aus
 * Wanderung 0115 waren. Der Vermerk war ein Pflaster auf der falschen Wunde —
 * er liess eine Datei ohne echte Anschrift HINAUS und schrieb „Entwurf"
 * darauf, statt sie zu verhindern.
 *
 * Wanderung 0117 nimmt die beiden Platzhalter heraus, und seither ist der
 * Zustand, den der Vermerk beschrieb, unerreichbar: die zwei Schlüssel stehen
 * in KEINER Wanderung mehr in `datev.platzhalter`, und der einzige andere Weg
 * an diese Liste (`PATCH /api/settings/datev/:key`) nimmt nur etwas heraus.
 * Wer sie nicht eingetragen hat, hat also gar keinen Wert — und dann
 * verweigert `ladeDatevMandant` die Datei, BEVOR eine Bezeichnung gebaut
 * wird. Toter Code, nachgesehen und entfernt, samt seiner zwei Proben.
 *
 * Das ehrliche Merkmal `VORSCHLAG` bleibt: es gilt weiter für die vier
 * mandantenneutralen Angaben, die 0115 gesetzt hat und 0117 stehen lässt.
 */
export async function ladeMandantEinstellungen(db: DatenbankLeser): Promise<MandantEintrag[]> {
  const namen = `{${[...MANDANT_FELDER.map((f) => f.schluessel), PLATZHALTER_SCHLUESSEL].join(',')}}`;
  const zeilen = await db.execute(sql`
    SELECT key, value, value #>> '{}' AS wert
      FROM system_settings
     WHERE key = ANY(${namen}::text[])`);

  const werte = new Map<string, string | null>();
  let platzhalter: string[] = [];
  for (const z of zeilen) {
    if (String(z.key) === PLATZHALTER_SCHLUESSEL) {
      const roh = z.value;
      platzhalter = Array.isArray(roh) ? roh.map((x) => String(x)) : [];
      continue;
    }
    const w = z.wert;
    werte.set(String(z.key), w === null || w === undefined ? null : String(w));
  }

  return MANDANT_FELDER.map((f) => {
    const wert = werte.get(f.schluessel) ?? null;
    const herkunft: Herkunft =
      wert === null || wert === ''
        ? 'FEHLT'
        : platzhalter.includes(f.schluessel)
          ? 'VORSCHLAG'
          : 'BESTAETIGT';
    return { ...f, wert, herkunft };
  });
}
