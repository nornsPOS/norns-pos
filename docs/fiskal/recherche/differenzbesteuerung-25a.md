# Differenzbesteuerung § 25a UStG bei gebrauchtem Gold

Recherchestand 26.07.2026. Alle Gesetzeszitate nach dem heute geltenden Wortlaut. Wo ich etwas nicht gegen eine amtliche Stelle prüfen konnte, steht **unbestätigt**.

---

## 1. § 25a UStG: Voraussetzungen, Ausschlüsse, Verhältnis zu § 25c

**Die drei Voraussetzungen (§ 25a Abs. 1 UStG), wörtlich:**

| Nr. | Wortlaut |
|---|---|
| 1 | „Der Unternehmer ist ein Wiederverkäufer. Als Wiederverkäufer gilt, wer gewerbsmäßig mit beweglichen körperlichen Gegenständen handelt oder solche Gegenstände im eigenen Namen öffentlich versteigert." |
| 2 | „Die Gegenstände wurden an den Wiederverkäufer im Gemeinschaftsgebiet geliefert. Für diese Lieferung wurde Umsatzsteuer nicht geschuldet oder die Differenzbesteuerung vorgenommen." |
| 3 | „Die Gegenstände sind keine Edelsteine (aus Positionen 7102 und 7103 des Zolltarifs) oder Edelmetalle (aus Positionen 7106, 7108, 7110 und 7112 des Zolltarifs)." |

Quelle: [dejure.org, § 25a UStG](https://dejure.org/gesetze/UStG/25a.html), abgerufen 26.07.2026; identisch [gesetze-im-internet.de](https://www.gesetze-im-internet.de/ustg_1980/__25a.html).

**Nr. 3 ist für diesen Laden die entscheidende Vorschrift.** Der UStAE konkretisiert: Edelmetalle im Sinne der Vorschrift sind Silber (7106, 7112), Gold (7108, 7112), Platin (7110, 7112). Und, wörtlich: „Aus Edelsteinen oder Edelmetallen hergestellte Gegenstände (z. B. Schmuckwaren)" fallen **nicht** unter die Ausnahme ([UStAE Abschn. 25a.1](https://www.steuerschroeder.de/steuergesetze/estg/bewg/gmbhg/bgb/ustae/25a.1); amtlich beim BMF unter [usth.bundesfinanzministerium.de, § 25a](https://usth.bundesfinanzministerium.de/usth/2022/A-Umsatzsteuergesetz/VI-Sonderregelungen/Paragraf-25a/inhalt.html)).

Daraus folgt die Trennlinie, die im Quelltext bereits als ADR festgehalten ist (`/Users/basel/Desktop/warehouse14/docs/architecture/adr/0004-25a-excludes-raw-metals.md`): **verarbeitetes Gold (Schmuck, Zolltarif 7113) ist differenzbesteuerungsfähig, rohes und geschrottetes Gold (7108, 7112) ist es nicht.**

**Wann § 25a NICHT gilt:**

- Vorlieferant hatte Vorsteuerabzugsrecht und hat mit ausgewiesener USt geliefert (Abs. 1 Nr. 2 verfehlt).
- Rohe Edelmetalle und Edelsteine (Abs. 1 Nr. 3).
- Ausschlüsse des Abs. 7: steuerfreier innergemeinschaftlicher Erwerb, neue Fahrzeuge, sowie Gegenstände, auf deren Erwerb der ermäßigte Steuersatz angewandt wurde. Ferner ist bei Anwendung der Differenzbesteuerung die Steuerbefreiung für innergemeinschaftliche Lieferungen ausgeschlossen (Abs. 7 Nr. 3).
- **Anteiliges Vorsteuerabzugsrecht am Liefergegenstand.** BFH, Urteil vom 11.12.2024, XI R 9/23: wird ein von privat erworbener Gegenstand mit Teilen aufgewertet, die mit Vorsteuerabzug eingekauft wurden, ist die Differenzbesteuerung für den ganzen Gegenstand ausgeschlossen ([bundesfinanzhof.de, XI R 9/23](https://www.bundesfinanzhof.de/en/entscheidungen/entscheidungen-online/decision-detail/STRE202520099/), Besprechung [Haufe](https://www.haufe.de/steuern/rechtsprechung/differenzbesteuerung-bei-aufwertung-des-liefergegenstands_166_647578.html)). Für einen Goldladen heißt das konkret: ein angekaufter Ring, in den ein mit Vorsteuer gekaufter Stein oder ein neuer Verschluss eingesetzt wird, verliert § 25a.
- Umgekehrt: das Zerlegen eines angekauften Ganzen und der Einzelverkauf der Teile bleibt begünstigt, die anteiligen Einkaufspreise sind sachgerecht zu schätzen und die Schätzungsgrundlage ist in einer Anlage zu den Wareneingangsrechnungen zu erläutern (Abschn. 25a.1 Abs. 4a Satz 4 UStAE, zitiert nach [NWB](https://datenbank.nwb.de/Dokument/730211/)).

**Verhältnis zu § 25c UStG (Anlagegold).** § 25c Abs. 1 stellt Lieferung, Einfuhr und innergemeinschaftlichen Erwerb von Anlagegold **steuerfrei**. Die Frage „differenzbesteuert oder nicht" stellt sich beim Anlagegold gar nicht, weil erstens die Steuerbefreiung greift und zweitens Barren ohnehin aus Position 7108 stammen und damit schon durch § 25a Abs. 1 Nr. 3 ausgeschlossen sind. Zwei unabhängige Sperren, dieselbe Antwort: **Anlagegold nie differenzbesteuert.** § 25c Abs. 3 erlaubt dem gewerblichen Goldhändler den Verzicht auf die Befreiung bei Umsätzen an andere Unternehmer, dann greift Reverse Charge nach § 13b Abs. 2 Nr. 9 UStG.

---

## 2. Einzeldifferenz gegen Gesamtdifferenz, und wie die Grenze wirklich lautet

**Die Grenze heißt seit dem 01.01.2025 nicht mehr 500 Euro, sondern 750 Euro.**

§ 25a Abs. 4 Satz 2 UStG, wörtlich: „Die Besteuerung nach der Gesamtdifferenz ist nur bei solchen Gegenständen zulässig, deren Einkaufspreis 750 Euro nicht übersteigt."

Geändert durch **Artikel 5 des Vierten Bürokratieentlastungsgesetzes, verkündet 23.10.2024, BGBl. 2024 I Nr. 323, in Kraft zum 01.01.2025** ([buzer.de, Änderungshistorie § 25a UStG](https://www.buzer.de/25a_UStG.htm)). Die Handelskammer Hamburg führt in ihrem Merkblatt (Stand Juni 2025) ebenfalls 750 Euro ([Merkblatt Differenzbesteuerung im Gebrauchtwarenhandel](https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/differenzbesteuerung-gebrauchtwarenhandel-6680498)).

**Widerspruch, den ich offenlege:** der mir zugängliche Spiegel des UStAE Abschn. 25a.1 nennt weiterhin 500 Euro ([steuerschroeder.de](https://www.steuerschroeder.de/steuergesetze/estg/bewg/gmbhg/bgb/ustae/25a.1)). Entweder ist der Spiegel veraltet oder der Anwendungserlass ist noch nicht nachgezogen. Der Gesetzeswortlaut steht höher als der Verwaltungserlass, also gilt 750 Euro. Der Bau muss den Wert trotzdem **als datierten Parameter** führen, nicht als Konstante im Code, weil er sich nachweislich ändert.

**Die Mechanik im Vergleich:**

| | Einzeldifferenz (§ 25a Abs. 3) | Gesamtdifferenz (§ 25a Abs. 4) |
|---|---|---|
| Bemessung | je Gegenstand: VK minus EK | je Besteuerungszeitraum: Summe VK minus Summe EK |
| Grenze | keine | Einkaufspreis des einzelnen Gegenstands höchstens 750 Euro |
| Negativer Betrag | Bemessungsgrundlage 0 Euro, keine Verrechnung mit positiven Differenzen, kein Vortrag in spätere Zeiträume | negative Jahres-Gesamtdifferenz ergibt 0 Euro, kein Vortrag ins Folgejahr |
| Verzicht nach Abs. 8 | möglich, je Lieferung | **ausgeschlossen**, „soweit er Absatz 4 nicht anwendet" (Abs. 8), bestätigt in Abschn. 25a.1 Abs. 21 Satz 3 UStAE |
| Steuersatz | immer 19 Prozent (Abs. 5 Satz 1: „mit dem allgemeinen Steuersatz nach § 12 Abs. 1") | ebenso |

Zur Nichtverrechnung: „Bei einem negativen Unterschiedsbetrag beträgt die Bemessungsgrundlage 0 €; dieser Unterschiedsbetrag kann auch in späteren Besteuerungszeiträumen nicht berücksichtigt werden" (UStAE 25a.1).

**Was das für die Aufzeichnung bedeutet, praktisch:**

1. Beide Verfahren dürfen nebeneinander laufen, aber nie für denselben Gegenstand, und die Aufzeichnungen müssen die beiden Ströme sauber trennen.
2. Bei der Gesamtdifferenz muss aus den Aufzeichnungen ersichtlich sein, dass **jeder einzelne** Einkaufspreis die 750 Euro nicht übersteigt. Ein Konvolut, das zu einem Gesamtpreis über 750 Euro erworben wurde, muss so lange aufgeteilt oder sachgerecht geschätzt werden, bis der Restbetrag die Grenze einhält (UStAE 25a.1, Vereinfachung beim Gesamteinkauf).
3. Wer die Gesamtdifferenz nutzt, verliert für diese Gegenstände die Option, im Einzelfall zur Regelbesteuerung zu wechseln. Das ist ein Kassenverhalten, kein Buchhaltungsdetail: der Verkaufsdialog darf für diese Artikel keinen Schalter „regelbesteuert verkaufen" anbieten.
4. Reparatur- und Nebenkosten nach dem Erwerb mindern die Bemessungsgrundlage **nicht** (UStAE 25a.1). Eine Politur oder ein neuer Verschluss darf also nicht in den `acquisition_cost_eur` hineingerechnet werden.

**Formel, die der Code führen muss:** Marge ist brutto, die USt ist herauszurechnen (§ 25a Abs. 3 Satz 3: „Die Umsatzsteuer gehört nicht zur Bemessungsgrundlage").
`USt = max(0, VK − EK) × 19 / 119`, `BMG = max(0, VK − EK) × 100 / 119`.

---

## 3. Aufzeichnungspflichten

**§ 25a Abs. 6 UStG, wörtlich, beide Sätze:**

> „§ 22 gilt mit der Maßgabe, dass aus den Aufzeichnungen des Wiederverkäufers zu ersehen sein müssen die Verkaufspreise oder die Werte nach § 10 Abs. 4 Satz 1 Nr. 1, die Einkaufspreise und die Bemessungsgrundlagen nach den Absätzen 3 und 4. Wendet der Wiederverkäufer neben der Differenzbesteuerung die Besteuerung nach den allgemeinen Vorschriften an, hat er getrennte Aufzeichnungen zu führen."

**Der UStAE macht daraus die Pflicht je Gegenstand**, wörtlich: „Der Wiederverkäufer, der Umsätze von Gebrauchtgegenständen nach § 25a UStG versteuert, hat **für jeden Gegenstand getrennt** den Verkaufspreis oder den Wert nach § 10 Abs. 4 Satz 1 Nr. 1 UStG, den Einkaufspreis und die Bemessungsgrundlage aufzuzeichnen."

**§ 22 UStG darunter:** Abs. 1 Satz 1: „Der Unternehmer ist verpflichtet, zur Feststellung der Steuer und der Grundlagen ihrer Berechnung Aufzeichnungen zu machen." Abs. 2 Nr. 1 verlangt, dass ersichtlich ist, „wie sich die Entgelte auf die steuerpflichtigen Umsätze, getrennt nach Steuersätzen, und auf die steuerfreien Umsätze verteilen" ([gesetze-im-internet.de, § 22 UStG](https://www.gesetze-im-internet.de/ustg_1980/__22.html)).

**Damit steht die Mindest-Datenzeile je verkauftem Stück fest, und das ist eine Bau-Anforderung, keine Empfehlung:**

| Feld | Herkunft |
|---|---|
| eindeutige Gegenstandskennung | Serialisiertes Inventar, vorhanden |
| Einkaufspreis | `acquisition_cost_eur`, unveränderlich |
| Ankaufsdatum und Ankaufbeleg-Nummer | Ankaufbeleg |
| Verkaufspreis brutto | Transaktionszeile |
| Bemessungsgrundlage, also Marge netto | berechnet, gespeichert, nicht nachträglich neu gerechnet |
| USt-Betrag aus der Marge | berechnet, gespeichert |
| Verfahren: Einzeldifferenz oder Gesamtdifferenz | Kennzeichen je Gegenstand |
| Behandlungscode zum Verkaufszeitpunkt | `applied_tax_treatment_code`, vorhanden |

Zusätzlich für Anlagegold: § 25c Abs. 6 UStG verweist ausdrücklich weiter, wörtlich: „Bei Umsätzen mit Anlagegold gelten zusätzlich zu den Aufzeichnungspflichten nach § 22 die Identifizierungs-, Aufzeichnungs- und Aufbewahrungspflichten des Geldwäschegesetzes entsprechend" ([juraforum.de, § 25c UStG](https://www.juraforum.de/gesetze/ustg/25c-besteuerung-von-umsaetzen-mit-anlagegold)). Die Schwelle steht also im GwG, nicht im UStG. Für Edelmetallhändler greift die Identifizierungspflicht bei Barzahlungen ab **2.000 Euro** (§ 10 Abs. 6a GwG), Aufsichtshinweise dazu beim [RP Gießen](https://rp-giessen.hessen.de/sicherheit-und-kommunales/bekaempfung-von-geldwaesche/gueterhaendler-kunstvermittler-und-kunstlagerhalter).

---

## 4. DATEV: Konten und Steuerschlüssel

**Die Methode, die DATEV selbst vorsieht, ist die Erlösaufteilung auf zwei Konten**, nicht ein Konto mit Steuerschlüssel:

| Kontenzweck | SKR03 | SKR04 |
|---|---|---|
| Umsatzerlöse nach §§ 25 und 25a UStG, 19 Prozent USt (der **Margenanteil**) | **8191** | **4136** |
| Umsatzerlöse nach §§ 25 und 25a UStG, ohne USt (der **Einkaufspreisanteil**) | **8193** | **4138** |

Haufe zitiert die Buchungsanweisung wörtlich: „Bei der Veräußerung bucht der Unternehmer den Erlös in Höhe des Einkaufspreises auf das Konto ‚Erlöse Differenzbesteuerung ohne USt' 8193 (SKR 03) bzw. 4138 (SKR 04) und den darüber hinausgehenden Differenzbetrag auf das Konto ‚Erlöse Differenzbesteuerung 19 % USt' 8191 (SKR 03) bzw. 4136 (SKR 04)" ([Haufe, Differenzbesteuerung, Gebrauchtfahrzeuge, So kontieren Sie richtig](https://www.haufe.de/id/beitrag/differenzbesteuerung-gebrauchtfahrzeuge-1-so-kontieren-sie-richtig-HI1905852.html)). Die Kontenbezeichnung „Umsatzerlöse nach §§ 25 und 25a UStG" ist die DATEV-Bezeichnung, siehe die DATEV-Kontenerläuterung [LEXinform 5362091](https://wissensplattform.apps.datev.de/research/document/5362091) (Volltext nur mit DATEV-Zugang, Titel öffentlich).

**Buchungssatz, Zahlenbeispiel, SKR03, Verkauf eines angekauften Rings, EK 600 Euro, VK 900 Euro:**

```
1000 Kasse                                    900,00
   an 8193 Erlöse Differenzbesteuerung o. USt    600,00
   an 8191 Erlöse Differenzbesteuerung 19 % USt  300,00
```
Marge 300,00, davon USt 300 × 19/119 = **47,90**, Nettomarge 252,10.

**Widersprüchliche Quellenlage, die ich nicht auflöse, sondern benenne:**

- Zwei Fachblogs nennen abweichende Konten (SKR03 3420 / SKR04 5420 Wareneinkauf, SKR03 8420 / SKR04 4420 Erlöse) und **DATEV-Steuerschlüssel 76 für 19 Prozent und 75 für 7 Prozent** ([onlinebilanz.de](https://onlinebilanz.de/differenzbesteuerung-buchen-skr03-skr04-datev/), [autopult.de](https://autopult.de/differenzbesteuerung-buchen/)). Dieselbe Quelle bezeichnet 76 zugleich als „UVA-Kennzahl". Kennzahl 76 ist in der Umsatzsteuer-Voranmeldung die Zeile „Umsätze, die anderen Steuersätzen unterliegen", nicht die Differenzbesteuerung. Ich konnte **keinen DATEV-eigenen Beleg für einen BU-Schlüssel 75 oder 76 finden**, die DATEV-Steuerschlüsseltabelle liegt hinter Anmeldung ([DATEV Hilfe-Center, SKR03/SKR04 Steuerschlüssel-Tabelle](https://help-center.apps.datev.de/documents/0907054)). **Unbestätigt, nicht in den Export einbauen, bevor der Steuerberater es bestätigt.**
- BuchhaltungsButler nennt wieder andere Konten (8220/8225) und sagt ausdrücklich, Einzelkonten für die Differenzbesteuerung seien im Standardkontenrahmen nicht vorhanden ([buchhaltungsbutler.de](https://www.buchhaltungsbutler.de/wiki/differenzbesteuerung-buchen/)). Ebenso arbeitet die Praxisdarstellung von [Steuerberater Preßler](https://www.steuerberater-pressler.de/differenzbesteuerung/) mit selbst angelegten Konten ohne Automatikfunktion.

**Näher an der amtlichen Stelle ist die Haufe-/DATEV-Kontenpaarung 8191/8193 bzw. 4136/4138**, weil sie mit der DATEV-Kontenbezeichnung übereinstimmt. Die Blogs sind Blogs.

**Offene Frage für den Steuerberater, sie ist eine Bau-Frage:** ob 8191 bzw. 4136 im Mandanten-Kontenrahmen ein Automatikkonto mit 19 Prozent ist. Wenn ja, darf der Export dort **keinen** BU-Schlüssel mitgeben, sonst kollidiert der Schlüssel mit der Kontenfunktion. Wenn nein, muss der Schlüssel gesetzt werden. Das ist genau der Punkt, an dem ein Import beim Berater rot wird.

**Umsatzsteuer-Voranmeldung:** die Nettomarge fließt in die normale 19-Prozent-Zeile (Kennzahl 81). Das ist die Folge der Kontenfunktion, ich habe es **nicht** gegen ein amtliches Formular geprüft. Unbestätigt.

---

## 5. Die Rechnung: was drauf muss, was verboten ist

**Pflichtangabe, § 14a Abs. 6 Satz 1 UStG:** die Rechnung muss die Angabe **„Gebrauchtgegenstände/Sonderregelung"** enthalten. Für die anderen Fälle lauten die Formeln „Kunstgegenstände/Sonderregelung" und „Sammlungsstücke und Antiquitäten/Sonderregelung" ([gesetze-im-internet.de, § 14a UStG](https://www.gesetze-im-internet.de/ustg_1980/__14a.html)).

**Verboten:** der gesonderte Ausweis der Umsatzsteuer. § 14a Abs. 6 Satz 2 UStG erklärt § 14 Abs. 4 Satz 1 Nr. 8 für nicht anwendbar. Der UStAE schärft nach: „Das Verbot des gesonderten Ausweises der Steuer in einer Rechnung gilt auch dann, wenn der Wiederverkäufer einen Gebrauchtgegenstand an einen anderen Unternehmer liefert."

**Die Sanktion, und sie ist doppelt:** weist der Wiederverkäufer die Steuer trotzdem aus, „schuldet er die gesondert ausgewiesene Steuer nach § 14c Abs. 2 UStG. Zusätzlich zu dieser Steuer schuldet er für die Lieferung des Gegenstands die Steuer nach § 25a UStG" (UStAE 25a.1). Also einmal die Marge, und obendrauf den ganzen ausgewiesenen Betrag.

**Also auf den Bon gehört:**
- Bruttopreis in einer Summe, kein USt-Betrag, kein Steuersatz, keine Nettozeile.
- Der Hinweis „Gebrauchtgegenstände/Sonderregelung", ergänzt um den Klartext „Differenzbesteuerung nach § 25a UStG".
- **Und auf demselben Bon darf keine Summenzeile stehen, die die Differenzbesteuerung mit regelbesteuerten Positionen in einen USt-Ausweis zusammenzieht.** Bei gemischten Bons braucht der Ausweisblock zwei getrennte Zonen, sonst erzeugt der Beleg genau den § 14c-Fall.
- Versandkosten dürfen nicht mit gesonderter USt daneben stehen, entweder als Nebenleistung in den Preis oder auf eine eigene Rechnung ([Handelskammer Hamburg](https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/differenzbesteuerung-gebrauchtwarenhandel-6680498)).

**Strittig, offen gesagt:** ob das Fehlen des Hinweises die Differenzbesteuerung materiell kippt, wird unterschiedlich gesehen. Es gibt Rechtsprechung dahin, dass die Differenzbesteuerung auch ohne Rechnungshinweis anzuwenden ist ([Deubner Steuern](https://www.deubner-steuern.de/themen/umsatzsteuer/differenzbesteuerung/differenzbesteuerung-auch-ohne-rechnungshinweis.html)), zugleich weist die Fachpresse darauf hin, dass der Hinweis praktisch relevant werden kann ([IWW](https://www.iww.de/asr/steuern-und-abgaben/umsatzsteuer-rechnungshinweis-auf-differenzbesteuerung-kann-relevant-werden-f71883)). Für den Bau ist das gleichgültig: den Hinweis immer drucken.

---

## 6. Der Ankauf von privat und der Beleg, der die Eingangsrechnung ersetzt

Es gibt keine Eingangsrechnung, weil die Privatperson keine ausstellen kann und darf. An ihre Stelle tritt der vom Händler erstellte **Ankaufbeleg**, ein Eigenbeleg mit Unterschrift des Verkäufers. Er ist zugleich der einzige Nachweis für den Einkaufspreis, und der Einkaufspreis ist die halbe Bemessungsgrundlage. Ein Ankaufbeleg, der den Prüfer überzeugt, trägt:

Fortlaufende Nummer, Datum, Name und Anschrift des Verkäufers und Ausweisdaten (GwG, ab 2.000 Euro bar zwingend), Beschreibung des Gegenstands mit Legierung, Gewicht und Stückkennung, Einkaufspreis je Stück und in Summe, Zahlungsart, Unterschrift, sowie die Erklärung, dass der Verkäufer Privatperson ist und keine Umsatzsteuer schuldet. Genau die Erklärung trägt die Voraussetzung des § 25a Abs. 1 Nr. 2.

**Buchung des Ankaufs, ohne Vorsteuer, ohne Steuerschlüssel:**

```
SKR03:  3200 Wareneingang (bzw. eigenes Konto Wareneingang §25a)   an  1000 Kasse
SKR04:  5200 Wareneingang (bzw. eigenes Konto Wareneingang §25a)   an  1600 Kasse
```

Ein **eigenes** Wareneingangskonto für § 25a-Ware ist keine Kosmetik, sondern die buchhalterische Umsetzung der Trennungspflicht aus § 25a Abs. 6 Satz 2. Ob dafür ein Standardkonto genutzt oder ein Konto ohne Automatikfunktion angelegt wird, entscheidet der Steuerberater, hier gehen die Quellen auseinander (siehe Abschnitt 4). Für den Bau bedeutet es: **Wareneingangskonto und Erlöskonten müssen konfigurierbar sein, pro Mandant, nicht im Code fest.**

---

## 7. Gold: die vier Fälle und wo die Grenzen liegen

| Ware | Zolltarif | Umsatzsteuerliche Behandlung | Rechtsgrund |
|---|---|---|---|
| **Anlagegold**, Barren oder Plättchen, Feingehalt ab 995/1000, marktübliches Gewicht | 7108 | **steuerfrei**, kein § 25a | § 25c Abs. 1, Abs. 2 Nr. 1 UStG |
| **Anlagegoldmünzen**, Feingehalt ab 900/1000, geprägt nach 1800, gesetzliches Zahlungsmittel im Ursprungsland, Verkaufspreis höchstens 80 Prozent über dem Goldwert | 7118 | **steuerfrei**, kein § 25a | § 25c Abs. 2 Nr. 2 UStG |
| **Schmuck**, gebraucht, von privat angekauft, unverändert weiterverkauft | 7113 | **differenzbesteuert**, 19 Prozent auf die Marge | § 25a, UStAE 25a.1 („Schmuckwaren" nicht ausgenommen) |
| **Zahngold, Bruchgold, Altgold zum Einschmelzen** | 7108 / 7112 | **kein § 25a**. Verkauf an eine Scheideanstalt: Reverse Charge, Nettorechnung mit Hinweis „Steuerschuldnerschaft des Leistungsempfängers" | § 25a Abs. 1 Nr. 3; § 13b Abs. 2 Nr. 7 iVm Anlage 3 (Schrott) bzw. § 13b Abs. 2 Nr. 9 (Gold ab 325/1000 in Rohform oder als Halbzeug) |
| **Sammlermünzen**, kein Anlagegold | 9705 | **19 Prozent**, § 25a möglich, sofern von privat erworben und keine Rohmetall-Position | siehe unten |

**Anlagegold, Detail zu den Gewichten.** Die OFD Baden-Württemberg hat mit Verfügung vom **27.03.2025, S 7423** klargestellt, dass „von den Goldmärkten akzeptiertes Gewicht" **alle** Gewichte umfasst, auch solche unterhalb der in der MwStVO genannten Stufen. Ferner: Hersteller, Feingehalt und Gewicht müssen eingeprägt sein, der Wert muss sich im Wesentlichen nach dem Goldpreis richten, bildliche Darstellungen sind unschädlich, und eine Orientierungsgrenze von 10 Prozent Aufschlag gilt als nicht überschritten ([Referat der Verfügung, IFRS-Akademie](https://www.ifrs-akademie.de/blog/blog-detailansicht/umsatzsteuer-steuerbefreiung-von-umsaetzen-mit-anlagegold-ofd/), Fundstelle [NWB Dok. 1072262](https://datenbank.nwb.de/Dokument/1072262/)). **Das ist die für diesen Laden zuständige Oberfinanzdirektion.** Die 10-Prozent-Aussage habe ich nur in der Referatsfassung gelesen, nicht im Volltext der Verfügung: als Zitat unbestätigt, dem Sinn nach belegt.

**Münzen, die Grenze zwischen 19 und 7 Prozent.** Anlagegoldmünzen sind steuerfrei. Alle übrigen Goldmünzen sind 19 Prozent. Der ermäßigte Satz für Sammlungsstücke greift nur, wenn die Bemessungsgrundlage **mehr als 250 Prozent des Metallwerts** beträgt, und das BMF gibt dafür jährlich die maßgeblichen Preise bekannt: **BMF-Schreiben vom 02.12.2025, III C 2 - S 7229/00013/002/002, Silberpreis für 2026 1.464 Euro je Kilogramm ohne Umsatzsteuer, für Goldmünzen ist der Londoner Nachmittagsfixing-Tagespreis je Feinunze (31,1035 Gramm) maßgebend** ([BMF, Bekanntmachung des Gold- und Silberpreises für 2026](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/2025-12-02-gold-und-silberpreise.html)). Für Silbermünzen gilt seit 2014 der Regelsatz statt der früheren 7 Prozent ([Haufe](https://www.haufe.de/steuern/gesetzgebung-politik/ab-2014-hoehere-mehrwertsteuer-auf-silbermuenzen_168_196774.html)).

**Merke die Falle, sie ist die teuerste in diesem Geschäft:** derselbe Ring ist differenzbesteuert, wenn er als Schmuck weiterverkauft wird, und **nicht** differenzbesteuert, wenn er als Bruchgold an die Scheideanstalt geht. Die steuerliche Behandlung hängt nicht am Ankauf, sondern am **Verwendungsweg beim Verkauf**. Ein System, das die Behandlung beim Wareneingang festschreibt und nie wieder anfasst, produziert genau hier falsche Exporte.

---

## 8. Was Kassensysteme typischerweise falsch machen, und was der Prüfer sofort sieht

| Fehler | Woran der Prüfer ihn in Minuten erkennt |
|---|---|
| Umsatzsteuer wird auf dem differenzbesteuerten Bon ausgewiesen | Ein einziger Bon genügt. Folge: § 14c Abs. 2 plus § 25a, doppelt |
| Der Einkaufspreis wird nicht je Gegenstand geführt, die Marge wird pauschal oder nachträglich gerechnet | Er verlangt zu drei Stückkennungen die Kette Ankaufbeleg, Einkaufspreis, Verkaufspreis, Bemessungsgrundlage. Fehlt ein Glied, ist die Aufzeichnungspflicht des § 25a Abs. 6 verletzt |
| Negative Einzeldifferenzen werden mit positiven verrechnet | Er summiert die Margen einer Woche und vergleicht mit der Summe der positiven Einzelmargen. Weicht es ab, ist verrechnet worden, was der UStAE ausdrücklich verbietet |
| Keine getrennten Aufzeichnungen zwischen § 25a und Regelbesteuerung | Ein Erlöskonto, auf das alles läuft. § 25a Abs. 6 Satz 2 verlangt Trennung |
| Rohgold, Bruchgold und Zahngold laufen als differenzbesteuert | Er sucht Warengruppen mit „Altgold", „Bruch", „Zahn", „Barren" und prüft deren Steuerkennzeichen gegen § 25a Abs. 1 Nr. 3 |
| Anlagegold wird mit 19 Prozent statt steuerfrei erfasst, oder umgekehrt Nichtanlagegold steuerfrei | Feingehalt und Gewicht gegen § 25c Abs. 2 |
| Marge mit 7 Prozent gerechnet, weil der Artikel „ermäßigt" ist | § 25a Abs. 5 Satz 1 kennt nur den allgemeinen Steuersatz |
| Der Steuersatz oder Einkaufspreis ist nachträglich änderbar | Er lässt sich das Änderungsprotokoll zeigen. GoBD-Unveränderbarkeit |
| Der 750-Euro-Test der Gesamtdifferenz wird auf das Konvolut statt auf den Einzelgegenstand angewandt | Ein Konvolut-Einkauf über 750 Euro ohne dokumentierte Schätzungsgrundlage |
| Bei Aufarbeitung wurde Vorsteuer aus Ersatzteilen gezogen und trotzdem differenzbesteuert verkauft | Vorsteuerkonto gegen Warenausgang, BFH XI R 9/23 |

Allgemein zur Kassennachschau: der Prüfer kann bei Auffälligkeiten ohne Prüfungsanordnung unmittelbar zur Betriebsprüfung übergehen ([IWW, typische Mängel in der Kassenführung](https://www.iww.de/bbp/bilanzierung/kassennachschau-typische-maengel-in-der-kassenfuehrung-danach-suchen-kassenpruefer-f126632)).

---

## 9. Befunde im eigenen Quelltext

Die Recherche trifft direkt auf drei Stellen des Systems.

**Befund A, der schwerste. Der DATEV-Export enthält den Einkaufspreis nicht, also ist die Marge daraus nicht berechenbar.**
`/Users/basel/Desktop/warehouse14/apps/api-cloud/src/routes/closing-export.ts:130` bis `:135`:

```ts
const ERLOES_BY_TREATMENT: Record<string, { konto: string; bu: string }> = {
  STANDARD_19: { konto: '8400', bu: '3' },
  REDUCED_7: { konto: '8300', bu: '2' },
  MARGIN_25A: { konto: '8200', bu: '' },
  INVESTMENT_GOLD_25C: { konto: '8150', bu: '' },
};
```

Der Kommentar darüber (`:126`) sagt, das Konto 8200 „modelliere" die Differenzbesteuerung und der Bruttoverkauf werde dort „by design" gebucht. Das ist gerade **nicht** die DATEV-Methode: dort wird der Erlös in zwei Beträge zerlegt, Einkaufspreisanteil auf 8193 bzw. 4138, Margenanteil auf 8191 bzw. 4136. Der Datensatz dafür existiert bereits: `acquisition_cost_eur` in `/Users/basel/Desktop/warehouse14/packages/db/src/schema/products/products.ts:96`, `NOT NULL`, mit Kommentar „§25a margin tax, must be immutable". Er wird in der Export-Abfrage schlicht nicht mitgelesen (`closing-export.ts:505` und `:747` selektieren nur `applied_tax_treatment_code` und `line_total_eur`). Ergebnis heute: der Steuerberater bekommt Bruttoerlöse ohne Marge und muss den § 25a-Teil von Hand rekonstruieren. Genau das Gegenteil von „er soll nichts tun müssen".

**Befund B. Der EXTF-Kopf setzt die Sachkontenlänge vermutlich in das falsche Feld, und Zeitraum sowie Berater und Mandant fehlen.**
`/Users/basel/Desktop/warehouse14/apps/api-cloud/src/lib/datev-export.ts:63`:

```
EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;;;;;;;;;
```
Das sind 31 Felder, die `4` steht auf Position **15**. In einem realen Kopf steht auf 14 die Sachkontenlänge und auf 15 „Datum von": `"EXTF";700;21;Buchungsstapel;12;20211206000000000;;;;;1234567;12345;20210101;4;20211101;20211130;Export 11/2021;AM;1;0;1;EUR` (Beispiel aus der Suchergebnis-Zusammenfassung zu [auditplan.io](https://auditplan.io/datev-buchungsstapel-extf) und [rechnungswesenforum](https://www.rechnungswesenforum.de/forum/sonstiges/off-topic/datev-format-buchungsstapel-zum-uebergeben-von-buchungen-header-extf.556651/)). Die maßgebliche Stelle ist die [DATEV-Formatbeschreibung Buchungsstapel](https://developer.datev.de/de/file-format/details/datev-format/format-description/booking-batch), deren Inhalt ich nicht laden konnte. **Feldposition daher als starker Verdacht, nicht als Beweis.** Sicher ist dagegen die Folge: Felder 11 Berater, 12 Mandant, 13 WJ-Beginn, 15 Datum von, 16 Datum bis sind leer, und das Belegdatum wird nach `datev-export.ts:71` nur als `DDMM` geschrieben. **Damit trägt die Datei nirgends eine Jahreszahl.** Für die Forderung „Export für jeden Zeitraum, jederzeit" ist das der Bruch: ein Zeitraum über einen Jahreswechsel ist im File nicht mehr unterscheidbar.

**Befund C. Der Bon-Text ist gesetzt, die Beträge sind es noch nicht.** ADR-0004 verlangt für Margenverkäufe die Fußzeile „Gebrauchtgegenstand / Differenzbesteuerung nach § 25a UStG". Der gesetzliche Pflichttext lautet **„Gebrauchtgegenstände/Sonderregelung"** (§ 14a Abs. 6 Satz 1). Beides drucken. Wichtiger: es braucht einen Wächter-Test, der beweist, dass auf einem gemischten Bon der USt-Block die § 25a-Positionen **nicht** mit ausweist.

---

## 10. Was für den Bau unmittelbar zählt

| # | Regel | Zahl, Feld, Konto | Rechtsgrund | Bauort |
|---|---|---|---|---|
| 1 | Marge je Gegenstand, nie verrechnet | `max(0, VK − EK)`, USt `× 19/119` | § 25a Abs. 3, Abs. 5 S. 1, UStAE 25a.1 | Domänen-Steuerrechner |
| 2 | Grenze Gesamtdifferenz | **750 Euro** je Einzelgegenstand, seit 01.01.2025 | § 25a Abs. 4 S. 2, BEG IV, BGBl. 2024 I Nr. 323 | datierter Parameter, nicht Konstante |
| 3 | Negative Differenz | Bemessungsgrundlage 0, kein Vortrag, keine Verrechnung | UStAE 25a.1 | Steuerrechner, Test |
| 4 | Immer 19 Prozent auf die Marge | nie 7 Prozent | § 25a Abs. 5 S. 1 | Kombination Marge plus `REDUCED_7` verbieten |
| 5 | Aufzeichnung je Stück | VK, EK, Bemessungsgrundlage, Verfahren, Ankaufbeleg-Nummer | § 25a Abs. 6 S. 1, § 22 UStG | Exportzeile und Prüferbericht |
| 6 | Getrennte Aufzeichnung | § 25a-Strom und Regelbesteuerung nie auf einem Konto | § 25a Abs. 6 S. 2 | eigene Wareneingangs- und Erlöskonten |
| 7 | DATEV-Erlösaufteilung | SKR03 **8193** EK-Anteil, **8191** Margenanteil; SKR04 **4138** und **4136** | DATEV-Kontenbezeichnung, Haufe | `closing-export.ts:130` ersetzen, SKR03 und SKR04 wählbar |
| 8 | BU-Schlüssel auf diesen Konten | offen: Automatikkonto oder nicht | DATEV-Kontenfunktionen | vom Steuerberater bestätigen lassen, „76/75" ist unbestätigt |
| 9 | EXTF-Kopf | Berater, Mandant, WJ-Beginn, Sachkontenlänge auf Feld 14, Datum von und bis auf 15 und 16 als `YYYYMMDD` | DATEV-Formatbeschreibung | `datev-export.ts:63` |
| 10 | Belegdatum | `DDMM`, Jahr nur über Kopf-Zeitraum ableitbar | DATEV-Format | Export über Jahreswechsel sperren oder splitten |
| 11 | Rechnung | „Gebrauchtgegenstände/Sonderregelung", **kein** USt-Ausweis | § 14a Abs. 6 UStG | Bondruck, gemischte Bons getrennt ausweisen |
| 12 | Sanktion bei Ausweis | § 14c Abs. 2 **plus** § 25a, doppelt | UStAE 25a.1 | Wächter-Test |
| 13 | Ausschluss roher Edelmetalle | 7102, 7103, 7106, 7108, 7110, 7112 | § 25a Abs. 1 Nr. 3 | Klassifizierer, bereits als ADR-0004 vorhanden |
| 14 | Schmuck bleibt drin | Position 7113 | UStAE 25a.1 | Klassifizierer |
| 15 | Behandlung entscheidet der Verkaufsweg | Schmuckverkauf § 25a, Bruchgold an Scheideanstalt Reverse Charge | § 13b Abs. 2 Nr. 7 und Nr. 9 UStG | Behandlung am Verkauf neu prüfen, nicht am Wareneingang einfrieren |
| 16 | Anlagegold | Barren ab **995/1000**, Münzen ab **900/1000**, nach 1800, Zahlungsmittel, Aufschlag höchstens **80 Prozent** | § 25c Abs. 1, Abs. 2 UStG | Klassifizierer, Regeln 1 und 2 vorhanden |
| 17 | Anlagegold-Barrengewicht | alle Gewichte, auch kleine | OFD Baden-Württemberg 27.03.2025, S 7423 | Gewichts-Whitelist entfernen, falls vorhanden |
| 18 | Anlagegold-Münzliste | jährliches EU-Verzeichnis | § 25c Abs. 2 Nr. 2 | Whitelist als datierte Tabelle pflegen, nicht im Code (der alte Code-Träger ist am 19.08.2026 ausgezogen; die Frage liegt beim Steuerberater, A5) |
| 19 | Sammlermünzen 250 Prozent | Silber 2026: **1.464 Euro/kg** ohne USt; Gold: Londoner Nachmittagsfixing je 31,1035 g | BMF v. 02.12.2025, III C 2 - S 7229/00013/002/002 | jährlicher Parameter |
| 20 | Aufwertung mit Vorsteuerteilen | § 25a entfällt für den ganzen Gegenstand | BFH 11.12.2024, XI R 9/23 | Sperre, sobald Vorsteuerteil auf ein § 25a-Stück gebucht wird |
| 21 | Nebenkosten | Reparatur erhöht den Einkaufspreis **nicht** | UStAE 25a.1 | `acquisition_cost_eur` unveränderlich halten |
| 22 | Zerlegen und Einzelverkauf | anteilige EK per sachgerechter Schätzung, Grundlage dokumentieren | Abschn. 25a.1 Abs. 4a S. 4 UStAE | Konvolut-Aufteilung mit Begründungsfeld |
| 23 | Kein Verzicht bei Gesamtdifferenz | Option nach Abs. 8 gesperrt | § 25a Abs. 8, Abschn. 25a.1 Abs. 21 S. 3 UStAE | Verkaufsdialog |
| 24 | GwG neben § 25c | Identifizierung ab **2.000 Euro** bar bei Edelmetallen | § 25c Abs. 6 UStG, § 10 Abs. 6a GwG | KYC-Schwelle |

---

## Quellen

- [§ 25a UStG, gesetze-im-internet.de](https://www.gesetze-im-internet.de/ustg_1980/__25a.html) und [dejure.org](https://dejure.org/gesetze/UStG/25a.html)
- [Änderungshistorie § 25a UStG, buzer.de](https://www.buzer.de/25a_UStG.htm) (500 auf 750 Euro, BEG IV, BGBl. 2024 I Nr. 323, ab 01.01.2025)
- [§ 25c UStG, gesetze-im-internet.de](https://www.gesetze-im-internet.de/ustg_1980/__25c.html) und [juraforum.de](https://www.juraforum.de/gesetze/ustg/25c-besteuerung-von-umsaetzen-mit-anlagegold)
- [§ 22 UStG, gesetze-im-internet.de](https://www.gesetze-im-internet.de/ustg_1980/__22.html)
- [§ 14a UStG, gesetze-im-internet.de](https://www.gesetze-im-internet.de/ustg_1980/__14a.html)
- [UStAE Abschn. 25a.1](https://www.steuerschroeder.de/steuergesetze/estg/bewg/gmbhg/bgb/ustae/25a.1); amtlich [BMF Umsatzsteuer-Handausgabe, § 25a](https://usth.bundesfinanzministerium.de/usth/2022/A-Umsatzsteuergesetz/VI-Sonderregelungen/Paragraf-25a/inhalt.html)
- [BMF, Gold- und Silberpreis für 2026, Schreiben vom 02.12.2025](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/2025-12-02-gold-und-silberpreise.html)
- [BFH, Urteil vom 11.12.2024, XI R 9/23](https://www.bundesfinanzhof.de/en/entscheidungen/entscheidungen-online/decision-detail/STRE202520099/)
- [OFD Baden-Württemberg vom 27.03.2025, S 7423, NWB Dok. 1072262](https://datenbank.nwb.de/Dokument/1072262/), Referat bei der [IFRS-Akademie](https://www.ifrs-akademie.de/blog/blog-detailansicht/umsatzsteuer-steuerbefreiung-von-umsaetzen-mit-anlagegold-ofd/)
- [Handelskammer Hamburg, Differenzbesteuerung im Gebrauchtwarenhandel, Stand Juni 2025](https://www.handelskammer-hamburg.de/recht-steuern/steuerrecht/umsatzsteuer-mehrwertsteuer/umsatzsteuer-mehrwertsteuer-national/differenzbesteuerung-gebrauchtwarenhandel-6680498)
- [Haufe, Differenzbesteuerung Gebrauchtfahrzeuge, So kontieren Sie richtig, Konten 8191/8193 und 4136/4138](https://www.haufe.de/id/beitrag/differenzbesteuerung-gebrauchtfahrzeuge-1-so-kontieren-sie-richtig-HI1905852.html); [Haufe, Gesamtdifferenz](https://www.haufe.de/id/beitrag/differenzbesteuerung-gesamtdifferenz-1-so-kontieren-sie-richtig-HI1976593.html)
- [DATEV Hilfe-Center, SKR03/SKR04 Steuerschlüssel-Tabelle 2025](https://help-center.apps.datev.de/documents/0907054) und [DATEV Kontenerläuterung LEXinform 5362091](https://wissensplattform.apps.datev.de/research/document/5362091) (beide nur mit Zugang im Volltext)
- [DATEV-Formatbeschreibung Buchungsstapel](https://developer.datev.de/de/file-format/details/datev-format/format-description/booking-batch) (Inhalt nicht abrufbar), Beispielkopf über [auditplan.io](https://auditplan.io/datev-buchungsstapel-extf)
- [Haufe, § 13b und Verkauf von Goldwaren, Feingehalt 325/1000](https://www.haufe.de/id/beitrag/umsatzsteuer-wechsel-der-steuerschuldnerschaft-510-verkauf-von-goldwaren-HI7700718.html); [UStAE 13b.4, Industrieschrott](https://usth.bundesfinanzministerium.de/usth/2019-2020/A-Umsatzsteuergesetz/IV-Steuer-und-Vorsteuer/Paragraf-13b/ae-13b-4.html)
- [IWW, typische Mängel in der Kassenführung](https://www.iww.de/bbp/bilanzierung/kassennachschau-typische-maengel-in-der-kassenfuehrung-danach-suchen-kassenpruefer-f126632)
- [RP Gießen, Güterhändler und GwG](https://rp-giessen.hessen.de/sicherheit-und-kommunales/bekaempfung-von-geldwaesche/gueterhaendler-kunstvermittler-und-kunstlagerhalter)
- Blogs mit abweichenden Angaben, als solche gekennzeichnet: [onlinebilanz.de](https://onlinebilanz.de/differenzbesteuerung-buchen-skr03-skr04-datev/), [autopult.de](https://autopult.de/differenzbesteuerung-buchen/), [buchhaltungsbutler.de](https://www.buchhaltungsbutler.de/wiki/differenzbesteuerung-buchen/), [steuerberater-pressler.de](https://www.steuerberater-pressler.de/differenzbesteuerung/)

**Nicht verifiziert, ausdrücklich offen:** die DATEV-BU-Schlüssel 75 und 76; die Feldposition der Sachkontenlänge im EXTF-Kopf (Beispiel statt Spezifikation); die Kennzahl 81 der Voranmeldung; die 10-Prozent-Orientierungsgrenze der OFD-Verfügung im Volltext; ob der UStAE Abschn. 25a.1 inzwischen auf 750 Euro angepasst wurde.