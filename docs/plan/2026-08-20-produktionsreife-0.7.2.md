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
