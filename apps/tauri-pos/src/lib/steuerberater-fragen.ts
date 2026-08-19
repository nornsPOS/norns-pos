/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der Brief an den Steuerberater — der Inhalt, als reine Daten
 * ════════════════════════════════════════════════════════════════════════
 *
 * Basels Auftrag vom 12.08.2026: der Händler druckt die Fragen als Blatt
 * mit dem Zeichen des Hauses, die Kanzlei füllt es mit dem Stift aus.
 *
 * ── ⚠️ DIE LEBENDEN WERTE GEHEN MIT AUFS PAPIER ─────────────────────────
 *
 * Eine schon beantwortete Frage erscheint mit ihrem Wert und dem Hinweis
 * „in der Kasse hinterlegt, bitte prüfen" — die Kanzlei sieht den
 * Ist-Stand statt eines leeren Formulars, das so tut, als wüsste die Kasse
 * nichts. Eine offene Frage bekommt eine Schreiblinie und NIE eine stille
 * Vorgabe.
 *
 * Die inhaltliche Quelle ist docs/fiskal/fragen-an-den-steuerberater.md
 * (zweite Fassung nach der amtlichen Recherche vom 12.08.2026). REIN:
 * diese Datei kennt keine Fläche und keinen Motor, damit der Inhalt ohne
 * Rendern prüfbar ist.
 */

export interface FrageZeile {
  etikett: string;
  erklaerung: string;
  /** null = offen, Schreiblinie. Sonst der lebende Wert aus der Kasse. */
  wert: string | null;
}

export interface FrageAbschnitt {
  nummer: string;
  titel: string;
  einleitung: string;
  zeilen: FrageZeile[];
  absaetze: string[];
  gegenzeichnung: boolean;
}

export interface SteuerberaterFragenDaten {
  erzeugtAmText: string;
  firma: string;
  einleitung: string[];
  abschnitte: FrageAbschnitt[];
  schluss: string[];
}

/** Ein lebender Wert: getrimmt, leer wird zu null (= offene Frage). */
function wertOderOffen(einstellungen: Record<string, string>, schluessel: string): string | null {
  const roh = (einstellungen[schluessel] ?? '').trim();
  return roh === '' ? null : roh;
}

/**
 * Ein Ja-Nein-Wert für Menschen. Die Festschreibung liegt als jsonb-Boolean
 * in der Datenbank; ohne diese Übersetzung stünde das rohe Token `false` auf
 * dem Blatt für die Kanzlei (Befund der Gegenprüfung vom 12.08.2026).
 */
function jaNeinOderOffen(einstellungen: Record<string, string>, schluessel: string): string | null {
  const roh = wertOderOffen(einstellungen, schluessel);
  if (roh === null) return null;
  if (roh === 'true' || roh === 'ja') return 'ja';
  if (roh === 'false' || roh === 'nein') return 'nein';
  return roh;
}

/**
 * Ein BESTÄTIGTES Konto aus den Einstellungen, je Rahmen.
 *
 * `datev.konto.<rahmen>.<teil>` schreibt die Kontenrahmen-Fläche nur, wenn
 * der Inhaber ein Konto ausdrücklich bestätigt hat (kontenrahmen.ts). Ohne
 * diesen Blick druckte der Brief IMMER Schreiblinien, auch wenn die Kanzlei
 * die Konten längst festgelegt hatte.
 */
function bestaetigtesKonto(einstellungen: Record<string, string>, teil: string): string | null {
  const skr03 = wertOderOffen(einstellungen, `datev.konto.skr03.${teil}`);
  const skr04 = wertOderOffen(einstellungen, `datev.konto.skr04.${teil}`);
  if (skr03 === null && skr04 === null) return null;
  const stuecke: string[] = [];
  if (skr03 !== null) stuecke.push(`SKR03 ${skr03}`);
  if (skr04 !== null) stuecke.push(`SKR04 ${skr04}`);
  return stuecke.join(' / ');
}

/**
 * Der ganze Brief. `einstellungen` sind die ausgepackten Werte aus
 * `GET /api/settings`; `erzeugtAmText` kommt vom Aufrufer, damit diese
 * Datei ohne Uhr bleibt und der Test nicht mit dem Kalender stirbt.
 */
export function baueSteuerberaterFragen(
  einstellungen: Record<string, string>,
  erzeugtAmText: string,
): SteuerberaterFragenDaten {
  const w = (k: string): string | null => wertOderOffen(einstellungen, k);

  return {
    erzeugtAmText,
    firma: (einstellungen['shop.legal_name'] ?? '').trim(),
    einleitung: [
      'Dieses Blatt stammt aus der Kasse Norns POS. Teil A sind die Angaben, die nur ' +
        'Ihre Kanzlei liefern kann; bitte tragen Sie sie auf den Schreiblinien ein. ' +
        'Teil B sind Standards, die nach den amtlichen Quellen gesetzt wurden ' +
        '(DSFinV-K 2.4 samt Anlage 2, UStAE, offizielle Kontenrahmen 2025); bitte ' +
        'zeichnen Sie sie gegen oder vermerken Sie Abweichungen.',
      'Die Antworten mit eigenem Feld werden danach einmal in der Kasse eingetragen, ' +
        'unter Einstellungen, Steuer und Buchhaltung; die übrigen fliessen in die ' +
        'Einrichtung durch den Hersteller ein. Wo die Norm eine Angabe zwingend ' +
        'braucht, hält die Kasse die betroffene Ausfuhr an, statt etwas Falsches zu ' +
        'liefern; der Verkauf läuft davon unberührt.',
    ],
    abschnitte: [
      {
        nummer: 'A1.',
        titel: 'Die sechs Kopfangaben des DATEV-Buchungsstapels',
        einleitung:
          'Sie stehen im Kopf jedes Buchungsstapels und müssen zum Bestand Ihrer ' +
          'Kanzlei passen. Ohne sie wird keine DATEV-Datei erzeugt.',
        zeilen: [
          {
            etikett: 'Beraternummer der Kanzlei',
            erklaerung: '4 bis 7 Ziffern',
            wert: w('datev.beraternummer'),
          },
          {
            etikett: 'Mandantennummer dieses Ladens',
            erklaerung: '1 bis 5 Ziffern',
            wert: w('datev.mandantennummer'),
          },
          {
            etikett: 'Beginn des Wirtschaftsjahres',
            erklaerung: 'JJJJ-MM-TT, Regelfall der 1. Januar',
            wert: w('datev.wirtschaftsjahr_beginn'),
          },
          {
            etikett: 'Länge der Sachkonten',
            erklaerung: '4 bis 8 Stellen',
            wert: w('datev.sachkontenlaenge'),
          },
          {
            etikett: 'Festschreibung der Stapel',
            erklaerung:
              'ja oder nein; ein festgeschriebener Stapel lässt sich in der Kanzlei ' +
              'nicht mehr ändern',
            wert: jaNeinOderOffen(einstellungen, 'datev.festschreibung'),
          },
          {
            etikett: 'Kontenrahmen',
            erklaerung: 'SKR03 oder SKR04',
            wert: w('datev.sachkontenrahmen'),
          },
        ],
        absaetze: [],
        gegenzeichnung: false,
      },
      {
        nummer: 'A2.',
        titel: 'Erlös- und Wareneingangskonten samt Automatik-Frage',
        einleitung:
          'Welche Konten wünscht die Kanzlei für die Erlöse (je Steuerart, insbesondere ' +
          '§ 25a) und den Wareneingang aus Ankäufen? Bitte je Konto vermerken, ob es ein ' +
          'Automatikkonto ist (Kennzeichen AM oder AV im Kontenrahmen), denn bei ' +
          'Automatikkonten darf der Stapel keinen BU-Schlüssel mitgeben.',
        zeilen: [
          {
            etikett: 'Erlöse § 25a, Einkaufsanteil',
            erklaerung: 'Vorlage SKR03 8193 / SKR04 4138',
            wert: bestaetigtesKonto(einstellungen, 'erloese_margin_25a_einkaufsanteil'),
          },
          {
            etikett: 'Erlöse § 25a, Marge',
            erklaerung: 'Vorlage SKR03 8191 / SKR04 4136',
            wert: bestaetigtesKonto(einstellungen, 'erloese_margin_25a_marge'),
          },
          {
            etikett: 'Erlöse Regelbesteuerung 19 %',
            erklaerung: 'Vorlage SKR03 8400 / SKR04 4400',
            wert: bestaetigtesKonto(einstellungen, 'erloese_standard_19'),
          },
          {
            etikett: 'Wareneingang aus Ankäufen',
            erklaerung: 'Vorlage SKR03 3200 / SKR04 5200',
            wert: bestaetigtesKonto(einstellungen, 'wareneingang'),
          },
          { etikett: 'Automatikkonten darunter (welche?)', erklaerung: '', wert: null },
        ],
        absaetze: [],
        gegenzeichnung: false,
      },
      {
        nummer: 'A3.',
        titel: 'Zwei Zahlarten ohne Konto',
        einleitung:
          'Ein Tag, an dem eine davon vorkommt, ist bis zur Antwort für DATEV nicht ' +
          'lieferbar. Bitte je Zahlart das Konto in SKR03 oder SKR04 nennen; für diese ' +
          'zwei gibt es noch kein Eingabefeld, die Antwort fliesst über den Hersteller ' +
          'in die Kasse ein.',
        zeilen: [
          { etikett: 'Kundenkonto (Anzahlung oder Guthaben)', erklaerung: '', wert: null },
          { etikett: 'Inzahlungnahme (Ware statt Geld)', erklaerung: '', wert: null },
        ],
        absaetze: [],
        gegenzeichnung: false,
      },
      {
        nummer: 'A3a.',
        titel: 'Drei Buchungsfragen aus der Prüfung vom 19.08.2026',
        einleitung:
          'Drei Punkte, die die Kasse bewusst NICHT selbst entscheidet, weil die Wahl ' +
          'der Kanzlei zusteht. Bis zur Antwort gilt: Kassendifferenzen erscheinen nur ' +
          'im Kassenbericht (nicht als DATEV-Buchung), Barausgaben gehen brutto ohne ' +
          'Vorsteuerschlüssel an DATEV, und die §-25a-Konten bleiben 8193 und 8191.',
        zeilen: [
          {
            etikett: 'Konto für Kassendifferenzen (Fehl- oder Überbestand beim Zählen)',
            erklaerung:
              'Der gezählte Bestand weicht vom rechnerischen ab; heute entsteht dafür ' +
              'keine DATEV-Zeile, Konto 1000 zeigt also den SOLL-Bestand, nicht den ' +
              'gezählten. Welches Aufwands- und Ertragskonto wünscht die Kanzlei?',
            wert: null,
          },
          {
            etikett: 'Vorsteuer aus Barausgaben (Porto, Büro, Werbung)',
            erklaerung:
              'DATEVs Musterdatei bucht Schreibwaren mit Schlüssel 9 (19 % Vorsteuer). ' +
              'Die Kasse gibt heute KEINEN Schlüssel mit, weil sie nicht prüfen kann, ' +
              'ob der Papierbeleg die Rechnungsanforderungen erfüllt. Soll sie den ' +
              'Schlüssel mitgeben, oder re-kontiert die Kanzlei vom Beleg?',
            wert: null,
          },
          {
            etikett: 'Kontenwechsel 2027: 8193/8191 werden gestrichen',
            erklaerung:
              'DATEV hat die kombinierten §§-25/25a-Konten zum Jahrgang 2026 geteilt: ' +
              'neu sind 8197 (ohne USt) und 8199 (19 %), SKR04 4132 und 4134. Die ' +
              'alten 8193/8191 tragen Fussnote 11 und fallen 2027 weg. Ab wann soll ' +
              'die Kasse die neuen Konten schreiben?',
            wert: null,
          },
        ],
        absaetze: [],
        gegenzeichnung: false,
      },
      {
        nummer: 'A3b.',
        titel: 'Warenrücknahme differenzbesteuerter Ware (§ 25a)',
        einleitung:
          'Die Kasse kann seit dem 19.08.2026 einzelne Positionen eines Verkaufs ' +
          'zurücknehmen (neuer Beleg mit negativen Beträgen, DSFinV-K Tz. 4.2.5, ' +
          'Minderung nach § 17 Abs. 1 Satz 8 UStG in der laufenden Periode). Für ' +
          'REGELBESTEUERTE Ware ist das eindeutig. Für § 25a-Ware lässt der UStAE ' +
          'offen, was eine Kulanzrücknahme gegen volle Erstattung ist. Bis zur ' +
          'Antwort sperrt die Kasse diesen Weg für § 25a-Stücke und verweist auf ' +
          'den Ankauf (immer zulässig).',
        zeilen: [
          {
            etikett: 'Rückabwicklung oder Rücklieferung?',
            erklaerung:
              'Rückabwicklung: die Marge des Ursprungsgeschäfts wird in der laufenden ' +
              'Periode neutralisiert, das Stück liegt mit dem ALTEN Einkaufspreis im ' +
              'Bestand (§ 17 Abs. 2 Nr. 3 UStG, Kriterien UStAE 17.1 Abs. 8). ' +
              'Rücklieferung: die alte Marge bleibt versteuert, die Auszahlung ist ein ' +
              'NEUER Einkaufspreis (Ankauf von privat).',
            wert: null,
          },
          {
            etikett: 'Erstattung ohne auffindbaren Ursprungsbeleg?',
            erklaerung:
              'Ohne Nachweis des Ursprungsverkaufs fehlt die Grundlage der § 17-Korrektur. ' +
              'Zulässig nur Ankauf oder Gutschein, oder gar nicht?',
            wert: null,
          },
        ],
        absaetze: [],
        gegenzeichnung: false,
      },
      {
        nummer: 'A4.',
        titel: 'Wahlrecht Gesamtdifferenz für Kleinteile',
        einleitung:
          'Die Kasse rechnet nach der Einzeldifferenz, siehe B4. Für Gegenstände bis ' +
          '750 EUR Einkaufspreis erlaubt § 25a Abs. 4 UStG wahlweise die Gesamtdifferenz ' +
          '(Wechsel nur zu Beginn eines Kalenderjahres, UStAE 25a.1 Abs. 14). Heutiger ' +
          'Stand: nein, Einzeldifferenz für alles.',
        zeilen: [
          { etikett: 'Wahlrecht ausüben? (ja / nein, ab wann)', erklaerung: '', wert: null },
        ],
        absaetze: [],
        gegenzeichnung: false,
      },
      {
        nummer: 'A5.',
        titel: 'Einordnung des Sortiments',
        einleitung:
          'Welche Warengruppen sind Edelmetall im Sinne der Zolltarifpositionen 71 06, ' +
          '71 08, 71 10, 71 12 (dann keine Differenzbesteuerung, § 25a Abs. 1 Nr. 3 ' +
          'UStG), welche verarbeitete Ware wie Schmuck (differenzfähig), welche ' +
          'steuerbefreites Anlagegold nach § 25c UStG?',
        zeilen: [
          { etikett: 'Barren und Münzen (Anlagegold?)', erklaerung: '', wert: null },
          { etikett: 'Schmuck und verarbeitete Ware', erklaerung: '', wert: null },
          { etikett: 'Sonstiges (Uhren, Silberwaren …)', erklaerung: '', wert: null },
        ],
        absaetze: [],
        gegenzeichnung: false,
      },
      {
        nummer: 'B1.',
        titel: 'Umsatzsteuerschlüssel 1001 für § 25a und 1002 für § 13b',
        einleitung:
          'Amtliche Lage (DSFinV-K 2.4, Tz. 3.2.6, sowie Anlage 2 vom 05.12.2024): es ' +
          'gibt keine amtlich vergebene Nummer für § 25a oder § 13b; der Bereich ab ' +
          '1000 ist wörtlich für genau diese Fälle freigegeben. Beide Nummern stehen ' +
          'in der Verfahrensdokumentation der Kasse.',
        zeilen: [
          {
            etikett: 'Schlüssel § 25a',
            erklaerung: 'Hausstandard 1001',
            wert: w('dsfinvk.ust_schluessel.margin_25a'),
          },
          {
            etikett: 'Rechensatz § 25a',
            erklaerung:
              'Rechengrösse auf die Marge, erscheint nie offen auf dem Beleg; ' +
              'Hausstandard 19.00',
            wert: w('dsfinvk.ust_satz.margin_25a'),
          },
          {
            etikett: 'Beschriftung § 25a im Prüferpaket',
            erklaerung:
              'das amtliche Feld fasst höchstens 55 Zeichen; Hausstandard ' +
              '"Differenzbesteuerung § 25a UStG, Basis ist die Marge"',
            wert: w('dsfinvk.ust_beschreibung.margin_25a'),
          },
          {
            etikett: 'Schlüssel § 13b',
            erklaerung: 'Hausstandard 1002',
            wert: w('dsfinvk.ust_schluessel.reverse_charge_13b'),
          },
          {
            etikett: 'Rechensatz § 13b',
            erklaerung: 'die Steuer schuldet der Empfänger; Hausstandard 0.00',
            wert: w('dsfinvk.ust_satz.reverse_charge_13b'),
          },
          {
            etikett: 'Beschriftung § 13b im Prüferpaket',
            erklaerung:
              'höchstens 55 Zeichen; Hausstandard "Steuerschuldnerschaft des ' +
              'Leistungsempfängers"',
            wert: w('dsfinvk.ust_beschreibung.reverse_charge_13b'),
          },
        ],
        absaetze: [],
        gegenzeichnung: true,
      },
      {
        nummer: 'B2.',
        titel: 'Belegtexte',
        einleitung:
          'Bei § 25a weist der Beleg keine Umsatzsteuer offen aus (§ 14a Abs. 6 Satz 2 ' +
          'UStG) und trägt die Pflichtangabe "Gebrauchtgegenstände/Sonderregelung". Bei ' +
          '§ 13b steht "Steuerschuldnerschaft des Leistungsempfängers" (§ 14a Abs. 5 UStG).',
        zeilen: [],
        absaetze: [],
        gegenzeichnung: true,
      },
      {
        nummer: 'B3.',
        titel: 'Geschäftsvorfalltyp des Ankaufs: Auszahlung',
        einleitung:
          'Anhang C der DSFinV-K 2.4 zählt abschliessend 25 Typen; einen Typ "Ausgabe" ' +
          'oder "Ankauf" gibt es nicht. Der amtliche Auffangtyp für Geldabflüsse ohne ' +
          'Umsatz heisst Auszahlung; das amtliche Rechenbeispiel in Anhang I ordnet ' +
          'sogar einen Warenkauf gegen Bargeld diesem Typ zu.',
        zeilen: [
          {
            etikett: 'Typ für den Ankauf von Privat',
            erklaerung: 'Hausstandard Auszahlung, Untergliederung über das Namensfeld',
            wert: w('dsfinvk.gv_typ.ankauf'),
          },
        ],
        absaetze: [],
        gegenzeichnung: true,
      },
      {
        nummer: 'B4.',
        titel: '§ 25a: Einzeldifferenz je Gegenstand',
        einleitung:
          'UStAE Abschnitt 25a.1 Abs. 11: die Bemessungsgrundlage ist für jeden ' +
          'Gegenstand einzeln zu ermitteln; ein Verlust wird nicht verrechnet, auch ' +
          'nicht auf demselben Beleg, und nicht vorgetragen. Die Kasse rechnet seit dem ' +
          '12.08.2026 so; ein Test hält das fest.',
        zeilen: [],
        absaetze: [],
        gegenzeichnung: true,
      },
      {
        nummer: 'B5.',
        titel: 'Konten für Bestandsbewegungen',
        einleitung:
          'Amtlich geprüft gegen die offiziellen Kontenrahmen 2025 (SKR03 Art.-Nr. ' +
          '11174, SKR04 Art.-Nr. 11175); keines der vier Paare trägt eine ' +
          'Automatikfunktion. Führt die Kanzlei eigene Konten, stechen diese den Standard.',
        zeilen: [
          {
            etikett: 'Mehrzweck-Gutschein (Verbindlichkeit bei Ausgabe)',
            erklaerung: 'Standard SKR03 1796 / SKR04 3786, "Ausgegebene Geschenkgutscheine"',
            wert: bestaetigtesKonto(einstellungen, 'gutschein_mehrzweck'),
          },
          {
            etikett: 'Bankeinzahlung aus der Kasse (Geldtransit)',
            erklaerung: 'Standard SKR03 1360 / SKR04 1460, "Geldtransit"',
            wert: bestaetigtesKonto(einstellungen, 'geldtransit'),
          },
        ],
        absaetze: [
          'Warnung aus der Recherche: das zunächst angedachte SKR04-Konto 3270 ist im ' +
            'offiziellen Kontenrahmen ein Automatikkonto ("Erhaltene, versteuerte ' +
            'Anzahlungen 16 % USt") und hätte bei jeder Gutscheinbuchung selbsttätig ' +
            '16 Prozent Umsatzsteuer herausgerechnet. Es wird nicht verwendet.',
          'Für Bareinlage und Barentnahme des Inhabers kennt die Kasse heute keine ' +
            'eigene Bewegungsart und bucht daher noch nicht darauf; amtlich bestätigt ' +
            'sind dafür die Paare SKR03 1890 / SKR04 2180 ("Privateinlagen") und ' +
            'SKR03 1800 / SKR04 2100 ("Privatentnahmen allgemein"). Sie kommen zum ' +
            'Einsatz, sobald die Kasse diese Bewegungsart führt.',
        ],
        gegenzeichnung: true,
      },
      {
        nummer: 'B6.',
        titel: 'Vollstorno als eigener Beleg',
        einleitung:
          'Ein Vollstorno wird als eigener Beleg mit umgekehrten Vorzeichen geführt, ' +
          'jede Zeile bleibt nachvollziehbar; das Storno-Kennzeichen im Bonkopf der ' +
          'Norm wird nicht gesetzt. Falls Ihre Kanzlei bei einer Prüfung die andere ' +
          'Lesart vertreten möchte, bitte melden.',
        zeilen: [],
        absaetze: [],
        gegenzeichnung: true,
      },
    ],
    schluss: [
      'Rückfragen gern direkt an den Inhaber. Die Antworten mit eigenem Feld werden ' +
        'einmal eingetragen; danach laufen die Ausfuhren ohne weitere Nachfrage.',
    ],
  };
}

/**
 * ── DAS ÜBERGABESCHREIBEN ZU DEN EXPORTEN (18.08.2026) ─────────────────────
 *
 * Basels Auftrag: die Exporte gehen „mit einer Nachricht an das Büro des
 * Steuerberaters" hinaus, nicht als nackte Dateien. REIN wie der Rest dieser
 * Datei: Text hinein, Text heraus, kein Netz, keine Fläche.
 *
 * Der Ton ist Kanzleideutsch ohne Fachprahlerei: was die Dateien sind, woraus
 * sie stammen, was die Kanzlei damit tut, und wo die Rückfragen hingehören.
 */
export function baueUebergabeschreiben(daten: {
  firma: string;
  von: string;
  bis: string;
  /** Anzahl der Tagesabschlüsse im Zeitraum, aus der Liste der Fläche. */
  tage: number;
  /** Der gewählte Kontenrahmen (SKR03/SKR04), oder null wenn Vorgabe. */
  kontenrahmen: string | null;
}): string {
  const rahmen = daten.kontenrahmen ?? 'SKR03';
  return [
    'Sehr geehrte Damen und Herren,',
    '',
    `anbei erhalten Sie die Kassenexporte unseres Hauses (${daten.firma}) für den`,
    `Zeitraum ${daten.von} bis ${daten.bis}, insgesamt ${daten.tage} Tagesabschl${daten.tage === 1 ? 'uss' : 'üsse'}.`,
    '',
    'Zu den Dateien:',
    '',
    `1. DATEV-Buchungsstapel (EXTF, Kontenrahmen ${rahmen}). Eine CSV je`,
    '   Tagesabschluss, Windows-1252, zum Import in Kanzlei-Rechnungswesen.',
    '   Die Belegfelder tragen die Belegnummern der Kasse; Stornierungen',
    '   erscheinen als eigene Zeilen mit umgekehrtem Vorzeichen.',
    '2. Kassenbericht (CSV, UTF-8). Der tägliche Zählbericht nach',
    '   KassenSichV mit gezähltem Bestand und Differenzen.',
    '3. Auf Verlangen: DSFinV-K-Tagespakete und das Prüferpaket zur',
    '   Kassennachschau (§ 146b AO), beide direkt aus der Kasse.',
    '',
    'Alle Beträge stammen unverändert aus den fiskalischen Aufzeichnungen der',
    'Kasse (Norns POS); jede Buchung ist über die technische',
    'Sicherheitseinrichtung signiert. Sollte eine Buchung Rückfragen aufwerfen,',
    'nennen Sie uns bitte Belegdatum und Belegnummer, wir liefern den Vorgang',
    'mit allen Einzelpositionen nach.',
    '',
    'Mit freundlichen Grüssen',
    daten.firma,
  ].join('\n');
}
