/**
 * Was fehlt dieser Kasse noch, bevor sie arbeiten kann.
 *
 * ── WARUM ES DIESE DATEI GEBEN MUSS ────────────────────────────────────────
 *
 * Eine frisch ausgelieferte Norns POS kann heute:
 *
 *   • keinen Verkauf abschliessen — es fehlen die TSE-Kennung und der
 *     Umsatzsteuer-Status.
 *   • keinen Ankaufstag exportieren — es fehlt die Entscheidung des
 *     Steuerberaters zum Geschäftsvorfalltyp.
 *   • kein Prüferpaket erzeugen — es fehlen die Stammdaten des
 *     Steuerpflichtigen.
 *   • keinen Termin annehmen — es fehlen die Arbeitszeiten.
 *
 * Jede dieser Sperren ist einzeln richtig und einzeln gut begründet. Zusammen
 * ergeben sie einen Zustand, in dem der Händler die Kasse aufmacht und NICHTS
 * geht — und jede Sperre meldet sich erst in dem Augenblick, in dem er sie
 * trifft. Beim Bezahlen. Beim Export. Beim ersten Termin. Immer mit einem
 * Kunden davor.
 *
 * Diese Datei dreht das um: sie sagt VORHER, was fehlt, in der Reihenfolge
 * ihrer Dringlichkeit.
 *
 * ── DIE REGEL, DIE HIER ÜBER ALLEM STEHT ───────────────────────────────────
 *
 * ⚠️ NICHTS WIRD HIER NEU ENTSCHIEDEN.
 *
 * Jeder Punkt liest GENAU die Quelle, die auch der zugehörige Riegel liest.
 * Eine Liste, die ihre eigene Meinung über Vollständigkeit hat, driftet von
 * den Riegeln weg — und dann sagt die Kasse „alles bereit", während das
 * Bezahlen weiter ablehnt. Das wäre schlimmer als gar keine Liste: es macht
 * aus einem sichtbaren Hindernis ein unsichtbares.
 *
 * Deshalb steht neben jedem Punkt, WELCHER Riegel ihn erzwingt, und ein
 * Wächter hält die Liste gegen die Riegel.
 */

import { UST_SCHLUESSEL_OFFEN, ustSchluesselFuer } from './dsfinvk-schluessel.js';
import { leseSteuerstand } from './steuermodus.js';

/** Was ein fehlender Punkt blockiert. Bestimmt die Reihenfolge. */
export type Sperre =
  /** Ohne das kann die Kasse nicht verkaufen. Alles andere ist zweitrangig. */
  | 'VERKAUF'
  /** Ohne das gibt es kein Prüferpaket und keinen Steuerexport. */
  | 'EXPORT'
  /**
   * Hält in der Kasse NICHTS auf — und ist trotzdem keine Kosmetik.
   *
   * ⚠️ 13.08.2026. Es gibt Pflichten, die kein Riegel dieses Hauses erzwingen
   * KANN, weil sie ausserhalb der Kasse erfüllt werden: die Mitteilung nach
   * § 146a Abs. 4 AO geht über Mein ELSTER an das Finanzamt, nicht über diese
   * Anwendung. Sie ist bussgeldbewehrt (§ 379 AO) und hat eine Frist von
   * einem Monat.
   *
   * Sie unter `KOSMETIK` zu führen hiesse, sie dem Händler als „Empfohlen"
   * anzuzeigen — das wäre die falsche Auskunft an genau der Stelle, an der er
   * sich auf die Kasse verlässt. Deshalb ein eigener Rang.
   */
  | 'MELDUNG'
  /** Ohne das nimmt die Kasse keine Termine an. */
  | 'TERMINE'
  /** Fehlt, aber hält nichts auf. */
  | 'KOSMETIK';

const RANG: Readonly<Record<Sperre, number>> = {
  VERKAUF: 0,
  EXPORT: 1,
  // Eine laufende Frist mit Bussgeld steht über einem Terminkalender, den
  // nicht jeder Laden überhaupt benutzt.
  MELDUNG: 2,
  TERMINE: 3,
  KOSMETIK: 4,
};

/**
 * Wohin der Griff führt — maschinenlesbar.
 *
 * ⚠️ Bis zum 08.08.2026 gab es NUR `wohin` als Prosa („Einstellungen, Steuer").
 * Die Karte konnte daraus keinen Weg bauen: sieben Punkte beschrieben, null
 * geöffnet. Und die Prosa war an einer Stelle falsch — der Umsatzsteuer-Status
 * steht in `Betrieb`, nicht in `Steuer`.
 */
export interface Ziel {
  /** Die Adresse der Fläche, z. B. `/einstellungen`. */
  pfad: string;
  /** Der Bereich innerhalb der Fläche, falls es einen gibt. */
  bereich?: string;
  /**
   * Wahr, wenn die Zielfläche dem Inhaber vorbehalten ist.
   *
   * ⚠️ Ohne diese Angabe führte ein Knopf einen Kassierer auf eine Fläche, die
   * er nicht sieht. Ein blinder Knopf ist schlimmer als kein Knopf.
   */
  nurInhaber: boolean;
}

export interface Schritt {
  /** Kurzer Name, wie er in der Liste steht. */
  titel: string;
  /** Ein ganzer Satz: was fehlt und was es blockiert. */
  erklaerung: string;
  sperre: Sperre;
  /** Wohin der Mensch gehen muss, in Worten. Für den Fliesstext. */
  wohin: string;
  /** Dieselbe Angabe, maschinenlesbar. Der Griff baut sich daraus. */
  ziel: Ziel;
  /**
   * Der Riegel, der diesen Punkt erzwingt — als Datei:Symbol.
   *
   * ⚠️ Steht hier NICHT zur Zierde. Der Wächter liest diese Angabe und prüft,
   * dass die genannte Stelle den genannten Schlüssel wirklich liest. Damit
   * kann die Liste nicht von den Riegeln wegdriften.
   */
  riegel: string;
  /** Der Einstellungsschlüssel, falls es einer ist. */
  schluessel?: string;
  /**
   * Wahr, wenn dieser Punkt ERLEDIGT ist.
   *
   * ── 14.08.2026: DIE LISTE KENNT JETZT AUCH DAS GESCHAFFTE ───────────────
   *
   * Bis heute kannte diese Auswertung nur die LUECKEN: ein erledigter Punkt
   * verschwand spurlos, und die Startliste konnte weder „5 von 11" sagen noch
   * dem Haendler zeigen, was er schon geschafft hat. Fuer eine Flaeche, die
   * wie eine Aufgabenliste arbeiten soll, ist das die halbe Wahrheit.
   *
   * Jeder Punkt wird deshalb IMMER gebaut und traegt seinen Stand. Die
   * Bedingung je Punkt ist DIESELBE wie vorher — nur ihr Nein erzeugt jetzt
   * einen erledigten Eintrag statt gar keinen. `offeneSchritte` filtert und
   * liefert exakt die alte Antwort; kein Riegel und kein Waechter aendert
   * seine Sicht.
   */
  erledigt: boolean;
  /**
   * Weitere Schlüssel, die DERSELBE Punkt abdeckt.
   *
   * ⚠️ 11.08.2026: es gibt Riegel, die MEHRERE Einstellungen zusammen lesen.
   * Der Umsatzsteuer-Status ist so einer — ohne `steuer.modus_gilt_ab` gilt er
   * als nicht beantwortet, und der Verkauf wurde mit 403 abgelehnt, während
   * die Startliste „bereit" meldete. Ein einzelnes `schluessel`-Feld kann das
   * nicht abbilden, und der Wächter, der Liste gegen Riegel hält, sah den
   * zweiten Schlüssel deshalb nie.
   *
   * Das Antwortschema von `GET /api/einrichtung` deklariert dieses Feld
   * NICHT, Fastify streift es also ab: es ist für die Wächter da, nicht für
   * die Fläche. Die Fläche braucht einen Griff, keine Schlüsselliste.
   */
  weitereSchluessel?: readonly string[];
}

export interface Bestandsaufnahme {
  /** Die Einstellungen, wie sie in `system_settings` stehen. */
  einstellungen: Readonly<Record<string, string | null>>;
  /** Wahr, wenn mindestens ein Mensch Arbeitszeiten hat. */
  hatArbeitszeiten: boolean;
  /** Wahr, wenn mindestens ein Mensch einen Kassencode gesetzt hat. */
  hatKassencode: boolean;
  /** Die fehlenden Stammdaten, wie `leseStammdaten` sie meldet. */
  fehlendeStammdaten: readonly string[];
  // 15.08.2026: hier stand `belegeOhneTse`, die Zahl der schon gebuchten
  // Belege ohne Sicherungseinrichtung. Mit der geloeschten Gnadenfrist gibt
  // es keinen solchen Beleg mehr, und die Startliste braucht die Zahl nicht.
}

import { DATEV_SCHLUESSEL, KLARTEXT } from './datev-mandant.js';

function leer(w: string | null | undefined): boolean {
  return w === null || w === undefined || w.trim() === '';
}

/**
 * Die eigenen Umsatzsteuerschlüssel, GENAU so gebaut wie im Export.
 *
 * ⚠️ Wörtlich derselbe Weg wie in `closing-export.ts`: Präfix abschneiden,
 * Rest gross. Die Schlüssel der Einstellungen sind kleingeschrieben (ein CHECK
 * erzwingt das), die Steuerarten heissen im Code GROSS. Eine zweite,
 * handgepflegte Zuordnung an dieser Stelle wäre der nächste stille
 * Widerspruch — dieselbe Wunde wie beim Steuerstand am 11.08.2026.
 */
function eigeneUstSchluessel(e: Readonly<Record<string, string | null>>): Record<string, string> {
  const eigene: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) {
    const treffer = /^dsfinvk\.ust_schluessel\.(.+)$/.exec(k);
    const rest = treffer?.[1];
    if (rest !== undefined && !leer(v)) eigene[rest.toUpperCase()] = (v as string).trim();
  }
  return eigene;
}

/**
 * Was der Händler über eine offene Steuerbehandlung lesen soll.
 *
 * ⚠️ Der Typ ist ABSICHTLICH über `UST_SCHLUESSEL_OFFEN` gebunden: kommt im
 * Riegel eine dritte offene Behandlung dazu, wird DIESE Datei rot, statt dass
 * die Startliste sie stillschweigend verschweigt. Eine handgepflegte
 * Namensliste wäre sonst blind für den neuen Eintrag — die Hausklasse
 * „Wächter mit Namensliste wird blind", hier auf der Anzeigeseite.
 */
const UST_KLARTEXT: Readonly<
  Record<
    (typeof UST_SCHLUESSEL_OFFEN)[number],
    { paragraf: string; sache: string; vorschlag: string; wieOft: string }
  >
> = {
  MARGIN_25A: {
    paragraf: '§ 25a',
    sache: 'die Differenzbesteuerung nach § 25a UStG',
    vorschlag: '1001',
    wieOft:
      'Bei Gold und Schmuck ist das der Regelfall, und jedes neu angelegte Produkt trägt ' +
      'diese Behandlung als Vorgabe.',
  },
  REVERSE_CHARGE_13B: {
    paragraf: '§ 13b',
    sache: 'die Steuerschuldnerschaft des Leistungsempfängers nach § 13b UStG',
    vorschlag: '1002',
    wieOft:
      'Das betrifft nur Verkäufe an Unternehmer mit Umsatzsteuer-Identifikationsnummer, ' +
      'dann aber jeden einzelnen davon.',
  },
};

/**
 * Fehlt der Schlüssel für diese Steuerbehandlung?
 *
 * ⚠️ Gefragt wird DER RIEGEL SELBST, nicht eine Kopie seiner Regel.
 * `ustSchluesselFuer` ist genau die Funktion, die `dsfinvk-daten.ts` für jede
 * Position aufruft und die den ganzen Export mit 409 abbricht. Ein zweites
 * `leer(...)` hier wäre eine zweite Meinung über dieselbe Frage — und zwei
 * Meinungen driften.
 */
function ustSchluesselFehlt(code: string, eigene: Readonly<Record<string, string>>): boolean {
  try {
    ustSchluesselFuer(code, eigene);
    return false;
  } catch {
    return true;
  }
}

/**
 * Die offenen Punkte, dringendste zuerst.
 *
 * Rein: keine Datenbank, kein Netz. Damit lässt sich jede Kombination prüfen,
 * ohne eine Kasse aufzusetzen.
 */
export function alleSchritte(b: Bestandsaufnahme): Schritt[] {
  const e = b.einstellungen;
  const schritte: Schritt[] = [];

  // ── VERKAUF ────────────────────────────────────────────────────────────
  if (leer(e['tse.tss_id'])) {
    /*
     * ── 15.08.2026: WIEDER EINE EINZIGE LAGE, UND DAS IST DIE WAHRHEIT ────
     *
     * Am 13.08. bekam dieser Punkt zwei Wortlaute, weil eine Gnadenfrist von
     * zehn Belegen den Verkauf noch durchliess. Basel hat sie nach der
     * Rechtspruefung gestrichen: ohne Sicherungseinrichtung kein Vorgang, ab
     * dem ersten. Damit gibt es hier nichts mehr abzuwaegen.
     *
     * Der Punkt sperrt wieder VERKAUF, und der Satz sagt genau das.
     */
    schritte.push({
      titel: 'Technische Sicherheitseinrichtung',
      erklaerung:
        'Es ist keine TSE eingetragen. Ohne sie wird kein Beleg signiert, die ' +
        'Kasse erfüllt § 146a AO nicht, und weder ein Verkauf noch ein Ankauf ' +
        'ist möglich. Sie kommt vom Anbieter der TSE und wird hier eingetragen.',
      sperre: 'VERKAUF',
      wohin: 'Einstellungen, Geräte',
      /*
       * ── ⛔ HIER STAND `nurInhaber: false` — EIN BLINDER KNOPF ────────────
       *
       * DER BEFUND (Tiefenjagd 11.08.2026): der Bereich `hardware` trägt in
       * `Einstellungen.tsx` kein `adminOnly`, ist für den Kassierer also
       * sichtbar. Die Route dahinter verlangt aber `requireOwner` UND
       * `requireStepUp` (`tse-einrichtung.ts`). Gemessen:
       *
       *     POST /api/tse/einrichten mit Kassierersitzung
       *     → HTTP 403 {"code":"FORBIDDEN","message":"Owner-only operation"}
       *
       * Ein Kassierer, dem die Kasse morgens „Diese Kasse kann noch nicht
       * verkaufen" zeigt, folgte dem Knopf, fand die TSE-Maske offen vor,
       * tippte die Zugangsdaten ein und bekam eine englische Absage. Genau
       * der blinde Knopf, den dieses Feld laut seiner eigenen Begründung
       * verhindern soll.
       *
       * Der Bereich bleibt sichtbar — der Kassierer braucht die Drucker dort.
       * Nur DIESER Punkt sagt jetzt die Wahrheit: die TSE richtet der
       * Inhaber ein. `EinrichtungCard` zeigt dann keinen Knopf, sondern
       * einen ehrlichen Satz.
       */
      ziel: { pfad: '/einstellungen', bereich: 'hardware', nurInhaber: true },
      // ⚠️ 02.08.2026: der Riegel stand wörtlich in `transactions-finalize.ts`
      // und war damit nur der Riegel EINES Weges; fünf weitere Wege in die
      // fiskalische Tabelle hatten ihn nicht. Er wohnt jetzt an einer Stelle.
      riegel: 'kassenpflicht.ts',
      schluessel: 'tse.tss_id',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Technische Sicherheitseinrichtung',
      erklaerung: 'Die TSE ist eingetragen. Jeder Beleg wird signiert.',
      sperre: 'VERKAUF',
      wohin: 'Einstellungen, Geräte',
      ziel: { pfad: '/einstellungen', bereich: 'hardware', nurInhaber: true },
      riegel: 'kassenpflicht.ts',
      schluessel: 'tse.tss_id',
      erledigt: true,
    });
  }
  // ⚠️ 11.08.2026: hier stand `leer(e['steuer.modus'])`. Der Riegel im
  // Verkaufsweg liest aber ZWEI Schlüssel und reicht sie an `leseSteuerstand`
  // weiter; ohne gültiges Datum kommt `modus: null` zurück und jeder Verkauf
  // endet mit 403 VAT_CHECK_REQUIRED. Gemessen an einer Kasse, deren
  // Assistent vollständig ausgefüllt war: `kannVerkaufen = true`, und der
  // erste Verkauf wurde abgelehnt.
  //
  // Ein zweites `leer(...)` daneben wäre der naheliegende und falsche Weg:
  // zwei Stellen, die dieselbe Frage beantworten, driften wieder. Deshalb
  // wird DIE FUNKTION DES RIEGELS aufgerufen.
  if (leseSteuerstand(e['steuer.modus'], e['steuer.modus_gilt_ab']).modus === null) {
    schritte.push({
      titel: 'Umsatzsteuer-Status',
      erklaerung:
        'Es ist nicht festgelegt, ob dieser Betrieb der Regelbesteuerung unterliegt oder ' +
        'Kleinunternehmer nach § 19 UStG ist. Dazu gehört das Feld „Gilt ab": ohne dieses ' +
        'Datum wäre der Buchungsstapel rückwirkend falsch, und die Kasse behandelt den ' +
        'Status dann als nicht beantwortet. Das darf nie geraten werden: ein falscher ' +
        'Ausweis auf dem Beleg ist nach § 14c UStG geschuldete Steuer. Bis dahin kein Verkauf.',
      sperre: 'VERKAUF',
      // ⚠️ Gemessen am 08.08.2026: `steuer.modus` wird in `BetriebSection`
      // gepflegt, NICHT unter „Steuer". Die alte Angabe schickte den Inhaber in
      // den falschen Bereich, und dort gibt es das Feld nicht.
      wohin: 'Einstellungen, Betrieb',
      ziel: { pfad: '/einstellungen', bereich: 'betrieb', nurInhaber: true },
      riegel: 'transactions-finalize.ts',
      schluessel: 'steuer.modus',
      weitereSchluessel: ['steuer.modus_gilt_ab'],
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Umsatzsteuer-Status',
      erklaerung: 'Der Umsatzsteuer-Status ist festgelegt, samt dem Feld „Gilt ab".',
      sperre: 'VERKAUF',
      wohin: 'Einstellungen, Betrieb',
      ziel: { pfad: '/einstellungen', bereich: 'betrieb', nurInhaber: true },
      riegel: 'transactions-finalize.ts',
      schluessel: 'steuer.modus',
      weitereSchluessel: ['steuer.modus_gilt_ab'],
      erledigt: true,
    });
  }

  // ── EXPORT ─────────────────────────────────────────────────────────────
  if (b.fehlendeStammdaten.length > 0) {
    schritte.push({
      titel: 'Stammdaten des Betriebs',
      erklaerung:
        `Für das Prüferpaket fehlt noch: ${b.fehlendeStammdaten.join(', ')}. Ohne diese ` +
        'Angaben entsteht keine DSFinV-K-Datei, bei einer Kassennachschau ist das der ' +
        'erste Punkt, nach dem gefragt wird.',
      sperre: 'EXPORT',
      wohin: 'Einstellungen, Betrieb',
      ziel: { pfad: '/einstellungen', bereich: 'betrieb', nurInhaber: true },
      riegel: 'haendler-stammdaten.ts',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Stammdaten des Betriebs',
      erklaerung: 'Die Stammdaten für das Prüferpaket sind vollständig.',
      sperre: 'EXPORT',
      wohin: 'Einstellungen, Betrieb',
      ziel: { pfad: '/einstellungen', bereich: 'betrieb', nurInhaber: true },
      riegel: 'haendler-stammdaten.ts',
      erledigt: true,
    });
  }
  /*
   * ── DER VERKAUFSAUFSCHLAG (19.08.2026, Fund der Einstellungs-Vermessung) ─
   *
   * `pricing.verkauf_aufschlag_pct` hat die Vorgabe NULL, und das ist gut
   * begruendet (lib/verkaufsaufschlag.ts: „ein zu niedriger Preis faellt dem
   * Haendler beim ersten Blick auf, ein erfundener nicht"). Nur: diese
   * bewusste Null stand in KEINER Liste — nicht im Assistenten, nicht hier.
   * Ein Edelmetallhaendler, der den Tageskurspreis benutzt, verkaufte damit
   * zum Materialwert, ohne dass ihn je jemand gefragt haette.
   *
   * ⚠️ Die Sperre ist bewusst KOSMETIK und nicht VERKAUF: die Kasse
   * funktioniert, der Haendler darf zum Materialwert verkaufen, wenn er es
   * will. Sie soll ihn erinnern, nicht bevormunden — und die Startliste
   * sagt, was es bedeutet.
   */
  if (leer(e['pricing.verkauf_aufschlag_pct'])) {
    schritte.push({
      titel: 'Verkaufsaufschlag',
      erklaerung:
        'Auf den Tageskurs kommt kein Aufschlag. Wer Preise aus dem Kurs rechnen laesst, ' +
        'verkauft damit zum reinen Materialwert, ohne Marge. Die Vorgabe ist mit Absicht ' +
        'null, damit hier keine erfundene Zahl steht; die Ihre gehoert eingetragen.',
      sperre: 'KOSMETIK',
      wohin: 'Einstellungen, Verkaufsaufschlag',
      ziel: { pfad: '/einstellungen', bereich: 'aufschlag', nurInhaber: true },
      riegel: 'verkaufsaufschlag.ts',
      schluessel: 'pricing.verkauf_aufschlag_pct',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Verkaufsaufschlag',
      erklaerung: 'Der Aufschlag auf den Tageskurs ist eingetragen.',
      sperre: 'KOSMETIK',
      wohin: 'Einstellungen, Verkaufsaufschlag',
      ziel: { pfad: '/einstellungen', bereich: 'aufschlag', nurInhaber: true },
      riegel: 'verkaufsaufschlag.ts',
      schluessel: 'pricing.verkauf_aufschlag_pct',
      erledigt: true,
    });
  }

  if (leer(e['dsfinvk.gv_typ.ankauf'])) {
    schritte.push({
      titel: 'Geschäftsvorfall beim Ankauf von Privat',
      erklaerung:
        'Welcher amtliche Geschäftsvorfalltyp für den Ankauf von Privat gilt, entscheidet der ' +
        'Steuerberater. Solange die Antwort fehlt, bricht jeder Export ab, sobald der Tag ' +
        'einen Ankaufbeleg enthält, bei einem Edelmetallhändler ist das fast jeder Tag.',
      sperre: 'EXPORT',
      wohin: 'Einstellungen, Steuer und Buchhaltung',
      ziel: { pfad: '/einstellungen', bereich: 'steuer', nurInhaber: true },
      riegel: 'dsfinvk-schluessel.ts',
      schluessel: 'dsfinvk.gv_typ.ankauf',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Geschäftsvorfall beim Ankauf von Privat',
      erklaerung: 'Der amtliche Geschäftsvorfalltyp für den Ankauf von Privat ist gewählt.',
      sperre: 'EXPORT',
      wohin: 'Einstellungen, Steuer und Buchhaltung',
      ziel: { pfad: '/einstellungen', bereich: 'steuer', nurInhaber: true },
      riegel: 'dsfinvk-schluessel.ts',
      schluessel: 'dsfinvk.gv_typ.ankauf',
      erledigt: true,
    });
  }

  /*
   * ── ⛔ § 25a: DER BILLIGSTE TEURE FEHLER IM GANZEN HAUS ─────────────────
   *
   * DER BEFUND (13.08.2026). `ustSchluesselFuer` wirft `UstSchluesselOffenError`
   * mit HTTP 409, sobald eine Position die Behandlung `MARGIN_25A` trägt und
   * keine eigene Nummer hinterlegt ist (`dsfinvk-schluessel.ts:414`). Diese
   * Liste nannte den Schlüssel mit KEINEM Wort. Gemessen an genau dem Zustand,
   * den der Drift-Waechter bis heute „FERTIG" nannte:
   *
   *     offeneSchritte(FERTIG) = []            ← „alles erledigt"
   *     ustSchluesselFuer('MARGIN_25A', {})    ← wirft, 409, KEIN Paket
   *
   * Für einen Edelmetallhändler ist die Differenzbesteuerung der REGELFALL:
   * `NeuesProduktDialog.tsx` legt jedes neue Produkt mit `MARGIN_25A` an, und
   * `transactions-ankauf.ts` schreibt jeden Ankauf so. Es scheitert also nicht
   * ein seltener Tag, sondern fast jeder.
   *
   * Die Heilung ist EIN Feld und wirkt rückwirkend auf alle vergangenen Tage.
   * Nur erfährt das niemand, der die Fläche nie öffnet — deshalb steht der
   * Punkt jetzt hier, mit dem Weg dorthin.
   */
  {
    const eigene = eigeneUstSchluessel(e);
    for (const code of UST_SCHLUESSEL_OFFEN) {
      const wort = UST_KLARTEXT[code];
      if (ustSchluesselFehlt(code, eigene)) {
        schritte.push({
          titel: `Umsatzsteuerschlüssel für ${wort.paragraf}`,
          erklaerung:
            `Für ${wort.sache} ist noch keine Nummer hinterlegt. Die Norm hält die Nummern ` +
            'unter 1000 für sich zurück; welche eigene Nummer ab 1000 gilt, entscheidet der ' +
            `Steuerberater, der Hausvorschlag ist ${wort.vorschlag}. ${wort.wieOft} Solange die ` +
            'Nummer fehlt, entsteht KEIN Prüferpaket, sobald ein einziger solcher Beleg im ' +
            'Zeitraum liegt. Einmal eingetragen, gilt sie auch für alle bereits gebuchten Tage.',
          sperre: 'EXPORT',
          wohin: 'Einstellungen, Steuer und Buchhaltung',
          ziel: { pfad: '/einstellungen', bereich: 'steuer', nurInhaber: true },
          riegel: 'dsfinvk-schluessel.ts',
          // ⚠️ Der Name wird aus dem Code GERECHNET, genau umgekehrt zu
          // `closing-export.ts`, das ihn hochschreibt. Eine handgepflegte
          // Zweitliste driftet vom Riegel weg, sobald eine dritte offene
          // Behandlung dazukommt.
          schluessel: `dsfinvk.ust_schluessel.${code.toLowerCase()}`,
          erledigt: false,
        });
      } else {
        schritte.push({
          titel: `Umsatzsteuerschlüssel für ${wort.paragraf}`,
          erklaerung: `Die eigene Nummer für ${wort.sache} ist hinterlegt.`,
          sperre: 'EXPORT',
          wohin: 'Einstellungen, Steuer und Buchhaltung',
          ziel: { pfad: '/einstellungen', bereich: 'steuer', nurInhaber: true },
          riegel: 'dsfinvk-schluessel.ts',
          schluessel: `dsfinvk.ust_schluessel.${code.toLowerCase()}`,
          erledigt: true,
        });
      }
    }
  }

  /*
   * ── ⛔ DATEV: DIE STARTLISTE SAGTE „BEREIT", DER EXPORT SAGTE NEIN ──────
   *
   * DER BEFUND (Bereitschaftslauf 12.08.2026, zwei unabhaengige Stimmen):
   * `ladeDatevMandant` verlangt sechs Angaben und wirft sonst
   * `DATEV_MANDANT_FEHLT` mit 409 — aber KEIN Punkt dieser Liste nannte sie.
   * Gemessen an genau dem Zustand, den der Drift-Waechter „FERTIG" nennt:
   * `offeneSchritte(FERTIG) = []`, und der DATEV-Export lehnte im selben
   * Augenblick ab. Der Haendler haette einen Monat gearbeitet und die Absage
   * zum ersten Mal gesehen, als er den Stapel an den Steuerberater geben
   * wollte.
   *
   * Die Liste liest dieselben Schluessel wie der Riegel (`DATEV_SCHLUESSEL`
   * aus `datev-mandant.ts`) — eine zweite, eigene Aufzaehlung waere der
   * naechste stille Widerspruch.
   */
  {
    const datevAlle = Object.values(DATEV_SCHLUESSEL);
    const datevFehlt = datevAlle.filter((k) => leer(e[k]));
    const erster = datevFehlt[0];
    if (erster !== undefined) {
      const namen = datevFehlt.map((k) => KLARTEXT[k] ?? k).join('; ');
      schritte.push({
        titel: 'DATEV: die Angaben des Steuerberaters',
        erklaerung:
          `Für den Buchungsstapel an den Steuerberater ${
            datevFehlt.length === 1 ? 'fehlt noch diese Angabe' : 'fehlen noch diese Angaben'
          }: ${namen}. Alle sechs kommen vom Steuerberater; ohne sie wird keine ` +
          'DATEV-Datei erzeugt.',
        sperre: 'EXPORT',
        wohin: 'Einstellungen, Steuer und Buchhaltung',
        ziel: { pfad: '/einstellungen', bereich: 'steuer', nurInhaber: true },
        riegel: 'datev-mandant.ts',
        schluessel: erster,
        weitereSchluessel: datevFehlt.slice(1),
        erledigt: false,
      });
    } else {
      schritte.push({
        titel: 'DATEV: die Angaben des Steuerberaters',
        erklaerung: 'Alle sechs Angaben des Steuerberaters sind eingetragen.',
        sperre: 'EXPORT',
        wohin: 'Einstellungen, Steuer und Buchhaltung',
        ziel: { pfad: '/einstellungen', bereich: 'steuer', nurInhaber: true },
        riegel: 'datev-mandant.ts',
        ...(datevAlle[0] !== undefined ? { schluessel: datevAlle[0] } : {}),
        weitereSchluessel: datevAlle.slice(1),
        erledigt: true,
      });
    }
  }

  /*
   * ── ⛔ MELDUNG: DIE PFLICHT, DIE IM GANZEN ERZEUGNIS NULL MAL VORKAM ────
   *
   * DER BEFUND (13.08.2026). „§ 146a Abs. 4" kam im ganzen Quelltext genau
   * EINMAL vor, und zwar als Randnotiz an einem Feldkommentar in
   * `dsfinvk-daten.ts:108`. Weder die Startliste noch die
   * Verfahrensdokumentation nannten die Mitteilungspflicht. Die Kasse zählte
   * dem Händler jede andere Pflicht auf — TSE, Belegausgabe, GwG,
   * Aufbewahrung — nur diese nicht.
   *
   * Seit dem 01.07.2025 ist jedes elektronische Aufzeichnungssystem dem
   * Finanzamt binnen eines Monats nach Anschaffung mitzuteilen, elektronisch
   * über Mein ELSTER, eine Mitteilung je Betriebsstätte (AEAO zu § 146a,
   * Nr. 1.16.1). Sie ist nach § 379 AO bussgeldbewehrt.
   *
   * ── WARUM DIESER PUNKT AN DER SERIENNUMMER HÄNGT ────────────────────────
   *
   * Die Kasse kann nicht wissen, ob der Händler gemeldet HAT — die Meldung
   * geschieht ausserhalb, und ein Häkchen „ich habe gemeldet" wäre eine
   * Behauptung ohne Messung, also genau die Art Feld, die dieses Haus nicht
   * baut. Gemessen wird deshalb die eine Angabe, OHNE DIE DIE MELDUNG GAR
   * NICHT ABGEGEBEN WERDEN KANN und die diese Kasse wirklich führt: ihre
   * Seriennummer. Sie steht in `BetriebSection.tsx`, der Griff führt also an
   * ein Feld, das es gibt.
   *
   * Alle übrigen Angaben, die das Formular verlangt, DRUCKT die Kasse
   * bereits: `verfahrensdokumentation.ts` führt Anschrift, Seriennummer,
   * Kennung der Sicherheitseinrichtung und Tag der Inbetriebnahme in einem
   * Dokument zusammen, das unter Einstellungen, Steuer und Buchhaltung als
   * PDF herausfällt. Der Satz unten nennt es, damit der Händler nicht sucht.
   */
  if (leer(e['kasse.seriennummer'])) {
    schritte.push({
      titel: 'Kassenmeldung an das Finanzamt',
      erklaerung:
        'Nach § 146a Abs. 4 AO ist jede elektronische Kasse dem Finanzamt binnen eines Monats ' +
        'über Mein ELSTER zu melden, eine Mitteilung je Betriebsstätte; wer das versäumt, ' +
        'riskiert ein Bussgeld nach § 379 AO. Das Formular verlangt die Seriennummer dieser ' +
        'Kasse, und die steht hier noch nicht. Alle übrigen Angaben, Anschrift, Kennung der ' +
        'Sicherheitseinrichtung und Tag der Inbetriebnahme, stehen fertig in der ' +
        'Verfahrensdokumentation, die Sie unter Einstellungen, Steuer und Buchhaltung als PDF ' +
        'herunterladen. Die Meldung selbst gibt niemand für Sie ab.',
      sperre: 'MELDUNG',
      wohin: 'Einstellungen, Betrieb',
      ziel: { pfad: '/einstellungen', bereich: 'betrieb', nurInhaber: true },
      // ⚠️ KEINE Datei, und das ist ehrlich so gemeint: diese Pflicht wird
      // ausserhalb der Kasse erfüllt, kein Riegel dieses Hauses kann sie
      // erzwingen. Der Wächter misst hier deshalb zwei andere Dinge — dass
      // der Schlüssel im Erzeugnis wirklich benutzt wird und dass die
      // Zielfläche das Feld wirklich hat.
      riegel: '§ 146a Abs. 4 AO',
      schluessel: 'kasse.seriennummer',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Kassenmeldung an das Finanzamt',
      // ⚠️ „Erledigt" heisst hier NUR: die Seriennummer steht drin. Ob die
      // Meldung über Mein ELSTER wirklich abgegeben wurde, kann die Kasse
      // nicht messen, und ein Satz, der das behauptete, wäre erfunden.
      erklaerung:
        'Die Seriennummer dieser Kasse ist eingetragen. Die Angaben für die Meldung über ' +
        'Mein ELSTER stehen in der Verfahrensdokumentation; die Meldung selbst gibt ' +
        'niemand für Sie ab.',
      sperre: 'MELDUNG',
      wohin: 'Einstellungen, Betrieb',
      ziel: { pfad: '/einstellungen', bereich: 'betrieb', nurInhaber: true },
      riegel: '§ 146a Abs. 4 AO',
      schluessel: 'kasse.seriennummer',
      erledigt: true,
    });
  }

  // ── TERMINE ────────────────────────────────────────────────────────────
  if (!b.hatArbeitszeiten) {
    schritte.push({
      titel: 'Arbeitszeiten',
      erklaerung:
        'Es sind keine Arbeitszeiten hinterlegt. Ohne sie gibt es kein einziges freies ' +
        'Zeitfenster, und jeder Termin wird abgelehnt, unabhängig von Uhrzeit und Tag.',
      sperre: 'TERMINE',
      wohin: 'Termine',
      ziel: { pfad: '/termine', nurInhaber: false },
      riegel: 'available_slots()',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Arbeitszeiten',
      erklaerung: 'Arbeitszeiten sind hinterlegt. Termine können vergeben werden.',
      sperre: 'TERMINE',
      wohin: 'Termine',
      ziel: { pfad: '/termine', nurInhaber: false },
      riegel: 'available_slots()',
      erledigt: true,
    });
  }

  // ── KOSMETIK, aber am Tresen sichtbar ──────────────────────────────────
  if (!b.hatKassencode) {
    schritte.push({
      titel: 'Kassencode',
      erklaerung:
        'Für diese Kasse ist noch kein Code gesetzt. Der erste Mensch, der sie öffnet, legt ' +
        'ihn an; danach meldet er sich damit an.',
      sperre: 'KOSMETIK',
      // Gemessen: Zugänge und Kassencodes werden auf der Team-Fläche
      // verwaltet; den eigenen Code setzt jeder Mensch beim ersten Start selbst.
      wohin: 'Team, Zugänge',
      ziel: { pfad: '/team', nurInhaber: false },
      riegel: 'auth-pin.ts',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Kassencode',
      erklaerung: 'Mindestens ein Kassencode ist gesetzt.',
      sperre: 'KOSMETIK',
      wohin: 'Team, Zugänge',
      ziel: { pfad: '/team', nurInhaber: false },
      riegel: 'auth-pin.ts',
      erledigt: true,
    });
  }
  if (leer(e['shop.name']) && leer(e['shop.legal_name'])) {
    schritte.push({
      titel: 'Name auf dem Beleg',
      erklaerung:
        'Der gedruckte Beleg trägt noch keinen Kopf. Verkaufen lässt sich trotzdem, aber der ' +
        'Kunde bekommt ein Papier ohne Absender.',
      sperre: 'KOSMETIK',
      wohin: 'Einstellungen, Beleg und Shop',
      ziel: { pfad: '/einstellungen', bereich: 'beleg', nurInhaber: false },
      riegel: 'render-html.ts',
      schluessel: 'shop.name',
      erledigt: false,
    });
  } else {
    schritte.push({
      titel: 'Name auf dem Beleg',
      erklaerung: 'Der gedruckte Beleg trägt den Namen des Geschäfts.',
      sperre: 'KOSMETIK',
      wohin: 'Einstellungen, Beleg und Shop',
      ziel: { pfad: '/einstellungen', bereich: 'beleg', nurInhaber: false },
      riegel: 'render-html.ts',
      schluessel: 'shop.name',
      erledigt: true,
    });
  }

  // Stabil sortieren: OFFENES zuerst, darin nach Dringlichkeit; das
  // Erledigte folgt in derselben Rangordnung. Gleiche Dringlichkeit behält
  // die Reihenfolge oben, in der die Punkte fachlich aufeinander folgen.
  return schritte.sort(
    (a, z) => Number(a.erledigt) - Number(z.erledigt) || RANG[a.sperre] - RANG[z.sperre],
  );
}

/**
 * Nur die offenen Punkte — exakt die Antwort, die diese Auswertung vor dem
 * 14.08.2026 gab. Waechter und Riegel messen weiter hieran.
 */
export function offeneSchritte(b: Bestandsaufnahme): Schritt[] {
  return alleSchritte(b).filter((s) => !s.erledigt);
}

/** Die knappe Antwort für eine Ampel. Nimmt offene ODER alle Schritte an. */
export function kannVerkaufen(schritte: readonly Schritt[]): boolean {
  return !schritte.some((s) => !s.erledigt && s.sperre === 'VERKAUF');
}
