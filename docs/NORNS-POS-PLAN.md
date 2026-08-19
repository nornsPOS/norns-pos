# NORNS POS, der Plan

## 1. Die Entscheidung

**Ein Quellbaum, zwei Rückwände, zwei Marken.** NORNS POS wird keine Kopie des Warehouse14-Baums, sondern eine zweite Edition derselben Kassen-Anwendung: derselbe Quelltext, eine austauschbare Datenquelle hinter der bereits existierenden Naht `request()`, und getrennt werden ausschliesslich Marke, Programmkennung, Signaturschlüssel und Freigabekanal.

Der Grund ist gemessen, nicht behauptet: die Händleridentität ist in jeder App genau eine Zeile, wörtlich "Warehouse 14" steht in 41 Dateien, aber die gemeinsame Fläche zwischen Kasse und Kasse beträgt rund 88.700 Zeilen plus `packages/db` mit 127 Wanderungen und dem Fiskalkern; ein Fork verdoppelt bei einem Zehntel des gemessenen Änderungstakts binnen zwölf Monaten mehr als den heutigen Quelltext, und zwar genau dort, wo zwölf offene Fiskaldefekte und die Herstellerhaftung nach § 146a Abs. 1 Satz 5 AO liegen.

Die zweite Entscheidung, und sie ist eine Produktentscheidung, keine Programmierentscheidung: **Wolken-TSE und Offline-Verkauf zugleich sind der Bruch.** NORNS POS wird als lokal arbeitende Kasse gebaut, aber "offline verkaufsfähig" darf erst im Prospekt stehen, wenn eine TSE im Gerät oder im Ladennetz sitzt. Bis dahin ist der netzlose Betrieb ausdrücklich Notbetrieb, gekennzeichnet auf dem Beleg, protokolliert im Ausfallregister, mit harter Obergrenze.

## 2. Das neue Repository

Es gibt **kein** neues Quelltext-Repository für die Anwendung. Es gibt ein neues Repository ausschliesslich für Marke, Artefakt und Auslieferung.

### 2.1 Was im Warehouse14-Baum passiert

```
warehouse14/
├─ apps/tauri-pos/                 bleibt DER EINE Baum, beide Editionen
│  ├─ src/edition/
│  │  ├─ index.ts                  wählt nach VITE_EDITION=w14|norns
│  │  ├─ w14.ts                    Name, Logo, Farben, Flächenliste
│  │  └─ norns.ts                  dito, ohne Kanalflächen
│  ├─ src/datenquelle/             ◀ DIE NAHT, neu
│  │  ├─ vertrag.ts                ApiClient, unverändert aus
│  │  │                            packages/api-client/src/client.ts:37
│  │  ├─ server/klient.ts          heutiger createApiClient plus
│  │  │                            sechs Middlewares, api-context.tsx:120
│  │  └─ lokal/                    Router, Handler, Speicher, Tor
│  ├─ src/app/chrome/surface-registry.ts   Flächen bekommen editions:[]
│  └─ src-tauri/src/commands/      fiskal.rs kette.rs lizenz.rs
│                                  fotoserver.rs sicherung.rs neu
├─ packages/fiskal-kern/           ◀ neu, treiberfrei, Phase 0
├─ packages/api-client/            bleibt, beide Editionen
├─ packages/i18n-de/               bleibt, 3.227 Zeilen, geteilt
├─ packages/ui-kit/  appointments/ bleiben, geteilt
└─ .github/workflows/release-norns.yml   eigene Kette, eigene Schlüssel
```

**Kopiert wird nichts.** Was aus Warehouse14 in die Edition NORNS geht, geht per Verweis.

> ⚠️ **Nachtrag vom 05.08.2026: dieser Absatz beschrieb den PLAN, und die
> Wirklichkeit ist einen anderen Weg gegangen.**
>
> Hier stand, die 5.002 Zeilen Kanalcode blieben „im Baum liegen und werden
> über das Flächenregister und den Editionsschalter aus dem Bündel gehalten,
> nicht gelöscht". Gemessen: 19 Wolkenflächen sind wirklich entfernt worden.
> Wer diesen Absatz las, suchte Dateien, die es nicht mehr gibt.
>
> Was stattdessen gilt, und wie jede einzelne Datei zurückzuholen ist, steht
> in [`AUSGEZOGEN-NICHTS-IST-VERLOREN.md`](AUSGEZOGEN-NICHTS-IST-VERLOREN.md).
> Der Editionsschalter existiert weiterhin und hält die verbliebenen
> Online-Wege im Motor geschlossen; er ist nur nicht mehr das einzige Mittel. Die vier Wächtertests (`fenster-wache.test.ts`, `sanfte-verbindung.test.ts`, `hinterlegter-steuerschluessel.test.ts`, `tast-auskuenfte.test.ts`) bleiben grün, weil die Dateien existieren; ergänzt wird ein fünfter Wächter, der prüft, dass im NORNS-Bündel kein Kanalpfad und kein Vorkommen von "Warehouse 14" landet.

Zwei tote Dateien (`IntakeDraftsTray.tsx` 245 Zeilen, `AppointmentsWorkspace.tsx` 9 Zeilen) werden gelöscht, nicht mitgeschleppt. Der Offline-Ausgangskorb (`src/offline`, 828 Zeilen, `outbox_mutations`, `offline-replay.ts`, `offlineQueueMiddleware`) wird in der lokalen Rückwand **nicht** eingehängt und stirbt dort ersatzlos, statt in beiden Häusern ungepflegt weiterzuübersetzen.

### 2.2 Das neue Repository `norns-pos-release`

Enthält keinen Anwendungscode. Es enthält: Marken-Zeichnungen, `tauri.norns.conf.json` mit Programmkennung `de.norns.pos`, das eigene minisign-Schlüsselpaar, `latest.json` als Freigabeverzeichnis, `manifest-zusammenfuehren.mjs` (unverändert übernommen), die Verfahrensdokumentation je Mandant, das Lizenzausgabewerkzeug und die Freigabenotizen. Das Veröffentlichungsziel zeigt bewusst nie auf Romans Kanal; die Platzhalter `__GITHUB_OWNER__` und `__GITHUB_REPO__` bleiben in der eingecheckten Konfiguration stehen und werden erst im Lauf ersetzt, genau wie heute.

### 2.3 Die Naht, und warum sie pfad-förmig bleibt

`ApiClient` hat zwei Methoden, `request` und `requestMitDateiname`, und alle 275 gemessenen Aufrufstellen laufen dort hindurch. Von 275 laufen nur 221 über die 33 Domänen-Cluster; 50 sind rohe `.request(` in den Schirmen, dazu zwei PUT auf signierte Ablage-URLs, ein `sendBeacon`, eine `EventSource`. Eine domänenförmige Schnittstelle müsste 53 Aufrufstellen umschreiben, eine pfad-förmige schreibt null um. Die lokale Rückwand ist ein Router im eigenen Prozess: Verb und Pfad hinein, dieselbe Nutzlast heraus. `requestMitDateiname` bleibt Teil des Vertrags, weil der DATEV-Dateiname `EXTF_…` daran hängt.

Vier gemessene Umgehungen der Naht werden vor Phase 2 geschlossen: die `<img src>` auf `/api/photos/<id>/thumb` in `LagerTable.tsx:51` und `CatalogGrid.tsx:42` wandern auf ein Tauri-Protokoll, die zwei direkten PUT und der `sendBeacon` gehen durch den Klienten, die `EventSource` entfällt lokal. Zusätzlich: im lokalen Bau **wirft** jeder Netzaufruf, der nicht die TSE ist, laut, statt still ins Leere zu zeigen. Eine Textsuche als Wächter genügt hier nicht, dieses Haus hat elfmal grüne Textsuchen bei lebendem Fehler gesehen.

### 2.4 Was wirklich neu gebaut wird

Der Fiskalkern ist der billige Teil. Die "dünne Orchestrierung" sind gemessen 4.984 Zeilen: `transactions-finalize.ts` 1.024, `closing-export.ts` 1.545, `closings-finalize.ts` 556, `transactions-ankauf.ts` 521, `shifts.ts` 420, `transactions-storno.ts` 351, `transactions-return.ts` 270, `transactions-tse-signature.ts` 211, `transactions-recent.ts` 86.

Und darunter liegen **32 Datenbank-Trigger** auf genau den Tabellen, die die Kasse schreibt: `transactions` 7, `products` 5, `tse_transactions` 4, `tse_signatures` 4, `daily_closings` 4, `transaction_payments` 3, `carts` 3, `ledger_events` 2. Ihre Namen sind fiskal, nicht kosmetisch: `transactions_validate_closing_day`, `transactions_validate_storno`, `transactions_validate_kyc`, `transactions_validate_sanctions`, `transactions_validate_trust_level`, `verify_transaction_balance`, `transaction_payments_validate_cash_kyc`, `daily_closings_validate_state`, `tse_signatures_immutable`, `tse_validate_transition`. SQLite kann kein plpgsql. Diese Regeln wandern deshalb **nicht** in die Handler, wo sie umgehbar sind, sondern in ein einziges Rust-Modul `regeln.rs`, das vom Schreibtor vor jedem Festschreiben durchlaufen wird, mit einer Regeltabelle und einem Test je Regel. § 13b war einmal ein Feld im Rumpf, weil die Route nichts prüfte und der Trigger die letzte Wand war. Diese Wand muss stehen bleiben.

## 3. Die Datenhaltung

**Eine Datei, `norns.db`, SQLite, alle Tabellen `STRICT`.** Die Begründung liegt im Bestand: `0003_tse_queue.sql` wurde genau deshalb `STRICT` erklärt, damit ganzzahlige Cent nicht still zu 0 verfallen.

**Ort:** maschinenbezogen, nicht benutzerbezogen. `%ProgramData%\NornsPOS` beziehungsweise `/Library/Application Support/NornsPOS`, nie `$APPDATA` im Benutzerprofil. Zwei Windows-Anmeldungen an einer Maschine ergäben sonst zwei Datenbanken und zwei Nummernreihen, und niemand merkt es eine Woche lang. Beim Start verweigert die Anwendung den Dienst, wenn der Datenort in einem bekannten Synchronisationsbaum liegt (OneDrive, iCloud, Dropbox) oder auf einem Netzpfad; SQLite über SMB zerstört die Datei, und genau das tut ein hilfsbereiter Händler mit zwei Kassen als erstes. Dazu eine Einzelinstanzsperre, sonst laufen zwei Schreibtore und zwei Zählervergaben im selben Moment.

**Vier Zugriffsschichten:**

1. Lesen über `tauri-plugin-sql` 2.4.0, liegt bereits.
2. Nichtfiskales Schreiben (Produkte, Kunden, Einstellungen, Fotoverweise) ebenso.
3. **Fiskales Schreiben ausschliesslich durch ein Rust-Kommando**, das Beleg, Positionen, Zahlungen, Belegnummer, Regelprüfung und Kettenglied in **einer** `rusqlite`-Transaktion festschreibt. Der SQL-Plugin führt Anweisungen einzeln aus JavaScript aus; eine Transaktion über mehrere `await` ist keine Transaktion, und ein Z-Bon, der auf halber Strecke abreisst, ist ein Kassenfehler mit Rechtsfolge.
4. **Systemtresor** für den 32-Byte-Hauptschlüssel des KYC-Tresors und die fiskaly-Zugangsdaten. Dazu ziehen zwei Bewohner ein, die heute unverschlüsselt im Webspeicher liegen und deren offene Sicherheitsvermerke wörtlich im Quelltext stehen: Sitzungsschlüssel und lokaler Sperrcode.

**Journalverfahren und Sicherung.** WAL wird ausdrücklich festgenagelt, und eine Sicherung entsteht **nie** als Dateikopie, sondern über `VACUUM INTO` oder die Sicherungs-API; eine Kopie von `norns.db` ohne `-wal` liefert sonst eine Sicherung, der die letzten Stunden fehlen, ohne Fehlermeldung. Beim Start läuft `PRAGMA quick_check`; schlägt sie fehl, startet die Kasse nicht in den Verkauf, exportiert aber weiter.

Die Sicherung ist **nicht** ein Paket je Abschluss. Ein Paket je Abschluss heisst: Platte stirbt um 17:00, letzter Abschluss war gestern 20:00, ein voller Handelstag ist weg, und in genau diesem Fenster leben die unsignierten Belege. Deshalb zwei Stufen:

- **Fortschreibendes Journal:** jeder fiskale Schreibvorgang wird zusätzlich als Anhängesatz an eine Journaldatei am Zweitort geschrieben, synchron, bevor der Verkauf als abgeschlossen gilt.
- **Paket je Abschluss:** DSFinV-K-CSV, DATEV-Datei, Z-Bon als PDF, Fotos des Zeitraums, Stammdatenfassung, Programmversion, Kettenkopf, und die **umschlossene Schlüsselhinterlegung**. Ohne sie ist eine Rückspielung wertlos: der Tresoreintrag liegt nicht im Datenordner, und ohne ihn ist jede KYC-Datei mathematisch unwiederbringlich und die TSE kann nicht mehr signieren. Die Hinterlegung wird beim Einrichten mit einer Händlerpassphrase umschlossen und zusätzlich als gedruckter Wiederherstellungscode ausgegeben.

Das Paket ist verschlüsselt, weil es Kundennamen und GwG-Identifizierungsdaten trägt; ein USB-Stick aus der Schublade ist sonst eine meldepflichtige Verletzung binnen 72 Stunden. Die Kasse warnt, wenn der Zweitort auf derselben Platte liegt, wenn der Datenträger seit N Tagen nicht steckte, und sie fährt **monatlich eine Selbstprüfung**: neuestes Paket in eine Wegwerf-Datenbank zurückspielen, letzten Z neu rechnen, gegen die gedruckte Zahl vergleichen, grün oder rot anzeigen. Eine einmal vom Autor bewiesene Rückspielung ist keine bewiesene Rückspielung.

**Die Hashkette.** `ledger_events` mit `prev_hash`, `row_hash` und `verify_ledger_chain()` existiert heute nur in Postgres; die vier lokalen SQLite-Tabellen haben keine. Lokal rechnet Rust den Hash vor dem Einfügen, und zwei Auslöser auf `BEFORE UPDATE` und `BEFORE DELETE` brechen jede nachträgliche Änderung ab. Das allein ist ein Tippfehlererkenner, kein Manipulationsschutz: auf einem Laden-PC ist der Händler Administrator, `DROP TABLE` feuert keinen Auslöser, und eine schlüssellose Kette lässt sich vollständig nachrechnen. Deshalb zwei Zusätze, ohne die der Umzug ein echter Rückschritt wäre:

- **HMAC statt blossem SHA-256**, Schlüssel im Systemtresor, nicht in der Datei.
- **Aussenanker:** der Kettenkopf wird bei jedem Abschluss von der TSE mitsigniert und in das Sicherungspaket verkettet. Ein Nachbau der Datei ist damit von aussen erkennbar.

**Wanderungen.** Vorwärtsgerichtet, eingebettet per `include_str!`, angewandt vor dem ersten Bildaufbau, nie zu bearbeiten. Neu gegenüber heute: eine Pflichtkopie vor jedem Lauf (`VACUUM INTO norns.db.vor-0042`, aufbewahrt bis zum nächsten erfolgreichen Start), eine Obergrenze auf `user_version`, damit eine ältere Fassung nach einer Neuinstallation ein neueres Schema **nicht** klaglos beschreibt, und eine klare Eigentümerregel: Rust wandert, der SQL-Plugin öffnet erst danach. `PRAGMA foreign_keys` ist je Verbindung, wird also auf beiden Wegen gesetzt.

**Bilder.** Produktfotos liegen als WebP unter `<Datenort>/fotos/<uuid>.webp`, komprimiert über das bestehende `commands/image.rs`. Der Dateiverweis entsteht in derselben Transaktion wie der Ankaufbeleg, denn beim Ankauf sind die Bilder Beweismittel. Ausweisbilder bleiben getrennt im verschlüsselten `kyc_vault` (AES-256-GCM, frischer Nonce je Datei, Pfadkanonisierung, Schlüssel nur im Systemtresor). Fotos reisen im Abschlusspaket mit; ohne sie gibt es nach einer Rückspielung tote Verweise.

**Zwei Kassen.** Es gibt genau zwei zulässige Antworten, und eine davon muss gewählt werden, bevor Phase 2 beginnt. Entweder steht "eine Kasse je Laden" im Prospekt, oder eine Kasse fährt ihren lokalen Router als echten Dienst im Ladennetz und die zweite ist ein dünner Klient über dieselbe Naht. Das ist der stärkste Grund für die pfad-förmige Naht, stärker als die null umgeschriebenen Aufrufstellen. Ohne Schiedsrichter verkaufen zwei Kassen dieselbe Goldkette, beide Belege sind signiert, beide unveränderbar, ein Stück fehlt, und niemand findet es hinterher.

## 4. Die TSE

### 4.1 Was rechtlich zwingend ist

- **Beginn, nicht nur Ende.** § 2 KassenSichV verlangt den Start der Transaktion unmittelbar mit Beginn des aufzeichnungspflichtigen Vorgangs, AEAO zu § 146a Nr. 2.2.2 setzt für die Aktualisierung eine Frist von 45 Sekunden. Der heutige Weg kennt nur `finalize`. Ein abgebrochener Vorgang, Kunde geht ohne zu kaufen, hinterlässt heute nichts, und genau das ist der Verkürzungspfad, den § 146a schliessen soll. Der Transaktionsbeginn wird gebaut, bevor irgendetwas anderes an der TSE angefasst wird.
- **Keine Rückdatierung, niemals.** Signaturzähler und `log.timestamp` entstehen im Moment der Signatur. Wer die Verkaufszeit in die TSE-Felder schreibt, verlässt den Formfehler und landet bei § 379 AO, im Zweifel § 370 AO.
- **Der Beleg kann nicht warten.** § 6 KassenSichV verlangt Transaktionsnummer, Seriennummer der TSE, Prüfwert und Signaturzähler. Offline existiert keiner dieser Werte. Der einzige rechtlich vorgesehene Ausgang ist AEAO Nr. 1.14.2 und 1.14.3: der Ausfall muss auf dem Beleg ersichtlich sein, durch die fehlende Transaktionsnummer oder eine sonstige eindeutige Kennzeichnung, und der Beleg entsteht trotzdem sofort. **Kein QR-Code, der aussieht wie ein echter.** Ein QR ohne Signaturwerte entspricht nicht der digitalen Schnittstelle und ist damit ein Muster, das Erfüllung vortäuscht.
- **Der Ausfall ist ein Störfall mit Behebungspflicht**, kein Betriebsmodus (AEAO Nr. 1.14.4, unverzügliche Beseitigung der Ursache). Ein Ausfallregister mit Einträgen an 240 von 250 Öffnungstagen ist kein dokumentierter Ausfall, sondern ein System, das seiner Schutzpflicht strukturell nicht nachkommt. Rechtsfolge ist nicht nur das Bussgeld, sondern § 158 in Verbindung mit § 162 AO.
- **Genau eine TSE je Aufzeichnungssystem** (AEAO Nr. 1.6), plus die elektronische Mitteilungspflicht nach § 146a Abs. 4 AO. Kein Verkauf von einem Gerät, das nicht als Client an der TSS registriert ist, und ein sichtbarer Meldeauftrag an den Händler je neuer Kasse.
- **Aufbewahrung der TSE-Protokolldaten selbst.** Der TAR-Export nach TR-03151 gehört in jedes Abschlusspaket. Kündigt der Händler das fiskaly-Abo nach drei Jahren und kommt die Prüfung im Jahr sieben, sind sonst die Kassendaten da und die Protokolle weg.

### 4.2 Was gebaut wird

**Das Ausfallregister ist der rechtlich tragende Teil, nicht die Warteschlange.** Es hält je Vorfall Beginn, Ende, Ursache, betroffene Belegnummern, Gerät, und es ist unveränderbar und exportierbar. Der Grund landet in `TSE_TA_FEHLER` der betroffenen Zeilen. DSFinV-K trennt `BON_START` und `BON_ENDE` ausdrücklich von `TSE_TA_START` und `TSE_TA_ENDE`; ein Ausfall ist darstellbar, eine erfundene Signaturzeit nicht.

**Die Warteschlange wird geheilt, aber sie ist nur Transport.** Heute trägt sie keinen echten Ausfall, aus einem strukturellen Grund: `server_transaction_id` ist Pflichtfeld und stammt einzig aus der Antwort von `transactionsApi.finalize`. Ohne Netz gibt es keine Antwort, also keine Warteschlangenzeile, also nur einen unsignierten Beleg, und `BezahlenDialog.tsx:1338` druckt `OFFLINE-<8 Zeichen>`, was keine Belegnummer ist. Lokal entsteht die Belegkennung vor jedem Netzverkehr, die Zeile kann immer eingereiht werden. Dazu drei Reparaturen, die auch nach Warehouse14 zurückfliessen:

1. **Der Deckel fällt.** Acht Versuche im Fünf-Sekunden-Takt sind nach rund 40 Sekunden verbraucht, eine fiskaly-Störung von einer Minute beerdigt heute jede eingereihte Signatur, und keine Stelle im Quelltext setzt eine `failed_terminal`-Zeile je zurück. Ersatz: wachsende Wartezeit mit Obergrenze Stunden, Versuchszahl unbegrenzt, `failed_terminal` erst nach Tagen und mit sichtbarem Rückweg.
2. **Streng FIFO je Kasse.** Wachsende Wartezeit ohne Reihenfolge verschränkt die Signaturzähler, Signatur 4711 gehört dann zu gestern 14:03 und 4700 zu heute 09:00. Der Abbau hält beim ersten Fehler an, statt an der schwierigen Zeile vorbeizulaufen.
3. **Der Storno reiht ein.** `StornoDialog.tsx:227` ruft `recordTseSignature` ohne Einreihen; der Kommentar im leeren Auffangzweig behauptet, die Warteschlange hole es nach. Sie tut es nicht.

**Die Liste der signaturpflichtigen Vorgänge wird geschrieben, bevor das Schreibtor Form annimmt.** Verkauf und Storno sind die kleinere Hälfte. § 146a Abs. 1 AO erfasst Geschäftsvorfälle **und andere Vorgänge**: der Ankauf von Altgold für 1.800 Euro bar ist die grösste Bargeldbewegung des Tages und das Kerngeschäft dieses Produkts, dazu Auszahlungen, Anzahlungen auf Werkstattaufträge, Entnahmen, Einlagen, Geldtransit zwischen Kasse, Hauptkasse und Tresor, Trainingsbuchungen. Jeder davon bekommt eine Geschäftsvorfallart und eine TSE-Transaktion.

**Weitere Riegel:**
- **Ein nicht leerer Ausfallzustand sperrt den Kassenabschluss.** Es gibt sonst nur zwei Wege und beide sind falsch: unsignierte Bons in einen geschlossenen Z nachtragen bricht die Unveränderbarkeit, sie in den nächsten Tag schieben verfälscht beide Tage. `Z_NR` war in diesem Haus schon einmal ein Datum und verbarg zehn fehlende Abschlusstage.
- **Harte Obergrenze der Ausfalldauer** mit automatischer Verkaufssperre und Eskalation, weil "unverzüglich beheben" sonst nicht behauptbar ist.
- **Die Umgebung reist im Datensatz mit.** Signaturen aus einer Test-TSS sehen im Export perfekt aus und sind fiskalisch wertlos. Gemessen am 26.07.2026 in der Produktion: `tse_clients`, `tse_signatures`, `tse_transactions` je 0 Zeilen, 53 nächtliche Archivläufe alle FAILED, Zugang nur TEST und nur auf einem Mac. Das ist der Grund für Phase minus 1.
- **Die Uhr wird bewacht.** Offline ist die Geräteuhr die einzige Zeitquelle, und sie ist stellbar. Monotone Höchstzeitmarke in der Datenbank, signierter Zeitanker aus dem letzten Onlinemoment, gemessene Drift wird mit der Zeile mitgeschrieben, und ein Rückwärtssprung hält das Kassieren an. Ein Beleg mit Zeitstempel vor dem letzten Kettenglied wird abgelehnt. Eine leere Pufferbatterie darf jedoch **nie** den Export oder das Lesen sperren, sondern nur warnen und das Kassieren stoppen.

## 5. Die Lizenz

**Verfahren: Ed25519-signierte Lizenzdatei, geprüft in Rust, verankert am fiskalen Schreibtor.**

Der öffentliche Schlüssel ist ins Programm einkompiliert, der private liegt ausschliesslich im Ausgaberepository. Die Nutzlast ist ein kompaktes JSON, kanonisiert vor der Signatur, mit: Kunde, Kassenkennung, **Installationskennung**, Ausgabedatum, Laufzeitende, Merkmale, Kulanztage. Die Prüfung sitzt nicht in der Oberfläche, sondern an derselben Stelle wie die Unveränderbarkeit: eine gepatchte Weboberfläche darf nicht verkaufen können, weil das Rust-Schreibtor den Verkauf verweigert, nicht weil eine Schaltfläche fehlt.

**Der Gerätewechsel ist die eigentliche Konstruktionsfrage, und sie wird über die Bindung gelöst, nicht über den Ablauf.** Gebunden wird an eine **Installationskennung**: eine beim ersten Start erzeugte Zufalls-UUID, gespeichert am maschinenbezogenen Datenort und Teil jedes Sicherungspakets. Nicht an einen Hardware-Fingerabdruck. Netzwerkkarte getauscht, Windows würfelt die Maschinen-GUID nach einem Upgrade neu, Mainboard ersetzt, Platte geklont: jedes davon ist normale Wartung und würde als anderes Gerät gelesen. Der Hardware-Fingerabdruck wird trotzdem mitgeschrieben, aber nur als weicher Hinweis: weicht er ab, läuft ein Notlauf über 72 Stunden mit lauter Warnung, und Norns sieht beim nächsten Kontakt, dass ein Wechsel stattfand.

Wiederausgabe ohne Netz: die Kasse zeigt die Installationskennung als kurzen Text und als QR, der Händler liest sie durch oder schickt ein Foto, Norns erzeugt eine neue Datei und liefert sie per Mail oder USB. Für Demo und Übergangszeit gibt es zusätzlich einen **eintippbaren Freischaltcode**, abgeschnittener HMAC über die Installationskennung. Kurz genug zum Diktieren heisst kryptographisch abgeschnitten, und abgeschnitten heisst brechbar. Das ist eine Geschäftsentscheidung, keine Sicherheitsmassnahme, und es wird so benannt statt so verkauft.

**Die harten Regeln, die nicht verhandelbar sind:**
- Eine abgelaufene oder ungültige Lizenz sperrt **ausschliesslich** den neuen Verkauf. Kassenabschluss, Storno, Abbau der TSE-Warteschlange, Sicherung, Lesen, Drucken und Export laufen immer. § 147 AO verlangt zehn Jahre jederzeitige Lesbarkeit, und ein Riegel, der die Vorlage bei einer Kassennachschau nach § 146b AO blockieren kann, ist ein Betriebsfehler, kein Kopierschutz. Ohne Abschluss lässt sich ausserdem kein Tag schliessen, und das wäre selbst ein Fiskaldefekt.
- Kein abrupter Stopp. Kulanzstrecke von 30 Tagen mit täglich lauter werdender Warnung, danach Nur-Lesen. Läuft die Lizenz Samstag früh ab und ist Norns nicht erreichbar, verkauft der Laden sonst auf Papier, und die Kasse ist unvollständig nach § 146 AO, ausgelöst von uns.
- Die **fiskalische** Kassenidentität (`Z_KASSE_ID`, Seriennummer des Aufzeichnungssystems, Nummernkreispräfix) ist von der kommerziellen Geräteidentität entkoppelt und überlebt jeden Hardwaretausch. Sonst beginnt die Z-Nummer nach einer Rückspielung wieder bei 1 oder die Kassenkennung wechselt mitten im Wirtschaftsjahr.
- Nach einer Rückspielung wird die Altinstanz aktiv stillgelegt: das Paket trägt eine Übernahmekennung, die alte Installation verweigert danach den Verkauf. Sonst laufen zwei Kassen mit einer Identität und die Dateizusammenführung zählt doppelt.

## 6. Die Bilder, vom Handy zum Produktbild ohne Server

**Verfahren: ein kurzlebiger HTTP-Dienst im Tauri-Prozess auf der Ladennetzadresse, mit Einmalmarke im QR-Fragment.**

Ablauf konkret:

1. Der Anwender öffnet am Produkt den Fotodialog. Rust startet über `tiny_http` (oder `axum`, im selben Prozess) einen Zuhörer auf `0.0.0.0` mit einem zufälligen hohen Port und ermittelt die eigene IPv4 im Ladennetz.
2. Die Kasse erzeugt eine Marke: 128 Bit Zufall, gebunden an genau dieses Produkt, gültig 10 Minuten, begrenzt auf eine feste Zahl Bilder, danach verbraucht.
3. Der QR trägt `http://<ip>:<port>/a#<marke>`. Die Marke steht im **Fragment**, nicht im Pfad und nicht in der Abfragezeichenkette, damit sie nicht in Protokollen landet.
4. Das Handy im selben WLAN öffnet eine minimale Ablegeseite, die vollständig im Programm eingebettet ist, ohne eine einzige Fremdquelle. Sie liest die Marke aus dem Fragment und sendet sie als Kopfzeile.
5. Bilder gehen unmittelbar an `commands/image.rs`, werden zu WebP komprimiert und in `<Datenort>/fotos/` abgelegt; der Verweis entsteht in derselben Transaktion wie der Vorgang.
6. Der Dienst endet mit dem Dialog. Kein Dauerlauscher.

**Grenzen, die zum Verfahren gehören:** das ist Klartext im Ladennetz, weil ein Zertifikat für eine wechselnde Adresse nicht zu haben ist. Produktbilder verträgt das. **Ausweisbilder nie**, der KYC-Weg bleibt am Gerät und im verschlüsselten Tresor.

**Zwei Feldzustände, an denen dieser Weg sonst still scheitert:** Klientenisolierung im Gäste-WLAN und die Windows-Firewall-Abfrage, die der Kassierer wegklickt. Beide werden **vorab geprüft**: die Kasse testet beim Öffnen des Dialogs, ob der Port erreichbar ist, und zeigt sonst eine Klartextmeldung mit der Ursache, statt einen QR anzuzeigen, der nicht funktioniert. Fällt der Weg aus, bleiben Kamera am Gerät und Dateiauswahl. Auf Android entfällt der QR-Weg ohnehin, dort ist die Kamera im Gerät.

## 7. Die Phasen

Grössenordnung in Personentagen, ein Mensch mit Agenten, gemessen am bisherigen Takt dieses Hauses.

**Phase minus 1, das Tor. 3 bis 5 Tage.**
Produktivvertrag bei fiskaly, echte TSS, echter Client, ein voller Ladentag mit **sofortiger** Signatur gegen die Produktivumgebung.
*Fertig, wenn:* `tse_clients`, `tse_transactions` und `tse_signatures` je mehr als 0 Zeilen tragen, ein Tagesabschluss mit vollständigem TSE-Block exportiert, der TAR-Export gezogen ist und die 53 fehlgeschlagenen Archivläufe grün sind. **Vor dieser Phase wird am Ausfallweg keine Zeile geschrieben.** Die schwierigste Variante eines Weges zu bauen, dessen einfachste im Betrieb noch nie funktioniert hat, ist die falsche Reihenfolge.

**Phase 0, Fiskalkern herauslösen, in Warehouse14. 8 bis 12 Tage.**
`packages/fiskal-kern`, treiberfrei, ohne Fastify und ohne Datenbanktreiber. Hinein gehen **nicht nur** die zehn Export-Umformer (`formeDaten`, `baueAlleDateien`, `zipDsfinvkBundle`, `baueBuchungsstapel`, `baueBuchungszeile`, `zuDatevZeile`, `kodiereAnsi`, `pruefeBuchungsstapel`, `buildKassenberichtCsv`, `renderKassenberichtHtml`), sondern **auch die Belegbildung**: Steueraufteilung je Rechnung gegen je Zeile, Rundung, § 25a, § 13b, Zahlungsaufteilung. Sonst ist der Kern eine Beruhigung und keine Wand, weil der Vergleich prüft, was der Kern aus gegebenen Zeilen macht, nicht welche Zeilen der Handler hineinlegt. Die Rundungsregel wird schriftlich festgelegt und durchgehend in ganzzahligen Cent gerechnet; Postgres `round(-2.5)` ergibt -3, JavaScript `Math.round(-2.5)` ergibt -2, und betroffen sind genau Stornos, Gutschriften und die Verlustverkäufe unter § 25a.
*Fertig, wenn:* für denselben echten Abschluss DSFinV-K-Paket und DATEV-Datei vor und nach dem Herauslösen prüfsummengleich sind, die Golddateien einen Storno mit Halbcent, einen § 25a-Verlustverkauf und einen Geschäftstag über die Sommerzeitumstellung enthalten, und die W14-Prüfung grün ist **mit gezählten gelaufenen Tests**, nicht nur mit grüner Farbe. Die DSFinV-K-Formatfassung ist im Paket festgenagelt.

**Phase 1, Naht und Edition. 6 bis 10 Tage.**
`datenquelle/` einziehen, Editionsschalter, Flächenregister bekommt `editions`, Marke und Programmkennung getrennt, die vier Umgehungen der Naht geschlossen.
*Fertig, wenn:* der NORNS-Bau mit `VITE_DATENQUELLE=server` gegen einen Testmandanten einen vollständigen Verkaufstag fährt; eine Textsuche nach Kanalbegriffen und nach "Warehouse 14" im **gebündelten** Ausgabeverzeichnis null Treffer liefert; `assertSurfaceRegistry()` zusätzlich auf **Lücken** in der Ziffernfolge prüft, denn `/bestellungen` sitzt auf Ziffer 3 und hinterlässt beim Entfernen ein Loch, das der heutige Wächter nicht sieht.

**Phase 2, lokale Rückwand als Gerüst. 20 bis 30 Tage.**
Router über rund 70 bis 85 Pfade, SQLite-Schema, Rust-Schreibtor mit einer Transaktion, `regeln.rs` mit allen 32 Regeln, HMAC-Kette, Belegnummer und Z-Nummer aus einem Zählertisch **in derselben Transaktion**, abgeriegelt durch eindeutige Indizes, genau wie es heute in `closings-finalize.ts:468-478` richtig steht.
*Fertig, wenn:* jede der 32 Regeln einen eigenen Test hat, der einzeln rot wird; und **jede** Sabotage einzeln rot wird, nicht als Sammelmeldung: geänderte Kettenzeile, gelöschte Kettenzeile, per `DROP TABLE` nachgebaute Kette, Belegnummernlücke, doppelte Z-Nummer, Storno über einen abgeschlossenen Tag, Uhr rückwärts.

**Phase 3, fiskaler Kern lokal. 12 bis 18 Tage.**
DSFinV-K, DATEV, Kassenbericht, Kassenbuch über den geteilten Kern. Stammdaten des Steuerpflichtigen und die vom Steuerberater vergebenen Umsatzsteuerschlüssel kommen aus einem Einrichtungsassistenten; jeder Abschluss trägt Stammdatenfassung, Programmversion und Prüfsumme des Kerns.
*Fertig, wenn:* derselbe Verkaufstag in beide Rückwände getippt DSFinV-K-Dateien liefert, die bis auf eine **vor** Phase 3 eingefrorene Liste kassenbezogener Felder byteweise gleich sind, und DATEV-Zeilen auf den Cent; unvollständige Stammdaten sperren den **Verkauf**, nicht den Abschluss und nicht den Export; eine gebrochene Kette erzeugt einen unveränderbaren Vorfallsatz und einen gekennzeichneten Export, keine Verweigerung. Der Aktualisierer verweigert den Lauf, solange ein Kassentag offen ist.

**Phase 4, TSE im Notbetrieb. 10 bis 15 Tage, plus 10 bis 15 für die Hardware-TSE.**
Transaktionsbeginn, Ausfallregister, Ausfallvermerk auf dem Beleg, FIFO-Abbau, Rückweg aus `failed_terminal`, Signaturpflicht für alle Vorgangsarten, TAR-Export im Paket.
*Fertig, wenn:* Netz 30 Minuten gezogen, 20 Belege verkauft, 3 storniert, 2 Ankäufe, 1 Geldtransit: alle tragen eine echte lokale Nummer, alle stehen im Ausfallregister, **alle Belege tragen den lesbaren Ausfallvermerk und keine erfundene Transaktionsnummer**, kein Abschluss ist möglich, solange der Rückstand steht; nach Wiederanschluss ist alles in Verkaufsreihenfolge signiert, die Kette heil, und der Nachtfall (Laden schliesst 18:00, fiskaly kommt 19:00 zurück) ist mit abgedeckt.

**Phase 5, Lizenz, Bilder, Sicherung. 10 bis 15 Tage.**
*Fertig, wenn:* ohne gültige Lizenz kein Verkauf zustande kommt, auch nicht mit gepatchter Weboberfläche, und der Umgehungsversuch bis zur Rust-Grenze dokumentiert ist; Lesen, Export, Abschluss, Storno und Warteschlangenabbau mit abgelaufener Lizenz weiterlaufen; ein Handy drei Bilder ohne Internet über den QR-Weg ablegt und die Vorabprüfung bei aktiver Klientenisolierung eine Klartextmeldung zeigt; eine Rückspielung auf leerer Maschine den letzten Abschluss auf den Cent reproduziert, **die Nummernreihen fortführt**, die Altinstanz stilllegt und ohne Schlüsselhinterlegung **laut** scheitert statt leere KYC-Sätze zu zeigen.

**Phase 6, Freigabekette und erster Laden. 5 bis 8 Tage.**
*Fertig, wenn:* signierte Pakete für Windows und beide macOS-Bauarten aus GitHub kommen, `latest.json` alle sechs Schlüssel führt, der Versionsgleichstand-Wächter grün ist (heute sagen `tauri.conf.json` und `package.json` 0.10.0, `Cargo.toml` 0.9.1), die toten Linux-Ziele und die zweite nie laufende Freigabekette in `infrastructure/ci/release.yml` entfernt sind, eine echte Maschine von 1.0.0 auf 1.0.1 aktualisiert, und ein gescheiterter Aktualisierungsversuch **sichtbar** wird statt still auf Ruhe zurückzufallen. Dazu: die Verfahrensdokumentation je Mandant ist erzeugbar, mit TSE-Art, Ausfallweg, Nummernvergabe und Sicherungsweg. Und der Meldeauftrag nach § 146a Abs. 4 AO ist als ausdruckbarer Bericht da.

**Phase 7, Android. 15 bis 25 Tage.**
Es existiert heute nichts davon: kein `gen/android`, kein Android-Abschnitt, nur das Gerüst (`crate-type` und `mobile_entry_point`). Zu bauen sind: Schlüsselablage über den Android Keystore, weil `keyring` keinen Android-Anbieter hat; Sunmi-Druck über eine JNI-Brücke; Waage über `UsbManager`; `FileProvider` statt `shell.open()`; Anmeldung über Custom Tabs statt zweitem Fenster.
*Fertig, wenn:* auf einem echten Gerät ein Verkauf über den Netzwerkdrucker Port 9100 läuft, die TSE signiert, der Schlüssel im Android Keystore liegt und die Lizenz greift. Ausdrücklich **nicht** dabei: alle CUPS-Wege, also kein USB-Bondrucker, kein Etikettendrucker über die Systemwarteschlange, keine A4-Rechnung über `lpr`. Das steht so im Prospekt oder es steht nirgends.

**Summe ohne Android: rund 75 bis 115 Personentage.** Die 40 Personentage Mehrmandantenfähigkeit stehen daneben, nicht darin.

## 8. Die fünf grössten Risiken

**1. Wolken-TSE plus Offline-Versprechen.** Solange die Signatur nachgeholt wird, ist der Ausfall der Regelfall und nicht die Ausnahme, und die 45-Sekunden-Frist ist arithmetisch unerfüllbar. Rechtsfolge ist § 379 AO plus Hinzuschätzung, und sie trifft den Händler, während unser eigenes Architekturpapier belegt, dass wir es so geplant haben.
*Gegenmassnahme:* das Wort "offline" fällt aus dem Prospekt, bis eine TSE im Gerät oder im Ladennetz sitzt. Bis dahin heisst der Modus **Notbetrieb**, im Code, in der Oberfläche, im Vertrag. Ausfallregister mit harter Obergrenze und automatischer Verkaufssperre. Die Hardware-TSE bekommt einen eigenen Beschaffungs- und Prüfweg vor dem ersten Laden, nicht hinter Phase 7.

**2. Zwei Wahrheiten in der Zeilenbildung.** Der geteilte Kern hält die Umformung gleich, aber nicht die Zeilen, die hineingehen. Postgres und SQLite sind in genau den Punkten uneins, die zählen: `NULLS NOT DISTINCT` gibt es in SQLite nicht, Rundung negativer Halbcents läuft auseinander, `timestamptz` gegen Text. Und der Vergleich prüft Gleichheit, nicht Richtigkeit: ein Betrag, der in beiden Bauten gleich falsch ist, fällt keinem Vergleich auf.
*Gegenmassnahme:* Belegbildung in Phase 0 mit in den Kern, ganzzahlige Cent überall, schriftliche Rundungsregel, Golddateien mit Pflichtfällen (Storno mit Halbcent, § 25a-Verlust, Sommerzeitwechsel, gemischte Steuersätze, § 13b), und die 32 Regeln in **einem** geprüften Rust-Modul statt verstreut in Handlern.

**3. Datenverlust am ersten Samstag.** Der Systemtresor fährt bei keiner Ordnerkopie mit, ein Paket je Abschluss verliert einen ganzen Handelstag, WAL macht die Dateikopie still unvollständig, und `$APPDATA` in einem gespiegelten Profil zerstört die Datenbank.
*Gegenmassnahme:* Schlüsselhinterlegung im Sicherungspaket plus gedruckter Wiederherstellungscode, fortschreibendes Journal statt nur Abschlusspaket, `VACUUM INTO` statt Dateikopie, maschinenbezogener Datenort, Einzelinstanzsperre, `quick_check` beim Start, Startverweigerung bei Netzpfad oder Synchronisationsbaum, monatliche selbsttätige Rückspielprobe.

**4. Die Naht ist pfad-förmig, und Typen schützen sie nicht.** Rund 70 bis 85 Pfade sind nachzubilden, die Antwortformen sind teils aus den TypeBox-Schemata importiert und teils von Hand nachgebildet, und die 50 rohen `.request<T>`-Aufrufe erklären ihr `T` selbst. Eine lokale Rückwand, die ein Feld anders benennt, übersetzt fehlerfrei und fällt im Laden auf. Dieselbe Klasse wie rohes SQL, das der Typprüfer nicht sieht. Verschärfend: der Vertragstest gegen beide Rückwände braucht Fastify plus Postgres plus 128 Wanderungen.
*Gegenmassnahme:* weil beide Rückwände im **selben** Baum liegen, läuft der Vertragstest in der bestehenden CI mit echter Datenbank, ohne aufgezeichnete Antworten, die still altern. Zusätzlich ein Wächter, der die Antwortformen beider Rückwände gegen dieselben TypeBox-Schemata prüft, und ein Laufzeitwächter, der im lokalen Bau jeden Netzaufruf ausser der TSE laut wirft.

**5. Zwei Kassen ohne Schiedsrichter.** 35 Aufrufstellen auf `reserve` und `release` existieren nur, weil der Bestand geteilt ist, und der Bestand dieses Hauses ist seriell: jedes Stück existiert genau einmal. Ohne Server verkauft niemand dieselbe Kette zweimal absichtlich, aber niemand verhindert es und niemand findet es hinterher. Dazu: Uhrenversatz zwischen zwei Rechnern ohne Domäne, und eine dateibasierte DATEV-Zusammenführung, die vergessen wird und dann eine Datei erzeugt, die vollständig aussieht und zu niedrig ist. Das ist die Klasse "erfinde, wenn nicht eingerichtet" in neuem Gewand.
*Gegenmassnahme:* eine der beiden Antworten wird vor Phase 2 gewählt und im Prospekt festgeschrieben. Wenn Zusammenführung, dann mit Kassenverzeichnis, Idempotenzschlüssel je Abschluss, und einer Sperre: der Export läuft nicht, solange nicht jede eingetragene Kasse für jeden Tag des Zeitraums geliefert hat.

## 9. Was Basel entscheiden muss, bevor die erste Zeile geschrieben wird

1. **Ein Baum mit zwei Editionen, oder zwei Häuser.** Der Plan oben nimmt einen Baum. Ein zweiter Baum kostet dauerhaft rund 115.000 Zeilen doppelte Pflege bei einem gemessenen Anlass von 41 Dateien.
2. **Hardware-TSE: ja, und wann.** Davon hängt ab, ob NORNS POS als offline arbeitende Kasse verkauft werden darf oder als Kasse mit dokumentiertem Notbetrieb. Es ist die einzige Entscheidung, aus der alle fiskalischen Bruchstellen folgen.
3. **Eine Kasse je Laden, oder ein Schiedsrichter im Ladennetz.** Beides ist vertretbar, aber es muss im Prospekt stehen, bevor der Code die Antwort implizit gibt.
4. **Lebt die Server-Rückwand in NORNS weiter, oder stirbt sie nach Phase 3.** Sie ist das zentrale Prüfmittel des Plans und zugleich eine dritte Bauform, die gepflegt werden will.
5. **Auslagerung der Sicherung ausser Haus.** Offline rotierende Datenträger sind die beste lokale Antwort, aber ein Erpressungstrojaner nimmt eine dauerhaft eingehängte NAS-Freigabe mit. Die beste Antwort ist Auslagerung, und sie berührt Basels Regel. Das entscheidet Basel, nicht der Plan.
6. **Lizenzhärte.** Zahl der Kulanztage, und ob eine abgelaufene Lizenz das Kassieren überhaupt je sperren soll. Lesen und Export sind nicht verhandelbar.
7. **Zielgerät zuerst: Windows-Laden-PC oder Sunmi-Android.** Der Android-Weg ist eine eigene Phase mit eigenem Druckweg und eigener Schlüsselablage, nicht ein Bauziel mehr.
8. **Wandert die Warehouse14-Kasse ebenfalls auf die lokale Rückwand, oder bleibt Roman auf dem Server.** Davon hängt ab, ob der Offline-Ausgangskorb in W14 gepflegt bleibt oder dort ebenfalls stirbt.
9. **Wer schuldet die Verfahrensdokumentation.** Sie schuldet rechtlich der Händler. Wenn Norns sie nicht je Mandant erzeugbar liefert, verkauft Norns ein Produkt, dessen Kunden eine Pflicht haben, die sie nicht erfüllen können.
10. **Die bereits gedruckten `OFFLINE-` Belege bei Roman.** Das ist kein künftiger Entwurfsmangel, sondern ein bestehender Zustand. Betroffener Zeitraum feststellen, in die Verfahrensdokumentation aufnehmen, und die Frage einer Berichtigung nach § 153 AO gehört vor einen Steuerberater, nicht in eine Phasenliste.