# Was Steuerberater mit Kassen-Exporten wirklich erleben

**Rechercheart:** Web plus Primärquellen (DATEV-Serviceinformation als PDF geladen und volltext-extrahiert, Merkblatt der Finanzverwaltung Niedersachsen ebenso). Wo ich nur Sekundärquellen habe, steht es dabei. Am Ende der Abgleich gegen den echten Quelltext unter `/Users/basel/Desktop/warehouse14`.

---

## 1. Die häufigsten Fehler beim Import eines Buchungsstapels

### 1.1 Die Primärquelle, gegen die alles zu prüfen ist

DATEV-Serviceinformation **Dok.-Nr. 1003221, „ASCII-Import: Feldbeschreibungen für Standardformate", letzte Aktualisierung 20.11.2020**, abgerufen 26.07.2026 unter https://handbuch.faktura-xp.de/download/ASCII-Dateibeschreibung_2020.pdf (61 Seiten, von mir vollständig extrahiert). Die allgemeinen Einstellungen für die Datenkategorie Buchungsstapel lauten dort wörtlich:

| Einstellung | Wert laut DATEV |
|---|---|
| Zeichensatz | **ANSI** |
| Trennzeichen Felder | Semikolon |
| Trennzeichen Tausenderstellen | **kein Zeichen** |
| Trennzeichen Nachkommastellen | Komma |
| Datumsformat | **TTMM** |
| Überschriftzeile | Ja |
| Zeichen um Textfelder | Anführungszeichen, **verdoppeln: Ja** |
| Trennzeichen am Datensatzende | **Nein** |

Und die Muss-Felder der Buchungszeile (Feld-Nr., Typ, Länge, NKS, Max-Länge):

| Nr. | Feld | Typ | Länge | Max | Muss |
|---|---|---|---|---|---|
| 1 | Umsatz (ohne Soll/Haben-Kz) | Betrag | 10 | 13 (2 NKS) | **Ja**, „Muss immer ein positiver Wert sein" |
| 2 | Soll-/Haben-Kennzeichen | Text | 1 | 1 | **Ja** |
| 7 | Konto | Konto | 9 | 9 | **Ja** |
| 8 | Gegenkonto (ohne BU-Schlüssel) | Konto | 9 | 9 | **Ja** |
| 9 | BU-Schlüssel | Text | 4 | 4 | nein |
| 10 | Belegdatum | Datum | 4 | 4 | **Ja** (TTMM) |
| 11 | Belegfeld 1 | Text | 36 | 36 | nein |
| 12 | Belegfeld 2 | Text | 12 | 12 | nein |
| 14 | Buchungstext | Text | 60 | 60 | nein |
| 37/38 | KOST1 / KOST2 | Text | 36 | 36 | nein |
| 114 | Festschreibung | Zahl | 1 | 1 | nein |

### 1.2 Die Fehler, die Berater am häufigsten sehen

**a) Unzulässige Zeichen in Belegfeld 1.** Wörtlich aus Dok. 1003221, Feld 11: *„Folgende Zeichen sind zulässig: Ziffern, Groß- und Kleinbuchstaben sowie folgende Sonderzeichen: $ & % * + - / Andere Zeichen sind unzulässig (insbesondere Leerzeichen, Umlaute, Punkt, Komma, Semikolon und Doppelpunkt)."* Das ist die meistgetretene Mine, weil fast jedes Fremdsystem dort eine Belegnummer mit Bindestrich, Punkt, Leerzeichen oder Schrägstrich-Datum hineinschreibt. Belegt auch aus Entwicklersicht: GitHub `ledermann/datev` Issue #14, https://github.com/ledermann/datev/issues/14 (abgerufen 26.07.2026), dort dieselbe Zeichenmenge und die Diskussion, ob die Bibliothek werfen oder bereinigen soll.

**b) Zeichensatz.** DATEV erwartet ANSI, in der Praxis Windows-1252. Eine UTF-8-Datei erzeugt beim Import Buchstabensalat in Buchungstext und Kontenbeschriftungen. Sekundär belegt bei ODION Support, https://support.odion.com/hc/de/articles/4403452346386 (Titel: „Warum werden beim DATEV-Export seltsame Zeichen importiert?", Seite selbst antwortete mit HTTP 403, Aussage nur aus dem Suchindex, deshalb **teilbestätigt**) und in der DATEV-Community, https://www.datev-community.de/t5/Betriebliches-Rechnungswesen/UTF-8-Format-bei-Stapelverarbeitung/td-p/45095. Näher an der amtlichen Stelle ist Dok. 1003221 selbst, das ohne Wenn und Aber „ANSI" sagt.

**c) Festschreibung, ungewollt.** Dok. 1003221, Feld 114: *„leer = nicht definiert; wird ab Jahreswechselversion 2016/2017 automatisch festgeschrieben. 0 = keine Festschreibung, 1 = Festschreibung. Hat ein Buchungssatz in diesem Feld den Inhalt 1, so wird der gesamte Stapel nach dem Import festgeschrieben. Ab Jahreswechselversion 2016/2017 gilt das auch bei Inhalt = leer."* Das heißt: **wer das Feld leer lässt, schreibt den ganzen Stapel fest.** Genau das nennt die Kanzlei-Seite Accountico als Problem Nummer 1 von dreien, https://accountico.de/die-3-haeufigsten-probleme-beim-import-in-datev-rechnungswesen/, veröffentlicht 06.06.2025: unbeabsichtigte Festschreibung, Abhilfe „in Spalte U eine 0 eintragen". Spalte U ist Feld 21 der Kopfzeile, das Feld 114 sitzt in der Buchungszeile. Es gibt also **zwei** Festschreibungs-Schalter, und beide stehen standardmäßig auf „festschreiben".

**d) Ordnungsbegriff passt nicht: Beraternummer und Mandantennummer.** Spesenfuchs Support, https://support.spesenfuchs.de/de/support/solutions/articles/11000128763-datev-datenservices-häufige-fehlerquellen (abgerufen 26.07.2026), nennt das als Fehlerquelle Nummer 1: *„Beraternummer und Mandantennummer … müssen mit der Beraternummer und Mandantennummer in DATEV Unternehmen Online (DUO) übereinstimmen"*, typisch ist die Verwechslung von Hauptberaternummer und Unterberaternummer. Ergänzend DATEV-Community 298529 zum Recht am Ordnungsbegriff.

**e) Wirtschaftsjahr passt nicht, und das Jahr fehlt im Belegdatum.** Dok. 1003221, Feld 10, wörtlich: *„Achtung: Auch bei individueller Feldformatierung mit vierstelliger Jahreszahl wird immer in das aktuelle Wirtschaftsjahr importiert, wenn Tag und Monat des Datums im bebuchbaren Zeitraum liegen, da die Jahreszahl nicht berücksichtigt wird."* Für Basels Anforderung „Export für JEDEN Zeitraum" ist das die zentrale Falle: ein Zeitraum, der über einen Wirtschaftsjahreswechsel läuft, landet in einem einzigen Jahr. Ein Stapel darf faktisch nie eine Jahresgrenze überschreiten.

**f) Konto nicht vorhanden.** Das Sachkonto muss im Mandantenbestand existieren, sonst bricht es. Lexware für Steuerkanzleien listet exemplarisch die Meldungen „Datenkategorie wird nicht unterstützt" und „Es trat ein allgemeiner Fehler beim Lesen des Datensatzes auf" (letzteres wegen inkompatibler Versionsnummer in Zelle E1), https://steuerberater.help.lexware.de/de/articles/603499 (abgerufen 26.07.2026).

**g) Sachkontenlänge.** DATEV liest aus dem Kopf, ob es die Konten der Buchungszeilen verlängern muss. Zulässig sind laut Sekundärquellen 4 bis 8 Stellen. Die Personenkontenlänge darf laut Dok. 1003221, Felder 7 und 8, *„nur 1 Stelle länger sein als die definierte Sachkontennummernlänge"*.

**h) Steuerschlüssel auf einem Automatikkonto.** Siehe Abschnitt 3.4, das ist der stillste und teuerste Fehler.

**i) Meldungskennungen.** Berater sehen Kennungen wie `REW92178` im Import-Protokoll der Stapelverarbeitung (DATEV Hilfe-Center Dok. 1003888) und `REW00310` bei BU-Schlüssel 40 (Dok. 1046108). Beide Seiten liegen inzwischen auf `wissensplattform.apps.datev.de` und rendern erst per JavaScript, ich konnte den **Meldungstext nicht im Wortlaut lesen**. Die Dokumentnummern sind bestätigt, der Inhalt ist **unbestätigt**.

---

## 2. Was in typischen Kassen-Exporten fehlt und Handarbeit kostet

Die Reihenfolge folgt dem, was in Beraterquellen am häufigsten genannt wird.

1. **Zahlungsart nicht getrennt.** Bar und unbar landen zusammen auf der Kasse. Das ist nicht nur unbequem, es ist ein formeller Mangel, siehe Abschnitt 6.
2. **Kein sinnvoller Buchungstext.** In einer Google-Groups-Diskussion zum DATEV-Import wird genau das beklagt: im Export werde bei Einnahmen und Ausgaben der Buchungstext nicht ausgegeben, was die Zuordnung zu den Belegen erschwert (https://groups.google.com/d/topic/lexnews.software.buchhalter/jwobvTX7pOg, **nur über den Suchindex bestätigt**). 60 Zeichen sind erlaubt, sie kosten nichts und ersparen dem Berater das Rückfragen.
3. **Belegfeld 1 leer oder unbrauchbar.** Es ist laut DATEV der „Schlüssel für die Verwaltung von Offenen Posten". Für eine Kasse ist es der Anker zum Bon beziehungsweise zum Z-Bon.
4. **Kein Gegenkonto.** „Import-Format-Fehler: Gegenkonto fehlt" ist eine der genannten Standardmeldungen. Feld 8 ist Muss-Feld.
5. **Keine Aufteilung nach Steuersatz.** Der Kassensystem-Ratgeber von Mihok (Anbieterseite, also Sekundärquelle, https://www.mihok-kassensysteme.de/ratgeber/datev-schnittstelle-kassensystem, abgerufen 26.07.2026) listet als das, was Kanzleien brauchen: Umsätze getrennt nach 19 Prozent, 7 Prozent und steuerfrei, Zahlarten getrennt (bar, Karte, Gutschein), Trinkgeld separat, Stornos und Rabatte gekennzeichnet, korrekte Kontenzuordnung je Kontenrahmen. Als die sechs Fehler, die Mehrarbeit erzeugen, nennt dieselbe Seite: falscher Kontenrahmen, falsche Steuersätze, fehlende oder doppelte Exportzeiträume, unsaubere Belegnummern, undifferenziertes Trinkgeld, EC-Umsätze nicht isoliert.
6. **Kostenstellen.** KOST1 und KOST2 sind je 36 Zeichen (Dok. 1003221, Felder 37 und 38), KOST-Menge ist Feld 39, KOST-Datum Feld 104. Sie sind nur dann sinnvoll zu füllen, wenn die Kanzlei DATEV Kostenrechnung einsetzt. DATEV rät ausdrücklich, den Steuerberater zu fragen, ob das Modul verwendet wird. **Für eine Kasse mit einer Filiale ist KOST1 optional, nicht Pflicht.** Sobald eine zweite Kasse oder Filiale kommt, ist es die eleganteste Lösung, weil der Berater ohne neue Konten je Kasse auswerten kann.
7. **Beleglink.** Feld 20, 210 Zeichen, Aufbau: vierstelliges Kürzel für das Dokumentenmanagement, Leerzeichen, Anführungszeichen, GUID oder Dateiname (max. 36 Zeichen), Schlusszeichen. Kürzel: `BEDI` für Belegverwaltung online, `DDMS` für DATEV DMS und Dokumentenablage. Damit hängt am Buchungssatz das Belegbild. Das ist der Punkt, an dem ein Berater lächelt, weil er nichts mehr suchen muss.

---

## 3. Die Konten, die ein Berater für einen Bargeld-Einzelhandel erwartet

### 3.1 Das Grundgerüst, SKR03 und SKR04 nebeneinander

Quellen: ECOVIS RTS Kontenrahmen SKR03 Klasse 1 und Klasse 8, https://www.ecovis-rts.de/servicecenter/kontenrahmen/skr-03-klasse-1.html und `.../skr-03-klasse-8.html` (abgerufen 26.07.2026). Für SKR04 der Kontenplan des Klausurenverbunds der Steuerberaterkammern, https://www.sbk-sachsen.de/files/2025/08/Kontenplan-SKR04_ab-AP-Wi-2025-Hochformat.pdf (Stand ab Prüfung Winter 2025, von mir volltext-extrahiert). Haufe für die Differenzbesteuerung, https://www.haufe.de/id/beitrag/differenzbesteuerung-bewegliche-gegenstaende-HI8029852.html (abgerufen 26.07.2026).

| Sachverhalt | SKR03 | SKR04 | Bemerkung |
|---|---|---|---|
| Kasse | **1000** | **1600** | Nebenkasse SKR03 1010 |
| Bank | **1200** | **1800** | |
| Geldtransit | **1360** | **1460** | |
| Kartenzahlung, eigenes Transitkonto | 1361 (frei zu beschriften) | 1461 | Praxisempfehlung, siehe 6.3 |
| Erlöse 19 Prozent | **8400** | **4400** | Automatikkonto |
| Erlöse 7 Prozent | **8300** | **4300** | Automatikkonto |
| Erlöse Differenzbesteuerung, Anteil ohne USt | **8193** | **4138** | „Umsatzerlöse nach §§ 25 und 25a UStG ohne USt" |
| Erlöse Differenzbesteuerung, Marge mit 19 Prozent | **8191** | **4136** | „Umsatzerlöse nach §§ 25 und 25a UStG 19 % USt" |
| Steuerfreie Umsätze § 4 Nr. 8 ff. | 8100 bis 8104 | 4100 | |
| Umsatzsteuer 19 Prozent | **1776** | **3806** | SKR04 Sammelkonto 3800 |
| Umsatzsteuer 7 Prozent | **1771** | 3801 (**unbestätigt**) | SKR03 belegt über ECOVIS |
| Privatentnahmen allgemein | **1800** | **2100** | |
| Privateinlagen | **1890** | **2180** | |
| Wareneingang | 3200 | **5200** | |
| Kassenfehlbetrag (sonstige Aufwendungen unregelmäßig) | **2309** | **6969** | |
| Kassenüberschuss (sonstige Erträge unregelmäßig) | **2709** | **4839** | |
| Nebenkosten des Geldverkehrs (Kartengebühr) | 4970 (**unbestätigt**) | **6855** | SKR04 belegt, SKR03 nicht |
| Durchlaufende Posten | 1590 | 1370 (**unbestätigt**) | |

Kassendifferenzen sind belegt über Haufe, „Kassenführung: Diese Besonderheiten sind zu beachten / 5.2.3 Kassenfehlbeträge und -mehrbeträge", https://www.haufe.de/id/beitrag/kassenfuehrung-diese-besonderheiten-sind-zu-beachten-523-kassenfehlbetraege-und-mehrbetraege-so-gehen-sie-richtig-vor-HI10942480.html (abgerufen 26.07.2026): Fehlbetrag „Sonstige Aufwendungen unregelmäßig an Kasse", SKR03 2309, SKR04 6969. Mehrbetrag „Kasse an Sonstige Erträge unregelmäßig", SKR03 2709, SKR04 4839. Zur umsatzsteuerlichen Behandlung sagt Haufe an dieser Stelle **nichts**, das ist offen und mit dem Berater zu klären.

### 3.2 Widersprüchliche Quellen zur Differenzbesteuerung, ausdrücklich benannt

Für ein Geschäft mit gebrauchtem Gold ist das der wichtigste Block, und hier widersprechen sich die Quellen offen:

- **onlinebilanz.de** (Blog, https://onlinebilanz.de/differenzbesteuerung-buchen-skr03-skr04-datev/) nennt Wareneinkauf 3420 / 5420 und Erlöse 8420 / 4420 mit Steuerschlüssel 76 beziehungsweise 75.
- Eine weitere Blog-Quelle nennt **8337 / 4337**.
- **Haufe Finance Office** und die **ECOVIS-Kontenliste** nennen übereinstimmend **8191 und 8193** in SKR03 sowie **4136 und 4138** in SKR04.

**Näher an der amtlichen Stelle sind Haufe und ECOVIS**, denn ECOVIS gibt den Kontenrahmen selbst wieder und dessen offizielle Kontenbezeichnungen lauten „Umsatzerlöse nach §§ 25 und 25a UStG 19 % USt" (8191) und „… ohne USt" (8193). Der Konto-8337-Vorschlag ist **nachweislich falsch**: 8337 heißt laut ECOVIS „Erlöse aus Leistungen, für die der Leistungsempfänger die Umsatzsteuer nach § 13b UStG schuldet", also Reverse Charge, nicht § 25a. Der SKR04-Kontenplan der Steuerberaterkammer bestätigt dasselbe für 4337.

Buchungsprinzip laut Haufe: beim Verkauf wird der **Einkaufspreis** auf das Konto ohne USt gebucht und die **Differenz** zum Verkaufspreis auf das Konto mit 19 Prozent. Also zwei Zeilen je differenzbesteuertem Verkauf, nicht eine.

Die Aufzeichnungspflicht steht in **§ 25a Abs. 6 UStG**: Einkaufspreis, Verkaufspreis und Bemessungsgrundlage sind je Gegenstand aufzuzeichnen. Das ist der Grund, warum eine Gold-Kasse ohnehin je Stück und nicht je Tag aufzeichnen muss.

### 3.3 Anlagegold nach § 25c UStG: hier gibt es keine saubere Standardantwort

§ 25c UStG regelt die Steuerbefreiung für Anlagegold (Gesetzestext: https://dejure.org/gesetze/UStG/25c.html). In der DATEV-Community existiert ein eigener Thread genau zu dieser Frage („SKR 03 - Erlöse 0% USt frei Anlagegold § 25c UStG mit Vorsteuerabzug", https://www.datev-community.de/t5/Betriebliches-Rechnungswesen/…/td-p/185763, Seite antwortete mit HTTP 403, **Inhalt unbestätigt**), was für sich schon zeigt, dass es kein selbstverständliches Standardkonto gibt. Aus dem Suchindex ergibt sich der Hinweis, dass § 25c in der Umsatzsteuer-Voranmeldung **nicht** in Kennzahl 48 gehört. **Konsequenz für den Bau: das Erlöskonto für Anlagegold ist vom Steuerberater zu benennen und muss konfigurierbar sein, es darf nicht hart im Code stehen.**

### 3.4 Automatikkonten: der stillste Fehler

8400 / 4400 und 8300 / 4300 sind **Automatikkonten**. Die Umsatzsteuer wird aus dem Bruttobetrag gerechnet und automatisch auf das Steuersammelkonto (1776 / 3806) gebucht.

Zur Frage, ob man zusätzlich einen BU-Schlüssel mitgeben darf, widersprechen sich die Quellen:

- **weclapp Support**, https://doc.weclapp.com/knowledgebase/was-bedeutet-die-einstellung-automatikkonto-wofuer-sind-bu-schluessel-zu-hinterlegen/ (abgerufen 26.07.2026), wörtlich: *„Bei Automatikkonten wird im Datev Export kein BU-Schlüssel übergeben."* BU-Schlüssel sind dort die **Alternative** zu Automatikkonten, nicht die Ergänzung.
- **epago**, https://epago.de/lexikon/steuern/datev-buchungsschluessel-guide/, hält die Kombination 8400 plus Schlüssel 3 für den Normalfall.

Belegt und unstrittig ist nur der Sonderschlüssel **40 = Aufhebung der Steuerautomatik**, siehe DATEV Hilfe-Center Dok. 1046108 zu `REW00310`. Die Standardschlüssel werden übereinstimmend so genannt: **1 steuerfrei, 2 Umsatzsteuer 7 Prozent, 3 Umsatzsteuer 19 Prozent, 8 Vorsteuer 7 Prozent, 9 Vorsteuer 19 Prozent**. Eine Quelle nennt 3 mit 16 Prozent, das ist der historische Stand vor 2007 beziehungsweise das Sonderjahr 2020, **hier ist Vorsicht geboten**.

**Sichere Bauregel:** auf einem Automatikkonto Feld 9 leer lassen. Dann kann sich das Verhalten nicht zwischen DATEV-Programmversionen unterscheiden, und ein falscher Schlüssel kann nicht stillschweigend eine falsche Steuer erzeugen.

---

## 4. SKR03 gegen SKR04, und muss die Kasse beides können

**Die Wahl liegt beim Berater, nicht beim Mandanten.** SKR03 ist nach Geschäftsprozessen geordnet, SKR04 nach der Gliederung des Jahresabschlusses (Bilanz und GuV). SKR03 ist traditionell bei kleineren Betrieben, Einzelunternehmen und Einnahmenüberschussrechnern verbreitet, SKR04 häufiger im gehobenen Mittelstand mit regelmäßigen Bilanz- und GuV-Auswertungen. Quellen: DATEV Ratgeber Kontenplan, https://www.datev.de/web/de/berufsgruppenuebergreifend/ratgeber/rechnungswesen/kontenplan-buchhaltung-mit-skr03-und-skr04, und Haufe „Kontenrahmen / 7.2 DATEV SKR03 und SKR04 sind heute Standard", https://www.haufe.de/id/beitrag/kontenrahmen-72-datev-skr03-und-skr04-sind-heute-standard-HI10084638.html (beide abgerufen 26.07.2026). Verlässliche Marktanteilszahlen habe ich **nicht** gefunden, jede Prozentangabe wäre erfunden.

Ein späterer Wechsel ist aufwändig, weil alle bestehenden Buchungen auf neue Kontonummern zu übertragen sind. Deshalb wird der Kontenrahmen einmal bei der Einrichtung mit dem Berater festgelegt.

**Antwort auf die Frage: ja, die Kasse muss beides anbieten.** Nicht, weil ein Mandant beides braucht, sondern weil beim Beraterwechsel der Kontenrahmen wechseln kann und weil Norns nicht wissen kann, welchen Rahmen der Berater des nächsten Kunden führt. Der richtige Bau ist **eine Kontenzuordnungstabelle als Konfiguration je Mandant**, nicht zwei Codepfade. Der Kontenrahmen gehört zusätzlich in **Feld 27 der EXTF-Kopfzeile (SKR)**, damit der Berater beim Import sieht, wogegen er einliest.

Sechs Wörter, die man dem Berater nie sagen sollte: „wir haben SKR03 fest eingebaut".

---

## 5. Buchungssatz je Tag gegen je Beleg

Hier muss man zwei Ebenen sauber trennen, sonst widersprechen sich die Quellen scheinbar.

### 5.1 Ebene Aufzeichnen: einzeln, ohne Ausnahme

**§ 146 Abs. 1 AO** (https://www.gesetze-im-internet.de/ao_1977/__146.html, abgerufen 26.07.2026): Buchungen und die sonst erforderlichen Aufzeichnungen sind *„einzeln, vollständig, richtig, zeitgerecht und geordnet"* vorzunehmen, Kasseneinnahmen und Kassenausgaben sind täglich festzuhalten. Die Zumutbarkeitsausnahme *„bei Verkauf von Waren an eine Vielzahl von nicht bekannten Personen gegen Barzahlung"* gilt **nicht**, wenn ein elektronisches Aufzeichnungssystem im Sinne des § 146a verwendet wird.

Das **Merkblatt Kassenführung des Finanzamts Niedersachsen** (https://lstn.niedersachsen.de/download/150368/Merkblatt_Kassenfuehrung.pdf, von mir volltext-extrahiert, zitiert die GoBD *„in der Fassung vom 14. Juli 2025"*, das genaue Veröffentlichungsdatum des Merkblatts ist **unbestätigt**) nennt die Mindestangaben je Geschäftsvorfall wörtlich:

> „der/die verkaufte, eindeutig bezeichnete Artikel/Dienstleistung, der endgültige Einzelverkaufspreis, der dazugehörige Umsatzsteuersatz und -betrag, vereinbarte Preisminderungen, **die Zahlungsart**, das Datum und der Zeitpunkt des Umsatzes, die verkaufte Menge bzw. Anzahl sowie grundsätzlich der Name des Vertragspartners."

Und zur summarischen Kassenführung, ebenfalls wörtlich: sie ist *„in der Regel unzulässig"*, wenn Waren **teilweise unbar** verkauft werden, die Kundschaft teilweise bekannt ist (Bestellbuch, Kundenkartei, Rechnungsversand), im Verhältnis zu den Öffnungszeiten keine Vielzahl an Kunden gegeben ist oder nach anderen Gesetzen eine Einzelaufzeichnung erforderlich ist, *„z. B. bei verschiedenen Umsatzsteuersätzen"*.

**Für den Gold-Laden greifen mindestens vier dieser vier Punkte.** Karte wird akzeptiert, der Ankaufkunde ist namentlich bekannt (Ausweispflicht), es gibt mehrere Steuersätze und § 25a Abs. 6 UStG verlangt Einzelaufzeichnung je Gegenstand. Eine summarische Kasse ist hier rechtlich nicht diskutabel.

### 5.2 Ebene Verbuchen: Tagessumme ist zulässig, und Berater bevorzugen sie

Aus den Quellen, hier tatsächlich widersprüchlich formuliert:

- Deubner Steuern schreibt, eine Verdichtung in eine Tagessumme werde bei Prüfungen nicht akzeptiert.
- Dieselbe Recherche fördert die Gegenaussage zutage: die Einzelaufzeichnungspflicht bedeute nicht, dass einzeln **gebucht** werden müsse, ausreichend sei die Verbuchung der zusammengefassten Tageslosung.

**Auflösung:** die erste Aussage betrifft das Aufzeichnen, die zweite das Verbuchen. Beides ist vereinbar. Gestützt wird das durch das Merkblatt Niedersachsen, das die Einzeldaten **im Kassensystem** verlangt, dort *„8 Jahre innerhalb des Systems, auf einem externen Datenträger oder einer Datencloud unveränderbar"*, und im Prüfungsfall den Export nach **DSFinV-K**. Die Finanzbuchhaltung ist nicht der Ort, an dem die Einzelaufzeichnung leben muss.

Nebenbefund zur Aufbewahrungsfrist: das Merkblatt nennt **8 Jahre**, mehrere Blogs nennen 10 Jahre. Näher an der amtlichen Stelle ist das Merkblatt des Finanzamts. Der genaue Anwendungsbereich der 8 Jahre (Buchungsbelege gegen Bücher) ist mit dem Berater zu klären, ich habe ihn nicht abschließend belegt.

**Was Berater bei vielen kleinen Umsätzen bevorzugen:** eine Buchung je Tag, je Steuersatz und je Zahlungsart. Also nicht 300 Zeilen für 300 Bons, sondern typischerweise fünf bis acht Zeilen pro Tag, mit der Z-Nummer beziehungsweise Kassenabschlussnummer in Belegfeld 1. Das ist prüfbar, weil die Einzeldaten per DSFinV-K jederzeit erreichbar sind, und es lässt den Stapel nach einem Monat noch lesbar aussehen.

**Für Norns heißt das: beides bauen, umschaltbar.** Verdichtet je Tag als Standard, je Beleg als Option. Genau dann lächelt der Berater, weil er selbst entscheiden darf.

---

## 6. Geldtransit und die richtige Buchung einer Kartenzahlung

### 6.1 Was die Finanzverwaltung sagt

BMF-Schreiben vom **16.08.2017**: die Erfassung unbarer Geschäftsvorfälle im Kassenbuch verstößt gegen die Grundsätze der Wahrheit und Klarheit einer kaufmännischen Buchführung und ist ein **formeller Mangel**. Die verbreitete Praxis, alle Tageseinnahmen inklusive EC im Kassenbuch zu erfassen und die EC-Beträge anschließend als „Ausgabe" wieder auszutragen, ist damit fehlerhaft. Quelle: bonstore Buchungstipp, https://bonstore.de/blog/buchung-von-ec-kartenumsaetzen-in-der-kassenfuehrung/buchungstipp (abgerufen 26.07.2026).

BMF-Schreiben vom **29.06.2018**, die Entschärfung: der formelle Mangel bleibt ein Mangel, die Buchführung wird aber regelmäßig nicht verworfen, wenn der Zahlungsweg ausreichend dokumentiert ist, die Nachprüfbarkeit des tatsächlichen Kassenbestandes gewährleistet bleibt und die EC-Umsätze gesondert gekennzeichnet oder auf ein separates Konto umgebucht werden. Die **Kassensturzfähigkeit** bleibt dann erhalten. Quelle: Haufe, „BMF: EC-Karten-Umsätze im Kassenbuch", https://www.haufe.de/steuern/finanzverwaltung/bmf-ec-karten-umsaetzen-im-kassenbuch_164_457306.html (abgerufen 26.07.2026). Das Aktenzeichen des Schreibens vom 29.06.2018 nennt der Artikel nicht, es ist **unbestätigt**.

### 6.2 Die Buchung, die der Bankeingang später bestätigt

Kartenzahlung, SKR03, drei Schritte:

```
1. Verkauf     1360 Geldtransit           an  8400 Erlöse 19 % USt
2. Gutschrift  1200 Bank                  an  1360 Geldtransit
3. Gebühr      4970 Nebenkosten Geldverk. an  1200 Bank   (falls netto gutgeschrieben)
```

In SKR04 dasselbe mit 1460, 4400, 1800, 6855.

Die Kasse (1000 / 1600) wird bei einer Kartenzahlung **nicht berührt**. Genau das macht den Kassenbestand kassensturzfähig, und genau das lässt den Bankeingang zwei Tage später glatt gegen 1360 laufen.

### 6.3 Warum ein eigenes Kartenkonto besser ist als 1360

Aus der Praxisdiskussion (Rechnungswesenforum, https://www.rechnungswesenforum.de/forum/buchfuehrung-buchhaltung/allgemein/ec-sammelbuchungen-im-skr04-buchen.1906610/, abgerufen 26.07.2026, **Beraterforum, also Sekundärquelle**): das klassische Geldtransitkonto erfasst Bareinzahlungen auf die Bank und Abhebungen für die Kasse und gleicht sich schnell aus. Ein Kartenkonto trägt je nach Gutschriftfrist tagelang einen Saldo. Deshalb wird empfohlen, **1361 / 1461 als „Geldtransit Karte" zu beschriften** und je Kartenart ein eigenes Konto zu führen, etwa „Geldtransit MasterCard".

Für die Kasse aus Baden-Württemberg heißt das konkret: ein Konto je Akzeptanzweg (Girocard, Kreditkarte, gegebenenfalls Anbieter wie SumUp oder Stripe), sonst muss der Berater die Gutschriften von Hand auseinanderklauben.

### 6.4 Bareinzahlung auf die Bank

```
SKR03:  1360 Geldtransit an 1000 Kasse      dann   1200 Bank an 1360 Geldtransit
SKR04:  1460            an 1600 Kasse       dann   1800      an 1460
```

Das Merkblatt Niedersachsen verlangt ausdrücklich, dass Privatentnahmen, Privateinlagen und *„jeglicher Geldtransit"* durch Eigenbelege zu dokumentieren sind. Also braucht jede Transitbuchung eine Belegnummer im Belegfeld 1.

---

## 7. Die drei größten Reibungspunkte, mit Quelle

**Reibungspunkt 1: Der Stapel schreibt sich selbst fest, und dann ist Schluss mit Korrigieren.**
Quelle: DATEV Dok. 1003221, Feld 114, wörtlich *„Ab Jahreswechselversion 2016/2017 gilt das auch bei Inhalt = leer"*, und Accountico vom 06.06.2025, Problem 1 von 3. Der Berater bekommt einen Testimport, der nicht mehr rückgängig zu machen ist, und muss stornieren statt löschen. Das ist der Punkt, an dem eine Kanzlei ein Kassensystem dauerhaft ablehnt.

**Reibungspunkt 2: Bar und unbar sind vermischt.**
Quelle: BMF vom 16.08.2017 und 29.06.2018, über Haufe und bonstore. Formeller Mangel, Nacharbeit für jeden einzelnen Tag, und im schlechten Fall eine Diskussion über die Kassensturzfähigkeit in der Prüfung. Das Merkblatt Niedersachsen verschärft es: eine summarische Kassenführung ist unzulässig, sobald *„Waren teilweise unbar verkauft werden"*.

**Reibungspunkt 3: Zeichensatz, Belegfeld-Zeichen und Ordnungsbegriff, also die drei stummen Abbrüche.**
Quellen: Dok. 1003221 (ANSI, Zeichenmenge Belegfeld 1), Spesenfuchs (Berater- und Mandantennummer), GitHub `ledermann/datev` Issue #14. Der Berater sieht nur, dass der Import abbricht oder Buchstabensalat erzeugt, und ruft in der Kanzlei niemanden an, sondern beim Mandanten. Die Ursache liegt jedes Mal beim Kassensystem.

Ehrlicher Zusatz: Reibungspunkt 4, den ich nicht in Beraterforen belegen konnte, aber der aus der Spezifikation zwingend folgt, ist das **TTMM-Belegdatum**, das jeden jahresübergreifenden Zeitraum still in ein Jahr zwingt (Dok. 1003221, Feld 10).

---

## Abgleich gegen den echten Quelltext

Damit die Recherche nicht in der Luft hängt, habe ich die Befunde gegen die vorhandene Umsetzung gehalten.

- `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/lib/datev-export.ts`
- `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/routes/closing-export.ts`

Konkrete Beobachtungen:

**Kopfzeile, Zeile 62 in `datev-export.ts`:**
```
EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;;;;;;;;;
```
Ich habe die 31 Felder maschinell durchgezählt. Ergebnis: Feld 14 (Sachkontenlänge) ist **leer**, und der Wert `4` steht in **Feld 15 (Datum von)**. Die Feldbelegung des EXTF-Kopfes stammt aus Sekundärquellen (arkivado, `omniboost/go-datev`), da das DATEV-Entwicklerportal Registrierung verlangt, worauf Dok. 1003221 auf Seite 2 selbst hinweist. **Die Feldnummerierung ist deshalb zu verifizieren, bevor jemand das anfasst.** Sicher ist unabhängig davon: Beraternummer, Mandantennummer, WJ-Beginn, Datum von, Datum bis, Bezeichnung, Festschreibung und SKR sind alle leer.

**Zeile 131 in `closing-export.ts`:** `STANDARD_19: { konto: '8400', bu: '3' }` und `REDUCED_7: { konto: '8300', bu: '2' }`. BU-Schlüssel auf einem Automatikkonto, siehe Abschnitt 3.4.

**Zeile 133 und 134:** `MARGIN_25A → 8200` und `INVESTMENT_GOLD_25C → 8150`. Laut buchungssatz.de heißt SKR03 **8200 schlicht „Erlöse" mit 19 Prozent**, und **8150 „Sonstige steuerfreie Umsätze (z. B. § 4 Nr. 2-7 UStG)"**. Beide Konten tragen also nicht die Behandlung, die der Kommentar im Code ihnen zuschreibt. Der Kommentar an derselben Stelle sagt „confirmed by the Steuerberater (2026)", das kann ich nicht prüfen und widerspreche dem nicht, aber die **Kontenbezeichnungen** widersprechen ihm.

**Zeile 296:** `const account = isAnkauf ? KONTO_WARENEINGANG : KONTO_KASSE;`. Jeder Verkauf geht gegen 1000 Kasse, **unabhängig von der Zahlungsart**. Genau der BMF-Mangel aus Abschnitt 6.

**Zeile 448:** die Route heißt `/api/closings/:id/export/datev`. Es gibt **keine** Zeitraum-Route. Basels Anforderung „Export für JEDEN Zeitraum, jederzeit" ist im Backend derzeit nicht erfüllt.

**Zeile 528:** `reply.type('text/plain; charset=utf-8')`. DATEV erwartet ANSI.

---

## Was für den Bau unmittelbar zählt

| # | Befund | Beleg | Was zu tun ist | Fundstelle im Quelltext |
|---|---|---|---|---|
| 1 | Ohne Wert schreibt DATEV den ganzen Stapel fest | Dok. 1003221 Feld 114, wörtlich; Accountico 06.06.2025 | Kopf-Feld 21 und Zeilen-Feld 114 explizit mit `0` füllen, per Schalter im Export auf `1` setzbar | `datev-export.ts:62`, Spaltenliste ab `:40` |
| 2 | Belegdatum ist TTMM, das Jahr wird ignoriert | Dok. 1003221 Feld 10, wörtlich | Zeitraumexport hart an der Wirtschaftsjahresgrenze schneiden, je Wirtschaftsjahr eine Datei, Kopf-Felder 13, 15, 16 füllen | `datev-export.ts:71` |
| 3 | Ausgabe ist UTF-8, DATEV erwartet ANSI | Dok. 1003221, Kapitel 2 | Vor dem Senden nach Windows-1252 wandeln, `charset=windows-1252` setzen | `closing-export.ts:528` |
| 4 | Belegfeld 1 lässt nur Ziffern, Buchstaben und `$ & % * + - /` zu, max. 36 | Dok. 1003221 Feld 11, wörtlich; GitHub Issue #14 | Validierung, die beim Export **hart bricht** statt still zu bereinigen, plus Test mit Umlaut, Punkt und Leerzeichen | `closing-export.ts` Feld `reference` |
| 5 | Kartenzahlung darf nicht auf die Kasse | BMF 16.08.2017 und 29.06.2018 (Haufe, bonstore) | Sollkonto aus der Zahlungsart ableiten: bar 1000/1600, Karte 1361/1461 je Akzeptanzweg | `closing-export.ts:296` |
| 6 | Automatikkonto plus BU-Schlüssel ist mindestens strittig | weclapp gegen epago, DATEV Dok. 1046108 | Auf 8400/8300 und 4400/4300 Feld 9 leer lassen | `closing-export.ts:131` |
| 7 | 8200 heißt „Erlöse" 19 Prozent, 8150 heißt „§ 4 Nr. 2-7" | buchungssatz.de, ECOVIS | § 25a auf **8193 plus 8191** (SKR04 4138 plus 4136) splitten, Einkaufspreis und Marge getrennt; § 25c-Konto vom Berater benennen lassen | `closing-export.ts:133` |
| 8 | Es gibt keinen Zeitraumexport, nur je Tagesabschluss | Basels Anforderung | Route `von` bis `bis` mit Wirtschaftsjahres-Schnitt und Zeitraum in Kopf-Feld 15 und 16 | `closing-export.ts:448` |
| 9 | Kontenrahmen ist hart SKR03 | DATEV Ratgeber, Haufe 7.2 | Kontenzuordnung als Mandantenkonfiguration, SKR03 und SKR04 lieferbar, Kopf-Feld 27 füllen | `closing-export.ts:112` bis `:135` |
| 10 | Buchungstext trägt Rohtoken wie `MARGIN_25A` | Dok. 1003221 Feld 14, 60 Zeichen | Deutscher Klartext, zum Beispiel „Verkauf Bon 2026-000123, Differenzbesteuerung § 25a" | `closing-export.ts:319` |
| 11 | Verdichtung je Tag ist erlaubt, Einzelaufzeichnung ist Pflicht | § 146 Abs. 1 AO; Merkblatt Niedersachsen | Zwei Modi anbieten: je Tag nach Steuersatz und Zahlungsart, oder je Beleg. Voreinstellung: je Tag | neu |
| 12 | Kassendifferenzen brauchen eigene Konten | Haufe HI10942480 | 2309/6969 Fehlbetrag, 2709/4839 Überschuss, aus dem Zählprotokoll gespeist | neu |
| 13 | Geldtransit braucht Eigenbelege | Merkblatt Niedersachsen, wörtlich | Jede Transit- und Entnahmebuchung mit eigener Belegnummer in Belegfeld 1 | neu |
| 14 | Beleglink hängt das Belegbild an die Buchung | Dok. 1003221 Feld 20, mit Kürzeln `BEDI` und `DDMS` | Optional füllen, sobald der Kunde DATEV Unternehmen online nutzt | neu |
| 15 | KOST1 und KOST2 nur bei DATEV Kostenrechnung | Dok. 1003221 Felder 37, 38, 39 | Optional und abschaltbar, je Kasse oder Filiale | neu |

**Quellenverzeichnis (alle abgerufen 26.07.2026)**

Amtlich oder primär: [§ 146 AO](https://www.gesetze-im-internet.de/ao_1977/__146.html) · [Merkblatt Kassenführung, Finanzamt Niedersachsen](https://lstn.niedersachsen.de/download/150368/Merkblatt_Kassenfuehrung.pdf) · [DATEV Dok. 1003221, ASCII-Dateibeschreibung, 20.11.2020](https://handbuch.faktura-xp.de/download/ASCII-Dateibeschreibung_2020.pdf) · [§ 25c UStG](https://dejure.org/gesetze/UStG/25c.html) · [AEAO zu § 146a, BMF 30.06.2023](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/AO-Anwendungserlass/2023-06-30-AEAO-Par-146-AO.pdf)

Fachverlag und Kanzlei: [Haufe, Kassenfehl- und -mehrbeträge](https://www.haufe.de/id/beitrag/kassenfuehrung-diese-besonderheiten-sind-zu-beachten-523-kassenfehlbetraege-und-mehrbetraege-so-gehen-sie-richtig-vor-HI10942480.html) · [Haufe, BMF zu EC-Karten-Umsätzen](https://www.haufe.de/steuern/finanzverwaltung/bmf-ec-karten-umsaetzen-im-kassenbuch_164_457306.html) · [Haufe, Differenzbesteuerung bewegliche Gegenstände](https://www.haufe.de/id/beitrag/differenzbesteuerung-bewegliche-gegenstaende-HI8029852.html) · [Haufe, Kontenrahmen 7.2](https://www.haufe.de/id/beitrag/kontenrahmen-72-datev-skr03-und-skr04-sind-heute-standard-HI10084638.html) · [Accountico, 3 häufigste Importprobleme, 06.06.2025](https://accountico.de/die-3-haeufigsten-probleme-beim-import-in-datev-rechnungswesen/) · [ECOVIS RTS, SKR03 Klasse 1](https://www.ecovis-rts.de/servicecenter/kontenrahmen/skr-03-klasse-1.html) · [ECOVIS RTS, SKR03 Klasse 8](https://www.ecovis-rts.de/servicecenter/kontenrahmen/skr-03-klasse-8.html) · [Kontenplan SKR04, Steuerberaterkammern](https://www.sbk-sachsen.de/files/2025/08/Kontenplan-SKR04_ab-AP-Wi-2025-Hochformat.pdf)

Praxis und Software: [Spesenfuchs, häufige Fehlerquellen](https://support.spesenfuchs.de/de/support/solutions/articles/11000128763-datev-datenservices-h%C3%A4ufige-fehlerquellen) · [Lexware für Steuerkanzleien, Importfehlermeldungen](https://steuerberater.help.lexware.de/de/articles/603499-lexware-buchhaltung-fehlermeldungen-beim-import-des-buchungsstapels) · [weclapp, Automatikkonto und BU-Schlüssel](https://doc.weclapp.com/knowledgebase/was-bedeutet-die-einstellung-automatikkonto-wofuer-sind-bu-schluessel-zu-hinterlegen/) · [epago, DATEV-Buchungsschlüssel](https://epago.de/lexikon/steuern/datev-buchungsschluessel-guide/) · [bonstore, EC-Kartenumsätze](https://bonstore.de/blog/buchung-von-ec-kartenumsaetzen-in-der-kassenfuehrung/buchungstipp) · [Rechnungswesenforum, EC-Sammelbuchungen SKR04](https://www.rechnungswesenforum.de/forum/buchfuehrung-buchhaltung/allgemein/ec-sammelbuchungen-im-skr04-buchen.1906610/) · [Mihok, DATEV-Schnittstelle Kassensystem](https://www.mihok-kassensysteme.de/ratgeber/datev-schnittstelle-kassensystem) · [ledermann/datev Issue #14](https://github.com/ledermann/datev/issues/14) · [buchungssatz.de SKR03 8200](https://www.buchungssatz.de/de/konto/skr03/8200.html) · [buchungssatz.de SKR03 8150](https://www.buchungssatz.de/de/konto/skr03/8150.html) · [auditplan, EXTF-Format](https://auditplan.io/datev-buchungsstapel-extf)

Nicht lesbar, nur als Fundstelle genannt: DATEV Hilfe-Center Dok. 1003888 (`REW92178`), Dok. 1046108 (`REW00310`), Dok. 1002367 (Kassenbewegungen importieren), Dok. 1038737 (aktuelle Kontenrahmen), DATEV-Community 185763 (Anlagegold § 25c). Diese Seiten liefern ohne JavaScript beziehungsweise ohne Anmeldung keinen Text, ihr Inhalt ist in dieser Antwort als unbestätigt gekennzeichnet.