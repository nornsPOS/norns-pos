/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DIE VERFAHRENSDOKUMENTATION — erzeugt, nicht eingebacken
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rz. 151 GoBD verlangt vom Steuerpflichtigen eine Verfahrensdokumentation.
 * Rz. 154 verlangt, dass sie dem TATSÄCHLICH eingesetzten Verfahren voll
 * entspricht. Genau daran scheiterte die Kasse bis zum 08.08.2026.
 *
 * ── DER BEFUND ───────────────────────────────────────────────────────────
 *
 *     docs/Verfahrensdokumentation.md — ins Programm gebackener Text
 *       „warehouse14"   11 Treffer   ← ein FREMDES Erzeugnis
 *       „Norns"          0 Treffer
 *       Stand 08.06.2026, Fassung v0.4.0, Migrationsstand 0057 und 0106
 *       Abschnitt 3.1: Docker, Oracle Cloud, Redis, Cloudflare R2
 *
 * Gemessen: `tauri.conf.json` sagt Norns POS 0.1.0, der Wanderungsstand ist
 * 0133, und diese Kasse ist voll offline. Vier von fünf beschriebenen
 * Nachtläufen gibt es im ausgelieferten Bündel nicht.
 *
 * Der Prüfer schlug ein Blatt über eine fremde Firma und eine Anlage auf,
 * die es hier nicht gibt.
 *
 * ── DIE DOKTRIN DIESER DATEI ─────────────────────────────────────────────
 *
 * Drei Herkünfte, streng getrennt, und jede Angabe trägt ihre eigene:
 *
 *   ERZEUGNIS   Was für JEDE Norns-Kasse gilt: die Bauform, die Verfahren,
 *               die Kontrollen. Steht hier im Text und ist durch Tests
 *               gebunden — kein Satz über einen Ablauf, den es nicht gibt.
 *
 *   GEMESSEN    Was diese Anlage HEUTE ist: Fassung, Wanderungsstand,
 *               Tabellenzahl, TSE-Kennungen. Kommt vom Aufrufer aus der
 *               laufenden Datenbank, nie aus einer Textsuche über Dateien.
 *
 *   HÄNDLER     Was nur der Inhaber weiss: Firma, Anschrift, Steuernummer,
 *               Verantwortliche. Kommt aus `system_settings`.
 *
 * ⚠️ Eine fehlende Angabe wird NIE abgeleitet. `shop.address_line2` liesse
 * sich in Postleitzahl und Ort zerlegen, das Land liesse sich als DEU
 * annehmen — Wanderung 0123 musste eine erfundene USt-IdNr. wieder ausbauen,
 * die auf Produktion gedruckt hatte. Ein erfundenes Feld erzeugt ein
 * Dokument, das VOLLSTÄNDIG AUSSIEHT und den falschen Menschen benennt.
 *
 * Ein fehlendes Feld erscheint stattdessen sichtbar als offene Angabe, mit
 * dem Satz, wo der Inhaber sie einträgt. Das Dokument lädt trotzdem: ein
 * Prüfer, der im Laden steht, braucht das Blatt jetzt, nicht nach der
 * Datenpflege.
 *
 * ── REIN ─────────────────────────────────────────────────────────────────
 *
 * Kein Datenbankzugriff, keine Uhr, kein Dateisystem. Der Aufrufer bringt
 * alles mit. Damit ist das Dokument in einem Unit-Test vollständig prüfbar.
 */

import { ERZEUGNIS_MARKE, ERZEUGNIS_MODELL } from './erzeugnis.js';
import { type StammdatenBefund, leseStammdaten } from './haendler-stammdaten.js';

/** Der Titel des Dokuments. Steht hier und wird nirgends sonst getippt. */
export const VERFAHRENSDOKU_TITEL = 'Verfahrensdokumentation';

/** Die Schlüssel, die NUR dieses Dokument braucht (Wanderung 0134). */
export const VERFAHRENSDOKU_SCHLUESSEL = [
  'betrieb.verantwortlich_aufzeichnungen',
  'betrieb.geldwaeschebeauftragter',
  'betrieb.inbetriebnahme_am',
  'betrieb.sicherungsort',
] as const;

/**
 * ⚠️ Verschlüsselt die Sicherung — JA oder NEIN, an EINER Stelle.
 *
 * ── DER BEFUND, 13.08.2026 ───────────────────────────────────────────────
 *
 * Hier stand im Abschnitt 10 der Satz: „Die Sicherung wird verschlüsselt
 * abgelegt; der Schlüssel liegt im Schlüsselspeicher des Betriebssystems und
 * verlässt das Gerät nicht."
 *
 * Gemessen im ausliefernden Code (`apps/api-cloud/sidecar/norns-sidecar.mjs`,
 * Funktion `sicherung`): die Sicherung ist eine LESBARE `.sql`-Datei mit
 * `INSERT`-Zeilen über jede Tabelle, dazu eine wörtliche Kopie der Ordner
 * `fotos` und `kyc`. Kein Chiffrierschritt, nirgends. Das Dokument, das dem
 * Prüfer vorgelegt wird, behauptete also etwas über ein Verfahren, das es
 * nicht gibt — genau das, was die Doktrin dieser Datei oben verbietet und
 * was Rz. 154 GoBD verlangt.
 *
 * ── UND WARUM DER VERSPROCHENE ENTWURF SOGAR FALSCH WÄRE ────────────────
 *
 * Ein Schlüssel, der „das Gerät nicht verlässt", taugt für eine Sicherung
 * nicht: die Sicherung existiert für den Fall, dass GENAU DIESES Gerät weg
 * ist. Wer sie so verschlüsselt, verwahrt zehn Jahre Aufzeichnungen hinter
 * einem Schlüssel, der mit der defekten Platte verbrannt ist. Die richtige
 * Form ist ein Kennwort, das der Händler selbst setzt und verwahrt; das ist
 * eine Entscheidung über Schlüsselverwahrung und gehört Basel, nicht mir.
 *
 * Bis dahin sagt das Dokument die Wahrheit. Diese Grösse ist die EINE
 * Stelle, an der das umgestellt wird; ein Wächter bindet sie an den Code.
 */
export const SICHERUNG_IST_VERSCHLUESSELT = false;

/** Woher eine Angabe stammt. Steht im Dokument neben jeder offenen Stelle. */
export type Herkunft = 'erzeugnis' | 'gemessen' | 'haendler';

export interface Angabe {
  /** Wie die Angabe im Dokument heisst. */
  etikett: string;
  /** Der Wert, wie er dasteht. Leer heisst leer — nie ersetzt. */
  wert: string;
  /** Fehlt die Angabe? Dann erscheint sie sichtbar als offene Stelle. */
  fehlt: boolean;
  herkunft: Herkunft;
  /** Wo der Inhaber sie einträgt. Nur bei `herkunft: 'haendler'`. */
  wo?: string;
}

export interface Tabelle {
  kopf: readonly string[];
  zeilen: readonly (readonly string[])[];
}

export interface Abschnitt {
  /** Gliederungsnummer, z. B. „2.3". */
  nummer: string;
  titel: string;
  /** Die Fundstelle im Recht, z. B. „Rz. 151 GoBD" oder „§ 146a AO". */
  fundstelle?: string;
  absaetze: readonly string[];
  angaben?: readonly Angabe[];
  tabelle?: Tabelle;
}

export interface VerfahrensdokuBefund {
  /** Zeitpunkt der Erzeugung, ISO 8601. Steht auf jeder Seite. */
  erzeugtAm: string;
  /** Die Fassung dieser Kasse, gemessen. */
  fassung: string;
  erzeugnis: string;
  abschnitte: readonly Abschnitt[];
  /** Was der Inhaber noch eintragen muss. Leer heisst vollständig. */
  offeneAngaben: readonly { etikett: string; wo: string }[];
  vollstaendig: boolean;
}

/** Die Zahlen der laufenden Anlage. Aus `pg_catalog`, nie aus einem grep. */
export interface SchemaKennzahlen {
  tabellen: number;
  ausloeser: number;
  pruefbedingungen: number;
  funktionen: number;
  /** Höchster Eintrag im Wanderungsbuch, z. B. „0133". */
  wanderungsstand: string;
}

/** Was die Kasse über ihre TSE weiss. */
export interface TseAngaben {
  /** Kennung der Sicherheitseinrichtung bei fiskaly. Leer heisst: keine. */
  tssId: string;
  clientId: string;
  /** ISO-Datum der Einrichtung. Leer heisst: nie eingerichtet. */
  eingerichtetAm: string;
  /**
   * Die Seriennummer der Sicherungseinrichtung, GEMESSEN an der zuletzt
   * eingegangenen Signatur — nicht aus den Einstellungen abgeschrieben.
   *
   * ── WARUM DIESE ANGABE HIER GEBRAUCHT WIRD (13.08.2026) ────────────────
   *
   * Die Startliste sagt dem Händler: „Die Angaben, die das Formular verlangt,
   * stehen fertig in Ihrer Verfahrensdokumentation." Für die Meldung nach
   * § 146a Abs. 4 AO gehört die Seriennummer der Sicherungseinrichtung dazu —
   * und bis heute stand sie in diesem Dokument nirgends, weil die Kasse
   * nirgends einen Ort dafür hatte (Wanderung 0141 hat ihn geschaffen).
   *
   * Leer heisst: es liegt noch keine Signatur vor, aus der sie abzulesen wäre.
   * Sie wird NIE aus der Kennung abgeleitet — das wären zwei verschiedene
   * Dinge, und eine erfundene Angabe in einem Dokument für das Finanzamt ist
   * schlimmer als eine sichtbar offene.
   */
  seriennummer: string;
}

export interface VerfahrensdokuEingabe {
  einstellungen: Readonly<Record<string, string | null | undefined>>;
  /** Aus `NORNS_KASSE_VERSION`, das der Motor aus `tauri.conf.json` erhält. */
  fassung: string;
  jetzt: Date;
  schema: SchemaKennzahlen;
  tse: TseAngaben;
}

const w = (e: Readonly<Record<string, string | null | undefined>>, k: string): string =>
  (e[k] ?? '').trim();

/** Eine Angabe des Händlers. Leer bleibt leer, mit dem Weg zur Pflege. */
function haendler(etikett: string, wert: string, wo: string): Angabe {
  return { etikett, wert, fehlt: wert === '', herkunft: 'haendler', wo };
}

/** Eine gemessene Angabe. Sie kann nicht fehlen — sonst ist der Motor kaputt. */
function gemessen(etikett: string, wert: string): Angabe {
  return { etikett, wert, fehlt: wert === '', herkunft: 'gemessen' };
}

/** Eine Aussage über das Erzeugnis. Gilt für jede Norns-Kasse. */
function erzeugnis(etikett: string, wert: string): Angabe {
  return { etikett, wert, fehlt: false, herkunft: 'erzeugnis' };
}

/** Tag im deutschen Format. Leere Eingabe bleibt leer. */
function tag(isoOderLeer: string): string {
  const s = isoOderLeer.trim();
  if (s === '') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}

/** Zeitpunkt in Berliner Schreibweise, ohne Bibliothek. */
function zeitpunkt(d: Date): string {
  const p = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
  return `${p} Uhr`;
}

/**
 * Die Verfahrensdokumentation dieser Kasse bauen.
 *
 * Wirft nie. Ein unvollständiger Stand erzeugt ein Dokument mit sichtbar
 * offenen Stellen — der Prüfer sieht dann, was fehlt, statt gar nichts zu
 * bekommen.
 */
export function baueVerfahrensdoku(ein: VerfahrensdokuEingabe): VerfahrensdokuBefund {
  const e = ein.einstellungen;
  const stamm: StammdatenBefund = leseStammdaten(e);
  const d = stamm.daten;

  const BETRIEB = 'Einstellungen → Betrieb';
  const DATEV_ORT = 'Einstellungen → Steuer und Buchhaltung';

  const tseEingerichtet = ein.tse.tssId !== '' && ein.tse.clientId !== '';

  const abschnitte: Abschnitt[] = [];

  // ══ 1 — Der Steuerpflichtige ═══════════════════════════════════════════
  abschnitte.push({
    nummer: '1',
    titel: 'Der Steuerpflichtige und der Geltungsbereich',
    fundstelle: 'Rz. 151 GoBD',
    absaetze: [
      'Diese Verfahrensdokumentation beschreibt das Kassen- und Warenwirtschaftsverfahren des unten genannten Steuerpflichtigen. Sie wird von der Kasse selbst erzeugt und gibt den Stand der Anlage zum Zeitpunkt der Erzeugung wieder.',
      'Die Verantwortung für die Ordnungsmässigkeit der Aufzeichnungen bleibt nach Rz. 21 GoBD beim Steuerpflichtigen, auch soweit er Aufgaben auf Dritte überträgt.',
    ],
    angaben: [
      haendler('Firma', d.legalName, BETRIEB),
      haendler('Strasse und Hausnummer', d.street, BETRIEB),
      haendler('Postleitzahl', d.postalCode, BETRIEB),
      haendler('Ort', d.city, BETRIEB),
      haendler('Länderkennzeichen', d.countryCode, BETRIEB),
      haendler('Steuernummer', d.taxNumber, BETRIEB),
      haendler('Umsatzsteuer-Identifikationsnummer', d.vatId, BETRIEB),
      haendler(
        'Verantwortlich für die Aufzeichnungen',
        w(e, 'betrieb.verantwortlich_aufzeichnungen'),
        BETRIEB,
      ),
      haendler(
        'Geldwäschebeauftragter nach § 7 GwG',
        w(e, 'betrieb.geldwaeschebeauftragter'),
        BETRIEB,
      ),
    ],
  });

  // ══ 2 — Das eingesetzte Verfahren ══════════════════════════════════════
  abschnitte.push({
    nummer: '2',
    titel: 'Das eingesetzte Verfahren',
    fundstelle: 'Rz. 151 f. GoBD',
    absaetze: [
      `Eingesetzt wird ${ERZEUGNIS_MODELL}, ein Kassen- und Warenwirtschaftsverfahren für den Handel mit Edelmetallen, Schmuck und Sammlerstücken. Die Angaben in diesem Abschnitt sind an der laufenden Anlage gemessen, nicht aus einer Beschreibung übernommen.`,
      'Die Anwendung läuft vollständig auf dem Gerät im Betrieb. Sie führt ihre eigene Datenbank auf demselben Gerät und benötigt für Verkauf, Ankauf, Kassenbuch, Tagesabschluss und Belegdruck keine Verbindung zum Internet. Eine Verbindung wird ausschliesslich für die technische Sicherheitseinrichtung nach § 146a AO benötigt, soweit diese als Cloud-Lösung betrieben wird.',
    ],
    angaben: [
      erzeugnis('Hersteller', ERZEUGNIS_MARKE),
      erzeugnis('Bezeichnung', ERZEUGNIS_MODELL),
      gemessen('Fassung', ein.fassung),
      gemessen('Stand des Datenmodells', ein.schema.wanderungsstand),
      haendler('Seriennummer der Kasse', w(e, 'kasse.seriennummer'), BETRIEB),
      haendler('In Betrieb seit', tag(w(e, 'betrieb.inbetriebnahme_am')), BETRIEB),
      erzeugnis('Betriebsart', 'Einzelplatz, netzunabhängig, Datenhaltung auf dem Gerät'),
    ],
  });

  // ══ 2.1 — Technische Systembeschreibung ════════════════════════════════
  abschnitte.push({
    nummer: '2.1',
    titel: 'Technische Systembeschreibung',
    fundstelle: 'Rz. 152 GoBD',
    absaetze: [
      'Die Anwendung besteht aus einer Bedienoberfläche, einem Anwendungsdienst und einer relationalen Datenbank. Alle drei laufen als Bestandteil desselben Programms auf dem Gerät des Steuerpflichtigen; die Datenbank wird beim Start des Programms mitgestartet und beim Beenden mit heruntergefahren.',
      'Die folgenden Zahlen sind zum Zeitpunkt der Erzeugung dieses Dokuments aus dem Katalog der laufenden Datenbank gelesen, nicht aus einer Beschreibung.',
    ],
    tabelle: {
      kopf: ['Merkmal der laufenden Anlage', 'Anzahl'],
      zeilen: [
        ['Tabellen', String(ein.schema.tabellen)],
        ['Auslöser (Trigger)', String(ein.schema.ausloeser)],
        ['Prüfbedingungen (CHECK)', String(ein.schema.pruefbedingungen)],
        ['Datenbankfunktionen', String(ein.schema.funktionen)],
        ['Stand des Wanderungsbuchs', ein.schema.wanderungsstand],
      ],
    },
  });

  // ══ 3 — Die technische Sicherheitseinrichtung ══════════════════════════
  abschnitte.push({
    nummer: '3',
    titel: 'Technische Sicherheitseinrichtung',
    fundstelle: '§ 146a AO, § 6 KassenSichV',
    absaetze: tseEingerichtet
      ? [
          'Jeder aufzeichnungspflichtige Geschäftsvorfall wird über eine zertifizierte technische Sicherheitseinrichtung protokolliert. Der Vorgang wird vor der Erfassung begonnen und nach dem Abschluss beendet; die Kasse übernimmt die von der Sicherheitseinrichtung zurückgegebenen Werte unverändert in den Beleg und in die Datenhaltung.',
          'Die Signaturwerte werden zusammen mit dem Beleg gespeichert und in den Datenzugriff nach § 147 Abs. 6 AO übernommen. Der Beleg trägt sie als maschinell auswertbaren Code nach § 6 KassenSichV.',
        ]
      : [
          'Zum Zeitpunkt der Erzeugung dieses Dokuments ist an dieser Kasse KEINE technische Sicherheitseinrichtung eingerichtet.',
          'Solange das so ist, entstehen aufzeichnungspflichtige Geschäftsvorfälle ohne die nach § 146a Abs. 1 Satz 4 AO geforderte Absicherung. Die Kasse weist darauf im Betrieb bei jedem Abschluss hin und vermerkt den Zustand in der Datenhaltung sowie im Datenzugriff. Sie erfindet keine Signaturwerte.',
        ],
    angaben: [
      gemessen('Verfahren', tseEingerichtet ? 'Cloud-TSE über zertifizierten Anbieter' : ''),
      gemessen('Kennung der Sicherheitseinrichtung', ein.tse.tssId),
      gemessen('Kennung dieser Kasse an der Einrichtung', ein.tse.clientId),
      gemessen('Seriennummer der Sicherungseinrichtung', ein.tse.seriennummer),
      gemessen('Eingerichtet am', tag(ein.tse.eingerichtetAm)),
    ],
  });

  // ══ 4 — Aufzeichnung der Geschäftsvorfälle ═════════════════════════════
  abschnitte.push({
    nummer: '4',
    titel: 'Aufzeichnung und Festschreibung der Geschäftsvorfälle',
    fundstelle: '§ 146 Abs. 1 AO, Rz. 30 ff. GoBD',
    absaetze: [
      'Jeder Verkauf und jeder Ankauf wird einzeln, vollständig, richtig, zeitgerecht und geordnet aufgezeichnet. Der Vorgang erhält beim Abschluss eine fortlaufende Belegnummer ohne Lücke und wird demselben Augenblick festgeschrieben; eine spätere Änderung ist an keiner Stelle der Anwendung vorgesehen.',
      'Eine Korrektur erfolgt ausschliesslich als eigener, ebenfalls aufgezeichneter Storno mit Bezug auf den ursprünglichen Beleg. Der ursprüngliche Beleg bleibt unverändert erhalten.',
      'Der Geschäftstag wird nach Berliner Zeit bestimmt. Ein abgeschlossener Geschäftstag nimmt keine weiteren Vorgänge mehr auf; ein Vorgang, der nach dem Abschluss erfasst wird, trägt seinen eigenen Erfassungszeitpunkt und wird dem nächsten offenen Tag zugeordnet.',
    ],
  });

  // ══ 5 — Der Tagesabschluss ═════════════════════════════════════════════
  abschnitte.push({
    nummer: '5',
    titel: 'Tagesabschluss und Kassensturz',
    fundstelle: '§ 146 Abs. 1 Satz 2 AO',
    absaetze: [
      'Die Kasse wird täglich abgeschlossen. Der Abschluss trägt eine fortlaufende Z-Nummer, hält den gezählten Bargeldbestand fest und stellt ihn dem rechnerisch erwarteten gegenüber. Eine Abweichung wird nicht geglättet, sondern als Differenz ausgewiesen.',
      'Der gezählte Bestand wird blind erfasst: der erwartete Bestand wird der zählenden Person erst nach der Eingabe angezeigt. Damit ist die Zählung eine eigene Aussage und keine Bestätigung einer bereits bekannten Zahl.',
      'Nach dem Abschluss ist der Geschäftstag versiegelt. § 146 Abs. 4 AO lässt eine Änderung danach nicht mehr zu; die Anwendung sieht dafür keinen Weg vor.',
    ],
  });

  // ══ 6 — Umsatzsteuerliche Behandlung ═══════════════════════════════════
  abschnitte.push({
    nummer: '6',
    titel: 'Umsatzsteuerliche Behandlung',
    fundstelle: '§ 25a, § 25c, § 13b UStG',
    absaetze: [
      'Der Handel mit gebrauchten Edelmetall- und Schmuckgegenständen erfolgt regelmässig nach der Differenzbesteuerung des § 25a UStG. Die Kasse führt für jede solche Position den Einkaufspreis mit und ermittelt die Bemessungsgrundlage aus der Differenz; fehlt der Einkaufspreis, verweigert sie den Buchungsstapel, statt eine Marge zu schätzen.',
      'Anlagegold im Sinne des § 25c UStG wird steuerfrei behandelt. Umsätze, für die die Steuerschuld nach § 13b UStG auf den Leistungsempfänger übergeht, werden gesondert erfasst und verlangen die Umsatzsteuer-Identifikationsnummer des Empfängers.',
      'Innerhalb eines Belegs werden diese Behandlungen nicht vermischt. Die Anwendung verweigert einen Beleg, der Positionen unterschiedlicher steuerlicher Behandlung zusammenfasst.',
    ],
    angaben: [
      haendler('Sachkontenrahmen', w(e, 'datev.sachkontenrahmen'), DATEV_ORT),
      haendler('Länge der Sachkonten', w(e, 'datev.sachkontenlaenge'), DATEV_ORT),
      haendler('Beginn des Wirtschaftsjahres', w(e, 'datev.wirtschaftsjahr_beginn'), DATEV_ORT),
      haendler('Beraternummer', w(e, 'datev.beraternummer'), DATEV_ORT),
      haendler('Mandantennummer', w(e, 'datev.mandantennummer'), DATEV_ORT),
    ],
  });

  // ══ 7 — Belegausgabe ═══════════════════════════════════════════════════
  abschnitte.push({
    nummer: '7',
    titel: 'Belegausgabe',
    fundstelle: '§ 146a Abs. 2 AO',
    absaetze: [
      'Für jeden Geschäftsvorfall wird ein Beleg erstellt und dem am Geschäftsvorfall Beteiligten zur Verfügung gestellt. Der Beleg enthält die nach § 6 KassenSichV geforderten Angaben.',
      'Die Ausgabe erfolgt auf Papier über den angeschlossenen Bondrucker. Ist kein Drucker verfügbar, wird der Beleg als Datei bereitgestellt; die Belegausgabepflicht bleibt in beiden Fällen erfüllt.',
    ],
  });

  // ══ 8 — Identifizierung nach dem Geldwäschegesetz ══════════════════════
  abschnitte.push({
    nummer: '8',
    titel: 'Identifizierung nach dem Geldwäschegesetz',
    fundstelle: '§ 10 GwG',
    absaetze: [
      'Der Handel mit Edelmetallen unterliegt § 2 Abs. 1 Nr. 16 GwG. Die Anwendung erzwingt die Identifizierung des Vertragspartners, sobald der jeweils geltende Schwellenwert erreicht ist, und lässt den Vorgang ohne die Aufnahme der Ausweisdaten nicht abschliessen.',
      'Bei einem Ankauf wird die Identität unabhängig vom Betrag aufgenommen, soweit dies im Betrieb so eingestellt ist. Die Aufzeichnungen werden nach § 8 GwG aufbewahrt.',
    ],
    angaben: [
      haendler(
        'Schwelle Verkauf, bar',
        w(e, 'gwg.verkauf_identity_threshold_eur'),
        'Einstellungen → Geldwäsche',
      ),
      haendler(
        'Schwelle Verkauf, unbar',
        w(e, 'gwg.verkauf_identity_threshold_unbar_eur'),
        'Einstellungen → Geldwäsche',
      ),
      haendler(
        'Ankauf stets mit Identifizierung',
        w(e, 'gwg.ankauf_identity_required_always'),
        'Einstellungen → Geldwäsche',
      ),
    ],
  });

  // ══ 9 — Datenzugriff und Aufbewahrung ══════════════════════════════════
  abschnitte.push({
    nummer: '9',
    titel: 'Datenzugriff, Ausfuhr und Aufbewahrung',
    fundstelle: '§ 147 Abs. 6 AO, § 4 KassenSichV',
    absaetze: [
      'Die Anwendung stellt die aufzeichnungspflichtigen Daten in der Digitalen Schnittstelle der Finanzverwaltung für Kassensysteme (DSFinV-K, Taxonomie 2.4) bereit. Die Ausfuhr erfolgt je Geschäftstag und umfasst die Einzelaufzeichnungen, die Abschlüsse, die Stammdaten und die Signaturangaben.',
      'Daneben steht ein Buchungsstapel im DATEV-Format zur Verfügung. Beide Wege verweigern die Ausgabe, wenn eine Pflichtangabe fehlt; sie erzeugen kein Paket, das vollständig aussieht und einen leeren Schlüssel trägt.',
      'Die Aufbewahrungsfrist beträgt nach § 147 Abs. 3 AO zehn Jahre. Die Daten bleiben über diesen Zeitraum maschinell auswertbar; die Anwendung löscht keine aufzeichnungspflichtigen Daten.',
    ],
  });

  // ══ 10 — Datensicherung ════════════════════════════════════════════════
  abschnitte.push({
    nummer: '10',
    titel: 'Datensicherung',
    fundstelle: 'Rz. 103 ff. GoBD',
    absaetze: [
      'Die Anwendung erstellt auf Anforderung eine vollständige Sicherung. Die Datenbank wird dabei als gepackte Datei (gzip) an einen vom Steuerpflichtigen gewählten Ort geschrieben; die abgelegten Belege und Ausweiskopien werden als Ordner danebengestellt.',
      SICHERUNG_IST_VERSCHLUESSELT
        ? 'Die Sicherung wird verschlüsselt abgelegt. Das Kennwort setzt der Steuerpflichtige selbst und verwahrt es getrennt von den Sicherungskopien; ohne das Kennwort ist die Sicherung nicht lesbar.'
        : 'Die Sicherung ist NICHT verschlüsselt. Sie enthält personenbezogene Daten einschliesslich der Ausweiskopien nach § 8 GwG. Der Steuerpflichtige hat sie deshalb wie ein Papierarchiv zu verwahren: verschlossen, oder auf einem selbst verschlüsselten Datenträger.',
      'Die Verantwortung für die Aufbewahrung der Sicherungskopien an einem zweiten Ort trägt der Steuerpflichtige.',
    ],
    angaben: [haendler('Ort der Sicherungskopien', w(e, 'betrieb.sicherungsort'), BETRIEB)],
  });

  // ══ 11 — Internes Kontrollsystem ═══════════════════════════════════════
  abschnitte.push({
    nummer: '11',
    titel: 'Internes Kontrollsystem',
    fundstelle: 'Rz. 100 ff. GoBD',
    absaetze: [
      'Der Zugang zur Anwendung erfolgt personenbezogen. Jede Aufzeichnung trägt die handelnde Person; eine anonyme Buchung ist nicht möglich.',
      'Rechte sind nach Aufgabe getrennt. Vorgänge mit steuerlicher Wirkung, insbesondere der Tagesabschluss, das Festschreiben und die Ausfuhr, sind dem Inhaber vorbehalten.',
      'Die Anwendung führt ein fortlaufendes Änderungsverzeichnis über alle steuerlich erheblichen Vorgänge. Es ist nur lesbar und kann aus der Anwendung heraus nicht verändert werden.',
      'Zusätzlich prüft die Anwendung die Unversehrtheit der Beweiskette selbsttätig und meldet eine Unterbrechung.',
    ],
  });

  // ══ 12 — Änderungen an diesem Verfahren ════════════════════════════════
  abschnitte.push({
    nummer: '12',
    titel: 'Änderungen an diesem Verfahren',
    fundstelle: 'Rz. 154 GoBD',
    absaetze: [
      'Rz. 154 GoBD verlangt, dass die Verfahrensdokumentation dem tatsächlich eingesetzten Verfahren voll entspricht und dass ihre Änderungen nachvollziehbar sind.',
      'Dieses Dokument wird deshalb nicht gepflegt, sondern bei jedem Abruf aus der laufenden Anlage neu erzeugt. Es kann dem eingesetzten Verfahren nicht nachlaufen. Fassung und Stand des Datenmodells auf dem Deckblatt bezeichnen den Stand, den die Anlage im Augenblick der Erzeugung hatte.',
      'Ältere Fassungen sind über die Ausfuhr der jeweiligen Geschäftstage nachvollziehbar: jeder Abschluss trägt die Fassung, mit der er erzeugt wurde.',
    ],
  });

  // ── Die offenen Stellen einsammeln ──────────────────────────────────────
  const offeneAngaben: { etikett: string; wo: string }[] = [];
  for (const a of abschnitte) {
    for (const g of a.angaben ?? []) {
      if (g.fehlt && g.herkunft === 'haendler') {
        offeneAngaben.push({ etikett: g.etikett, wo: g.wo ?? '' });
      }
    }
  }

  return {
    erzeugtAm: ein.jetzt.toISOString(),
    fassung: ein.fassung,
    erzeugnis: ERZEUGNIS_MODELL,
    abschnitte,
    offeneAngaben,
    vollstaendig: offeneAngaben.length === 0,
  };
}

/** Der Zeitpunkt für das Deckblatt, in Berliner Schreibweise. */
export function deckblattZeitpunkt(befund: VerfahrensdokuBefund): string {
  return zeitpunkt(new Date(befund.erzeugtAm));
}
