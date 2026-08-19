# Änderungen

## [0.7.1] - 2026-08-19

### Die Kasse startet wieder (P0)
- Eine Kasse, die von einer älteren Norns-Fassung kam, startete nicht mehr
  und meldete: „Der Schlüssel für die Kundendaten fehlt im Systemtresor …
  Spielen Sie die Sicherung des Schlüssels zurück."
- Der Schlüssel fehlte NICHT. Er lag die ganze Zeit im Systemtresor, unter
  dem Namen, den er beim Ablegen bekommen hatte. Eine Umbenennung im
  Programm hatte den Namen mitgenommen, unter dem gesucht wird — und damit
  die Adresse verändert, nicht die Sache.
- Der Tresor liest jetzt unter beiden Namen. Wird ein Geheimnis unter dem
  alten gefunden, wandert es unter den heutigen mit; der alte Eintrag bleibt
  unangetastet stehen, damit es einen zweiten Weg zurück gibt. Es war zu
  keinem Zeitpunkt ein Datenverlust, und es musste nichts zurückgespielt
  werden.
- Zwei Wächter halten das jetzt von beiden Seiten fest: einer verlangt, dass
  jeder je vergebene Name im Quelltext erreichbar bleibt, der andere, dass
  der Rückfall auch wirklich am lesenden Weg hängt und nicht nur im
  Kommentar steht.

## [0.7.0] - 2026-08-19

### Das Logo bleibt, und es reist bis auf die grosse Rechnung
- Ein hochgeladenes Logo erscheint jetzt auch auf der grossen A4-Rechnung.
  Bisher kannte deren Datenweg die Logo-Felder gar nicht; der Bon hatte
  ein Logo, die Rechnung nie.
- Solange ein Logo hochgeladen, aber noch nicht gespeichert ist, sagt die
  Fläche das jetzt deutlich über der Vorschau: wer die Fläche vorher
  verlässt, verwirft den Entwurf. Ein gespeichertes Logo bleibt, auf
  jedem Gerät desselben Betriebs.

### Bon oder A4, ohne Fehlgriff
- Beim Abschluss ist die grosse Rechnung ein eigener, kleiner Knopf neben
  dem grossen Bon-Knopf: der normale Bon bleibt der grosse Griff, die
  A4-Rechnung drückt niemand aus Versehen.
- Ist ein Dokumentendrucker eingerichtet, druckt die A4-Rechnung direkt,
  ohne Vorschaufenster. Ohne eingerichteten Drucker öffnet sich die
  Vorschau, mit einem Satz, der das erklärt.

### Etiketten drucken direkt
- Unter Windows druckt ein Etikett jetzt direkt auf dem eingerichteten
  Drucker (eigener Rasterweg), statt eine Ansichtsseite zu öffnen.
  Schlägt der Direktdruck fehl, öffnet sich die Ansicht mit dem Grund.

### Kurse: echt statt Puls
- Der Kursverlauf am Tresen zeigt jetzt die echte Kurve aus der
  Aufzeichnung. Bisher war der Verlauf serverseitig nur für den Inhaber
  freigegeben, und der Kassierer sah einen Platzhalter.
- Das Mittel heisst jetzt ehrlich „Mittel (bis 10 Tage)": es rechnet ab
  dem ersten aufgezeichneten Kurs und wartet nicht zehn Tage.
- Ein Goldpreis wird nicht mehr von Hand eingetragen. Der Kurs kommt
  ausschliesslich von der eingestellten Quelle; der alte Handeingabe-Weg
  ist abgeschafft.
- Die Quellen tragen neutrale Namen (Deutscher Goldpreis, Freier
  Kursdienst) statt fremder Anbieternamen.

### Der Kassencode hat genau sechs Ziffern
- Sechs Felder, und die Tastatur schickt beim sechsten Zeichen von selbst
  ab: kein Verzählen, keine Spanne mehr.
- Auf der Anmeldefläche steht jetzt der Weg heraus: Code vergessen? Der
  Inhaber löscht ihn unter Team, danach wählt der Mensch am Tresen selbst
  einen neuen. Der Inhaber selbst kommt jederzeit über die
  Google-Anmeldung hinein.

### Steuern: ein Knopf für die Kassennachschau
- Ein neuer Knopf auf Steuer-Export packt den ganzen gewählten Zeitraum
  in EINE Datei für den Prüfer: alle DSFinV-K-Tagespakete, die
  Verfahrensdokumentation, ein Prüfbericht mit soeben geprüfter
  Prüfsummenkette und Cent-genauen Tagessummen, und ein Verzeichnis, das
  ehrlich sagt, was fehlt und warum.
- Daneben: ein fertiges deutsches Übergabeschreiben für die Kanzlei, mit
  einem Griff in der Zwischenablage.
- Neu: per Bank oder Karte bezahlte Ausgaben (Lieferantenrechnungen)
  lassen sich als eigener DATEV-Buchungsstapel exportieren. Bar bezahlte
  standen schon im Stapel ihres Kassentages; unbare erschienen bisher in
  keinem Export.

### Weniger Fragen bei der Einrichtung
- Die Erstinbetriebnahme schlägt belegte Werte sichtbar vor
  (Länderkennzeichen, die amtlich geprüften Steuerberater-Angaben, das
  Inbetriebnahmedatum). Nichts wird still gespeichert: jeder Wert steht
  im Feld, wird geprüft und mit Weiter selbst gespeichert. Der
  Steuerstatus und sein Gültigkeitsdatum werden mit Absicht weiterhin
  gefragt, nie geraten.

### Die grosse Rechnung ist jetzt amtlich
- Die A4-Rechnung trägt alle Pflichtangaben nach § 14 UStG: Anschrift und
  Steuernummer/USt-IdNr. des Betriebs, Telefon, und den Leistungsdatum-Satz.
  Bisher fehlten sie, obwohl der Bon sie längst kannte.
- Briefbogen nach DIN 5008: Falzmarken und Lochmarke am Rand, die Rechnung
  fällt beim ersten Griff fensterkuvertgerecht. Mit Empfänger steht der
  Betrieb rechts und der Empfänger exakt im Kuvertfenster; ohne Empfänger
  bleibt der kompakte Kopf (Kleinbetragsrechnung bis 250 Euro).
- Bei Regelware erscheint die MwSt.-Zeile jetzt wirklich; die
  vorgeschriebenen Sonderregelungs-Sätze (§ 25a) stehen als Pflichtangabe
  im Blatt.

### Jedes Stück trägt seine Nummer
- Seriennummer und Gravur (Uhren, gravierte Stücke) werden bei Bewertung
  oder Ankauf erfasst und wandern einen Weg: Lager (dort korrigierbar),
  Ankaufbeleg-Zeile, und die Seriennummer bis in den Artikeltext des
  Prüferpakets. Geldwäscherecht verlangt genau diese Zuordnung.

### Stückzahl beim Anlegen
- Beim Anlegen eines Produkts sagt ein Feld, wie viele identische Stücke
  entstehen (bis 200): jedes bekommt seine eigene Zeile mit Laufnummer,
  eigenem Etikett und eigenem Strichcode, einzeln verkäuflich und
  stornierbar. Vor dem Speichern steht, was entsteht.

### Sichtbarkeit in beiden Themen
- Siebzehn gemessene Kontrastbrüche behoben: Texte und Zeichen, die im
  dunklen oder hellen Thema mit ihrem Grund verschmolzen (Kurs-Reiter,
  Lager-Stufenchips, Fotos-Fläche, Leitstand-Siegel, Kurschart-Preisschild,
  Schaltknauf, Logo-Faden bei Nacht).

### Einstellungen, entrümpelt
- Ein toter Schalter (Online-Wege) blockierte das Speichern des ganzen
  Betriebs-Bereichs; er ist entfernt.
- Die gewählte Schriftgröße gilt jetzt ab dem Start, nicht erst nach dem
  Öffnen der Einstellungen.
- Die Fußzeile ist nur noch an einer Stelle editierbar (Belegdesigner mit
  Live-Vorschau).
- Neue Karte Module dieses Betriebs: Kursleiste und Waage lassen sich
  wieder ein- und ausschalten, auch nachdem sie ausgeblendet wurden.
- Neue Fläche Hilfe & Norns: Anleitung, Support und Preise, dazu die
  laufende Fassung der Kasse.
- Die Zielkarte sagt ehrlich Richtwert statt Ziel, solange niemand ein
  Ziel gesetzt hat.

### Die grosse Rechnung ist eine Fabrik geworden
- Das Blatt entsteht jetzt aus Ihren eigenen Angaben: Kopfband mit Logo und
  Betriebsblock, Anschriftzone im Kuvertfenster, Datenraster, Positionen mit
  wiederholtem Kopf über mehrere Seiten, Summenkasten und ein Fussband mit
  Kontakt, Steuernummer und Seitenzahl auf JEDER Seite.
- Geprüft mit 22 Positionen und Anführungszeichen, Semikola und
  Rückstrichen in Produkt- und Firmennamen: das Blatt bricht nicht.

### Was eine feindselige Prüfung gefunden hat
Einunddreissig Angreifer haben Geldrechnung, DATEV, DSFinV-K, Zustände und
Datenbank mit konstruierten Eingaben beschossen; jeder Fund musste danach
einen Skeptiker überleben. Neunzehn wurden bestätigt und sind behoben, die
schwersten:
- Der Storno eines Ankaufs verdoppelte den Barabfluss, statt ihn
  auszugleichen — und zwei Dateien desselben Prüferpakets widersprachen
  sich dabei. Beide rechnen jetzt mit derselben Regel.
- Ein getipptes Minus wurde still zum positiven Betrag: aus „-50" im
  Rabattfeld wurde ein Rabatt von fünfzig Euro. Die Eingabe wird jetzt
  abgewiesen.
- Ein Gutschein liess sich zweimal einlösen, wenn zwei Kassen ihn im selben
  Augenblick nahmen.
- Eine angenommene Bewertung über 0,00 € erzeugte einen Ankaufbeleg ohne
  Gegenwert; beim Wiederverkauf wäre der ganze Preis zu versteuern gewesen.
- Betriebsausgaben eines festgeschriebenen Tages liessen sich nachträglich
  ändern — Kassenbericht und DATEV-Stapel dieses Tages änderten sich damit
  rückwirkend. Jetzt hält das die Datenbank selbst an.
- Vier gleichzeitige Fehlversuche am Kassencode zählten als einer; der
  Schutz gegen das Durchprobieren versagte genau unter Last.
- Ein Zeilenumbruch oder ein Semikolon in einer Notiz zerbrach den
  DATEV-Import beim Steuerberater oder sperrte den ganzen Tagesexport. Ein
  türkisches oder polnisches Sonderzeichen kippte ihn in einen
  unverständlichen Fehler statt zu sagen, WO es steht.
- Eine getippte Ziffernfolge im Kundenfeld las die grösste Tabelle des
  Hauses von vorn bis hinten, während die Kassiererin tippte.

### Farbe, die etwas bedeutet
- Die Zeichen der Flächen tragen jetzt eine Farbe nach Tätigkeit: Aufsicht,
  Geld und Steuer, Ware, Kundschaft, Haus. Kein Anstrich über alles, ein
  Tupfer je Fläche — und jede Farbe kippt mit dem hellen und dunklen Thema.

### Die Einrichtung fragt zuerst, was den Verkauf aufhält
- Genau zwei Angaben halten die Kasse an: der Umsatzsteuer-Status und die
  technische Sicherheitseinrichtung. Die stand bisher an achter Stelle,
  hinter Kontaktdaten und Steuerberater-Nummern. Jetzt kommen beide zuerst,
  und der Satz „Das reicht für heute" stimmt danach wirklich.
- Der Fortschrittsring zeigt die Verkaufsbereitschaft statt der Zahl
  ausgefüllter Felder: wer verkaufen darf, sieht das auch.
- Der Verkaufsaufschlag steht jetzt auf der Startliste. Seine Vorgabe ist
  bewusst null (eine erfundene Zahl wäre schlimmer), aber niemand hat je
  danach gefragt — wer Preise aus dem Tageskurs rechnet, verkaufte damit
  zum reinen Materialwert.

### Kleineres
- Zwei gleichlautende Meldungen zur Steuerklasse blieben übereinander
  stehen; sie lösen sich jetzt selbst auf.
- Jede Fehlermeldung trägt ihre Kennung am Satzende, zum Vorlesen am
  Telefon.
- Die Papiervorschau des Belegdesigners öffnet auf der eingestellten
  Rollenbreite (58 mm Standard) statt fest auf 80 mm.

## [0.6.0] - 2026-08-15

Die Kasse wurde von vorn bis hinten BEGANGEN, mit echtem Geld auf einer
frischen Bühne: Ankauf 120 bar, Verkauf desselben Stücks für 240 nach
§ 25a, Kassensturz mit Differenz 0,00, unwiderruflicher Tagesabschluss,
und dann jeder Export Byte für Byte gelesen. Was die Begehung fand,
ist behoben.

### Die Nachbestätigung funktioniert wieder (P0)
- Der Bestätigungsdialog für Storno, Kassensturz und Export verlangte
  den am 05.08. abgeschafften lokalen Gerätecode: auf jeder frisch
  eingerichteten Kasse waren diese Schritte unmöglich. Der Dialog prüft
  jetzt den Kassencode auf dem Server, mit eigenem Fehlversuchszähler,
  Sperre und Eintrag im Tagebuch. Die tote lokale Codewelt ist gelöscht.

### Ankauf
- Die Punze auf dem Stück ist jetzt eine gültige Karat-Angabe: 585 wird
  als 14K gebucht, K585 ebenso. Unbekannte Werte weist der Motor mit
  einer deutschen Liste der gültigen Punzen und Stufen ab; zuvor endete
  die Buchung in einer irreführenden Konfliktmeldung.
- Das Stückformular spricht Deutsch statt roher Statustoken.

### Tageskasse
- Der erwartete Kassenbestand rechnet jetzt dieselben Bein-Familien wie
  der Kassensturz: Barverkäufe hinein, Ankauf-Auszahlungen hinaus,
  Einlagen hinein, Abschöpfung und Tresortransit hinaus, Stornos mit
  eigenem Vorzeichen. Zuvor fehlten Ankauf und Bewegungen, und der
  Kassierer suchte Geld, das nie in der Lade war, oder längst im Tresor
  lag. Ein Wächter pinnt jede Bein-Familie einzeln fest.
- Der Schichtumsatz zählt Stornierungen mit: nach Verkauf und vollem
  Storno steht dort 0,00 statt des alten Verkaufsbetrags.

### Beleg nach § 25a
- Die Zwischensumme ist das Netto und stand bedingungslos über dem Satz,
  die Umsatzsteuer sei nicht gesondert ausweisbar; wer Summe minus
  Zwischensumme rechnete, hatte die Margensteuer, deren Ausweis § 14a
  Abs. 6 Satz 2 UStG verbietet. Sie hängt jetzt am selben Schalter wie
  die Steuerzeile, in Vorschau, Thermodruck und PDF-Rechnung.

### Amtliche Worte
- Der TSE-Ausfallvermerk verspricht keine „Nachholung" mehr, die kein
  Code einlöst; er nennt nur Gemessenes. Der Kleinunternehmer-Wortlaut
  folgt der Fassung 2025 (steuerfrei, § 34a UStDV) an allen Stellen.

### Kundenakte
- Die dauerleere „Online-Bestellungen"-Kachel über der toten
  Webshop-Welt ist entfernt, samt Route und Klientenpfad.
- Ankauf-Historie und Transaktionen zeigen jetzt die echte Gesamtzahl;
  zuvor stand „0 Stücke" über echten Zeilen, weil der Motor das
  Zählfeld nie sandte.

### Handwerk
- Die Sicherung nach dem Schichtschluss meldet ohne Kassenkern ehrlich
  deutsch statt eines rohen englischen Fehlertexts.
- Die Auslieferung neuer Versionen legt Bauwerke wieder im Lieferlager
  ab; der Übergabeschritt las eine in Actions reservierte Variable.

## [0.5.0] - 2026-08-14

Die Einrichtung wird ein Arbeitsplan, und die Kasse kennt ihren Rechner.

### Die Startliste ist jetzt eine Aufgabenkarte
- Aus der Mängelliste „Diese Kasse kann noch nicht verkaufen" wurde eine
  Karte mit Zähler („1 von 11 erledigt"), Fortschrittsleiste und einem
  aufklappbaren Bereich für das bereits Erledigte. Jede offene Aufgabe
  ist eine Zeile mit Ernst-Ring, Sperrwort, Begründung und dem Ziel, zu
  dem der Klick wirklich führt.
- Der Motor bewertet dafür ALLE Schritte, nicht nur die offenen, und
  meldet je Schritt ehrlich „erledigt" oder nicht, aus denselben
  Quellen, an denen auch die fiskalischen Riegel hängen. Die erledigten
  Texte behaupten nur, was geprüft ist; die Meldung ans Finanzamt etwa
  nennt die Eintragung, nicht eine nie geprüfte Übermittlung.
- Lässt sich der Stand der Einrichtung nicht lesen, sagt die Karte das
  jetzt in einem Satz, statt wortlos zu verschwinden. Unbekannt ist
  nicht erledigt.

### Die Erstinbetriebnahme fühlt sich geführt an
- Jede Etappe gleitet mit einer kurzen, ruhigen Blende herein; wer
  Bewegung reduziert hat, bekommt sie gar nicht.
- Eingabetaste heisst weiter: jede Etappe ist ein echtes Formular, Enter
  springt zur nächsten Station, sobald die Pflichtfelder stehen.

### Die Kasse kennt ihren Wirt
- Neuer Abschnitt „Dieses Gerät" im Gerätemanager: Rechnername,
  Betriebssystem samt Kern, Prozessor, Kerne und Architektur, dazu zwei
  gemessene Leitern für Arbeitsspeicher und den Datenträger, auf dem die
  Kassendaten WIRKLICH liegen (liegen sie auf einem zweiten Laufwerk,
  wird dieses gemessen, nicht stur die Systemplatte). Ruhig bis 85
  Prozent, gold darüber, rot ab 95.
- Die Messung läuft in Rust über eine Quelle für macOS und Windows und
  wird von einer Probe auf echter Hardware gefahren, nicht nur übersetzt.
  Die Laufwerkszuordnung achtet auf Komponentengrenzen: ein
  Einhängepunkt „Ext" beansprucht keinen Ordner „External".

### Der Aktualisierungsweg hat jetzt ein öffentliches Lieferlager
- Der Quelltext liegt privat; Installationspakete und das signierte
  Update-Verzeichnis liegen im öffentlichen Lager `norns-releases`.
  Die Kasse fragt beim Prüfen auf Updates ohne Anmeldung an. Gegen den
  privaten Quelltext lief das ins Leere (gemessen: fünfmal 404), gegen
  das Lieferlager trägt es. Ein Wächter nagelt die Anschrift fest.
- Neuer Signaturschlüssel für Updates; Fassungen vor 0.4.0 nehmen den
  Weg über eine einmalige Neuinstallation.

### Unter der Haube
- Zwei eBay-Kacheln in der Werkstatt-Übersicht entfernt, samt ihrer
  Spalten im Motor: seit dem eBay-Ausbau konnte dort nie wieder etwas
  stehen als Null. Alte eBay-Zeilen im Tagebuch bleiben lesbar.
- Der Entwicklungs-Bootstrap führt jetzt ein Verzeichnis der
  eingespielten Wanderungen und zieht Nachzügler nach; bisher blieb eine
  einmal gebaute Entwicklungsdatenbank für immer auf altem Stand, und
  `/api/einrichtung` fiel live mit einer fehlenden Spalte um, während
  alle Tore grün waren. Die gesäte Entwicklungs-PIN ist sechsstellig,
  wie es der Server seit dem 30.07 verlangt; die alte vierstellige
  konnte durch die Anmeldefläche nie eingegeben werden.

## [0.4.0] - 2026-08-14

Die grosse Trennung. Norns POS ist ab dieser Fassung NUR die Kasse.

### Die Trennung von warehouse14
- Rund 180.000 Zeilen fremder Systeme entfernt: die Inhaber-App, der
  Server-Arbeiter, der Kundenshop samt Online-Schalter, der DHL-Versand,
  der eBay-Kanal, WhatsApp, Chatwoot, Rundschreiben, Support-Postfach,
  Push, Foto-Eingang, die Cloud-Infrastruktur und 24 fremde Dokumente.
- Nachreinigung am selben Tag, gefunden durch das Fiskaltor des neuen
  Kontos: 31 tote Umgebungsschlüssel (eBay, WhatsApp, Meta, Chatwoot,
  DHL, DeepSeek, Storefront-Anmeldung), das Integrations-Cockpit in
  Motor und Kasse, fünf Fernwerkzeuge toter Kanäle samt ehrlichem
  Assistenten-Prompt, die eBay-Bibliothek, zwei tote Schemadateien und
  die Netzverkaufs-Felder aus Lagerliste und Artikeldetail. Fotos eines
  verworfenen Entwurfs werden jetzt mit ihm gelöscht statt in einen
  Eingang zu wandern, den keine Fläche mehr zeigt.
- Wiederhergestellt: der Stripe-Webhook des Kartenlesers. Die Trennung
  hatte ihn mit dem Kundenshop-Webhook entsorgt, dabei ist er der eine
  Schreiber des Leser-Zahlungsstands samt Doppelbelastungs-Riegel.
  Gefunden von der vollen Integrationsmappe (44 Dateien, 348 Sätze,
  alle grün gegen ein echtes Postgres), nicht von einem Menschen.
- Alle Pakete heissen jetzt `@norns/`. Historische Daten (alte
  Webshop-Umsätze) bleiben unangetastet und laufen weiter durch DSFinV-K
  und DATEV.
- Die eBay-Abfrage, die bisher in JEDEM fiskalen Beleg-Commit lief, ist
  raus; ihr Fall deckte drei fiskale Ordnungswächter auf, die an der
  falschen Stelle massen, und sie messen jetzt richtig.

### Die Kasse wird branchenfähig
- Neuer Einrichtungsschritt „Was dieser Betrieb braucht": Metallkurs-Leiste
  und Waage sind je Betrieb abschaltbar. Nichts wird amputiert; ein
  Juwelier lässt beides an, ein Betrieb ohne Edelmetall sieht beides nicht.

### Die Sicherheitseinrichtung wird IM Assistenten eingetragen
- Der TSE-Schritt trägt jetzt zwei Felder und den Knopf „Prüfen und
  eintragen". Die Kennungen werden VOR dem Speichern beim Anbieter
  geprüft; ist er nicht erreichbar, wird nichts gespeichert, und genau das
  steht dann da.

### Ausserdem
- Erstinbetriebnahme mit Werkbank, Zeichnungen, Prüfstein und ehrlichen
  Folgen-Sätzen an jedem Feld (aus den Vortagen dieser Fassung).
- goldpreis.de ist die vorgegebene Kursquelle; zehn Belege dürfen vor der
  TSE gedruckt werden, dann ist Schluss; der Verkaufsaufschlag ist wieder
  erreichbar.
- 51 gefilterte pnpm-Aufrufe tragen `--fail-if-no-match`; zwei Bauschritte,
  die nie etwas gebaut hatten, sind raus; ein Wächter prüft beides lebend.


## [0.3.0] - 2026-08-13

Vierzig Einchecken seit 0.2.0. Die Fassung schliesst drei Fehlerklassen, die
alle dieselbe Wurzel haben: **eine Aussage stand an vielen Stellen unabhängig
getippt.** Jede Reparaturrunde hatte die Lüge nur verschoben.

### Was ein Prüfer sieht

- **`TSE_SERIAL` und `TSE_PUBLIC_KEY` waren in JEDEM gezogenen Prüferpaket
  leer.** Die Kasse hat beide Werte, sie kamen nur nie an: der Klient kannte
  die Felder nicht, das Serverschema auch nicht (und Fastify entfernt still,
  was es nicht kennt), die Aufzeichnung hatte keine Spalte, und die Abfrage
  des Auszugs holte sie nicht. Ohne öffentlichen Schlüssel ist eine Signatur
  für einen Prüfer eine Zeichenkette ohne Beweiswert; ohne Seriennummer kann
  er sie keiner Sicherungseinrichtung zuordnen. Alle vier Stellen sind zu.
  Fehlende Angaben aus der Zeit davor werden NICHT abgeleitet — eine
  erfundene Seriennummer wäre eine unrichtige Angabe nach § 146a AO.
- **Der Kassenbericht behauptete über vorhandene Kassentage, es gebe sie
  nicht.** Der Export holte die Abschlussliste ohne Zeitraum, der Server gibt
  dann die 90 neuesten her, und für jeden älteren Tag fand die Suche nichts.
  § 147 Abs. 3 AO verlangt zehn Jahre. Der Wächter darüber liest jetzt jede
  Quelldatei der Kasse statt eines Dateinamens.

### Was der Kunde am Tresen liest

- **Der Beleg versprach eine Nachreichung, die es für ihn nicht gab.** Die
  Vorschau schloss aus einer LEEREN Signatur auf „wird nachgereicht". Leer ist
  sie aber auch bei dauerhaft vermerktem Ausfall (dann kommt nie eine) und bei
  einer Kasse ganz ohne hinterlegte Sicherungseinrichtung (dann ist nie eine
  entstanden). Der Beleg trägt seinen fiskalischen Zustand jetzt selbst.
- **Der Satz kommt aus einer Quelle.** „Die Signatur wird nachgereicht" stand
  an fünf Stellen unabhängig getippt. Jeder der sieben Zustände trägt jetzt
  Überschrift, Satz, Tonlage und einen nächsten Schritt, der in genau diesem
  Zustand wirklich begehbar ist.

### Am Tresen

- **Der Schirm schickte den Kassierer auf einen Knopf, den er nicht drücken
  kann.** Bei einer Kasse ohne hinterlegte Sicherungseinrichtung stand
  „Bitte TSE-Verbindung prüfen" — und genau die fehlende Kennung graut diesen
  Knopf aus.
- **„Verbindung gestört" stand an zwanzig Stellen, in zwei Fassungen mit
  verschiedenen Ratschlägen.** Immer im Zweig „es war kein geordneter
  Serverfehler" — und der heisst nicht „das Netz ist weg". Vier Lagen werden
  jetzt unterschieden: sicher eingereiht, Netz wirklich weg, Übertragung
  angehalten, Fehler in der Kasse selbst. Nur die zweite schickt noch jemanden
  ans Netzwerk.
- **Fünfzehn Flächen sagten „bitte erneut versuchen", während der Vorgang
  sicher im Ausgangskorb lag.** Bei einer anlegenden Fläche erzeugt genau
  dieser zweite Versuch ein Duplikat: ein zweiter Kunde, ein zweites Stück,
  eine zweite Ausgabenbuchung. Behoben, und der neue Wächter misst den
  Aufruf `…Api.create(` statt einer Namensliste — er fand dabei vier Flächen,
  die auf keinem Zettel standen.
- **Der Geschäftsverlauf sagte „Noch kein abgeschlossener Geschäftstag"** über
  den ganzen Betrieb, gemessen an einem Ausschnitt, den niemand gewählt hatte.
- **Der Kursticker behauptete „Verbindung gestört"**, bewiesen war nur, dass
  das Holen misslang — auch ein Serverfehler sieht so aus.

### Unter der Haube

- Die Aufsicht über den Motor, das Lizenzwerk, die Sicherung am Kassenschluss
  und die Erprobungsumgebung stehen (aus den Einchecken seit 0.2.0).
- Ein Kommando richtet einen Händler bei fiskaly vollständig ein, gegen die
  ECHTE Schnittstelle gemessen, bis zu einer echten Signatur.
- Wanderung 0141 reist in beiden Beipacks mit, sonst bekäme eine frische Kasse
  sie nie.

### ⚠️ Das Fliessband war seit dem 10.08.2026 rot, und dahinter lagen sechs Ursachen

Drei Tage ohne einen einzigen grünen Lauf. Nichts davon war ein Fehler im
Programm, und genau das ist der Punkt: **ein rotes Tor verdeckt das nächste.**
Nach jeder Reparatur kam der nächste Grund zum Vorschein, der vorher gar nicht
erreicht worden war.

1. **Ein Auftrag, der etwas verlangte, das nur ein anderes Fliessband erzeugt.**
   `tauri.conf.json` führt den Beipack als externalBin; angelegt hat ihn nur
   die Freigabe. Die Prüfaufträge konnten strukturell nie grün werden.
2. **Eine Prüfung, die die Schreibweise statt der Eigenschaft mass.**
   `minWidth` als `'0px'` gegen `'0'`, dieselbe Länge, zwei Zeichenketten.
3. **`libudev` fehlte auf Linux.** Die Kasse spricht über `serialport` mit
   Waage und Kartenleser.
4. **Prüfstand und Auslieferung fuhren verschiedene Laufzeiten.** Die Kasse
   liefert Node 22.14.0 mit, der Prüfstand fuhr 20.18.0, und sieben Prüfdateien
   laden `node:sqlite` (gibt es ab 22.5). Am 11.08. waren es drei Dateien, am
   13.08. sieben. Die Freigabe baute obendrein mit einer DRITTEN Fassung.
5. **Ein Zitat in einem Doc-Kommentar wurde ausgeführt.** rustdoc liest einen
   eingerückten Block als Rust-Code; er war der einzige und dauerhaft rote
   Doktest des Kistchens, sichtbar nur auf Windows.
6. **Ein Wächter, der auf dem Läufer NIE grün werden konnte.** Er misst die
   Klassennamen im ausgelieferten Bündel (richtig: wären sie verkleinert, wäre
   jede Fehlerkennung Unsinn), aber das Bündel wird erzeugt und nicht
   eingecheckt. Der Prüfauftrag baut es jetzt selbst, gemessene 172 ms.

Dazu ein Befund, den nur das LESEN des Laufs hergab: ein Hilfsprozess startete
auf Windows nie (`timeout` verweigert den Dienst bei umgeleiteter Eingabe), und
der Test, der die Aufsicht über den Motor absichert, war dort nur durch ein
Wettrennen grün.

Neue Wächter, jeder rot-grün gefahren: Prüfstand gegen ausgelieferte Laufzeit,
kein versehentlicher Doktest, Kopf der Freigabe gegen ihre Matrix. Und der
Typografie-Wächter liest jetzt alle drei Schreibweisen einer Zeichenkette,
nicht nur einfache Anführungszeichen; er fand damit einen Gedankenstrich in
einem Satz, den der Kassierer wirklich liest.

## [0.2.0] - 2026-08-09

Sieben Agenten haben die Kasse in sieben Bereichen neu ausgemessen, zwölf
weitere haben jeden vorgeschlagenen Fix adversarisch geprüft. Alle 22 Befunde
hielten; nur sechs Fixe überstanden die Mehrheit. Diese Fassung trägt sie,
plus die vier Punkte aus Basels Auftrag.

### Auf dem Papier, das der Kunde bekommt

- **Jedes Paragrafenzeichen wurde zu einem Fragezeichen.** Betroffen waren
  Pflichttexte: „Differenzbesteuerung nach ? 25a UStG". Ein Byte behebt es.
- **Die Steuernummer erreichte das Papier nie.** Die Kasse sendet sie seit
  jeher, serde verwarf sie still, und der Bon druckte bedingungslos
  „USt-IdNr.: " mit leerem Wert — eine behauptete Kennung ohne Wert.
  § 14 Abs. 4 Nr. 2 UStG lässt die Steuernummer ausdrücklich als Alternative
  zu. Jetzt: USt-IdNr. zuerst, sonst Steuernummer mit IHREM Wort, sonst
  KEINE Zeile.
- **Das Etikett sprach rohes UTF-8** an einen Drucker, der auf PC858 steht.
  Jedes Etikett war betroffen, auch ohne Umlaut: das Trennzeichen zwischen
  Gewicht und Karat ist fest im Code ein U+00B7.

### Was der Prüfer sieht

- **Die Verfahrensdokumentation beschrieb ein FREMDES Erzeugnis.** Elfmal
  „warehouse14", nullmal Norns, Stand 08.06.2026, dazu Docker und Cloudflare
  — eine Anlage, die es in dieser Kasse nicht gibt. Sie wird jetzt bei jedem
  Abruf aus der laufenden Anlage erzeugt: Fassung und Wanderungsstand
  gemessen, Tabellen und Prüfbedingungen aus `pg_catalog`, Stammdaten aus den
  Einstellungen. Als PDF mit dem Zeichen des Hauses. Eine fehlende Angabe
  wird NIE abgeleitet, sondern sichtbar als offen ausgewiesen.
- **„alles signiert" war eine Konstante, keine Messung.** Die Steuerfläche
  las `tseFailedCount`, und der Motor schreibt die Zahl als feste Null. Ein
  Tag mit zwölf unsignierten Belegen zeigte grün, während `tse_pending_count
  = 12` in derselben Datenbankzeile stand.

### Am Tresen

- **Das Kassenbuch zählte Kartenumsatz als Bargeld.** Nach einem Kartentag
  von 2.000 EUR verlangte es einen Ladenbestand, der nie in der Lade war.
  Jetzt nur die baren Zahlungsbeine.
- **Die Startliste beschrieb sieben Wege und öffnete null davon.** Jeder
  Punkt trägt jetzt einen Griff, der wirklich hinführt; die Einstellungen
  sind über eine Adresse ansprechbar. Bei einem Punkt stimmte der Weg nicht
  einmal: der Umsatzsteuer-Status wohnt in `Betrieb`, nicht in `Steuer`.
- **Ein Code, einmal.** Es gab zwei Ziffernschlösser mit zwei Geheimnissen.
  Der Gerätecode fällt weg; der Kassencode bleibt, weil er den Menschen
  benennt, der nach § 146a AO auf jedem Beleg steht. ⚠️ Die EINGABE bleibt:
  der Sitzungsschlüssel überlebt einen Kaltstart, und ohne den neuen Riegel
  wären aus zwei Schlössern null geworden.

### Wenn etwas schiefgeht

- **Ein Code nennt jetzt die STELLE, nicht nur die Art.** 194 Fehlerklassen
  fielen auf 20 Codes zusammen, 139 davon auf drei. „Es kam ein Konflikt" —
  davon gibt es fünfzig. Jeder Fehler trägt jetzt eine abgeleitete Kennung
  wie `NORNS-BARGELD-OHNE-SCHICHT`, sichtbar im Satz und am Telefon
  vorlesbar.
- **Und der Vorfall überlebt den Neustart.** Bisher hinterliess kein
  Fehlschlag eine Spur: der Motor schreibt nach stdout, und die Schale
  verwarf die Zeilen. Jetzt eine enge Zeile je Vorfall, dreissig Tage.
  ⚠️ OHNE Meldungstext und OHNE die gefahrene Adresse — in einer Meldung
  kann ein Kundenname stehen.

### Im Betrieb

- Fünf Griffe in den Systemtresor beim Start werden einer; die TSE-Zugangs-
  daten und das Datenbankpasswort werden einmal je Programmlauf gelesen
  statt bei jedem Beleg beziehungsweise jeder Sicherung.
- Der Sicherungsordner wird gegen den Heimatordner aufgelöst. Ein relativer
  Pfad zeigte bei einem über den Finder gestarteten Programm auf die Wurzel,
  und die Sicherung scheiterte an Rechten, die gar nicht das Problem waren.

### ⛔ WAS DIESE FASSUNG NICHT KANN

**Sie signiert keinen Beleg.** `tse_finish_transaction` schliesst den Vorgang
mit `PATCH` ab; die amtliche fiskaly-Beschreibung (live geprüft am
09.08.2026) kennt auf dem Vorgangspfad nur `GET` und `PUT`. `PATCH` gibt es
allein auf `/metadata`. Der Prüfstand `tests/tse_hil.rs:129` antwortet auf
`PATCH` mit 200 und einer ERFUNDENEN Signatur und meldet den Fehler deshalb
täglich als behoben.

Diese Kasse darf damit NICHT als Kasse nach § 146a AO im Verkauf eingesetzt
werden. Sie ist für Einrichtung, Prüfung und Abnahme geeignet, nicht für den
Betrieb mit Kundengeld.

## [0.1.0] - 2026-08-08

Eine reine Härtungsfassung. Achtzehn schwere und zwölf mittlere Befunde einer
adversarischen Prüfung sind geschlossen, jeder mit einer Messung, einem roten
Test vorher und einer Sabotage danach.

**Was ein Beleg jetzt richtig macht**

- Ein Storno wird mit seinem ECHTEN Betrag signiert, nicht mit 0,00 EUR.
- Die TSE-Anfrage spricht das Vokabular der V2-Schnittstelle. Vorher wurde
  KEIN Beleg signiert.
- Ein Beleg ohne Signatur steht jetzt IM Steuerauszug, mit dem Vermerk des
  Ausfalls. Vorher verschwand er lautlos aus der DSFinV-K-Datei.
- Verkauf und Ankauf sagen es laut, wenn ein Beleg ohne Signatur gebucht wird.
  Vorher blieb die Maske stumm, sobald diese Kasse gar keine TSE hinterlegt
  hatte.
- Eine fiskale Aufzeichnung wird nicht mehr nach 35 Sekunden aufgegeben. Die
  Nachreichung wiederholt für immer, mit wachsendem Abstand.

**Was der Tagesabschluss jetzt richtig macht**

- Ein Tag in der ZUKUNFT lässt sich nicht mehr versiegeln.
- Alle sechs Schreibwege nehmen die Tagessperre, nicht nur einer.
- Gesperrt wird der Tag, auf den WIRKLICH gebucht wird, nicht der Erfassungstag.
- Ein Tag mit unsignierten Belegen hat wieder einen erreichbaren Ausweg: die
  Inhaber-App kann ihn ausdrücklich abschliessen.
- Bargeld ohne offene Schicht wird abgewiesen. Vorher fiel es still aus jedem
  Kassensturz, und der Abschluss schrieb eine Differenz fest, die es nie gab.

**Was die Ausfuhren jetzt richtig machen**

- Ein Zeichen ausserhalb Windows-1252 sperrt DATEV nicht mehr für immer.
- Eine Bargeldbewegung erscheint im Auszug IHRES Tages, nicht im Auszug des
  Tages, an dem ihre Schicht geschlossen wurde.
- Ein DSFinV-K-Paket ohne fortlaufende Z-Nummer entsteht gar nicht mehr.
- Drei deutsche Abbruchmeldungen erreichen den Menschen. Vorher las er
  „Internal server error".

**Was der Betrieb jetzt richtig macht**

- Die Sicherung erkennt eine laufende Kasse und fasst sie nicht an. Vorher
  konnte sie den Postgres mitten im Verkauf abschiessen.
- Zwei gleichzeitige Sicherungen schreiben nicht mehr in dieselbe Datei.
- Die Kasse prüft ihre eigene Prüfsummenkette, täglich. Vorher hat das
  NIEMAND getan, und die Anzeige meldete trotzdem „Läuft".
- Die Fiskal-Ampel liest Quellen, die diese Kasse wirklich füllt.

**Sicherheit**

- Die Eintrittskarte für den Ereignisstrom erneuert sich nicht mehr selbst.
- Das Support-Postfach verlangt eine Rolle, bevor es Kundendaten zeigt.

## [0.0.1] - 2026-07-30

Die erste Windows-Fassung von Norns POS. Die Kasse bringt ihren Server mit
und arbeitet vollständig ohne Internet.

- Der Server läuft als Kindprozess auf diesem Gerät, gegen ein eingebettetes
  Postgres. Kein Nachbau: derselbe Server, dieselben 87 Tabellen und 75
  Wächter wie im grossen System.
- Anmeldung mit einem Code aus sechs bis zwölf Ziffern, den Sie beim ersten
  Start selbst wählen. Es gibt keine Vorgabe.
- Sicherung auf einen zweiten Datenträger, mit Zahlen statt mit dem Wort
  „fertig".
- DATEV und DSFinV-K wie gewohnt, Byte für Byte in der Form, die der
  Steuerberater erwartet.
- Freischaltung über einen Lizenzschlüssel.

⚠️ ERSTE AUSLIEFERUNG. Diese Fassung ist gebaut und geprüft, aber noch auf
KEINEM Ladenrechner gelaufen. Bitte auf einem Gerät ohne Echtdaten
ausprobieren, bevor ein Verkaufstag darauf läuft.

Alle Änderungen an Norns POS, für den Händler geschrieben.

## [1.0.0] · 2026-07-30

**Die erste Fassung.** Norns POS ist die Kasse von Warehouse14, offline und
auf dem eigenen Gerät. Derselbe Verkauf, dasselbe Lager, dieselben Kunden,
dieselben Metallkurse, dieselben Fiskalmotoren, dieselben Prüfsätze.

### Was anders ist
- **Der Server wohnt im Gerät.** Es gibt keine ferne Schnittstelle mehr.
  Produkte, Bilder, Kunden, Verkäufe, Kassenbuch, Rechnungen und die
  DATEV-Ausfuhr liegen auf diesem Rechner.
- **Die einzige Leitung nach draussen ist die TSE.** Sonst nichts.
- **Vier Einstellungsbereiche** statt elf: Steuer-Ausfuhr, Geräte samt der
  drei Drucker und der TSE, Betrieb, Beleg. Alles andere ist nicht entfernt,
  es steht nur nicht mehr im Weg.
- **Aktualisierungen** kommen wie gewohnt über die Luft, aus dem
  Norns-Verzeichnis.

## Herkunft: Warehouse14

## [0.10.0] · 2026-07-30

**Die neue Stimme: Weinrot auf Elfenbein.** Das Innere der Kasse trägt jetzt
eine eigene, ruhige Handschrift — von Norns inspiriert, nicht kopiert.

### Gestalt
- Neue Schriftstimme: eine warme Antiqua über Überschriften und Namen, eine
  sehr gut lesbare Grotesk über Text und JEDER Zahl. Geld steht immer in
  Tabellenziffern und springt nie mehr seitlich.
- Der Akzent ist ein tiefes Weinrot auf Elfenbein; bei Nacht hellt es eine
  Stufe auf, damit es auf dunklem Grund genauso klar liest.
- Der Gesamtbetrag der Karte ist jetzt der eine grosse Held der Spalte,
  direkt über „Bezahlen"; Zwischensumme und USt stehen leise in einer Zeile.
- „Zu zahlen" und das Rückgeld im Bezahlvorgang sind auf Armlänge lesbar —
  vorher wurden sie durch einen versteckten Fehler klein gezeichnet.
- Über zweitausend verstreute Schrift- und Abstandswerte sind auf feste
  Leitern gehoben; drei ständige Wächter halten sie dort.

### Behoben
- Alle acht Reiter stehen jetzt auch bei schmalen Fenstern — der achte
  (Schreiben) war vorher unsichtbar, ohne jeden Hinweis.
- Die Einstellung „Textgrösse" erreicht jetzt auch alle Geldbeträge;
  zwanzig Stellen blieben vorher klein, während alles andere wuchs.
- Der Startbildschirm gibt die grosse Fläche den Tageszahlen, solange kein
  Geschäftskalender eingerichtet ist.
- Briefe und Rechnungen zeigen die Steuerkennung nach derselben Regel wie
  der Kassenbon (Steuernummer ODER USt-IdNr.); eine Rechnung ohne jede
  Kennung sagt es jetzt deutlich auf dem Blatt.
- Die Kundensuche zeigt ihren Hinweistext vollständig statt abgeschnitten.

### Ehrlich gespeichert
- Behoben, und es traf JEDEN neuen Laden: wer seinen Namen oder seine
  Anschrift unter „Beleg & Shop" eintrug und speicherte, sah „gespeichert",
  fand nach dem Neustart aber alles beim Alten. Ursache war eine Sperre an
  der falschen Stelle: der Server verweigerte die Auskunft über einen Laden
  ohne Namen, und genau diese Auskunft braucht die Maske, die den Namen
  eintragen soll. Gesperrt wird jetzt beim Drucken, nicht beim Lesen.
- Die Felder starten leer statt mit einer fremden Beispiel-Identität. Wer
  ein Feld leerte, sah bisher den fremden Wert zurückkommen.
- Ein hochgeladenes Logo trägt jetzt Kassenbon UND Briefkopf. Der Briefkopf
  zeigte bis heute eine fest eingebaute Marke, egal was hochgeladen war.

### Etiketten
- Die Liste im Etiketten-Wähler lag übereinander: acht Namen druckten sich
  gegenseitig durch. Behoben.
- Die gewählte Etikettengrösse erreicht jetzt wirklich den Drucker. Bisher
  bekam die Warteschlange nur „einpassen" und nahm das voreingestellte
  Etikett des Treibers, auf das die fertige Seite gezogen wurde.

### Bedienung
- Eingabefelder sind in beiden Darstellungen sichtbar: die Feldlinie war im
  hellen Thema kaum vom Papier zu unterscheiden, man tippte blind.
- Jeder Einstellungs-Bereich trägt sein eigenes Zeichen, und die Zeichen
  antworten unter der Hand.
- Das Wertfeld des Rechnungsrabatts bleibt in seinem Kasten.
- Während der Anmeldung sagt die Kasse „Wird geprüft", statt schnelle
  Eingaben stumm zu schlucken.

## [0.9.1] - 2026-07-27

**Der Feinschliff: das Auge ruht.** Kein neues Werkzeug, nur Sorgfalt — auf
jeder Fläche, in beiden Themen.

### Lesbarkeit
- Tiefere Tinte überall dort, wo Text zu blass stand: alle Textfarben
  erreichen jetzt die Lesbarkeitsschwelle, gemessen und von einem neuen
  Wächter dauerhaft bewacht.
- Tabellen haben endlich sichtbare Linien — die Trennlinie trug die ganze
  Struktur bei fast unsichtbarem Kontrast.
- Die kleinsten Schriften im Geldweg und in den Tabellen sind auf die
  Systemleiter gehoben.

### Ordnung
- Rohe Eckenradien, Ebenen-Zahlen und Bewegungsdauern sind auf die
  System-Marken geführt; zwei neue Wächter halten es so.
- Die Aktualisierungs-, Beleg- und Storno-Fenster liegen sauber auf der
  Ebenen-Leiter — nichts kann mehr etwas Wichtiges verdecken.

### Für die Hand
- Zehn Auskünfte, die bisher nur beim Zeigen mit der Maus erschienen
  (Terminal fehlt, Kurs veraltet, die PEP-Marke am Kunden …), haben jetzt
  einen sichtbaren Platz — auf Touch-Geräten existierten sie schlicht nicht.

### Ehrlichkeit
- Datei-Kommentare, die längst Überholtes behaupteten, sagen wieder die
  Wahrheit; die Kartenleser-Gruppe erkennt einen alten Kontostand und
  fällt ehrlich in den Nicht-eingerichtet-Zustand.

### Betrieb
- Neue Fläche **Einstellungen → Betrieb**: die Stammdaten des Betriebs
  (Firmenname, Anschrift in einzelnen Feldern, Land als Auswahl,
  Steuernummer oder USt-IdNr., Seriennummer der Kasse) werden hier EINMAL
  eingetragen — Prüferpaket und DATEV lesen sie ab dann von selbst. Ein
  Hinweis zeigt, was noch leer ist; solange etwas fehlt, erzeugt der
  Prüfer-Export bewusst nichts statt einer Datei, die vollständig aussieht.
- Behoben: eine rein numerische Eingabe (Postleitzahl, nur-Ziffern-Telefon)
  wurde beim Speichern einer Einstellung fälschlich als Zahl gedeutet und
  abgelehnt.

## [0.9.0] - 2026-07-26

**Der Bon gehört jetzt dem Laden.** Das fest eingebrannte Logo ist aus den
Druckbytes verschwunden. Stattdessen: Einstellungen → Beleg gestalten, eigenes
Logo wählen (SVG wird empfohlen, PNG und JPEG gehen auch), Grösse wählen,
speichern — jeder Bon danach trägt es. Die Vorschau daneben ist keine
Nachbildung: sie zeigt das echte Druckbild aus denselben Bytes, die der
Drucker bekommt. Es muss nie ein Probebon gedruckt werden. Ganz oben auf jedem
Bon steht künftig eine feine Zeile `norns.de`.

### Der Beleg
- Eigenes Logo auf Bon und A4-Rechnung, vom Inhaber selbst hochgeladen,
  in drei festen Grössen, offline weiterhin druckbar.
- Die Vorschau kommt aus dem echten Bytestrom (58 und 80 mm umschaltbar).
- Der Ladenname aus den Einstellungen wird auf dem Bon wirklich gedruckt.
- Ein seit dem ersten Tag mitgeschlepptes wörtliches »\n« mitten im
  Dankestext ist behoben.

### Die Kartenzahlung
- Vorbereitet: Kartenzahlung über einen Stripe-Leser, mit einer Geste aus
  dem Warenkorb — Betrag und Posten wandern automatisch auf das Gerät, der
  Kundenschirm des Lesers zeigt die echten Positionen. Sichtbar wird der
  Weg, sobald Konto und Leser eingerichtet sind; das bestehende
  ZVT-Terminal bleibt unverändert daneben.

### Anmeldung
- Die Anmeldung ist Google — der alte PIN-Weg ist von der Anmeldefläche
  verschwunden.

### Der Assistent
- Der Sprachassistent bekam einen Rufnamen. (Er ist inzwischen komplett ausgezogen, 19.08.2026.)

### Bedienung
- Symbole statt Emoji im ganzen Rahmen — auf Windows wirkten die bunten
  Systemzeichen fremd.
- Feine, gestaltete Rollbalken, hell und dunkel.
- Zahlartwahl im Bezahlen-Dialog und die Kopfleiste sind deutlich grössere
  Ziele — für Touch und für eilige Hände.
- Breite Bildschirme werden genutzt: mehr Katalogspalten im Verkauf, das
  Produktblatt dockt im Lager rechts an, Einstellungen in zwei Spalten.

## [0.8.0] - 2026-07-26

**Der Fliesstext stand ein Drittel enger als entworfen.** In den Design-Marken
las eine Marke sich selbst (`--w14-leading-body: var(--w14-leading-body)`).
Eine solche Marke bekommt gar keinen Wert, und jede Regel, die sie ohne
Rückfall liest, wird verworfen. Gemessen im Browser: der Zeilenabstand der
ganzen Kasse fiel auf den Vorgabewert, rund 19 statt der entworfenen 26 Pixel.
Weder die Typprüfung noch der Marken-Wächter konnten das sehen — der eine
liest eine Zeichenkette, der andere prüft nur, OB ein Name definiert ist.

### Die Geräte

- **Der Etikettendrucker im Laden kann jetzt bedruckt werden.** Die Kasse
  kannte zwei Druckersprachen; ein DYMO spricht keine davon. Neu ist ein
  dritter Weg über den Systemtreiber. Beim Übernehmen eines gefundenen Geräts
  wird die Sprache jetzt mitgeschrieben — die Erkennung wusste es und warf es
  an genau der Stelle weg.
- **Zehn Etikettengrössen statt einer**, mit einem eigenen Bauplan für kleine
  Münzen, für das Regal und für die grossen Formate. Der Inhaber wählt je
  Artikel, sieht eine massstäbliche Vorschau, und eine Grösse, auf die kein
  lesbarer Strichcode passt, ist gesperrt statt heimlich verkleinert.
- **Beim Anlegen wählt die Kasse die Grösse selbst** — aus Warenart, Gewicht,
  Preis und der Länge von Nummer und Namen.
- **Der Beleg wurde nicht mehr auf voller Länge gedruckt.** Der Treiber gibt
  nur 78 der 89 Millimeter frei; der Bauplan rechnete mit dem Papiermass. An
  beiden Enden fehlten gut fünf Millimeter.
- **Alle fünf Druckstellen melden jetzt ihr Ergebnis.** Ein gescheiterter
  Druck liess den grünen Punkt vorher unberührt.

### Was auf dem Bildschirm steht

- **Neun Bereiche sagten „nichts da", wenn sie „keine Antwort" meinten.** Der
  Metallkurs, der Leitstand, die Risikoanalyse und sechs weitere zeigten bei
  einem Netzfehler eine leere Liste als Tatsache. Jetzt sagen sie, dass die
  Verbindung fehlt, und bieten einen zweiten Versuch an.
- **Die Meldungen stapeln sich nicht mehr.** Höchstens vier gleichzeitig,
  gleiche Meldungen werden zu einer mit Zähler, und lange Gerätekennungen
  sprengen die Blase nicht mehr.
- **Der Scan-Zeitraum wächst mit der Länge des Codes.** Ein Scan durfte
  insgesamt 200 Millisekunden dauern, egal wie lang der Code war; lange
  Artikelnummern fielen bei trägen Geräten lautlos durch.

### Ordnung

- **Eine Abstandsleiter statt zwei.** Nachgerechnet: sechs der gelebten Stufen
  hatten in der zweiten Leiter gar keine Entsprechung, darunter die zwei
  meistbenutzten. Ein blindes Umbiegen hätte 125 Stellen sichtbar verschoben.
- **Eine Schriftleiter für die Dichte am Tresen.** Statt 48 handgetippter
  Grössen siebzehn benannte Stufen. Die vorhandene Leiter des Webshops beginnt
  bei 0,81 rem — 441 der 1062 Verwendungen in der Kasse liegen darunter.
- **Acht Fenster hatten weder Höhenbegrenzung noch Rollbereich**: bei kleinem
  Fenster waren Titel und erste Felder unerreichbar.
- **Vier getrennte Kundensuchen wurden eine.** Sie verhielten sich bei Fehler,
  Entprellung und Sperrvermerk unterschiedlich.

### Damit es nicht zurückfällt

Neue Wächter machen einen Rückfall sofort rot: eine Marke, die sich selbst
liest; eine nackte Ebenenzahl; ein Fenster ohne Escape; ein Text, der bündig
auf der Reichweite des Druckkopfs sitzt; eine Druckstelle, die ihr Ergebnis
verschweigt.

## [0.7.7] - 2026-07-25

- **Abmelden räumt endlich auf.** Es gab drei Abmelde-Knöpfe und nur einer davon gab die Reservierungen frei, leerte den Verkaufskorb und wischte die gelesenen Kundenakten. Die beiden anderen — der im Medaillon und der am Sperrbild — liessen alles stehen. Eine Kassen-Reservierung verfällt nicht von selbst, die Ware blieb also für Webshop und eBay gesperrt, bis jemand sie von Hand löste; und der nächste Mensch am Tresen fand den Korb seines Vorgängers vor.
- **Der Handscanner blättert nicht mehr durch die Bereiche.** Im Lager ist absichtlich kein Feld angeklickt, damit man einfach scannen kann. Jede Ziffer des Strichcodes wurde dadurch als Tastenkürzel gelesen: eine EAN-13 liess die Kasse neunmal den Bereich wechseln, und der Scan ging verloren.
- **Windows baut wieder.** Die Auslieferung 0.7.5 war auf Windows gescheitert.

## [0.7.6] - 2026-07-25

- **„Alle Flächen": ein sichtbarer Weg zu allem.** Sechsundzwanzig Bereiche — darunter Risikoanalyse, Leitstand und der Edge-Schutz — waren ausschliesslich über die Suche erreichbar. Wer das richtige Wort nicht traf, fand sie nie.
- **Der Fuss des Kassenbons** ist geordnet: Höflichkeitszeile und Pflichtangaben stehen getrennt und in eigener Schriftgrösse.

## [0.7.5] - 2026-07-25

- **Die Kasse erkennt jeden angeschlossenen Drucker**, auch einen, für den das Betriebssystem noch gar keine Warteschlange angelegt hat. Bis dahin war ein frisch eingesteckter Etikettendrucker in jeder Liste unsichtbar. Zu jedem Gerät steht, wofür es vermutlich da ist und warum.

## [0.7.4] - 2026-07-25

- **Der gedruckte Beleg, neu gesetzt.** Spaltenbreite, Umbruch langer Artikelnamen, Platz für den QR und der Ankaufbeleg. Dazu ein Papiersimulator, der den echten Bytestrom als Papier liest — er hat vier Fehler gefunden, die auf dem Bildschirm nicht zu sehen waren.

## [0.7.3] - 2026-07-25

- **Sechs Farben, die es nie gab.** An sechs Stellen stand eine Design-Marke, die nirgends definiert war; die ganze Deklaration wurde damit verworfen, im schlimmsten Fall zu „durchsichtig". Nichts warnte davor.
- **Suche in Bestellungen und im Kassenbuch**: nach Bestellnummer, Name, Telefon und Stück, und ein Beleg nach seiner Nummer.
- **Ein echter QR-Zeichner** statt eines Musters.

## [0.7.2] - 2026-07-24

- **Bestellungen sind eine echte Arbeitsfläche.** Die Online-Reservierungen öffnen sich jetzt als Meister-Detail: links die Warteschlange nach Fächern, rechts der ganze Vorgang mit Kundenname, Positionen, Herkunft (Laden oder Webshop) und den Schritten annehmen, vorbereiten, bereitstellen, übergeben. Kein schwebender Kasten mehr in der Mitte.
- **Bestellungen steht jetzt direkt neben Ankauf** (Kartei-Ziffer 3), nicht mehr am Ende der Leiste, und die Ziffernfolge in der Leiste stimmt wieder von 1 bis 8.
- **Vorläufige Rechnung für den Kunden, auch ohne TSE.** Ein klar als nicht-fiskalisch gekennzeichneter Beleg lässt sich für den Kunden drucken, bevor an der Kasse bei der Bezahlung der echte fiskalische Bon nach §146a AO entsteht.

## [0.7.1] - 2026-07-23

- **Bestellungen sind jetzt ein sichtbarer Bereich, kein Suchtreffer.** Der Schirm war seit v0.7.0 vollständig gebaut, aber nur über die Suche erreichbar — es gab keinen Knopf an der Oberfläche, um eine Online-Reservierung anzunehmen, vorzubereiten oder zu übergeben. Bestellungen steht jetzt als eigener Bereich mit der Kartei-Ziffer 8 in der Hauptleiste. Der Leitstand, eine reine Blick-Fläche, ist dafür in die Suche gewandert (der Inhaber trägt ihn ohnehin in der Telefon-App).

## [0.7.0] - 2026-07-23

- **Die Bestätigung verlangt jetzt Ihren Gerätecode, nicht mehr die abgeschaffte Kassen-PIN.** Jeder Steuerexport, jedes Storno, jeder Z-Bon, jede Löschung fragte weiter nach der vierstelligen Zahl, die am 21.07. abgeschafft wurde. Sie geben jetzt denselben Code ein wie beim Entsperren der Kasse. Geprüft wird er auf diesem Gerät, mit derselben Sperre nach mehreren Fehlversuchen; er wird nicht über das Netz geschickt. Wichtig für Sie als Inhaber: ein neu angelegter Mitarbeiter hatte gar keine alte PIN und hätte den Steuerexport NIE ausführen können.
- **Sie können jetzt eine einzelne Position aus einer Bestellung nehmen.** Ist eines von drei Stücken beim Vorbereiten beschädigt, mussten Sie bisher die ganze Bestellung ablehnen — der Kunde bekam eine Absage für zwei einwandfreie Stücke. Jetzt nehmen Sie das eine heraus, es geht sofort zurück in den Verkauf, und der Kunde erfährt die Änderung per Brief. Die letzte Position lässt sich so nicht entfernen; dafür gibt es das Ablehnen mit Grund.
- **Sie können die Abholfrist verlängern.** Ruft jemand an und schafft es erst Samstag, geben Sie ihm drei, sieben oder vierzehn Tage mehr. Bisher war nichts zu machen: die Reservierung verfiel, die Stücke gingen zurück in den Verkauf, und die Vertrauensstufe zählte es als Nichtabholung — der Kunde wurde also bestraft, weil er angerufen hat. Der Kunde bekommt das neue Datum schriftlich.
- **Bestellungen ablehnen, mit Grund.** Der Grund steht im Absagebrief, im Beleg und im Tagebuch.
- **Ein Aufkleber zum Ausdrucken**, mit Anschrift, Bestellnummer und Strichcode. Bei einer Abholung ist es der Regalzettel: derselbe Strichcode, damit ein Handscanner das Paket am Tresen sofort findet. Eine Sendungsnummer steht bewusst NICHT darauf, solange kein Zusteller angebunden ist.
- **Ein gelöschtes Kundenkonto verschwindet nicht mehr aus der Liste.** Es steht durchgestrichen da, mit dem Hinweis, ob der Kunde es selbst gelöscht hat oder wir. Kundennummer und Umsätze bleiben erhalten. In der Kundenauswahl beim Verkauf wird ein gelöschtes Konto weiterhin nicht angeboten.
- Eine Versandbestellung liest sich jetzt als „Versand" statt als Abholung mit unbekanntem Stand.

## [0.6.0] - 2026-07-23

- Neu: die Bestellungen. Was ein Kunde im Onlineshop reserviert, steht jetzt als eigene Warteschlange an der Kasse, mit Name, Kontakt, Positionen, Bestellnummer und Frist. Vier Knöpfe führen den Vorgang von Anfang bis Ende: annehmen, vorbereiten, abholbereit melden, übergeben. Bis heute gab es dafür keine einzige Schaltfläche, und eine Web-Reservierung liess sich überhaupt nicht abschliessen.
- Die Übergabe läuft über den ganz normalen Verkauf. Sie laden die Bestellung an die Kasse, kassieren, und der Beleg entsteht auf demselben Weg wie jeder andere. Das Stück geht auf verkauft, die Bestellung wird mit dem Beleg verknüpft, und im Tagebuch steht, wer übergeben hat.
- „Abholbereit" schickt dem Kunden den Brief, dass sein Stück bereit liegt. Geht der Versand schief, sagt die Kasse es Ihnen sofort, statt so zu tun, als sei der Brief unterwegs.
- Zwei falsche Anzeigen in der Kundenakte sind behoben. Ein roher Zustandsname erscheint nicht mehr im Klartext, und ein fehlgeschlagener Lesevorgang wird nicht länger als „nichts bestellt" dargestellt. Ein Fehler beim Lesen sagt jetzt, dass gelesen werden wollte und nicht ging.
- Die Meldung bei einem Widerspruch ist ehrlich geworden. Sie sagt jetzt, ob die Bestellung verfallen, storniert oder bereits übergeben ist, statt zu behaupten, sie stehe nicht mehr auf einem Stand, auf dem sie sichtbar steht.
- Das Tagebuch kennt die neuen Vorgänge auf Deutsch. Statt eines rohen Kürzels steht dort, dass eine Bestellung angenommen, vorbereitet oder als abholbereit gemeldet wurde.

## [0.5.5] - 2026-07-21

- Der Gerätecode ist jetzt gegen systematisches Raten geschützt. Ab der dritten Fehleingabe sperrt sich das Tastenfeld für 15 Sekunden, ab der fünften für eine Minute, ab der siebten für fünf Minuten und ab der neunten für fünfzehn Minuten, jeweils mit sichtbarer Restzeit. Nach zehn Fehlversuchen wird der gespeicherte Code gelöscht und eine neue Anmeldung mit Google verlangt.
- Der Zähler der Fehlversuche wird dauerhaft gespeichert. Die App zu schließen und wieder zu öffnen setzt ihn nicht mehr zurück.
- Der Gerätecode wird deutlich stärker abgelegt: statt eines einzelnen Durchgangs jetzt PBKDF2 mit 100.000 Runden. Ein bereits gesetzter Code wird bei der nächsten richtigen Eingabe automatisch übernommen, Sie müssen nichts tun.

## [0.5.4] - 2026-07-19

- Vierzehn wird ausführend: Der Assistent kann Artikel jetzt nicht nur anlegen, sondern auch ändern („ändere den Preis der Taschenuhr auf 450") und Entwürfe löschen, immer mit lautem Zurücklesen und erst nach einem gesprochenen Ja, mit vollem Vorher/Nachher im Tagebuch. Seine Grenzen bleiben hart: nur Ware, niemals Einkaufspreis, Steuer, Status-Schalter, Geldpfade oder System.
- Die Foto-Brücke: Auf dem Telefon gibt es den neuen „Fotoeingang", der Ware direkt vom Regal an Vierzehn sendet. An der Kasse zeigt der Assistent die angekommenen Bilder als Vorschau und hängt sie auf Zuruf an den diktierten Artikel („leg ein Produkt an, mit den drei neuen Fotos"), das erste wird automatisch das Hauptfoto. Ein gelöschter Entwurf gibt seine Fotos in den Eingang zurück, nichts geht verloren.

- Neuer Leitstand (nur für den Inhaber): der Zustand des ganzen Hauses auf einer ruhigen Seite. Ein Urteil oben („Alles in Ordnung", „Achtung erforderlich", „Störung"), der Zustand jedes Bereichs als eigene Kachel (Server, Datenbank mit Schema-Stand, Hintergrund-Jobs, Fiskal mit TSE-Restlaufzeit, Warnsignale, Edge-Schutz), eine Liste der wirklich offenen Probleme mit einem direkten Weg zur Lösung, und die Türen zu Risikoanalyse und Schaufenster an einer Stelle. So sind Risiko, Systemzustand, Probleme und die Firewall endlich verbunden statt versteckt.
- Kundenakte tiefer: die Suche findet einen Kunden jetzt auch über die Bestellnummer, nicht nur über Name, Kundennummer, E-Mail oder Telefon. In der Akte steht, wie der Kunde entstanden ist (mit Google registriert, online registriert oder im Geschäft angelegt), und jeder Vorgang trägt seine Herkunft als Kennzeichen (Online, eBay oder Telefon gegenüber der Kasse).
- Ruhigere, reichere Bewegung: neue Bildschirme setzen sich mit einer sanften, gestaffelten Einblendung zusammen statt hart aufzuspringen, und das Profilmenü öffnet sich weich aus dem Medaillon. Alles achtet die Systemeinstellung für reduzierte Bewegung.
- Feinschliff der Risikoanalyse: die Balken tragen jetzt ruhige Tinte statt eines falschen Goldtons, und die Statuspunkte folgen der Hausfarblehre (grün für ruhig, Gold für Beobachtung, Rot für Alarm).

## [0.5.3] - 2026-07-17

- Anmeldung mit Google: Sie melden sich mit dem Warehouse14-Google-Konto an und vergeben danach einen eigenen Code oder ein Passwort, das nur auf diesem Gerät gespeichert wird. Die PIN-Anmeldung bleibt als Alternative erhalten.
- Sicherer Start: die App öffnet nie mehr von selbst. Bei jedem Öffnen ist der Gerätecode Pflicht (nicht mehr überspringbar), und nach fünf Minuten ohne Bedienung sperrt sie sich wieder. Die Google-Identität wird verlangt, sobald die Sitzung abläuft. Eine gespeicherte Sitzung allein reicht nie, um hineinzukommen.
- Vollständiges Profil statt des „14"-Siegels: oben links zeigt ein Messing-Medaillon jetzt Ihr Google-Bild (oder Ihre Initialen). Ein Klick öffnet Name, angemeldete E-Mail, Ihre Rolle mit den zugehörigen Berechtigungen, die Gültigkeit der Sitzung und die Abmeldung an einer einzigen Stelle.
- Neue Zielkarte: die Ziele des Hauses als lebendige Instrumententafel mit echten Live-Werten (Umsatz, Bestand, Gold und Silber, Gewinn). Jedes Instrument ist fein ausgearbeitet wie echtes Werkstatt-Gerät: Messing-Manometer mit gravierten Zahlenskalen und Zeigern aus gebläutem Stahl, ein Thermometer, Glasgefäße voller geschmolzenem Gold und Silber, hölzerne Schatztruhen mit Messingbeschlägen und Nieten, eine Balkenwaage mit Ketten sowie eine gealterte Schatzkarte mit Galeone und Kompassrose.
- Neue Risikoanalyse: Warnsignale und die Kunden-Beobachtungsliste an einem Ort, samt Edge-Schutz von Cloudflare, der zeigt, wie viele Bedrohungen am Rand gestoppt wurden, an welchen Tagen und aus welchen Ländern sie kamen.
- Neues Schaufenster: wer vor dem Fenster steht. Besucher pro Tag, Seitenaufrufe, Herkunftsländer, verwendete Browser, der getrennt ausgewiesene Anteil des Ladens gegenüber der App-Schnittstelle und die Frage, ob der Laden sauber geantwortet hat. Besucher sind bewusst keine Kunden und werden nie über Tage addiert.
- Neues Team und Rollen: Mitarbeiter über ihre Google-E-Mail freischalten, die Rolle setzen und den Zugang wieder entziehen.
- API-Schlüssel in den Einstellungen: programmatische Zugänge für Agenten oder Dienste anlegen, mit fester Rolle und optionaler Nur-Lesen-Beschränkung. Der Schlüssel wird nur einmal angezeigt.
- Kundenakte: die Gesamtzahl der Kunden und der letzte Vorgang je Kunde werden jetzt angezeigt.
- Vierzehn kann auf Zuruf einen Artikel als Entwurf anlegen (nach gesprochener Bestätigung) und bleibt bei längeren Gesprächen zuverlässig verbunden.
- Ehrliche Fehlerantworten am Rand: ein fehlerhaft gesendeter Aufruf wird jetzt als solcher beantwortet (nicht mehr als Serverfehler), und eine noch nicht eingerichtete Funktion (Kartenzahlung, Fotospeicher) meldet ehrlich „nicht verfügbar" statt einen Absturz vorzutäuschen. Das hält die Störungsanzeige im Schaufenster sauber.
- Allgemeine Verbesserungen und Politur.

## [0.5.2] - 2026-07-15

- Vierzehn ist jetzt deutlich lauter und klarer zu hören, mit sauberem Hochdeutsch und einer natürlicheren Stimme.
- Vierzehn zeigt jetzt, was er sagt: während er über Zahlen spricht, erscheint eine dramatische Karte auf dem Bildschirm. Der Umsatz als große, hochzählende Zahl; der Stand des Tages mit Metallpreisen; die Finanzen; ein gefundener Artikel oder Kunde; die Agenda.
- Vierzehn liest jetzt das ganze Haus: Umsätze, Finanzen, Bestand, Artikel, Kunden, Termine und Aufgaben, und antwortet mit echten Zahlen statt abzulehnen.
- Allgemeine Verbesserungen und Politur.

## [0.5.1] - 2026-07-15

- Vierzehn hört jetzt zuverlässig: das Mikrofon wird beim Start automatisch angefragt, danach wacht der Sprachassistent sofort auf und begrüßt Sie. Bei gesperrtem Mikrofon führt ein Knopf direkt zu den Systemeinstellungen.
- Vierzehn ganz neu gestaltet: eine bildschirmfüllende Darstellung mit drei umschaltbaren Ansichten (Reaktor, Partikel, Gewebe), jede in eigener Farbe.
- Verkauf: der Warenkorb bleibt kompakt, „Bezahlen" ist jetzt immer sichtbar, auch bei vielen Positionen. Kein Herunterscrollen mehr.
- Ruhigerer Dunkelmodus in kühlem Schiefer, ohne Gelbstich.
- Allgemeine Fehlerbehebungen und Politur der Bedienung.

## [0.5.0] - 2026-07-15

- Neuer Sprachassistent „Vierzehn": Sie sprechen einfach mit der Kasse. Er liest und berichtet, zum Beispiel den Stand des Tages, und begrüßt Sie beim Öffnen auf Deutsch.
- Dunkelmodus: die ganze App in einem warmen, augenschonenden Dunkel, umschaltbar über die Kopfzeile.
- Stabilere Verbindung: klare Meldungen bei Netzausfall, keine hängende Ansicht mehr, schnellere Fehlererkennung.
- Sichtbarere aktive Zustände und Schalter; ein Farbfehler in Verkauf und Einstellungen wurde behoben.
- Überarbeitetes Aktualisierungs-Center: grüner Hinweis bei neuer Version, mit einer Liste der Neuerungen.
- Allgemeine Fehlerbehebungen und Politur der Bedienung.

## [0.4.11] — 2026-06-10

- **World-class cashier & inventory redesign** (grounded in a 13-agent UX-research
  brief): the payment screen now shows the amount due as the dominant figure with
  one-tap exact-change & note chips and one-tap card; removing a cart line is
  instant with an Undo (no more confirm dialog); the number pad, Storno safety,
  inventory list and contrast/icons were all tightened for speed and calm. No
  change to any amount, tax, or receipt — money logic untouched, proven by tests.
- **Product photos reach the online shop**: a published product now shows its real
  photo on the website (with a multi-image gallery), and the cashier picks which
  photo is the main one. Products also get a clean web address automatically.

## [0.4.10] — 2026-06-08

- **DSFinV-K export** (Steuer-Export + Owner-Desktop): one-click download of the
  standardized cash-register data bundle a tax inspector asks for in a
  Kassen-Nachschau. (Core export — to be validated against the official
  DSFinV-K Prüftool and your tax advisor before a real audit.)
- **Verfahrensdokumentation**: the GoBD-required procedural documentation of the
  cash system is now written and included.
- **Cleaner German labels**: product type, condition, status, appointment and
  customer fields now show proper German text instead of internal codes.

## [0.4.9] — 2026-06-08

- **Security hardening** (from a final internal audit): the customer-display
  companion now carries its access token in a handshake header instead of the
  connection URL, so it can't be recovered from device logs/history.
- **Internal cleanup**: the money rounding/conversion helpers are now defined
  once and shared (previously copied across three screens), removing the risk of
  the cash, intake and appraisal screens ever rounding differently. No change to
  any amount — proven by tests.

## [0.4.8] — 2026-06-08

- **Split payment** (Kasse): pay part of a sale in cash and the rest on the
  card terminal — one receipt, one transaction. Appears as a "Betrag aufteilen"
  option in the Bezahlen dialog when a card terminal is configured.
- **Publish to eBay** (Lager): the "Bei eBay listen" button now drives a real
  eBay listing push when an eBay account is connected (shows a clear "token
  pending" note until then) — no fiscal data involved.
- **Reliability hardening** (server): fixed three latent permission/typing
  faults in the audit-ledger triggers that would have surfaced on the first
  real cash-up, card/TSE event, or viewing-appointment booking.

## [0.4.7] — 2026-06-08

> **Nachgetragen am 26.07.2026 — die beiden Begleiter-Eintraege gelten nicht
> mehr.** Sie waren am 08.06.2026 wahr. Am 22.06.2026 entfernte das Einchecken
> `c6bd85f` den gesamten Begleiter-Quelltext (sechs Dateien, 8.888 Zeilen), und
> seither gibt es weder die Kundenanzeige noch die Zweitkasse auf einem
> gekoppelten Geraet. Der Vollstand liegt auf dem Zweig
> einem historischen Arbeitszweig; die Einordnung steht in
> `docs/companion-architecture.md`. Der Eintrag bleibt als Geschichte stehen,
> denn er beschreibt richtig, was diese Fassung damals konnte.

- **Customer display updates live** (Kundenanzeige companion): the paired
  iPad/phone now mirrors the cashier's cart in real time over the shop Wi-Fi
  instead of refreshing once a second.
- **Second cashier can build a cart** (Zweitkasse companion): add items, adjust
  quantities and see the running total on a paired tablet; payment is handed
  back to the main till (the companion never writes a fiscal record on its own).
- **Cleaner, more accessible chrome**: clearer top-bar spacing and a more
  legible connection badge; clickable cards and the search overlay are now
  fully keyboard-operable.

## [0.4.6] — 2026-06-08

- **Cleaner screens across the app**: consistent spacing, stronger hierarchy
  (the cart/day total now dominates), and one obvious brass primary action per
  view — applied to Verkauf, Lager, Ankauf, Tageskasse, Kunden and Werkstatt.

## [0.4.5] — 2026-06-08

- **Visible primary buttons** (brass accent across every screen) + a real
  spacing scale in the design system.
- **In-app camera** enabled (camera usage description + entitlement) — capture
  product photos directly (works in the installed app; first use prompts for
  macOS camera permission).
- **TSE signatures are persisted server-side** (GoBD): each KassenSichV
  signature is durably stored, linked to its transaction (migration 0054).

## [0.4.4] — 2026-06-08

- **Verkauf catalog shows product photo cards** (image + name + price + metal),
  fed by a new primary-photo field on the products feed.
- **Product lifecycle**: a 'Fertig' finish button in the photo studio; delete a
  DRAFT product (guarded, owner + step-up); a single 'Bei eBay listen' action
  (honest stub) alongside the existing web-shop toggle.
- **Companion (iPad/phone)**: real role screens — Lager (label printer, add/edit
  product, inventory + clean barcode lookup), Zweitkasse, Kundenanzeige — with
  big-icon role selection after pairing.

## [0.4.3] — 2026-06-08

- **Product photos now display in the app.** The CSP `img-src` now allows the
  API media host, so server-stored product photos render as thumbnails in the
  product sheet (upload already worked in 0.4.2; this lets the webview show them).

## [0.4.2] — 2026-06-08

- **Product photos work again.** Upload now goes through the API
  (`POST /api/photos/upload`) instead of a direct browser→R2 PUT, removing the
  R2-CORS dependency that silently blocked every upload; fixed a webp/jpeg
  content-type mismatch; photos now render as thumbnails in the product sheet
  (CSP extended for the R2 media host).
- **iPad/iPhone pairing connects.** The companion hub now detects the real
  Wi-Fi LAN IP (ignoring VPN/Docker interfaces) for the pairing QR, and the
  subnet guard tolerates real LAN topologies instead of rejecting the device.

## [0.4.1] — 2026-06-07

Security hardening of the companion LAN subsystem (review-driven, before any
second-cashier payment ring-up):

- The companion proxy role allow-list is now positive + deny-by-default: a
  paired Second-Cashier tablet can only ring up (`transactions/finalize`) — it
  can no longer reach Ankauf (cash payout), Storno (void) or Return (refund).
- The proxy path is traversal-safe (percent-decoded + rejected on `..`/`//`),
  closing a deny-list bypass.
- Pairing code is single-use + 5-min TTL + CSPRNG + per-TCP-peer rate limit +
  global lockout; strict CSP + no innerHTML sink on the companion page;
  same-subnet peer guard + token TTL; request body/concurrency/timeout limits.

## [0.4.0] — 2026-06-07

Deep-overhaul release (test mode). Driven by a 54-finding multi-agent audit
(`docs/deep-audit-2026-06-07.md`).

### Fixed — the "no server connection" on Windows

- The cloud session cookie is `SameSite=None; Secure`, which Windows WebView2
  drops at the non-secure `http://tauri.localhost` origin — so the app opened
  but every request read as logged-out. Now the session token is also carried
  as `Authorization: Bearer` (immune to cookie policy), with an `access_token`
  query param for the SSE stream. Auth now survives on Windows.

### Fixed — money safety & honest connection state

- Ankauf double-pay on double-click (client mutex + idempotency key + server
  dedup); offline-queued buy-ins/cards no longer read as "failure"; ZVT
  finalize-retry no longer re-authorizes (no double charge); cart-line removal
  rolls back on release failure (no zombie reservation); offline fiscal
  mutations are correctly GoBD-tagged.
- A down server now shows "Keine Verbindung zum Server" + retry instead of an
  empty catalog / the PIN pad; the status badge reflects real reachability.

### Added — high-value sale & companion devices

- §10 GwG: a VERKAUF ≥ €2.000 is now completable — a buyer picker with
  Ausweisprüfung (search / create / KYC-verify) attaches a verified buyer.
- **Companion LAN hub** (`docs/companion-architecture.md`): the mother POS
  embeds a local server so an iPad/phone on the shop Wi-Fi pairs via QR
  (Settings → "Geräte koppeln"), picks a role (Lager / Zweitkasse /
  Kundenanzeige), and rides the mother's session through a role-scoped proxy.
  The Customer-Display shows the mother's live cart. (Second-cashier ring-up +
  realtime WebSocket are the next phase.)

### Changed

- German UI polish (no English enums on the floor); enforced server rate
  limits; mTLS-bypass boot guard; ±50% metal-price plausibility band; 11
  secondary surfaces lazy-loaded off the first-paint path.

## [0.3.0] — 2026-06-07

Go-live release candidate (shop test build, **test mode** — mTLS/secret
rotation deferred to go-live). Consolidates the full UX redesign +
fiscal/compliance stack accumulated since v0.2.2.

### Compliance (binding — Roman Grützner sign-off)

- **GwG direction-aware KYC enforcement** (migration 0050). ANKAUF requires
  a KYC-verified seller for every buy from €0,01 (§259 StGB); VERKAUF
  requires identification at/above €2.000 (§10 GwG). Enforced by an
  un-bypassable SECURITY DEFINER trigger; the cashier sees a friendly 403,
  not a raw error. Stornos are never re-blocked.
- **AML smurfing-aggregation framework** + **TSE/KassenSichV compliance
  tables** (migrations 0049 and the AML set) — alert-only thresholds are
  placeholders pending the Steuerberater's confirmation.
- **Sample fiscal exports** (`docs/samples/`): real DATEV EXTF
  Buchungsstapel + Kassenbericht for the accountant's review. Open question
  surfaced: all VERKAUF currently post to revenue account `8400` regardless
  of `tax_treatment_code` (see the marked TODO).

### POS & Owner Desktop

- Full UX pass: shared Dialog/Sheet + form primitives, number-key
  navigation, cashier keypad/discount/barcode/confirm flows, plain-language
  Kasse, in-place product sheet, per-metal margin editor, metal ticker,
  Ankauf estimator, Steuer-Export surface, and the Control Desktop polish.

## [0.2.2] — 2026-06-05

Kasse usability pass for Roman's daily flow (reviewed + integrated
consolidation of four historische Arbeitszweige + `test-gate`).

### Kasse

- **Ankauf — KYC surfaced early.** The GwG §10 identification gate
  (≥ €2.000) is shown up front via the pure, tested `evaluateKycGate`;
  enforcement is behaviour-identical (not weakened). Faster item entry:
  expanded form with sticky metal/tax and clearer price-direction labels.
- **Verkauf — clearer discounts + faster turnaround.** Live
  discount-reason feedback with touch-sized controls (pure, tested
  `isDiscountReasonValid`); the catalog search auto-refocuses the moment
  a sale finalizes so the next scan/keystroke lands without a click.
- **Lager — scan-to-adjust + clearer notes.** A barcode scan auto-opens
  the inventory-adjustment dialog; the adjustment note shows a live
  minimum-length hint before submit.

### Hardware (software-complete, awaiting the device day)

- **ZVT card path** hardened to a spec-accurate BMP parser
  (ecrterm-grounded) driving the full multi-message authorisation
  conversation; mocks promoted from facade to validating. Proven by the
  in-repo HIL suite (`cargo test`). Real-terminal field-location +
  status-cadence confirmation remain quarantined for the go-live day.

### Backend (ships separately)

Database migrations **0045–0048** (blind-index HMAC, cumulative SELECT
grant, `DEBT` payment method, ledger hash-chain serialization) deploy via
the migrate service per `docs/runbooks/0045-0048-prod-apply.md` — **not**
bundled in this desktop binary.

## [0.1.0] — 2026-05-27

First public release of the desktop POS bundle.

### Highlights

- **Tier-1 POS Core (Phase 1.0–1.9).** PIN-login + Verkauf cart + Kasse
  shift management + Ankauf intake + Bewertung appraisal + Lager
  inventory + Kunden CRM + Werkstatt dashboard with live ledger SSE.
- **Hardware bridge (Phase 2 Day 8, memory.md §18).** Native Rust
  commands for: TSE (Fiskaly Cloud), ZVT 1.10 card terminals over TCP,
  ESC/POS thermal printers, A4 invoice PDF via `printpdf`, image
  compression to WebP, OS print queue probe. Every command has a mock
  alternative gated by `WAREHOUSE14_MOCK_HARDWARE=1`.
- **Web-Zentrale UI (Day 14, memory.md §23).** Operator can publish
  products to the storefront, assign categories, edit SEO metadata,
  and trigger automatisch erzeugte SEO-Beschreibungen über den Fernwerkzeug-Endpunkt — all from the
  Lager detail dialog.
- **Brutal-audit fixes (memory.md §19).** Four critical findings closed:
  inventory-lock now matches `(sessionId, userId)`; per-operator
  `localStorage` keys are wiped on sign-out; `bewertung` + `ankauf`
  stores reset on sign-out; finalize requires a client-supplied
  `idempotencyKey` (UUIDv4) backed by a partial UNIQUE index.
- **Storefront catalog API (Phase 2.A, memory.md §20).** Public
  read-only endpoints under `/api/storefront/*` with strict column
  projection — `acquisition_cost_eur` and PII cannot leak. Heavy
  edge caching.
- **Fernwerkzeug-Endpunkt (Phase 2.A).** JSON-RPC 2.0 endpoint
  at `POST /api/mcp` exposing two tools: `generate_seo_description`
  (writes) and `appraise_estate_item` (read-only). Every invocation
  audited to `mcp_tool_invocations`.
- **Auto-update from GitHub Releases (Day-15, memory.md §25).**
  Tauri-plugin-updater wired with minisign signature verification.
  In-app banner polls hourly + on launch; operator clicks
  "Aktualisieren" → download + verify + relaunch.

### Database migrations

This release applies migrations 0001 → 0030. Production deployment
requires applying the three migrations that landed in this cycle:

```
0028_transactions_idempotency.sql
0029_storefront_publishing.sql
0030_mcp_tool_invocations.sql
```

### Known limitations

- No Apple Developer ID + no Microsoft Authenticode signing. Gatekeeper
  on macOS shows a one-time warning (strip with
  `sudo xattr -dr com.apple.quarantine "/Applications/Warehouse14 POS.app"`);
  Windows SmartScreen shows a "More info → Run anyway" gate on first
  install. **Auto-updates work regardless** — Tauri verifies its own
  minisign signature independently of OS code-signing.
- The bundled AI tools ship as deterministic stubs. A real
  ein Modell-Klient replaces the `runLlm()` body in a single
  follow-up patch.
- The PDF invoice prints the textual TSE block; QR raster embed lands
  once `printpdf`'s image API stabilises.

[Unreleased]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/compare/v0.1.0...v0.2.2
[0.1.0]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/releases/tag/v0.1.0
