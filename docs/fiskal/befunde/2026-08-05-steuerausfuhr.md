# Steuer-Ausfuhr: Tiefenprüfung vom 05.08.2026

Sechs Prüfer, jeder Fund von einem Skeptiker angegriffen.
**24 bestätigt**, 1 widerlegt.

Basel wörtlich: „لسا في بعض المشاكل بل تصدير ملفات الضرايب … غوص وتعمق بل تطبيق وتفتيش كامل وعميق".

## 1. [P0] Das Wirtschaftsjahr im Kopf ist eine feste Einstellung, der Buchungstag wird nie dagegen geprüft — DATEV bucht in ein falsches Jahr

**Ort:** `apps/api-cloud/src/routes/closing-export.ts:941`  ·  **Dimension:** datev

**Was bricht**

Das Belegdatum ist nur vierstellig `TTMM`; das Jahr zieht DATEV aus Kopf-Feld 13, dem Wirtschaftsjahresbeginn. Der kommt unverändert aus `system_settings` und wird nirgends gegen `closing.business_day` gehalten. GEMESSEN: Einstellung `datev.wirtschaftsjahr_beginn` = 2026-01-01 (der Vorgabewert, den Wanderung 0115 auf den 1. Januar des LAUFJAHRES setzt), Ausfuhr des Abschlusses vom 15.03.2027. Ergebnis: Kopf-Feld 13 = 20260101, Kopf-Feld 15/16 = 20270315, Belegzeile Feld 10 = 1503. DATEV liest daraus den 15.03.2026 — ein Jahr, das beim Berater längst festgeschrieben ist. Der eigene Prüfer meldet null Befunde. Ab dem 1. Januar des zweiten Betriebsjahres ist damit JEDE Ausfuhr um ein Jahr verschoben, ohne dass jemand etwas anfasst. Trägt der Inhaber den Wert dann auf 2027 nach, kippt der Fehler auf die Gegenseite: der im Januar 2027 angeforderte Dezember-2026-Stapel landet im Dezember 2027. Ein fester Wert kann für beide Fälle nie stimmen.

**Beweis**

docs/fiskal/recherche/datev-format.md:203 wörtlich von DATEV: „Das Jahr wird immer aus dem Feld #13 des Headers ermittelt." — datev-format.ts:203 `f[12] = zuDatev8(mandant.wirtschaftsjahrBeginn, 'Wirtschaftsjahresbeginn');` — datev-mandant.ts:212 `wirtschaftsjahrBeginn: String(wjBeginn),` ohne jede Prüfung gegen den Zeitraum — Wanderung 0115 Zeile 89 bis 95 hält es selbst fest: „Dass dieser Wert eine feste Einstellung ist und nicht aus dem Belegdatum folgt, ist ein eigenständiger offener Punkt." Messung: Kopf `…;20260101;4;20270315;20270315;…`, Buchungszeile Feld 10 = `1503`, `nurFehler(pruefeBuchungsstapel(csv))` = `[]`.

**Vorschlag**

Den Wirtschaftsjahresbeginn nicht als Datum speichern, sondern nur den Beginn-MONAT/TAG (Regelfall 01-01) und daraus je Ausfuhr das Jahr rechnen, in dem `business_day` liegt. Zusätzlich einen harten Riegel vor `baueBuchungsstapel`: liegt `zeitraum.von` nicht im Fenster [WJ-Beginn, WJ-Beginn + 1 Jahr), wird KEINE Datei erzeugt. Denselben Vergleich als Regel in `datev-pruefer.ts` aufnehmen (Kopf-Feld 15 muss im Fenster von Kopf-Feld 13 liegen), damit der Widerspruch im Kopf überhaupt auffällt.

**Korrektur des Skeptikers**

Der Kern stimmt; drei Ergänzungen schärfen ihn.

(a) Der Erststart ist NOCH schlechter als beschrieben. `/Users/basel/norns-pos/apps/api-cloud/sidecar/erststart/referenz.sql:204` trägt den Wert nicht gerechnet, sondern als festen Text: `('datev.wirtschaftsjahr_beginn', '"2026-01-01"', ...)`. Ein Laden, der aus dieser Momentaufnahme aufgesetzt wird, startet also schon am ersten Tag mit 2026, unabhängig davon, welches Jahr gerade läuft. Der Befund nennt nur den gerechneten Vorgabewert aus Wanderung 0115.

(b) Die Verweigerungswand hilft hier ausdrücklich nicht. Seit Wanderung 0117 fehlen Berater- und Mandantennummer, der erste Export bricht mit `DATEV_MANDANT_FEHLT` ab und der Inhaber trägt beide ein. Der Wirtschaftsjahresbeginn steht dabei als bestätigungsloser Vorgabewert (`datev.platzhalter`) daneben und wird nie erzwungen. Wer die zwei Zahlen 2026 einträgt, hat 2027 dieselbe stille Verschiebung.

(c) Die Behebung ist enger und sicherer, als der Befund vermuten lässt: es gibt genau EINEN Stapelerzeuger, die Route je Abschluss (`closing-export.ts:793`), und ein Stapel trägt genau EINEN Tag. Eine Datei kann also nie eine Wirtschaftsjahresgrenze überspannen. Damit genügt: aus `closing.business_day` und dem eingestellten Monat/Tag des Wirtschaftsjahresbeginns das zutreffende Wirtschaftsjahr RECHNEN und Feld 13 daraus setzen — die Einstellung liefert dann nur noch Monat und Tag (Regelfall 01-01, abweichendes Wirtschaftsjahr etwa 07-01), nie mehr das Jahr. Zusätzlich gehört in `pruefeBuchungsstapel` eine feldübergreifende Regel, die Feld 15 und 16 gegen das durch Feld 13 aufgespannte Zwölfmonatsfenster hält; heute meldet der eigene Prüfer bei dieser Lage nachweislich `[]`.

---

## 2. [P0] Ankaufbeleg: Bonkopf positiv, Zahlung negativ — die Querrechnung je Beleg bricht

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:549`  ·  **Dimension:** dsfinvk

**Was bricht**

Ein Ankauf von Privat über 500,00 EUR bar. Gemessen am echten Erzeuger (`formeDaten` plus `baueAlleDateien`, amtliche `index.xml`): `transactions.csv` trägt für RCP-2026-000295 `UMS_BRUTTO` = 500,00 und `lines_vat.csv` `POS_BRUTTO` = 500,00, `datapayment.csv` trägt für denselben Beleg `ZAHLWAEH_BETRAG` = -500,00. Belegkopf und Zahlung des GLEICHEN Bons weichen um 1.000,00 EUR ab. Genau diese Rechnung ist die erste, die ein Prüfer macht, und der eigene Wächter macht sie auch — nur nie an einem Ankauf.

**Beweis**

dsfinvk-daten.ts:549 kehrt NUR die Zahlung um: `betrag: r.direction === 'ANKAUF' ? negativ(betrag(p.amountEur)) : betrag(p.amountEur)`. Zeile 313 füllt den Kopf ungedreht: `umsatzBrutto: betrag(r.totalEur)`, ebenso die Positionen (Zeile 364 `stueckBrutto`, 367-373 `positionsUst`). Der Wächter tests/unit/dsfinvk-paket-haelt-zusammen.test.ts:168-178 prüft wörtlich `expect(zahl, 'Zahlungen').toBe(kopf)` — seine Vorlage hat aber `grossAnkaufEur: '0.00'` und KEINEN Ankaufbeleg (Zeile 53). Er ist grün, weil er den Fall nicht kennt. Gemessene Rohwerte meiner Sonde: `ankaufBonKopf: ['500,00']`, `ankaufBonZahlung: ['-500,00']`.

**Vorschlag**

Die Richtung an EINER Stelle entscheiden, nicht je Datei. Entweder trägt der Ankauf durchgängig negierte Beträge (Kopf, Positionen, Positions-USt, Beleg-USt, Preisfindung, Zahlung) — das entspricht `GV_TYP` „Auszahlung", also Geld verlässt die Kasse — oder durchgängig positive. Anschliessend die Vorlage in dsfinvk-paket-haelt-zusammen.test.ts um einen Ankaufbeleg erweitern, damit die vorhandene Querrechnung den Fall wirklich misst.

**Korrektur des Skeptikers**

Drei Präzisierungen, damit niemand am falschen Ort sucht:

1. Die Belegnummer RCP-2026-000295 ist irreführend. In der echten Vorlage von `tests/unit/dsfinvk-paket-haelt-zusammen.test.ts` ist das der VERKAUFS-Storno (Zeile 76 ff.), nicht ein Ankauf. Die Nummer stammt aus dem Sondenaufbau, nicht aus dem Baum. Meine eigene Messung nutzt RCP-2026-000900; die Zahlen 500,00 gegen -500,00 sind identisch.

2. „Zeile 53" beim Wächter zeigt nur `grossAnkaufEur: '0.00'`. Die eigentliche Blindheit sitzt in der Belegliste, Zeilen 60 bis 108: drei Belege, alle `direction: 'VERKAUF'`.

3. Wichtig für den, der es behebt: die Behebung ist NICHT nur ein Vorzeichen in `dsfinvk-daten.ts`. Wer den Kopf negiert, macht `tests/integration/szenario-kreuzprobe.test.ts` ROT, weil dort für den Ankaufbeleg B11 ausdrücklich `UMS_BRUTTO` = '77,77' positiv und die Summe 375824 + 57777 zugesagt sind. Die widersprüchliche Zusage gehört mit derselben Änderung aufgelöst, und der Wächter braucht endlich einen Ankaufbeleg in seiner Vorlage, sonst bleibt er auch nach der Behebung blind. Der Umfang ist ausserdem breiter als der Befund sagt: falsch stehen KOPF, POSITIONEN (`lines.csv` STK_BR), `lines_vat.csv` und `transactions_vat.csv` — vier Dateien, nicht nur der Kopf.

---

## 3. [P0] Der Ankauf fehlt vollständig im Kassenabschluss: businesscases.csv, payment.csv und Z_SE_BARZAHLUNGEN kennen ihn nicht

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:592`  ·  **Dimension:** dsfinvk

**Was bricht**

Derselbe Tag: Verkauf 270,00 bar, Ankauf 500,00 bar. Gemessen: Summe der Einzelzahlungen in `datapayment.csv` = -230,00, aber `payment.csv` weist `Z_ZAHLART_BETRAG` Bar = 270,00 aus und `cashpointclosing.csv` `Z_SE_ZAHLUNGEN` = 270,00, `Z_SE_BARZAHLUNGEN` = 270,00. Die Summe der Bonköpfe ist 770,00, `businesscases.csv` weist nur 270,00 aus — eine Zeile `GV_TYP` „Auszahlung" existiert dort NICHT, obwohl `lines.csv` sie für denselben Beleg trägt. Der Datenträger behauptet dem Finanzamt 270,00 EUR Bareinnahme, während die Lade an dem Tag 230,00 EUR verloren hat: 500,00 EUR Abweichung an EINEM Ankauf, und der Ankauf ist bei einem Edelmetallhändler fast jeder Tag.

**Beweis**

dsfinvk-daten.ts:592 `Object.entries(closing.paymentsByMethod)`, :601 `Object.entries(closing.vatByTreatment)` mit fest `gvTypFuer('VERKAUF')` in Zeile 605, :629 `summeZahlungenCent` und :633 `barCent` — alle drei lesen dieselben Abschlussfelder. Diese Felder sind in closings-finalize.ts VERKAUFSREIN gebildet: Zeile 340-344 `SELECT tp.payment_method … WHERE berlin_business_day(t.finalized_at) = ${day}::date AND t.direction = 'VERKAUF'`, ebenso `vat_by_treatment` (Zeile 301-311) und `umsatz_by_treatment` (Zeile 323-336). Die amtliche index.xml beschreibt `Z_SE_BARZAHLUNGEN` als „Summe aller Barzahlungen", nicht als Summe der Verkaufsbarzahlungen. Kein Test des Pakets rechnet payment.csv gegen datapayment.csv.

**Vorschlag**

Die Summendateien aus DERSELBEN Grundlage bilden wie die Einzelaufzeichnung, also aus den `receipts` des Bündels, nicht aus den verkaufsreinen Abschlussfeldern — genau wie es `kopfSumme` in closing-export.ts für Brutto und Netto schon tut. Mindestens: `zahlartSummen` aus `d.zahlungen` summieren und `geschaeftsvorfaelle` um eine Zeile je `gvTypFuer(richtung)` ergänzen. Dann einen Wächter setzen, der Summe(`datapayment`) gegen `payment.csv` und gegen `Z_SE_ZAHLUNGEN` stellt, und Summe(`businesscases`) gegen Summe(`transactions`).

**Korrektur des Skeptikers**

Zwei Angaben des Befundes sind zu schaerfen, beide zu Lasten des Systems. ERSTENS ist die Aussage "Kein Test des Pakets rechnet payment.csv gegen datapayment.csv" nur fuer die Unit-Tests wahr. Es gibt sehr wohl einen Test, der die Stelle beruehrt, und er PINNT den falschen Wert als Sollzustand: tests/integration/szenario-kreuzprobe.test.ts:1412 behauptet expect(Z_SE_BARZAHLUNGEN).toBe(SOLL.verkaufJeZahlart.CASH), also ausdruecklich die verkaufsreine Barsumme, und zwar direkt unter einem Kommentar, der dasselbe Feld als "Summe aller Zahlungen des Tages" beschreibt. Derselbe Test haelt die businesscases-Luecke ab Zeile ~1487 schriftlich fest: der Ankauf mit GV_TYP "Auszahlung" stehe in transactions.csv und lines.csv, "aber in keiner Tagessumme. Das ist gemeldet und gehoert in eine Aenderung an src/". Die Luecke ist also gesehen, aufgeschrieben und nie geschlossen worden. Zusaetzlich laeuft dieser Test im Regellauf gar nicht: package.json:15 setzt "test": "vitest run --passWithNoTests --exclude '**/tests/integration/**'". ZWEITENS widerspricht die Dokumentation dem Code an genau dieser Stelle: lib/dsfinvk-export.ts:565-575 behauptet, Z_SE_ZAHLUNGEN und Z_SE_BARZAHLUNGEN wuerden AUS datapayment.csv gebildet ("werden daraus gebildet") - gebildet werden sie in Wahrheit aus den verkaufsreinen Abschlussspalten. Wer die Datei liest, haelt den Weg fuer richtig, obwohl er es nicht ist.

---

## 4. [P0] Storno und Retoure tragen keine Schicht: die Bargeldrückgabe fehlt im Blindsturz und erzeugt eine erfundene Kassendifferenz

**Ort:** `apps/api-cloud/src/routes/transactions-storno.ts:233`  ·  **Dimension:** kassenbericht

**Was bricht**

Verkauf 119,00 EUR bar um 10:00 auf Schicht S. Um 15:00 storniert die Kassiererin denselben Beleg und gibt 119,00 EUR bar aus der Schublade zurück. Beim Schichtschluss rechnet die Route erwartet = Anfangsbestand + 119,00 (der Verkauf trägt `shift_id` = S), denn die negative Zahlungszeile des Stornos trägt `shift_id` NULL und fällt aus der Summe. In der Schublade liegt nur der Anfangsbestand. `variance_eur` = -119,00. Der Tagesabschluss übernimmt das nach `cash_drawer_variance_eur`, und der Kassenbericht druckt "Kasse;Differenz;-119,00 EUR" — ein Kassenfehlbetrag, den es nie gab. Ein Fehlbetrag dieser Grösse ist bei einer Kassennachschau nach § 146b AO der klassische Anlass für eine Schätzung nach § 162 AO. Bei der Retoure (transactions-return.ts:138) gilt dasselbe wörtlich.

**Beweis**

transactions-storno.ts:233 `.insert(transactions).values({ direction, finalizedAt, customerId, deviceId, cashierUserId, subtotalEur, vatEur, totalEur, taxTreatmentCode, stornoOfTransactionId, notesInternal })` — kein `shiftId`. Die gespiegelten Zahlungszeilen entstehen bei 279 `.insert(transactionPayments).values(... amountEur: negateDecimalString(p.amountEur) ...)` und hängen an dieser schichtlosen Kopfzeile. Der Verbraucher, shifts.ts:377-382: `(SELECT COALESCE(SUM(tp.amount_eur), 0)::text FROM transaction_payments tp JOIN transactions t ON t.id = tp.transaction_id WHERE t.shift_id = ${s.id} AND t.direction = 'VERKAUF' AND tp.payment_method = 'CASH') AS cash_sales`. `transactions.shift_id` ist nullbar ohne DEFAULT (0019_retail_compliance.sql:394 `ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES shifts(id)`), es gibt keinen Trigger, der nachträgt. Dass die Spalte genau dafür da ist, steht in transactions-finalize.ts:741-744: "Attribute the sale to the shift it was actually rung on, so the end-of-day cash drawer reconciliation (Blindsturz) and the Z-Bon can see this sale's cash leg. Without shift_id the shift-close expected balance was always wrong". Kein grüner Test deckt das ab: nur szenario-stripe-terminal.test.ts:571 und szenario-geldweg.test.ts:803 gehen über die echte Route `/api/shifts/:id/close`, und beide Tage tragen keinen Storno. Jedes Stornoszenario (szenario-storno.test.ts:210, szenario-kreuzprobe.test.ts:812, szenario-rundung.test.ts:776) schreibt `system_expected_eur` von Hand in ein direktes INSERT und umgeht die Rechnung vollständig.

**Vorschlag**

Im Storno und in der Retoure `shiftId` setzen — vorzugsweise die Schicht des Originals (`original.shiftId`), sonst die offene Schicht des Geräts wie in transactions-finalize.ts:758-766. Ergänzend ein Integrationstest, der auf einem Tag mit Barverkauf UND Barstorno die Schicht über `POST /api/shifts/:id/close` schliesst und `systemExpectedEur` sowie `varianceEur` prüft. Solange die Storno-Zahlungszeilen schichtlos bleiben, ist jede Kassendifferenz auf einem Storno-Tag falsch.

**Korrektur des Skeptikers**

Der Satz "Bei der Retoure (transactions-return.ts:138) gilt dasselbe woertlich" ist zu streichen bzw. abzuschwaechen. Die Route weist bei transactions-return.ts:120 alles ausser salesChannel === 'WEB' zurueck, und WEB-Vorgaenge entstehen ausschliesslich im storefront-webhook.ts:590 — dort wird weder eine Schicht gesetzt noch eine Barzahlung gebucht. Original UND Spiegel liegen also beide ausserhalb jeder Schicht, die Summe bleibt ausgeglichen, es entsteht KEINE erfundene Kassendifferenz. Die Retoure-Route laesst shiftId zwar ebenfalls weg, das ist aber heute folgenlos. Der P0 gehoert allein dem Storno.

---

## 5. [P0] DSFinV-K: der Abschlusskopf kennt nur Verkaufszahlungen, die Belegdatei auch die Ankaufsauszahlungen

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:629`  ·  **Dimension:** geldabgleich

**Was bricht**

Ein Tag mit einem Verkauf ueber 119,00 EUR bar und einem Ankauf ueber 500,00 EUR bar. Gemessen an `formeDaten`: `datapayment.csv` traegt CASH +119,00 und CASH -500,00, Summe -381,00 EUR. Im selben Buendel steht `payment.csv` (Z-Zahlart) auf CASH 119,00 und `cashpointclosing.csv` auf Z_SE_ZAHLUNGEN 119,00 sowie Z_SE_BARZAHLUNGEN 119,00. Abweichung genau 500,00 EUR, also der ganze Ankauf. Die erste Rechnung, die ein Pruefer bei einer Datentraegerueberlassung macht, ist Summe Bonzahlung gegen Zahlartensumme gegen Kopfsumme, und die geht nicht auf. Fuer einen Edelmetallhaendler betrifft das fast jeden Tag.

**Beweis**

`dsfinvk-daten.ts:592` `const zahlartSummen = Object.entries(closing.paymentsByMethod).map(...)` und `:629` `const summeZahlungenCent = Object.values(closing.paymentsByMethod).reduce(...)`, `:633` `const barCent = zuCentGlobal(closing.paymentsByMethod['CASH'] ?? '0')`. Die Quelle `daily_closings.payments_by_method` entsteht in `closings-finalize.ts:343` mit `WHERE berlin_business_day(t.finalized_at) = day AND t.direction = 'VERKAUF'`. Die Einzelzeilen dagegen entstehen in `dsfinvk-daten.ts:549` fuer JEDEN Beleg: `betrag: r.direction === 'ANKAUF' ? negativ(betrag(p.amountEur)) : betrag(p.amountEur)`. Die mitgelieferte Norm, `apps/api-cloud/src/fiskal/dsfinvk-2.4/index.xml`, beschreibt Z_SE_ZAHLUNGEN woertlich als "Summe aller Zahlungen". Kein Test deckt es ab: `tests/integration/szenario-kreuzprobe.test.ts:1408` schreibt im Kommentar "Z_SE_ZAHLUNGEN ist die Summe aller Zahlungen des Tages" und prueft in Zeile 1411 trotzdem nur gegen den Verkaufsbrutto nach Storno, obwohl derselbe Test in Zeile 1210 die echte Summe ueber alle Belege mit -23.071 Cent bereits berechnet hat. Gruen aus dem falschen Grund.

**Vorschlag**

Die Zahlungssummen des Abschlusses ueber ALLE Belege des Tages bilden, nicht nur ueber die Verkaufsseite. Entweder `payments_by_method` in `closings-finalize.ts` ohne den Richtungsfilter aggregieren, Ankaufsbetraege negiert wie die Belegzeile es schon tut, und die Verkaufsseite als eigene Spalte fuehren; oder `zahlartSummen`, `summeZahlungen` und `summeBarzahlungen` in `formeDaten` aus `receipts[].payments` summieren statt aus `closing.paymentsByMethod`. Danach eine Zusage in der Kreuzprobe, die die Summe aus `datapayment.csv` gegen `payment.csv` und gegen Z_SE_ZAHLUNGEN stellt, je Zahlart und in Summe.

**Korrektur des Skeptikers**

Zwei Präzisierungen, die den Kern nicht ändern:

(a) Betroffen sind DREI Stellen desselben Kopfes, nicht zwei: `Z_SE_ZAHLUNGEN` (`:629`), `Z_SE_BARZAHLUNGEN` (`:633`) UND die Datei `payment.csv` als Ganzes (`:592`, geschrieben in `lib/dsfinvk-dateien.ts:377-384`). Eine reine Ankaufszahlart, die an keinem Verkauf des Tages vorkommt, fehlt in `payment.csv` sogar komplett als Zeile, nicht nur betragsmässig.

(b) Dieselbe Wurzel trifft eine weitere Datei, die der Befund nicht nennt: `dsfinvk-daten.ts:601-616` setzt `gvTyp: gvTypFuer('VERKAUF')` fest und iteriert über `closing.vatByTreatment` / `umsatzByTreatment`, die in `closings-finalize.ts:309` und `:333` ebenfalls hart auf `direction = 'VERKAUF'` filtern. Damit fehlt die Ankaufsseite auch in `businesscases.csv`. Das ist ein eigenständiger Folgebefund derselben Ursache, sollte aber bei der Behebung mitgedacht werden, sonst geht die zweite Prüferrechnung (Geschäftsvorfälle gegen Belege) weiterhin nicht auf.

---

## 6. [P0] Ein Abschluss älter als die 90 neuesten ist über die GANZE HTTP-Fläche unerreichbar — und die Kasse meldet ihn als „nicht vorhanden"

**Ort:** `apps/api-cloud/src/routes/closing-export.ts:772`  ·  **Dimension:** routen

**Was bricht**

Ein Laden mit täglichem Geschäft hat nach rund 90 festgeschriebenen Kassentagen (ca. dreieinhalb Monate) den 91. und jeden älteren Abschluss aus der Liste verloren. Alle drei Steuer-Exporte brauchen die Abschluss-`id`, und die gibt es NUR aus `GET /api/closings`. Gemessen im Quelltext: es existieren genau vier Abschluss-Routen (`/api/closings`, die drei Exporte) plus `POST /api/closings/finalize`; keine nimmt einen Geschäftstag, ein Datumsfenster oder eine Blätterung entgegen, und `grep -rn 'FROM daily_closings' src/routes` bestätigt, dass keine andere Route eine id herausgibt. Lage: der Prüfer steht am 05.08.2026 im Laden und verlangt nach § 146b AO das DSFinV-K-Paket für März. Der Inhaber wählt den Zeitraum, die Kasse holt `GET /api/closings`, findet den Tag in den 90 Zeilen nicht und meldet mit voller Bestimmtheit „Keine abgeschlossenen Kassentage im Zeitraum — Ein Tag zählt erst, wenn er abgeschlossen wurde." (SteuerComplianceSection.tsx:255). Für den Kassenbericht lautet derselbe falsche Satz „Für diesen Tag liegt kein abgeschlossener Kassenbericht vor." (Zeile 417), für DATEV „Keine abgeschlossenen Kassentage im Monat" (Zeile 508). Der Abschluss ist in `daily_closings` FINALIZED vorhanden; die Aussage ist unwahr. § 147 AO verlangt zehn Jahre Abrufbarkeit — hier sind es drei Monate.

**Beweis**

closing-export.ts:760-773:
```
const rows = (await app.db.execute<ClosingRow>(sql`
  SELECT id::text AS id, business_day::text AS business_day, ...
    FROM daily_closings
   ORDER BY business_day DESC
   LIMIT 90
`)) as unknown as ClosingRow[];
```
Kein `from`/`to`, kein `offset`, kein `businessDay`-Parameter — das Schema der Route hat gar keine `querystring`. Und die drei Verbraucher lösen die id ausschliesslich daraus auf:
apps/tauri-pos/src/screens/secondary/SteuerComplianceSection.tsx:250 (DSFinV-K), :411-421 (Kassenbericht), :500-509 (DATEV), jeweils `const { items } = await closingsApi.list(api);` mit anschliessendem `.filter(...)` im Klienten.
Kein Test deckt das ab: in tests/integration/fiscal-export.test.ts kommt weder eine Blätterung noch die Zahl 90 vor.
Nebenbefund am selben Ort: der Kopfkommentar der Datei (Zeile 92) verspricht „The GET /:id info route stays available for previewing an open closing's state" — diese Route existiert nicht.

**Vorschlag**

`GET /api/closings` um `?from=&to=` (Berliner Geschäftstage) und eine ausdrückliche Blätterung erweitern, oder — kleiner und zielgenauer — die drei Exporte zusätzlich unter dem Geschäftstag erreichbar machen (`/api/closings/by-day/:businessDay/export/...`), damit kein Klient mehr eine id aus einer gekappten Liste suchen muss. Bis dahin muss die Kasse aufhören, „gibt es nicht" zu sagen, wo sie nur „steht nicht in den 90 neuesten" weiss. Wächter: einen Abschluss anlegen, 90 jüngere danebenlegen, und verlangen, dass der Export des ältesten weiterhin 200 liefert — heute wäre der Test ROT.

**Korrektur des Skeptikers**

Zwei Sätze im Befund sind zu scharf, der Rest bleibt wörtlich stehen.

1. Statt „über die GANZE HTTP-Fläche unerreichbar": über die vier Abschluss-Routen unerreichbar, und aus JEDER Oberfläche unerreichbar. Es bleibt genau ein Umweg, den niemand kennt und der in keinem Bildschirm verdrahtet ist: `GET /api/ledger?eventType=daily_closing.finalized&fromBusinessDay=…&toBusinessDay=…` liefert `entityId` — die gesuchte Abschluss-Kennung — weil ein Datenbank-Auslöser sie beim Festschreiben ins Tagebuch schreibt (`on_daily_closing_event()`, packages/db/migrations/0011_closing.sql:243). Diese Route ist ADMIN-only, der READONLY-Steuerberater kommt also gar nicht daran; und die Kasse fragt sie an dieser Stelle nie. Für den Inhaber vor dem Prüfer ändert das nichts, für die Beschreibung schon: es ist eine fehlende Blätterung plus eine lügende Meldung, kein vollständiger Datenverlust am Netzrand.

2. Statt „§ 147 AO verlangt zehn Jahre Abrufbarkeit — hier sind es drei Monate": die Daten sind vollständig da und werden nicht gelöscht, `daily_closings` wird nirgends beschnitten. Was nach rund 90 Abschlusszeilen endet, ist die Abrufbarkeit ÜBER DIE APP. Der Satz sollte lauten: nach etwa 90 Abschlusszeilen kann der Inhaber den Steuer-Export für ältere Tage nicht mehr auslösen, obwohl der Abschluss FINALIZED in der Datenbank steht — und die Kasse behauptet dabei das Gegenteil.

3. Kleine Genauigkeit: das `LIMIT 90` zählt Abschluss-ZEILEN, nicht festgeschriebene Tage. Eine liegengebliebene COUNTING-Zeile belegt einen der 90 Plätze mit.

4. Zur Schwere: der Defekt ist echt, aber heute latent. Auf der Produktion gab es im Juni 2026 laut dem Kommentar in closings-finalize.ts:152-155 genau EINEN Abschlusssatz im ganzen System. Die Lage tritt erst nach rund 90 festgeschriebenen Tagen ein. Mit dem ADMIN-Umweg über das Tagebuch und ohne Datenverlust würde ich P1 setzen, nicht P0 — die Meldung „Für diesen Tag liegt kein abgeschlossener Kassenbericht vor" ist aber unabhängig davon jetzt schon unwahr, sobald ein Tag ausserhalb der Liste liegt, und gehört so oder so behoben (Datumsfenster plus Blätterung auf `GET /api/closings`, Filter auf den Server statt in den Klienten).

5. Der Nebenbefund ist unverändert richtig: der Kopfkommentar in Zeilen 91-92 verspricht eine `GET /:id`-Route, die es nicht gibt.

---

## 7. [P0] DSFinV-K Bonkopf bucht den ANKAUF als POSITIVEN Umsatz — Tagesumsatz um den Ankaufsbetrag zu hoch

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:313`  ·  **Dimension:** echter-lauf

**Was bricht**

Gemessener Lauf, Geschäftstag 2026-06-01: ein Ankauf über 300,00 EUR bar. Im erzeugten Paket steht derselbe Beleg RCP-2026-000003 in `datapayment.csv` mit −300,00 (richtig, Auszahlung), aber in `transactions.csv` UMS_BRUTTO mit +300,00 und in `transactions_vat.csv` BON_BRUTTO mit +300,00000. Ein Prüfer, der `transactions.csv` summiert, liest 119,00 + 200,00 + 300,00 − 119,00 = 500,00 EUR Umsatz; der echte Verkaufsumsatz des Tages ist 200,00 EUR. Jeder Ankauf überzeichnet den erklärten Umsatz um seinen vollen Betrag.

**Beweis**

Erzeugte Bytes, transactions.csv Zeile 4:
`POS-1;2026-08-05T03:15:22.531Z;1;RCP-2026-000003;3;Beleg;;;0;...;300,00;;fbe1f373-...`
Dieselbe BON_ID in datapayment.csv:
`POS-1;...;RCP-2026-000003;Bar;CASH;EUR;-300,00;-300,00`
Quelle: `umsatzBrutto: betrag(r.totalEur),` (dsfinvk-daten.ts:313) — ohne die Richtungsumkehr, die 60 Zeilen tiefer für die Zahlung ausdrücklich gebaut wurde (Zeile 549: `betrag: r.direction === 'ANKAUF' ? negativ(betrag(p.amountEur)) : betrag(p.amountEur)`). Der Integrationstest ist GRÜN AUS DEM FALSCHEN GRUND: `tests/integration/szenario-kreuzprobe.test.ts:1449` pinnt `expect(ausDsfinvkAnkauf).toBe(SOLL.bruttoAnkauf)` mit `bruttoAnkauf: 57777n` POSITIV.

**Vorschlag**

`umsatzBrutto` (dsfinvk-daten.ts:313) sowie `brutto` in belegUst (transactions_vat) und `stkBr` in lines für `r.direction === 'ANKAUF'` durch dieselbe `negativ()`-Umkehr führen wie die Zahlung. Danach `szenario-kreuzprobe.test.ts` SOLL.bruttoAnkauf auf −57777n ziehen und eine Kreuzprobe ergänzen: Σ transactions.UMS_BRUTTO je BON_ID == Σ datapayment.BASISWAEH_BETRAG je BON_ID.

**Korrektur des Skeptikers**

Der Kern stimmt, die Zuschreibung ist zu eng. Drei Schärfungen:

ERSTENS, es ist nicht nur Zeile 313. Betroffen ist die ganze Umsatzseite eines Ankaufbelegs, gemessen: `transactions.csv` UMS_BRUTTO, `transactions_vat.csv` BON_BRUTTO, `lines_vat.csv` POS_BRUTTO und `lines.csv` STK_BR stehen alle positiv. Eine Behebung nur an Zeile 313 liesse drei Dateien weiter widersprechen und würde die Querrechnung Positionen-gegen-Kopf neu brechen.

ZWEITENS, die Wurzel liegt eine Ebene höher. `transactions-ankauf.ts:205` erzwingt `Ankauf total must be > 0`; die Datenbank hält Ankäufe bewusst als positive Grössen. `dsfinvk-daten.ts` ist die einzige Stelle, die die Richtung kennt, und dreht sie heute nur für die Zahlung (Zeile 549). Die Entscheidung ist also: entweder dreht `formeDaten` die Richtung für ALLE Beträge eines ANKAUF-Belegs, oder gar keinen — halb gedreht ist der jetzige Zustand.

DRITTENS, der stärkste Beweis ist nicht "ein Prüfer summiert transactions.csv", sondern die vom Repo selbst als Pflicht erklärte Gegenprobe. `tests/unit/dsfinvk-paket-haelt-zusammen.test.ts:166-178` verlangt je BON_ID `Summe datapayment.ZAHLWAEH_BETRAG == UMS_BRUTTO`. Auf einen Ankauf angewandt ergibt sie -30000 gegen +30000, also die doppelte Ankaufsumme Abstand INNERHALB eines Belegs. Ihr Prüfsatz enthält nur VERKAUF-Belege, deshalb läuft sie nie. Die Behebung gehört genau dorthin: EINEN Ankaufbeleg in diesen Prüfsatz aufnehmen, dann wird der vorhandene Wächter von allein rot.

Randnotiz, nicht Teil des Befundes: `cashpointclosing.csv` Z_SE_ZAHLUNGEN steht an einem reinen Ankaufstag korrekt bei -300,00, während GESAMT_BRUTTO_ANKAUF aus `gross_ankauf_eur` positiv kommt. Derselbe Vorzeichenbruch also auch zwischen Abschlusskopf und Zahlartensumme.

---

## 8. [P0] Ein Paket, drei verschiedene Zahlen für die Barzahlungen desselben Tages

**Ort:** `apps/api-cloud/src/routes/closings-finalize.ts:343`  ·  **Dimension:** echter-lauf

**Was bricht**

Gemessener Lauf 2026-06-01 (Verkauf 119,00 bar, Verkauf 200,00 bar, Ankauf −300,00 bar, Storno −119,00 bar): das ERZEUGTE Paket nennt die Barsumme dreimal verschieden. `cashpointclosing.csv` Z_SE_BARZAHLUNGEN = 200,00 · `payment.csv` Bar = 200,00 · Σ `datapayment.csv` Bar = 119,00 + 200,00 − 300,00 − 119,00 = −100,00 · `cash_per_currency.csv` EUR = 350,00. Die Summenprobe eines Prüfers (Zahlartensumme gegen Einzelaufzeichnung) scheitert um 300,00 EUR bei EINEM Ankauf; bei einem Edelmetallhändler ist das der Regelfall, nicht der Sonderfall.

**Beweis**

Erzeugte Bytes:
`cashpointclosing.csv`: `...;200,00;200,00` (Z_SE_ZAHLUNGEN;Z_SE_BARZAHLUNGEN)
`payment.csv`: `POS-1;...;1;Bar;CASH;200,00`
`cash_per_currency.csv`: `POS-1;...;1;EUR;350,00`
`datapayment.csv`: vier Zeilen 119,00 / 200,00 / −300,00 / −119,00
Ursache: `payments_by_method` filtert in `closings-finalize.ts:343` auf `AND t.direction = 'VERKAUF'`, `datapayment` führt alle Belege mit Vorzeichen (dsfinvk-daten.ts:549), `cash_per_currency` trägt den GEZÄHLTEN Bestand (dsfinvk-daten.ts:619: `: [{ waehrung: 'EUR', betrag: betrag(closing.cashCountedEur) }];`). Auch das ist GRÜN AUS DEM FALSCHEN GRUND: derselbe Test pinnt beide Zahlen getrennt — Zeile 1211 `expect(alle.get('CASH')).toBe(SOLL.verkaufJeZahlart.CASH - SOLL.ankaufBar)` und Zeile 1412 `expect(...Z_SE_BARZAHLUNGEN...).toBe(SOLL.verkaufJeZahlart.CASH)` — und vergleicht sie NIE miteinander.

**Vorschlag**

Z_SE_BARZAHLUNGEN und `payment.csv` aus DERSELBEN Quelle bilden wie `datapayment.csv`, also aus den Belegzahlungen mit Vorzeichen, nicht aus dem verkaufsgefilterten `payments_by_method`. Danach einen Wächter ergänzen, der im selben Bündel prüft: Σ datapayment je ZAHLART_NAME == payment.Z_ZAHLART_BETRAG, und Σ payment == Z_SE_ZAHLUNGEN. Wenn `cash_per_currency` bewusst den Sollbestand tragen soll (Kassensturzfähigkeit), muss das in der Verfahrensdokumentation stehen und darf nicht dieselbe Bezeichnung wie die Zahlartensumme führen.

**Korrektur des Skeptikers**

Der Kern stimmt, aber die dritte Zahl gehört nicht in denselben Vorwurf.

`cash_per_currency.csv` (Z_Waehrungen) trägt hier ABSICHTLICH den gezählten Kassenbestand (`dsfinvk-daten.ts:616-619`), und `szenario-kreuzprobe.test.ts:1577` pinnt das als gewollt. Ein Bestand ist begrifflich etwas anderes als eine Tagesbewegung; dass er 350,00 zeigt, ist für sich noch kein Widerspruch. Ob die Taxonomie an dieser Stelle den BESTAND oder die Barzahlungen je Währung erwartet (die Spaltennamen ZAHLART_WAEH / ZAHLART_BETRAG_WAEH deuten auf die Zahlart, nicht auf die Schublade), ist eine eigene, getrennt zu klärende Frage — kein Teil dieses Befunds.

Der Befund sollte deshalb lauten: ZWEI Zahlen für dieselbe Barbewegung, nicht drei. `payment.csv` und Z_SE_BARZAHLUNGEN sagen 200,00 (nur VERKAUF), `datapayment.csv` sagt −100,00 (alle Belege mit Vorzeichen). Die Abweichung ist exakt der Barankauf. Genau eine der beiden Zahlen kann richtig sein, und das Haus hat in `dsfinvk-export.ts:569` bereits entschieden welche: die Aggregate sind AUS `datapayment.csv` zu bilden. Der Fehler sitzt also im Filter `AND t.direction = 'VERKAUF'` in `closings-finalize.ts:343` (und damit auch in `payment.csv`), nicht im Vorzeichen von `datapayment.csv`.

Zusätzlich, beim Messen mitgesehen und im Befund nicht genannt: `transactions.csv` führt den Ankauf mit UMS_BRUTTO = +300,00, während seine Zahlung in `datapayment.csv` mit −300,00 steht. Die repo-eigene Belegquerrechnung in `dsfinvk-paket-haelt-zusammen.test.ts` (Zahlungen je Beleg müssen den Belegkopf ergeben) schlägt damit für JEDEN Ankauf fehl — sie läuft nur gegen eine Mappe ohne Ankauf und merkt es nicht. Das gehört in dieselbe Änderung, sonst behebt man eine Seite und reisst die andere auf.

---

## 9. [P1] Ein einziges Gutschein-Bein sperrt die DATEV-Ausfuhr des ganzen Tages dauerhaft — es gibt kein Konto, das der Inhaber dafür hinterlegen könnte

**Ort:** `apps/api-cloud/src/lib/datev-kontierung.ts:57`  ·  **Dimension:** datev

**Was bricht**

`KONTO_JE_ZAHLART` kennt `VOUCHER` nicht, also wirft `sollkontoFuerZahlart` mit 409 und die GANZE Tagesdatei entsteht nicht. `VOUCHER` ist aber keine tote Zahlart: die Kasse schreibt sie aktiv (`BezahlenDialog.tsx:1297` und `:1368` und `:1696`), das Eingabeschema lässt sie zu (`schemas/transaction.ts:39`), DSFinV-K und Kassenbericht behandeln sie sauber. GEMESSEN: ein Beleg über 100,00 EUR, bezahlt mit 20,00 Gutschein und 80,00 bar, führt zu `ZahlartNichtKontiertError` — kein Ergebnis, keine Datei, für ALLE Belege des Tages. Der Text der Meldung rät „lassen Sie sich von Ihrem Steuerberater das passende Konto nennen", aber es gibt keinen Ort, ihn einzutragen: `KontoId` in `kontenrahmen.ts` enthält kein Gutschein-Konto, also erzeugt `kontoSchluessel` auch keinen Einstellungsschlüssel. Der Tag ist damit für den Steuerberater unlieferbar, während derselbe Tag als DSFinV-K herausgeht — die zwei amtlichen Ausfuhren widersprechen sich darin, ob der Tag überhaupt abgabefähig ist.

**Beweis**

datev-kontierung.ts:57-70 (`CASH`, `ZVT_CARD`, `SUMUP`, `MOLLIE`, `STRIPE`, `STRIPE_TERMINAL`, `EBAY`, `BANK_TRANSFER` — kein `VOUCHER`), :113 `VOUCHER: 'Gutschein',` nur als Klartext für die Fehlermeldung, :122 `throw new ZahlartNichtKontiertError(...)`. Gegenprobe: `apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx:1297` `paymentMethod: 'VOUCHER'`; `apps/api-cloud/src/lib/dsfinvk-schluessel.ts:272` `case 'VOUCHER':`. Messung: der Aufruf wirft `ZahlartNichtKontiertError` mit „Für die Zahlart „Gutschein" ist kein Buchungskonto hinterlegt".

**Vorschlag**

Ein logisches Konto `gutschein` (SKR03 1710 beziehungsweise SKR04 3270 „erhaltene Anzahlungen / Verbindlichkeiten aus Gutscheinen", vom Steuerberater zu bestätigen) in `KontoId`, `KONTO_DEFINITIONEN`, beide `VORLAGE`-Tabellen und `KONTO_JE_ZAHLART` aufnehmen, mit ehrlichem `VORSCHLAG`-Merkmal und `QUELLE`-Eintrag wie bei den übrigen. Dasselbe für `DEBT` und `TRADE_IN` prüfen, bevor sie über eine andere Route in `transaction_payments` landen. Bis das Konto steht, muss die Meldung sagen, dass die Zahlart im Erzeugnis noch keinen Platz hat — nicht, der Inhaber solle etwas eintragen, das er nirgends eintragen kann.

**Korrektur des Skeptikers**

Zwei Präzisierungen, die den Kern nicht antasten, aber die Dringlichkeit richtig einordnen:

(a) Die Lage ist bisher LATENT, nicht laufend eingetreten. In derselben Quelle steht eine Zählung vom 29.07.2026 (`lib/dsfinvk-schluessel.ts:286-288`): `transaction_payments` auf der Produktion trägt CASH 65 und ZVT_CARD 1, in der Simulation t900 CASH 63, ZVT_CARD 7, BANK_TRANSFER 7 — NULL Zeilen mit `VOUCHER`. Der Satz „Der Tag ist damit unlieferbar" gilt also nicht für einen heute existierenden Tag, sondern für den ERSTEN Tag, an dem ein Gutschein eingelöst wird. Die Falle ist scharf und die Auslösung ist reine Zeitfrage, weil das Gutscheinfeld in der Kasse ausgeliefert ist; sie ist nur noch nicht zugeschnappt.

(b) Der Wurf selbst ist Absicht und durch zwei grüne Tests gepinnt (der stille Rückfall auf Konto 1000 Kasse ist genau der Fehler, den die Datei behebt). Die Lücke ist NICHT der Abbruch, sondern das fehlende dritte Stück: es gibt kein logisches Konto für Gutscheine. Die Behebung gehört deshalb in `kontenrahmen.ts` — ein `KontoId` wie `verbindlichkeitenGutscheine` mit `schluesselTeil` und Vorlagenzahlen für SKR03 und SKR04, dann der Eintrag in `KONTO_JE_ZAHLART`. Den Wurf zu entfernen oder auf die Kasse zurückzufallen wäre die falsche Reparatur. Nebenbei: `DEBT` und `TRADE_IN` sind anders gelagert und NICHT betroffen — sie stehen nicht im API-Schema `PaymentMethod` und kommen über HTTP gar nicht herein; nur `VOUCHER` ist der lebende Fall.

---

## 10. [P1] cash_per_currency.csv trägt den gezählten Kassenbestand statt der Barzahlungen

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:616`  ·  **Dimension:** dsfinvk

**Was bricht**

Wechselgeld 1.000,00 in der Lade, Verkauf 270,00 bar, Ankauf 500,00 bar. Der Blindsturz zählt 770,00. Gemessen schreibt der Erzeuger `cash_per_currency.csv` ZAHLART_BETRAG_WAEH = 770,00, während `cashpointclosing.csv` im selben Paket `Z_SE_BARZAHLUNGEN` = 270,00 sagt. Zwei Zahlen für die Barbewegung desselben Abschlusses, keine davon ist die wahre (-230,00). Der Anfangsbestand der Lade wird damit als Zahlungsbetrag ausgewiesen.

**Beweis**

dsfinvk-daten.ts:616-619 `const kassenlade: KassenladeZeile[] = closing.cashCountedEur === null ? [] : [{ waehrung: 'EUR', betrag: betrag(closing.cashCountedEur) }]`. `cashCountedEur` ist `cash_drawer_counted_eur`, und das ist der Blindsturz: closings-finalize.ts:424 `const countedCents = eigenerSturz ? toCents(sturz!.counted) : null`, gespeist aus `SUM(blind_count_eur)` (Zeile 386). Migration 0019_retail_compliance.sql:146-148 beschreibt die Spalte wörtlich als „Blind cash count entered by the cashier", also den Inhalt der Lade einschliesslich Wechselgeld. Der Quelltext gesteht die offene Frage selbst ein (dsfinvk-dateien.ts:390-392), sie ist nur nie entschieden worden.

**Vorschlag**

`cash_per_currency.csv` aus den BARZAHLUNGEN je Währung bilden (Summe der `datapayment`-Zeilen mit `ZAHLART_TYP` = Bar), damit sie mit `Z_SE_BARZAHLUNGEN` auf den Cent zusammenfällt. Der gezählte Bestand und die Differenz gehören nicht dorthin; wenn sie ins Paket sollen, dann als eigener Geschäftsvorfall `DifferenzSollIst` in businesscases.csv, wie Anhang C ihn vorsieht.

**Korrektur des Skeptikers**

Der Kern stimmt, drei Stellen gehoeren praeziser.

(a) NORMLAGE NICHT SO EINDEUTIG. Der Befund behauptet, `cash_per_currency.csv` traege "die Barzahlungen". Die mitgelieferte amtliche index.xml sagt dazu nur "Betrag". Die hauseigene Recherche docs/fiskal/recherche/pruefer-und-kassenbericht.md:100 zitiert die Norm mit "Damit stellt diese Datei eine jederzeitige Kassensturzfaehigkeit her" — das stuetzt eher die Bestands-Lesart. Der Fund darf also nicht als "falscher Wert" verkauft werden, sondern als UNENTSCHIEDENE Auslegung, die der Quelltext selbst offen laesst.

(b) DER UNWIDERLEGBARE KERN LIEGT WOANDERS. Unter BEIDEN Lesarten ist das Paket nicht querrechenbar: `businesscases.csv` erzeugt ausschliesslich Verkaufszeilen (dsfinvk-daten.ts:604, `gvTyp: gvTypFuer('VERKAUF')` fest verdrahtet ueber `vatByTreatment`). Es gibt KEINE Zeile Anfangsbestand, keine Auszahlung, keinen Geldtransit — obwohl dsfinvk-schluessel.ts:70-73 diese Typen kennt. Ein Pruefer kann die 769,29 aus nichts im Paket herleiten. Das ist die Aussage, die kein Auslegungsstreit wegargumentieren kann.

(c) ZWEI ZITATE SCHIEF. Erstens: die Beschreibung "Blind cash count entered by the cashier" gehoert zu `shifts.blind_count_eur` (packages/db/migrations/0019_retail_compliance.sql:148/190), also zur QUELLE. Die Abschlussspalte selbst steht in packages/db/migrations/0011_closing.sql:86 (`cash_drawer_counted_eur NUMERIC(18,2), -- entered by cashier`). Zweitens: die Zahlen der Buehne sind 769,29 / 269,29 / −230,71, nicht die gerundeten 770,00 / 270,00 / −230,00.

(d) NACHBARDEFEKT, SCHON BEKANNT UND ROT. szenario-kreuzprobe.test.ts:1186-1213 haelt eine ABSICHTLICH rote Zusage: `datapayment.csv` schreibt die Ankaufzahlung mit PLUS statt MINUS (dsfinvk-daten.ts, `betrag: betrag(p.amountEur)`), womit die Bar-Summe ueber alle Belege ebenfalls 76929 statt −23071 ergibt. Das ist ein eigener Fund, nicht dieser — aber es heisst: die 769,29 steht derzeit in ZWEI Dateien, die 269,29 in einer, und die wahre −230,71 in keiner.

---

## 11. [P1] Ein Beleg ohne TSE-Signatur verschwindet spurlos aus transactions_tse.csv; TSE_TA_FEHLER bleibt ungenutzt

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:567`  ·  **Dimension:** dsfinvk

**Was bricht**

Die Wolken-TSE ist eine Stunde weg, ein Ankaufbeleg wird unsigniert gebucht, der Abschluss läuft mit der Bestätigung `unsignierteBelegeBestaetigt` durch. Gemessen: `transactions.csv` trägt beide Belege, `transactions_tse.csv` trägt NUR RCP-2026-000294. Für den unsignierten Beleg steht dort gar nichts — kein Eintrag, kein Fehlertext. Der Prüfer sieht einen Vorgang ohne jede Signaturangabe und kann nicht unterscheiden, ob die TSE ausgefallen war oder ob die Kasse den Nachweis unterschlägt. Die Norm hält für genau diesen Fall ein Feld bereit, und es bleibt leer.

**Beweis**

dsfinvk-daten.ts:567 `if (r.tse) {` — ohne Signatur wird gar keine Zeile erzeugt; `tseTaFehler: null` (Zeile 584) ist im signierten Zweig hart auf null gesetzt und hat keinen zweiten Schreibweg. Die mitgelieferte amtliche index.xml beschreibt die Spalte als „TSE_TA_FEHLER | MaxLength 200 | Beschreibung des TSE-Ausfalls oder Fehlers". Der Zustand ist erreichbar: closings-finalize.ts:55-74 lässt den Abschluss ausdrücklich zu („nicht VERBOTEN, sondern nicht AUS VERSEHEN"), Feld `unsignierteBelegeBestaetigt` (Zeile 74).

**Vorschlag**

Für jeden Beleg ohne Signatur eine Zeile in `transactions_tse.csv` schreiben, mit leerer `TSE_ID`, leerer Transaktionsnummer und Signatur, und `TSE_TA_FEHLER` gefüllt mit dem gemessenen Grund (Ausfallzeitraum, letzter Fehler des TSE-Anbieters). Die Angabe darf nicht erfunden werden: liegt kein Grund vor, gehört der Wortlaut hinein, der beim Abschluss bestätigt wurde, denn der steht bereits in der Notiz der Abschlusszeile.

**Korrektur des Skeptikers**

Drei Praezisierungen, die der Befund falsch oder unvollstaendig beschreibt.

a) „TSE_TA_FEHLER bleibt ungenutzt" ist zu grob. Die Spalte WIRD geschrieben, `/Users/basel/norns-pos/apps/api-cloud/src/lib/dsfinvk-dateien.ts:499` bildet `TSE_TA_FEHLER: (z) => z.tseTaFehler ?? undefined` ab. Der Schreibweg existiert also vollstaendig, er bekommt nur nie einen Wert, weil der Datenerzeuger ihn hart auf `null` setzt. Die Behebung liegt AUSSCHLIESSLICH in `dsfinvk-daten.ts`, nicht im Dateischreiber.

b) Der Befund verschweigt, dass ein gruener Test das heutige Verhalten ausdruecklich festnagelt. `/Users/basel/norns-pos/apps/api-cloud/tests/integration/szenario-kreuzprobe.test.ts:1548-1552` prueft, dass die beiden unsignierten Belege WIRKLICH keine Zeile haben, mit der Begruendung, es werde keine erfunden. Diese Begruendung trifft nur die erfundene SIGNATUR, nicht den Ausfallnachweis. Die richtige Behebung schreibt eine Zeile mit gefuelltem `TSE_TA_FEHLER` und LEEREN Signaturfeldern, und dieser Test muss dabei mitgeaendert werden, sonst wird er rot und sieht wie ein Rueckschritt aus.

c) Die Behebung ist heute nicht rein mechanisch, weil es keinen gespeicherten Ausfallgrund gibt. Der Abschluss ermittelt die Zahl der unsignierten Belege nur per Anti-Join, und der Kommentar in `closings-finalize.ts` sagt selbst, dass `tse_failed` an keine Fehlerquelle angeschlossen ist. Ein Text muesste also erst entstehen, etwa aus dem in `/Users/basel/norns-pos/docs/NORNS-POS-PLAN.md:119` geplanten Ausfallregister. Derselbe Plan ordnet in Zeile 174 diese Arbeit ausdruecklich HINTER die erste echte TSE-Inbetriebnahme. Der Befund ist damit echt, aber er ist ein bekannter, bewusst nachgeordneter Posten und keine Ueberraschung, was ihn eher auf P2 als auf P1 stellt, solange die TSE noch nicht scharf ist.

---

## 12. [P1] Der Kassenbericht druckt "Erwartet bar 0,00 EUR" für einen Tag, an dem nicht gezählt wurde, und unterschlägt die Begründung, die in der Datenbank steht

**Ort:** `apps/api-cloud/src/routes/closing-export.ts:1020`  ·  **Dimension:** kassenbericht

**Was bricht**

Ein Tag innerhalb einer mehrtägigen Schicht, zum Beispiel der auf Produktion gemessene 2026-06-08 mit 33 Belegen über 12.523,32 EUR (0125_ein_tag_in_einer_langen_schicht_ist_abschliessbar.sql). Der Abschluss schreibt `kassensturz_quelle` = SCHICHT_SPANNT_TAGE, `cash_drawer_counted_eur` NULL und, weil der Riegel eine Zahl erzwingt, `cash_drawer_expected_eur` = 0.00 (closings-finalize.ts:422 `const expectedCents = eigenerSturz ? toCents(sturz!.expected) : 0n;`). Der Kassenbericht liest nur diese drei Geldspalten und druckt: "Kasse;Erwartet bar;0,00 EUR", "Kasse;Gezählt bar;nicht gezählt", "Kasse;Differenz;nicht gezählt" — daneben im selben Blatt "Zahlungsart;Bar;…" mit dem echten Bargeldumsatz des Tages. Der Leser entnimmt daraus, der Tag habe eine leere Schublade erwartet. Das gedruckte A4-Blatt behauptet dazu im Fusstext ausdrücklich das Gegenteil: "Eine fehlende Zählung ist als solche benannt und nicht als Null dargestellt." Die Begründung, welche Schicht den Sturz trägt und wann sie gezählt wurde, existiert in `notes`, `kassensturz_quelle` und `kassensturz_schicht_id` und erreicht das Blatt nie.

**Beweis**

closing-export.ts:1020-1038, der SELECT für den Kassenbericht, holt `cash_drawer_expected_eur::text`, `cash_drawer_counted_eur::text`, `cash_drawer_variance_eur::text` und sonst nichts aus dem Kassensturzblock — weder `notes` noch `kassensturz_quelle` noch `kassensturz_schicht_id` noch `z_nr` (`grep -n "kassensturz_quelle" apps/api-cloud/src/` findet ausserhalb von closings-finalize.ts keinen Treffer). Die Abbildung bei 1063-1065 reicht die drei Werte unverändert weiter. In kassenbericht-export.ts:266-271 steht der ganze Block: `{ label: 'Erwartet bar', value: eur(c.cashExpectedEur) }` und `eur('0.00')` liefert '0,00 EUR', während `eur(null)` das Wort 'nicht gezählt' liefert — der ehrliche Weg ist also vorhanden und wird nur nicht beschritten, weil bereits closings-finalize.ts eine 0 speichert. Der Widerspruch steht in kassenbericht-print.ts:112-115 im Fusstext. Migration 0125 formuliert die Absicht wörtlich: "⚠️ Im Fall b) wird NICHTS eingesetzt. Weder der erwartete Betrag als gezählter, noch der Bestand der ganzen Schicht." — für `cash_drawer_expected_eur` ist genau das doch geschehen.

**Vorschlag**

Bei SCHICHT_SPANNT_TAGE keinen Geldbetrag als Erwartung ausweisen. Entweder den Riegel `cash_drawer_expected_eur IS NOT NULL` auf die Quelle bedingen (wie es 0125 für `counted` und `variance` bereits tut) und im Bericht 'nicht gezählt' schreiben, oder mindestens `notes`, `kassensturz_quelle` und `kassensturz_schicht_id` in den SELECT und in einen eigenen Abschnitt 'Kassensturz' des Berichts aufnehmen, damit die 0,00 erklärt dasteht. Bis dahin ist der Fusstext des Druckblatts eine unzutreffende Zusicherung.

**Korrektur des Skeptikers**

Zwei Punkte gehören geschärft, der Kern bleibt.

a) Das wörtliche Zitat im Beweisteil gibt es nicht. „⚠️ Im Fall b) wird NICHTS eingesetzt. Weder der erwartete Betrag als gezählter, noch der Bestand der ganzen Schicht." steht so in keiner Wanderung, `grep -rn "Im Fall b)" packages/db/migrations/` findet nichts. Die echte Stelle ist `0125_ein_tag_in_einer_langen_schicht_ist_abschliessbar.sql:39-46`: „Der bequeme Weg wäre, den Riegel zu lockern und für die Zwischentage den Kassenbestand der ganzen Schicht einzutragen, oder den erwarteten Betrag als gezählten auszugeben. Beides wäre ein ERFUNDENER Kassensturz in einer fortschreibungsgeschützten Aufzeichnung." Das trägt dieselbe Aussage, muss aber richtig zitiert werden, sonst kippt der Befund beim ersten Gegenlesen aus formalem Grund.

b) Die Ursache liegt genauer, als der Befund sie benennt. Es ist nicht nur „der Bericht liest zu wenig Spalten". Wanderung 0125 hat den Nachweisriegel bewusst umgebaut und dabei `counted` und `variance` für den Zwischentag auf NULL freigegeben, `cash_drawer_expected_eur IS NOT NULL` aber unverändert stehen lassen. Für einen Tag innerhalb einer langen Schicht ist der erwartete Kassenbestand genauso unbekannt wie der gezählte — `shifts.system_expected_eur` gilt der ganzen Schicht, nicht dem Kalendertag. Die 0 ist also nicht ein Anzeigefehler, sondern eine erfundene Zahl in der fortschreibungsgeschützten Aufzeichnung selbst, erzwungen von einem Riegel, der bei diesem Umbau übersehen wurde. Die Behebung braucht daher beides: `cash_drawer_expected_eur` im FINALIZED-CHECK an `kassensturz_quelle` koppeln (NULL erlaubt bei SCHICHT_SPANNT_TAGE, weiterhin Pflicht bei EIGENER_STURZ) plus `closings-finalize.ts:422` auf `null` statt `0n`, und erst danach den Export um `notes`, `kassensturz_quelle` und `kassensturz_schicht_id` erweitern, damit das Blatt die Begründung trägt. Der Unit-Test bei `kassenbericht-export.test.ts:111` sollte dann von einer erreichbaren Lage aus geführt werden, sonst bleibt er ein grüner Wächter über einem Zustand, den die Datenbank ausschliesst.

---

## 13. [P1] Der Kassenbericht enthält die Kassenbericht-Rechnung nicht: Anfangsbestand, Barausgaben aus Ankauf, Entnahmen und Einlagen fehlen vollständig

**Ort:** `apps/api-cloud/src/lib/kassenbericht-export.ts:266`  ·  **Dimension:** kassenbericht

**Was bricht**

Das eigene Kreuzprobeszenario des Hauses: Anfangsbestand 1.000,00 EUR, Bareinnahmen 269,29 EUR, Barankauf 500,00 EUR, erwarteter Bestand 769,29 EUR. Der Kassenbericht zeigt davon exakt zwei Zahlen: "Zahlungsart;Bar;269,29 EUR" (nur VERKAUF) und "Kasse;Erwartet bar;769,29 EUR". Der Anfangsbestand von 1.000,00 und der Barankauf von 500,00 stehen auf dem Blatt nirgends, ebensowenig eine Bankabschöpfung oder eine Einlage. Ein Prüfer, der den Endbestand nachrechnen will, findet eine unerklärte Differenz von 500,00 EUR zwischen dem Bareinnahmeblock und dem Kassenblock und kann sie mit keiner Angabe des Berichts auflösen. Für einen Edelmetallhändler ist der Barankauf nicht der Sonderfall, sondern das Kerngeschäft: an einem Tag mit 8.000 EUR Barankauf trägt das Blatt einen erwarteten Bestand, der weit unter den ausgewiesenen Bareinnahmen liegt, ohne dass irgendetwas auf dem Blatt das erklärt. Nachvollziehbarkeit der Kassensturzfähigkeit nach § 146 Abs. 1 AO und GoBD ist damit auf diesem Dokument nicht gegeben.

**Beweis**

kassenbericht-export.ts:265-272, der gesamte Abschnitt 'Kasse': `rows: [{ label: 'Erwartet bar', ... }, { label: 'Gezählt bar', ... }, { label: 'Differenz', ... }]` — drei Zeilen, kein Anfangsbestand, keine Ausgabe, keine Entnahme, keine Einlage. Der Zahlungsartblock stammt aus closings-finalize.ts:338-345 mit `WHERE berlin_business_day(t.finalized_at) = ${day}::date AND t.direction = 'VERKAUF'`, führt also ausschliesslich Einnahmen. Die vier fehlenden Grössen existieren und werden im Schichtschluss auch gerechnet, shifts.ts:406-412: `cents(s.openingFloatEur) + cents(agg!.cash_sales) - cents(agg!.cash_payouts) + cents(agg!.injections) - cents(agg!.bank_drops) - cents(agg!.safe_transits)`. Sie werden nur nirgends aufgezeichnet, die `daily_closings` kennt keine Spalte dafür und der Bericht folglich keine Zeile. Die Zahlen des Beispiels stehen in szenario-kreuzprobe.test.ts:180-187: "Der Anfangsbestand der Schublade: 1.000,00 EUR" und "Kassenbestand: Anfangsbestand 1.000,00 + Bareinnahmen 269,29 − Barankauf 500,00 = 769,29". Der zugehörige Test bei 1587 prüft nur `expect(zuCentAusBericht(berichtWert('Kasse', 'Erwartet bar'))).toBe(SOLL.kasseErwartet)` — er bestätigt den Endpunkt und misst nie, ob der Bericht ihn aus sich selbst heraus belegen kann.

**Vorschlag**

Den Abschnitt 'Kasse' zur Rechnung ausbauen: Anfangsbestand, Bareinnahmen, Barausgaben Ankauf, Einlagen, Entnahmen (Bankabschöpfung, Tresortransit), erwarteter Endbestand, gezählter Endbestand, Differenz — mit erwartet als geprüfter Summe der Zeilen darüber, wie es der Umsatzsteuer- und der Zahlungsartblock mit ihrer Summenzeile bereits vormachen. Die fünf Grössen müssen dafür beim Abschluss in `daily_closings` mitgeschrieben werden; heute sind sie nach dem Schichtschluss nur noch aus `shifts` und `cash_movements` rekonstruierbar und stehen in keiner festgeschriebenen Zeile.

**Korrektur des Skeptikers**

Zwei Angaben im Beweisteil sind falsch und gehoeren richtiggestellt.

(1) Der Ankauf steht sehr wohl auf dem Blatt. Der Umsatzblock druckt `Ankauf brutto vor Storno` und `Ankauf netto vor Storno`; am Kreuzprobetag sind das 577,77 EUR (SOLL.bruttoAnkauf), gruen geprueft in szenario-kreuzprobe.test.ts:1222-1225. Was fehlt, ist die AUFTEILUNG NACH ZAHLART: der Bericht sagt nirgends, welcher Teil des Ankaufs bar aus der Schublade ging (500,00) und welcher per Ueberweisung (77,77). Die richtige Formulierung lautet also: der Ankauf erscheint als Umsatzgroesse, aber nie als Barausgabe, und seine Barquote ist aus dem Blatt nicht ableitbar.

(2) Die 500,00 EUR Differenz sind das Netto ZWEIER fehlender Groessen, nicht einer. Der Leser sieht 769,29 minus 269,29 = 500,00; dahinter stehen Anfangsbestand 1.000,00 UND Barankauf 500,00. Faende er nur den Barankauf, ginge die Rechnung immer noch nicht auf.

Ein Punkt kommt hinzu, der den Befund verstaerkt: `daily_closings` speichert `kassensturz_quelle` und `kassensturz_schicht_id` (geschrieben in closings-finalize.ts:541 und 557, mit dem eigenen Kommentar "Ein Pruefer findet ihn damit"), aber die SELECT-Liste des Ausfuhrwegs liest beide nicht und der Bericht hat keine Zeile dafuer. An einem Tag, den eine mehrtaegige Schicht ueberspannt, sagt das Blatt daher "nicht gezaehlt", ohne die Schicht zu nennen, die den Sturz traegt — genau die Auffindbarkeit, die der Kommentar zusichert, erreicht das Dokument nicht.

---

## 14. [P1] Der lokale Cent-Umrechner im Schichtschluss liest negative Beträge falsch und kippt bei Werten zwischen -1 und 0 sogar das Vorzeichen

**Ort:** `apps/api-cloud/src/routes/shifts.ts:401`  ·  **Dimension:** kassenbericht

**Was bricht**

Sobald eine der fünf Summen negativ wird, liefert `cents()` einen falschen Wert. Gemessen mit node gegen die richtige Umrechnung aus money-cents.ts: "-69.50" ergibt -6850 statt -6950 (Fehler 1,00 EUR), "-119.99" ergibt -11801 statt -11999 (Fehler 1,98 EUR), "-300.25" ergibt -29975 statt -30025 (Fehler 0,50 EUR), und "-0.50" ergibt +50 statt -50: das Vorzeichen kippt. Der Fehler beträgt immer das Doppelte der Nachkommastellen. Der falsche Wert landet direkt in `system_expected_eur`, damit in der erzeugten Spalte `variance_eur` und über den Tagesabschluss in `cash_drawer_expected_eur` und `cash_drawer_variance_eur` — also in den Zeilen "Erwartet bar" und "Differenz" des Kassenberichts. Heute ist das durch Fund 1 verdeckt: negativ werden `cash_sales` und `cash_payouts` nur durch die gespiegelten Stornozeilen, und die tragen keine Schicht. Mit der Behebung von Fund 1 wird der Defekt sofort scharf, und zwar an genau dem Tag, an dem die Stornos die Bareinnahmen der Schicht übersteigen — der Kunde bringt am Folgetag zurück, was er gestern bar bezahlt hat.

**Beweis**

shifts.ts:401-405: `const cents = (x: string | null): bigint => { const v = x ?? '0'; const [whole, frac = '00'] = v.split('.'); return BigInt(whole!) * 100n + BigInt((frac ?? '00').padEnd(2, '0').slice(0, 2)); };` — das Vorzeichen sitzt nur auf `whole`, der Nachkommateil wird unbesehen addiert statt abgezogen, und BigInt('-0') ist 0n, weshalb bei "-0.50" gar kein Vorzeichen mehr da ist. Dieselbe Datei importiert bei Zeile 22 `fromCents` aus '../lib/money-cents.js', und die Schwesterfunktion `toCents` in derselben Datei macht es richtig: `const neg = v.startsWith('-'); ... return neg ? -c : c;`. Der Kommentar unmittelbar unter dem Fehler, shifts.ts:413-414, behauptet die Sache sei erledigt: "Sign-correct: a negative expected drawer (Ankauf-heavy shift) must NOT produce '-1.-50'. Shared helper handles the sign on the whole value." — geteilt wurde nur die Ausgabe, der Einleseweg blieb als lokale Kopie stehen. Dass negative Zahlungszeilen ein regulärer Fall sind, steht in schemas/transaction.ts:108 `amountEur: SignedDecimalString` und in schemas/money.ts: "Signed money string — allows leading `-` for storno rows".

**Vorschlag**

Die lokale `cents()` löschen und `toCents` aus '../lib/money-cents.js' verwenden, das in derselben Zeile wie `fromCents` bereits importierbar ist. Dazu ein Unit-Test über die Umrechnung mit den Werten -69.50, -0.50 und -300.25, damit die Kopie nicht wiederkehrt.

**Korrektur des Skeptikers**

Der Kern stimmt. Vier Präzisierungen, damit niemand am falschen Ende sucht:

a) Ort der Schwesterfunktion: `toCents` steht NICHT in `shifts.ts`, sondern in `apps/api-cloud/src/lib/money-cents.ts`. `shifts.ts` importiert von dort ausschliesslich `fromCents`. Die Behebung ist also ein Einzeiler: `toCents` mitimportieren und den lokalen Umrechner löschen.

b) Der Defekt greift an der SUMME, nicht an der einzelnen Zeile. Der Umrechner sieht nur die fünf von Postgres gelieferten Summenzeichenketten. Drei davon können über die Schnittstelle gar nicht negativ werden: `openingFloatEur` und `amountEur` der Kassenbewegungen laufen über `DecimalString` mit dem Muster `^\d{1,16}(\.\d{1,2})?$`, das ein führendes Minus abweist. Negativ werden können nur `cash_sales` und `cash_payouts`.

c) Es gibt HEUTE schon einen zweiten, schmalen Weg, unabhängig vom Fund 1: `FinalizePayment.amountEur` ist `SignedDecimalString` (`schemas/transaction.ts:108`), und die Rechenprüfung in `lib/transaction-math.ts` erzwingt das Vorzeichen nur für Kopf und Zeilen, für die Zahlungsbeine dagegen nur, dass ihre Summe dem Gesamtbetrag entspricht (Zeile 180-188). Eine geteilte Zahlung mit negativem Barbein, etwa bar -50,25 und Karte +150,25, kommt durch Schema, Prüfung, CHECK und den Bilanz-Trigger aus 0016 und trägt eine Schicht. Dieser Weg ist allerdings kein normaler Klientenablauf, sondern verlangt einen bewussten Aufruf, und die Schichtsumme muss dabei insgesamt unter null rutschen.

d) Der Kommentar 413-414 ist nicht direkt falsch, nur unvollständig: `fromCents` behandelt das Vorzeichen auf der AUSGABE tatsächlich richtig. Geteilt wurde eben nur die Ausgabe. Die Formulierung "behauptet die Sache sei erledigt" trifft die Wirkung, nicht den Wortlaut.

Zur Schwere: der Fehler ist heute schlafend, aber er sitzt im Fiskalweg, hat keinen Test und wird durch die Behebung von Fund 1 ohne weiteres Zutun scharf. P1 ist vertretbar, sofern die Latenz mitgeschrieben wird.

---

## 15. [P1] DSFinV-K: der Ankauf fehlt vollstaendig in businesscases.csv

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:601`  ·  **Dimension:** geldabgleich

**Was bricht**

Derselbe Tag, gemessen: `businesscases.csv` traegt genau eine Zeile, Umsatz mit 119,00 EUR. Die Summe ueber `transactions.csv` (Bonkopf) desselben Buendels ist 619,00 EUR. Die 500,00 EUR des Ankaufs haben in der Datei, aus der ein Pruefer die Tagessummen je Geschaeftsvorfallart und Steuerschluessel liest, keine einzige Zeile. Dabei traegt jede Ankaufsposition in `lines.csv` einen Geschaeftsvorfalltyp, naemlich die Entscheidung des Steuerberaters aus der Einstellung `dsfinvk.gv_typ.ankauf`, und dieser Typ kommt in der Zusammenfassung nie vor. DATEV weist denselben Vorgang auf dem Wareneingang mit 500,00 EUR im Soll aus, der Kassenbericht als "Ankauf brutto vor Storno 500,00 EUR" — drei Ausfuhren, zwei Antworten.

**Beweis**

`dsfinvk-daten.ts:601` `const geschaeftsvorfaelle: GeschaeftsvorfallZeile[] = Object.entries(closing.vatByTreatment).map(([code, ust]) => ({ gvTyp: gvTypFuer('VERKAUF'), ... }))`. Die Quelle `daily_closings.vat_by_treatment` wird in `closings-finalize.ts:309` mit `AND t.direction = 'VERKAUF'` gebildet, und der Geschaeftsvorfalltyp ist fest auf `gvTypFuer('VERKAUF')` verdrahtet — es gibt gar keinen Pfad, auf dem eine Auszahlungszeile entstehen koennte. Die Kreuzprobe umgeht das ausdruecklich: `tests/integration/szenario-kreuzprobe.test.ts:1446-1449` liest die Ankaufsumme aus dem Bonkopf statt aus `businesscases.csv`.

**Vorschlag**

Umsatz und Steuer je Behandlung auch fuer die Ankaufsrichtung aufzeichnen, also eine zweite Aggregation in `closings-finalize.ts` neben `umsatz_by_treatment` mit `direction = 'ANKAUF'`, und in `formeDaten` je Richtung eine Zeilengruppe mit dem passenden Geschaeftsvorfalltyp erzeugen. Solange die Entscheidung des Steuerberaters dazu fehlt, gilt weiter der bestehende Riegel `GeschaeftsvorfallOffenError` — lieber kein Paket als eine erfundene Zeile.

**Korrektur des Skeptikers**

Der Fund stimmt wie beschrieben. Zwei Praezisierungen, die ihn schaerfen statt ihn zu aendern:

a) Die Luecke ist nicht auf `businesscases.csv` beschraenkt. Derselbe Filter `AND t.direction = 'VERKAUF'` steht in `closings-finalize.ts:343` auch ueber `payments_by_method`. Damit fehlt die Barauszahlung des Ankaufs ebenso in `payment.csv` und in `Z_SE_ZAHLUNGEN` des Abschlusskopfes, waehrend `cash_per_currency.csv` den gezaehlten Laden traegt, in dem das Geld fehlt. Ein Pruefer sieht also nicht nur eine fehlende Zeile, sondern einen Kassensturz, der sich nicht erklaert.

b) Der zweite Beweisteil ist genauer als der Fund sagt: es ist nicht nur so, dass `gvTypFuer('VERKAUF')` hart verdrahtet ist, sondern die Erzeugung iteriert ueber `closing.vatByTreatment`. Ein reiner Ankaufstag hat dort ein leeres Objekt, gemessen kommt `businesscases.csv` dann voellig ohne Datenzeile heraus, nicht nur ohne die Ankaufszeile.

Randnotiz zum Arbeitsbaum, kein Teil des Fundes: `/Users/basel/norns-pos/apps/api-cloud/tests/unit/ztmp-skeptiker-ankauf.test.ts` liegt unversioniert im Baum, stammt aus einem frueheren Pruefdurchgang und faellt derzeit ROT aus (Vorzeichenprobe auf der Zahlungsseite). Ich habe sie nur ausgefuehrt und nicht angefasst.

---

## 16. [P1] DSFinV-K: derselbe Ankaufsbeleg steht im Kopf positiv und in seiner Zahlungszeile negativ

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:313`  ·  **Dimension:** geldabgleich

**Was bricht**

Ein Ankauf ueber 500,00 EUR bar. Gemessen: `transactions.csv` schreibt fuer diesen Beleg UMS_BRUTTO 500,00, `datapayment.csv` schreibt fuer DENSELBEN Beleg CASH -500,00. Die Probe je Beleg, Summe der Zahlungen gegen den Bruttoumsatz des Kopfes, ergibt eine Abweichung von 1.000,00 EUR bei einem einzigen Vorgang. Das Feld heisst in der Norm "Brutto-Gesamtumsatz"; ein Ankauf ist kein Umsatz, sondern eine Auszahlung. DATEV und der Kassenbericht sind sich einig, dass Geld die Kasse VERLAESST — nur der Bonkopf liest sich wie eine Einnahme.

**Beweis**

`dsfinvk-daten.ts:313` `umsatzBrutto: betrag(r.totalEur)` — ohne jede Richtungsbetrachtung, waehrend 236 Zeilen tiefer in `:549` fuer dieselbe Buchung gilt: `betrag: r.direction === 'ANKAUF' ? negativ(betrag(p.amountEur)) : betrag(p.amountEur)`, mit dem Kommentar darueber: "EINE ANKAUFZAHLUNG IST EINE AUSZAHLUNG. ... Steht eine Auszahlung dort ohne Vorzeichen, liest er sie als Einnahme." In `apps/api-cloud/src/fiskal/dsfinvk-2.4/index.xml`, Tabelle `transactions.csv`, lautet die Beschreibung von UMS_BRUTTO "Brutto-Gesamtumsatz". Die Kreuzprobe prueft je Beleg nur Kopf gegen Positionen (`tests/integration/szenario-kreuzprobe.test.ts:1327`), nie Kopf gegen Zahlungen — die Luecke ist ungeprueft.

**Vorschlag**

Die Richtung an EINER Stelle entscheiden und ueberall anwenden: Kopf (`umsatzBrutto`), Positionen, Positions- und Belegsteuerzeilen sowie Zahlungszeile eines Ankaufsbelegs tragen dasselbe Vorzeichen. Dazu eine Zusage in der Kreuzprobe, die je Beleg die Summe aus `datapayment.csv` gegen UMS_BRUTTO aus `transactions.csv` stellt — sie faellt heute fuer jeden Ankaufsbeleg.

**Korrektur des Skeptikers**

Drei Punkte gehoeren richtiggestellt.

A) Es ist nicht nur der Bonkopf. Gemessen tragen ALLE Belegseiten des Ankaufs das positive Vorzeichen: `UMS_BRUTTO` (`dsfinvk-daten.ts:313`), `BON_BRUTTO` (aus `jeSatz`, `:508` bis `:523`), `POS_BRUTTO` sowie `STK_BR` in `lines.csv`. Negativ steht einzig die Zahlungszeile. Wer nur `:313` dreht, zerstoert die Probe Kopf gegen Positionen, die das Haus bereits erzwingt. Die Behebung muss die Richtung fuer den ganzen Beleg tragen, oder die Entscheidung faellt bewusst andersherum fuer die Zahlung, aber nicht halb.

B) Die Behauptung, die Luecke sei ungeprueft, stimmt so nicht. Eine Probe je Beleg, Kopf gegen Positionen UND gegen Zahlungen UND gegen die Steuersaetze, steht in `/Users/basel/norns-pos/apps/api-cloud/tests/unit/dsfinvk-paket-haelt-zusammen.test.ts:161` bis `:186`. Sie ist gruen, weil ihre Buehne (`:60` bis `:106`) ausschliesslich Verkaufsbelege kennt, kein einziger Ankauf laeuft hindurch. Die Luecke ist also nicht unbedacht, sondern unbestueckt, und der Ankauf faellt zusaetzlich durch die Zusagen in `szenario-kreuzprobe.test.ts:1449` und `:1535` als richtig durch. Der schnellste rote Beweis ist ein Ankaufsbeleg in genau dieser Buehne.

C) Zwei Nachbarfunde in derselben Messung, die der Befund nicht nennt: `cashpointclosing.csv` `Z_SE_ZAHLUNGEN` steht bei −500,00, der Abschlusskopf schlaegt sich also auf die Seite der Zahlung und widerspricht seinen eigenen Belegen. Und `businesscases.csv` bleibt bei einem reinen Ankaufstag LEER, weil die Tagessummen in `dsfinvk-daten.ts:601` bis `:614` allein aus `closing.vatByTreatment` mit fest verdrahtetem `gvTypFuer('VERKAUF')` entstehen. Letzteres ist bereits als eigene Luecke vermerkt, in `szenario-kreuzprobe.test.ts:1489` bis `:1495`.

---

## 17. [P1] Die sorgfältig geschriebenen deutschen Abbruchgründe des DATEV-Exports kommen als „unerwarteter Serverfehler" an

**Ort:** `apps/api-cloud/src/routes/closing-export.ts:248`  ·  **Dimension:** routen

**Was bricht**

`MargeOhneEinkaufspreisError` (Zeile 248) und `UnbekannteSteuerbehandlungError` (Zeile 284) erben von `Error`, nicht von `DomainError`. Der Fehlerbehandler prüft `err instanceof DomainError` und wirft sonst die Meldung weg. Lage: an einem Kassentag trägt EINE § 25a-Position kein `acquisition_cost_eur_snapshot` (die Spalte ist NULL-fähig, migrations/0009_transactions.sql:176). Der Inhaber drückt „DATEV herunterladen" und bekommt HTTP 500 mit `{"code":"INTERNAL_ERROR","message":"Internal server error"}`; auf dem Bildschirm steht „Es ist ein unerwarteter Serverfehler aufgetreten. Bitte später erneut versuchen." Der Satz, der ihn in Sekunden zum Ziel brächte — welcher Beleg, und dass der Einkaufspreis am Stück nachzutragen ist — steht nur im Serverprotokoll. Der Export bleibt für diesen Tag dauerhaft blockiert, und nichts sagt warum. Dasselbe gilt für einen unbekannten Steuerschlüssel und für jeden `DatevFormatFehler` (datev-format.ts:78, ebenfalls blosses `Error`), darunter die Meldung „99.999 Zeilen, der Zeitraum muss geteilt werden" und „Umsatz: eine Buchung über 0,00 ist nicht zulässig".

**Beweis**

GEMESSEN mit einer echten Fastify-Instanz und dem ECHTEN error-handler-Plugin (Probe unter scratchpad/probe.mts):
```
--- /marge      → 500 | {"error":{"code":"INTERNAL_ERROR","message":"Internal server error",...}}
--- /schluessel → 500 | {"error":{"code":"INTERNAL_ERROR","message":"Internal server error",...}}
--- /ansi       → 500 | {"error":{"code":"INTERNAL_ERROR","message":"Internal server error",...}}
```
plugins/error-handler.ts:239-241, Zweig 5: `req.log.error({ err }, 'unhandled error'); send(reply, req, 'INTERNAL_ERROR', 'Internal server error');`
packages/i18n-de/src/german-text.ts:871 `INTERNAL_ERROR: "Es ist ein unerwarteter Serverfehler aufgetreten. Bitte später erneut versuchen."`
Das Haus kennt genau diesen Fehler bereits und hat ihn woanders behoben — haendler-stammdaten.ts:129-133, wörtlich: „Der erste Entwurf erbte von `Error`. Der Fehlerbehandler prüft `instanceof DomainError` und machte daraus einen ‚Internal server error' — die sorgfältig geschriebene Meldung stand nur im Serverprotokoll."
Der Gegenbeweis steht in DERSELBEN Funktion `toDatevRows`: `ZahlartNichtKontiertError` (datev-kontierung.ts:35) IST ein DomainError und liefert seinen deutschen Satz sauber als 409 aus. Kein Test prüft den HTTP-Ausgang der drei anderen; `datev-marge-zwei-zeilen.test.ts:289` prüft nur `toThrow(MargeOhneEinkaufspreisError)` auf der reinen Funktion.

**Vorschlag**

Die drei Klassen von `DomainError` erben lassen: `MargeOhneEinkaufspreisError` und `UnbekannteSteuerbehandlungError` mit `httpStatus = 409` / `code = 'CONFLICT'` (der Datenzustand ist offen, die Anfrage war richtig), `DatevFormatFehler` mit 500 / `INTERNAL_ERROR` — der Text überlebt dort trotzdem, weil Zweig 2 `err.message` durchreicht, genau wie beim vorhandenen `DatevDateiFehlerhaftError` (closing-export.ts:79). Zusätzlich einen Integrationstest, der eine § 25a-Zeile ohne Einkaufspreis anlegt und verlangt, dass die Antwort den Belegnamen im Text nennt.

**Korrektur des Skeptikers**

Die Lage ist falsch beschrieben, und damit auch die Schwere. Der geschilderte Kassentag ist heute nicht erreichbar: jeder Schreibweg blockt eine § 25a-Position ohne Einkaufspreis schon beim Anlegen. transactions-finalize.ts:578 ruft `pruefeMargen`, und marge-nachrechnen.ts:105 weist ab, wenn kein Einkaufspreis hinterlegt ist; storefront-webhook.ts:468 wirft im Web-Shop-Weg ebenso; ein ANKAUF erreicht `teileZeileAuf` gar nicht. Auf den echten Daten gemessen sind es null solche Positionen (datev-marge-zwei-zeilen.test.ts:262). Auch die beiden anderen Faelle sind heute nicht auszuloesen: alle existierenden Steuerschluessel stehen in ERLOES_JE_BEHANDLUNG (MIXED ist bewusst freigestellt), Null-Betraege fallen bereits in kreuzeZahlungenMitBehandlungen heraus (datev-kontierung.ts:257, 273, 277), die 99.999-Zeilen-Grenze ist bei einem Ein-Tages-Export unerreichbar, und der Buchungstext ist maschinengebaut (der Kopfwert `exportiertVon` wird mit \W bereinigt), sodass auch kein Windows-1252-Bruch aus Inhaberhand kommt. Richtig ist daher: die drei Klassen sind VORSORGE-Riegel, deren sorgfaeltig geschriebene Meldung im Ernstfall verloren geht. Ausloesen wuerde ihn eine Datenanomalie, eine Alt-Zeile aus der Zeit vor dem Riegel, ein direkter Datenbankeingriff oder ein spaeter ergaenzter Steuerschluessel. Schwere P3, nicht P1. Der Fix bleibt derselbe und ist ein Dreizeiler: die drei Klassen von DomainError erben lassen (409/CONFLICT fuer die beiden fachlichen, 500 mit echter Meldung fuer DatevFormatFehler wie bei DatevDateiFehlerhaftError) und einen Test ergaenzen, der den HTTP-Ausgang misst statt nur `toThrow` auf der reinen Funktion.

---

## 18. [P1] businesscases.csv kennt nur GV_TYP „Umsatz" — der Ankauf über 300,00 EUR steht in keiner Tagessumme

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:604`  ·  **Dimension:** echter-lauf

**Was bricht**

Gemessener Lauf 2026-06-01: `lines.csv` führt den Ankaufsbeleg korrekt mit GV_TYP „Auszahlung", `businesscases.csv` hat aber nur zwei Zeilen, beide GV_TYP „Umsatz" (1001: 200,00 / 1: 0,00). Die Auszahlung von 300,00 EUR erscheint in KEINER Tagessumme des Kassenabschlusses. Σ businesscases = 200,00 gegen Σ transactions.csv = 500,00 — der Abschlusskopf und die Belegseite desselben Bündels gehen nicht zusammen.

**Beweis**

Erzeugte Bytes, businesscases.csv vollständig:
`POS-1;2026-08-05T03:15:22.531Z;1;Umsatz;;0;1001;200,00000;190,10000;9,90000`
`POS-1;2026-08-05T03:15:22.531Z;1;Umsatz;;0;1;0,00000;0,00000;0,00000`
Dagegen lines.csv Zeile 3: `...;RCP-2026-000003;1;;Altgold;;Auszahlung;;;0;0;...;300,00000`
Quelle: `gvTyp: gvTypFuer('VERKAUF'),` (dsfinvk-daten.ts:604) — die Richtung ist fest verdrahtet, die Aggregation läuft nur über `closing.vatByTreatment`, das der Abschluss ausschliesslich für VERKAUF füllt. Die Lücke ist im Quelltext bereits eingestanden: `tests/integration/szenario-kreuzprobe.test.ts:1489` schreibt „Das ist gemeldet und gehoert in eine Aenderung an `src/`" und misst deshalb nur die Belegseite.

**Vorschlag**

Die Aggregation für `businesscases.csv` über beide Richtungen führen: je (GV_TYP, UST_SCHLUESSEL) eine Zeile, GV_TYP aus `gvTypFuer(direction, mensch.gvTypAnkauf)` wie in Zeile 343, Beträge der Ankaufseite negativ. Dafür muss der Abschluss den Ankaufsumsatz je Behandlung mitschreiben (analog `umsatz_by_treatment`, aber je Richtung). Wächter: Σ businesscases.Z_UMS_BRUTTO == Σ transactions.UMS_BRUTTO.

**Korrektur des Skeptikers**

Der Befund ist zu eng beschrieben. Die Ursache liegt nicht nur in dsfinvk-daten.ts:604, sondern schon eine Stufe darueber: der Abschluss selbst ist VERKAUF-only (apps/api-cloud/src/routes/closings-finalize.ts, Z. 309 vat_by_treatment, Z. 333 umsatz_by_treatment, Z. 343 payments_by_method, jeweils 'AND t.direction = VERKAUF'). Selbst wenn Z. 604 die Richtung als Parameter naehme, enthaelt die Datenquelle keine Ankaufzahlen. Damit ist die Auswirkung groesser als gemeldet: nicht nur businesscases.csv verliert die Auszahlung, sondern ueber closing.paymentsByMethod auch die Zahlartsummen (Z_Zahlart) sowie SUMME_ZAHLUNGEN und SUMME_BARZAHLUNGEN im Abschlusskopf (dsfinvk-daten.ts:625-644). Eine 300,00-EUR-Barauszahlung verlaesst die Lade, ohne in irgendeiner Z-Zahl aufzutauchen. Die Aenderung betrifft ZWEI Dateien, nicht nur dsfinvk-daten.ts.

---

## 19. [P1] Barausgaben und Bar-Betriebsausgaben erreichen KEINE der drei Ausfuhren — DATEV-Kasse 1000 klafft 50,00 EUR gegen die Schublade

**Ort:** `apps/api-cloud/src/lib/kassenbericht-export.ts:268`  ·  **Dimension:** echter-lauf

**Was bricht**

Gemessener Lauf 2026-06-01: eine Barausgabe von 50,00 EUR (`cash_movements`, BANK_DROP, „Barausgabe: Porto und Verpackung") gebucht auf die geschlossene Schicht. Wechselgeld 500,00, gezählt 350,00. Ergebnis: DATEV hat 5 Buchungszeilen, alle aus Belegen, KEINE für die Barausgabe; Konto 1000 bewegt sich um −100,00 EUR, die Schublade um −150,00 EUR. Ein Prüfer, der die Kassensturzfähigkeit rechnet, findet eine unerklärte Lücke von 50,00 EUR. In DSFinV-K existiert für die Ausgabe kein Bon (fehlende Einzelaufzeichnung), im Kassenbericht keine Zeile. `operating_expenses` (die Bar-Betriebsausgabe der App) kommt in der gesamten Exportfläche ebenfalls nicht vor.

**Beweis**

Nachgerechnet aus den erzeugten DATEV-Bytes (Konto 1000 als Soll- bzw. Gegenkonto): +11900 +13800 +6200 −30000 −11900 = −10000 Cent; Schublade 50000 → 35000 = −15000 Cent; Lücke −5000 Cent.
Der Kassenbericht druckt nur `Kasse;Erwartet bar;350,00 EUR` (kassenbericht-export.ts:268) und `Zahlungsart;Bar;200,00 EUR` — mit 500,00 Anfangsbestand ergäbe das 700,00, nicht 350,00; es gibt keine Zeile Anfangsbestand, keine Zeile Ausgaben, keine Zeile Barentnahme (Datei hat 307 Zeilen, `grep -n 'Anfangsbestand|Wechselgeld|Ausgabe|Einlage|Entnahme|opening_float'` findet nichts).
Messung der Reichweite: `grep -rn 'cash_movements|operating_expenses|cashMovements|operatingExpenses'` über closing-export.ts, closings-finalize.ts, kassenbericht-export.ts, datev-export.ts, datev-kontierung.ts, dsfinvk-daten.ts, dsfinvk-dateien.ts → EXIT=1, kein einziger Treffer.

**Vorschlag**

Bargeldbewegungen zu erstklassigen Geschäftsvorfällen machen: (a) DSFinV-K je `cash_movement` / bar bezahlter `operating_expense` einen eigenen Bon mit GV_TYP „Geldtransit", „Privatentnahme" bzw. „Auszahlung" (Anhang C) und negativem Betrag erzeugen; (b) DATEV je Bewegung eine Buchungszeile gegen 1000 (Geldtransit 1360, Betriebsausgabe nach Kategorie); (c) den Kassenbericht auf die retrograde Formel des AEAO zu § 146 Nr. 3.3 umstellen — gezählter Endbestand − Endbestand Vortag − Bareinlagen + Ausgaben + Barentnahmen — damit die 350,00 aus dem Blatt selbst herleitbar sind. Wächter: Σ DATEV-Bewegung auf Konto 1000 == cash_drawer_counted − opening_float des Tages.

**Korrektur des Skeptikers**

Drei Schärfungen an der Beschreibung, der Kern bleibt:

a) Die Zeile Erwartet bar ist NICHT falsch gerechnet. Der Satz „mit 500,00 Anfangsbestand ergäbe das 700,00, nicht 350,00" legt einen Rechenfehler nahe, den es nicht gibt: der Wert stammt aus `shifts.system_expected_eur` und lautet Anfangsbestand plus Barverkäufe minus Barauszahlungen an den Ankäufer minus Bewegungen, also 500 plus 200 minus 300 minus 50 gleich 350. Der Defekt ist nicht die Zahl, sondern dass der Bericht seine eigene Herleitung nicht zeigt: keine Zeile Anfangsbestand, keine Zeile Bewegungen. Ein Leser kann die 350 aus dem Blatt heraus nicht nachrechnen. Das ist ein Nachvollziehbarkeitsmangel, der harte Fund liegt woanders.

b) `operating_expenses` gehört nicht in diesen Fund. Die Tabelle hat weder Zahlart noch Schicht noch ein Bar-Merkmal (Spalten: `amount_cents`, `business_day`, `category`, `note`, `created_by_user_id`). Sie ist eine Kostenerfassung für die Auswertung, keine Kassenbucheintragung. Sie „Bar-Betriebsausgabe" zu nennen und ihr Fehlen im Fiskalexport als Defekt zu führen, ist nicht belegt. Diesen Teil streichen, sonst verwässert er den echten Befund.

c) Der beschriebene Weg trifft nur einen von drei gleich betroffenen Fällen. Die Kasse bietet Einlage gleich INJECTION und Entnahme gleich SAFE_TRANSIT an (CashMovementDialog.tsx:44-45); BANK_DROP ist nur über die Schnittstelle erreichbar. Alle drei Richtungen bewegen die Schublade und erscheinen in keiner Ausfuhr, der Fund ist also breiter als der geschilderte Lauf, nicht enger.

Der Fund in einem Satz, richtig gefasst: jede Bewegung in `cash_movements` verändert den Sollbestand der Schublade, erreicht aber weder DATEV (kein Gegenkonto, Konto 1000 driftet gegen die Schublade) noch DSFinV-K (kein Vorgang mit GV_TYP Geldtransit, Privatentnahme oder Auszahlung, obwohl die Werte in dsfinvk-schluessel.ts bereits stehen) noch den Kassenbericht.

---

## 20. [P2] Der Buchungstext wird still auf 60 Zeichen abgeschnitten und verliert dabei die Zahlart, obwohl der Schreiber genau dafür abbrechen soll

**Ort:** `apps/api-cloud/src/routes/closing-export.ts:566`  ·  **Dimension:** datev

**Was bricht**

`zuDatevZeile` kürzt mit `.slice(0, 60)`, bevor `schreibeFeld` überhaupt messen kann. Damit ist der Wächter in `datev-format.ts:146` wirkungslos, der für Textfelder ausdrücklich abbricht, statt „beim Berater abgeschnitten anzukommen". GEMESSEN: ein gemischter Beleg, bezahlt über den Stripe-Leser, ergibt „VERKAUF RCP-2026-000012 (INVESTMENT GOLD 25C 2/4 Stripe Terminal)", 65 Zeichen. Geschrieben wird „…2/4 Stripe Term" — die schliessende Klammer fehlt, die Zahlart ist verstümmelt. Mit dem Zusatz „STORNO " (sieben Zeichen mehr) reisst der Text noch früher ab. Der Buchungstext ist die EINZIGE Stelle, an der Steuerart-Teilzeile und Zahlart eines aufgeteilten Belegs benannt sind; ist er gekürzt, kann der Berater eine 2-von-4-Zeile nicht mehr eindeutig zuordnen.

**Beweis**

closing-export.ts:566 `z.set(FELD.BUCHUNGSTEXT, r.bookingText.slice(0, 60));` — datev-format.ts:140-153 `schreibeFeld`: „Ein zu langer Wert bricht ab, statt beim Berader abgeschnitten anzukommen" mit `throw new DatevFormatFehler(...)` — datev-spalten.generiert.ts:195 `{ nr: 14, label: 'Buchungstext', typ: 'Text', laenge: 60, … }`. Messung: roh 65 Zeichen „VERKAUF RCP-2026-000012 (INVESTMENT_GOLD_25C 2/4 Stripe Terminal)", geschrieben „VERKAUF RCP-2026-000012 (INVESTMENT_GOLD_25C 2/4 Stripe Term".

**Vorschlag**

Den Text so bauen, dass er von vornherein in 60 Zeichen passt: die Belegnummer und die Teilzeilen-Angabe („2/4") sind unverzichtbar, die Steuerart darf ein festes Kürzel bekommen (etwa „25C" statt „INVESTMENT GOLD 25C"). Danach das `.slice(0, 60)` ENTFERNEN, damit `schreibeFeld` wieder abbricht, wenn doch etwas zu lang wird — ein stiller Schnitt an dieser Stelle ist genau die Fehlerklasse, gegen die der Schreiber gebaut wurde. Zusätzlich das Belegfeld 2 (Feld 12, heute leer) für die Zahlart nutzen, statt sie in den Text zu quetschen.

**Korrektur des Skeptikers**

Zwei Aussagen des Befundes halten der Messung nicht stand und muessen ersetzt werden.

1. „Die schliessende Klammer fehlt, die Zahlart ist verstuemmelt" stimmt — aber „ein Berater kann eine 2-von-4-Zeile nicht mehr eindeutig zuordnen" ist FALSCH. In JEDER ueberlaufenden Kombination passen Steuerartcode UND Teilmarke (`2/4`) noch in die 60 Zeichen; abgeschnitten wird ausschliesslich der Zahlart-Kurzname am Ende. Der Vorspann ist feste Breite (`VERKAUF RCP-JJJJ-NNNNNN (` = 25 Zeichen, mit STORNO 32), der laengste Code ist 19 Zeichen — die Zuordnung der Teilzeile ueberlebt immer.

2. „Der Buchungstext ist die EINZIGE Stelle, an der die Zahlart eines aufgeteilten Belegs benannt ist" ist FALSCH. Jede Zahlart hat ihr EIGENES Geldkonto (`KONTO_JE_ZAHLART` in datev-kontierung.ts:55-70: `geldtransitStripe` und `geldtransitStripeTerminal` sind bewusst getrennt, Kommentar vom 26.07.2026). Die Zahlart steht damit unverstuemmelt im Feld Konto. Die Angabe geht nicht verloren, sie wird nur im Buchungstext unschoen beschnitten.

Richtige Fassung des Befundes: `zuDatevZeile` kuerzt den Buchungstext still mit `.slice(0, 60)` und setzt damit den Waechter in `schreibeFeld` ausser Kraft, der fuer Textfelder ausdruecklich abbrechen soll. Bei einem Beleg mit mehreren Steuerarten UND mehreren Zahlarten (gemessen: 65 Zeichen) faellt der Zahlart-Kurzname unvollstaendig aus (`Stripe Term`) oder verschwindet fast ganz; die DATEV-Datei bleibt gueltig und importierbar, und die Zahlart bleibt ueber das Geldkonto eindeutig lesbar. Schwere daher P3/kosmetisch, nicht P2 — es geht kein fiskalischer Sachverhalt verloren. Was echt zu beheben ist: entweder den Zusatz laengenbewusst bauen (Zahlart-Kurznamen kuerzen statt den Gesamttext blind zu schneiden) oder den Schnitt entfernen und den Waechter arbeiten lassen. Zusatzhinweis: `ZAHLART_KURZ` traegt selbst den Kommentar „Feld 14 fasst 60 Zeichen, deshalb kurz" — 'Stripe Terminal' mit 15 Zeichen bricht genau diese Zusage und ist der eigentliche Ausreisser.

---

## 21. [P2] Der Kassenbericht trägt keine Z-Nummer, und das gedruckte A4-Blatt für die Nachschau zeigt das Maschinendatum statt des deutschen Datums

**Ort:** `apps/api-cloud/src/lib/kassenbericht-print.ts:108`  ·  **Dimension:** kassenbericht

**Was bricht**

Zwei Sachen an dem Blatt, das ein Prüfer bei einer Kassennachschau nach § 146b AO in die Hand bekommt. Erstens: es steht keine Z-Nummer darauf. Die fortlaufende Abschlussnummer existiert seit Wanderung 0124 in `daily_closings.z_nr` und trägt im DSFinV-K-Bündel die Datei `cashpointclosing.csv`, aber der Kassenbericht liest sie nicht. Ein Prüfer kann das Blatt weder dem Bündel zuordnen noch aus einer Reihe von Blättern erkennen, dass zwischen zwei Abschlüssen einer fehlt — genau die Lücke, deren Sichtbarkeit 0124 herstellen sollte. Zweitens: die Kopfzeile des Druckblatts gibt den Geschäftstag als '2026-06-08' aus, während dieselbe Zahl in der CSV als '06.06.2026' erscheint. Der Titel des Dokuments ebenso. Der Kommentar in der CSV-Zusicherung nennt genau diesen Fall als behoben, für das Papier gilt er weiter.

**Beweis**

kassenbericht-print.ts:108: `<div class="day">Gesch&auml;ftstag ${esc(c.businessDay)}</div>` und 73: `<title>Kassenbericht ${esc(c.businessDay)}</title>` — beide nehmen den ISO-Wert unverändert, während buildKassenberichtCsv bei kassenbericht-export.ts:298 `['Kassenbericht', germanDay(c.businessDay)]` benutzt. Die Zusicherung deckt nur die CSV ab, kassenbericht-export.test.ts:42-47: "A German report writes a German date. The ISO form was a machine format that happened to reach a document meant for a Betriebsprüfer." mit `expect(csv.split('\r\n')[0]).toBe('Kassenbericht;06.06.2026')`. Zur Z-Nummer: `KassenberichtInput` in kassenbericht-export.ts:22-52 hat kein Feld dafür, der SELECT in closing-export.ts:1020-1038 holt `z_nr` nicht (die Spalte wird in derselben Datei nur bei 1158 und 1199 für andere Ausfuhren gelesen), und in closings-finalize.ts:511-514 steht der Grund, warum sie zählt: "eine Lücke zwischen 41 und 43 ist ein FEHLENDER Abschluss und muss auffallen. Bei Datumsschlüsseln fällt gar nichts auf."

**Vorschlag**

`germanDay(c.businessDay)` auch in Kopfzeile und Titel des Druckblatts verwenden und die Zusicherung aus kassenbericht-export.test.ts:42 auf die HTML-Ausgabe spiegeln. `z_nr` in den SELECT, in `KassenberichtInput` und als erste Zeile in den Abschnitt 'Abschluss' aufnehmen, damit Papier, CSV und `cashpointclosing.csv` dieselbe Nummer tragen.

**Korrektur des Skeptikers**

Auf P3 herunterstufen und auf einen Satz zusammenziehen: Das gedruckte A4-Blatt gibt den Geschaeftstag als ISO-Wert aus (kassenbericht-print.ts:73 und :108), waehrend dieselbe Angabe in der CSV deutsch erscheint. Genau diese Klasse gilt in kassenbericht-export.test.ts:42-47 als behoben, die Zusicherung deckt aber nur die CSV. Behebung: germanDay aus kassenbericht-export.ts exportieren und an beiden Stellen des Druckblatts benutzen, dann einen Test auf format=html setzen. KEINE Zahl ist falsch, und ISO 8601 ist fuer einen Leser nicht missverstaendlich, es ist eine Bruchstelle im Erscheinungsbild eines deutschen Steuerdokuments. Die fehlende Folgenummer gehoert NICHT in diesen Befund: sie wurde in generate-fiscal-samples.test.ts:100-104 ausdruecklich als Feld des DSFinV-K-Abschlusses und nicht des Kassenberichts verworfen. Wer sie trotzdem auf das Papier bringen will, soll das als eigenen Vorschlag gegen diese Entscheidung fuehren, nicht als Defekt.

---

## 22. [P2] Kassenbericht: der Bargeldblock laesst sich vom Leser nicht nachrechnen

**Ort:** `apps/api-cloud/src/lib/kassenbericht-export.ts:256`  ·  **Dimension:** geldabgleich

**Was bricht**

Gemessen an einem Tag mit 249,00 und 119,00 EUR Barverkauf, 500,00 EUR Barankauf und 1.000,00 EUR Anfangsbestand: der Bericht zeigt im Block Zahlungsart "Bar 368,00 EUR" und wenige Zeilen tiefer im Block Kasse "Erwartet bar 868,00 EUR". Zwischen beiden Zahlen liegen der Anfangsbestand und die Barauszahlung des Ankaufs, und BEIDE stehen auf dem Blatt nirgends — der Bericht hat weder eine Zeile Anfangsbestand noch eine Zeile Barauszahlung. Ein Pruefer, der die Kassenzeile nachrechnen will, kann es nicht; DATEV zeigt fuer dieselbe Kasse, Konto 1000, eine Tagesbewegung von -132,00 EUR, also eine dritte Zahl.

**Beweis**

`kassenbericht-export.ts:256` Block `Zahlungsart` liest `c.paymentsByMethod`, gespeist aus `daily_closings.payments_by_method`, das in `closings-finalize.ts:343` auf `t.direction = 'VERKAUF'` gefiltert ist. `kassenbericht-export.ts:268` `{ label: 'Erwartet bar', value: eur(c.cashExpectedEur) }` liest `daily_closings.cash_drawer_expected_eur`, gebildet in `closings-finalize.ts:386` als `SUM(system_expected_eur)` der Schichten, und dieser Wert ist laut `routes/shifts.ts:333` "opening float plus Summe der Barverkaeufe minus Summe der Barauszahlungen", berechnet in `shifts.ts:382` (`cash_sales`) und `shifts.ts:389` (`cash_payouts`). Zwei verschiedene Grundlagen, ohne Bruecke auf dem Blatt. In der Kreuzprobe stehen beide Zahlen nebeneinander und werden einzeln bestaetigt (`tests/integration/szenario-kreuzprobe.test.ts:1112` Bar 269,29 und `:1587` Erwartet bar 769,29), aber nie gegeneinander.

**Vorschlag**

Den Block Kasse zu einer geschlossenen Rechnung machen: Anfangsbestand, plus Bareinnahmen, minus Barauszahlungen (Ankauf), ergibt Erwartet bar, dann Gezaehlt bar und Differenz. Alle vier Groessen liegen bereits vor (`shifts.opening_float_eur`, `cash_sales`, `cash_payouts`); sie muessen nur in die Abschlusszeile und in `KassenberichtInput` wandern. Und den Block Zahlungsart als Zahlungsart (Verkauf) beschriften, solange er nur die Verkaufsseite zeigt.

**Korrektur des Skeptikers**

Zwei Praezisierungen, beide machen die Luecke groesser, nicht kleiner. ERSTENS ist die Bruecke breiter als beschrieben: laut shifts.ts:406-412 gehen in 'Erwartet bar' nicht nur Anfangsbestand und Barankauf ein, sondern auch die Bargeldbewegungen INJECTION, BANK_DROP und SAFE_TRANSIT (shifts.ts:390-398). Auch diese drei stehen auf dem Blatt nirgends. Gerade BANK_DROP und SAFE_TRANSIT sind Entnahmen und damit Pflichtangaben, nicht blosse Lesehilfen. ZWEITENS haben die beiden Zahlen nicht nur verschiedene Grundlagen, sondern verschiedene GRUNDGESAMTHEITEN: 'Bar' im Block Zahlungsart aggregiert Belege ueber berlin_business_day(t.finalized_at) (closings-finalize.ts:343), 'Erwartet bar' summiert system_expected_eur der Schichten, die AN DIESEM TAG SCHLOSSEN (closings-finalize.ts:386 ff.). Bei einer mehrtaegigen Schicht liegen die beiden Zahlen darum auch dann auseinander, wenn man Anfangsbestand und Auszahlungen kennt: der Leser kann die Zeile selbst mit vollstaendiger Kenntnis nicht schliessen. Die Beispielzahlen des Befunds (249,00 + 119,00, 500,00, 1.000,00, DATEV −132,00) sind erfunden, aber in sich richtig; der real gemessene Fall der Kreuzprobe lautet Bar 269,29, Erwartet bar 769,29, Anfangsbestand 1.000,00, Barankauf 500,00 und DATEV-Tagesbewegung auf Konto 1000 −230,71 (szenario-kreuzprobe.test.ts:1112, :1587, :1211, :1213).

---

## 23. [P2] Kassenbericht und An-/Verkaufsbuch verlassen den Server als UTF-8 ohne Marke unter `text/plain` — Excel öffnet sie mit zerstörten Umlauten

**Ort:** `apps/api-cloud/src/routes/closing-export.ts:1097`  ·  **Dimension:** routen

**Was bricht**

Die Datei heisst `Kassenbericht_2026-08-04.csv`, ist mit Semikolon getrennt (die deutsche Excel-Konvention) und wird ausdrücklich für den Steuerberater und den Betriebsprüfer erzeugt. Sie geht als UTF-8 OHNE Byte-Reihenfolge-Marke hinaus, angekündigt als `text/plain`. Ein deutsches Excel öffnet eine `.csv` ohne Marke in der ANSI-Codepage. Lage: der Inhaber lädt den Bericht herunter und öffnet ihn mit Doppelklick — auf dem Blatt, das der Prüfer bekommt, steht „VerkÃ¤ufe", „AnkÃ¤ufe", „ErmÃ¤Ãigter Steuersatz 7 %", „GezÃ¤hlt bar". Derselbe Weg gilt für `An-Verkaufsbuch_ANKAUF_….csv` (registers.ts:266-269), dort trifft es zusätzlich die Spalte „Verkäufer" und JEDEN Verkäufernamen mit Umlaut — also ausgerechnet die Identitätsangabe, um derentwillen das Register nach § 38 GewO geführt wird.

**Beweis**

GEMESSEN, echter `buildKassenberichtCsv` mit echten Abschlusswerten:
```
BOM? false
erste Bytes: 4b 61 73 73 65 6e 62 65 72 69 63 68
Zeilen mit Umlaut: 4
  UTF-8 : Belege;Verkäufe;3                 → Excel : Belege;VerkÃ¤ufe;3
  UTF-8 : Umsatzsteuer;Ermäßigter Steuersatz 7 %  → Excel : Umsatzsteuer;ErmÃ¤Ãigter Steuersatz 7 %
  UTF-8 : Kasse;Gezählt bar;600,00 EUR      → Excel : Kasse;GezÃ¤hlt bar;600,00 EUR
```
closeing-export.ts:1094-1098:
```
const csv = buildKassenberichtCsv(input);
const filename = `Kassenbericht_${r.business_day}.csv`;
reply.header('Content-Disposition', `attachment; filename="${filename}"`);
reply.type('text/plain; charset=utf-8');
```
kassenbericht-export.ts:306 gibt `stringify(...)` ohne Marke zurück.
Der DATEV-Weg hat GENAU diese Fehlerklasse am 30.07.2026 bereits behoben und den Weg dokumentiert (closing-export.ts:978 `reply.type('text/csv; charset=windows-1252')` + `kodiereAnsi`, dazu packages/api-client/src/domains/closings.ts: „aus dem Byte 0xFC (ü) wurden EF BF BD … Jede Buchung mit Umlaut im Text kam beim Steuerberater verstümmelt an"). Der Kassenbericht blieb dabei aussen vor. Auf der Klientenseite besiegelt es apps/tauri-pos/src/lib/download-file.ts: `downloadTextFile` baut den Blob aus einer Zeichenkette, „ein `Blob` aus einer Zeichenkette wird IMMER als UTF-8 geschrieben". Kein Test prüft Content-Type oder Zeichensatz dieser beiden Wege.

**Vorschlag**

Zwei Handgriffe, beide bereits im Haus vorhanden: den Antworttyp auf `text/csv` setzen (nicht `text/plain`, die Datei heisst `.csv`) und dem Rumpf eine UTF-8-Marke voranstellen (`'﻿' + csv`) — dann liest Excel sie richtig und ein Texteditor ebenfalls. Wer stattdessen wie bei DATEV Windows-1252 will, nimmt `kodiereAnsi` und liefert Bytes; dann muss der Klient auf `downloadBytesFile` umgestellt werden, das für genau diesen Zweck schon existiert. Dasselbe für registers.ts:268. Ein Wächter, der auf die ersten drei Bytes und den Content-Type der beiden Wege zeigt, hält es fest.

**Korrektur des Skeptikers**

Zwei Präzisierungen für die Behebung. ERSTENS: Der Befund nennt den DATEV-Weg „GENAU diese Fehlerklasse". Symptom und Ursprung sind gleich (Zeichensatz nicht Teil des Vertrags), das Heilmittel ist aber ein anderes. DATEV verlangt windows-1252 per Formatvorgabe, dort ist `kodiereAnsi` richtig. Der Kassenbericht und das An- und Verkaufsbuch brauchen KEIN windows-1252, sondern UTF-8 MIT vorangestellter Byte-Reihenfolge-Marke (`stringify(..., { bom: true })` beziehungsweise `'﻿' + csv`) plus `reply.type('text/csv; charset=utf-8')`. Windows-1252 wäre hier sogar schädlich: `kodiereAnsi` wirft bei jedem Zeichen ausserhalb der Codepage (datev-format.test.ts:250 belegt das für ♥), und ein Verkäufername im An- und Verkaufsbuch kann jedes Zeichen tragen — der Export würde für arabische, türkische oder polnische Namen komplett scheitern statt nur hässlich auszusehen. UTF-8 mit Marke trägt jeden Namen und wird von deutschem Excel korrekt geöffnet. ZWEITENS, eine Falle beim Beheben: fiscal-export.test.ts:1428 prüft für das An- und Verkaufsbuch `expect(res.headers['content-type']).toContain('text/plain')`. Wer den Kopf auf `text/csv` umstellt, macht diesen grünen Test ROT — er muss mitgeändert werden und sollte bei der Gelegenheit die Marke und den Zeichensatz mitprüfen, sonst fällt die Klasse ein drittes Mal auf.

---

## 24. [P2] vat.csv beschriftet den § 25a-Schlüssel mit dem rohen Maschinenwort „MARGIN_25A"

**Ort:** `apps/api-cloud/src/lib/dsfinvk-daten.ts:742`  ·  **Dimension:** echter-lauf

**Was bricht**

Gemessener Lauf: der Steuerberater hat nur den Schlüssel 1001 hinterlegt (`dsfinvk.ust_schluessel.margin_25a`), keine Klartextbeschreibung. In der amtlichen `vat.csv`, die das Finanzamt liest, steht dann in UST_BESCHR der interne Bezeichner statt der Norm-Fundstelle — daneben zeigt Zeile 1, wie es aussehen soll. UST_SATZ bleibt zusätzlich leer, obwohl die index.xml die Spalte als Numeric mit Accuracy 2 deklariert.

**Beweis**

Erzeugte Bytes, vat.csv:
`POS-1;2026-08-05T03:15:22.531Z;1;1;19,00;Allgemeiner Steuersatz § 12 Abs. 1 UStG`
`POS-1;2026-08-05T03:15:22.531Z;1;1001;;MARGIN_25A`
Quelle: `beschreibung: code === undefined ? '' : (mensch.eigeneUstBeschreibungen?.[code] ?? code)` (dsfinvk-daten.ts:742) — der Rückfall ist der Code selbst.

**Vorschlag**

Statt auf den Code zurückzufallen, den Export verweigern oder eine feste deutsche Vorgabe je bekanntem Behandlungscode setzen (z. B. „Differenzbesteuerung § 25a UStG", „Steuerschuldnerschaft des Leistungsempfängers § 13b UStG"), analog zu den festen Beschreibungen der amtlichen Schlüssel 1 bis 7. Zusätzlich die Einstellungsmaske um das Pflichtfeld Beschreibung je eigenem Schlüssel erweitern, denn DSFinV-K Tz. 3.2.6 verlangt für Schlüssel ab 1000 ausdrücklich eine Erläuterung in der Verfahrensdokumentation.

**Korrektur des Skeptikers**

Zwei Berichtigungen. Erstens: der Befund beschreibt die Lage als Versäumnis des Beraters. Es gibt aber gar keinen Eingabeweg. dsfinvk.ust_beschreibung.margin_25a und dsfinvk.ust_satz.margin_25a stehen nicht in EDITABLE_SETTINGS (apps/api-cloud/src/routes/settings.ts), PATCH /api/settings/:key wirft für jeden Schlüssel ausserhalb der Positivliste SettingNotEditableError, die Fläche apps/tauri-pos/src/screens/secondary/SteuerberaterSection.tsx führt wörtlich nur drei Felder, und keine Wanderung sät die Werte. Der rohe Bezeichner steht folglich in JEDEM Paket, nicht nur in einem unglücklichen Lauf. Das hebt die Schwere eher auf P1 an. Zweitens: der Zusatz zu UST_SATZ ist falsch gerahmt. Das leere Feld ist eine bewusste, im Quelltext begründete Entscheidung (LEER statt falsch, dsfinvk-daten.ts:704-707) und durch einen grünen Test gepinnt (tests/unit/dsfinvk-daten-fliessen.test.ts:461-467). Kein Verstoss gegen die index.xml, sondern dieselbe Wurzel: der Berater kann den Wert nirgends eintragen.

---
