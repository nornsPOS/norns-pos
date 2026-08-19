# Zwei grosse Bauten: der Go-Kern und der Lizenzschlüssel

Stand 12.08.2026. Basel hat beides beauftragt und im selben Satz gesagt:
„بس حالياً ركز على الاساسيات الكاشير" — zuerst die Kasse. Dieses Papier ist
deshalb kein Bau, sondern die Entscheidungsvorlage davor. Es sagt ehrlich,
was die zwei Wünsche wirklich kosten, was sie WIRKLICH bringen, und wo ich
widerspreche.

Keine Zeile davon ist gebaut. Nichts hier ist gemessen, sofern nicht
ausdrücklich „gemessen" danebensteht.

---

## Teil A — Der Go-Kern („bis zum Kernel des Wirtsystems")

### Was heute wirklich läuft, gemessen

Die Kasse spricht schon HEUTE nativ mit der Hardware, und zwar in Rust im
Tauri-Programm, nicht im Browserfenster:

| Weg | Datei | Was er tut |
|---|---|---|
| Bondrucker | `commands/thermal.rs` | ESC/POS über TCP UND über den Systemspooler |
| Etiketten | `commands/label.rs` | ZPL, plus Windows-Spooler über `win_print` |
| Warteschlange | `commands/warteschlangenlage.rs` | fragt CUPS bzw. den Win32-Spooler VOR dem Senden |
| Windows roh | `commands/win_print.rs` | `EnumPrintersW`, RAW-Datentyp, echte Win32-Aufrufe |
| Waage | `commands/scale.rs` | serielle Schnittstelle |
| Kartenleser | `commands/zvt.rs` | ZVT über TCP |
| TSE | `commands/tse.rs` | die Sicherungseinrichtung |

Rust im Tauri-Prozess hat dieselben Rechte wie ein Go-Programm desselben
Nutzers: volle Datei-, Geräte- und Netzrechte, direkte Win32-Aufrufe, USB.
Ein zweiter Dienst in Go bekäme **keine einzige Berechtigung dazu**, die
Rust hier nicht schon hat.

### Wo der Wunsch trotzdem etwas Wahres trifft

Drei Dinge kann der heutige Aufbau NICHT, und sie sind echt:

1. **Nichts läuft, wenn die Kasse zu ist.** Ein Kernel-naher *Dienst*
   (Windows-Dienst, launchd, systemd) läuft ohne angemeldeten Menschen. Das
   bräuchte man für: nächtliche Sicherung, Geräte-Wachhund, ein Update, das
   sich selbst repariert.
2. **Kein Treiber-Rang.** Echte Kernel-Nähe (ein Filtertreiber, ein
   USB-Klassentreiber) ist eine andere Welt: signierte Treiber, WHQL,
   Absturz des ganzen Rechners bei einem Fehler. Für einen POS ist das
   sachlich falsch, und ich rate ausdrücklich ab.
3. **Rechteerhöhung.** Drucker systemweit einrichten, Dienste anlegen —
   das braucht Administrator, und das ist eine Frage der INSTALLATION, nicht
   der Programmiersprache.

### Mein Widerspruch, offen

**Go bringt hier keinen Rang, den Rust nicht hat — es bringt einen zweiten
Motor.** Die Kasse trägt heute schon zwei (Rust + den Node-Sidecar mit
Postgres). Ein dritter kostet: ein drittes Bündel im Installationspaket, ein
dritter Weg für die Luft-Aktualisierung, eine dritte Signatur, eine dritte
Absturzstelle — und eine neue Sprachgrenze mitten durch die Hardware-Wege,
die heute an EINER Stelle mit Wächtern gesichert sind (`kein_weg_ohne_pruefung`).

Was Basel beschreibt („tiefer, sicherer, mächtiger"), erreicht man billiger:

### Der Vorschlag: drei Stufen, jede einzeln entscheidbar

**Stufe 1 — Der Wachdienst (klein, hoher Nutzen).**
Ein Systemdienst, der auch ohne angemeldeten Menschen läuft und genau drei
Dinge tut: Sicherung anstossen, prüfen dass der Motor lebt, und ihn neu
starten wenn nicht. Sprache egal; in Rust bleibt es EIN Werkzeugkasten.
Aufwand: überschaubar. Nutzen: der Laden startet morgens auch dann, wenn
gestern etwas hängen blieb.

**Stufe 2 — Die Geräte-Werkstatt (mittel).**
Drucker-, Waagen- und Leser-Einrichtung mit erhöhten Rechten, aus der Kasse
heraus angestossen, mit einer sauberen Rechtefrage. Löst das, was Basel als
„التعرف على الطابعات" beschreibt, an der Wurzel.

**Stufe 3 — Der eigene Treiber (ich rate ab).**
Nur wenn ein Gerät wirklich keinen anderen Weg hat. Bei Bon, Etikett, Waage
und ZVT ist das nicht der Fall — alle vier sprechen offene Protokolle, die
wir schon fahren.

**Wenn Basel Go trotzdem ausdrücklich will**, ist die verantwortbare Form:
Go NUR für Stufe 1, als eigenständiger Dienst mit einer sehr schmalen
Schnittstelle, und die Hardware-Wege bleiben, wo sie sind. Alles andere
zerschneidet eine Fläche, die heute funktioniert und bewacht ist.

---

## Teil B — Der Lizenzschlüssel („im Quelltext verwoben, nicht manipulierbar")

### Die eine Wahrheit, die vorne stehen muss

**Ein Schlüssel, der auf dem Rechner des Kunden geprüft wird, ist immer
knackbar.** Das Programm liegt dort, der Prüfer liegt dort, und wer beides
hat, kann den Prüfer entfernen. „Ins Programm verwoben" macht es teurer,
nicht unmöglich. Jeder, der etwas anderes verspricht, verkauft ein Gefühl.

Das ist kein Grund, es zu lassen — es ist der Grund, das RICHTIGE Ziel zu
wählen:

> Nicht „unknackbar", sondern: **der ehrliche Kunde kann nicht versehentlich
> ohne Lizenz laufen, und der unehrliche muss das Programm nachweislich
> verändern.** Letzteres ist vor Gericht viel wert.

### Was wirklich trägt

**1. Unterschrift statt Prüfsumme.**
Der Schlüssel ist ein signiertes Papier (Ed25519), das der öffentliche
Schlüssel im Programm prüft. Inhalt: Kunde, Ausgabedatum, Laufzeit, Umfang.
Nur wir können einen ausstellen — nachbauen kann ihn niemand, auch wer den
Quelltext hat. Das Verfahren steht schon im Haus: die
Luft-Aktualisierung prüft ihre Pakete genauso (minisign).

**2. An das Gerät gebunden.**
Der Schlüssel gilt für einen Fingerabdruck des Rechners. Ein kopierter
Schlüssel läuft auf dem zweiten Gerät nicht. ⚠️ Mit einem ehrlichen
Notausgang: Festplattentausch und Neuinstallation sind der Normalfall eines
Ladens, nicht Betrug. Ohne Umzugsweg bestraft man den zahlenden Kunden.

**3. Nicht EINE Stelle, sondern der Nerv.**
Basels Wunsch („منسوج بعصب التطبيق") ist genau richtig: ein einzelnes
`if (lizenzGültig)` ist eine Zeile, die man löscht. Stattdessen leitet sich
etwas, das die Kasse WIRKLICH braucht, aus dem Schlüssel ab — es gibt
sonst nichts zu entfernen, nur etwas, das dann fehlt.

**4. Und der Riegel, den dieses Haus zusätzlich verlangt:**
Ein Lizenzriegel darf **NIEMALS** einen fiskalischen Weg blockieren. Eine
abgelaufene Lizenz darf nicht verhindern, dass ein Beleg signiert, ein Tag
abgeschlossen oder eine DSFinV-K-Ausfuhr gezogen wird. Sonst baut man einen
Schalter, der einen Händler in die Ordnungswidrigkeit zwingt (§ 146a AO) —
und das wäre der teuerste Fehler des ganzen Systems. Der Riegel gehört an
den VERKAUF und an die Nebenflächen, nie an Signatur, Abschluss und Ausfuhr.

### Was ich NICHT bauen würde

- **Verschleierung des Programmtextes.** Kostet Lesbarkeit und Fehlersuche,
  hält einen ernsthaften Angreifer Stunden auf.
- **Stille Selbstzerstörung bei Verdacht.** Ein Fehlalarm löscht dann einem
  ehrlichen Händler den Laden. Nie.
- **Zwangs-Anruf nach Hause.** Die Kasse ist mit Absicht offline-fähig. Der
  Schlüssel muss ohne Netz gelten; eine Online-Erneuerung darf ein Zusatz
  sein, keine Bedingung.

---

## Reihenfolge, die ich vorschlage

1. **Jetzt fertig:** die Kasse (Basels eigene Reihenfolge). Läuft.
2. **Danach klein:** Lizenz Teil B, Stufen 1 bis 3 — Unterschrift,
   Gerätebindung, Verwebung. Kein fiskalischer Weg wird angefasst.
3. **Dann:** Go/Dienst Stufe 1 (Wachdienst), wenn Basel ihn will.
4. **Nur auf ausdrückliche Ansage:** Stufe 2. Stufe 3 rate ich ab.

Jede Stufe ist einzeln entscheidbar und einzeln lieferbar. Keine braucht
die andere.

---

## Was Basel entscheiden muss

| Frage | Meine Empfehlung |
|---|---|
| Go als dritter Motor? | Nein für Hardware; ja allenfalls für den Wachdienst |
| Eigener Treiber? | Nein — kein Gerät braucht ihn |
| Lizenz an das Gerät binden? | Ja, mit Umzugsweg für Plattentausch |
| Lizenz sperrt was? | Verkauf und Nebenflächen — NIE Signatur, Abschluss, Ausfuhr |
| Laufzeit? | Ist eine Geschäftsentscheidung, keine technische |
