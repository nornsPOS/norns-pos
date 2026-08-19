## Quellenlage

| Quelle | Adresse | Stand |
|---|---|---|
| DATEV Developer Portal, Formatbeschreibung DATEV-Format (amtlich, Hersteller selbst) | `https://developer.datev.de/de/file-format/details/datev-format` ; Rohdaten über `https://developer.datev.de/mediator/strapi/file-formats/slug/datev-format` | abgerufen 26.07.2026 |
| DATEV Musterdaten, echte Datei `EXTF_Buchungsstapel.csv` | `https://developer.datev.de/assets/Musterdaten_DATEV_Format_0_7f9322b9cc.zip` | abgerufen 26.07.2026 |
| DATEV Prüfprogramm DATEV-Format 2.2.3.0, enthält 287 maschinenlesbare Formatdefinitionen | `https://developer.datev.de/assets/Datev_Format_Pruefprogramm_2_2_3_0_76439824cb.zip` | Datei `Format_Buchungsstapel.xml` datiert 21.10.2025 |
| DATEV Hilfe-Dok 1080697 "Festschreibung beim Import in die DATEV-Rechnungswesen-Programme" | `https://apps.datev.de/help-center/documents/1080697` | im Dokument: "12.06.2026 auf Aktualität geprüft" |
| DATEV Hilfe-Dok 1034038 "Stapelverarbeitung: Buchungsstapel und Stammdaten im DATEV-Format importieren" | `https://apps.datev.de/help-center/documents/1034038` | Änderung 25.07.2026 |
| DATEV Hilfe-Dok 1044208 "REW04506 oder Keine Daten vorhanden beim Importieren" | `https://apps.datev.de/help-center/documents/1044208` | Änderung 25.07.2026 |
| DATEV Hilfe-Dok 1036228 "Buchungsstapel und Stammdaten über ASCII-Daten importieren" | `https://apps.datev.de/help-center/documents/1036228` | Änderung 21.05.2026 |
| GoBD, BMF-Schreiben, Rechtsgrundlage § 146 Abs. 4 AO, § 239 Abs. 3 HGB | `https://ao.bundesfinanzministerium.de/ao/2023/Anhaenge/BMF-Schreiben-und-gleichlautende-Laendererlasse/Anhang-64/inhalt.html` | amtlich |

Alle Feldangaben unten stammen aus DATEV selbst, nicht aus Blogs. Wo Blogs abweichen, nenne ich es.

---

## 1. Die Kopfzeile: alle 31 Felder

Amtliches Beispiel (DATEV Developer Portal, Seite "Header", identisch mit der Musterdatei):

```
"EXTF";700;21;"Buchungsstapel";13;20240130140440439;;"RE";"";"";29098;55003;20240101;4;20240101;20240831;"Buchungsstapel";"WD";1;0;0;"EUR";;"";;;"03";;;"";""
```

DATEV führt in der Header-Tabelle **keine** Spalte Pflicht/optional. Die Pflicht ergibt sich aus zwei Stellen: aus dem regulären Ausdruck selbst (Portal-Seite "Notation für Ausdrücke": `{0,n}` = optionales Feld, `{1,n}` = Pflichtfeld) und aus Dok 1044208 Kapitel 2.2, das Beraternummer, Mandantennummer, Wirtschaftsjahr, Datum von und Datum bis als "Ordnungsbegriffe" führt, ohne die die Datei in der Stapelverarbeitung gar nicht erst erscheint. Die Spalte "Pflicht" unten ist meine Ableitung aus diesen beiden Stellen, DATEV sagt es nicht wörtlich.

| # | Überschrift | Ausdruck (DATEV wörtlich) | Bedeutung | Pflicht | Beispiel |
|---|---|---|---|---|---|
| 1 | Kennzeichen | `^["](EXTF\|DTVF)["]$` | EXTF = Export aus Fremdanwendung, DTVF = Export aus DATEV-Anwendung | ja | `"EXTF"` |
| 2 | Versionsnummer | `^(700)$` | Version des Headers. "Anhand der Versionsnummer können ältere Versionen abwärtskompatibel verarbeitet werden." | ja | `700` |
| 3 | Formatkategorie | `^(16\|20\|21\|46\|48\|65)$` | 21 = Buchungsstapel | ja | `21` |
| 4 | Formatname | `^["](Buchungsstapel\|…)["]$` | Klartextname | ja | `"Buchungsstapel"` |
| 5 | Formatversion | `^(2\|4\|5\|13)$` | Satzversion des jeweiligen Formats, für Buchungsstapel 13 | ja | `13` |
| 6 | Erzeugt am | `YYYYMMDDHHMMSSFFF` | Zeitstempel mit Millisekunden, 17 Stellen | ja | `20240130140440439` |
| 7 | Importiert | `^[]$` | Leerfeld, nichts schreiben, auch keine Anführungszeichen | leer | |
| 8 | Herkunft | `^["]\w{0,2}["]$` | 2 Zeichen Herkunftskürzel | optional, Anführungszeichen aber immer | `"RE"` |
| 9 | Exportiert von | `^["]\w{0,25}["]$` | Bearbeitername | optional | `"Max Mustermann"` |
| 10 | Importiert von | `^["]\w{0,25}["]$` | wird beim Import gefüllt | optional | `""` |
| 11 | Beraternummer | `^(\d{4,6}\|\d{7})$` | Bereich 1001 bis 9999999 | ja, Ordnungsbegriff | `29098` |
| 12 | Mandantennummer | `^\d{1,5}$` | Bereich 1 bis 99999 | ja, Ordnungsbegriff | `55003` |
| 13 | WJ-Beginn | `YYYYMMDD` | Wirtschaftsjahresbeginn | ja, Ordnungsbegriff | `20240101` |
| 14 | Sachkontenlänge | `^[4-8]$` | "Wert muss beim Import mit der Konfiguration des Mandats in der DATEV App übereinstimmen." | ja | `4` |
| 15 | Datum von | `YYYYMMDD` | Beginn der Periode des Stapels | ja bei Bewegungsdaten | `20240101` |
| 16 | Datum bis | `YYYYMMDD` | Ende der Periode des Stapels | ja bei Bewegungsdaten | `20240831` |
| 17 | Bezeichnung | `^["][\w.-/ ]{0,30}["]$` | Stapelname, den der Berater in der Liste sieht | optional, aber sichtbar | `"Rechnungsausgang 02/2024"` |
| 18 | Diktatkürzel | `^["]([A-Z]{2}){0,2}["]$` | Bearbeiterkürzel, Großbuchstaben | optional | `"WD"` |
| 19 | Buchungstyp | `^[1-2]$` | 1 = Finanzbuchführung (default), 2 = Jahresabschluss | ja bei Bewegungsdaten | `1` |
| 20 | Rechnungslegungszweck | `^(0\|30\|40\|50\|64)$` | 0 = unabhängig (default), 30 = Steuerrecht, 40 = Kalkulatorik, 50 = Handelsrecht, 64 = IFRS | ja bei Bewegungsdaten | `0` |
| 21 | Festschreibung | `^(0\|1)$` | 0 = keine Festschreibung, 1 = Festschreibung (default) | ja bei Bewegungsdaten | `0` oder `1` |
| 22 | WKZ | `^["]([A-Z]{3})["]$` | ISO-Währungscode, default EUR | ja bei Bewegungsdaten | `"EUR"` |
| 23 | Reserviert | `^[]$` | Leerfeld | leer | |
| 24 | Derivatskennzeichen | `^["]["]$` | leere Anführungszeichen | `""` | `""` |
| 25 | Reserviert | `^[]$` | Leerfeld | leer | |
| 26 | Reserviert | `^[]$` | Leerfeld | leer | |
| 27 | Sachkontenrahmen | `^["](\d{2}){0,2}["]$` | verwendeter SKR | optional | `"03"` |
| 28 | ID der Branchenlösung | `^\d{0,4}$` | nur bei DATEV-Branchenlösung | optional | |
| 29 | Reserviert | `^[]$` | Leerfeld | leer | |
| 30 | Reserviert | `^["]["]$` | leere Anführungszeichen | `""` | `""` |
| 31 | Anwendungsinformation | `^["].{0,16}["]$` | Verarbeitungskennzeichen der abgebenden Anwendung | optional | `"02/2024"` |

Wichtig, weil oft übersehen: Feld 7, 23, 25, 26, 29 sind **echt leer**, Feld 24 und 30 sind **zwei Anführungszeichen**. Das ist nicht dasselbe. DATEVs eigenes Beispiel hält sich daran.

Zweite Erkenntnis aus Dok 1044208: der **Dateiname** ist Teil des Vertrags. "Der korrekte Dateiname beginnt mit `EXTF_` und endet auf `.csv`." Eine sonst perfekte Datei mit falschem Namen wird in der Stapelverarbeitung schlicht nicht angezeigt, Meldung `#REW04506`.

---

## 2. Welche Formatversion ist heute aktuell

Hier werden zwei Zahlen ständig verwechselt, und genau daran scheitern die meisten Fremdschnittstellen.

- **Versionsnummer des Headers (Feld 2) = 700.** Das ist die einzige zulässige. Der Ausdruck ist `^(700)$`, es gibt kein 7xx und kein 1.x. Laut Changelog des Portals ist 700 seit **Oktober 2018** die "new main version". Ja, DATEV nimmt 700 an, es ist die aktuelle und einzige.
- **Formatversion des Buchungsstapels (Feld 5) = 13.** Das ist die Satzversion und die hat sich mehrfach geändert.

Versionsgeschichte, belegt aus dem Changelog des Portals und gegengeprüft an den Formatdateien im Prüfprogramm (Feldzahl je Version aus den XML-Dateien):

| Formatversion | Felder | eingeführt | Änderung |
|---|---|---|---|
| 13 | 125 | Februar 2024 | Feld 125 "Abw. Skontokonto" neu |
| 12 | 124 | Juni 2021 | Feld 123 EU-Land u. UStID (Ursprung), Feld 124 EU-Steuersatz (Ursprung) neu, Feld 40 und 41 angepasst |
| 11 | 122 | Januar 2021 | Feld 121 Abrechnungsreferenz, Feld 122 BVV-Position neu |
| 10 | 121 | ab DVD 14.0 / Rewe 9.1 | |
| 9 | 120 | | |
| 8 | 117 | | |
| 7 | 116 | | |
| 6 | 113 | | |
| 5 | 110 | | ab hier gibt es überhaupt erst ein Festschreibekennzeichen (Rewe 5.1, Januar 2016) |
| 4 | 105 | | |
| 3 | 94 | | |
| 2 | 93 | | |
| 1 | 89 | | |

Letzte Portal-Änderung überhaupt: **März 2025, "Improved a few regular expressions"**, keine neue Formatversion. Die Formatdefinition im heute heruntergeladenen Prüfprogramm trägt `<Version>13</Version>` und ist vom 21.10.2025. **Stand 26.07.2026 ist 700 / 13 aktuell.**

Ältere Formatversionen nimmt DATEV weiter an, aber mit einer harten Folge, siehe Punkt 7: eine Datei in einer Version vor 5 hat gar kein Festschreibefeld und wird deshalb **automatisch festgeschrieben, ohne jede Möglichkeit, das wieder aufzuheben** (Dok 1080697, Kapitel 3 und 3.1).

---

## 3. Die Spaltenzeile: wie viele Spalten, und die ersten 25 exakt

**125 Spalten.** Zweifach belegt: die Musterdatei von DATEV hat in Zeile 2 genau 125 Feldnamen und in jeder Datenzeile genau 125 Werte (nachgezählt), und die Formatdefinition `Format_Buchungsstapel.xml` im Prüfprogramm enthält genau 125 `<Field>`-Elemente mit `OrdinalNumber` 0 bis 124.

Die ersten 25 Überschriften, byteweise aus DATEVs eigener Datei:

| # | Überschrift | Typ | Pflicht laut `<Necessary>` |
|---|---|---|---|
| 1 | `Umsatz (ohne Soll/Haben-Kz)` | Betrag, 10,2 | **ja** |
| 2 | `Soll/Haben-Kennzeichen` | Text 1 | **ja** |
| 3 | `WKZ Umsatz` | Text 3 | nein |
| 4 | `Kurs` | Zahl 5,6 | nein |
| 5 | `Basis-Umsatz` | Betrag 10,2 | nein |
| 6 | `WKZ Basis-Umsatz` | Text 3 | nein |
| 7 | `Konto` | Konto 9 | **ja** |
| 8 | `Gegenkonto (ohne BU-Schlüssel)` | Konto 9 | **ja** |
| 9 | `BU-Schlüssel` | Text 4 | nein |
| 10 | `Belegdatum` | Datum | **ja** |
| 11 | `Belegfeld 1` | Text 36 | nein |
| 12 | `Belegfeld 2` | Text 12 | nein |
| 13 | `Skonto` | Betrag 8,2 | nein |
| 14 | `Buchungstext` | Text 60 | nein |
| 15 | `Postensperre` | Zahl 1 | nein |
| 16 | `Diverse Adressnummer` | Text 9 | nein |
| 17 | `Geschäftspartnerbank` | Zahl 3 | nein |
| 18 | `Sachverhalt` | Zahl 2 | nein |
| 19 | `Zinssperre` | Zahl 1 | nein |
| 20 | `Beleglink` | Text 210 | nein |
| 21 | `Beleginfo - Art 1` | Text 20 | nein |
| 22 | `Beleginfo - Inhalt 1` | Text 210 | nein |
| 23 | `Beleginfo - Art 2` | Text 20 | nein |
| 24 | `Beleginfo - Inhalt 2` | Text 210 | nein |
| 25 | `Beleginfo - Art 3` | Text 20 | nein |

Nur **fünf** der 125 Felder sind laut DATEVs eigener Formatdefinition Pflicht: Umsatz, Soll/Haben-Kennzeichen, Konto, Gegenkonto, Belegdatum. Alle übrigen 120 dürfen leer sein, **müssen aber als Feld vorhanden sein**, weil das Format positionsbasiert ist.

Achtung Feinheit für die Schreibroutine: die Spaltenzeile in der CSV weicht an fünf Stellen von den Labels der Formatdefinition ab. Zu schreiben ist die **CSV-Schreibweise**:

| # | CSV schreibt | Formatdefinition sagt |
|---|---|---|
| 7 | `Konto` | Kontonummer |
| 37 | `KOST1 - Kostenstelle` | Kost 1 - Kostenstelle |
| 38 | `KOST2 - Kostenstelle` | Kost 2 - Kostenstelle |
| 96 | `Buchungstyp` | Buchungstyp (Anzahlungen) |
| 104 | `KOST-Datum` | Kost-Datum |

Und ab Feld 48 schreibt DATEV selbst inkonsistent `Zusatzinformation - Art 1` mit Leerzeichen vor dem Bindestrich, aber `Zusatzinformation- Inhalt 1` ohne. Das ist kein Tippfehler von mir, das steht so in DATEVs Datei. Kopiere die Zeile wörtlich, erfinde sie nicht nach.

**Was passiert bei nur 12 Spalten?**

Belegt: Die Stapelverarbeitung erkennt eine Datei überhaupt nur als DATEV-Format-Datei, wenn Zelle A1 `EXTF` oder `DTVF` enthält und der Name `EXTF_*.csv` lautet (Dok 1044208, Kapitel 2.3 und 2.4). Steht in A1 etwas anderes, gilt wörtlich: "dann handelt es sich nicht um eine DATEV-Format-Datei. Importieren Sie über den ASCII-Import." Der ASCII-Import ist der Weg, auf dem beliebige Spaltenzahlen zulässig sind, weil man dort ein individuelles Format anlegt und Spalten von Hand zuordnet (Dok 1036228, Kapitel 3.2).

Unbestätigt: Die exakte Programm-Meldung, die DATEV Rechnungswesen bei einer Datei mit gültigem EXTF-Header, aber nur 12 statt 125 Datenfeldern ausgibt, veröffentlicht DATEV nicht. Ich habe sie in keiner amtlichen Quelle gefunden und behaupte sie nicht.

Belegbar ist dagegen die **Folge**, und sie ist schwerwiegender als eine Fehlermeldung: eine Datei ohne Feld 114 hat kein Festschreibekennzeichen. Für solche Stapel gilt laut Dok 1080697 Kapitel 3.1 wörtlich: "Für Stapel ohne Festschreibekennzeichen (`?`) kann Ausnahmerecht nicht genutzt werden", der Stapel wird automatisch festgeschrieben und lässt sich **nie mehr** entsperren, und zusätzlich: "Buchungsstapel ohne Festschreibekennzeichen (`?`) können beim Import nicht an einen bereits bestehenden Buchungsstapel angehängt werden." Eine 12-Spalten-Datei sperrt dem Steuerberater also dauerhaft die Korrekturmöglichkeit. Das allein ist der Grund, alle 125 Spalten zu bauen.

Zusätzliches Limit: **99.999 Buchungszeilen je Datei** (Portal, Seite Formatbeschreibung, und Dok 1036228).

---

## 4. Zeichensatz

DATEV, Portal-Seite "Zeichensatz", wörtlich sinngemäß: Der Default-Zeichensatz für den Import ist **ISO-8859-1 beziehungsweise CodePage 1252**. Unicode (UTF-8, UTF-16, UTF-32) wird zusätzlich interpretiert, **sofern die ByteOrderMark mitgeliefert wird, ausdrücklich auch für UTF-8**. Und der Vorbehalt, der in der Praxis zuschlägt: "Unicode funktioniert nur über den manuellen Import im DATEV Rechnungswesen oder mittels der Online API `accounting:extf-files`. Die App KrStaPv unterstützt kein Unicode."

Das heißt konkret: die automatisierte Konsolenverarbeitung beim Berater, `KrStaPv.exe`, kann UTF-8 **nicht**. Wer will, dass der Berater nichts tun muss außer sich anzumelden, schreibt **Windows-1252 ohne BOM**. Das ist die einzige Variante, die auf allen drei Importwegen funktioniert.

Was bei falscher Wahl mit Umlauten passiert, gemessen an DATEVs eigener Musterdatei: `Normalabschreibung Gebäude` gelesen als CP1252 wird zu `Normalabschreibung GebÃ¤ude`. Umgekehrt wird `Textschlüssel` aus einer CP1252-Datei, als UTF-8 gelesen, zu `Textschl<ersatzzeichen>ssel`. Kein Fehler, keine Meldung, nur dauerhaft kaputte Buchungstexte in der Buchführung des Mandanten.

Und ein Widerspruch, den DATEV selbst produziert und den man kennen muss: von den sieben Musterdateien im offiziellen Paket sind fünf CP1252 und zwei (`EXTF_Buchungsstapel.csv`, `EXTF_Zahlungsbedingungen.csv`) sind **UTF-8 ohne BOM**, also genau die Kombination, die die eigene Zeichensatzseite ausschließt. Verlasse dich auf die Regel, nicht auf die Musterdatei.

---

## 5. Zeilenende, Trennzeichen, Anführungszeichen

Alles wörtlich von der Portal-Seite "Einstieg":

- Trennzeichen: **Semikolon**.
- Zeilenende: **CR/LF am Ende jeder Zeile**. Nachgemessen an der Musterdatei: 56 Zeilen, 56 CRLF, null nackte LF, und die Datei endet mit CRLF.
- "Alle Text-Datenfelder müssen mit Anführungszeichen umschlossen werden."
- "Wenn ein Text-Datenfeld Anführungszeichen enthält, müssen diese verdoppelt werden."
- "Steuerungszeichen innerhalb von Text-Datenfeldern sind nicht zulässig", ausdrücklich auch kein Zeilenumbruch.
- "Trennzeichen für Zahlen vom Typ double ist ein Komma."
- "Tausenderstellen bei Zahlen sind in der Regel nicht gesondert zu kennzeichnen."

Wann darf ein Feld **nicht** eingefasst werden: die Regel steht nicht in Prosa, sie steht in den Ausdrücken. **Enthält der reguläre Ausdruck eines Feldes `["]`, gehören Anführungszeichen hin. Enthält er sie nicht, dürfen keine gesetzt werden.** Gegengeprüft an der Musterdatenzeile:

```
100,18;"S";"";;;"";48400;8401;"";3101;"";"";;"Test Anzahlung";…
```

Feld 1 Umsatz `100,18` ohne, Feld 2 `"S"` mit, Feld 7 Konto `48400` ohne, Feld 10 Belegdatum `3101` ohne, Feld 14 Buchungstext mit. Das deckt sich Feld für Feld mit den Ausdrücken.

Leere Felder: bei Textfeldern schreibt DATEV `""`, bei Zahlfeldern gar nichts. Die Musterdatei ist hier an einzelnen Stellen selbst unsauber (Feld 19 Zinssperre steht als `""`, obwohl der Ausdruck `^(0|1)$` lautet), was belegt, dass der Leser tolerant ist. Verlasse dich trotzdem auf die Regel.

Beleglink ist der Sonderfall, an dem die Verdopplung wirklich gebraucht wird. DATEVs Beispiel:

```
"BEDI ""E0A08953-FBAA-4054-AF36-993D5D68F040"""
```

---

## 6. Datums- und Betragsformat, und der Jahreswechsel

**Belegdatum, Feld 10.** Ausdruck `^(\d{4})$`, Format `TTMM`, Beispiel `0105`. Und dann die Kernaussage, wörtlich von DATEV: **"Das Jahr wird immer aus dem Feld #13 des Headers ermittelt."** Feld 13 des Headers ist der **Wirtschaftsjahresbeginn**, nicht "Datum von".

Das hat drei Konsequenzen für den Bau:

1. Eine Datei kann nur Buchungen **eines** Wirtschaftsjahres tragen. Es gibt keine Stelle, an der ein zweites Jahr stünde.
2. Bei abweichendem Wirtschaftsjahr, etwa WJ-Beginn 01.07., liegt `3101` im Kalenderjahr **nach** dem WJ-Beginn. Das Jahr ergibt sich aus der Lage von Tag und Monat im Wirtschaftsjahresfenster, nicht aus einem Feld.
3. Ein Zeitraum über den Jahreswechsel **muss** in mehrere Dateien zerlegt werden. DATEV empfiehlt das ohnehin, wörtlich: "Erstellen Sie pro Buchungsperiode eine eigene Text-Datei, damit diese einzeln für die entsprechende Buchungsperiode verarbeitet werden können."

Für Basels Anforderung "der Export muss für jeden Zeitraum möglich sein" heißt das ganz konkret: die Oberfläche darf jeden Zeitraum anbieten, der Erzeuger muss ihn aber intern schneiden, nach Wirtschaftsjahr zwingend, nach Buchungsperiode empfohlen, und zusätzlich bei mehr als 99.999 Zeilen. Ergebnis ist ein ZIP mit mehreren `EXTF_*.csv`. Dabei muss der Header jeder Teildatei sein eigenes `Datum von` und `Datum bis` und seinen eigenen `WJ-Beginn` tragen. Das ist die einzige ehrliche Bauweise. Eine einzelne Datei über zwei Wirtschaftsjahre wäre eine Lüge im Header.

Widerspruch, den ich benennen muss: die Formatdefinition im Prüfprogramm trägt auf Formatebene `<DateFormatExpression>TTMMJJJJ</DateFormatExpression>`, das Portal schreibt für Feld 10 dagegen strikt vierstellig `TTMM`. Näher an der amtlichen Stelle ist hier das Portal, weil es die CSV-Schnittstelle beschreibt, während die XML-Datei die Formatverwaltung des Programms konfiguriert. Für `EXTF_*.csv` gilt `TTMM`.

**Weitere Datumsfelder** im Satz sind achtstellig `TTMMJJJJ`: Feld 93 Zugeordnete Fälligkeit, 104 KOST-Datum, 111 Postensperre bis, 115 Leistungsdatum, 116 Datum Zuord. Steuerperiode, 117 Fälligkeit. Nur Feld 10 ist vierstellig. Das ist die häufigste Fehlerquelle überhaupt.

**Beträge.** Feld 1 Umsatz: `^(?!0{1,10}\,00)\d{1,10}\,\d{2}$`. Drei Regeln in einem Ausdruck: Komma als Dezimaltrenner, genau zwei Nachkommastellen, **immer positiv und niemals 0,00**. Die Richtung kommt ausschließlich aus Feld 2, `"S"` oder `"H"`, und bezieht sich laut DATEV auf Feld 7 Konto. Ein Minuszeichen im Betrag ist unzulässig. Ebenso unzulässig ist die 0 bei Feld 4 Kurs und Feld 13 Skonto.

---

## 7. Festschreibung

Zwei verschiedene Felder, beide heißen so:

- **Header Feld 21**, `^(0|1)$`, "0 = keine Festschreibung, 1 = Festschreibung (default)".
- **Satz Feld 114**, `^(0|1)$`, und hier die schärfere Formulierung: "leer = nicht definiert; wird automatisch festgeschrieben. Hat ein Buchungssatz in diesem Feld den Inhalt 1, so wird **der gesamte Stapel** nach dem Import festgeschrieben."

Was daraus folgt, aus Dok 1080697, das die GoBD ausdrücklich als Grund nennt:

- Zweck des Kennzeichens ist, "dass ein Buchungsstapel, welcher in einem DATEV-Programm oder dem Programm eines anderen Herstellers erfasst und festgeschrieben wurde, auch nach dem Import in ein DATEV-Rechnungswesen Programm nicht mehr ohne weiteres verändert werden kann".
- Kommt ein Stapel mit Kennzeichen "Ja" an, kann der Berater die Festschreibung beim Import **nur per Ausnahmerecht in der Rechteverwaltung** aufheben. "Beachten Sie, dass jedes Aufheben der Festschreibung protokolliert wird und bei einer Betriebsprüfung begründet werden muss."
- Kommt ein Stapel **ohne** Kennzeichen an (`?` in der Spalte Festschr. der Stapelverarbeitung), ist er automatisch festgeschrieben, das Ausnahmerecht greift nicht, und er kann nicht an einen bestehenden Stapel angehängt werden.
- Festgeschriebene Buchungen korrigiert man nur noch per **Generalumkehr**, Satzfeld 118 (Dok 1080697 und Dok 1070379).

Rechtlich dahinter: § 146 Abs. 4 AO, eine Buchung darf nicht so verändert werden, dass der ursprüngliche Inhalt nicht mehr feststellbar ist, plus § 239 Abs. 3 HGB, konkretisiert durch die GoBD. Die GoBD nennt keine Tagesfrist, sondern "zeitnah", was in der Beraterpraxis auf monatliche Festschreibung analog zur Umsatzsteuer-Voranmeldung hinausläuft.

**Was Berater raten, und warum das strittig ist.** Hier gibt es keine richtige Antwort, sondern zwei legitime Linien, und die Wahl gehört dem Steuerberater, nicht der Software:

- Linie A, `1` im Feld 114: maximal GoBD-nah, der Stapel kommt versiegelt an, die Durchgängigkeit vom Kassensystem bis in die Buchführung ist lückenlos. Preis: jede Korrektur kostet den Berater eine Generalumkehr oder ein protokolliertes Ausnahmerecht, das er in einer Prüfung begründen muss.
- Linie B, `0` im Feld 114: der Berater sieht den Stapel, prüft Kontenzuordnung und Steuerschlüssel, korrigiert wo nötig, und schreibt dann selbst fest. Preis: zwischen Export und Festschreibung existiert ein Fenster, in dem die Daten in DATEV noch änderbar sind.

Die eine Sache, die **nicht** strittig ist: Feld 114 leer zu lassen ist die schlechteste aller Varianten, weil sie automatisch festschreibt und dem Berater dabei möglicherweise auch noch das Ausnahmerecht nimmt. Bauen: das Feld immer explizit mit `0` oder `1` schreiben, den Wert als Mandanteneinstellung führen, im Exportdialog im Klartext anzeigen ("Dieser Stapel wird festgeschrieben übergeben"), und die Voreinstellung erst nach Rückfrage beim Steuerberater festlegen.

---

## 8. Prüfwerkzeuge

**Amtlich und frei zugänglich, von DATEV selbst:**

1. **Prüfprogramm DATEV-Format 2.2.3.0**, direkter Download ohne Anmeldung: `https://developer.datev.de/assets/Datev_Format_Pruefprogramm_2_2_3_0_76439824cb.zip`. DATEV dazu: "Mit dem Prüfprogramm DATEV-Format können Sie Dateien im DATEV-Format prüfen." Inhalt: eine Windows-Anwendung `DatevFormatPruefProgramm.exe` und 287 Formatdefinitionen im Ordner `Formate`. Einschränkung, die für diese Werkstatt zählt: es ist eine `.exe`, also nicht auf dem Mac lauffähig, es braucht Windows oder eine Windows-VM. Der wertvollere Teil ist ohnehin maschinenlesbar und plattformunabhängig, nämlich `Formate/Format_Buchungsstapel.xml`: 125 `<Field>`-Einträge mit `Label`, `FormatType`, `Length`, `DecimalPlaces` und vor allem `Necessary`. Daraus lässt sich ein eigener Validator generieren, statt ihn abzutippen.
2. **Musterdaten**, ebenfalls ohne Anmeldung: `https://developer.datev.de/assets/Musterdaten_DATEV_Format_0_7f9322b9cc.zip`, enthält `EXTF_Buchungsstapel.csv` als Referenzdatei. Das ist das beste Testartefakt, das es gibt: eigenen Erzeuger auf dieselben Eingaben loslassen und die Bytes vergleichen.
3. **Online API `accounting:extf-files`**, `https://developer.datev.de/de/product-detail/accounting-extf-files/2.0/overview`, validiert beim Upload ins Rechenzentrum. Braucht Registrierung und eine Anwendungszulassung.

**Nicht amtlich, aber brauchbar:** diverse Open-Source-Erzeuger, etwa `https://github.com/ledermann/datev`. Für eine Prüfung, die vor dem Steuerberater bestehen soll, zählen sie nicht als Beleg. Nimm sie höchstens als zweite Meinung.

---

## 9. Widersprüche in DATEVs eigenem Material, die man kennen muss

Diese Punkte sind der Grund, warum man die Ausdrücke aus dem Portal **nicht** eins zu eins als Validator übernehmen darf:

| Stelle | Widerspruch | Näher an der amtlichen Stelle |
|---|---|---|
| Header Feld 5 | Ausdruck `^(2\|4\|5\|13)$` erlaubt keine 3, die Beschreibung daneben nennt aber "3 = Sachkontenbeschriftungen", und DATEVs eigene Musterdatei `EXTF_Sachkontobeschriftungen.csv` schreibt `3` | Musterdatei und Anhangstabelle. Der Ausdruck ist unvollständig |
| Satz Feld 106 Skontosperre | `^[0\|1]$` ist eine Zeichenklasse, die auch das Zeichen `\|` erlaubt. Gemeint ist `^(0\|1)$` | offensichtlicher Tippfehler |
| Satz Feld 118 Generalumkehr | Ausdruck `^(["](0\|1)["])$`, Beschreibung daneben "G oder 1 = Generalumkehr" | Beschreibung, `G` ist der in der Praxis verwendete Wert |
| Zeichensatz | Seite verlangt BOM für UTF-8, DATEVs eigene Musterdatei ist UTF-8 ohne BOM | die Zeichensatzseite |
| Belegdatum | Portal `TTMM`, Prüfprogramm-XML `TTMMJJJJ` | das Portal, für die CSV-Schnittstelle |
| Feldnamen | fünf Abweichungen zwischen CSV-Spaltenzeile und XML-Label, siehe Punkt 3 | die CSV-Spaltenzeile |

---

## 10. Befund zum vorhandenen Code in diesem Haus

Ohne Auftrag zur Änderung, nur als Messung gegen das oben Belegte. Datei: `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/lib/datev-export.ts`, 112 Zeilen. Muster: `/Users/basel/Desktop/warehouse14/docs/samples/DATEV_Buchungsstapel_2026-06-06.csv`.

| Zeile | Ist | Soll | Wirkung |
|---|---|---|---|
| 39 bis 53 | `DATEV_COLUMNS` mit **12** Spalten, eigene Namen (`Umsatz`, `Soll/Haben`, `WKZ`, `Gegenkonto`, `Belegfeld1`) | 125 Spalten mit DATEVs Wortlaut | keine DATEV-Format-Datei, siehe Punkt 3 |
| 63 | `'EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;;;;;;;;;'` | Formatversion **13**, nicht 9 | Version 9 ist von 2018 |
| 63 | Kennzeichen `EXTF` **ohne Anführungszeichen**, Formatname ebenso | `"EXTF"`, `"Buchungsstapel"` | verstößt gegen `^["](EXTF\|DTVF)["]$` |
| 63 | 31 Felder, aber die `4` steht auf **Position 15**, nicht 14 | Sachkontenlänge ist Position 14, Position 15 ist Datum von | Feldversatz. Nachgezählt: ein Leerfeld zu viel zwischen Position 5 und der `4` |
| 63 | Felder 6, 11, 12, 13, 15, 16 leer: Erzeugt am, Beraternummer, Mandantennummer, WJ-Beginn, Datum von, Datum bis | alle sechs Pflicht beziehungsweise Ordnungsbegriff | Datei erscheint in der Stapelverarbeitung nicht, Meldung `#REW04506`, Dok 1044208 Kapitel 2.2 |
| 63 | Feld 21 Festschreibung leer | `0` oder `1` | siehe Punkt 7, schlechteste aller Varianten |
| Zeile 55 bis 62 | Kommentar behauptet "DATEV fillt/validiert sie beim Import" für Beraternummer, Mandantennummer und Wirtschaftsjahr | Dok 1044208 sagt das Gegenteil | der Kommentar ist die eigentliche Falle, er beruhigt über einen echten Defekt |
| Muster, Zeile 3 ff. | Beträge und Konten **in Anführungszeichen** (`"1190,00"`, `"1000"`) | beide unquoted | verstößt gegen die Ausdrücke |
| Muster, Buchungstext | `VERKAUF VK-2026-000123 (STANDARD_19)` | Rohbezeichner im Klartext | erscheint so in der Buchführung des Mandanten |
| Muster, Zeile 1 | Dateiname `DATEV_Buchungsstapel_2026-06-06.csv` | muss mit `EXTF_` beginnen | Datei wird nicht erkannt, Dok 1044208 Kapitel 2.4 |

Kurz: die heutige Datei ist kein DATEV-Format-Buchungsstapel, sondern eine CSV, die der Berater nur über den ASCII-Import mit einem von Hand angelegten individuellen Format einlesen könnte. Das ist genau das Gegenteil von "er soll nichts tun müssen außer sich anzumelden".

---

## 11. Was für den Bau unmittelbar zählt

| Was | Genauer Wert | Beleg |
|---|---|---|
| Dateiname | beginnt mit `EXTF_`, endet auf `.csv` | Dok 1044208, Kap. 2.4 |
| Zeile 1 | 31 Felder, siehe Tabelle Punkt 1 | Portal, Seite Header |
| Kennzeichen | `"EXTF"` mit Anführungszeichen | Feld 1 |
| Versionsnummer | `700`, ohne Anführungszeichen, einziger zulässiger Wert | Feld 2 |
| Formatkategorie | `21` | Feld 3 |
| Formatname | `"Buchungsstapel"` | Feld 4 |
| Formatversion | `13` | Feld 5, Prüfprogramm 21.10.2025 |
| Erzeugt am | 17 Stellen `YYYYMMDDHHMMSSFFF` | Feld 6 |
| Beraternummer, Mandantennummer | echte Zahlen des Steuerberaters, sonst erscheint die Datei nicht | Feld 11, 12, Dok 1044208 |
| WJ-Beginn | `YYYYMMDD`, bestimmt das Jahr **aller** Belegdaten | Feld 13 |
| Sachkontenlänge | `4` bis `8`, muss zum Mandantenbestand passen | Feld 14 |
| Datum von, Datum bis | `YYYYMMDD`, Periode des Stapels | Feld 15, 16 |
| Bezeichnung | max. 30 Zeichen, das sieht der Berater in der Liste | Feld 17 |
| Buchungstyp | `1` | Feld 19 |
| Rechnungslegungszweck | `0` | Feld 20 |
| Festschreibung Header | `0` oder `1`, Entscheidung des Steuerberaters | Feld 21 |
| WKZ | `"EUR"` | Feld 22 |
| Leerfelder | 7, 23, 25, 26, 29 komplett leer; 24 und 30 als `""` | Portal, Seite Header |
| Zeile 2 | genau 125 Überschriften, wörtlich aus DATEVs Musterdatei kopiert | Musterdaten-ZIP |
| Zeile 3 ff. | genau 125 Felder je Zeile | Musterdaten-ZIP |
| Pflichtfelder im Satz | nur 5: Umsatz, Soll/Haben, Konto, Gegenkonto, Belegdatum | `Format_Buchungsstapel.xml`, `<Necessary>1</Necessary>` |
| Betrag | Komma, 2 Nachkommastellen, immer positiv, nie `0,00`, **ohne** Anführungszeichen | Feld 1 |
| Richtung | `"S"` oder `"H"`, **mit** Anführungszeichen | Feld 2 |
| Konten | Ziffern, **ohne** Anführungszeichen | Feld 7, 8 |
| Belegdatum | vierstellig `TTMM`, **ohne** Anführungszeichen | Feld 10 |
| Buchungstext | max. 60 Zeichen, **mit** Anführungszeichen, keine Steuerzeichen | Feld 14 |
| Belegfeld 1 | max. 36 Zeichen, erlaubt nur `\w` und `$ & % * + - /`. **Verboten: Leerzeichen, Umlaute, Punkt, Komma, Semikolon, Doppelpunkt** | Feld 11 |
| Festschreibung Satz | `0` oder `1`, **niemals leer** | Feld 114 |
| Anführungszeichen | genau dann, wenn der Ausdruck des Feldes `["]` enthält | Portal, Notationsseite |
| Anführungszeichen im Text | verdoppeln | Portal, Seite Einstieg |
| Zeilenende | CR/LF, auch nach der letzten Zeile | Portal, Seite Einstieg |
| Zeichensatz | **Windows-1252 ohne BOM**, weil `KrStaPv.exe` kein Unicode kann | Portal, Seite Zeichensatz |
| Grenze je Datei | 99.999 Buchungszeilen | Portal, Seite Formatbeschreibung |
| Zeitraum über Jahreswechsel | zwingend in mehrere Dateien schneiden, je eine je Wirtschaftsjahr, empfohlen je Buchungsperiode | Feld 10 plus Portal-Empfehlung |
| Prüfung vor Auslieferung | Bytevergleich gegen `EXTF_Buchungsstapel.csv` aus dem Musterdaten-ZIP, plus Validator aus `Format_Buchungsstapel.xml` generieren | beide frei ladbar |
| Beraterentscheidung, nicht unsere | Wert von Feld 21 und 114, Kontenrahmen und BU-Schlüssel für Differenzbesteuerung, Feld 27 Sachkontenrahmen | ausdrücklich strittig |

Lokale Belege dieser Recherche liegen unter `im lokalen Arbeitsordner der Recherche: `: `datev_full.json` (Rohinhalt der Portal-Formatbeschreibung), `page_25_de.txt` bis `page_69_de.txt` (lesbare Auszüge), `datevmuster/` (die sieben Musterdateien), `pruef/DatevFormatPruefprogramm/Formate/Format_Buchungsstapel.xml` (die 125 Felddefinitionen mit Pflichtkennzeichen).