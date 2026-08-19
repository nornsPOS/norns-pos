# DATEV, Kassenbericht und Differenzbesteuerung: der geprüfte Stand

**Erhoben am 26.07.2026** aus vier Recherchen an amtlichen Quellen (DATEV
Developer Portal, DATEV Hilfe-Center, DATEV Prüfprogramm 2.2.3.0, BMF, AO,
AEAO, UStG, BFH) und drei gegengeprüften Befunden am eigenen Quelltext.

Die drei gefährlichsten Befunde wurden anschliessend von Hand nachgemessen
und bestätigt: der stornolastige Tag, der sich nie abschliessen lässt; die
fest eingetragene Null bei den fehlgeschlagenen TSE-Signaturen; und die
Tatsache, dass der DATEV-Weg die Zahlungsarten überhaupt nicht liest.

Dieses Papier ist die Arbeitsgrundlage. Es wird nicht überschrieben, sondern
ergänzt, wenn ein Punkt erledigt ist.

---

## 1. Ein Satz

**Nein** – die heute erzeugte Datei ist kein DATEV-Buchungsstapel, sondern eine zwölfspaltige CSV mit falschem Dateinamen, falschem Zeichensatz, halb leerer und an einer Stelle verrutschter Kopfzeile, und selbst wenn sie eingelesen würde, buchte sie jede Kartenzahlung auf die Barkasse und die Differenzbesteuerung ohne einen Cent Umsatzsteuer.

---

## 2. Die Sperren

Alle Zeilenangaben selbst geprüft am 26.07.2026 gegen den Quelltext.

### 2a. Was den Import unmöglich macht

| # | Datei, Zeile | Ist | Der Satz, der es behebt |
|---|---|---|---|
| B1 | `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/lib/datev-export.ts:40` | `DATEV_COLUMNS` hat **12** Einträge mit eigenen Namen (`Umsatz`, `Soll/Haben`, `WKZ`, `Gegenkonto`, `Belegfeld1`) | Schreibe **genau 125 Spalten** in DATEVs eigener Schreibweise, wörtlich aus `EXTF_Buchungsstapel.csv` des Musterdaten-Pakets kopiert, und je Buchungszeile genau 125 durch Semikolon getrennte Felder, die nicht gefüllten leer. |
| B2 | `datev-export.ts:52` | Der Buchungstext steht auf Spaltenposition 12 | Buchungstext gehört auf **Feld 14**; Feld 12 ist Belegfeld 2 mit 12 Zeichen, Feld 13 ist Skonto. Die Kürzung auf 60 Zeichen zielt heute auf ein Feld, das die Datei gar nicht hat. |
| B3 | `datev-export.ts:63` | `EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;;;;;;;;;` – die `4` sitzt nachgezählt auf **Position 15** (Datum von), Position 14 bleibt leer | Sachkontenlänge gehört auf **Feld 14**, Feld 15 und 16 tragen `YYYYMMDD`. |
| B4 | `datev-export.ts:63` | Formatversion `9` | **`13`** (Stand der Formatdefinition vom 21.10.2025). |
| B5 | `datev-export.ts:63` | Beraternummer (11), Mandantennummer (12), WJ-Beginn (13), Datum von (15), Datum bis (16) leer; der Kommentar in Zeile 58 bis 61 behauptet, DATEV fülle sie beim Import | Alle fünf sind Ordnungsbegriffe und müssen aus einer Mandantenkonfiguration kommen. **Den Kommentar löschen**, er ist die eigentliche Falle: er beruhigt über einen echten Defekt. |
| B6 | `datev-export.ts:63` | `EXTF`, `Buchungsstapel`, `EUR` ohne Anführungszeichen | Textfelder der Kopfzeile einfassen: `"EXTF";700;21;"Buchungsstapel";13;…;"EUR"`. Regel: Anführungszeichen genau dann, wenn der DATEV-Ausdruck des Feldes `["]` enthält. Felder 7, 23, 25, 26, 29 bleiben **echt leer**, Felder 24 und 30 sind **zwei Anführungszeichen**. |
| B7 | `datev-export.ts:105` | `quoted: true` klammert **jedes** Feld, also auch Umsatz, Konto, Gegenkonto und Belegdatum: `"1234,56";"S";"EUR";;;;"1000";"8400";"3";"2905";…` | Auf `quoted: false` umstellen und die Anführungszeichen feldweise selbst setzen, nur für Textfelder. |
| B8 | `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/routes/closing-export.ts:526` | Dateiname `DATEV_2026-05-29.csv` | Der Name muss mit **`EXTF_`** beginnen und auf `.csv` enden, sonst erscheint die Datei in der Stapelverarbeitung überhaupt nicht. Dieselbe Zeile steht noch dreimal im Haus: `apps/tauri-pos/src/screens/secondary/SteuerExport.tsx:80`, `apps/tauri-pos/src/screens/secondary/SteuerComplianceSection.tsx:366`, `apps/mobile/src/warehouse14/kasse-ui.ts:152`. Der Name muss aus **einer** Stelle kommen, dem `Content-Disposition`-Kopf des Servers. |  ⟵ Datei mit der Inhaber-App geloescht am 14.08.2026
| B9 | `closing-export.ts:528` | `reply.type('text/plain; charset=utf-8')`, und `datev-export.ts:111` liefert UTF-8 | Nach **Windows-1252 ohne Byte-Reihenfolge-Marke** wandeln und `charset=windows-1252` setzen. Begründung: die Konsolenverarbeitung `KrStaPv.exe` beim Berater kann kein Unicode. Die Spaltenüberschrift `BU-Schlüssel` trägt heute schon zwei Bytes für ein Zeichen. |
| B10 | fehlt ganz | Feld 114 Festschreibung existiert in der Datei nicht, Kopf-Feld 21 ist leer | Feld 114 **immer explizit** mit `0` oder `1` schreiben. Leer bedeutet seit der Jahreswechselversion 2016/2017 automatische Festschreibung ohne Rückweg, und ein solcher Stapel lässt sich nicht einmal an einen bestehenden anhängen. |
| B11 | `datev-export.ts:74` | Belegdatum `TTMM` ohne Jahr, und kein Feld der Kopfzeile trägt ein Jahr | `TTMM` ist richtig, aber das Jahr wird aus **Kopf-Feld 13** abgeleitet. Solange 13, 15 und 16 leer sind, hat keine Buchung einen Jahresanker: ein im Januar 2027 gezogener Export des 29.05.2026 landet im Wirtschaftsjahr 2027. |

### 2b. Was importierbar wäre, aber falsch bucht

| # | Datei, Zeile | Ist | Der Satz, der es behebt |
|---|---|---|---|
| F1 | `closing-export.ts:296` | `const account = isAnkauf ? KONTO_WARENEINGANG : KONTO_KASSE` – jeder Verkauf gegen 1000 Kasse; `transaction_payments` wird auf dem DATEV-Weg nie gelesen (die Abfrage ab Zeile 488 holt nur `transactions` und `transaction_items`) | Das Sollkonto muss aus der **Zahlungsart** kommen. Karte, Stripe, Mollie, SumUp, Überweisung, eBay, Gutschein dürfen die Kasse nicht berühren. Sonst wächst 1000 um Geld, das nie in der Schublade lag, und kann rechnerisch negativ werden: der erste Punkt, den ein Prüfer nachrechnet. Der DSFinV-K-Weg derselben Datei liest die Zahlarten sehr wohl (Zeile 760). |
| F2 | `closing-export.ts:133` | `MARGIN_25A: { konto: '8200', bu: '' }` – der Bruttoverkauf geht ungeteilt auf ein Konto, es entsteht **keine** Umsatzsteuer | § 25a besteuert 19/119 der Differenz. Aufteilen in Einkaufspreisanteil und Marge, siehe Abschnitt 3d. `acquisition_cost_eur` liegt in `packages/db/src/schema/products/products.ts:96` und `margin_eur` in `transactionItems.ts:50`; beide werden vom Export nicht gelesen. Für einen Laden, dessen Kerngeschäft die Differenzbesteuerung ist, ist das der größte Teil des Umsatzes. |
| F3 | `closing-export.ts:130` | `ERLOES_BY_TREATMENT` kennt vier Codes, das Schema kennt sechs | `REVERSE_CHARGE_13B` (0 Prozent, § 13b Abs. 2 Nr. 9 UStG, der Regelfall beim Verkauf an eine Scheideanstalt) fällt in Zeile 303 auf **8400** zurück und erzeugt 19 Prozent Umsatzsteuer, die niemand schuldet. Unbekannte Codes müssen den Export **abbrechen**, nicht stillschweigend auf das 19-Prozent-Konto laufen. |
| F4 | `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/routes/closings-finalize.ts:144` | `SUM(total_eur) FILTER (WHERE direction='VERKAUF')` enthält die negativen Stornozeilen, die Datenbank verbietet per CHECK `daily_closings_gross_non_negative` (`packages/db/migrations/0011_closing.sql:153`) einen negativen Wert | Brutto ohne Stornos summieren und die Stornosumme als eigene Größe führen. Heute bricht ein stornolastiger Tag mit SQLSTATE 23514 ab, den `plugins/error-handler.ts:111` auf 409 abbildet: der Tag ist **nie** abschließbar, und ohne Z-Bon-Zeile liefern DATEV, Kassenbericht und DSFinV-K für diesen Tag gar nichts. |
| F5 | `closings-finalize.ts:204` gegen `:150` | Belege werden über `berlin_business_day(finalized_at)` gezählt, geschlossene Schichten über `berlin_business_day(closed_at)` | Eine nach Mitternacht geschlossene Schicht zählt zum Folgetag, der Verkaufstag hat dann Belege und null Kassenstürze, und die Sperre in Zeile 210 wirft dauerhaft 409. Die Schicht muss ihrem **Öffnungstag** zugerechnet werden oder die Sperre muss die Schicht über den Belegzeitraum finden. |
| F6 | `closings-finalize.ts:150` und `closing-export.ts:492` | Keine Aggregation filtert auf `sales_channel` (nachgezählt: null Treffer in beiden Dateien) | Webshop-Bestellungen (`storefront-webhook.ts:497` legt sie mit Kanal WEB an) laufen in Kassenbericht und DSFinV-K und erscheinen als Kassenumsatz, dem kein Bargeld und kein Terminal gegenübersteht. Kanal trennen. |
| F7 | `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/routes/storefront-webhook.ts:404` | `(lineTotalCents * 19n) / 119n`, pauschal 19 Prozent für jeden Online-Verkauf, während Zeile 519 die echte Steuerbehandlung auf die Positionszeile schreibt | Derselbe Verkauf trägt in der Datenbank 19 Prozent Steuer und wird im DATEV-Export steuerfrei auf 8200 gebucht. Zusätzlich schneidet die BigInt-Division ab, statt zu runden: bei 100,00 Euro brutto 15,96 statt 15,97, während die Kasse in `apps/tauri-pos/src/lib/cart-math.ts:139` kaufmännisch rundet. |
| F8 | `closing-export.ts:492` | `cash_movements` und `operating_expenses` erreichen keinen Export (nachgezählt: null Treffer) | Anfangsbestand, Einlage, Bankabgang, Tresorgang und jede bar bezahlte Betriebsausgabe fehlen im Stapel. Konto 1000 wächst unbegrenzt weiter, obwohl das Geld längst auf der Bank liegt, und der Berater muss jede Miete aus Papierbelegen selbst erfassen. |
| F9 | `closings-finalize.ts:280` | `tse_failed_count` wird als feste `0` geschrieben (der Kommentar in Zeile 225 sagt es selbst) | Der Kassenbericht druckt „Fehlgeschlagen: 0" als Messung, und `SteuerExport.tsx:190` leitet daraus für **jeden** Tag ein grünes Siegel „alles signiert" ab. Solange die TSE nicht steht, ist jeder Beleg unsigniert und der Bildschirm zeigt trotzdem grün. Entweder die echte Quelle anschließen oder die Zeile als „nicht gemessen" ausweisen. |
| F10 | `closings-finalize.ts:251` gegen `closing-export.ts:570` | Ein umsatzloser Tag bekommt ehrlich `notes = 'Umsatzloser Tag — kein Kassensturz.'`, aber die Kassenbericht-Route liest `notes` nicht (nachgezählt: null Treffer) | Der Bericht druckt „Erwartet bar 0,00, Gezählt bar 0,00, Differenz 0,00" – genau die erfundene Null, die der Dateikopf von `kassenbericht-export.ts` in Zeile 7 ausschließt. `notes` durchreichen. |
| F11 | `closing-export.ts:13` | Der Kopfkommentar behauptet „the access is audit-logged"; nachgezählt: **null** Schreibvorgänge auf `audit_log` oder `ledger_events` in der ganzen Datei. die damalige Datei `docs/Verfahrensdokumentation.md:308` behauptete dasselbe (diese Datei ist entfernt: die Verfahrensdokumentation wird seit dem 10.08.2026 aus dem laufenden Stand ERZEUGT, siehe `apps/api-cloud/src/lib/verfahrensdokumentation.ts`) | Jeden Export mit Zeitraum, Format und Person ins Tagebuch schreiben. Die Verfahrensdokumentation, die dem Prüfer ausgehändigt wird, sagt an dieser Stelle heute etwas Unwahres. |
| F12 | `apps/api-cloud/package.json:15` | `"test": "vitest run --passWithNoTests --exclude '**/tests/integration/**'"` | Der einzige Test, der eine echte Exportdatei über HTTP sieht, ist ausgeschlossen, und er schreibt in Zeile 724 die zwölfspaltige Anordnung als Sollzustand fest. Jede Aussage „die Steuer-Exporte sind grün" betrifft heute nur die Unit-Suite. |

---

## 3. Der Zielzustand

### 3a. Die Kopfzeile, alle 31 Felder, mit Herkunft

Beispiel für den Monat Mai 2026, Wirtschaftsjahr gleich Kalenderjahr:

```
"EXTF";700;21;"Buchungsstapel";13;20260726143012345;;"";"NornsKasse";"";29098;55003;20260101;4;20260501;20260531;"Kasse Mai 2026";"";1;0;0;"EUR";;"";;;"03";;;"";"05/2026"
```

| # | Feld | Wert | Woher |
|---|---|---|---|
| 1 | Kennzeichen | `"EXTF"` | fest |
| 2 | Versionsnummer | `700` | fest, einziger zulässiger Wert |
| 3 | Formatkategorie | `21` | fest |
| 4 | Formatname | `"Buchungsstapel"` | fest |
| 5 | Formatversion | `13` | fest |
| 6 | Erzeugt am | 17 Stellen `YYYYMMDDHHMMSSFFF` | Systemzeit beim Export, Europe/Berlin |
| 7 | Importiert | **echt leer** | – |
| 8 | Herkunft | `""` oder 2 Zeichen | Mandantenkonfiguration, optional |
| 9 | Exportiert von | `"NornsKasse"`, max 25, **nur Wortzeichen, keine Leerzeichen** | fest oder Bedienername ohne Leerzeichen |
| 10 | Importiert von | `""` | DATEV füllt beim Import |
| 11 | **Beraternummer** | z. B. `29098` | **Steuerberater**, Mandantenkonfiguration |
| 12 | **Mandantennummer** | z. B. `55003` | **Steuerberater**, Mandantenkonfiguration |
| 13 | **WJ-Beginn** | `20260101` | Mandantenkonfiguration; bestimmt das Jahr **aller** Belegdaten der Datei |
| 14 | Sachkontenlänge | `4` | Mandantenkonfiguration, muss zum Bestand des Beraters passen |
| 15 | Datum von | `20260501` | erster Tag des exportierten Teilzeitraums |
| 16 | Datum bis | `20260531` | letzter Tag des exportierten Teilzeitraums |
| 17 | Bezeichnung | `"Kasse Mai 2026"`, max 30 | erzeugt; das sieht der Berater in seiner Liste |
| 18 | Diktatkürzel | `""` | optional |
| 19 | Buchungstyp | `1` | fest, Finanzbuchführung |
| 20 | Rechnungslegungszweck | `0` | fest, unabhängig |
| 21 | **Festschreibung** | `0` oder `1`, **nie leer** | **Steuerberater**, Mandantenkonfiguration |
| 22 | WKZ | `"EUR"` | fest |
| 23 | Reserviert | **echt leer** | – |
| 24 | Derivatskennzeichen | `""` | fest |
| 25, 26 | Reserviert | **echt leer** | – |
| 27 | Sachkontenrahmen | `"03"` oder `"04"` | folgt der Kontenrahmenwahl |
| 28 | ID Branchenlösung | leer | – |
| 29 | Reserviert | **echt leer** | – |
| 30 | Reserviert | `""` | fest |
| 31 | Anwendungsinformation | `"05/2026"`, max 16 | Zeitraumkennung |

### 3b. Die Spaltenzeile

**Genau 125 Spalten**, wörtlich aus DATEVs Musterdatei kopiert, nicht nachgeschrieben. DATEV schreibt selbst uneinheitlich (`Zusatzinformation - Art 1` mit Leerzeichen vor dem Bindestrich, `Zusatzinformation- Inhalt 1` ohne) und die CSV weicht an fünf Stellen von den Bezeichnungen der Formatdefinition ab (Feld 7 `Konto`, 37 `KOST1 - Kostenstelle`, 38 `KOST2 - Kostenstelle`, 96 `Buchungstyp`, 104 `KOST-Datum`). Maßgeblich ist die CSV-Schreibweise.

Pflicht sind laut DATEVs eigener Formatdefinition nur fünf Felder: **1 Umsatz, 2 Soll/Haben, 7 Konto, 8 Gegenkonto, 10 Belegdatum**. Die übrigen 120 dürfen leer sein, **müssen aber als Feld dastehen**.

Wir füllen:

| Feld | Inhalt | Regel |
|---|---|---|
| 1 | Umsatz | Komma, zwei Nachkommastellen, **immer positiv, nie `0,00`**, ohne Anführungszeichen |
| 2 | Soll/Haben | `"S"` oder `"H"`, mit Anführungszeichen, bezieht sich auf Feld 7 |
| 3 | WKZ Umsatz | `"EUR"` |
| 7, 8 | Konto, Gegenkonto | Ziffern, **ohne** Anführungszeichen |
| 9 | BU-Schlüssel | auf Automatikkonten leer lassen, siehe Frage 7 in Abschnitt 7 |
| 10 | Belegdatum | vierstellig `TTMM`, ohne Anführungszeichen |
| 11 | Belegfeld 1 | Belegnummer, max 36 Zeichen, **nur Ziffern, Buchstaben und `$ & % * + - /`**. Verboten sind Leerzeichen, Umlaute, Punkt, Komma, Semikolon, Doppelpunkt. `VK-2026-000123` ist zulässig. Der Export muss bei einem unzulässigen Zeichen **hart abbrechen**, nicht still bereinigen |
| 12 | Belegfeld 2 | Kassenabschlussnummer, max 12 |
| 14 | Buchungstext | max 60, **deutscher Klartext**, keine Rohbezeichner wie `MARGIN_25A`, mit Anführungszeichen, keine Steuerzeichen |
| 20 | Beleglink | optional, `"BEDI ""<GUID>"""` sobald der Berater DATEV Unternehmen online nutzt |
| 37, 38 | KOST1, KOST2 | optional, nur wenn der Berater DATEV Kostenrechnung führt |
| 114 | Festschreibung | `0` oder `1`, **nie leer** |
| 118 | Generalumkehr | `G` beim Storno, falls diese Variante gewählt wird |

Weiter: Trennzeichen Semikolon, Zeilenende **CR/LF auch nach der letzten Zeile**, Anführungszeichen im Text verdoppeln, höchstens **99.999 Buchungszeilen je Datei**.

### 3c. Zeichensatz und Kontenrahmen

- **Windows-1252 ohne Byte-Reihenfolge-Marke** für die DATEV-Datei. Das ist die einzige Variante, die auf allen drei Importwegen funktioniert.
- Für den **Kassenbericht** gilt das Gegenteil: den liest ein Mensch in Excel auf einem deutschen Windows, dort ist **UTF-8 mit Marke** richtig. Zwei Dateien, zwei Antworten, und das ist kein Widerspruch.
- Der **Kontenrahmen gehört in eine Mandantenkonfiguration**, nicht in den Code. Heute stehen 1000, 3200, 8150, 8200, 8300 und 8400 als Konstanten in `closing-export.ts:113` bis `:135`, und Kopf-Feld 27 nennt gar keinen Rahmen. Eine Zuordnungstabelle je Mandant, zwei Lieferwerte SKR03 und SKR04, ein Codepfad.

| Zweck | SKR03 | SKR04 |
|---|---|---|
| Kasse | 1000 | 1600 |
| Bank | 1200 | 1800 |
| Geldtransit | 1360 | 1460 |
| Geldtransit Karte, je Akzeptanzweg | 1361 ff. | 1461 ff. |
| Erlöse 19 Prozent (Automatikkonto) | 8400 | 4400 |
| Erlöse 7 Prozent (Automatikkonto) | 8300 | 4300 |
| Erlöse §§ 25/25a **ohne** USt | **8193** | **4138** |
| Erlöse §§ 25/25a **19 Prozent** | **8191** | **4136** |
| Wareneingang | 3200 | 5200 |
| Kassenfehlbetrag | 2309 | 6969 |
| Kassenüberschuss | 2709 | 4839 |
| Nebenkosten Geldverkehr | 4970 (unbestätigt) | 6855 |

Die heutigen Konten 8200 und 8150 tragen nach der einzigen prüfbaren Kontenliste andere Bezeichnungen: 8200 heißt schlicht „Erlöse" mit 19 Prozent, 8150 „Sonstige steuerfreie Umsätze, z. B. § 4 Nr. 2 bis 7 UStG". Der Quelltextkommentar in `closing-export.ts:124` schreibt ihnen etwas zu, das die Kontenbezeichnung nicht hergibt.

### 3d. Die vier Buchungen, konkret

**Differenzbesteuerter Verkauf**, Schmuck, Einkaufspreis 600,00, Verkaufspreis 900,00, bar. Zwei Zeilen, nie eine:

```
600,00 ;"S"; …;1000;8193; ;2905;"VK-2026-000123";"Verkauf VK-2026-000123 Diffbest. 25a Einkaufsanteil"
300,00 ;"S"; …;1000;8191; ;2905;"VK-2026-000123";"Verkauf VK-2026-000123 Diffbest. 25a Marge"
```

Umsatzsteuer aus der Marge: 300,00 × 19/119 = **47,90**, Nettomarge 252,10. Die Summe auf 1000 ist 900,00 und stimmt mit dem Beleg überein.

Die Rechenregel, die der Code führen muss, weil `Umsatz` nie `0,00` sein darf und eine negative Differenz nicht verrechnet werden darf:
`Einkaufsanteil = min(VK, EK)`, `Marge = max(0, VK − EK)`; ist die Marge null, **entfällt die zweite Zeile ganz**. Reparaturkosten erhöhen den Einkaufspreis **nicht**.

**Ankauf von privat**, bar 600,00:

```
600,00 ;"S"; …;3200;1000; ;2905;"AN-2026-000045";"Ankauf AN-2026-000045 Schmuck 25a"
```

Kein BU-Schlüssel, keine Vorsteuer. § 25a Abs. 6 Satz 2 UStG verlangt **getrennte Aufzeichnungen**: differenzbesteuerungsfähiger Schmuck (Zolltarif 7113) und ausgeschlossenes rohes Edelmetall (7108, 7112, im Haus als ADR-0004 festgehalten) brauchen **zwei verschiedene Wareneingangskonten**. Heute bucht `closing-export.ts:299` beides auf 3200 und ignoriert den Behandlungscode vollständig.

**Kartenzahlung**, Girocard, 250,00, regelbesteuert:

```
250,00 ;"S"; …;1361;8400; ;2905;"VK-2026-000124";"Verkauf VK-2026-000124 Girocard"
```

Die Kasse wird **nicht** berührt. Die Bankgutschrift zwei Tage später gleicht 1361 aus:

```
248,50 ;"S"; …;1200;1361;…  (Gutschrift)
  1,50 ;"S"; …;4970;1361;…  (Gebühr)
```

Rechtlicher Grund: BMF vom 16.08.2017 (unbare Vorgänge im Kassenbuch sind ein formeller Mangel), entschärft durch BMF vom 29.06.2018, wenn die Kartenumsätze gesondert gekennzeichnet oder auf ein eigenes Konto umgebucht werden.

**Storno oder Retoure.** Zwei zulässige Wege, die Wahl gehört dem Berater:

- *Variante A, heute gebaut:* dieselben Konten, `S` und `H` getauscht, Umsatz positiv.
- *Variante B, DATEV-eigen:* identische Zeile wie das Original, **Feld 118 = `G`**. DATEV mindert dann die Ursprungsseite, statt eine Gegenbuchung zu erzeugen.

In beiden Fällen gilt beim § 25a-Storno: **beide** Zeilen stornieren, Einkaufsanteil und Marge. Und der Storno muss im Tagesabschluss **mit Betrag** sichtbar sein, nicht nur als Stückzahl (BFH, Urteil vom 29.07.2025, X R 23-24/21, Leitsatz 1: ein System, das Stornierungen zulässt und sie in den Tagesabschlüssen nicht ausweist, begründet eine Schätzungsbefugnis).

---

## 4. Der Kassenbericht

Die heutige Struktur steht in `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/lib/kassenbericht-export.ts:156` bis `:219`: Belege, Umsatz, Umsatzsteuer, Zahlungsart, Kasse, TSE, Abschluss. Gemessen an den Vorschriften fehlt Folgendes.

| # | Was fehlt | Norm | Fundstelle |
|---|---|---|---|
| K1 | **Die retrograde Rechnung.** Der Abschnitt Kasse zeigt nur Erwartet, Gezählt, Differenz. Anfangsbestand, Bareinnahmen, Barausgaben, Privatentnahmen, Privateinlagen und Geldtransit stehen nirgends | AEAO zu § 146, Nr. 3.3: „Hierbei ist stets vom gezählten Kassenendbestand des jeweiligen Geschäftstages auszugehen. Von diesem Kassenendbestand werden der Kassenendbestand bei Geschäftsschluss des Vortages sowie die durch Eigenbeleg zu belegenden Bareinlagen abgezogen. Ausgaben und durch Eigenbeleg nachzuweisende Barentnahmen sind hinzuzurechnen." | `kassenbericht-export.ts:196` |
| K2 | **Privatentnahme und bar bezahlte Betriebsausgabe existieren nicht einmal als Bewegungsart.** `cash_movement_direction` kennt nur Anfangsbestand, Einlage, Bankabgang, Tresorgang und Abschlussabgleich | AEAO zu § 146, Nr. 3.3; DSFinV-K Anhang C führt `Privatentnahme`, `Privateinlage`, `Geldtransit`, `Auszahlung` als eigene Geschäftsvorfalltypen | `apps/api-cloud/src/routes/shifts.ts:318`, `shifts/index.ts:23` |
| K3 | **Die Bemessungsgrundlage der Differenzbesteuerung.** Der Abschnitt Umsatzsteuer nennt je Behandlung nur die Steuer, nie Verkaufspreis, Einkaufspreis oder Marge | § 25a Abs. 6 Satz 1 UStG: aus den Aufzeichnungen müssen die **Verkaufspreise, die Einkaufspreise und die Bemessungsgrundlagen** zu ersehen sein. Der Bericht zeigt von diesen drei Größen keine einzige | `kassenbericht-export.ts:176` |
| K4 | **Storno nur als Stückzahl, ohne Betrag** | BFH 29.07.2025, X R 23-24/21, Leitsatz 1 | `kassenbericht-export.ts:163` |
| K5 | **Zahlungsart nur für Verkäufe.** Die bar ausgezahlten Ankäufe, der größte Bargeldabfluss dieses Ladens, fehlen unter einer Zeile, die „Summe" heißt | § 146 Abs. 1 Satz 2 AO: Kasseneinnahmen **und Kassenausgaben** sind täglich festzuhalten | `closings-finalize.ts:189` |
| K6 | **Bar und unbar nicht getrennt ausgetragen** | GoBD Rz. 55: unbare Tagesumsätze müssen gesondert kenntlich gemacht und unmittelbar nachfolgend auf ein gesondertes Konto umgetragen werden | folgt aus F1 |
| K7 | **Wer gezählt und wer abgeschlossen hat, steht nicht auf dem Blatt.** `finalized_by_user_id` und `counted_by_user_id` werden von der Route nicht einmal gelesen, obwohl beide bei FINALIZED per CHECK gefüllt sind. `kassenbericht-print.ts:9` begründet die gedruckte Seite ausdrücklich damit, dass genau diese Angabe fehle | Verantwortungsträger, Kassieranweisung als Teil des internen Kontrollsystems | `closing-export.ts:571` |
| K8 | **Der Kettenanker fehlt.** Der Fußtext sagt „Erstellt aus den festgeschriebenen Tagesabschlussdaten", der Beleg `ledger_anchor_hash` wird nicht gezeigt | GoBD Rz. 151 ff., Nachprüfbarkeit durch einen sachverständigen Dritten | `kassenbericht-print.ts:112` |
| K9 | **Die TSE-Zeile ist erfunden** (siehe F9) | AEAO zu § 146a Nr. 1.14: Ausfallzeiten und -grund sind zu dokumentieren | `closings-finalize.ts:280` |
| K10 | **Ein umsatzloser Tag druckt 0,00 statt der Wahrheit** (siehe F10) | AEAO zu § 146 Nr. 3.4: der Sollbestand muss jederzeit mit dem Istbestand vergleichbar sein | `closing-export.ts:570` |
| K11 | **Das druckbare A4-Blatt ist von keinem Programm erreichbar.** Die Suche nach `format=html` trifft im ganzen Baum nur die Beschreibung der Route selbst | § 146b AO, Kassennachschau, wo der Prüfer Papier will | `closing-export.ts:621` |
| K12 | **Zwei Schreibweisen desselben Tages**: das Papier trägt `2026-07-26`, die CSV `26.07.2026` | Form | `kassenbericht-print.ts:108` |
| K13 | **Kein laufender Sollbestand Bar.** Es gibt ihn nur beim Schichtabschluss | AEAO zu § 146b Nr. 1: Kassensturzfähigkeit ist ein wesentliches Element der Nachprüfbarkeit, und der Prüfer verlangt sie **im laufenden Betrieb**, nicht abends | neu |

---

## 5. Der Zeitraum

Heute hängen alle drei Ausfuhrwege an der `:id` genau eines Tagesabschlusses (`closing-export.ts:448`, `:537`, `:659`), und die einzige Liste endet hart bei `LIMIT 90` (`closing-export.ts:426`). Ein Abschluss, der älter ist als etwa dreieinhalb Monate, ist über keine Oberfläche mehr erreichbar, während die GoBD zehn Jahre Zugriff verlangen. Die Monatswahl in `SteuerComplianceSection.tsx:366` filtert dieselbe 90er-Liste im Browser und meldet für den Januar „Keine abgeschlossenen Kassentage im Monat" – eine falsche Aussage über den fiskalischen Bestand.

Zu bauen:

1. **Liste mit Zeitraum:** `GET /api/closings?von=&bis=&limit=&cursor=` statt `LIMIT 90`. Das Muster steht im Haus bereits: `apps/api-cloud/src/routes/registers.ts:96` nimmt `from` und `to` entgegen.
2. **Eine Zeitraumroute je Format:** `GET /api/exports/datev?von=YYYY-MM-DD&bis=YYYY-MM-DD`, ebenso Kassenbericht und DSFinV-K. Rolle wie heute, Stufenanhebung **vor** der Zustandsprüfung wegnehmen (heute prüft `closing-export.ts:468` die Stufe, `:481` erst den Zustand: der Bediener gibt den Code umsonst ein).
3. **Der Schnitt, in dieser Reihenfolge:**
   - **hart nach Wirtschaftsjahr.** Eine Datei kann nur Buchungen eines Wirtschaftsjahres tragen, weil das Jahr aus Kopf-Feld 13 kommt. Eine Datei über zwei Wirtschaftsjahre wäre eine Lüge im Kopf.
   - **empfohlen nach Buchungsperiode**, also je Monat. DATEV rät ausdrücklich dazu, damit der Berater periodenweise verarbeiten kann.
   - **zwingend bei mehr als 99.999 Buchungszeilen.**
4. **Ergebnis ist ein ZIP** mit einer Datei je Teilzeitraum, benannt `EXTF_Buchungsstapel_<Beraternr>_<Mandantennr>_<von>_<bis>.csv`, **jede mit eigenem Kopf**, eigenem WJ-Beginn und eigenem Datum von und bis.
5. **Ein Deckblatt im ZIP**, das benennt, welche Geschäftstage enthalten sind und welche im Zeitraum **nicht abgeschlossen** waren. Ein stillschweigend übergangener Tag ist genau die Lücke, die ein Prüfer findet.
6. **Ein Tagebucheintrag je Export** mit Zeitraum, Format und Person (siehe F11).
7. **Eine Oberfläche, ein Knopf:** Von und Bis, dazu Monat, Quartal, Jahr als Kurzwege, ein Download. Heute lädt `SteuerComplianceSection.tsx:364` in einer Schleife bis zu 31 Dateien mit 31 Importvorgängen und 31 Festschreibungen.

Erst wenn Kopf-Feld 13, 15 und 16 gefüllt sind, ist der Jahreswechsel überhaupt beherrschbar. Bis dahin trägt **keine** Buchung dieser Anwendung ein Jahr, auch nicht bei einem einzelnen Tagesexport.

---

## 6. Die Reihenfolge

Nach Wirkung je Aufwand. Schätzung in halben Tagen.

| Rang | Schritt | Halbe Tage | Warum hier |
|---|---|---|---|
| 1 | **Tagesabschluss reparieren**: Brutto ohne Stornos (F4), Schicht über Mitternacht (F5) | 1 | Ohne Z-Bon-Zeile gibt es für den Tag **gar keinen** Export. Zwei Sackgassen, kleinster Aufwand im ganzen Plan. |
| 2 | **Formatgerüst**: 125 Spalten, Kopfzeile aus einer Mandantenkonfiguration, Feld 14 richtig, Version 13, Anführungszeichen feldweise, Feld 114 explizit, Windows-1252, Dateiname `EXTF_` aus **einer** Stelle (B1 bis B11) | 4 | Ohne das ist alles Weitere unsichtbar. |
| 3 | **Format beweisen**: Validator aus `Format_Buchungsstapel.xml` erzeugen, Bytevergleich gegen `EXTF_Buchungsstapel.csv`, Integrationstests in die CI (F12) | 2 | Sonst wiederholt sich der Zustand, dass jeder Fehler grün durchläuft. |
| 4 | **Zahlungsart kontieren**: `transaction_payments` lesen, Sollkonto je Zahlart, Geldtransit je Akzeptanzweg (F1) | 2 | Der erste Punkt, den ein Prüfer nachrechnet, und ein formeller Mangel nach BMF 16.08.2017. |
| 5 | **§ 25a aufteilen**: Einkaufsanteil auf 8193, Marge auf 8191, Regel `max(0, VK − EK)`, keine Verrechnung (F2) | 2 | Das Kerngeschäft dieses Ladens erzeugt heute null Umsatzsteuer im Stapel. |
| 6 | **Zeitraumroute** mit Wirtschaftsjahresschnitt, ZIP, Deckblatt, Liste mit `von` und `bis` (Abschnitt 5) | 3 | Basels ausdrückliche Forderung. |
| 7 | **Kassenbewegungen und Betriebsausgaben** in den Stapel, Privatentnahme und Barausgabe als Bewegungsart ergänzen (F8, K2) | 3 | Ohne sie kann das Kassenkonto nie mit der Schublade übereinstimmen. |
| 8 | **Kassenbericht retrograd** mit Anfangsbestand, Einnahmen, Ausgaben, Entnahmen, Einlagen, Marge, Storno-Betrag, Zähler und Abschließer, Kettenanker (K1, K3, K4, K5, K7, K8) | 3 | Das Blatt, das der Prüfer in die Hand bekommt. |
| 9 | **Kontenrahmen als Konfiguration**, SKR03 und SKR04, Feld 27, Sachkontenlänge (F3 teilweise, `closing-export.ts:113`) | 2 | Sonst ist jeder Beraterwechsel eine neue Programmfassung. |
| 10 | **Unbekannte Steuerbehandlung bricht ab** statt auf 8400 zu fallen, `REVERSE_CHARGE_13B` und `MIXED` sauber führen (F3) | 1 | Kleiner Griff, verhindert eine Steuer, die niemand schuldet. |
| 11 | **Web-Kanal trennen** und die Online-Steuerrechnung mit der Kasse in Deckung bringen (F6, F7) | 2 | Zwei Wahrheiten für denselben Verkauf. |
| 12 | **Tagebucheintrag je Export** und die falschen Zusagen in Quelltext und Verfahrensdokumentation streichen (F11) | 1 | Die Dokumentation sagt heute etwas Unwahres. |
| 13 | **Ehrliche TSE-Zeile** und das grüne Siegel entkoppeln (F9) | 1 | Hängt an der TSE-Anbindung, kann aber sofort ehrlich „nicht gemessen" sagen. |
| 14 | **Kleinigkeiten**: `notes` durchreichen (F10), Marke für den Kassenbericht (Abschnitt 3c), Datumsschreibweise auf dem Papier (K12), druckbares Blatt verdrahten (K11), Knöpfe im Zustand COUNTING sperren | 2 | Summiert sich zum ersten Eindruck. |

**Summe: 29 halbe Tage, also gut vierzehn Arbeitstage**, ohne den Testimport beim Berater und ohne die TSE.

---

## 7. Was nur Basel oder der Steuerberater entscheiden kann

1. Wie lautet die **Beraternummer**, unter der wir liefern sollen?
2. Wie lautet die **Mandantennummer** dieses Ladens in Ihrem Bestand?
3. Wie viele Stellen hat Ihr **Sachkontenrahmen**, vier bis acht?
4. Führen Sie diesen Mandanten in **SKR03 oder SKR04**?
5. Beginnt das **Wirtschaftsjahr** am 1. Januar, oder weicht es ab?
6. Sollen wir die Differenzbesteuerung auf **8193 und 8191** (bzw. 4138 und 4136) aufteilen, oder benennen Sie andere Konten?
7. Sind Ihre Erlöskonten **Automatikkonten**, sodass wir Feld 9 leer lassen sollen, oder wollen Sie einen BU-Schlüssel mitgeliefert bekommen?
8. Welches **Erlöskonto** sollen wir für steuerfreies Anlagegold nach § 25c UStG benutzen?
9. Welches **Wareneingangskonto** für differenzbesteuerungsfähige Ware, und welches für rohes Edelmetall, das nach § 25a Abs. 1 Nr. 3 ausgeschlossen ist?
10. Welche **Geldtransitkonten** sollen wir je Akzeptanzweg führen, also Girocard, Kreditkarte, SumUp, Stripe, Mollie?
11. Wollen Sie den Stapel **festgeschrieben** (Feld 21 und 114 auf `1`) oder offen (`0`), um vor der Festschreibung selbst korrigieren zu können?
12. Wollen Sie **je Beleg** buchen oder **je Tag verdichtet** nach Steuersatz und Zahlungsart?
13. Sollen wir einen Storno als **getauschtes Soll und Haben** liefern oder als **Generalumkehr** in Feld 118?
14. Sollen wir **Kassendifferenzen** auf 2309 und 2709 (bzw. 6969 und 4839) buchen, und wie behandeln Sie sie umsatzsteuerlich?
15. Sollen wir die im System erfassten **Betriebsausgaben** mitliefern, oder erfassen Sie sie weiterhin selbst aus den Belegen?
16. Nutzen Sie **DATEV Unternehmen online**, sodass wir den Beleglink in Feld 20 füllen sollen?
17. Setzen Sie **DATEV Kostenrechnung** ein, sodass KOST1 sinnvoll ist?
18. An Basel: **Wurde die Mitteilung nach § 146a Abs. 4 AO** für diese Betriebsstätte abgegeben? Die Frist für vor dem 01.07.2025 angeschaffte Systeme lief am 31.07.2025 ab, also vor einem Jahr.

---

## 8. Ungeprüft geblieben, und warum das zählt

- **Keine einzige erzeugte Datei ist je gegen DATEV selbst gelaufen.** Das Prüfprogramm DATEV-Format 2.2.3.0 ist eine Windows-Anwendung und auf diesem Mac nicht lauffähig. Prüfbar bleibt der maschinenlesbare Teil, `Formate/Format_Buchungsstapel.xml` mit den 125 Felddefinitionen. Ein **Testimport beim echten Steuerberater** bleibt der einzige Beweis, und er hat nie stattgefunden.
- **Widerspruch im Belegdatum:** das DATEV-Portal schreibt für Feld 10 strikt `TTMM`, die Formatdefinition im Prüfprogramm trägt `TTMMJJJJ`. Näher an der CSV-Schnittstelle ist das Portal, aber bewiesen ist es nicht.
- **Widerspruch im Zeichensatz:** DATEVs Zeichensatzseite verlangt für Unicode eine Byte-Reihenfolge-Marke, zwei der sieben eigenen Musterdateien sind UTF-8 **ohne** Marke. Wir folgen der Regel, nicht der Musterdatei.
- **Die BU-Schlüssel 75 und 76** für die Differenzbesteuerung stammen aus Blogs. Eine DATEV-eigene Quelle war nicht zugänglich, die Steuerschlüsseltabelle liegt hinter Anmeldung. Nicht einbauen, bevor der Berater sie bestätigt.
- **Automatikkonto plus BU-Schlüssel:** weclapp sagt, auf Automatikkonten werde kein Schlüssel übergeben, epago hält 8400 plus Schlüssel 3 für den Normalfall. Beide sind Softwarehäuser, keine amtliche Stelle.
- **Die Kontenbezeichnungen 8200 und 8150** habe ich nur über buchungssatz.de geprüft, nicht über DATEV. Der Quelltextkommentar in `closing-export.ts:126` behauptet „confirmed by the Steuerberater (2026)"; das ist nicht prüfbar, und die Kontenbezeichnungen widersprechen ihm.
- **Der UStAE Abschn. 25a.1** nennt in der zugänglichen Fassung noch 500 Euro als Grenze der Gesamtdifferenz, das Gesetz seit 01.01.2025 **750 Euro**. Der Gesetzeswortlaut steht höher, aber der Wert gehört als datierter Parameter geführt, nicht als Konstante.
- **Der AEAO zu § 146 AO** in konsolidierter Fassung war nicht gegenlesbar, das amtliche Handbuch sperrte alle Abrufe. Zitiert ist die Fassung vom 19.06.2018.
- **DSFinV-K 2.4** stammt aus einem Spiegel; der Download beim BZSt lieferte HTML statt Archiv. Vor einer Zertifizierungsaussage das Original ziehen.
- **Die Meldungskennung REW04506** konnte in der Gegenprüfung nicht bestätigt werden. Die zugrunde liegende Anforderung an den Dateinamen ist belegt, die Kennung nicht.
- **Ob die TSE konfiguriert ist**, sagt keine Zahl in diesem System ehrlich. Solange `tse_failed_count` fest `0` ist, zeigt der Bildschirm für jeden Tag grün, auch wenn kein einziger Beleg signiert wurde. Ohne signierte Belege ist der Laden **nicht fiskalisch live**, unabhängig davon, wie gut der DATEV-Export wird.
- **Die 28 Integrationstests laufen nirgends.** `apps/api-cloud/package.json:15` schließt sie aus, kein Arbeitsablauf ruft `test:integration` auf. Jede Zahl der Form „N Tests grün" betrifft ausschließlich die Unit-Suite und sagt über die Steuer-Exporte nichts.