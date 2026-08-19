# Kassenbericht, Z-Bon, Kassenbuchführung: was das Gesetz verlangt und was der Prüfer wirklich sehen will

**Prüfstand aller Angaben: 26.07.2026.** Alle Primärquellen habe ich selbst heruntergeladen und im Volltext gelesen; die lokalen Kopien liegen unter `im lokalen Arbeitsordner der Recherche: ` (Dateinamen jeweils bei der Quelle genannt).

---

## 0. Die wichtigste Vorbemerkung, bevor irgendetwas gebaut wird

**Es gibt in Deutschland KEINE Rechtsnorm, die den Inhalt eines „Z-Bons" vorschreibt.** Das ist keine Spitzfindigkeit, sondern die Wurzel fast aller falschen Anforderungslisten im Netz.

Die berühmte Liste („Name des Geschäfts, Datum, Tagesendsumme, Nullstellenzähler bzw. Z-Nummer, Stornobuchungen, Retouren, Entnahmen, Zahlungswege") stammt aus dem **BMF-Schreiben vom 09.01.1996, IV A 8 - S 0310 - 5/95** („Verzicht auf die Aufbewahrung von Kassenstreifen bei Einsatz elektronischer Registrierkassen"). Dieses Schreiben ist **ausdrücklich aufgehoben** worden, und zwar durch das BMF-Schreiben vom 26.11.2010, IV A 4 - S 0316/08/10004-07, dort Seite 3, wörtlich: „Das BMF-Schreiben zum ‚Verzicht auf die Aufbewahrung von Kassenstreifen bei Einsatz elektronischer Registrierkassen' vom 9. Januar 1996 (BStBl I S. 34) wird im Übrigen hiermit aufgehoben."
Quellen: BMF 26.11.2010 im Volltext, [bundesfinanzministerium.de, PDF](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Betriebspruefung/2010-11-26-Aufbewahrung-digitaler-Unterlagen-bei-Bargeschaeften.pdf) (lokale Kopie `bmf2010.pdf`); Inhalt des 1996er Schreibens über [iww.de Quellenmaterial](https://www.iww.de/mbp/quellenmaterial/id/182545).

**Was heute stattdessen gilt:** Der Gesetzgeber hat den Papierbon durch den **Kassenabschluss als Datensatz** ersetzt. Verbindlich sind:

| Ebene | Norm | Was sie regelt |
|---|---|---|
| Gesetz | § 146 AO, § 146a AO, § 146b AO, § 147 AO, § 158 AO, § 162 AO, § 379 AO | Aufzeichnung, TSE-Pflicht, Beleg, Nachschau, Aufbewahrung, Beweiskraft, Schätzung, Bußgeld |
| Verordnung | KassenSichV (§§ 1 bis 6) | Was protokolliert, gespeichert, exportiert und auf den Beleg gedruckt wird |
| Verwaltung | AEAO zu § 146, zu § 146a (30.06.2023, gilt ab 01.01.2024), zu § 146b (29.05.2018); GoBD (28.11.2019, geändert 11.03.2024 und 14.07.2025) | Auslegung, Datenzugriff, Verfahrensdokumentation |
| Technik | DSFinV-K (aktuell **Version 2.4**, Januar 2024), BSI TR-03153-1, TR-03116-5 | Feldnamen, Dateien, QR-Code, TAR-Export |

Deshalb lautet die richtige Frage für den Bau nicht „was muss auf dem Z-Bon stehen", sondern **„was muss der Kassenabschluss als Datensatz enthalten, und was muss der Beleg tragen"**. Beides beantworte ich unten mit Feldnamen.

---

## 1. Was muss ein Tagesabschluss enthalten?

### 1a. Die Pflichtangaben des BELEGS (§ 6 KassenSichV, wörtlich)

Wortlaut abgerufen bei [gesetze-im-internet.de, § 6 KassenSichV](https://www.gesetze-im-internet.de/kassensichv/__6.html) am 26.07.2026:

> „Ein Beleg muss mindestens enthalten:
> 1. den vollständigen Namen und die vollständige Anschrift des leistenden Unternehmers,
> 2. das Datum der Belegausstellung und den Zeitpunkt des Vorgangsbeginns im Sinne des § 2 Satz 2 Nummer 1 sowie den Zeitpunkt der Vorgangsbeendigung im Sinne des § 2 Satz 2 Nummer 6,
> 3. die Menge und die Art der gelieferten Gegenstände oder den Umfang und die Art der sonstigen Leistung,
> 4. die Transaktionsnummer im Sinne des § 2 Satz 2 Nummer 2,
> 5. das Entgelt und den darauf entfallenden Steuerbetrag für die Lieferung oder sonstige Leistung in einer Summe sowie den anzuwendenden Steuersatz oder im Fall einer Steuerbefreiung einen Hinweis darauf […],
> 6. die Seriennummer des elektronischen Aufzeichnungssystems sowie die Seriennummer der zertifizierten technischen Sicherheitseinrichtung und
> 7. den Prüfwert der Vorgangsbeendigung im Sinne des § 2 Satz 2 Nummer 7 und den fortlaufenden Signaturzähler, der vom Sicherheitsmodul festgelegt wird."

§ 6 Satz 2 KassenSichV lässt drei Darstellungsformen zu: lesbar für jedermann, **auslesbar aus einem QR-Code**, oder im strukturierten Teil einer E-Rechnung nach § 14 Abs. 1 Satz 3 und 6 UStG. Satz 3: QR-Code und strukturierter Teil müssen der DSFinV entsprechen.

**Die Verwaltung verlangt MEHR als der Verordnungstext.** AEAO zu § 146a, Nr. 2.4.4 (BMF-Schreiben vom 30.06.2023, GZ IV D 2 - S 0316-a/20/10003 :006, Seiten 23 f., lokale Kopie `aeao146a.pdf` / `aeao146a.txt`) listet **neun** Punkte, also die sieben oben plus:

> „7. Betrag je Zahlungsart
> 8. Signaturzähler
> 9. Prüfwert"

Und wörtlich weiter: „Nachträgliches Runden, Abschneiden oder Verändern dieser Daten ist unzulässig." Sowie: „Sofern ein QR-Code gemäß Anhang I der DSFinV-K anstelle der für jedermann ohne maschinelle Unterstützung lesbaren Daten verwendet wird, gelten die vorgenannten Anforderungen als erfüllt."

**Bauhinweis, sehr konkret:** „Betrag je Zahlungsart" steht nicht in § 6 KassenSichV, aber im AEAO. Wer nur den Verordnungstext abbildet, hat einen Beleg, den ein Prüfer beanstanden kann.
Quelle: [BMF, Neufassung AEAO zu § 146a, 30.06.2023, PDF](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/AO-Anwendungserlass/2023-06-30-AEAO-Par-146-AO.pdf).

### 1b. Der QR-Code, Feld für Feld (DSFinV-K 2.4, Anhang I Nr. 2)

Reihenfolge, Trennzeichen Semikolon (Unicode U+003B):

```
<qr-code-version>;<kassen-seriennummer>;<processType>;<processData>;
<transaktions-nummer>;<signatur-zaehler>;<start-zeit>;<log-time>;
<sig-alg>;<log-time-format>;<signatur>;<public-key>
```

`<qr-code-version>` ist immer `V0`. `<start-zeit>` und `<log-time>` im Format `YYYY-MM-DDThh:mm:ss.fffZ`. Empfehlung der DSFinV-K: Kantenlänge mindestens 3 cm, Druckqualität mindestens 300 dpi, hohes Fehlerkorrekturlevel. Der Public Key muss enthalten sein, die TSE-Seriennummer entfällt aus Platzgründen und wird aus dem Public Key als SHA-256-Octet-String errechnet.
Und der Satz, der für die Nachschau alles entscheidet: „Enthält der Beleg einen QR-Code, kann eine Kassennachschau u. U. bereits beendet sein, wenn die Beleg-Verifikation funktioniert […]. Ist kein QR-Code vorhanden, muss entweder aus dem Aufzeichnungssystem (DSFinV-K) oder aus der TSE (EDS) ein Datenexport vorgenommen werden."
Quelle: DSFinV-K Version 2.4, Seiten 122 bis 124 (lokale Kopie `dsfinvk24.pdf`, Spiegel [kassensichv.com](https://kassensichv.com/downloads/DSFinV-K-Vers-2-4.pdf); die Originalquelle ist das [BZSt](https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv.html), dessen ZIP-Download meine Abrufe blockierte. **Unbestätigt bleibt daher nur die Bitidentität des Spiegels**; der Änderungsnachweis im PDF weist Version 2.4 aus, das deckt sich mit der BZSt-Seite).

### 1c. Der KASSENABSCHLUSS als Datensatz, das ist der heutige „Z-Bon"

DSFinV-K 2.4, Tz. 4.1, wörtlich:

> „Der Kassenabschluss ist die aggregierende Zusammenfassung einer Kasse über alle Einzelbewegungen mit dem Vorgangstyp ‚Beleg' (Geschäftsvorfall) für einen bestimmten Zeitraum […]
> Ziel des Kassenabschlusses: Der Kassenabschluss stellt die Möglichkeit dar, den gezählten Bargeldbestand einer Kasse rechnerisch abzubilden. […] Die Summen können kalendertagsübergreifend entstehen."

**Pflichtinhalt, einzeln aufgelistet, mit den amtlichen Feldnamen:**

*Schlüsselfelder (in JEDER Tabelle):*
1. `Z_KASSE_ID` (Zeichen, 50), eindeutige ID der Abschlusskasse
2. `Z_ERSTELLUNG` (Zeichen, 30), Zeitstempel der Erstellung, ISO 8601 / RFC 3339
3. `Z_NR` (numerisch, 0 Dezimalstellen). Wörtlich: „Jede Kasse besitzt eine `Z_NR`, eine Kassenabschlussnummer. Diese ist **aufsteigend, fortlaufend und nicht zurücksetzbar**." Das ist der gesetzliche Nachfolger des Nullstellenzählers von 1996.

*Datei `Stamm_Abschluss` (`cashpointclosing.csv`):*
4. `Z_BUCHUNGSTAG`, falls abweichend vom Erstellungstag
5. `TAXONOMIE_VERSION`, die verwendete DSFinV-K-Version
6. `Z_START_ID`, Vorgangs-ID des ersten einfließenden Vorgangs
7. `Z_ENDE_ID`, Vorgangs-ID des letzten einfließenden Vorgangs
8. `NAME`, `STRASSE`, `PLZ`, `ORT`, `LAND` (ISO 3166 ALPHA-3, also `DEU`)
9. `STNR` oder `USTID`. Wörtlich: „Es muss entweder die Steuernummer oder die Umsatzsteuer-Identifikationsnummer (§ 27a UStG) des Unternehmens angegeben werden (§ 14 Abs. 4 Nr. 2 UStG)."
10. `Z_SE_ZAHLUNGEN`, Summe der Beträge aller Zahlarten
11. `Z_SE_BARZAHLUNGEN`, in Basiswährung umgerechnete Summe der Zahlart „Bar"

*Datei `Z_GV_TYP` (`businesscases.csv`), je Geschäftsvorfalltyp:*
12. `GV_TYP`, `GV_NAME`, `AGENTUR_ID`, `UST_SCHLUESSEL`, `Z_UMS_BRUTTO`, `Z_UMS_NETTO`, `Z_UST`

*Datei `Z_Zahlart` (`payment.csv`):*
13. `ZAHLART_TYP`, `ZAHLART_NAME`, `Z_ZAHLART_BETRAG`

*Datei `Z_Waehrungen` (`cash_per_currency.csv`):*
14. `ZAHLART_WAEH`, `ZAHLART_BETRAG_WAEH`. Wörtlich: „Damit stellt diese Datei eine **jederzeitige Kassensturzfähigkeit** her."

*Weitere Stammdaten pro Abschluss:* `Stamm_Orte`, `Stamm_Kassen` (mit `KASSE_SERIENNR`, `KASSE_SW_BRAND`, `KASSE_SW_VERSION`, `KASSE_BASISWAEH_CODE`, `KEINE_UST_ZUORDNUNG`), `Stamm_Terminals`, `Stamm_Agenturen`, `Stamm_USt`, `Stamm_TSE`.

**Zwei Fallen, die im Bau sofort zuschlagen:**

- DSFinV-K Tz. 3.3, wörtlich: „Um zu gewährleisten, dass die Stammdaten eindeutig dem jeweiligen Kassenabschluss zugeordnet werden können, ist sicher zu stellen, dass **vor einer Stammdaten-Änderung ein Kassenabschluss erfolgt** und erst anschließend wieder neu gebucht wird." Wer Steuersätze, Firmenadresse oder Belegtext ändert, ohne vorher abzuschließen, erzeugt einen unstimmigen Datensatz.
- In `KASSE_SERIENNR` dürfen weder Schrägstrich noch Unterstrich vorkommen (DSFinV-K, Anhang E, Datei `Stamm_Kassen`).

**Für einen Gold- und Edelmetallladen entscheidend:** DSFinV-K Tz. 3.2.6, wörtlich: „Ab der ‚ID' = 1000 können besondere umsatzsteuerliche Sachverhalte (z. B. **Differenzbesteuerung § 25a UStG**, Sachverhalte des § 13b UStG) kenntlich gemacht werden. Diese Sachverhalte müssen durch die Kassenhersteller bzw. Kassenhändler individuell angelegt werden." Der `UST_SCHLUESSEL` für Differenzbesteuerung ist also **selbst zu definieren, ab 1000, und in der Verfahrensdokumentation zu erläutern**. Es gibt dafür keinen amtlich vergebenen Schlüssel.

**Und die Geschäftsvorfalltypen, die das Kassenbuch tragen** (DSFinV-K, Anhang C): `Umsatz`, `Anfangsbestand`, `Privatentnahme`, `Privateinlage`, `Geldtransit`, `Lohnzahlung`, `Einzahlung`, `Auszahlung`, `DifferenzSollIst`, dazu `Rabatt`, `Aufschlag`, `Forderungsentstehung`, `Forderungsaufloesung`, `Anzahlungseinstellung`, `Anzahlungsaufloesung`, die vier Gutschein-Typen, `Pfand`, `TrinkgeldAG`, `TrinkgeldAN`. Wörtlich zum Anfangsbestand: „Wird im Rahmen des vorhergehenden Kassenabschlusses das Bargeld vollständig entnommen, beträgt der Anfangsbestand 0,00 in der Basiswährung. Das Auffüllen des Bargeldbestandes ist über den Geschäftsvorfalltyp ‚Geldtransit' zu erfassen."

### 1d. Warum der Export für JEDEN Zeitraum technisch sauber geht

Weil jede Zeile in jeder CSV-Datei die Schlüssel `Z_KASSE_ID`, `Z_ERSTELLUNG`, `Z_NR` trägt, ist ein Zeitraum-Export schlicht die Menge aller Kassenabschlüsse, deren `Z_ERSTELLUNG` bzw. `Z_BUCHUNGSTAG` im Bereich liegt, zusammengefasst in einem CSV-Satz mit **einer** beschreibenden `index.xml`. Die Regeln für die `index.xml` stehen in der Anlage zu den GoBD (Fassung 11.03.2024), wörtlich: „Die Felder (Spalten) müssen in jeder zur Verfügung gestellten csv-Datei in der beschriebenen Reihenfolge enthalten sein. In jeder csv-Datei soll ein Kopfdatensatz mit den Bezeichnungen des Feldnamens vorangestellt werden. Darüber hinaus ist eine beschreibende index.xml-Datei beizufügen." Abweichungen (kein Kopfdatensatz, anderer Feldtrenner als Semikolon, anderes Dezimaltrennzeichen als Komma, anderer Zeilenumbruch als CRLF, andere Texteinschlusszeichen als Anführungszeichen) sind in der `index.xml` anzupassen.
Quelle: BMF-Schreiben 11.03.2024, GZ IV D 2 - S 0316/21/10001 :002, Anlage Nr. 1.4 (lokale Kopie `gobd2024.pdf`).

---

## 2. Kassenbericht, Kassenbuch, Z-Bon, Zählprotokoll: Pflicht oder Kür

Grundlage ist der **AEAO zu § 146 AO** in der Fassung des BMF-Schreibens vom 19.06.2018, GZ IV A 4 - S 0316/13/10005 :053 (lokale Kopie `aeao146_2018.pdf`, [Spiegel bvl-verband.de](https://www.bvl-verband.de/fileadmin/steuerpolitik/bmf-schreiben/2018/2018-06-19-aenderung-anwendungserlass-abgabenordnung-Einzelaufzeichnungspflicht.pdf)).
*Einschränkung, ehrlich benannt:* Die konsolidierte Fassung im amtlichen AO-Handbuch des BMF (`ao.bundesfinanzministerium.de`) konnte ich nicht gegenlesen, dort steht eine Radware-Bot-Sperre. **Unbestätigt bleibt, ob der AEAO zu § 146 seit 19.06.2018 nochmals geändert wurde.** Vor einer Werbeaussage gegenüber einem Steuerberater bitte gegenprüfen.

| Instrument | Rechtsgrundlage | Pflicht? | Wann |
|---|---|---|---|
| **Kassenbuch** | AEAO zu § 146, Nr. 1.4: „Buchführungspflichtige Steuerpflichtige haben für Bargeldbewegungen ein Kassenbuch (ggf. in der Form aneinandergereihter Kassenberichte) zu führen." | **Pflicht bei Buchführungspflicht** (§§ 140, 141 AO, §§ 238 ff. HGB). **Keine Pflicht bei Gewinnermittlung nach § 4 Abs. 3 EStG** (BFH, Beschluss vom 16.02.2006, X B 57/05: bei der Einnahmenüberschussrechnung gibt es kein Bestandskonto und damit kein Kassenkonto) | laufend |
| **Kassenbericht** | AEAO zu § 146, Nr. 3.3 | **Nur Ersatz bei offener Ladenkasse ohne Einzelaufzeichnungspflicht.** Bei elektronischem Aufzeichnungssystem gegenstandslos | täglich |
| **Z-Bon / Tagesendsummenbon** | keine geltende Norm. Rechtsgrundlage seit Aufhebung des BMF 09.01.1996 entfallen | **Kein gesetzlich vorgeschriebener Inhalt.** Der geltende Nachfolger ist der **Kassenabschluss** nach DSFinV-K | mindestens einmal je Abrechnungszeitraum |
| **Zählprotokoll** | AEAO zu § 146, Nr. 3.3 Satz 5, wörtlich: „Ein sogenanntes ‚Zählprotokoll' (Auflistung der genauen Stückzahl vorhandener Geldscheine und -münzen) **ist nicht erforderlich** (BFH-Beschluss vom 16.12.2016, X B 41/16, BFH/NV 2017 S. 310), erleichtert jedoch den Nachweis des tatsächlichen Auszählens." | **Kür.** Beweisvorteil, keine Pflicht | bei jedem Auszählen |

**Die Formel des Kassenberichts, wörtlich aus AEAO zu § 146, Nr. 3.3:**

> „Hierbei ist stets vom **gezählten Kassenendbestand** des jeweiligen Geschäftstages auszugehen. Von diesem Kassenendbestand werden der Kassenendbestand bei Geschäftsschluss des Vortages sowie die durch Eigenbeleg zu belegenden Bareinlagen abgezogen. Ausgaben und durch Eigenbeleg nachzuweisende Barentnahmen sind hinzuzurechnen."

Also: Tageslosung = Kassenendbestand heute − Kassenendbestand gestern − Bareinlagen + Ausgaben + Barentnahmen. **Retrograd, nicht progressiv.** Wer das umgekehrt rechnet, baut keinen Kassenbericht.

**Die Trennung bar / unbar** (GoBD Rz. 55, wörtlich): „Eine kurzzeitige gemeinsame Erfassung von baren und unbaren Tagesgeschäften im Kassenbuch ist regelmäßig nicht zu beanstanden, wenn die ursprünglich im Kassenbuch erfassten unbaren Tagesumsätze (z. B. EC-Kartenumsätze) gesondert kenntlich gemacht sind und nachvollziehbar unmittelbar nachfolgend wieder aus dem Kassenbuch auf ein gesondertes Konto aus- bzw. umgetragen werden, soweit die Kassensturzfähigkeit der Kasse weiterhin gegeben ist."

**Rechtlich strittig / beraterabhängig:** Ob der Laden trotz vollelektronischer Kasse zusätzlich ein förmliches Kassenbuch führt, hängt an der Gewinnermittlungsart und an der Haltung des Beraters. Viele Berater verlangen es auch beim Einnahmenüberschussrechner, weil es die Kassensturzfähigkeit dokumentiert; rechtlich erzwingbar ist es dort nach BFH X B 57/05 nicht. **Die Anlage sollte beides können und die Wahl dem Berater lassen.**

---

## 3. Kassensturzfähigkeit

**Definition, amtlich, AEAO zu § 146b, Nr. 1, wörtlich:**

> „Der Amtsträger kann u.a. zur Prüfung der ordnungsgemäßen Kassenaufzeichnungen einen sog. ‚Kassensturz' verlangen, da die **Kassensturzfähigkeit (Soll-Ist-Abgleich) ein wesentliches Element der Nachprüfbarkeit von Kassenaufzeichnungen jedweder Form** darstellt (vgl. BFH-Urteile vom 20.9.1989, X R 39/87, BStBl 1990 II S. 109; vom 26.8.1975, VIII R 109/70, BStBl 1976 II S. 210; vom 31.7.1974, I R 216/72, BStBl 1975 II S. 96; vom 31.7.1969, IV R 57/67, BStBl 1970 II S. 125). Ob ein Kassensturz verlangt wird, ist eine Ermessensentscheidung."

Der Maßstab aus AEAO zu § 146, Nr. 3.4 letzter Satz: „Kassenaufzeichnungen müssen so beschaffen sein, dass ein **sachverständiger Dritter jederzeit** in der Lage ist, den **Sollbestand mit dem Istbestand** der Geschäftskasse zu vergleichen (BFH-Urteil vom 20.9.1989, X R 39/87, BStBl 1990 II S. 109)."

**Wie der Prüfer sie prüft** (ZDH-Arbeitshilfe „Vorbereitung auf eine Kassen-Nachschau", Stand 2024, Kapitel „Thema: Kassensturz", lokale Kopie `zdh_nachschau.pdf`, [Fundstelle hwkhalle.de](https://www.hwkhalle.de/wp-content/uploads/20240506_05-07_Anl-2_RSIV202409_Arbeitshilfe_Kassen_Nachschau_FAQ.pdf)): Er lässt die Kasse **im laufenden Betrieb** auszählen und vergleicht mit dem rechnerischen Soll. Typische Ursachen von Differenzen, die er sucht: fehlerhafte Erfassung barer und unbarer Zahlungen, Trinkgelder, Privatentnahmen und Privateinlagen, Wechselgeldfehler, verletzte Tagespflicht, Diebstahl. Besonderes Augenmerk liegt auf **untertägigen Kassenfehlbeträgen**; geringe Differenzen im laufenden Betrieb sind unschädlich.

**Bauanforderung, die daraus zwingend folgt:** Die Anlage muss **zu jedem Zeitpunkt, nicht erst beim Abschluss**, einen Sollbestand Bar ausweisen können. Genau dafür existiert in der DSFinV-K die Datei `Z_Waehrungen`. Ohne laufenden Sollbestand ist der Laden bei einem Kassensturz um 14 Uhr wehrlos.

---

## 4. § 146b AO Kassennachschau: Ablauf, Verlangen, Format, Tempo

**Gesetzestext**, abgerufen bei [gesetze-im-internet.de, § 146b AO](https://www.gesetze-im-internet.de/ao_1977/__146b.html): Betreten von Geschäftsgrundstücken und Geschäftsräumen **ohne vorherige Ankündigung und außerhalb einer Außenprüfung**, während der üblichen Geschäfts- und Arbeitszeiten; erfasst ist ausdrücklich auch „der ordnungsgemäße Einsatz des elektronischen Aufzeichnungssystems nach § 146a Absatz 1". Abs. 2: Vorlage von Aufzeichnungen, Büchern und den für die Kassenführung erheblichen sonstigen Organisationsunterlagen; bei elektronischen Unterlagen Einsichtnahme oder Übermittlung. „Die Kosten trägt der Steuerpflichtige." Abs. 3: Übergang zur Außenprüfung ohne Prüfungsanordnung, mit schriftlichem Hinweis.

**Der Ablauf in neun Schritten, aus dem AEAO zu § 146b (BMF vom 29.05.2018, GZ IV A 4 - S 0316/13/10005 :054, lokale Kopie `aeao146b.pdf`):**

1. **Vorher, verdeckt:** „Eine Beobachtung der Kassen und ihrer Handhabung in Geschäftsräumen, die der Öffentlichkeit zugänglich sind, ist **ohne Pflicht zur Vorlage eines Ausweises** zulässig. Dies gilt z.B. auch für **Testkäufe** und Fragen nach dem Geschäftsinhaber. Die Kassen-Nachschau muss nicht am selben Tag wie die Beobachtung erfolgen." (Nr. 4)
2. **Ausweispflicht** entsteht erst, sobald der Amtsträger nicht öffentliche Räume betreten, das System zugänglich gemacht bekommen, Unterlagen vorgelegt bekommen, Einsicht in digitale Daten oder deren Übermittlung verlangen oder Auskunft fordern will (Nr. 4).
3. **Ist der Inhaber abwesend**, richtet sich die Aufforderung an Personen, „von denen angenommen werden kann, dass sie über alle wesentlichen Zugriffs- und Benutzungsrechte des Kassensystems verfügen" (§ 35 AO). (Nr. 4)
4. **Die Aufforderung ist ein formloser Verwaltungsakt**, „z.B. mündlich mit Vorzeigen des Ausweises". Danach besteht Mitwirkungspflicht. (Nr. 5)
5. **Kassensturz** auf Verlangen (Nr. 1).
6. **Datenzugriff**, Nr. 5 wörtlich: „Nach dem 31.12.2019 sind die digitalen Aufzeichnungen **über die digitale Schnittstelle oder auf einem maschinell auswertbaren Datenträger nach den Vorgaben der digitalen Schnittstelle** zur Verfügung zu stellen." Zeitraum: „für einen **vom Amtsträger bestimmten Zeitraum**".
7. **Organisationsunterlagen**, Nr. 5 wörtlich: „Auf Anforderung des Amtsträgers sind die **Verfahrensdokumentation** zum eingesetzten Aufzeichnungssystem einschließlich der Informationen zur zertifizierten technischen Sicherheitseinrichtung vorzulegen, d.h. es sind **Bedienungsanleitungen, Programmieranleitungen und Datenerfassungsprotokolle über durchgeführte Programmänderungen** vorzulegen."
8. **Dokumentation:** „Zu Dokumentationszwecken ist der Amtsträger berechtigt, Unterlagen und Belege zu **scannen oder zu fotografieren**." (Nr. 6)
9. **Übergang zur Außenprüfung**, Nr. 6 wörtlich: „Anlass zur Beanstandung kann beispielsweise auch bestehen, wenn Dokumentationsunterlagen wie aufbewahrungspflichtige Betriebsanleitung oder **Protokolle nachträglicher Programmänderungen nicht vorgelegt werden können**." Beginn ist „unter Angabe von Datum und Uhrzeit aktenkundig zu machen"; der schriftliche Übergangshinweis ersetzt die Prüfungsanordnung.

**Was der Prüfer vor Ort konkret zieht** (ZDH-Arbeitshilfe, Kapitel „Sicherstellung des Datenzugriffsrechts"), vier Prüfungssegmente:
- Belegprüfung, bei QR-Code durch Scannen;
- Datenzugriff auf die **DSFinV-K-Daten**;
- Datenzugriff auf die **TAR-Archivdatei** der TSE (unverschlüsselt, unkomprimiert, Exportschnittstelle nach BSI TR-03153-1 Kapitel 5.2);
- Datenzugriff auf die Einzeldaten des Systems.
Prüfsoftware: **AmadeusVerify** (validiert eingescannten QR-Code, importierten elektronischen Beleg als PDF mit eingebettetem JSON, alle Anwendungsdaten einer TAR-Archivdatei, erste Prüfschritte der DSFinV-K-Daten, und den **Abgleich zwischen TAR-Datei und DSFinV-K-Datensätzen**), danach **IDEA** für die Tiefe, teils Power BI zur Visualisierung.

**Wie schnell?** Das Gesetz nennt keine Frist. Die ZDH-Arbeitshilfe: Der Prüfer kann die **unverzügliche**, also ohne schuldhaftes Zögern erfolgende Vorlage verlangen; was unverzüglich ist, hängt vom Einzelfall ab. **Praktische Bauanforderung: der Export muss in Minuten fertig sein, an der Kasse, ohne Steuerberater und ohne Hersteller.**

**Prüfungszeitraum: rechtlich ungeklärt.** Die ZDH-Arbeitshilfe, wörtlich: „Der Prüfungszeitraum ist gesetzlich nicht geregelt. Auch in der Literatur finden sich unterschiedliche Auffassungen […]. Die Dauer eines ertragsteuerlichen Veranlagungszeitraums von einem Jahr sollte nicht überschritten werden." Das ist Literaturmeinung (Schumann, AO-StB 2018, 246; Bleschik, DB 2018, 2395), **keine amtliche Aussage**. Genau deshalb muss der Export **jeden beliebigen Zeitraum** können, nicht nur einen Tag und nicht nur ein Jahr.

**Rechtsfolgen-Detail, das oft übersehen wird** (AEAO zu § 146b, Nr. 7 und 8): Die Nachschau ist keine Außenprüfung, § 147 Abs. 6 AO gilt dort **nicht**, ein Prüfungsbericht wird nicht gefertigt, die Festsetzungsfrist wird nicht gehemmt, und ein Antrag auf verbindliche Zusage nach § 204 AO ist danach unzulässig.

---

## 5. Datenzugriff Z1, Z2, Z3

**Gesetz, § 147 Abs. 6 Satz 1 AO** (Fassung seit dem Gesetz zur Modernisierung des Steuerverfahrensrechts vom 20.12.2022, BGBl I S. 2730), abgerufen bei [gesetze-im-internet.de](https://www.gesetze-im-internet.de/ao_1977/__147.html):

> „1. Einsicht in die gespeicherten Daten nehmen und das Datenverarbeitungssystem zur Prüfung dieser Unterlagen nutzen,
> 2. verlangen, dass die Daten nach ihren Vorgaben maschinell ausgewertet zur Verfügung gestellt werden, oder
> 3. verlangen, dass die Daten nach ihren Vorgaben **in einem maschinell auswertbaren Format an sie übertragen werden**."

**GoBD-Auslegung, Rz. 163 bis 170** (GoBD 28.11.2019, lokale Kopie `gobd2019.pdf`; Rz. 167 bis 169 neu gefasst durch BMF 11.03.2024):

| Stufe | Name | Wortlaut der Kernaussage | Was die Anlage können muss |
|---|---|---|---|
| **Z1** | Unmittelbarer Datenzugriff | Rz. 165: „in Form des **Nur-Lesezugriffs** Einsicht […] und die […] eingesetzte Hard- und Software zur Prüfung der gespeicherten Daten einschließlich der jeweiligen Meta-, Stamm- und Bewegungsdaten sowie der entsprechenden Verknüpfungen […] nutzt. […] Dies schließt eine **Fernabfrage (Online-Zugriff)** der Finanzbehörde […] **aus**." Rz. 174: Der Steuerpflichtige muss einweisen, die Zugangsberechtigung muss alle aufzeichnungs- und aufbewahrungspflichtigen Daten umfassen, samt Filtern, Sortieren, Konsolidieren. „Eine Volltextsuche, eine Ansichtsfunktion oder ein selbsttragendes System, das […] nur die […] Schlagworte als Indexwerte nachweist, **reicht regelmäßig nicht aus**." | Ein echter Prüfer-Lesezugang mit Filter, Sortierung, Summierung. Kein Fernzugriff. Unveränderbarkeit während des Zugriffs garantiert |
| **Z2** | Mittelbarer Datenzugriff | Rz. 166: „dass er **an ihrer Stelle** die […] Daten **nach ihren Vorgaben maschinell auswertet** […]. Es kann nur eine maschinelle Auswertung unter Verwendung der im DV-System […] vorhandenen Auswertungsmöglichkeiten verlangt werden." | Ad-hoc-Auswertungen nach fremder Vorgabe, mit geschultem Personal |
| **Z3** | **Datenüberlassung** (bis 11.03.2024 „Datenträgerüberlassung") | Rz. 167 n.F.: „[…] **in einem maschinell lesbaren und auswertbaren Format zur Auswertung überlassen** werden. Dies kann z. B. auf einem Datenträger oder durch Zurverfügungstellung der Daten über eine **Datenaustauschplattform** erfolgen, für die die Finanzbehörde einen Zugang eröffnet hat (§ 87a Absatz 1 AO). Dieses Verlangen kann gem. § 197 Absatz 3 AO mit der Prüfungsanordnung […] bereits vor dem Beginn der Prüfung geltend gemacht werden." | **Der DSFinV-K-Export.** In der Praxis der mit Abstand häufigste Zugriff |

**Grenzen und Pflichten, die den Bau betreffen:**
- Rz. 173: „Mangels Nachprüfbarkeit akzeptiert die Finanzbehörde **keine Reports oder Druckdateien, die vom Unternehmen ausgewählte (‚vorgefilterte') Datenfelder und -sätze aufführen**, jedoch nicht mehr alle […] Daten enthalten." Ein hübscher PDF-Bericht ist kein Export.
- Rz. 161, Beispiel 12, erstes Tiret, wörtlich das Negativbeispiel: „Ein Steuerpflichtiger stellt aus dem PC-Kassensystem **nur Tagesendsummen** zur Verfügung. Die digitalen Grund(buch)aufzeichnungen (Kasseneinzeldaten) wurden archiviert, aber nicht zur Verfügung gestellt."
- Rz. 176: Alle Strukturinformationen in maschinell auswertbarer Form. „Das Einlesen der Daten muss **ohne Installation von Fremdsoftware** auf den Rechnern der Finanzbehörde möglich sein."
- Rz. 177: „Der Grundsatz der Wirtschaftlichkeit rechtfertigt nicht den Einsatz einer Software, die den […] Anforderungen zur Datenüberlassung nicht oder nur teilweise genügt."
- § 147 Abs. 6 Satz 6 AO und GoBD Rz. 164: Nach Systemwechsel oder Auslagerung genügt **nach Ablauf des fünften Kalenderjahres** nur noch der Z3-Zugriff, sofern die Prüfung noch nicht begonnen hat.
- Von IDEA unterstützte Formate (Anlage zu den GoBD i.d.F. 11.03.2024, Nr. 4): ASCII feste Länge, ASCII Delimited (einschließlich CSV), **Excel nur `xlsx`**, **Access nur `accdb`**, dBASE, SAP/AIS. **Nicht mehr unterstützt** für Zeiträume ab 01.01.2025: EBCDIC fester und variabler Länge, Lotus 123, ASCII-Druckdateien, AS/400-FDF-Konvertierung.

**Die schärfste Norm überhaupt, § 158 Abs. 2 Nr. 2 AO** (Fassung seit 2023): Die Beweiskraft der Buchführung entfällt, „soweit die elektronischen Daten nicht nach der Vorgabe der einheitlichen digitalen Schnittstellen des […] § 146a […] zur Verfügung gestellt werden." Das heißt im Klartext: **auch bei formell und materiell völlig richtiger Buchführung** eröffnet ein fehlender oder fehlerhafter DSFinV-K-Export die Schätzungsbefugnis nach § 162 Abs. 2 Satz 2 AO. Der Export **ist** die Compliance.

---

## 6. Verfahrensdokumentation

**Norm: GoBD Rz. 151 bis 155, wörtlich (gekürzt):**

> Rz. 151: „[…] muss für jedes DV-System eine **übersichtlich gegliederte Verfahrensdokumentation** vorhanden sein, aus der Inhalt, Aufbau, Ablauf und Ergebnisse des DV-Verfahrens vollständig und schlüssig ersichtlich sind. […] Die Verfahrensdokumentation muss verständlich und damit für einen **sachverständigen Dritten in angemessener Zeit nachprüfbar** sein."
> Rz. 153: „Die Verfahrensdokumentation besteht in der Regel aus einer **allgemeinen Beschreibung, einer Anwenderdokumentation, einer technischen Systemdokumentation und einer Betriebsdokumentation**."
> Rz. 154: „Für den Zeitraum der Aufbewahrungsfrist muss gewährleistet und nachgewiesen sein, dass das in der Dokumentation beschriebene Verfahren dem in der Praxis eingesetzten Verfahren **voll entspricht**. Dies gilt insbesondere für die eingesetzten Versionen der Programme (**Programmidentität**). Änderungen einer Verfahrensdokumentation müssen historisch nachvollziehbar sein. Dem wird genügt, wenn die Änderungen **versioniert** sind und eine nachvollziehbare Änderungshistorie vorgehalten wird. […] Die Aufbewahrungsfrist für die Verfahrensdokumentation läuft nicht ab, soweit und solange die Aufbewahrungsfrist für die Unterlagen noch nicht abgelaufen ist, zu deren Verständnis sie erforderlich ist."

**Was speziell für die Kassenführung hinein gehört** (ZDH-Arbeitshilfe, Kapitel „Verfahrensdokumentation und Internes Kontrollsystem"):
- Aufbau, Funktion und Inhalt der Stammdaten: Grund- und Systemeinstellungen, Artikel-, Waren-, Hauptgruppen und deren Änderungen, Bediener- und Berechtigungsübersichten, Steuersätze und Modifier, Berichtswesen, Beschreibung des elektronischen Journals bzw. Datenerfassungsprotokolls
- Eingabemöglichkeiten und Ablage im System: Datenbankart, Tabellen, Prozeduren
- interne Programmabläufe (Routinen)
- **Programmänderungen** einschließlich Customizing
- **Nachweis für die Zertifikate der TSE**
- **Anleitung für die Durchführung des Datenexports**
- Dokumentation von Ausfällen des Systems oder der TSE (AEAO zu § 146a, Nr. 1.14: „Ausfallzeiten und -grund einer TSE sind zu dokumentieren", „muss dieser Ausfall auf einem eventuellen Beleg ersichtlich sein", z.B. durch fehlende Transaktionsnummer)
- **Kassieranweisung** als Teil des internen Kontrollsystems: Schutz vor Trickbetrug und Falschgeld, Sicherung bei Kartenzahlung, **Berechtigung zur Stornobuchung**, Anfertigung des Tagesabschlusses, Vier-Augen-Prinzip, Warenbestandskontrollen
- Dokumentation eigener freiwilliger Testkäufe zur Kontrolle der Belegausgabe
- DSFinV-K Tz. 3.2.6: die **individuell ab ID 1000 angelegten Umsatzsteuerschlüssel**, also der Differenzbesteuerungsschlüssel, sind „in den entsprechenden Systembeschreibungen bzw. Verfahrensdokumentationen zu dokumentieren"
- DSFinV-K Tz. 2.3: nutzt das System keine fortlaufenden Vorgangs-IDs, „so ist **in der Verfahrensdokumentation zu erläutern**, wie die Vollständigkeit der aufzeichnungs- und aufbewahrungspflichtigen Daten überprüfbar gewährleistet wird"

Der DFKA (Deutscher Fachverband für Kassen- und Abrechnungssystemtechnik) stellt eine Muster-Verfahrensdokumentation kostenlos bereit (Hinweis in der ZDH-Arbeitshilfe).

### Was passiert, wenn sie fehlt: hier widersprechen sich die Quellen, und das muss man wissen

- **Entlastend, amtlich, GoBD Rz. 155 wörtlich:** „Soweit eine fehlende oder ungenügende Verfahrensdokumentation die Nachvollziehbarkeit und Nachprüfbarkeit **nicht beeinträchtigt, liegt kein formeller Mangel mit sachlichem Gewicht vor**, der zum Verwerfen der Buchführung führen kann."
- **Belastend, höchstrichterlich, BFH-Urteil vom 25.03.2015, X R 20/13, BStBl II 2015, 743:** Das Fehlen der aufbewahrungspflichtigen Programmierprotokolle bei einem programmierbaren Kassensystem ist ein formeller Mangel, der jedenfalls bei bargeldintensiven Betrieben für sich genommen zur Hinzuschätzung berechtigt, wenn eine Manipulation nicht ausgeschlossen werden kann. Bedienungs- und Programmieranleitungen sowie Protokolle nachträglicher Änderungen unterliegen § 147 Abs. 1 Nr. 1 AO. Das Gewicht kann sinken, wenn der Steuerpflichtige im Einzelfall darlegt, dass die Kasse trotz Programmierbarkeit keine Manipulation zulässt.
- **Gegenposition der Instanz, Sächsisches Finanzgericht, Beschluss vom 28.09.2022, 1 V 864/21:** „Eine fehlende oder ungenügende Verfahrensdokumentation stellt nicht ohne weiteres einen Verstoß gegen die Vorschriften dar"; bloße Unwahrscheinlichkeiten genügen nicht.
- **Andere Instanz, gegenteilig:** FG Düsseldorf, Urteil vom 11.06.2024, 11 K 2308/19 U, sowie FG Münster, halten Hinzuschätzung bei fehlenden Kassendaten und fehlender Verfahrensdokumentation für zulässig.

**Näher an der amtlichen Stelle sind GoBD Rz. 155 und der BFH.** Das sächsische Verfahren war ein Aussetzungsbeschluss, also nur eine summarische Prüfung, und hat entsprechend geringeres Gewicht. Die praktisch belastbare Aussage lautet: **allein die fehlende Verfahrensdokumentation trägt die Schätzung nicht, aber sie verschlechtert die Lage dramatisch, sobald irgendein weiterer formeller Mangel dazukommt** und sie kostet den Übergang von der Nachschau zur Außenprüfung (AEAO zu § 146b, Nr. 6). Ob im Einzelfall ein Verwerfen droht, ist eine Wertungsfrage, die Berater und Prüfer unterschiedlich beantworten.

---

## 7. Welche Mängel in der Praxis zur Hinzuschätzung führen

Rechtsgrundlagen der Schätzung: § 158 Abs. 2 AO (Wegfall der Beweiskraft), § 162 Abs. 1 und Abs. 2 Satz 2 AO. Bußgeld daneben nach § 379 Abs. 1 Satz 1 Nr. 3 bis 7 AO, **bis 25.000 Euro** (§ 379 Abs. 6 AO), Nr. 4 und 5 betreffen ausdrücklich die nicht richtige Verwendung bzw. den nicht richtigen Schutz eines Systems nach § 146a Abs. 1 AO. AEAO zu § 146a, Nr. 1.19.4: Bei Feststellung eines Verstoßes „soll die für Straf- und Bußgeldsachen zuständige Stelle unterrichtet werden."

**Die häufigsten Mängel, jeweils mit Beleg:**

1. **Stornierungen werden im Tagesabschluss nicht ausgewiesen.**
 BFH, Urteil vom 29.07.2025, X R 23-24/21, ECLI:DE:BFH:2025:U.290725.XR23.21.0, **Leitsatz 1 wörtlich**: „Ein formeller Buchführungsmangel, der eine Schätzungsbefugnis nach § 162 der Abgabenordnung (AO) begründet, kann nach der höchstrichterlichen Rechtsprechung auch dann vorliegen, wenn ein Kassensystem Stornierungen zulässt und diese **systembedingt in den Tagesabschlüssen oder in den Z-Bons nicht ausgewiesen werden**."
 [Fundstelle bundesfinanzhof.de](https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/pdf/STRE202520320?type=1646225765). **Das ist die einzelne wichtigste Bauanforderung an den Abschluss.**
2. **Fehlende Programmierprotokolle und Organisationsunterlagen.** BFH, 25.03.2015, X R 20/13, BStBl II 2015, 743.
3. **Nur Tagesendsummen statt Einzeldaten geliefert.** GoBD Rz. 161, Beispiel 12.
4. **Elektronische Daten nicht über die vorgeschriebene Schnittstelle bereitgestellt.** § 158 Abs. 2 Nr. 2 AO. Wirkt unabhängig von inhaltlicher Richtigkeit.
5. **Kassensturzfähigkeit nicht gegeben, Kassenfehlbeträge.** AEAO zu § 146b Nr. 1 mit BFH X R 39/87, BStBl 1990 II S. 109.
6. **Tageskasse nicht täglich festgehalten.** § 146 Abs. 1 Satz 2 AO, GoBD Rz. 48, AEAO zu § 146 Nr. 3.4 (Ausnahme nur bei zwingenden geschäftlichen Gründen, BFH 31.07.1974, I R 216/72, BStBl 1975 II S. 96).
7. **Verdichtung oder Formatverlust.** GoBD Rz. 129: „Die Reduzierung einer bereits bestehenden maschinellen Auswertbarkeit […] ist nicht zulässig", ausdrückliches Beispiel: „Umwandlung von elektronischen Grund(buch)aufzeichnungen (z. B. Kasse, Warenwirtschaft) in ein PDF-Format." Ebenso § 3 Abs. 4 KassenSichV und AEAO zu § 146a Nr. 1.15.4.
8. **Nicht getrennte Aufzeichnung von steuerfreien, nicht steuerbaren und steuerpflichtigen Umsätzen.** GoBD Rz. 55, § 22 UStG. Für einen Edelmetallhändler mit Regelbesteuerung, Differenzbesteuerung und ggf. steuerfreien Anlagegoldumsätzen nach § 25c UStG ist das der wahrscheinlichste materielle Angriffspunkt.

**Die Gegenbewegung 2025, die man kennen muss:** BFH, Urteil vom 18.06.2025, X R 19/21. Der X. Senat äußert **erhebliche Zweifel an der Eignung der amtlichen Richtsatzsammlung** in ihrer bisherigen Form (Betriebsauswahl nicht nach statistischen Zufallskriterien, Ausschluss von Verlustbetrieben, fehlende Einzelfallbegründung). Und aus X R 23-24/21, Leitsätze 2 bis 4 wörtlich: „Im Rahmen der Ermessensausübung sind tendenziell ungenauere Schätzungsmethoden gegenüber genaueren Schätzungsmethoden **nachrangig**. In der Regel ist der **innere Betriebsvergleich** im Verhältnis zum äußeren Betriebsvergleich als die **zuverlässigere Schätzungsmethode** anzusehen." Und: „FA und FG müssen das Ergebnis ihrer Schätzung nachvollziehbar begründen."

**Bauimplikation daraus, und sie ist stark:** Wer aus der eigenen Anlage einen sauberen inneren Betriebsvergleich liefern kann, also Rohgewinnaufschlag je Warengruppe, je Zeitraum, aus Einzeldaten, entzieht der Schätzung nach Richtsätzen die Grundlage. Das ist genau die Stelle, an der eine Edelmetall-Anlage mit vollständiger Einzelartikel- und Ankaufhistorie einen echten, verteidigungsfähigen Vorteil hat.

---

## 8. Aufbewahrung und maschinelle Auswertbarkeit

**Fristen, § 147 Abs. 3 Satz 1 AO** (Wortlaut abgerufen 26.07.2026):

> „Die in Absatz 1 Nummer 1 und 4a aufgeführten Unterlagen sind **zehn Jahre**, die in Absatz 1 Nummer 4 aufgeführten Unterlagen **acht Jahre** und die sonstigen in Absatz 1 aufgeführten Unterlagen **sechs Jahre** aufzubewahren."

Also: Bücher, Aufzeichnungen, Inventare, Jahresabschlüsse, **Arbeitsanweisungen und sonstige Organisationsunterlagen** zehn Jahre. **Buchungsbelege acht Jahre** (verkürzt von zehn auf acht durch das Vierte Bürokratieentlastungsgesetz, wirksam ab 01.01.2025, anwendbar auf alle Belege, deren Frist am 31.12.2024 noch nicht abgelaufen war). Übrige Unterlagen sechs Jahre.
§ 147 Abs. 3 Satz 5 AO: „Die Aufbewahrungsfrist läuft jedoch nicht ab, soweit und solange die Unterlagen für Steuern von Bedeutung sind, für welche die **Festsetzungsfrist noch nicht abgelaufen** ist." § 147 Abs. 4 AO: Fristbeginn mit Schluss des Kalenderjahres der letzten Eintragung bzw. der Belegentstehung.

**Achtung, die Verfahrensdokumentation ist eine „Organisationsunterlage" nach § 147 Abs. 1 Nr. 1 AO**, also zehn Jahre, und nach GoBD Rz. 154 sogar so lange, wie die Unterlagen aufzubewahren sind, zu deren Verständnis sie erforderlich ist.

**Form, § 147 Abs. 2 AO wörtlich:** Wiedergabe auf Bildträger oder anderen Datenträgern ist zulässig, wenn sichergestellt ist, dass die Daten
> „1. mit den empfangenen Handels- oder Geschäftsbriefen und den Buchungsbelegen **bildlich** und mit den anderen Unterlagen **inhaltlich** übereinstimmen, wenn sie lesbar gemacht werden,
> 2. während der Dauer der Aufbewahrungsfrist **jederzeit verfügbar** sind, **unverzüglich lesbar** gemacht und **maschinell ausgewertet** werden können."

Neu seit dem GoBD-Änderungsschreiben vom **14.07.2025** (GZ IV D 2 - S 0316/00128/005/088, lokale Kopie `gobd2025.pdf`), Rz. 118 wörtlich: „Werden Buchungsbelege, Handels- oder Geschäftsbriefe in Form eines strukturierten Datensatzes (bspw. als E-Rechnungen) empfangen, bedarf es abweichend zu § 147 Absatz 2 Nr. 1 AO **keiner bildlichen, sondern nur einer inhaltlichen Übereinstimmung**." Und Rz. 119: Bei E-Rechnungen genügt die Aufbewahrung des strukturierten Teils; der menschenlesbare Teil einer Hybridrechnung nur, wenn er zusätzliche oder abweichende besteuerungserhebliche Informationen enthält.
[Fundstelle bundesfinanzministerium.de](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.pdf).

**„Maschinelle Auswertbarkeit", die amtliche Definition, GoBD Rz. 126 und 127 wörtlich:**

> Rz. 126: gegeben u.a. bei Daten, die „mathematisch-technische Auswertungen ermöglichen", „eine Volltextsuche ermöglichen", „auch ohne mathematisch-technische Auswertungen eine Prüfung im weitesten Sinne ermöglichen (z. B. Bildschirmabfragen, die Nachverfolgung von Verknüpfungen und Verlinkungen oder die Textsuche nach bestimmten Eingabekriterien)".
> Rz. 127: „Mathematisch-technische Auswertung bedeutet, dass alle […] enthaltenen Informationen automatisiert (DV-gestützt) interpretiert, dargestellt, verarbeitet sowie für andere Datenbankanwendungen und eingesetzte Prüfsoftware **direkt, ohne weitere Konvertierungs- und Bearbeitungsschritte und ohne Informationsverlust** nutzbar gemacht werden können (z. B. für wahlfreie **Sortier-, Summier-, Verbindungs- und Filterungsmöglichkeiten**)."
> Rz. 128: Auch **alle Strukturinformationen** (Dateiherkunft, Dateistruktur, Datenfelder, Zeichensatztabellen) sowie interne und externe Verknüpfungen sind „vollständig und in **unverdichteter**, maschinell auswertbarer Form aufzubewahren".

**Speziell die TSE-Daten**, AEAO zu § 146a, Nr. 1.15.2: Überführung der abgesicherten Anwendungsdaten aus der TSE in ein Aufbewahrungssystem ist zulässig, sofern dieses den späteren Export als **TAR-Files in der von BSI TR-03153-1 Kapitel 5.2 vorgeschriebenen Form** ermöglicht. „Nach diesem Export können die Daten auf dem Speichermedium der TSE gelöscht werden." Aber: „Zur Erhaltung der Verkettung ist die **vollständige Archivierung der Log-Nachrichten aller Absicherungsschritte (Start, Update und Beendigung des Vorgangs)** erforderlich." Nr. 1.15.4: „Eine Verdichtung von Grundaufzeichnungen in dem Aufbewahrungssystem ist für die Dauer der Aufbewahrung nach § 147 Abs. 3 AO **unzulässig**."

**Alt-Hardware:** Nach ZDH-Arbeitshilfe ist die Hard- und Software alter Kassen grundsätzlich für die Dauer der Aufbewahrungspflicht vorzuhalten; die physische Aufbewahrung entfällt nur, wenn die Daten quantitativ und qualitativ gleichwertig einschließlich Metadaten, Stammdaten, Bewegungsdaten und Verknüpfungen migriert wurden und das neue System die **gleichen Auswertungen** ermöglicht (GoBD Rz. 142 f.).

---

## Anhang: Zwei Pflichten, die neben dem Tagesabschluss stehen und leicht vergessen werden

**Mitteilungspflicht nach § 146a Abs. 4 AO.** Elektronisch über „Mein ELSTER" oder die ERiC-Schnittstelle, **eine Mitteilung je Betriebsstätte**. Systeme, die vor dem 01.07.2025 angeschafft wurden, waren **bis zum 31.07.2025** zu melden; ab dem 01.07.2025 angeschaffte innerhalb eines Monats nach Anschaffung oder Außerbetriebnahme. AEAO zu § 146a, Nr. 1.16.1: „Eine wirksame Erfüllung der Mitteilungspflicht nach § 146a Abs. 4 AO ist grundsätzlich nur auf diesem Weg möglich."
Quelle: [BMF-Schreiben vom 28.06.2024](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2024-06-28-mitteilungsverpflichtung-nach-AO.html). **Da heute der 26.07.2026 ist, ist diese Frist verstrichen.** Ob für den Laden in Baden-Württemberg gemeldet wurde, ist zu prüfen.

**Belegausgabepflicht, § 146a Abs. 2 AO**, mit den Details aus AEAO zu § 146a, Nr. 2.5: elektronische Ausgabe nur mit Zustimmung des Kunden, Zustimmung formlos und konkludent möglich; „Ein elektronischer Beleg gilt als bereitgestellt, wenn dem Kunden die Möglichkeit der Entgegennahme gegeben wird. **Unabhängig von der Entgegennahme durch den Kunden ist der elektronische Beleg in jedem Fall zu erstellen.**" Bildschirmanzeige allein genügt nicht (Nr. 2.5.4). Ausgabe „in unmittelbarem zeitlichem Zusammenhang mit der Beendigung des Vorgangs" (Nr. 2.5.7). Keine Aufbewahrungspflicht für nicht entgegengenommene Papierbelege (Nr. 2.5.8). Belegpflicht nur bei Beteiligung eines Dritten, „von der Belegausgabepflicht sind z. B. **Entnahmen und Einlagen ausgenommen**" (Nr. 2.5.5). Befreiung nach § 148 AO nur im Einzelfall bei nachgewiesener sachlicher Härte, Kosten allein sind keine Härte (Nr. 2.5.9).

---

## Zusammenfassung: was für den Bau UNMITTELBAR zählt

| # | Bauanforderung | Norm / Fundstelle | Konkret zu implementieren | Folge bei Fehlen |
|---|---|---|---|---|
| 1 | **Kassenabschluss als DSFinV-K-Datensatz**, nicht als PDF-Bericht | DSFinV-K 2.4 Tz. 3.2, 3.3, 4.1; GoBD Rz. 173 | `Stamm_Abschluss`, `Stamm_Orte`, `Stamm_Kassen`, `Stamm_USt`, `Stamm_TSE`, `Z_GV_TYP`, `Z_Zahlart`, `Z_Waehrungen` | Export wird nicht akzeptiert |
| 2 | **`Z_NR` aufsteigend, fortlaufend, nicht zurücksetzbar** je Kasse | DSFinV-K, Anhang E, Schlüsselfelder | Datenbankseitige Sequenz, kein Reset, Lückenprüfung | Nachfolger des Nullstellenzählers fehlt, Vollständigkeit unbeweisbar |
| 3 | **Stornos MÜSSEN im Abschluss sichtbar sein** | BFH 29.07.2025, X R 23-24/21, Leitsatz 1 | `AVBelegstorno` bzw. Gegenbuchung mit `Bon_Referenzen`, eigene Zeile in `Z_GV_TYP` | formeller Mangel, Schätzungsbefugnis |
| 4 | **Beleg trägt neun Angaben, nicht sieben** | § 6 KassenSichV + AEAO zu § 146a Nr. 2.4.4 | zusätzlich **Betrag je Zahlungsart**, Signaturzähler, Prüfwert; TSE-Werte unverändert, ungerundet, ungekürzt | Beleg beanstandbar |
| 5 | **QR-Code exakt nach DSFinV-K Anhang I** | DSFinV-K 2.4 S. 122 ff. | 12 Felder, Semikolon-getrennt, `V0`, Public Key enthalten, ≥ 3 cm, ≥ 300 dpi | Nachschau kann nicht am Beleg enden, voller Datenexport nötig |
| 6 | **Export für JEDEN Zeitraum, in Minuten, ohne Fremdhilfe** | § 146b Abs. 2 Satz 2 AO; AEAO zu § 146b Nr. 5 („vom Amtsträger bestimmter Zeitraum"); ZDH: „unverzüglich" | Filter über `Z_ERSTELLUNG` / `Z_BUCHUNGSTAG`, eine `index.xml` je Export | Übergang zur Außenprüfung |
| 7 | **Zweiter Export: TAR-Archiv der TSE** | AEAO zu § 146a Nr. 1.15.2; BSI TR-03153-1 Kap. 5.2 | alle Log-Nachrichten Start, Update, Beendigung, unverdichtet | Verkettung nicht prüfbar |
| 8 | **`index.xml` konform** | Anlage zu den GoBD i.d.F. 11.03.2024, Nr. 1.4 | Semikolon, Komma als Dezimaltrenner, CRLF, Anführungszeichen, Kopfzeile, Feldreihenfolge; Abweichungen dokumentieren | IDEA liest nicht ein |
| 9 | **Nur zugelassene Formate** | Anlage zu den GoBD, Nr. 4 und 5 | CSV, `xlsx`, `accdb`. **Kein PDF als Datenlieferung** | Rz. 129 und 173: unzulässige Verdichtung |
| 10 | **Sollbestand Bar jederzeit**, nicht erst beim Abschluss | AEAO zu § 146b Nr. 1; AEAO zu § 146 Nr. 3.4; DSFinV-K `Z_Waehrungen` | laufender Kassenbestand, Kassensturz-Ansicht auf Knopfdruck | Kassensturz misslingt |
| 11 | **Kassenbuch-Geschäftsvorfälle abbilden** | DSFinV-K Anhang C | `Anfangsbestand`, `Privatentnahme`, `Privateinlage`, `Geldtransit`, `Lohnzahlung`, `Einzahlung`, `Auszahlung`, `DifferenzSollIst` | Bewegungen unbelegt, Kassenfehlbeträge |
| 12 | **Kassenbericht retrograd rechnen** | AEAO zu § 146 Nr. 3.3 | Endbestand heute − Endbestand gestern − Einlagen + Ausgaben + Entnahmen | Kassenbericht rechtlich wertlos |
| 13 | **Differenzbesteuerung als eigener `UST_SCHLUESSEL` ab ID 1000** | DSFinV-K Tz. 3.2.6 | selbst definieren, in der Verfahrensdokumentation erläutern | § 25a UStG im Export nicht darstellbar |
| 14 | **Trennung steuerfrei / nicht steuerbar / steuerpflichtig** | GoBD Rz. 55; § 22 UStG | je Position `UST_SCHLUESSEL`, nie Sammeltopf | materieller Mangel |
| 15 | **Kassenabschluss ERZWINGEN vor jeder Stammdatenänderung** | DSFinV-K Tz. 3.3 | Sperre im Code: Steuersatz, Adresse, Belegtext, Firmendaten nur nach Abschluss änderbar | Stammdaten nicht eindeutig zuordenbar |
| 16 | **Bar und unbar getrennt kenntlich** | GoBD Rz. 55 | `ZAHLART_TYP`, sofortige Umtragung unbarer Umsätze | Kassensturzfähigkeit entfällt |
| 17 | **Täglicher Abschluss erzwingen und protokollieren** | § 146 Abs. 1 Satz 2 AO; GoBD Rz. 48; AEAO zu § 146 Nr. 3.4 | Erinnerung, Sperre, Protokoll der Ausnahme mit Begründung | formeller Mangel |
| 18 | **Belegausgabe: elektronischer Beleg IMMER erzeugen** | AEAO zu § 146a Nr. 2.5.3, 2.5.4, 2.5.7 | Erzeugung unabhängig von Entgegennahme, unmittelbar nach Vorgangsende, Standardformat (PDF, PNG, JPG), Anzeige allein genügt nicht | Verstoß gegen § 146a Abs. 2 AO |
| 19 | **TSE-Ausfall dokumentieren und auf dem Beleg kennzeichnen** | AEAO zu § 146a Nr. 1.14.1 bis 1.14.4 | Ausfallzeit und Grund automatisch protokollieren, Beleg kennzeichnen, Datum und Uhrzeit vom System liefern | Mangel bei der Nachschau |
| 20 | **Verfahrensdokumentation versioniert, mit Änderungshistorie, mit Exportanleitung** | GoBD Rz. 151 bis 154; AEAO zu § 146b Nr. 5 | Programmidentität nachweisen, TSE-Zertifikate, Kassieranweisung, Berechtigung zur Stornobuchung, Exportanleitung | Anlass zum Übergang in die Außenprüfung |
| 21 | **Keine Verdichtung, kein Formatverlust, nie PDF als Archiv** | GoBD Rz. 129; § 3 Abs. 4 KassenSichV; AEAO zu § 146a Nr. 1.15.4 | Rohdaten unverdichtet über die gesamte Frist | Buchführung verwerfbar |
| 22 | **Fristen im Löschkonzept: 10 / 8 / 6 Jahre, Verfahrensdokumentation 10+** | § 147 Abs. 3 und 4 AO (Buchungsbelege 8 Jahre seit 01.01.2025) | Löschsperre bei laufender Festsetzungsfrist oder begonnener Prüfung | § 379 Abs. 1 Nr. 7 AO, Bußgeld bis 25.000 Euro |
| 23 | **Innerer Betriebsvergleich aus eigenen Daten** | BFH 18.06.2025, X R 19/21; BFH 29.07.2025, X R 23-24/21, Leitsatz 3 | Rohgewinnaufschlag je Warengruppe und Zeitraum aus Einzeldaten | Richtsatzschätzung bleibt unwidersprochen |
| 24 | **Mitteilung nach § 146a Abs. 4 AO** | BMF 28.06.2024; AEAO zu § 146a Nr. 1.16 | je Betriebsstätte, über ELSTER oder ERiC; Seriennummern aus `Stamm_Kassen` und `Stamm_TSE` liefern; **kein Unterstrich, kein Schrägstrich in `KASSE_SERIENNR`** | Frist 31.07.2025 verstrichen, Prüfung erforderlich |

---

### Was ich NICHT verifizieren konnte

- **AEAO zu § 146 AO, aktuelle konsolidierte Fassung.** Ich zitiere die Fassung des BMF-Schreibens vom 19.06.2018. Das amtliche AO-Handbuch (`ao.bundesfinanzministerium.de`) blockierte alle Abrufe mit einer Radware-Sperre. Ob seither geändert: **unbestätigt**.
- **DSFinV-K 2.4, Bitidentität.** Der ZIP-Download beim BZSt lieferte HTML statt Archiv. Ich habe einen Spiegel benutzt; der Änderungsnachweis im PDF weist Version 2.4 mit dem Vermerk „Redaktionelle Änderungen und Anpassung an die Neufassung des AEAO zu § 146a ab dem 1. Januar 2024" aus, was mit der BZSt-Seite übereinstimmt. **Vor einer Zertifizierungsaussage bitte das Original vom BZSt ziehen.**
- **Ob eine DSFinV-K-Version 2.5 existiert.** Die BZSt-Seite nannte am 26.07.2026 Version 2.4 als aktuell. Keine Anhaltspunkte für 2.5 gefunden, aber ich habe die BZSt-Seite nur einmal abgerufen.
- **AEAO zu § 158 in der Fassung vom 11.03.2024** habe ich nur über die Sekundärquelle (ZDH-Arbeitshilfe, Fußnote 76, GZ IV D 2 - S 0333/23/10001 :001) belegt, nicht im Volltext gelesen.

### Lokale Belegkopien (absolute Pfade)

```
im lokalen Arbeitsordner der Recherche: aeao146a.pdf   AEAO zu § 146a, BMF 30.06.2023
im lokalen Arbeitsordner der Recherche: aeao146_2018.pdf  AEAO zu § 146, BMF 19.06.2018
im lokalen Arbeitsordner der Recherche: aeao146b.pdf   AEAO zu § 146b, BMF 29.05.2018
im lokalen Arbeitsordner der Recherche: gobd2019.pdf   GoBD, BMF 28.11.2019
im lokalen Arbeitsordner der Recherche: gobd2024.pdf   GoBD-Änderung, BMF 11.03.2024
im lokalen Arbeitsordner der Recherche: gobd2025.pdf   GoBD-Änderung, BMF 14.07.2025
im lokalen Arbeitsordner der Recherche: dsfinvk24.pdf  DSFinV-K Version 2.4
im lokalen Arbeitsordner der Recherche: bmf2010.pdf    BMF 26.11.2010, Aufhebung 1996
im lokalen Arbeitsordner der Recherche: zdh_nachschau.pdf  ZDH-Arbeitshilfe Kassen-Nachschau
```

**Sources:**
[§ 146 AO](https://www.gesetze-im-internet.de/ao_1977/__146.html) · [§ 146a AO](https://www.gesetze-im-internet.de/ao_1977/__146a.html) · [§ 146b AO](https://www.gesetze-im-internet.de/ao_1977/__146b.html) · [§ 147 AO](https://www.gesetze-im-internet.de/ao_1977/__147.html) · [§ 158 AO](https://www.gesetze-im-internet.de/ao_1977/__158.html) · [§ 162 AO](https://www.gesetze-im-internet.de/ao_1977/__162.html) · [§ 379 AO](https://www.gesetze-im-internet.de/ao_1977/__379.html) · [§ 6 KassenSichV](https://www.gesetze-im-internet.de/kassensichv/__6.html) · [§ 2 KassenSichV](https://www.gesetze-im-internet.de/kassensichv/__2.html) · [§ 3 KassenSichV](https://www.gesetze-im-internet.de/kassensichv/__3.html) · [§ 4 KassenSichV](https://www.gesetze-im-internet.de/kassensichv/__4.html) · [BMF, AEAO zu § 146a, 30.06.2023](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/AO-Anwendungserlass/2023-06-30-AEAO-Par-146-AO.pdf) · [BMF, AEAO zu § 146, 19.06.2018](https://www.bvl-verband.de/fileadmin/steuerpolitik/bmf-schreiben/2018/2018-06-19-aenderung-anwendungserlass-abgabenordnung-Einzelaufzeichnungspflicht.pdf) · [BMF, AEAO zu § 146b, 29.05.2018](https://www.bvl-verband.de/fileadmin/steuerpolitik/bmf-schreiben/2018/2018-05-29-aenderung-anwendungserlass-abgabenordnung-kassen-nachschau.pdf) · [GoBD 28.11.2019](https://elektronische-steuerpruefung.de/bmf/gobd-2019-11-28.pdf) · [GoBD-Änderung 11.03.2024](https://elektronische-steuerpruefung.de/bmf/gobd-aenderung-2024-03-11.pdf) · [GoBD-Änderung 14.07.2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2025-07-14-GoBD-2-aenderung.pdf) · [BZSt, DSFinV-K](https://www.bzst.de/DE/Unternehmen/Aussenpruefungen/DigitaleSchnittstelleFinV/digitaleschnittstellefinv.html) · [DSFinV-K 2.4 PDF](https://kassensichv.com/downloads/DSFinV-K-Vers-2-4.pdf) · [BMF 26.11.2010](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Betriebspruefung/2010-11-26-Aufbewahrung-digitaler-Unterlagen-bei-Bargeschaeften.pdf) · [BMF 09.01.1996 (aufgehoben)](https://www.iww.de/mbp/quellenmaterial/id/182545) · [BMF 28.06.2024, Mitteilungspflicht](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Weitere_Steuerthemen/Abgabenordnung/2024-06-28-mitteilungsverpflichtung-nach-AO.html) · [BFH 29.07.2025, X R 23-24/21](https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/pdf/STRE202520320?type=1646225765) · [BFH 18.06.2025, X R 19/21](https://www.bundesfinanzhof.de/de/entscheidung/entscheidungen-online/detail/pdf/STRE202520256?type=1646225765) · [BFH 25.03.2015, X R 20/13](https://dejure.org/dienste/vernetzung/rechtsprechung?Gericht=BFH&Datum=25.03.2015&Aktenzeichen=X+R+20/13) · [BFH 12.07.2017, X B 16/17](https://www.bundesfinanzhof.de/en/entscheidungen/entscheidungen-online/decision-detail/STRE201710183/) · [Sächsisches FG 28.09.2022, 1 V 864/21](https://www.steueranwalt-leipzig.de/verfahrensdokumentation-mangelhaft-saechsisches-finanzgericht-verneint-schaetzungsbefugnis/6145/) · [ZDH-Arbeitshilfe Kassen-Nachschau](https://www.hwkhalle.de/wp-content/uploads/20240506_05-07_Anl-2_RSIV202409_Arbeitshilfe_Kassen_Nachschau_FAQ.pdf) · [Haufe, BEG IV Aufbewahrungsfristen](https://www.haufe.de/steuern/gesetzgebung-politik/viertes-buerokratieentlastungsgesetz_168_613390.html)