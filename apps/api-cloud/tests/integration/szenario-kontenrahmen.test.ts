/**
 * ════════════════════════════════════════════════════════════════════════════
 *  Szenario Kontenrahmen — derselbe Tag in SKR03 und in SKR04
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Seit dem 26.07.2026 steht die Kontonummer nicht mehr im Quelltext. Sie kommt
 * aus einer Vorlage (SKR03 oder SKR04), der Inhaber kann JEDES einzelne Konto
 * aus der App ueberschreiben, und beim Export laesst sich der Rahmen waehlen.
 * Diese Datei ist der Waechter dafuer.
 *
 * ── DIE EINE AUSSAGE, AUF DIE ES ANKOMMT ───────────────────────────────────
 * Ein Rahmenwechsel darf KEINEN CENT bewegen. Derselbe Tag, einmal in SKR03
 * und einmal in SKR04 gezogen, muss Zeichen fuer Zeichen dieselben Betraege
 * tragen; unterscheiden duerfen sich ausschliesslich Konto (Feld 7) und
 * Gegenkonto (Feld 8) — und in der Kopfzeile das Feld 27, das den Rahmen
 * benennt. Waere das nicht so, waere die Wahl des Kontenrahmens eine
 * Umbuchung, und niemand haette sie bestellt.
 *
 * Gefahren wird gegen ein ECHTES Postgres im Behaelter, mit JEDER
 * Produktionswanderung, ueber die ECHTE Fastify-Anwendung und mit der
 * Anwendungsrolle `warehouse14_app` — also mit genau den Spalten-GRANTs der
 * Produktion. Der Schreibweg der Oberflaeche laeuft ueber einen echten
 * HTTP-PATCH, nicht ueber die Migratorrolle: eine fehlende Berechtigung auf
 * `system_settings` faellt sonst erst am ersten echten Tag auf, und genau
 * diese Falle hat in diesem Haus schon dreimal zugeschlagen.
 *
 * ── DIE ENTSCHEIDENDE ENTSCHEIDUNG DIESER DATEI ────────────────────────────
 * Die Kontentafel `ERWARTET` unten ist VON HAND geschrieben und wird
 * ABSICHTLICH NICHT aus `kontenrahmen.ts` eingelesen. Wuerde sie das, pruefte
 * diese Datei nur, dass eine Tafel mit sich selbst uebereinstimmt, und bliebe
 * gruen, wenn jemand die Erloese zu 19 Prozent auf das Konto der 7 Prozent
 * legt. Dasselbe gilt fuer die Feldpositionen des DATEV-Satzes: sie sind hier
 * nachgezaehlt, nicht importiert.
 *
 * ── WAS DIESE DATEI AUSDRUECKLICH NICHT PRUEFT ─────────────────────────────
 * Ob 4400 im Bestand DIESES Steuerberaters wirklich das Erloeskonto zu 19
 * Prozent ist, weiss nur er. Geprueft wird, dass das Programm die Zahl
 * ausliefert, die es zugesagt hat, und dass es jede Zahl als VORSCHLAG
 * kennzeichnet, solange kein Mensch sie bestaetigt hat.
 */

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

/** Der Geschaeftstag dieser Datei. Ein Tag in der Sommerzeit. */
/**
 * ⚠️ 08.08.2026: Dieser Tag lag bis heute in der ZUKUNFT, damit er sich nicht
 * mit anderen Laeufen ueberschneidet. Seit `POST /api/closings/finalize` einen
 * Zukunftstag abweist (siehe `abschlusstag.ts`), geht das nicht mehr — und das
 * ist richtig so: ein festgeschriebener Zukunftstag legt den Laden still.
 *
 * Ein VERGANGENER Tag ist genauso eindeutig und ausserdem der einzige Fall,
 * den ein Haendler wirklich nachholt.
 */
const TAG = '2025-09-08';

// ── Die Kontentafel, von Hand, fuer BEIDE Rahmen ───────────────────────────

type KontoName =
  | 'kasse'
  | 'bank'
  | 'karte'
  | 'sumup'
  | 'mollie'
  | 'stripe'
  | 'stripeTerminal'
  | 'ebay'
  | 'wareneingang'
  | 'erloese19'
  | 'erloese7'
  | 'erloese25a'
  | 'erloese25c'
  | 'erloese13b'
  | 'erloese25aEinkauf'
  | 'erloese25aMarge'
  | 'umsatzsteuer19'
  | 'erloeseKleinunternehmer'
  | 'geldtransit'
  | 'aufwandMiete'
  | 'aufwandWerbung'
  | 'aufwandPorto'
  | 'aufwandBuerobedarf'
  | 'aufwandReparatur'
  | 'aufwandGebuehren'
  | 'aufwandReise'
  | 'aufwandSonstiges'
  | 'gutscheinMehrzweck';

type RahmenName = 'SKR03' | 'SKR04';

const ALLE_KONTEN: readonly KontoName[] = [
  'kasse',
  'bank',
  'karte',
  'sumup',
  'mollie',
  'stripe',
  'stripeTerminal',
  'ebay',
  // 06.08.2026 ergänzt: der Weg zwischen Lade und Bank oder Tresor. Bis dahin
  // gab es das Konto nicht, und eine Bankabschöpfung erzeugte gar keine
  // Buchungszeile — Konto 1000 bewegte sich anders als die Schublade.
  'geldtransit',
  // 06.08.2026: die acht Aufwandskonten der Betriebsausgaben. Jede Zahl bei
  // ECOVIS RTS belegt, derselben Quelle wie Kasse, Bank und Geldtransit.
  'aufwandMiete',
  'aufwandWerbung',
  'aufwandPorto',
  'aufwandBuerobedarf',
  'aufwandReparatur',
  'aufwandGebuehren',
  'aufwandReise',
  'aufwandSonstiges',
  'wareneingang',
  'erloese19',
  'erloese7',
  'erloese25a',
  'erloese25c',
  'erloese13b',
  'erloese25aEinkauf',
  'erloese25aMarge',
  'umsatzsteuer19',
  'erloeseKleinunternehmer',
  // 12.08.2026 ergaenzt: die Verbindlichkeit aus ausgegebenen Mehrzweck-
  // Gutscheinen. Bis dahin gab es das Konto nicht, und EIN Gutschein-Beleg
  // brach die DATEV-Datei des ganzen Tages ab (ZahlartNichtKontiertError).
  'gutscheinMehrzweck',
];

/**
 * Achtundzwanzig logische Konten, zwei Rahmen, SECHSUNDFUENFZIG Zahlen —
 * abgeschrieben, nicht importiert.
 *
 * Die Reihe wuchs zweimal: am 26.07.2026 auf dreizehn (der Stripe-Leser am
 * Ladentisch, Wanderung 0120), und am 27.07.2026 auf achtzehn. Die fuenf
 * neuen sind keine Bequemlichkeit, jedes einzelne schliesst eine Luecke:
 *
 *   § 13b       ein Umsatz mit Steuerschuld des Empfaengers fiel STILL auf
 *               das 19-Prozent-Konto, und zwar mit LEEREM Buchungsschluessel.
 *   § 19        derselbe Fall fuer den Kleinunternehmer.
 *   § 25a x 2   die Differenzbesteuerung bucht auf ZWEI Konten: der
 *               Einkaufsanteil ohne Steuer, die Marge mit 19 Prozent. Vorher
 *               lag der volle Verkaufspreis steuerfrei auf einem Konto.
 *   USt 19 %    das Steuerkonto. Bei Automatikkonten bucht DATEV selbst
 *               dorthin, die Marge braucht einen eigenen Weg.
 *
 * SKR03 ist Zahl fuer Zahl der Stand, der bis zum 26.07.2026 fest im Quelltext
 * stand und heute gebucht wird. SKR04 ist die Entsprechung; sie ist KEINE
 * Ziffernvertauschung (Kasse 1000 wird 1600, Wareneingang 3200 wird 5200), wer
 * hier ein Muster unterstellt, liegt falsch — und die Differenzbesteuerung
 * paart 8191 mit 4136, nicht mit 8191 rueckwaerts gelesen.
 */
const ERWARTET: Readonly<Record<RahmenName, Readonly<Record<KontoName, string>>>> = {
  SKR03: {
    kasse: '1000', // das einzige Konto, das echtes Bargeld sieht
    bank: '1200',
    karte: '1361', // Geldtransit Kartenterminal
    sumup: '1362',
    mollie: '1363',
    stripe: '1364',
    stripeTerminal: '1366', // 26.07.2026 neu: der Leser, getrennt vom Shop-Stripe
    ebay: '1365',
    // 06.08.2026: NEU. BELEGT in beraterpraxis.md §3.1 und §6.3: „Geldtransit 1360".
    geldtransit: '1360',
    aufwandMiete: '4210',
    aufwandWerbung: '4600',
    aufwandPorto: '4910',
    aufwandBuerobedarf: '4930',
    aufwandReparatur: '4805',
    aufwandGebuehren: '4970',
    aufwandReise: '4670',
    aufwandSonstiges: '4900',
    wareneingang: '3200',
    erloese19: '8400', // Automatikkonto, Buchungsschluessel 3
    erloese7: '8300', // Automatikkonto, Buchungsschluessel 2
    erloese25a: '8200', // Differenzbesteuerung, kein Schluessel
    erloese25c: '8165', // 19.08.2026: 8150 → 8165 (§ 25c ist keine § 4-Befreiung)
    erloese13b: '8337', // Steuerschuld beim Leistungsempfaenger
    erloese25aEinkauf: '8193', // §§ 25/25a ohne USt: der Einkaufsanteil
    erloese25aMarge: '8191', // §§ 25/25a 19 % USt: die Differenz
    umsatzsteuer19: '1776', // das Steuerkonto der Marge
    erloeseKleinunternehmer: '8195', // steuerfrei ohne Vorsteuerabzug, § 19
    // 12.08.2026: amtlich geprueft im offiziellen SKR03 2025 (Art.-Nr. 11174):
    // 1796 „Ausgegebene Geschenkgutscheine", OHNE Automatikfunktion.
    gutscheinMehrzweck: '1796',
  },
  SKR04: {
    kasse: '1600',
    bank: '1800',
    karte: '1461',
    sumup: '1462',
    mollie: '1463',
    stripe: '1464',
    stripeTerminal: '1466',
    ebay: '1465',
    geldtransit: '1460',
    aufwandMiete: '6310',
    aufwandWerbung: '6600',
    aufwandPorto: '6800',
    aufwandBuerobedarf: '6815',
    // ⚠️ 6470, nicht 6485: der SKR04 trennt Betriebs- und
    // Geschäftsausstattung von „anderen Anlagen". Für einen Laden ist es die
    // Ladeneinrichtung.
    aufwandReparatur: '6470',
    aufwandGebuehren: '6855',
    aufwandReise: '6670',
    aufwandSonstiges: '6300',
    wareneingang: '5200',
    erloese19: '4400',
    erloese7: '4300',
    erloese25a: '4200',
    erloese25c: '4165',
    erloese13b: '4337',
    erloese25aEinkauf: '4138',
    erloese25aMarge: '4136',
    umsatzsteuer19: '3806',
    erloeseKleinunternehmer: '4195',
    // ⚠️ NICHT 3270: das ist im SKR04 ein AUTOMATIKKONTO („Erhaltene,
    // versteuerte Anzahlungen 16 % USt") und haette bei jeder Gutscheinbuchung
    // selbsttaetig 16 Prozent Steuer gerechnet.
    gutscheinMehrzweck: '3786',
  },
};

/** Der Einstellungsschluessel eines Kontos. Auch er von Hand, nicht importiert. */
const SCHLUESSEL: Readonly<Record<KontoName, string>> = {
  kasse: 'kasse',
  bank: 'bank',
  karte: 'geldtransit_karte',
  sumup: 'geldtransit_sumup',
  mollie: 'geldtransit_mollie',
  stripe: 'geldtransit_stripe',
  stripeTerminal: 'geldtransit_stripe_terminal',
  ebay: 'geldtransit_ebay',
  geldtransit: 'geldtransit',
  aufwandMiete: 'aufwand_miete',
  aufwandWerbung: 'aufwand_werbung',
  aufwandPorto: 'aufwand_porto',
  aufwandBuerobedarf: 'aufwand_buerobedarf',
  aufwandReparatur: 'aufwand_reparatur',
  aufwandGebuehren: 'aufwand_gebuehren',
  aufwandReise: 'aufwand_reise',
  aufwandSonstiges: 'aufwand_sonstiges',
  wareneingang: 'wareneingang',
  erloese19: 'erloese_standard_19',
  erloese7: 'erloese_reduced_7',
  erloese25a: 'erloese_margin_25a',
  erloese25c: 'erloese_gold_25c',
  erloese13b: 'erloese_reverse_charge_13b',
  erloese25aEinkauf: 'erloese_margin_25a_einkaufsanteil',
  erloese25aMarge: 'erloese_margin_25a_marge',
  umsatzsteuer19: 'umsatzsteuer_19',
  erloeseKleinunternehmer: 'erloese_kleinunternehmer_19',
  gutscheinMehrzweck: 'gutschein_mehrzweck',
};

function kontoSchluessel(rahmen: RahmenName, konto: KontoName): string {
  return `datev.konto.${rahmen.toLowerCase()}.${SCHLUESSEL[konto]}`;
}

// ── Der DATEV-Satz, Feld fuer Feld nachgezaehlt ────────────────────────────

/**
 * Feldpositionen im 125-Feld-Satz, als Index (Feldnummer minus eins).
 *
 * Von Hand uebernommen und nicht aus `datev-spalten.generiert.ts` importiert:
 * das Format ist positionsbasiert, ein verrutschtes Feld ist genau der Fehler,
 * den diese Datei sehen soll.
 */
const SPALTE = {
  UMSATZ: 0, // Feld 1
  SOLL_HABEN: 1, // Feld 2
  KONTO: 6, // Feld 7
  GEGENKONTO: 7, // Feld 8
  BU_SCHLUESSEL: 8, // Feld 9
  BELEGDATUM: 9, // Feld 10
  BELEGFELD_1: 10, // Feld 11 — traegt den receipt_locator
  BUCHUNGSTEXT: 13, // Feld 14
} as const;

/**
 * Kopfzeilenfelder, ebenfalls als Index.
 *
 * Feld 27 (Index 26) ist der Sachkontenrahmen. In der 125-Feld-BUCHUNGSZEILE
 * heisst Feld 27 dagegen „Beleginfo - Art 4" und hat mit dem Rahmen nichts zu
 * tun — deshalb steht diese Tafel getrennt.
 */
const KOPF = {
  ERZEUGT_AM: 5, // Feld 6 — Zeitstempel, unterscheidet sich zwischen zwei Abrufen
  BERATERNUMMER: 10, // Feld 11
  MANDANTENNUMMER: 11, // Feld 12
  WJ_BEGINN: 12, // Feld 13
  SACHKONTENLAENGE: 13, // Feld 14
  SACHKONTENRAHMEN: 26, // Feld 27
  BEZEICHNUNG: 16, // Feld 17 — der Name des Stapels in DATEVs Stapelliste
} as const;

interface Buchungszeile {
  umsatz: string; // '119,00'
  sollHaben: string; // 'S' | 'H'
  konto: string;
  gegenkonto: string;
  buSchluessel: string;
  belegfeld1: string;
  buchungstext: string;
  /** Alle 125 Felder roh, fuer den Zeichen-fuer-Zeichen-Vergleich. */
  felder: string[];
}

interface DatevDatei {
  kopf: string[];
  spalten: string;
  zeilen: Buchungszeile[];
  dateiname: string;
}

/** '119,00' → 11900n. Ganze Cent, niemals Fliesskomma. */
function centsAusDatev(betrag: string): bigint {
  const treffer = /^(\d+),(\d{2})$/.exec(betrag.trim());
  if (treffer === null) throw new Error(`Kein DATEV-Betrag: „${betrag}"`);
  return BigInt(treffer[1] ?? '0') * 100n + BigInt(treffer[2] ?? '0');
}

/**
 * Die Antwort in Kopf, Spaltenzeile und Buchungen zerlegen.
 *
 * Die Datei ist ANSI (Windows-1252), deshalb die ROHEN Bytes und `latin1`.
 */
function zerlege(res: LightMyRequestResponse): DatevDatei {
  const csv = Buffer.from(res.rawPayload).toString('latin1');
  const rohe = csv.split('\r\n').filter((z) => z.length > 0);
  const kopf = (rohe[0] ?? '').split(';');
  const spalten = rohe[1] ?? '';
  const zeilen = rohe.slice(2).map((z) => {
    const felder = z.split(';').map((c) => c.replace(/^"|"$/g, ''));
    return {
      umsatz: felder[SPALTE.UMSATZ] ?? '',
      sollHaben: felder[SPALTE.SOLL_HABEN] ?? '',
      konto: felder[SPALTE.KONTO] ?? '',
      gegenkonto: felder[SPALTE.GEGENKONTO] ?? '',
      buSchluessel: felder[SPALTE.BU_SCHLUESSEL] ?? '',
      belegfeld1: felder[SPALTE.BELEGFELD_1] ?? '',
      buchungstext: felder[SPALTE.BUCHUNGSTEXT] ?? '',
      felder,
    };
  });
  const verfuegung = String(res.headers['content-disposition'] ?? '');
  const dateiname = /filename="([^"]+)"/.exec(verfuegung)?.[1] ?? '';
  return { kopf, spalten, zeilen, dateiname };
}

// ── Die Antwortformen der Einstellungsoberflaeche ──────────────────────────

interface KontoAntwort {
  schluessel: string;
  konto: string;
  label: string;
  zweck: string;
  wert: string;
  vorlagewert: string;
  herkunft: string;
  quelle: string;
}

interface MandantAntwort {
  schluessel: string;
  label: string;
  hinweis: string;
  art: string;
  wert: string | null;
  herkunft: string;
}

interface DatevEinstellungenAntwort {
  rahmen: string;
  verfuegbareRahmen: { id: string; label: string; aktiv: boolean }[];
  mandant: MandantAntwort[];
  konten: KontoAntwort[];
}

interface FehlerAntwort {
  error: { code: string; message: string };
}

describe('Szenario Kontenrahmen — derselbe Tag in SKR03 und in SKR04', () => {
  const buehne = baueFiskalBuehne({ geschaeftstag: TAG });

  /**
   * Der Stand, den Wanderung 0115 wirklich hinterlassen hat.
   *
   * EINMAL abgelesen, bevor irgendein Test etwas anfasst, und vor jedem Test
   * wiederhergestellt. So laeuft JEDER Test dieser Datei gegen die echten
   * Vorgabewerte der Wanderung statt gegen die Testwerte der Buehne — genau
   * das ist der Zustand, den die Produktion nach dem Einspielen hat.
   */
  let wanderungsstand: { key: string; value: unknown; description: string | null }[] = [];

  beforeAll(async () => {
    await buehne.starten();
    wanderungsstand = await buehne.migratorSql<
      { key: string; value: unknown; description: string | null }[]
    >`SELECT key, value, description FROM system_settings WHERE key LIKE 'datev.%' ORDER BY key`;
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  /** Alles unter `datev.` loeschen und den Stand der Wanderung zurueckschreiben. */
  async function stelleWanderungsstandWieder(): Promise<void> {
    const m = buehne.migratorSql;
    await m`DELETE FROM system_settings WHERE key LIKE 'datev.%'`;
    for (const z of wanderungsstand) {
      await m`INSERT INTO system_settings (key, value, description)
              VALUES (${z.key}, ${m.json(z.value as never)}, ${z.description})`;
    }
  }

  beforeEach(async () => {
    // `datevEinstellungen: false` — die Buehne soll ihre eigenen Testwerte
    // NICHT saeen. Was gilt, ist der Stand der Wanderung.
    await buehne.leeren({ datevEinstellungen: false });
    await stelleWanderungsstandWieder();
  });

  // ── Handreichungen ──────────────────────────────────────────────────────

  /** Den DATEV-Stapel eines Abschlusses ziehen, wahlweise mit Rahmenwunsch. */
  function holeStapel(abschlussId: string, rahmen?: string): Promise<LightMyRequestResponse> {
    const anhang = rahmen === undefined ? '' : `?kontenrahmen=${encodeURIComponent(rahmen)}`;
    return buehne.hol(`/api/closings/${abschlussId}/export/datev${anhang}`);
  }

  /** Die Einstellungsoberflaeche lesen. */
  function holeEinstellungen(rahmen?: string): Promise<LightMyRequestResponse> {
    const anhang = rahmen === undefined ? '' : `?kontenrahmen=${encodeURIComponent(rahmen)}`;
    return buehne.hol(`/api/settings/datev${anhang}`);
  }

  /**
   * Genau eine Angabe aendern — ueber den ECHTEN Weg der Oberflaeche.
   *
   * Bewusst nicht ueber die Migratorrolle: der Schreibweg braucht auf
   * `system_settings` INSERT und UPDATE auf `value`, und ob die
   * Anwendungsrolle das wirklich darf, sieht man nur, wenn sie es tut.
   */
  function aendere(
    schluessel: string,
    wert: string | number | boolean,
  ): Promise<LightMyRequestResponse> {
    const wer = buehne.akteure;
    return buehne.app.inject({
      method: 'PATCH',
      url: `/api/settings/datev/${schluessel}`,
      headers: {
        cookie: `warehouse14.session=${wer.inhaberSitzung}`,
        'x-dev-device-fingerprint': wer.geraetFingerabdruck,
        'content-type': 'application/json',
      },
      payload: { value: wert },
    });
  }

  /**
   * Der Haendler traegt seine zwei Ordnungsnummern EINMAL ein — ueber den
   * ECHTEN Weg der Oberflaeche, wie er es an seinem ersten Tag tut.
   *
   * ── WARUM DAS SEIT WANDERUNG 0117 IN FAST JEDEM TEST STEHT ───────────────
   * 0115 hatte Beraternummer 1001 und Mandantennummer 1 als Vorgabewerte
   * gesaet. Das war die Anschrift EINES Steuerbueros, eingebacken in ein
   * Erzeugnis, das bei jedem kuenftigen Kunden mitlaeuft. 0117 nimmt sie
   * heraus; seither verweigert der Export, bis der Haendler seine eigenen
   * Zahlen eintraegt.
   *
   * Also tut dieser Test genau das, was der Laden tut, statt sich die Zahlen
   * per Migratorrolle in die Datenbank zu schreiben: er geht durch den
   * PATCH-Weg. Damit ist auch belegt, dass der Weg fuer den ERSTEN Kunden
   * wirklich funktioniert und nicht fuer ihn umgangen wurde.
   */
  async function trageOrdnungsnummernEin(): Promise<void> {
    const a = await aendere('datev.beraternummer', '29098');
    if (a.statusCode !== 200) throw new Error(`Beraternummer: ${a.statusCode} ${a.payload}`);
    const b = await aendere('datev.mandantennummer', '55003');
    if (b.statusCode !== 200) throw new Error(`Mandantennummer: ${b.statusCode} ${b.payload}`);
  }

  /**
   * Der Tag dieser Datei: NEUN Belege, die zusammen alle dreizehn logischen
   * Konten beruehren. (Bis zum 26.07.2026 acht; dazugekommen ist der
   * Stripe-Leser am Ladentisch, Wanderung 0120.)
   *
   * Jeder Betrag kommt genau einmal vor, damit keine Zeile mit einer anderen
   * verwechselt werden kann, und jeder bleibt unter der GwG-Schwelle von
   * 2.000 Euro — nur der Ankauf traegt einen ausweisgeprueften Kunden, weil
   * das Schema ihn dort verlangt (§ 259 StGB).
   *
   *   bar19      119,00  bar            → Kasse            an Erloese 19 %  (BU 3)
   *   karte7     107,00  Kartenterminal → Geldtransit      an Erloese 7 %   (BU 2)
   *   sumup25a   300,00  SumUp          → Geldtransit      an § 25a
   *   mollie25c  250,00  Mollie         → Geldtransit      an § 25c
   *   stripe19   238,00  Stripe         → Geldtransit      an Erloese 19 %  (BU 3)
   *   ebay19     357,00  eBay           → Geldtransit      an Erloese 19 %  (BU 3)
   *   bank7      214,00  Ueberweisung   → Bank             an Erloese 7 %   (BU 2)
   *   terminal19 476,00  Stripe-Leser   → Geldtransit      an Erloese 19 %  (BU 3)
   *   ankauf     500,00  bar            → Wareneingang     an Kasse
   *
   * Von Hand nachgerechnet:
   *   119,00 brutto zu 19 % → 11900 x 19 / 119 = 1900 Cent Steuer, GENAU.
   *   107,00 brutto zu  7 % → 10700 x  7 / 107 =  700 Cent Steuer, GENAU.
   *   238,00 brutto zu 19 % → 23800 x 19 / 119 = 3800 Cent Steuer, GENAU.
   *   357,00 brutto zu 19 % → 35700 x 19 / 119 = 5700 Cent Steuer, GENAU.
   *   214,00 brutto zu  7 % → 21400 x  7 / 107 = 1400 Cent Steuer, GENAU.
   *   476,00 brutto zu 19 % → 47600 x 19 / 119 = 7600 Cent Steuer, GENAU.
   *   § 25a: Einkauf 180,00, Verkauf 300,00 → Marge 12000 Cent;
   *          12000 x 19 / 119 = 228.000 / 119 = 1915,97 → 1916 Cent.
   *   § 25c: Anlagegold ist steuerfrei, Steuer 0.
   */
  async function baueDenTag(
    angaben: { ordnungsnummern?: boolean } = {},
  ): Promise<{ abschlussId: string; locator: Readonly<Record<string, string>> }> {
    const locator: Record<string, string> = {};

    async function verkauf(
      name: string,
      behandlung: string,
      satz: string | null,
      netto: string,
      steuer: string,
      brutto: string,
      zahlart: string,
      stunde: number,
      extra: { acquisition?: string; margin?: string } = {},
    ): Promise<void> {
      const produkt = await buehne.legeProduktAn({ behandlung });
      const beleg = await buehne.legeBelegAn({
        direction: 'VERKAUF',
        treatment: behandlung,
        subtotal: netto,
        vat: steuer,
        total: brutto,
        customerId: null,
        finalizedAt: buehne.ts(stunde),
        items: [
          {
            productId: produkt,
            treatment: behandlung,
            vatRate: satz,
            lineSubtotal: netto,
            lineVat: steuer,
            lineTotal: brutto,
            ...(extra.acquisition === undefined ? {} : { acquisition: extra.acquisition }),
            ...(extra.margin === undefined ? {} : { margin: extra.margin }),
            displayOrder: 0,
          },
        ],
        payment: { method: zahlart, amount: brutto },
        tse: true,
      });
      locator[name] = beleg.locator;
    }

    await verkauf('bar19', 'STANDARD_19', '0.1900', '100.00', '19.00', '119.00', 'CASH', 9);
    await verkauf('karte7', 'REDUCED_7', '0.0700', '100.00', '7.00', '107.00', 'ZVT_CARD', 10);
    await verkauf('sumup25a', 'MARGIN_25A', null, '280.84', '19.16', '300.00', 'SUMUP', 11, {
      acquisition: '180.00',
      margin: '120.00',
    });
    await verkauf(
      'mollie25c',
      'INVESTMENT_GOLD_25C',
      null,
      '250.00',
      '0.00',
      '250.00',
      'MOLLIE',
      12,
    );
    await verkauf('stripe19', 'STANDARD_19', '0.1900', '200.00', '38.00', '238.00', 'STRIPE', 13);
    await verkauf('ebay19', 'STANDARD_19', '0.1900', '300.00', '57.00', '357.00', 'EBAY', 14);
    await verkauf(
      'bank7',
      'REDUCED_7',
      '0.0700',
      '200.00',
      '14.00',
      '214.00',
      'BANK_TRANSFER',
      15,
    );
    await verkauf(
      'terminal19',
      'STANDARD_19',
      '0.1900',
      '400.00',
      '76.00',
      '476.00',
      'STRIPE_TERMINAL',
      17,
    );

    // Der Ankauf vom Privatmann: keine Umsatzsteuer, und immer mit einem
    // ausweisgeprueften Verkaeufer.
    const angekauft = await buehne.legeProduktAn({ behandlung: 'MARGIN_25A' });
    const ankauf = await buehne.legeBelegAn({
      direction: 'ANKAUF',
      treatment: 'MARGIN_25A',
      subtotal: '500.00',
      vat: '0.00',
      total: '500.00',
      customerId: buehne.akteure.kundeId,
      finalizedAt: buehne.ts(16),
      items: [
        {
          productId: angekauft,
          treatment: 'MARGIN_25A',
          vatRate: null,
          lineSubtotal: '500.00',
          lineVat: '0.00',
          lineTotal: '500.00',
          displayOrder: 0,
        },
      ],
      payment: { method: 'CASH', amount: '500.00' },
      tse: true,
    });
    locator.ankauf = ankauf.locator;

    // ── Der Abschluss kommt vom ECHTEN Weg, nicht von Hand ────────────────
    //
    // ⚠️ Bis zum 04.08.2026 stand hier `buehne.legeAbschlussAn`. Die
    // Wanderungen 0124 und 0125 verlangen bei einem festgeschriebenen
    // Abschluss jetzt zwei weitere Angaben: die fortlaufende Z-Nummer und die
    // Quelle des Kassensturzes. Beides KANN eine Buehne nicht sinnvoll
    // erfinden — die Z-Nummer ist eine Folge ueber alle Abschluesse, und die
    // Quelle sagt aus, WOHER die gezaehlte Zahl kommt. Beides rechnet der
    // Abschlussweg selbst aus.
    //
    // Deshalb laeuft hier `POST /api/closings/finalize`, und dafuer braucht
    // der Tag eine geschlossene Schicht. Der Kassenbestand: Anfangsbestand
    // 500,00 plus 119,00 bar vereinnahmt minus 500,00 bar ausgezahlt = 119,00.
    await buehne.migratorSql`
      INSERT INTO shifts (device_id, opened_by_user_id, opening_float_eur, status,
                          blind_count_eur, system_expected_eur, closed_by_user_id,
                          opened_at, closed_at)
      VALUES (${buehne.akteure.geraetId}, ${buehne.akteure.inhaberId}, '500.00',
              'CLOSED'::shift_status, '119.00', '119.00',
              ${buehne.akteure.inhaberId},
              ${buehne.ts(8)}::timestamptz, ${buehne.ts(21)}::timestamptz)`;

    const antwort = await buehne.sende('/api/closings/finalize', { businessDay: TAG });
    if (antwort.statusCode !== 200) {
      throw new Error(`Tagesabschluss ${TAG}: ${antwort.statusCode} ${antwort.payload}`);
    }
    const abschlussId = (antwort.json() as { id: string }).id;

    // Der Haendler richtet DATEV ein, bevor er zum ersten Mal exportiert —
    // seit Wanderung 0117 der Regelweg. `ordnungsnummern: false` laesst es
    // bewusst weg, wer genau diese Verweigerung pruefen will.
    if (angaben.ordnungsnummern !== false) await trageOrdnungsnummernEin();

    return { abschlussId, locator };
  }

  /**
   * Die erwartete Kontierung je Beleg — Konto und Gegenkonto, je Rahmen.
   *
   * Verkauf: das Geldkonto steht im Soll, das Erloeskonto im Haben.
   * Ankauf:  der Wareneingang steht im Soll, das Geldkonto im Haben.
   */
  interface ErwarteteZeile {
    readonly konto: KontoName;
    readonly gegenkonto: KontoName;
    readonly bu: string;
    readonly umsatz: string;
  }

  /**
   * ⚠️ Je Beleg eine LISTE, nicht eine Zeile. Der § 25a-Beleg erzeugt seit dem
   * 27.07.2026 ZWEI Buchungszeilen: den Einkaufsanteil ohne Steuer und die
   * Marge mit 19 Prozent. Von Hand fuer `sumup25a`, Verkauf 300,00 bei
   * Einkauf 180,00:
   *     Einkaufsanteil  min(180,00; 300,00) = 180,00  → ohne Schluessel
   *     Marge           300,00 − 180,00     = 120,00  → Schluessel 3
   * Die Deckelung auf den Zeilenbetrag ist kein Beiwerk: bei einem
   * Verlustverkauf stuende sonst ein erfundener Erloes in der Datei.
   */
  const KONTIERUNG: Readonly<Record<string, readonly ErwarteteZeile[]>> = {
    bar19: [{ konto: 'kasse', gegenkonto: 'erloese19', bu: '', umsatz: '119,00' }],
    karte7: [{ konto: 'karte', gegenkonto: 'erloese7', bu: '', umsatz: '107,00' }],
    sumup25a: [
      { konto: 'sumup', gegenkonto: 'erloese25aEinkauf', bu: '', umsatz: '180,00' },
      { konto: 'sumup', gegenkonto: 'erloese25aMarge', bu: '', umsatz: '120,00' },
    ],
    mollie25c: [{ konto: 'mollie', gegenkonto: 'erloese25c', bu: '', umsatz: '250,00' }],
    stripe19: [{ konto: 'stripe', gegenkonto: 'erloese19', bu: '', umsatz: '238,00' }],
    ebay19: [{ konto: 'ebay', gegenkonto: 'erloese19', bu: '', umsatz: '357,00' }],
    bank7: [{ konto: 'bank', gegenkonto: 'erloese7', bu: '', umsatz: '214,00' }],
    terminal19: [
      { konto: 'stripeTerminal', gegenkonto: 'erloese19', bu: '', umsatz: '476,00' },
    ],
    ankauf: [{ konto: 'wareneingang', gegenkonto: 'kasse', bu: '', umsatz: '500,00' }],
  };

  /**
   * Die logischen Konten, die DIESER Tag wirklich beruehrt.
   *
   * Es sind VIERZEHN von achtzehn. Nicht dabei sind § 13b, der
   * Kleinunternehmer und das Steuerkonto — die drei haben an diesem Tag
   * keinen Beleg. Und `erloese25a` (8200) ist seit der Aufteilung ebenfalls
   * nicht mehr dabei: ein Verkauf nach § 25a landet auf den beiden
   * Nachfolgekonten, nie mehr auf dem Sammelkonto.
   */
  const BERUEHRTE_KONTEN: readonly KontoName[] = [
    'kasse',
    'bank',
    'karte',
    'sumup',
    'mollie',
    'stripe',
    'stripeTerminal',
    'ebay',
    'wareneingang',
    'erloese19',
    'erloese7',
    'erloese25c',
    'erloese25aEinkauf',
    'erloese25aMarge',
  ];

  /** Alle Buchungszeilen EINES Belegs, in der Reihenfolge der Datei. */
  function zeilenZu(datei: DatevDatei, beleg: string | undefined): Buchungszeile[] {
    return datei.zeilen.filter((z) => z.belegfeld1 === beleg);
  }

  // ══════════════════════════════════════════════════════════════════════
  //  1. Ein Rahmenwechsel bewegt keinen Cent
  // ══════════════════════════════════════════════════════════════════════

  it('zieht denselben Tag in SKR03 und SKR04 mit Zeichen fuer Zeichen denselben Betraegen', async () => {
    const { abschlussId } = await baueDenTag();

    const res03 = await holeStapel(abschlussId, 'SKR03');
    const res04 = await holeStapel(abschlussId, 'SKR04');
    expect(res03.statusCode).toBe(200);
    expect(res04.statusCode).toBe(200);

    const d03 = zerlege(res03);
    const d04 = zerlege(res04);

    // Neun Belege, je eine Zahlart — aber ZEHN Buchungszeilen: der Beleg nach
    // § 25a zerfaellt in Einkaufsanteil und Marge.
    expect(d03.zeilen).toHaveLength(10);
    expect(d04.zeilen).toHaveLength(10);
    expect(d03.spalten).toBe(d04.spalten);

    // ── Die Kopfzeile: nur Feld 27 darf sich unterscheiden ────────────────
    // Feld 6 (erzeugt am) ist ein Zeitstempel und gehoert nicht zur Aussage.
    expect(d04.kopf).toHaveLength(d03.kopf.length);
    for (let i = 0; i < d03.kopf.length; i++) {
      if (i === KOPF.ERZEUGT_AM || i === KOPF.SACHKONTENRAHMEN) continue;
      expect(d04.kopf[i], `Kopf-Feld ${i + 1} unterscheidet sich`).toBe(d03.kopf[i]);
    }
    expect(d03.kopf[KOPF.SACHKONTENRAHMEN]).toBe('"03"');
    expect(d04.kopf[KOPF.SACHKONTENRAHMEN]).toBe('"04"');

    // Der Dateiname traegt den Rahmen NICHT — er kommt aus Berater-,
    // Mandantennummer und Zeitraum. Zwei Dateien mit demselben Namen sind
    // gewollt: es ist derselbe Tag desselben Mandanten.
    expect(d04.dateiname).toBe(d03.dateiname);

    // ── Die Buchungszeilen: alles ausser Feld 7 und Feld 8 ist gleich ─────
    let konten_unterschiedlich = 0;
    for (let z = 0; z < d03.zeilen.length; z++) {
      const a = d03.zeilen[z]!;
      const b = d04.zeilen[z]!;
      expect(b.felder, `Zeile ${z + 1} hat eine andere Feldzahl`).toHaveLength(a.felder.length);
      for (let f = 0; f < a.felder.length; f++) {
        if (f === SPALTE.KONTO || f === SPALTE.GEGENKONTO) continue;
        expect(b.felder[f], `Zeile ${z + 1}, Feld ${f + 1} unterscheidet sich`).toBe(a.felder[f]);
      }
      // Und die Konten muessen sich WIRKLICH unterscheiden — sonst waere der
      // Vergleich oben erfuellt, ohne dass ein Rahmenwechsel stattgefunden hat.
      expect(b.konto).not.toBe(a.konto);
      expect(b.gegenkonto).not.toBe(a.gegenkonto);
      konten_unterschiedlich += 1;
    }
    expect(konten_unterschiedlich).toBe(10);

    // Die Summenprobe noch einmal ausdruecklich, weil sie die eigentliche
    // Zusage ist: 11900 + 10700 + (18000 + 12000) + 25000 + 23800 + 35700
    // + 21400 + 47600 + 50000 = 256100 Cent. Die Aufteilung des § 25a-Belegs
    // bewegt keinen Cent: 18000 + 12000 sind genau die 30000 von vorher.
    const summe = (d: DatevDatei): bigint =>
      d.zeilen.reduce((s, z) => s + centsAusDatev(z.umsatz), 0n);
    expect(summe(d03)).toBe(256_100n);
    expect(summe(d04)).toBe(256_100n);
    expect(d04.zeilen.map((z) => z.umsatz)).toEqual(d03.zeilen.map((z) => z.umsatz));
  });

  // ══════════════════════════════════════════════════════════════════════
  //  2. Jedes logische Konto auf seiner eigenen Zahl
  // ══════════════════════════════════════════════════════════════════════

  it('setzt jedes logische Konto in beiden Rahmen auf seine eigene Zahl, und keine Zahl doppelt', async () => {
    const { abschlussId, locator } = await baueDenTag();

    for (const rahmen of ['SKR03', 'SKR04'] as const) {
      const res = await holeStapel(abschlussId, rahmen);
      expect(res.statusCode).toBe(200);
      const datei = zerlege(res);
      expect(datei.zeilen).toHaveLength(10);

      const gesehen = new Set<string>();
      for (const [name, erwarteteZeilen] of Object.entries(KONTIERUNG)) {
        const zeilen = zeilenZu(datei, locator[name]);
        expect(zeilen.length, `${rahmen}: falsche Zeilenzahl fuer ${name}`).toBe(
          erwarteteZeilen.length,
        );
        for (const [i, erwartet] of erwarteteZeilen.entries()) {
          const zeile = zeilen[i] as Buchungszeile;
          expect(zeile.konto, `${rahmen}/${name} Zeile ${i + 1}: falsches Konto`).toBe(
            ERWARTET[rahmen][erwartet.konto],
          );
          expect(zeile.gegenkonto, `${rahmen}/${name} Zeile ${i + 1}: falsches Gegenkonto`).toBe(
            ERWARTET[rahmen][erwartet.gegenkonto],
          );
          expect(
            zeile.buSchluessel,
            `${rahmen}/${name} Zeile ${i + 1}: falscher Buchungsschluessel`,
          ).toBe(erwartet.bu);
          expect(zeile.umsatz, `${rahmen}/${name} Zeile ${i + 1}: falscher Betrag`).toBe(
            erwartet.umsatz,
          );
          // Verkauf wie Ankauf buchen auf der Sollseite; die Richtung steckt in
          // der Wahl der Konten, nicht im Vorzeichen.
          expect(zeile.sollHaben).toBe('S');
          gesehen.add(zeile.konto);
          gesehen.add(zeile.gegenkonto);
        }
      }

      // Der Tag beruehrt VIERZEHN logische Konten, und vierzehn logische
      // Konten sind vierzehn VERSCHIEDENE Zahlen. Kollidieren zwei — etwa die
      // Erloese zu 19 und zu 7 Prozent —, dann bucht das Programm zwei
      // Steuersaetze auf ein Automatikkonto, und die Datei sieht dabei
      // vollkommen unauffaellig aus.
      expect(gesehen.size, `${rahmen}: zwei logische Konten teilen sich eine Zahl`).toBe(
        BERUEHRTE_KONTEN.length,
      );
      for (const konto of BERUEHRTE_KONTEN) {
        expect(gesehen.has(ERWARTET[rahmen][konto]), `${rahmen}: ${konto} fehlt in der Datei`).toBe(
          true,
        );
      }
      // Und das alte Sammelkonto der Differenzbesteuerung kommt NICHT mehr
      // vor: der volle Verkaufspreis stand dort steuerfrei, das war der Fund.
      expect(gesehen.has(ERWARTET[rahmen].erloese25a)).toBe(false);
    }

    // Und keine einzige Zahl kommt in BEIDEN Rahmen vor. Eine gemeinsame Zahl
    // waere ein stiller Rueckfall auf den anderen Rahmen.
    const in03 = new Set(ALLE_KONTEN.map((k) => ERWARTET.SKR03[k]));
    for (const konto of ALLE_KONTEN) {
      expect(in03.has(ERWARTET.SKR04[konto]), `${konto}: SKR04 traegt eine SKR03-Zahl`).toBe(false);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  3. Die Oberflaeche und die Datei duerfen nicht auseinanderfallen
  // ══════════════════════════════════════════════════════════════════════

  it('nennt in der Oberflaeche genau die Zahlen, die auch in der Datei stehen', async () => {
    const { abschlussId, locator } = await baueDenTag();

    for (const rahmen of ['SKR03', 'SKR04'] as const) {
      const res = await holeEinstellungen(rahmen);
      expect(res.statusCode).toBe(200);
      const antwort = res.json() as DatevEinstellungenAntwort;
      expect(antwort.rahmen).toBe(rahmen);
      expect(antwort.konten).toHaveLength(ALLE_KONTEN.length);
      expect(antwort.verfuegbareRahmen.map((r) => r.id).sort()).toEqual(['SKR03', 'SKR04']);
      expect(antwort.verfuegbareRahmen.filter((r) => r.aktiv).map((r) => r.id)).toEqual([rahmen]);

      const werte = new Map(antwort.konten.map((k) => [k.schluessel, k.wert]));
      for (const konto of ALLE_KONTEN) {
        expect(
          werte.get(kontoSchluessel(rahmen, konto)),
          `${rahmen}: die Oberflaeche nennt fuer ${konto} eine andere Zahl`,
        ).toBe(ERWARTET[rahmen][konto]);
      }

      // Und jetzt die Gegenprobe gegen die AUSGELIEFERTE Datei: was die
      // Oberflaeche zeigt, muss in der Datei stehen. Faellt beides
      // auseinander, sieht der Inhaber eine Zahl und der Berater bekommt
      // eine andere — das ist die Fehlerklasse, die dieses Haus schon
      // mehrfach getroffen hat.
      const datei = zerlege(await holeStapel(abschlussId, rahmen));
      for (const [name, erwarteteZeilen] of Object.entries(KONTIERUNG)) {
        const zeilen = zeilenZu(datei, locator[name]);
        for (const [i, erwartet] of erwarteteZeilen.entries()) {
          const zeile = zeilen[i] as Buchungszeile;
          expect(zeile.konto).toBe(werte.get(kontoSchluessel(rahmen, erwartet.konto)));
          expect(zeile.gegenkonto).toBe(werte.get(kontoSchluessel(rahmen, erwartet.gegenkonto)));
        }
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  4. Eine einzelne Ueberschreibung aus der App wirkt bis in die Datei
  // ══════════════════════════════════════════════════════════════════════

  it('laesst eine einzelne Ueberschreibung aus der App bis in die Datei durch, und nur im gewaehlten Rahmen', async () => {
    const { abschlussId, locator } = await baueDenTag();

    // Vorher: die Vorlage. Bar vereinnahmt landet auf 1000.
    const vorher = zerlege(await holeStapel(abschlussId, 'SKR03'));
    expect(vorher.zeilen.find((z) => z.belegfeld1 === locator.bar19)?.konto).toBe('1000');

    // Der Inhaber aendert GENAU EIN Konto, ueber den echten Weg der App.
    const geaendert = await aendere(kontoSchluessel('SKR03', 'kasse'), '1010');
    expect(geaendert.statusCode).toBe(200);
    const bestaetigung = geaendert.json() as { schluessel: string; wert: string; herkunft: string };
    expect(bestaetigung.wert).toBe('1010');
    expect(bestaetigung.herkunft).toBe('BESTAETIGT');

    // Nachher: dieselbe Datei, dieselben Betraege, das eine Konto neu.
    const nachher = zerlege(await holeStapel(abschlussId, 'SKR03'));
    expect(nachher.zeilen).toHaveLength(vorher.zeilen.length);
    expect(nachher.zeilen.find((z) => z.belegfeld1 === locator.bar19)?.konto).toBe('1010');
    // Der Ankauf traegt die Kasse auf der Gegenseite — auch dort.
    expect(nachher.zeilen.find((z) => z.belegfeld1 === locator.ankauf)?.gegenkonto).toBe('1010');

    // 1000 kommt in der ganzen Datei nicht mehr als Konto oder Gegenkonto vor.
    for (const z of nachher.zeilen) {
      expect(z.konto).not.toBe('1000');
      expect(z.gegenkonto).not.toBe('1000');
    }

    // Kein Cent hat sich bewegt.
    expect(nachher.zeilen.map((z) => z.umsatz)).toEqual(vorher.zeilen.map((z) => z.umsatz));

    // Und die Ueberschreibung gilt NUR fuer SKR03. Ein Rahmen ist ein eigener
    // Bestand; die Zahl des einen dort einzutragen, wo der andere gilt, waere
    // genau der Fehler, gegen den die getrennten Schluessel gebaut sind.
    const skr04 = zerlege(await holeStapel(abschlussId, 'SKR04'));
    expect(skr04.zeilen.find((z) => z.belegfeld1 === locator.bar19)?.konto).toBe('1600');
    for (const z of skr04.zeilen) expect(z.konto).not.toBe('1010');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  5. Ein unbekannter Rahmen ist ein Eingabefehler, kein Serverfehler
  // ══════════════════════════════════════════════════════════════════════

  it('weist einen unbekannten Kontenrahmen auf Deutsch ab, mit 400 und nicht mit einem 500', async () => {
    const { abschlussId } = await baueDenTag();

    for (const unfug of ['SKR07', 'SKR99', '17', 'Quatsch']) {
      const res = await holeStapel(abschlussId, unfug);
      expect(res.statusCode, `„${unfug}" haette 400 ergeben muessen`).toBe(400);
      const fehler = res.json() as FehlerAntwort;
      expect(fehler.error.message).toContain('nicht bekannt');
      expect(fehler.error.message).toContain('SKR03');
      expect(fehler.error.message).toContain('SKR04');
      expect(fehler.error.message).toContain('Steuerberater');
      // Kein englischer Schemafehler von Fastify: der Bediener soll die
      // deutsche Meldung lesen, deshalb nimmt die Route freien Text entgegen.
      expect(fehler.error.message).not.toContain('querystring');
      expect(fehler.error.message).not.toContain('must be equal');
    }

    // Auch die Oberflaeche weist ihn ab, statt still auf SKR03 zurueckzufallen.
    const einstellungen = await holeEinstellungen('SKR07');
    expect(einstellungen.statusCode).toBe(400);
    expect((einstellungen.json() as FehlerAntwort).error.message).toContain('nicht bekannt');

    // Die bekannten Schreibweisen gehen weiterhin durch — sonst waere die
    // Abweisung oben nur Strenge, keine Pruefung.
    for (const gut of ['SKR03', 'skr03', '03']) {
      const res = await holeStapel(abschlussId, gut);
      expect(res.statusCode, `„${gut}" haette 200 ergeben muessen`).toBe(200);
      expect(zerlege(res).kopf[KOPF.SACHKONTENRAHMEN]).toBe('"03"');
    }
    for (const gut of ['SKR04', 'skr04', '04']) {
      const res = await holeStapel(abschlussId, gut);
      expect(res.statusCode, `„${gut}" haette 200 ergeben muessen`).toBe(200);
      expect(zerlege(res).kopf[KOPF.SACHKONTENRAHMEN]).toBe('"04"');
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  5b. FUND — die einstellige Schreibweise kommt nicht durch
  // ══════════════════════════════════════════════════════════════════════

  it('FUND: „3" und „4" werden beim Export mit 409 und einer irrefuehrenden Meldung abgewiesen', async () => {
    // Dieser Test haelt fest, was das System HEUTE tut, KEINEN Sollzustand.
    // Wird der Mangel behoben, MUSS er rot werden — und dann auf die richtige
    // Erwartung umgestellt, nicht weggeworfen.
    //
    // GEMESSEN am 26.07.2026 ueber HTTP und noch einmal einzeln gegen
    // `ladeDatevMandant`:
    //   SKR03 skr03 03 → 200        3 → 409
    //   SKR04 skr04 04 → 200        4 → 409
    //   SKR07          → 400 mit der deutschen Meldung
    //
    // Die Ursache steht in `src/lib/datev-mandant.ts`: der Wunsch wird dort
    // NUR um ein fuehrendes „SKR" gekuerzt und danach woertlich mit '03' und
    // '04' verglichen. `normalisiereRahmen`, das die Null vorne ergaenzt, wird
    // im Fehlerzweig zwar aufgerufen, wirft bei „3" aber gerade NICHT — und
    // gleich darauf schlaegt die Verweigerung wegen fehlender Einrichtung zu.
    //
    // Zwei Dinge sind daran schlimmer als der abgewiesene Abruf selbst:
    //   1. Die Meldung nennt den GESPEICHERTEN Wert („SKR03"), nicht den
    //      eingegebenen. Sie liest sich als „SKR03 muss SKR03 sein" und
    //      schickt den Inhaber in seine Einstellungen, wo alles stimmt.
    //   2. 409 heisst „nicht eingerichtet". Der Mangel liegt aber am
    //      Abfrageparameter, also beim Bediener, und gehoert nach 400 —
    //      genau die Trennung, die `KontenrahmenUnbekanntError` zieht.
    //
    // Die Oberflaeche `GET /api/settings/datev` nimmt „3" dagegen an. Zwei
    // Wege desselben Hauses beurteilen dieselbe Eingabe verschieden.
    const { abschlussId } = await baueDenTag();

    for (const kurz of ['3', '4']) {
      const res = await holeStapel(abschlussId, kurz);
      expect(res.statusCode, `„${kurz}" wird heute mit 409 abgewiesen`).toBe(409);
      const meldung = (res.json() as FehlerAntwort).error.message;
      expect(meldung).toContain('Der Kontenrahmen muss SKR03 oder SKR04 sein');
      // Die Meldung zitiert den GESPEICHERTEN Rahmen, nicht die Eingabe.
      expect(meldung).toContain('SKR03');
      expect(meldung).not.toContain(`„${kurz}"`);
    }

    // Und die Oberflaeche ist derselben Meinung NICHT.
    const einstellungen = await holeEinstellungen('3');
    expect(einstellungen.statusCode).toBe(200);
    expect((einstellungen.json() as DatevEinstellungenAntwort).rahmen).toBe('SKR03');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  6. Die sechs Angaben blockieren nicht mehr — die Wand steht trotzdem
  // ══════════════════════════════════════════════════════════════════════

  /**
   * ── DER SOLLZUSTAND SEIT WANDERUNG 0117 (26.07.2026) ─────────────────────
   * Diese Probe hiess bis heute „exportiert mit den Vorgabewerten der
   * Wanderung" und hielt fest, dass Beraternummer 1001 und Mandantennummer 1
   * in der Kopfzeile stehen. Das WAR der Zustand, und er war falsch: 1001
   * gehoert einer bestimmten Kanzlei, nicht diesem Erzeugnis.
   *
   * 0117 nimmt beide heraus. Der neue Sollzustand: die Wanderung hinterlaesst
   * VIER mandantenneutrale Angaben, der Export verweigert, bis der Haendler
   * seine zwei Ordnungsnummern eintraegt, und danach laeuft er.
   */
  it('hinterlaesst nur die VIER mandantenneutralen Angaben, verweigert bis der Haendler seine zwei Zahlen eintraegt, und laeuft dann', async () => {
    // ── 1. Was die Wanderungen wirklich hinterlassen ─────────────────────
    // Die Buehne hat ihre Testwerte in dieser Datei nie gesaet (siehe
    // `beforeEach`), also steht hier ausschliesslich der Stand der Wanderungen.
    const gesetzt = await buehne.migratorSql<{ key: string; value: unknown }[]>`
      SELECT key, value FROM system_settings WHERE key LIKE 'datev.%' ORDER BY key`;
    // ⚠️ Seit Wanderung 0126 stehen die zwei Ordnungsnummern als SCHLUESSEL
    // da. Das ist kein Rueckfall hinter 0117: die Wanderung legt nur das Fach
    // an, und zwar ausdruecklich LEER. Ein leeres Fach sperrt den Export mit
    // einer ehrlichen Meldung; ein gefuelltes Fach mit einem Platzhalter
    // erzeugte eine Datei, die vollstaendig aussieht und einem fremden
    // Betrieb gehoert. Genau das war der Fehler von 0115.
    expect(gesetzt.map((z) => z.key)).toEqual([
      'datev.beraternummer',
      'datev.festschreibung',
      'datev.mandantennummer',
      'datev.platzhalter',
      'datev.sachkontenlaenge',
      'datev.sachkontenrahmen',
      'datev.wirtschaftsjahr_beginn',
    ]);

    // Und die entscheidende Probe dazu: die beiden tragen KEINEN Wert. Stuende
    // dort eine Zahl, gehoerte sie einer bestimmten Kanzlei und liefe bei
    // jedem kuenftigen Kunden mit.
    const werteJeSchluessel = new Map(gesetzt.map((z) => [z.key, z.value]));
    expect(werteJeSchluessel.get('datev.beraternummer')).toBe('');
    expect(werteJeSchluessel.get('datev.mandantennummer')).toBe('');

    // Und in der Platzhalterliste steht KEINE der beiden Ordnungsnummern mehr.
    const [liste] = await buehne.migratorSql<{ value: string[] }[]>`
      SELECT value FROM system_settings WHERE key = 'datev.platzhalter'`;
    expect(liste?.value).toEqual([
      'datev.festschreibung',
      'datev.sachkontenlaenge',
      'datev.sachkontenrahmen',
      'datev.wirtschaftsjahr_beginn',
    ]);

    // ── 2. Ohne die zwei Zahlen gibt es KEINE Datei ──────────────────────
    const { abschlussId } = await baueDenTag({ ordnungsnummern: false });

    const ohne = await holeStapel(abschlussId);
    expect(ohne.statusCode).toBe(409);
    const fehler = (ohne.json() as FehlerAntwort).error;
    // Der eigene Code, an dem die Flaeche ein Einrichtungsformular zeigt
    // statt einer roten Meldung.
    expect(fehler.code).toBe('DATEV_MANDANT_FEHLT');
    expect(fehler.message).toContain('Beraternummer');
    expect(fehler.message).toContain('Mandantennummer');
    expect(fehler.message).toContain('Steuerberater');
    expect(fehler.message).toContain('fremden Betriebs');

    // ── 3. Der Haendler traegt sie EINMAL ein, dann laeuft es ────────────
    await trageOrdnungsnummernEin();

    const res = await holeStapel(abschlussId);
    expect(res.statusCode).toBe(200);
    const datei = zerlege(res);

    // SEINE Zahlen stehen in der Kopfzeile und im Dateinamen, keine fremden.
    expect(datei.kopf[KOPF.BERATERNUMMER]).toBe('29098');
    expect(datei.kopf[KOPF.MANDANTENNUMMER]).toBe('55003');
    expect(datei.dateiname).toBe(`EXTF_Buchungsstapel_29098_55003_${TAG}_${TAG}.csv`);

    // Die vier neutralen Vorgabewerte gelten unveraendert weiter.
    expect(datei.kopf[KOPF.SACHKONTENLAENGE]).toBe('4');
    expect(datei.kopf[KOPF.SACHKONTENRAHMEN]).toBe('"03"');
    // Der Wirtschaftsjahresbeginn wurde gerechnet, nicht hingeschrieben:
    // 1. Januar des laufenden Jahres, achtstellig.
    expect(datei.kopf[KOPF.WJ_BEGINN]).toMatch(/^\d{4}0101$/);

    // ── 4. Die Wand steht auch bei einem UNSINNIGEN Wert ─────────────────
    // Eine Sachkontenlaenge von 9 gibt es nicht. Sie von Hand in die
    // Datenbank zu schreiben ist der einzige Weg dorthin, denn der
    // Aenderungsweg der App laesst sie gar nicht erst zu:
    const abgewiesen = await aendere('datev.sachkontenlaenge', 9);
    expect(abgewiesen.statusCode).toBe(400);
    expect((abgewiesen.json() as FehlerAntwort).error.message).toContain('vier bis acht');

    await buehne.migratorSql`
      UPDATE system_settings SET value = to_jsonb(9) WHERE key = 'datev.sachkontenlaenge'`;
    const blockiert = await holeStapel(abschlussId);
    expect(blockiert.statusCode).toBe(409);
    const meldung = (blockiert.json() as FehlerAntwort).error;
    expect(meldung.message).toContain('Sachkontenlänge');
    expect(meldung.message).toContain('vier bis acht');
    // Ein unsinniger Wert ist KEIN Einrichtungsmangel: die Flaeche darf darauf
    // kein Einrichtungsformular zeigen, sondern muss den Wert nennen.
    expect(meldung.code).toBe('CONFLICT');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  7. Vorschlag oder bestaetigt — das ehrliche Merkmal
  // ══════════════════════════════════════════════════════════════════════

  it('meldet frisch Vorschlag und nach dem Speichern bestaetigt, fuer Konten wie fuer Mandantenangaben', async () => {
    // ── Frisch nach der Wanderung: NICHTS ist bestaetigt ──────────────────
    const frisch = (await holeEinstellungen()).json() as DatevEinstellungenAntwort;
    expect(frisch.rahmen).toBe('SKR03');
    expect(frisch.konten).toHaveLength(ALLE_KONTEN.length);
    for (const k of frisch.konten) {
      expect(k.herkunft, `${k.schluessel} sollte ein Vorschlag sein`).toBe('VORSCHLAG');
      expect(k.wert).toBe(k.vorlagewert);
      // Zu jeder Zahl steht, woher sie stammt — im Klartext, nicht als Kuerzel.
      expect(k.quelle.length).toBeGreaterThan(20);
    }
    // ── Die sechs Mandantenangaben zerfallen seit 0117 in ZWEI Gruppen ───
    // VIER mandantenneutrale Vorgabewerte stehen da und sind unbestaetigt.
    // ZWEI gehoeren dem Steuerberater und FEHLEN schlicht — sie standen nie
    // in einer Wanderung und werden auch nie darin stehen.
    expect(frisch.mandant).toHaveLength(6);
    const NEUTRAL = [
      'datev.wirtschaftsjahr_beginn',
      'datev.sachkontenlaenge',
      'datev.festschreibung',
      'datev.sachkontenrahmen',
    ];
    const DEM_BERATER = ['datev.beraternummer', 'datev.mandantennummer'];
    for (const f of frisch.mandant) {
      if (DEM_BERATER.includes(f.schluessel)) {
        expect(f.herkunft, `${f.schluessel} darf aus KEINER Wanderung kommen`).toBe('FEHLT');
        // ⚠️ Seit Wanderung 0126 gibt es das Fach, und es ist LEER — also der
        // leere Text und nicht `null`. Die Oberflaeche gibt den gespeicherten
        // Wert unveraendert wieder, statt ihn umzudeuten; die Aussage
        // „eingetragen oder nicht" traegt `herkunft`, und die steht auf FEHLT.
        // Dass daran wirklich der Export haengt, misst die Probe darueber:
        // ohne die zwei Zahlen antwortet sie mit 409 DATEV_MANDANT_FEHLT.
        expect(f.wert, `${f.schluessel} darf keinen Wert tragen`).toBe('');
        continue;
      }
      expect(NEUTRAL).toContain(f.schluessel);
      expect(f.herkunft, `${f.schluessel} sollte ein Vorschlag sein`).toBe('VORSCHLAG');
      expect(f.wert).not.toBeNull();
    }

    // ── Ein Konto speichern ──────────────────────────────────────────────
    const schluesselKasse = kontoSchluessel('SKR03', 'kasse');
    expect((await aendere(schluesselKasse, '1010')).statusCode).toBe(200);

    const nachKonto = (await holeEinstellungen()).json() as DatevEinstellungenAntwort;
    const kasse = nachKonto.konten.find((k) => k.schluessel === schluesselKasse);
    expect(kasse?.herkunft).toBe('BESTAETIGT');
    expect(kasse?.wert).toBe('1010');
    // Die Vorlagezahl bleibt sichtbar — der Inhaber soll sehen, wovon er
    // abgewichen ist.
    expect(kasse?.vorlagewert).toBe('1000');
    for (const k of nachKonto.konten) {
      if (k.schluessel === schluesselKasse) continue;
      expect(k.herkunft, `${k.schluessel} wurde faelschlich bestaetigt`).toBe('VORSCHLAG');
    }
    // Die Mandantenangaben hat niemand angefasst: die vier neutralen stehen
    // weiter als Vorschlag, die zwei des Beraters fehlen weiter.
    for (const f of nachKonto.mandant) {
      expect(f.herkunft).toBe(DEM_BERATER.includes(f.schluessel) ? 'FEHLT' : 'VORSCHLAG');
    }

    // Der andere Rahmen bleibt unberuehrt: dieselbe Kasse, dort weiterhin
    // Vorschlag und Vorlagezahl.
    const anderer = (await holeEinstellungen('SKR04')).json() as DatevEinstellungenAntwort;
    const kasse04 = anderer.konten.find((k) => k.schluessel === kontoSchluessel('SKR04', 'kasse'));
    expect(kasse04?.wert).toBe('1600');
    expect(kasse04?.herkunft).toBe('VORSCHLAG');
    // Ansehen stellt nicht um: der geltende Rahmen ist danach immer noch SKR03.
    expect(((await holeEinstellungen()).json() as DatevEinstellungenAntwort).rahmen).toBe('SKR03');

    // ── Eine Mandantenangabe speichern ───────────────────────────────────
    // Die Beraternummer fehlt, bis ein Mensch sie eintraegt. Sobald er das
    // tut, gilt sie als bestaetigt — und NUR sie.
    expect((await aendere('datev.beraternummer', '29098')).statusCode).toBe(200);

    const nachMandant = (await holeEinstellungen()).json() as DatevEinstellungenAntwort;
    const berater = nachMandant.mandant.find((f) => f.schluessel === 'datev.beraternummer');
    expect(berater?.wert).toBe('29098');
    expect(berater?.herkunft).toBe('BESTAETIGT');
    for (const f of nachMandant.mandant) {
      if (f.schluessel === 'datev.beraternummer') continue;
      expect(f.herkunft, `${f.schluessel} wurde faelschlich bestaetigt`).toBe(
        f.schluessel === 'datev.mandantennummer' ? 'FEHLT' : 'VORSCHLAG',
      );
    }

    // Und die Zahl steht danach wirklich in der Datei, nicht nur in der
    // Oberflaeche.
    const { abschlussId } = await baueDenTag();
    const datei = zerlege(await holeStapel(abschlussId));
    expect(datei.kopf[KOPF.BERATERNUMMER]).toBe('29098');
    expect(datei.zeilen.find((z) => z.buchungstext.includes('VERKAUF'))).toBeDefined();
    expect(datei.zeilen.some((z) => z.konto === '1010')).toBe(true);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  8. Kein Entwurfsvermerk mehr — die Datei geht gar nicht erst hinaus
  // ══════════════════════════════════════════════════════════════════════

  /**
   * ── WAS HIER STAND UND WARUM ES FORT IST (26.07.2026) ────────────────────
   * Bis heute standen hier zwei Proben: die Bezeichnung des Stapels beginne
   * mit „ENTWURF", solange Beraternummer und Mandantennummer die Platzhalter
   * aus Wanderung 0115 seien, und der Vermerk verschwinde beim Speichern.
   *
   * Der Vermerk war ein Pflaster auf der falschen Wunde. Er liess eine Datei
   * OHNE echte Anschrift hinaus und schrieb „Entwurf" darauf, statt sie zu
   * verhindern. Seit 0117 gibt es die Platzhalter nicht mehr: wer die zwei
   * Zahlen nicht eingetragen hat, bekommt gar keine Datei. Der Vermerk hatte
   * damit keinen erreichbaren Fall mehr und ist samt seinen zwei Proben
   * entfernt.
   *
   * Diese Probe haelt den Sollzustand fest, damit niemand den Vermerk aus
   * Gewohnheit zurueckbaut: eine ausgelieferte Datei traegt NIE eine
   * Einschraenkung in der Bezeichnung, weil eine ausgelieferte Datei nie eine
   * braucht.
   */
  it('liefert eine Datei OHNE Entwurfsvermerk — oder gar keine', async () => {
    // Ohne die zwei Zahlen: keine Datei. Kein Entwurf, kein Vorbehalt.
    const { abschlussId } = await baueDenTag({ ordnungsnummern: false });
    const ohne = await holeStapel(abschlussId);
    expect(ohne.statusCode).toBe(409);
    expect((ohne.json() as FehlerAntwort).error.code).toBe('DATEV_MANDANT_FEHLT');

    // Mit seinen Zahlen: eine Datei, und die Bezeichnung nennt schlicht die
    // Kasse und den Tag.
    await trageOrdnungsnummernEin();
    const datei = zerlege(await holeStapel(abschlussId));
    // Feld 17 ist der Name, den DATEV in seiner Stapelliste anzeigt.
    expect(datei.kopf[KOPF.BEZEICHNUNG]).not.toContain('ENTWURF');
    expect(datei.kopf[KOPF.BEZEICHNUNG]).toContain('Kasse');
    expect(datei.kopf[KOPF.BERATERNUMMER]).toBe('29098');
    expect(datei.kopf[KOPF.MANDANTENNUMMER]).toBe('55003');
  });
});
