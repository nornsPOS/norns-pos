/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE ZWANZIG AMTLICHEN DATEIEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Jede Tabelle bekommt hier ihre Zuordnung: Spaltenname → Wert. Die
 * SPALTENLISTE kommt aus `index.xml`, nicht von hier — siehe
 * `dsfinvk-bauplan.ts`. Was hier steht, ist ausschliesslich die Frage „woher
 * kommt der Wert dieser Spalte".
 *
 * ── Drei Arten von Einträgen, und alle drei sind ehrlich ─────────────────
 *
 *   () => wert           der Wert steht im System
 *   () => undefined      es gibt ihn hier nicht, und das ist absichtlich
 *   FEHLT_ROMAN / …      er muss von einem Menschen eingetragen werden
 *
 * Die letzten beiden sind der Grund, warum diese Datei so aussieht. Eine
 * Spalte, die niemand füllt, war vorher unsichtbar — sie fehlte einfach in
 * der Kopfzeile. Jetzt steht sie da, mit Namen und mit dem Grund.
 *
 * ⚠️ Nichts wird geraten. Kein „DEU" als Vorgabe, kein Platzhalter, keine
 * Null in einem Betragsfeld. Ein Prüferpaket, das vollständig AUSSIEHT und
 * erfundene Werte trägt, ist schlimmer als eines, das eine Lücke zeigt.
 */

import { baueTabelle, zahl, type Zuordnung } from './dsfinvk-bauplan.js';
import type { TaxonomieTabelle } from './dsfinvk-taxonomie.js';

/**
 * Werte, die ein MENSCH eintragen muss und die kein Code herleiten kann.
 *
 * Sie stehen hier namentlich, damit die Lücke auffindbar ist und nicht als
 * leeres Feld untergeht. Wanderung 0126 hat die Fächer dafür angelegt.
 */
export const FEHLT_ROMAN = undefined;

/**
 * Werte, die der STEUERBERATER entscheidet.
 *
 * ⚠️ Der wichtigste davon ist der Umsatzsteuerschlüssel für die
 * Differenzbesteuerung. Der alte Quelltext behauptete, Schlüssel 7 stehe für
 * § 25a — dafür gibt es keinen Beleg. Anhang C der Norm hält die IDs unter
 * 1000 für die DSFinV-K selbst zurück; individuelle Sachverhalte beginnen
 * bei 1000. Welche Nummer der Berater vergibt, entscheidet er.
 */
export const FEHLT_BERATER = undefined;

// ── Der gemeinsame Schlüssel jeder Tabelle ────────────────────────────────

export interface Kopf {
  kasseId: string;
  /** Zeitpunkt des Kassenabschlusses, ISO 8601. */
  erstellung: string;
  zNr: string;
}

/** Die drei Schlüsselspalten, die JEDE der zwanzig Tabellen trägt. */
function schluessel<Z>(k: Kopf): Zuordnung<Z> {
  return {
    Z_KASSE_ID: () => k.kasseId,
    Z_ERSTELLUNG: () => k.erstellung,
    Z_NR: () => k.zNr,
  };
}

// ── Die Bausteine, aus denen die Zeilen kommen ────────────────────────────

export interface BelegZeile {
  bonId: string;
  bonNr: string;
  bonTyp: string;
  bonStorno: boolean;
  bonStart: string;
  bonEnde: string;
  bedienerId: string;
  umsatzBrutto: string;
  kundeId: string | null;
  notiz: string | null;
}

export interface PositionsZeile {
  bonId: string;
  posZeile: string;
  artikeltext: string;
  gvTyp: string;
  posStorno: boolean;
  artNr: string | null;
  menge: string;
  stueckBrutto: string;
}

export interface UstZeile {
  bonId: string;
  posZeile?: string;
  ustSchluessel: string | undefined;
  brutto: string;
  netto: string;
  ust: string;
}

/**
 * Eine Zeile der Preisfindung (`itemamounts.csv`, Bonpos_Preisfindung).
 *
 * Die Norm zu dieser Datei, wörtlich: „Auflistung der gewährten Rabattbeträge
 * oder Aufschläge pro Position, differenziert nach USt-Sätzen. ZUSÄTZLICH IST
 * DER GRUNDPREIS DER POSITION ANZUGEBEN."
 *
 * Ein Rabatt braucht also ZWEI Zeilen: den Grundpreis und den Abzug. Der
 * Abzug trägt „mit negiertem Vorzeichen" — auch das steht so in der Norm, bei
 * jedem der drei Betragsfelder.
 */
export interface PreisfindungZeile {
  bonId: string;
  posZeile: string;
  /** `base_amount`, `discount` oder `extra_amount` — die Norm lässt nur diese drei. */
  typ: string;
  ustSchluessel: string | undefined;
  brutto: string;
  netto: string;
  ust: string;
}

export interface ZahlZeile {
  bonId: string;
  zahlartTyp: string;
  zahlartName: string;
  betrag: string;
}

export interface ReferenzZeile {
  /** Der Beleg, der VERWEIST — also der Storno. */
  bonId: string;
  /** Die BON_ID des Urbelegs. */
  refBonId: string;
  refZKasseId: string;
  refZNr: string | undefined;
  refDatum: string | undefined;
}

/**
 * Eine Zeile in `transactions_tse.csv`.
 *
 * ⚠️ 08.08.2026 — ALLE Signaturfelder sind seither `| null`, und das ist
 * keine Bequemlichkeit, sondern der Sachverhalt: fällt die
 * Sicherungseinrichtung aus, gibt es diese Werte nicht. Vorher waren sie
 * Pflichtfelder, und deshalb konnte der Erzeuger für einen unsignierten Beleg
 * gar keine Zeile bauen — er liess sie einfach weg. Genau das war das Loch.
 *
 * Der Sachverhalt steht dann in `tseTaFehler`, siehe `tse-ausfall.ts`.
 */
export interface TseZeile {
  bonId: string;
  tseId: string | null;
  tseTaNr: string | null;
  tseTaStart: string | null;
  tseTaEnde: string | null;
  tseTaVorgangsart: string | null;
  tseTaSigZaehler: string | null;
  tseTaSignatur: string | null;
  tseTaFehler: string | null;
}

export interface AbschlussZeile {
  buchungstag: string;
  taxonomieVersion: string | undefined;
  startId: string | undefined;
  endeId: string | undefined;
  name: string | undefined;
  strasse: string | undefined;
  plz: string | undefined;
  ort: string | undefined;
  land: string | undefined;
  stnr: string | undefined;
  ustId: string | undefined;
  summeZahlungen: string;
  summeBarzahlungen: string;
}

export interface GeschaeftsvorfallZeile {
  gvTyp: string;
  gvName: string | null;
  agenturId: string | null;
  ustSchluessel: string | undefined;
  brutto: string;
  netto: string;
  ust: string;
}

export interface ZahlartSummeZeile {
  zahlartTyp: string;
  zahlartName: string | null;
  waehrung: string;
  betrag: string;
}

export interface KassenladeZeile {
  waehrung: string;
  betrag: string;
}

export interface KasseZeile {
  brand: string;
  modell: string;
  seriennummer: string | undefined;
  swBrand: string;
  // Stand hier als `string` — damit war „ich kenne die Fassung nicht" gar
  // nicht ausdrückbar, und die Route füllte die Lücke mit einer erfundenen
  // `1.0.0`. Jetzt wie `seriennummer` drei Zeilen höher: `undefined` heisst
  // unbekannt, und die Spalte bleibt leer statt zu lügen.
  swVersion: string | undefined;
  basiswaehrung: string;
  umrechnung: string | undefined;
}

export interface OrtZeile {
  name: string | undefined;
  strasse: string | undefined;
  plz: string | undefined;
  ort: string | undefined;
  land: string | undefined;
  stnr: string | undefined;
  ustId: string | undefined;
}

export interface UstSchluesselZeile {
  id: string;
  satz: string;
  beschreibung: string;
}

export interface TseStammZeile {
  tseId: string;
  seriennummer: string | undefined;
  signaturAlgorithmus: string | undefined;
  zeitformat: string | undefined;
  publicKey: string | undefined;
  zertifikat: string | undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
//  DIE ZUORDNUNGEN
// ═══════════════════════════════════════════════════════════════════════════

export interface Daten {
  kopf: Kopf;
  abschluss: AbschlussZeile;
  belege: BelegZeile[];
  positionen: PositionsZeile[];
  positionsUst: UstZeile[];
  preisfindung: PreisfindungZeile[];
  belegUst: UstZeile[];
  zahlungen: ZahlZeile[];
  tse: TseZeile[];
  geschaeftsvorfaelle: GeschaeftsvorfallZeile[];
  zahlartSummen: ZahlartSummeZeile[];
  kassenlade: KassenladeZeile[];
  kasse: KasseZeile;
  ort: OrtZeile;
  ustSchluessel: UstSchluesselZeile[];
  tseStamm: TseStammZeile[];
  referenzen: ReferenzZeile[];
}

/**
 * Für jede der zwanzig Tabellen: die Zeilen und die Zuordnung.
 *
 * ⚠️ Die Reihenfolge folgt der `index.xml`. Wer eine Tabelle hier vergisst,
 * bekommt sie vom Wächter genannt, nicht vom Zufall.
 */
export function zuordnungen(d: Daten): Record<string, { zeilen: unknown[]; map: Zuordnung<never> }> {
  const s = schluessel(d.kopf);
  const b = <Z>(map: Zuordnung<Z>): Zuordnung<never> =>
    ({ ...s, ...map }) as unknown as Zuordnung<never>;

  return {
    // ── Stammdaten ──────────────────────────────────────────────────────
    'cashpointclosing.csv': {
      zeilen: [d.abschluss],
      map: b<AbschlussZeile>({
        Z_BUCHUNGSTAG: (z) => z.buchungstag,
        // ⚠️ Die Norm schreibt den Wortlaut dieser Zeichenkette nirgends vor,
        // und die mitgelieferte index.xml beschreibt das Feld nur als Text.
        // Der Berater sagt, was hineingehört.
        TAXONOMIE_VERSION: (z) => z.taxonomieVersion,
        Z_START_ID: (z) => z.startId,
        Z_ENDE_ID: (z) => z.endeId,
        NAME: (z) => z.name,
        STRASSE: (z) => z.strasse,
        PLZ: (z) => z.plz,
        ORT: (z) => z.ort,
        LAND: (z) => z.land,
        STNR: (z) => z.stnr,
        USTID: (z) => z.ustId,
        Z_SE_ZAHLUNGEN: (z) => zahl(z.summeZahlungen, 2),
        Z_SE_BARZAHLUNGEN: (z) => zahl(z.summeBarzahlungen, 2),
      }),
    },

    'location.csv': {
      zeilen: [d.ort],
      map: b<OrtZeile>({
        LOC_NAME: (z) => z.name,
        LOC_STRASSE: (z) => z.strasse,
        LOC_PLZ: (z) => z.plz,
        LOC_ORT: (z) => z.ort,
        LOC_LAND: (z) => z.land,
        LOC_USTID: (z) => z.ustId,
      }),
    },

    'cashregister.csv': {
      zeilen: [d.kasse],
      map: b<KasseZeile>({
        KASSE_BRAND: (z) => z.brand,
        KASSE_MODELL: (z) => z.modell,
        KASSE_SERIENNR: (z) => z.seriennummer,
        KASSE_SW_BRAND: (z) => z.swBrand,
        KASSE_SW_VERSION: (z) => z.swVersion,
        KASSE_BASISWAEH_CODE: (z) => z.basiswaehrung,
        // 0 = die Kasse ordnet Umsätze Steuersätzen zu. Das TUT sie, jede
        // Position trägt ihren Schlüssel — hier ist die 0 also eine gemessene
        // Aussage, keine Vorgabe.
        KEINE_UST_ZUORDNUNG: () => '0',
      }),
    },

    // Erfassungsterminals. Zeilenlos, solange keine eigenständigen Terminals
    // im Einsatz sind — die Kartenleser-Tabelle ist gemessen leer.
    'slaves.csv': { zeilen: [], map: b({}) },

    // Agenturgeber. Zeilenlos, solange keine Ware für fremde Rechnung
    // verkauft wird. `products.is_commission` gibt es; sobald es genutzt
    // wird, wird diese Datei pflichtig.
    'pa.csv': { zeilen: [], map: b({}) },

    'tse.csv': {
      zeilen: d.tseStamm,
      map: b<TseStammZeile>({
        TSE_ID: (z) => z.tseId,
        TSE_SERIAL: (z) => z.seriennummer,
        TSE_SIG_ALGO: (z) => z.signaturAlgorithmus,
        TSE_ZEITFORMAT: (z) => z.zeitformat,
        TSE_PD_ENCODING: () => FEHLT_BERATER,
        TSE_PUBLIC_KEY: (z) => z.publicKey,
        TSE_ZERTIFIKAT_I: (z) => z.zertifikat,
        TSE_ZERTIFIKAT_II: () => undefined,
      }),
    },

    'vat.csv': {
      zeilen: d.ustSchluessel,
      map: b<UstSchluesselZeile>({
        UST_SCHLUESSEL: (z) => z.id,
        UST_SATZ: (z) => zahl(z.satz, 2),
        UST_BESCHR: (z) => z.beschreibung,
      }),
    },

    // ── Kassenabschluss ─────────────────────────────────────────────────
    'businesscases.csv': {
      zeilen: d.geschaeftsvorfaelle,
      map: b<GeschaeftsvorfallZeile>({
        GV_TYP: (z) => z.gvTyp,
        GV_NAME: (z) => z.gvName ?? undefined,
        /**
         * ⚠️ „0", nicht leer. Die Norm zu AGENTUR_ID, wörtlich:
         * „Sofern der Geschäftsvorfall KEINER AGENTUR zuzuordnen ist, ist das
         * Feld mit einer „0" zu befüllen."
         *
         * Ein leeres Feld heisst „keine Angabe". Die 0 heisst „eigenes
         * Geschäft". Für einen Händler, der ausschliesslich auf eigene
         * Rechnung handelt, ist das der einzige richtige Wert — und ein
         * Prüfer, der die Agenturumsätze getrennt aufsummiert, bekommt sonst
         * eine Lücke statt einer Aussage.
         */
        AGENTUR_ID: (z) => z.agenturId ?? '0',
        UST_SCHLUESSEL: (z) => z.ustSchluessel,
        // ⚠️ FÜNF Nachkommastellen, nicht zwei. Die index.xml sagt
        // `<Accuracy>5`, und sie ist dieselbe Datei, mit der ein Prüfwerkzeug
        // diese Zahlen einliest. Zwei Stellen hiessen: das Paket liefert seine
        // eigene Beschreibung mit, und die beschreibt die Zahlen falsch.
        Z_UMS_BRUTTO: (z) => zahl(z.brutto, 5),
        Z_UMS_NETTO: (z) => zahl(z.netto, 5),
        Z_UST: (z) => zahl(z.ust, 5),
      }),
    },

    'payment.csv': {
      zeilen: d.zahlartSummen,
      map: b<ZahlartSummeZeile>({
        ZAHLART_TYP: (z) => z.zahlartTyp,
        ZAHLART_NAME: (z) => z.zahlartName ?? undefined,
        Z_ZAHLART_BETRAG: (z) => zahl(z.betrag, 2),
      }),
    },

    'cash_per_currency.csv': {
      zeilen: d.kassenlade,
      map: b<KassenladeZeile>({
        ZAHLART_WAEH: (z) => z.waehrung,
        // ⚠️ ENTSCHIEDEN AM 06.08.2026: hier steht die Summe der BARZAHLUNGEN.
        //
        // Die Frage stand offen, und beide Lesarten deckte der Wortlaut. Den
        // Ausschlag gab eine Messung: diese Datei muss mit `Z_SE_BARZAHLUNGEN`
        // im Abschlusskopf auf den Cent zusammenfallen, sonst nennt EIN Paket
        // zwei Zahlen für dieselbe Frage. Der gezählte Bestand tut das nicht,
        // sobald eine Differenz auftritt — und dann ist die Abweichung nicht
        // erklärt, sondern nur da.
        //
        // Der gezählte Bestand gehört als eigener Geschäftsvorfall
        // `DifferenzSollIst` ins Paket (Anhang C). Er fehlt noch; solange der
        // Anfangsbestand der Lade nicht sauber geführt wird, ist keine Zeile
        // besser als eine erfundene. Im Kassenbericht steht er weiterhin.
        ZAHLART_BETRAG_WAEH: (z) => zahl(z.betrag, 2),
      }),
    },

    // ── Einzelaufzeichnung ──────────────────────────────────────────────
    'transactions.csv': {
      zeilen: d.belege,
      map: b<BelegZeile>({
        BON_ID: (z) => z.bonId,
        BON_NR: (z) => z.bonNr,
        BON_TYP: (z) => z.bonTyp,
        BON_NAME: () => undefined,
        // Nur zu füllen, wenn die Seriennummer des Terminals als ClientID an
        // die TSE ging. Das ist hier nicht der Fall — die Norm VERBIETET die
        // Angabe dann ausdrücklich.
        TERMINAL_ID: () => undefined,
        BON_STORNO: (z) => (z.bonStorno ? '1' : '0'),
        BON_START: (z) => z.bonStart,
        BON_ENDE: (z) => z.bonEnde,
        BEDIENER_ID: (z) => z.bedienerId,
        BEDIENER_NAME: () => undefined,
        UMS_BRUTTO: (z) => zahl(z.umsatzBrutto, 2),
        // Der Leistungsempfänger. Bis auf die Kundennummer trägt das System
        // die Angaben verschlüsselt und gibt sie nicht in ein Fiskalpaket.
        KUNDE_NAME: () => undefined,
        KUNDE_ID: (z) => z.kundeId ?? undefined,
        KUNDE_TYP: () => undefined,
        KUNDE_STRASSE: () => undefined,
        KUNDE_PLZ: () => undefined,
        KUNDE_ORT: () => undefined,
        KUNDE_LAND: () => undefined,
        KUNDE_USTID: () => undefined,
        BON_NOTIZ: (z) => z.notiz ?? undefined,
      }),
    },

    'lines.csv': {
      zeilen: d.positionen,
      map: b<PositionsZeile>({
        BON_ID: (z) => z.bonId,
        POS_ZEILE: (z) => z.posZeile,
        GUTSCHEIN_NR: () => undefined,
        ARTIKELTEXT: (z) => z.artikeltext,
        POS_TERMINAL_ID: () => undefined,
        GV_TYP: (z) => z.gvTyp,
        GV_NAME: () => undefined,
        INHAUS: () => undefined,
        P_STORNO: (z) => (z.posStorno ? '1' : '0'),
        AGENTUR_ID: () => '0', // eigenes Geschäft, siehe oben
        ART_NR: (z) => z.artNr ?? undefined,
        GTIN: () => undefined,
        WARENGR_ID: () => undefined,
        WARENGR: () => undefined,
        MENGE: (z) => zahl(z.menge, 3),
        FAKTOR: () => undefined,
        EINHEIT: () => undefined,
        STK_BR: (z) => zahl(z.stueckBrutto, 5),
      }),
    },

    'transactions_vat.csv': {
      zeilen: d.belegUst,
      map: b<UstZeile>({
        BON_ID: (z) => z.bonId,
        UST_SCHLUESSEL: (z) => z.ustSchluessel,
        BON_BRUTTO: (z) => zahl(z.brutto, 5),
        BON_NETTO: (z) => zahl(z.netto, 5),
        BON_UST: (z) => zahl(z.ust, 5),
      }),
    },

    'lines_vat.csv': {
      zeilen: d.positionsUst,
      map: b<UstZeile>({
        BON_ID: (z) => z.bonId,
        POS_ZEILE: (z) => z.posZeile,
        UST_SCHLUESSEL: (z) => z.ustSchluessel,
        POS_BRUTTO: (z) => zahl(z.brutto, 5),
        POS_NETTO: (z) => zahl(z.netto, 5),
        POS_UST: (z) => zahl(z.ust, 5),
      }),
    },

    'datapayment.csv': {
      zeilen: d.zahlungen,
      map: b<ZahlZeile>({
        BON_ID: (z) => z.bonId,
        ZAHLART_TYP: (z) => z.zahlartTyp,
        ZAHLART_NAME: (z) => z.zahlartName,
        ZAHLWAEH_CODE: () => 'EUR',
        ZAHLWAEH_BETRAG: (z) => zahl(z.betrag, 2),
        BASISWAEH_BETRAG: (z) => zahl(z.betrag, 2),
      }),
    },

    'transactions_tse.csv': {
      zeilen: d.tse,
      map: b<TseZeile>({
        BON_ID: (z) => z.bonId,
        // ⚠️ Jedes dieser Felder darf leer bleiben, und nur dann, wenn die
        // TSE ausfiel. Ein erfundener Signaturzähler wäre eine falsche
        // Angabe in einem Steuerauszug; leer heisst „gab es nicht", und der
        // Grund steht daneben in TSE_TA_FEHLER.
        TSE_ID: (z) => z.tseId ?? undefined,
        TSE_TANR: (z) => z.tseTaNr ?? undefined,
        TSE_TA_START: (z) => z.tseTaStart ?? undefined,
        TSE_TA_ENDE: (z) => z.tseTaEnde ?? undefined,
        TSE_TA_VORGANGSART: (z) => z.tseTaVorgangsart ?? undefined,
        TSE_TA_SIGZ: (z) => z.tseTaSigZaehler ?? undefined,
        TSE_TA_SIG: (z) => z.tseTaSignatur ?? undefined,
        TSE_TA_FEHLER: (z) => z.tseTaFehler ?? undefined,
        TSE_VORGANGSDATEN: () => undefined,
      }),
    },

    // ── Bedingte Dateien, heute zeilenlos ───────────────────────────────
    //
    // Sie tragen nur die Kopfzeile. Das ist kein Mangel: die Norm verlangt
    // sie nur, wenn der Sachverhalt vorkommt.

    /**
     * Preisfindung: wie der Preis dieser Position zustande kam.
     *
     * ⚠️ Diese Datei ging leer hinaus, mit dem Vermerk „sobald
     * `line_discount_eur` in ein Paket gehört". Nachgemessen auf der
     * Produktion: 8 von 92 Positionen tragen einen Rabatt. Sie gehörte also
     * längst dazu — die Abfrage las die Spalte nur nie.
     */
    'itemamounts.csv': {
      zeilen: d.preisfindung,
      map: b<PreisfindungZeile>({
        BON_ID: (z) => z.bonId,
        POS_ZEILE: (z) => z.posZeile,
        TYP: (z) => z.typ,
        UST_SCHLUESSEL: (z) => z.ustSchluessel,
        PF_BRUTTO: (z) => zahl(z.brutto, 5),
        PF_NETTO: (z) => zahl(z.netto, 5),
        PF_UST: (z) => zahl(z.ust, 5),
      }),
    },

    // Zusammensetzung verkaufter Erzeugnisse (Menüs, Sets).
    'subitems.csv': { zeilen: [], map: b({}) },

    // Abrechnungskreise (Tisch, Zimmer, Abteilung).
    'allocation_groups.csv': { zeilen: [], map: b({}) },

    /**
     * ⚠️ Nicht mehr zeilenlos. Die Norm verlangt den Verweis ZWINGEND.
     *
     * Tz. 4.2.2, wörtlich: „Um einen Bezug zum ursprünglichen Vorgang zu
     * ermöglichen, muss ein Datensatz in der Datei: Bon_Referenzen angelegt
     * werden, der die Referenz zum stornierten Vorgang enthält." Ein MUSS.
     *
     * `REF_TYP` ist `Transaktion` — der EINZIGE Wert, der innerhalb der
     * DSFinV-K verweist; die drei anderen zeigen auf Systeme ausserhalb der
     * Kasse.
     *
     * `POS_ZEILE` bleibt LEER: der Verweis geht vom BONKOPF aus. Die Norm
     * beschreibt das Feld als „Zeilennummer des referenzierenden Vorgangs
     * (nicht bei Verweis aus einem Bonkopf heraus)". Ein Verweis kann
     * strukturell nie auf eine einzelne Position des Urbelegs zeigen — ein
     * Feld REF_POS_ZEILE gibt es nicht.
     *
     * `REF_NAME` bleibt LEER: es ist wörtlich die „Erläuterung des Typs der
     * Referenzierung ExterneSonstige" und hat bei `Transaktion` keinen Inhalt.
     */
    'references.csv': {
      zeilen: d.referenzen,
      map: b<ReferenzZeile>({
        BON_ID: (z) => z.bonId,
        POS_ZEILE: () => undefined,
        REF_TYP: () => 'Transaktion',
        REF_NAME: () => undefined,
        REF_DATUM: (z) => z.refDatum,
        REF_Z_KASSE_ID: (z) => z.refZKasseId,
        REF_Z_NR: (z) => z.refZNr,
        REF_BON_ID: (z) => z.refBonId,
      }),
    },
  };
}

/** Alle zwanzig Dateien bauen. */
export function baueAlleDateien(
  taxonomie: readonly TaxonomieTabelle[],
  d: Daten,
): { name: string; content: string }[] {
  const z = zuordnungen(d);
  return taxonomie.map((t) => {
    const eintrag = z[t.datei];
    if (!eintrag) {
      throw new Error(
        `DSFinV-K: für die amtliche Tabelle ${t.datei} gibt es keine Zuordnung. ` +
          `Die Norm kennt zwanzig Dateien; jede braucht einen Eintrag.`,
      );
    }
    // ⚠️ Und die Zuordnung muss auch WIRKLICH eine Zeilenliste halten. Als
    // `referenzen` für die Stornoverweise dazukam, fehlte sie in einer
    // Testvorlage — der Bau starb mit „Cannot read properties of undefined
    // (reading 'length')" an dieser Stelle hier, ohne zu sagen, welche der
    // zwanzig Tabellen gemeint war. Ein Prüferpaket darf nie an einer Stelle
    // scheitern, die den Grund verschweigt.
    if (!Array.isArray(eintrag.zeilen)) {
      throw new Error(
        `DSFinV-K: die Zuordnung für ${t.datei} hält keine Zeilenliste ` +
          `(bekommen: ${eintrag.zeilen === undefined ? 'undefined' : typeof eintrag.zeilen}). ` +
          `Wahrscheinlich fehlt das zugehörige Feld in den geformten Daten.`,
      );
    }
    // ══════════════════════════════════════════════════════════════════
    //  DIE LEERFÜLLUNG GILT NUR FÜR ZEILENLOSE TABELLEN
    // ══════════════════════════════════════════════════════════════════
    //
    // ⚠️ Der erste Entwurf füllte JEDE Tabelle auf. Damit hob er genau die
    // Zusage auf, für die `baueTabelle` gebaut wurde: „eine Spalte ohne
    // Festlegung ist ein Fehler, kein leeres Feld."
    //
    // Wer eine Zeile aus einer Zuordnung löschte, bekam die Spalte still
    // leer — und der Wächter, der das verhindern soll, mass eine Funktion,
    // die auf diesem Weg nie mit einer Lücke aufgerufen wurde.
    //
    // Eine zeilenlose Tabelle braucht die Vervollständigung wirklich: sie
    // trägt nur die Kopfzeile, und für die gibt es keine Werte. Sobald aber
    // auch nur EINE Zeile da ist, muss jede Spalte benannt sein.
    if (eintrag.zeilen.length === 0) {
      const nurKopf: Zuordnung<never> = { ...eintrag.map };
      for (const s of t.spalten) {
        if (!(s.name in nurKopf)) {
          (nurKopf as Record<string, () => undefined>)[s.name] = () => undefined;
        }
      }
      return { name: t.datei, content: baueTabelle(t, [], nurKopf) };
    }

    return {
      name: t.datei,
      content: baueTabelle(t, eintrag.zeilen as never[], eintrag.map),
    };
  });
}
