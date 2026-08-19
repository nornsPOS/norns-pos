/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DER EINRICHTUNGSASSISTENT — was gefragt wird, und warum
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Basels Auftrag vom 09.08.2026: der Händler installiert, öffnet, und wird
 * Schritt für Schritt geführt. Alles, was die Kasse über ihn wissen muss,
 * wird EINMAL am Anfang erfragt und an seinen Platz gelegt.
 *
 * ── ⚠️ DIE EINE REGEL, DIE DIESE DATEI TRÄGT ────────────────────────────
 *
 * Jedes Feld hier schreibt in GENAU DEN Einstellungsschlüssel, den die
 * Riegel, die Startliste und die Verfahrensdokumentation ohnehin lesen.
 * Kein eigener Speicher, kein zweiter Name, keine Kopie.
 *
 * Ein Assistent mit eigenem Vorrat wäre die gefährlichste Fassung dieses
 * Wunsches: der Händler füllte ihn aus, sähe „fertig", und die Kasse
 * verweigerte den Verkauf weiter, weil der Riegel woanders nachsieht.
 *
 * Die Schlüssel stammen aus den Wanderungen 0044, 0050, 0111, 0115, 0126
 * und 0134 und werden hier nur BENANNT, nicht neu erfunden.
 *
 * ── ⚠️ UND NICHTS WIRD ERFUNDEN ─────────────────────────────────────────
 *
 * Kein Vorgabewert für das Land, keine geratene Steuernummer, kein
 * vorausgefülltes Muster. Wanderung 0123 musste eine erfundene USt-IdNr.
 * wieder ausbauen, die auf Produktion GEDRUCKT hatte.
 *
 * Ein Feld darf leer bleiben. Dann bleibt der zugehörige Punkt der
 * Startliste offen — sichtbar, mit Weg. Das ist ehrlicher als ein
 * ausgefülltes Formular, hinter dem eine Sperre wartet.
 *
 * ── REIN ────────────────────────────────────────────────────────────────
 *
 * Diese Datei kennt keine Fläche und keinen Motor. Damit ist prüfbar, WAS
 * gefragt wird, ohne etwas zu rendern.
 */

/** Wie ein Feld auszufüllen ist. */
export type Feldart = 'text' | 'email' | 'telefon' | 'auswahl';

export interface Feld {
  /** Der Einstellungsschlüssel. ⚠️ Derselbe, den die Riegel lesen. */
  schluessel: string;
  etikett: string;
  /** Ein Satz, der sagt, WOFÜR die Kasse das braucht. Kein Beiwerk. */
  wozu: string;
  art: Feldart;
  /** Nur bei `auswahl`. */
  optionen?: ReadonlyArray<{ wert: string; etikett: string }>;
  /**
   * Was passiert, wenn es leer bleibt. Steht direkt am Feld — der Händler
   * soll entscheiden können, ohne zu raten.
   */
  wennLeer: string;
  /** Ein Beispiel für die Form, NIE ein Vorgabewert. */
  form?: string;
}

export interface Schritt {
  kennung: string;
  titel: string;
  /** Ein bis zwei Sätze. Der Ton des Hauses: sachlich, ohne Werbung. */
  einleitung: string;
  felder: readonly Feld[];
  /**
   * Ein Schritt, der nichts erfragt, sondern führt (die TSE). Dann ist
   * `felder` leer und `anleitung` trägt den Weg.
   */
  anleitung?: readonly string[];
  /** Die Seite auf norns.de, die diesen Schritt ausführlich erklärt. */
  hilfe?: string;
}

/**
 * ── ⚠️ 15.08.2026: ACHT VERWEISE ZEIGTEN INS LEERE ─────────────────────────
 *
 * Gemessen an diesem Tag, anonym gegen die echte Seite:
 *
 *     norns.de                 HTTP 200
 *     norns.de/anleitung       HTTP 404   ← die Wurzel selbst
 *     norns.de/hilfe           HTTP 404
 *     norns.de/dokumentation   HTTP 404
 *
 * Die Kasse hat also in 0.6.0 acht Knöpfe ausgeliefert, die den Händler auf
 * eine Fehlerseite führen — an genau den Stellen, an denen er nicht
 * weiterweiss. Ein Verweis, der nicht trägt, ist schlimmer als keiner: er
 * kostet Vertrauen in dem Moment, in dem jemand Hilfe sucht.
 *
 * ── WIE ES JETZT GELÖST IST: DIE KASSE KENNT KEINEN PFAD MEHR ─────────────
 *
 * Der erste Versuch war ein Schalter, der alle acht Knöpfe auf die Startseite
 * umlenkte, bis die Unterseiten stehen. Er hat geholfen und war trotzdem die
 * falsche Bauart, denn er behandelte das Symptom: solange die AUSGELIEFERTE
 * Kasse den Pfad kennt, ist jede spätere Umsortierung der Anleitung ein
 * Versprechen, das die Webseite nie wieder brechen darf.
 *
 * Seit dem 15.08.2026 schickt die Kasse deshalb nur noch eine KENNUNG, und
 * der Server entscheidet beim Klick, wohin sie führt:
 *
 *     https://norns.de/h/einrichtung.tse
 *
 * Das ist der Weg, den die Häuser gehen, die dieses Problem seit Jahrzehnten
 * haben, gemessen an ihren lebenden Systemen: Microsoft mit `fwlink`, Apple
 * mit `help:anchor`, JetBrains mit seinen Themenkennungen, GNOME mit `help:`.
 * Der Gewinn ist derselbe: eine Kasse, die drei Jahre auf einem Tresen steht,
 * findet immer die heute richtige Seite, und die Anleitung darf beliebig
 * umgebaut werden.
 *
 * Zwei Eigenschaften macht der Weiser auf der Gegenseite verbindlich, siehe
 * `src/app/h/[kennung]/route.ts` im Webseitenbaum: er antwortet mit 302 und
 * `no-store`, damit die Zuordnung änderbar bleibt, und eine unbekannte
 * Kennung führt NIE auf einen Fehler, sondern auf das Verzeichnis der
 * Anleitung, mit der gesuchten Kennung in der Adresse.
 *
 * ⛔ EINE KENNUNG WIRD NIE UMBENANNT. Der Text darüber darf sich ändern, die
 * Seite darf umziehen, die Kennung bleibt. Sonst verlieren genau die Kassen
 * den Anschluss, die am längsten laufen.
 */
export const HILFE_WURZEL = 'https://norns.de';

/**
 * Die Kennungen, unter denen die Erstinbetriebnahme ihre Hilfe verlangt.
 *
 * Der Namensraum `einrichtung.` steht davor, damit später andere Bereiche
 * dazukommen können, ohne dass sich zwei Kennungen ins Gehege kommen. Der
 * Wächter `hilfeweiser.test.ts` im Webseitenbaum vergleicht diese Liste mit
 * dem Register und wird rot, sobald die Kasse etwas verlangt, das dort fehlt.
 */
export const HILFE_KENNUNGEN = [
  'einrichtung.betrieb',
  'einrichtung.module',
  'einrichtung.steuer',
  'einrichtung.kontakt',
  'einrichtung.verfahrensdokumentation',
  'einrichtung.steuerberater',
  'einrichtung.tse',
  'einrichtung.kassenmeldung',
  // 19.08.2026, der Namensraum `norns.`: die staendigen Hausadressen der
  // Kasse (Einstellungen, Hilfe-Bereich). Dieselbe Regel wie oben: eine
  // Kennung wird NIE umbenannt; zieht die Seite um, haengt der Weiser sie um.
  'norns.anleitung',
  'norns.support',
  'norns.preise',
] as const;

/**
 * Die Adresse für einen Schritt.
 *
 * ⚠️ Hier stand `HILFE_UNTERSEITEN_LIVE`, ein Schalter, der zwischen Wurzel
 * und Unterseite umlegte. Er ist ersatzlos weg: mit dem Weiser gibt es keinen
 * Zustand mehr, in dem ein Verweis ins Leere zeigen könnte. Fehlt eine Seite
 * noch, fängt das Verzeichnis den Händler auf, und wir sehen in den
 * Zugriffsdaten, welche Seite er verlangt hat.
 */

import { HAUSSTANDARD_DSFINVK } from '../../lib/hausstandard-dsfinvk.js';

export function hilfeFuer(kennung: (typeof HILFE_KENNUNGEN)[number]): string {
  return `${HILFE_WURZEL}/h/${kennung}`;
}

/**
 * ── VORGABEN STATT FRAGEN (Basels Anweisung vom 18.08.2026) ────────────────
 *
 * „Die meisten Dinge sollen sinnvolle Vorgaben sein, auf die sich Steuerrecht
 * und Steuerberater einigen; gefragt wird nur das wirklich Notwendige."
 *
 * Umgesetzt nach der Regel, die dieses Haus seit dem 12.08. traegt:
 * VORSCHLAG JA, STILLE VORGABE NEIN. Diese Funktion nennt fuer LEERE Felder
 * einen sichtbaren Vorschlag; der Assistent traegt ihn in den Entwurf ein,
 * der Mensch sieht jeden Wert und speichert selbst.
 *
 * Was vorgeschlagen wird, und WARUM es vorgeschlagen werden darf:
 *
 *   shop.country_code            DEU. Diese Kasse setzt deutsches Kassenrecht
 *                                um (§ 146a AO, KassenSichV, DSFinV-K); ein
 *                                Betrieb, der sie einsetzt, sitzt in
 *                                Deutschland. Die Auswahl bleibt aenderbar.
 *   dsfinvk.*                    Der amtlich gegengepruefte Hausstandard vom
 *                                12.08.2026 (lib/hausstandard-dsfinvk.ts),
 *                                exakt die Werte, die auch die
 *                                SteuerberaterSection als Entwurf anbietet.
 *   betrieb.inbetriebnahme_am    Der HEUTIGE Tag: der Assistent laeuft am Tag
 *                                der Inbetriebnahme, das ist die beste
 *                                verfuegbare Angabe, sichtbar und aenderbar.
 *
 * ⛔ Was NIE vorgeschlagen wird, mit Absicht:
 *
 *   steuer.modus                 Ein geratener Steuerstatus ist nach § 14c
 *   steuer.modus_gilt_ab         UStG geschuldete Steuer, und ein geratenes
 *                                Datum macht jeden aelteren Beleg im
 *                                Buchungsstapel falsch (Befund vom 11.08.).
 *   betrieb.verantwortlich_*     Wer verantwortet, sagt der Betrieb, nicht
 *                                die Kasse. Ein Name ist keine Vorgabe.
 *
 * Der Waechter `vorgaben-statt-fragen.test.ts` pinnt beide Listen.
 */
export function vorschlaegeFuerLeereFelder(heute: string): Readonly<Record<string, string>> {
  return {
    'shop.country_code': 'DEU',
    'dsfinvk.gv_typ.ankauf': HAUSSTANDARD_DSFINVK['dsfinvk.gv_typ.ankauf'],
    'dsfinvk.ust_schluessel.margin_25a': HAUSSTANDARD_DSFINVK['dsfinvk.ust_schluessel.margin_25a'],
    'dsfinvk.ust_satz.margin_25a': HAUSSTANDARD_DSFINVK['dsfinvk.ust_satz.margin_25a'],
    'dsfinvk.ust_beschreibung.margin_25a':
      HAUSSTANDARD_DSFINVK['dsfinvk.ust_beschreibung.margin_25a'],
    'betrieb.inbetriebnahme_am': heute,
  };
}

/*
 * ── DIE REIHENFOLGE FOLGT DEN SPERREN (19.08.2026) ────────────────────────
 *
 * Basels Befund: die ersten Schritte „passen nicht zur Staerke des
 * Programms". Gemessen war es mehr als ein Gefuehl — die Ordnung war
 * verkehrt herum.
 *
 * Im Motor (`lib/einrichtung.ts`) tragen GENAU ZWEI Angaben die Sperre
 * `VERKAUF`, halten die Kasse also wirklich an:
 *
 *   steuer.modus (+ gilt-ab)   ohne ihn ist kein Verkauf moeglich
 *   tse.tss_id                 ohne die Sicherungseinrichtung ebenso
 *
 * Alles Uebrige sperrt hoechstens den EXPORT (Steuerberater-Angaben,
 * Verfahrensdokumentation) oder gar nichts (Kontakt, Module).
 *
 * Vorher stand die Sicherungseinrichtung an ACHTER Stelle, hinter Kontakt,
 * Verantwortlichen und Steuerberater-Nummern: der Haendler beantwortete
 * eine halbe Stunde lang Fragen, die den Verkauf nicht betreffen, und stiess
 * erst danach auf das eine, was ihn wirklich aufhaelt.
 *
 * Jetzt: die beiden Sperren zuerst, dann der Pruefstein — und der kann seinen
 * Satz „Das reicht fuer heute" endlich ehrlich sagen. Wer dort aufhoert, hat
 * eine Kasse, die VERKAUFT; die Startliste fuehrt ihn spaeter zum Rest.
 */
export const EINRICHTUNGS_SCHRITTE: readonly Schritt[] = [
  {
    kennung: 'betrieb',
    titel: 'Ihr Betrieb',
    einleitung:
      'Diese Angaben stehen auf jedem Beleg und in jedem Auszug für das Finanzamt. ' +
      'Sie werden einmal eingetragen und danach nicht mehr gefragt.',
    hilfe: hilfeFuer('einrichtung.betrieb'),
    felder: [
      {
        schluessel: 'shop.legal_name',
        etikett: 'Vollständiger Firmenname',
        wozu: 'So, wie er im Handelsregister oder auf Ihrer Gewerbeanmeldung steht.',
        art: 'text',
        form: 'Muster Edelmetallhandel e. K.',
        wennLeer: 'Ohne ihn entsteht kein Prüferpaket und kein Buchungsstapel.',
      },
      {
        schluessel: 'shop.street',
        etikett: 'Straße und Hausnummer',
        art: 'text',
        wozu: 'Die Anschrift des Betriebs, nicht Ihre private.',
        wennLeer: 'Ohne sie ist das Prüferpaket unvollständig.',
      },
      {
        schluessel: 'shop.postal_code',
        etikett: 'Postleitzahl',
        art: 'text',
        wozu: 'Getrennt vom Ort, weil die amtliche Schnittstelle beides einzeln verlangt.',
        wennLeer: 'Ohne sie ist das Prüferpaket unvollständig.',
      },
      {
        schluessel: 'shop.city',
        etikett: 'Ort',
        art: 'text',
        wozu: 'Getrennt von der Postleitzahl, aus demselben Grund.',
        wennLeer: 'Ohne ihn ist das Prüferpaket unvollständig.',
      },
      {
        schluessel: 'shop.country_code',
        etikett: 'Länderkennzeichen',
        art: 'auswahl',
        wozu:
          'Die amtliche Schnittstelle verlangt den dreistelligen Code. Diese Kasse setzt ' +
          'deutsches Kassenrecht um, darum ist Deutschland vorgeschlagen.',
        optionen: [
          { wert: 'DEU', etikett: 'Deutschland (DEU)' },
          { wert: 'AUT', etikett: 'Österreich (AUT)' },
          { wert: 'CHE', etikett: 'Schweiz (CHE)' },
        ],
        wennLeer: 'Ohne es ist das Prüferpaket unvollständig.',
      },
    ],
  },

  {
    kennung: 'steuer',
    titel: 'Steuer',
    einleitung:
      'Diese beiden Angaben entscheiden, was auf dem Beleg ausgewiesen wird. ' +
      'Ein falscher Ausweis ist nach § 14c UStG geschuldete Steuer. Die Kasse ' +
      'rät hier nichts und verkauft lieber gar nicht.',
    hilfe: hilfeFuer('einrichtung.steuer'),
    felder: [
      {
        schluessel: 'steuer.modus',
        etikett: 'Umsatzsteuer-Status',
        art: 'auswahl',
        wozu: 'Legt fest, ob auf dem Beleg Umsatzsteuer erscheint.',
        optionen: [
          { wert: 'REGELBESTEUERUNG', etikett: 'Regelbesteuerung, Umsatzsteuer wird ausgewiesen' },
          { wert: 'KLEINUNTERNEHMER_19', etikett: 'Kleinunternehmer nach § 19 UStG, Umsätze steuerfrei' },
        ],
        wennLeer: 'Ohne ihn ist KEIN Verkauf möglich. Das ist Absicht.',
      },
      /**
       * ⚠️ 11.08.2026: dieses Feld FEHLTE, und das war der teuerste Mangel
       * dieser Datei.
       *
       * Der Assistent schrieb nur `steuer.modus`. Der Riegel im Verkaufsweg
       * reicht BEIDE Schlüssel an `leseSteuerstand` weiter, und ohne gültiges
       * Datum kommt „nicht beantwortet" zurück. Gemessen an einer Kasse mit
       * vollständig ausgefülltem Assistenten: die Startliste meldete
       * `kannVerkaufen = true`, und der erste Verkauf endete mit HTTP 403
       * `VAT_CHECK_REQUIRED`.
       *
       * Ein Vorgabewert wäre hier besonders schädlich: das Datum entscheidet,
       * ab wann welcher Status gilt, und ein geratenes „heute" machte jeden
       * älteren Beleg im Buchungsstapel falsch. Also fragen, nicht setzen.
       */
      {
        schluessel: 'steuer.modus_gilt_ab',
        etikett: 'Dieser Status gilt ab',
        art: 'text',
        wozu:
          'Ab welchem Tag der gewählte Status gilt. Wer später wechselt, hat für die Zeit ' +
          'davor andere Belege, und der Buchungsstapel braucht diese Grenze.',
        form: '2026-01-01',
        wennLeer:
          'Ohne dieses Datum gilt der Status als nicht beantwortet, und es ist KEIN Verkauf ' +
          'möglich, genauso, als stünde oben nichts.',
      },
      {
        schluessel: 'shop.tax_number',
        etikett: 'Steuernummer',
        art: 'text',
        wozu: 'Vom Finanzamt vergeben. § 14 Abs. 4 Nr. 2 UStG verlangt sie ODER die USt-IdNr.',
        form: '12345/67890',
        wennLeer: 'Dann muss die USt-IdNr. unten stehen; eines von beiden genügt.',
      },
      {
        schluessel: 'shop.vat_id',
        etikett: 'Umsatzsteuer-Identifikationsnummer',
        art: 'text',
        wozu: 'Nur, wenn Sie eine haben. Sie hat auf dem Beleg Vorrang vor der Steuernummer.',
        form: 'DE123456789',
        wennLeer: 'Dann steht die Steuernummer auf dem Beleg.',
      },
    ],
  },

  /*
   * ── DER PRUEFSTEIN ────────────────────────────────────────────────────
   *
   * Basels Entscheidung vom 14.08.2026, auf ausdrueckliche Nachfrage:
   * der Pruefstein LAESST DEN HAENDLER IN DIE KASSE, auch wenn die
   * technische Sicherheitseinrichtung noch fehlt.
   *
   * Das ist eine Haltungsfrage, und sie ist entschieden. Der Pruefstein
   * haelt niemanden auf, aber er beschoenigt auch nichts: er sagt, was
   * die Kasse jetzt kann, was ihr fehlt, und was das kostet.
   *
   * ⚠️ Er hat KEINE Felder. Er ist eine Zaesur, kein Formular. Nach den
   * beiden Fragen, an denen wirklich alles haengt, soll der Haendler
   * aufhoeren duerfen: der erste Morgen mit Kundschaft vor dem Tresen ist
   * kein guter Zeitpunkt fuer die Angaben des Steuerberaters.
   *
   * Was er anzeigt, kommt aus der ECHTEN Startliste des Motors und wird
   * NICHT hier gerechnet. Der Waechter `keine-erfundene-bereitschaft`
   * misst das: eine zweite, eigene Rechnung waere der naechste stille
   * Widerspruch zwischen dem, was die Flaeche sagt, und dem, was der
   * Riegel tut.
   */
  {
    kennung: 'tse',
    titel: 'Die technische Sicherheitseinrichtung',
    einleitung:
      'Ohne sie darf diese Kasse nicht verkaufen. § 146a AO verlangt, dass jeder ' +
      'Geschäftsvorfall von einer zertifizierten Einrichtung protokolliert wird. ' +
      'Sie ist der einzige Schritt, für den Sie kurz das Internet brauchen.',
    hilfe: hilfeFuer('einrichtung.tse'),
    felder: [],
    anleitung: [
      'Sie schliessen bei einem zertifizierten Anbieter einen Vertrag ab und erhalten zwei Kennungen.',
      'Diese tragen Sie GLEICH HIER ein. Die Kasse fragt beim Anbieter nach und speichert erst, wenn er bestätigt; ist er nicht erreichbar, wird nichts gespeichert.',
      '⚠️ Drei falsche Eingaben der PUK zerstören eine Sicherheitseinrichtung dauerhaft. Tippen Sie in Ruhe.',
      'Bis die Einrichtung steht, sagt die Kasse Ihnen auf der Startfläche, dass sie noch nicht verkaufen kann.',
    ],
  },

  {
    kennung: 'pruefstein',
    titel: 'Das reicht für heute',
    einleitung:
      'Die wichtigsten Angaben stehen. Was jetzt noch fehlt, können Sie ' +
      'jederzeit in den Einstellungen nachtragen, und die Startliste führt Sie ' +
      'zu jedem Punkt hin.',
    felder: [],
  },
  {
    /*
     * ── Die Module dieses Betriebs (14.08.2026, Basels Entscheidung) ────────
     *
     * Norns POS nimmt nicht an, dass jeder Händler Edelmetall verkauft. Die
     * Goldkunde bleibt vollständig im Programm und wird HIER je Betrieb ein-
     * oder ausgeschaltet, in den Einstellungen jederzeit änderbar. Vorgabe
     * ist AN, denn die heutigen Kunden sind Juweliere; leer gilt als AN.
     */
    kennung: 'module',
    titel: 'Was dieser Betrieb braucht',
    einleitung:
      'Nicht jeder Betrieb wiegt Gold. Was Sie hier ausschalten, verschwindet ' +
      'aus der Fläche, bleibt aber im Programm und lässt sich in den ' +
      'Einstellungen jederzeit wieder einschalten.',
    hilfe: hilfeFuer('einrichtung.module'),
    felder: [
      {
        schluessel: 'modul.kursleiste',
        etikett: 'Metallkurs-Leiste',
        wozu:
          'Der laufende Gold- und Silberkurs am oberen Rand der Kasse, mit ' +
          'Verlauf. Für Juweliere und Ankäufer; ein Betrieb ohne ' +
          'Edelmetall braucht ihn nicht.',
        art: 'auswahl',
        optionen: [
          { wert: 'AN', etikett: 'Anzeigen' },
          { wert: 'AUS', etikett: 'Ausblenden' },
        ],
        wennLeer: 'Die Leiste bleibt eingeschaltet.',
      },
      {
        schluessel: 'modul.waage',
        etikett: 'Waage',
        wozu:
          'Das Wiegen im Ankauf und die Waagen-Einrichtung unter Geräte. ' +
          'Wer nichts wiegt, sieht auch keine Waage.',
        art: 'auswahl',
        optionen: [
          { wert: 'AN', etikett: 'Anzeigen' },
          { wert: 'AUS', etikett: 'Ausblenden' },
        ],
        wennLeer: 'Die Waage bleibt eingeschaltet.',
      },
    ],
  },

  {
    kennung: 'kontakt',
    titel: 'Kontakt',
    einleitung:
      'Damit Ihre Kundschaft Sie erreicht. Erscheint auf dem gedruckten Beleg, ' +
      'sonst nirgends.',
    /**
     * ⚠️ 09.08.2026: hier stand zuerst ein Feld `shop.email`. Diesen Schlüssel
     * gibt es NICHT — in keiner Wanderung und nirgends im Motor. Der Assistent
     * hätte in ein Nichts geschrieben, und der Händler hätte ein ausgefülltes
     * Formular gesehen, hinter dem nichts steht.
     *
     * Die eigene Prüfung „gibt es jeden genannten Schlüssel wirklich?" hat es
     * gefangen, bevor eine Fläche darauf gebaut war. Wer die E-Mail aufnehmen
     * will, legt zuerst eine Wanderung nach dem Muster von 0126 an — LEER.
     */
    hilfe: hilfeFuer('einrichtung.kontakt'),
    felder: [
      {
        schluessel: 'shop.phone',
        etikett: 'Telefon',
        art: 'telefon',
        wozu: 'Erscheint auf dem gedruckten Beleg.',
        wennLeer: 'Der Beleg trägt dann keine Telefonnummer.',
      },
    ],
  },

  {
    kennung: 'verantwortung',
    titel: 'Wer verantwortet',
    einleitung:
      'Rz. 21 GoBD: die Verantwortung für die Ordnungsmässigkeit der Aufzeichnungen ' +
      'bleibt bei Ihnen, auch wenn Sie Aufgaben abgeben. Diese Namen stehen in Ihrer ' +
      'Verfahrensdokumentation.',
    hilfe: hilfeFuer('einrichtung.verfahrensdokumentation'),
    felder: [
      {
        schluessel: 'betrieb.verantwortlich_aufzeichnungen',
        etikett: 'Verantwortlich für die Aufzeichnungen',
        art: 'text',
        wozu: 'Der Mensch, nicht die Rolle. Meist Sie selbst.',
        wennLeer: 'Die Verfahrensdokumentation weist die Stelle sichtbar als offen aus.',
      },
      {
        schluessel: 'betrieb.geldwaeschebeauftragter',
        etikett: 'Geldwäschebeauftragter nach § 7 GwG',
        art: 'text',
        wozu: 'Der Edelmetallhandel fällt unter § 2 Abs. 1 Nr. 16 GwG.',
        wennLeer: 'Wenn Sie keinen bestellt haben, lassen Sie es leer. Das ist eine ehrliche Angabe.',
      },
      {
        schluessel: 'betrieb.sicherungsort',
        etikett: 'Wo die Sicherungskopien liegen',
        art: 'text',
        // 12.08.2026: hier stand "Abs. 1" — der zaehlt nur auf, WAS aufzubewahren
        // ist; die zehn Jahre stehen in Abs. 3. Die eigene Verfahrensdokumentation
        // zitierte es laengst richtig, der Assistent widersprach ihr.
        wozu: '§ 147 Abs. 3 AO verlangt zehn Jahre Aufbewahrung. Die Kasse sichert; wohin Sie die Kopie tragen, weiss nur Sie.',
        form: 'Bankschliessfach',
        wennLeer: 'Die Verfahrensdokumentation weist die Stelle sichtbar als offen aus.',
      },
    ],
  },

  {
    // 12.08.2026, Basels Auftrag: der sechste Schritt. Das erste installierte
    // Geraet fragt die Ausfuhr-Angaben gleich mit ab, statt dass der erste
    // Export Wochen spaeter an einer leeren Frage anhaelt. Der Hausstandard
    // ist amtlich gegengeprueft (DSFinV-K 2.4 samt Anlage 2, per Pruefsumme
    // verifiziert); die Kanzlei zeichnet ihn ueber den Brief in docs/fiskal
    // gegen. NICHTS wird still gespeichert: `form` ist ein Beispiel im
    // Platzhalter, kein Vorgabewert — dieselbe Regel wie ueberall hier.
    kennung: 'steuerberater',
    titel: 'Ihr Steuerberater',
    einleitung:
      'Vier Angaben, mit denen das Prüferpaket und der DATEV-Export vom ersten Tag an ' +
      'laufen. Der Hausstandard ist amtlich geprüft; Ihre Kanzlei zeichnet ihn gegen ' +
      'oder ersetzt ihn durch eigene Werte.',
    hilfe: hilfeFuer('einrichtung.steuerberater'),
    felder: [
      {
        schluessel: 'dsfinvk.gv_typ.ankauf',
        etikett: 'Geschäftsvorfall beim Ankauf von Privat',
        art: 'auswahl',
        wozu:
          'Anhang C der DSFinV-K ist abschliessend; der amtliche Auffangtyp für ' +
          'Geldabflüsse ohne Umsatz ist die Auszahlung.',
        optionen: [
          { wert: 'Auszahlung', etikett: 'Auszahlung (amtlicher Auffangtyp, Hausstandard)' },
          { wert: 'Privatentnahme', etikett: 'Privatentnahme' },
          { wert: 'Umsatz', etikett: 'Umsatz' },
        ],
        wennLeer: 'Jeder Export hält an, sobald der Tag einen Ankaufbeleg enthält.',
      },
      {
        schluessel: 'dsfinvk.ust_schluessel.margin_25a',
        etikett: 'Umsatzsteuerschlüssel für § 25a',
        art: 'text',
        wozu:
          'Die Kennnummer im Prüferpaket. Amtlich sind die Nummern ab 1000 für eigene ' +
          'Fälle wie § 25a frei; Hausstandard ist 1001.',
        form: '1001',
        wennLeer: 'Bei Gold und Schmuck ist § 25a der Regelfall; fast jeder Export hält an.',
      },
      {
        schluessel: 'dsfinvk.ust_satz.margin_25a',
        etikett: 'Rechensatz für § 25a',
        art: 'text',
        wozu:
          'Der Satz auf die MARGE, als Rechengrösse des Pakets. Auf dem Beleg erscheint ' +
          'er nie, das verbietet § 14a Abs. 6 UStG.',
        form: '19.00',
        wennLeer: 'Die Spalte UST-SATZ bleibt im Prüferpaket leer, das Paket entsteht trotzdem.',
      },
      {
        schluessel: 'dsfinvk.ust_beschreibung.margin_25a',
        etikett: 'Beschriftung für § 25a',
        art: 'text',
        wozu: 'Der Text, den das Finanzamt neben dem Schlüssel liest. Höchstens 55 Zeichen.',
        form: 'Differenzbesteuerung § 25a UStG, Basis ist die Marge',
        wennLeer: 'Der Schlüssel steht unbeschriftet in der Datei.',
      },
    ],
  },

  {
    /*
     * ── ⛔ DIE PFLICHT, DIE IM GANZEN ERZEUGNIS NULL MAL VORKAM ──────────
     *
     * DER BEFUND (13.08.2026). „§ 146a Abs. 4" stand im ganzen Quelltext
     * genau einmal, als Randnotiz an einem Feldkommentar in
     * `dsfinvk-daten.ts`. Der Assistent führte den Händler durch TSE,
     * Steuerstatus, Geldwäsche und Aufbewahrung — und liess ihn mit der
     * einzigen Pflicht allein, die eine FRIST hat: seit dem 01.07.2025 ist
     * jede elektronische Kasse dem Finanzamt binnen eines Monats nach
     * Anschaffung mitzuteilen, elektronisch über Mein ELSTER, eine
     * Mitteilung je Betriebsstätte. Versäumnis ist nach § 379 AO
     * bussgeldbewehrt.
     *
     * ⚠️ Die zwei Felder sind KEINE Doppelung: beide werden von der
     * Verfahrensdokumentation gelesen (`verfahrensdokumentation.ts`), und
     * `betrieb.inbetriebnahme_am` hatte bis heute in der ganzen Kasse KEINEN
     * Weg, auf dem er je hätte gefüllt werden können — das Fach war offen,
     * das Dokument las es, und niemand konnte hineinschreiben.
     */
    kennung: 'kassenmeldung',
    titel: 'Die Meldung ans Finanzamt',
    einleitung:
      'Diese Kasse muss dem Finanzamt gemeldet werden, binnen eines Monats nach der ' +
      'Anschaffung. Die zwei Angaben unten braucht das Formular, und sie stehen danach ' +
      'auch in Ihrer Verfahrensdokumentation.',
    hilfe: hilfeFuer('einrichtung.kassenmeldung'),
    felder: [
      {
        schluessel: 'kasse.seriennummer',
        etikett: 'Seriennummer dieser Kasse',
        art: 'text',
        wozu:
          'Das Formular des Finanzamts verlangt sie, und das Prüferpaket führt sie in der ' +
          'Datei zur Kasse mit.',
        wennLeer:
          'Ohne sie lässt sich die Meldung nicht abgeben, und im Prüferpaket bleibt die ' +
          'Spalte zur Kasse leer.',
      },
      {
        schluessel: 'betrieb.inbetriebnahme_am',
        etikett: 'In Betrieb genommen am',
        art: 'text',
        wozu:
          'Von diesem Tag an läuft die Frist von einem Monat. Bei einer Kassennachschau ist ' +
          'es eine der ersten Fragen.',
        form: '2026-01-15',
        wennLeer: 'Die Verfahrensdokumentation weist die Stelle sichtbar als offen aus.',
      },
    ],
    anleitung: [
      'Melden können Sie nur elektronisch: in Mein ELSTER unter „Mitteilung über elektronische Aufzeichnungssysteme". Ein Brief oder eine E-Mail erfüllt die Pflicht nicht.',
      'Gemeldet wird je Betriebsstätte, nicht je Gerät: alle Kassen einer Betriebsstätte stehen in EINER Mitteilung.',
      'Die Angaben, die das Formular verlangt, stehen fertig in Ihrer Verfahrensdokumentation. Sie laden sie unter Einstellungen, Steuer und Buchhaltung als PDF herunter.',
      '⚠️ Melden Sie erst, wenn die technische Sicherheitseinrichtung steht: das Formular fragt nach ihr. Eine Änderung oder eine Ausserbetriebnahme ist ebenfalls binnen eines Monats zu melden.',
    ],
  },
];

/** Alle Schlüssel, die der Assistent schreibt. Für den Wächter. */
export function alleSchluessel(): string[] {
  return EINRICHTUNGS_SCHRITTE.flatMap((s) => s.felder.map((f) => f.schluessel));
}

/**
 * Welche Schritte noch offen sind, gemessen an den vorhandenen Einstellungen.
 *
 * ⚠️ Ein Schritt gilt als erledigt, wenn ALLE seine Felder gefüllt sind ODER
 * der Händler ihn bewusst übersprungen hat. Diese Funktion urteilt nur über
 * das Erste; das Überspringen merkt sich die Fläche.
 */
export function offeneSchritte(
  einstellungen: Readonly<Record<string, string | null | undefined>>,
): string[] {
  return EINRICHTUNGS_SCHRITTE.filter((s) => {
    if (s.felder.length === 0) return false; // reine Anleitung, siehe TSE
    return s.felder.some((f) => (einstellungen[f.schluessel] ?? '').trim() === '');
  }).map((s) => s.kennung);
}

/**
 * Braucht diese Kasse den Assistenten überhaupt?
 *
 * Gemessen am Firmennamen: er ist die eine Angabe, ohne die gar nichts geht,
 * und Wanderung 0126 legt ihn LEER an. Ist er gefüllt, war jemand schon hier.
 */
export function brauchtEinrichtung(
  einstellungen: Readonly<Record<string, string | null | undefined>>,
): boolean {
  return (einstellungen['shop.legal_name'] ?? '').trim() === '';
}
