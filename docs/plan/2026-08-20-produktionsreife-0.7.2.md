# Der Weg zu 0.7.2 — Basels Auftrag vom 20.08.2026

Basel: „ادرسو وسوي خطة واشتغل عليها نقطة نقطة حتى تنتهي" — studieren, planen,
Punkt für Punkt abarbeiten. Ziel: eine Fassung, die der Händler bekommt, den
TSE-Klientencode einträgt und die SOFORT arbeitet.

Die Reihenfolge folgt dem RISIKO, nicht der Bequemlichkeit.

---

## 1. Der Kurs verkauft sich selbst  (höchster Ärger, echter Defekt)

**Befund, gemessen:** Die Maschinerie ist vollständig — der Motor holt alle
fünf Minuten Kurse, `products-list` rechnet `kurspreisEur` aus Kurs plus
Verkaufsaufschlag, die Kachel zeigt ihn als „Tagespreis". Aber der KORB bucht
`listPriceEur`, den gespeicherten Preis. Der Satz auf der Fläche sagte es
selbst: „Den Tagespreis übernehmen Sie im Lager: Zeile anklicken, unter
Details den Verkaufspreis eintragen." Das ist die halbe Lösung, über die
Basel zu Recht zornig ist.

- [ ] Der Korb trägt den KURSPREIS, wenn das Stück dem Kurs folgt
      (`fester_preis = false`) und ein Kurs vorliegt.
- [ ] Der Korb rechnet mit, wenn der Kurs sich dreht.
- [ ] Ein sichtbarer Countdown sagt, wann der nächste Kurs kommt.
- [ ] Beim Bezahlen friert der Preis ein (der Moment des Geschäfts).
- [ ] Waagen-/Kursausfall: der gespeicherte Preis gilt, sichtbar begründet.

## 2. Die Steuerausfuhr läuft ab Werk  (Recht, Reibung)

**Befund:** Der DATEV-Export verweigert die Datei, bis der Händler SECHS
Zahlen einträgt, die nur sein Steuerberater kennt. Basel: die kennt keiner,
und keiner fragt seinen Berater vorher.

Recherchiert (Quellen im Commit): Beraternummer 1001 und Mandantennummer
99999 sind die üblichen Platzhalter, der Berater biegt sie beim Import in der
Stapelverarbeitung um; Sachkontenlänge 4 ist der Regelfall kleiner Betriebe;
Wirtschaftsjahr beginnt am 1. Januar; SKR03 ist im Handel der verbreitetste
Rahmen; Kasse ist 1000 (SKR03) beziehungsweise 1600 (SKR04).

- [ ] Vorgaben säen, damit der Export ab Werk läuft.
- [ ] Ein kurzer, freundlicher Hinweis auf der Ausfuhrfläche.
- [ ] Jede Vorgabe bleibt änderbar (der Berater hat das letzte Wort).

## 3. Der Weg zurück  (Bedienung)

- [ ] Aus jeder Einstellungsfläche führt ein sichtbarer Weg zurück.

## 4. Die zweite Reihe wird geordnet  (Bedienung)

Vierzehn Flächen in vier Gruppen. Basel: logisch bündeln, nach Dienst und
Wichtigkeit, besonders das Konfliktpostfach.

- [ ] Zusammenlegen, was zusammengehört; benennen, was bleibt.

## 5. Der Ankauf  (Bedienung + Geschäft)

- [ ] Die Fläche neu ordnen: klar, ruhig, ohne Überlagerung.
- [ ] Waage: Weg prüfen und ehrlich zeigen.
- [ ] Ausweisleser: Weg prüfen und ehrlich zeigen.

## 6. Das Zeichen  (Marke)

Recherchiert: die stärksten Marken verschmelzen Zeichen und Wort über
Buchstaben-Interaktion und Negativraum. Der Faden der Nornen ist das eine
Element, das durch alles läuft.

- [ ] Ein Zeichen, das Wort UND Marke ist.
- [ ] Alle Programmsymbole neu.

## 7. Der Durchgang  (Sorgfalt)

- [ ] Mehrere Durchgänge aus verschiedenen Blickwinkeln.
- [ ] 0.7.2 bauen, prüfen, ausliefern.

---

## Stand am Abend des 20.08.2026

Alle sieben Punkte sind angefasst, sechs sind fertig. Was dabei GEMESSEN
wurde, steht jeweils in der Botschaft des Einbaus; hier nur die Lage.

| Punkt | Stand | Wo es steht |
|---|---|---|
| 1 Der Kurs verkauft sich selbst | fertig | `korbpreis.ts`, `useKurspreise`, `KursHinweis` |
| 2 Die Steuerausfuhr läuft ab Werk | fertig | Wanderung 0150, `datev-mandant.ts` |
| 3 Der Weg zurück | fertig | `rueckweg.ts`, `SubBreadcrumb` |
| 4 Die zweite Reihe wird geordnet | fertig | `gruppen.ts`, `Einstellungen.tsx`, `Schalter.tsx` |
| 5 Der Ankauf | fertig | `verkaeufer-stand.ts`, `lib/abfragestand.ts` |
| 6 Das Zeichen | fertig | `NornsZeichen.tsx` (zwei Schnitte), `generate.py` |
| 7 Der Durchgang | läuft | dieser Abschnitt |

### Was der Durchgang bisher gefunden hat

**Gefunden und behoben:**

* Eine schlafende Abfrage machte Flächen STUMM. Zehn Flächen trugen das
  Muster, keine kannte den Fall. Wurzel behoben (`networkMode: 'always'`,
  der Motor wohnt im Gerät) plus eine vollständige Fallunterscheidung.
* Ein Geist galt als Verkäufer: der Ankauf fragte den Korb statt die Bücher.
* „Der Inhaber selbst meldet sich dafür mit Google an" — ein Satz unter der
  Zifferntastatur, für jeden Kassierer sichtbar, auf einer Kasse ohne Netz.
* Zwei Zeilen der Einstellungs-Spalte hiessen „Steuer-Export".
* Das Zeichen las sich weiter als durchgestrichenes N — jetzt gemessen und
  neu geschnitten.

**Gefunden, geprüft, in Ordnung** (damit es niemand zweimal prüft):

* Der Weg zur Goldwaage ist echt (MT-SICS über die serielle Schnittstelle,
  in Rust, mit eigenen Proben), und die Fläche sagt sauber Bescheid, wenn
  keine Waage eingerichtet ist.
* Die Ausweiserfassung verschlüsselt AES-256-GCM im örtlichen Tresor unter
  dem Schlüssel des Betriebssystems.
* Der Ankaufspreis rechnet sich schon aus dem Tageskurs und verweigert die
  Zahl bei einem zu alten Kurs, statt zu raten.
* Der Verkaufsaufschlag steht mit Absicht auf null: eine erfundene Marge
  wäre schlimmer als keine.
* Ein negativer Rabatt kann die Begründungspflicht nicht umgehen — die
  Datenbank verlangt `line_discount_eur >= 0`.
* Der Weg Schlüsselbund → Motor für die fiskaly-Zugangsdaten steht und ist
  bewacht.

**Gemessen, was der Kunde am ersten Tag wirklich braucht.** Auf einer
frischen Kasse nachgestellt: von zwölf Punkten halten nur ZWEI den Verkauf
auf — die technische Sicherheitseinrichtung und der Umsatzsteuer-Status.
Nach dem Umsatzsteuer-Status blieb genau die Sicherheitseinrichtung übrig.
Der Kunde trägt also seinen TSE-Code ein, beantwortet EINE Frage, und die
Kasse verkauft. Alles Weitere hält nur die Steuerausfuhr auf.

### Was offen bleibt

* **Der vergessene Inhabercode.** Niemand kann ihn zurücksetzen; der Weg
  zurück führt über die Datenbank. Die Kasse SAGT es jetzt bei der
  Einrichtung. Ein Notfallschlüssel wäre die ganze Antwort und liegt Basel
  vor — er ist ein zweites Geheimnis und damit eine Entscheidung des
  Hauses.
* **Die SKU beim Ankauf** ist ein Pflichtfeld, und nichts schlägt eine vor.
  Wer am Tresen einen Ring kauft, erfindet eine Nummer. Kein Fehler, aber
  tägliche Reibung.
* **Die neun übrigen Flächen** mit der Dreier-Verzweigung sind durch die
  Wurzelbehebung geschlossen (keine hat eine bedingte Abfrage, gemessen);
  ein Wächter hält es so.
