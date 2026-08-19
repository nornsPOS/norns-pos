# Fragen an den Steuerberater, damit die Kasse vollständig abgabefähig wird

Stand 12.08.2026, zweite Fassung. Nach einer Recherche in den amtlichen
Quellen (DSFinV-K 2.4 samt Anlage 2 vom BZSt, per Prüfsumme verifiziert;
UStAE Abschnitt 25a.1; BMF-Schreiben vom 08.07.2025; offizielle
DATEV-Kontenrahmen SKR03/SKR04 für 2025) sind mehrere Fragen der ersten
Fassung bereits amtlich beantwortet. Sie stehen unten als GESETZTE STANDARDS
mit Fundstelle, bitte nur gegenzeichnen oder begründet widersprechen.
Offen bleibt nur, was wirklich Ihre Kanzlei betrifft.

Alle Antworten trägt der Inhaber selbst ein, unter Einstellungen, Steuer und
Buchhaltung. Kein Wert erfordert einen Techniker.

---

## A. Was wir von Ihnen BRAUCHEN (ohne diese Werte keine DATEV-Datei)

### A1. Die sechs Kopfangaben des DATEV-Buchungsstapels

| Angabe | Format | Bitte eintragen |
|---|---|---|
| Beraternummer der Kanzlei | 4 bis 7 Ziffern | |
| Mandantennummer dieses Ladens | 1 bis 5 Ziffern | |
| Beginn des Wirtschaftsjahres | JJJJ-MM-TT, Regelfall der 1. Januar | |
| Länge der Sachkonten | 4 bis 8 Stellen | |
| Festschreibung der Stapel | ja oder nein | |
| Kontenrahmen | SKR03 oder SKR04 | |

Hinweis zur Festschreibung: ein festgeschriebener Stapel lässt sich in der
Kanzlei nicht mehr ändern und nicht mehr anhängen.

### A2. Erlös- und Wareneingangskonten samt Automatik-Frage

Welche Konten wünscht die Kanzlei für die Erlöse (je Steuerart, insbesondere
§ 25a) und den Wareneingang aus Ankäufen? Bitte je Konto vermerken, ob es
ein Automatikkonto ist (Kennzeichen AM oder AV im Kontenrahmen). Bei
Automatikkonten darf der Stapel keinen BU-Schlüssel mitgeben, sonst weist
DATEV die Zeile ab.

Für die von uns vorgeschlagenen Bestandskonten unten (Geldtransit, Einlage,
Entnahme, Gutschein) ist diese Frage bereits amtlich geprüft: keines trägt
eine Automatikfunktion.

Antwort: ______________________

### A3. Zwei Zahlarten ohne Konto

| Zahlart | Konto SKR03 | Konto SKR04 |
|---|---|---|
| Kundenkonto (Anzahlung oder Guthaben) | | |
| Inzahlungnahme (Ware statt Geld) | | |

### A4. Wahlrecht Gesamtdifferenz für Kleinteile

Die Kasse rechnet nach der Einzeldifferenz, siehe B4. Für Gegenstände bis
750 EUR Einkaufspreis erlaubt § 25a Abs. 4 UStG wahlweise die
Gesamtdifferenz (Wechsel nur zu Beginn eines Kalenderjahres, UStAE 25a.1
Abs. 14). Soll dieses Wahlrecht ausgeübt werden? Heutiger Stand: nein,
Einzeldifferenz für alles.

Antwort: ______________________

### A5. Einordnung des Sortiments

Welche Warengruppen sind Edelmetall im Sinne der Zolltarifpositionen 71 06,
71 08, 71 10, 71 12 (dann KEINE Differenzbesteuerung möglich, § 25a Abs. 1
Nr. 3 UStG), welche sind verarbeitete Ware wie Schmuck (differenzfähig),
welche steuerbefreites Anlagegold nach § 25c UStG? Die Kasse führt je
Artikel eine Steuerart; die Zuordnung je Warengruppe ist Ihre Würdigung.

Antwort: ______________________

---

## B. GESETZTE STANDARDS, bitte gegenzeichnen

### B1. Umsatzsteuerschlüssel 1001 für § 25a und 1002 für § 13b

Amtliche Lage (DSFinV-K 2.4, Tz. 3.2.6, Seite 27, sowie Anlage 2 vom
05.12.2024): Es gibt KEINE amtlich vergebene Schlüsselnummer für § 25a oder
§ 13b. Der Bereich ab 1000 ist wörtlich für genau diese Fälle freigegeben:
"Ab der ID = 1000 können besondere umsatzsteuerliche Sachverhalte (z. B.
Differenzbesteuerung § 25a UStG, Sachverhalte des § 13b UStG) kenntlich
gemacht werden. Diese Sachverhalte müssen durch die Kassenhersteller bzw.
Kassenhändler individuell angelegt werden." Der Standardschlüssel 7 ist
NICHT die Differenzbesteuerung (er heisst "UmsatzsteuerNichtErmittelbar").

Unser Standard: **1001 = § 25a**, Beschriftung "Differenzbesteuerung
§ 25a UStG, Basis ist die Marge". **1002 = § 13b**, Beschriftung
"Steuerschuldnerschaft des Leistungsempfängers". Das amtliche Feld
UST-BESCHR fasst höchstens 55 Zeichen (index.xml der Norm), deshalb die
knappe Fassung; der volle Satz gehört auf den Beleg, nicht in dieses Feld.
Beide Nummern werden in der Verfahrensdokumentation der Kasse
festgehalten, wie es Seite 26 der DSFinV-K verlangt.

Gegenzeichnung: ______________________

### B2. Belegtext bei § 13b

Auf dem Beleg steht bei § 13b der Hinweis "Steuerschuldnerschaft des
Leistungsempfängers" (Wortlaut aus § 14a Abs. 5 UStG). Bei § 25a weist der
Beleg KEINE Umsatzsteuer offen aus (§ 14a Abs. 6 Satz 2 UStG) und trägt die
Pflichtangabe "Gebrauchtgegenstände/Sonderregelung" (§ 14a Abs. 6 Satz 1);
ergänzend nennt er "Differenzbesteuerung nach § 25a UStG". Bitte prüfen,
ob Ihre Kanzlei zusätzliche Formulierungen wünscht.

Gegenzeichnung: ______________________

### B3. Geschäftsvorfalltyp des Ankaufs: Auszahlung

Amtliche Lage: Anhang C der DSFinV-K 2.4 zählt abschliessend 25 Typen auf,
"Andere als die hier aufgeführten Typen dürfen nicht verwendet werden"
(Seite 34). Einen Typ "Ausgabe" oder "Ankauf" gibt es nicht. Der amtliche
Auffangtyp für Geldabflüsse, die kein Umsatz sind, heisst **Auszahlung**
(Seite 59); das amtliche Rechenbeispiel in Anhang I ordnet sogar einen
Warenkauf gegen Bargeld ("Barausgabe: Büromaterial") genau diesem Typ zu.

Unser Standard: jeder Ankauf von Privat läuft als `GV_TYP` Auszahlung mit
der Untergliederung Ankauf im Namensfeld; der Ankaufbeleg mit den
Verkäuferdaten bleibt die Einzelaufzeichnung dazu.

Gegenzeichnung: ______________________

### B4. § 25a: Einzeldifferenz je Gegenstand

Amtliche Lage: UStAE Abschnitt 25a.1 Abs. 11: "Die Bemessungsgrundlage ist
... für jeden Gegenstand einzeln zu ermitteln (Einzeldifferenz)." Ein
Verlustposten darf nicht mit dem Gewinn eines anderen verrechnet werden,
auch nicht auf demselben Beleg; bei negativem Unterschiedsbetrag beträgt
die Bemessungsgrundlage 0 Euro, ohne Vortrag. Die Gesamtdifferenz wäre nur
bis 750 EUR Einkaufspreis wählbar (seit BMF-Schreiben vom 08.07.2025,
vorher 500 EUR), unsere Stücke liegen regelmässig darüber.

Unser Standard: die Kasse rechnet seit dem 12.08.2026 die Marge je
Gegenstand, Verluste bleiben unberücksichtigt. Ein Test hält das fest und
schlägt an, falls es je wieder anders gerechnet würde.

Gegenzeichnung: ______________________

### B5. Konten für Bestandsbewegungen

Amtlich geprüft gegen die offiziellen Kontenrahmen 2025 (SKR03 Art.-Nr.
11174, SKR04 Art.-Nr. 11175): alle vier Paare existieren wörtlich und
tragen KEINE Automatikfunktion.

| Bewegung | SKR03 | SKR04 | Fundstelle |
|---|---|---|---|
| Mehrzweck-Gutschein (Verbindlichkeit bei Ausgabe) | 1796 | 3786 | "Ausgegebene Geschenkgutscheine"; DATEV-Buchungsbeispiel Dok. 5305720 |
| Bankeinzahlung aus der Kasse (Geldtransit) | 1360 | 1460 | "Geldtransit", Kennzeichen F |

Für Bareinlage und Barentnahme des Inhabers kennt die Kasse heute keine
eigene Bewegungsart und bucht daher noch nicht darauf. Amtlich bestätigt
sind dafür die Paare 1890/2180 ("Privateinlagen") und 1800/2100
("Privatentnahmen allgemein"); sie kommen zum Einsatz, sobald die Kasse
diese Bewegungsart führt.

Warnung aus der Recherche: das zunächst angedachte SKR04-Konto 3270 ist im
offiziellen Kontenrahmen ein AUTOMATIKKONTO ("Erhaltene, versteuerte
Anzahlungen 16 % USt") und hätte bei jeder Gutscheinbuchung selbsttätig
16 Prozent Umsatzsteuer herausgerechnet. Es wird NICHT verwendet.

Falls Ihre Kanzlei individuelle Konten führt, stechen diese den Standard,
bitte dann die Kanzleikonten eintragen.

Gegenzeichnung oder Kanzleikonten: ______________________

### B6. Vollstorno als eigener Beleg

Unser Standard: ein Vollstorno wird als eigener Beleg mit umgekehrten
Vorzeichen geführt, jede Zeile bleibt nachvollziehbar; das
Storno-Kennzeichen im Bonkopf der Norm (Feld `BON_STORNO`) wird nicht
gesetzt. Falls Ihre Kanzlei bei einer Prüfung die andere Lesart vertreten
möchte, bitte melden.

Gegenzeichnung: ______________________

---

Rückfragen gern direkt an den Inhaber. Jede Antwort wird einmal eingetragen;
danach laufen alle Ausfuhren ohne weitere Nachfrage.
