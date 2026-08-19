# Rechnungswesen-Recherche vom 19.08.2026

Zwei Netzrecherchen der Vermessungsflotte, Quellen je Befund. Grundlage
fuer die amtliche A4-Rechnung (Lexware-Klasse) und die E-Rechnungs-Frage.

## Die amtliche Rechnung (Lexware, § 14 UStG, E-Rechnung)

### Pflichtangaben nach § 14 Abs. 4 UStG (vollstaendige Liste)

§ 14 Abs. 4 UStG verlangt: 1) vollstaendiger Name und Anschrift von leistendem Unternehmer UND Leistungsempfaenger, 2) Steuernummer ODER USt-IdNr des Leistenden, 3) Ausstellungsdatum, 4) fortlaufende, einmalig vergebene Rechnungsnummer, 5) Menge und Art (handelsuebliche Bezeichnung) der Gegenstaende bzw. Umfang und Art der Leistung, 6) Zeitpunkt der Lieferung oder Leistung (Monatsangabe genuegt), 7) nach Steuersaetzen und Steuerbefreiungen aufgeschluesseltes Entgelt plus jede im Voraus vereinbarte Entgeltminderung (Skonto, Rabatt), 8) Steuersatz und Steuerbetrag oder bei Steuerbefreiung ein Hinweis darauf, 9) bei Werklieferungen an Privatpersonen Hinweis auf die zweijaehrige Aufbewahrungspflicht des Empfaengers, 10) die Angabe 'Gutschrift' bei Abrechnung durch den Leistungsempfaenger. Fehlt eine Angabe, verliert der Empfaenger den Vorsteuerabzug bis zur Berichtigung. Quellen: https://www.gesetze-im-internet.de/ustg_1980/__14.html und https://www.lexware.de/wissen/unternehmerlexikon/paragraph-14-ustg/

**Folge fuer Norns:** Rechnungsmodell mit genau diesen 10 Feldern als Pflichtfelder modellieren; Validierung vor PDF-Erzeugung, Rechnungsnummer als lueckenlos fortlaufende Serie pro Mandant.

### Kleinbetragsrechnung bis 250 Euro (§ 33 UStDV) - POS-relevant

Fuer Rechnungen bis 250 Euro brutto genuegen: Name/Anschrift des Leistenden, Ausstellungsdatum, Menge und Art, Bruttoentgelt sowie Steuersatz (oder Hinweis auf Steuerbefreiung). Kein Empfaengername, keine Rechnungsnummer, kein getrennter Steuerbetrag noetig. Kleinbetragsrechnungen sind zudem dauerhaft von der E-Rechnungspflicht ausgenommen; massgeblich ist der Gesamtbetrag der Rechnung, nicht die Einzelposition. Quellen: https://steuer-erklaerer.de/gesetzliche-pflichtangaben-auf-rechnungen/ und https://www.haufe.de/steuern/gesetzgebung-politik/elektronische-rechnung-wird-pflicht-e-rechnung-im-ueberblick_168_605558.html

**Folge fuer Norns:** POS-Bons bis 250 Euro als Kleinbetragsrechnung behandeln (kein E-Rechnungszwang); ab 250,01 Euro und B2B-Kunde den Wechsel in die volle Rechnung mit allen § 14-Feldern erzwingen.

### Kleinunternehmer-Hinweis ab 2025: Umsaetze sind 'steuerfrei'

Seit 1.1.2025 (JStG 2024) gilt § 19 UStG neu: Grenzen 25.000 Euro Vorjahr / 100.000 Euro laufendes Jahr (Nettobetraege), Umsaetze sind echt steuerfrei statt 'Steuer wird nicht erhoben'. Die Rechnung darf keine USt ausweisen und braucht einen eindeutigen Hinweis auf die Steuerbefreiung. Gesetzlich ist kein exakter Wortlaut vorgeschrieben; gaengige Formulierungen: 'Kein Ausweis der Umsatzsteuer aufgrund der Anwendung der Kleinunternehmerregelung gem. § 19 UStG' oder 'Als Kleinunternehmer im Sinne von § 19 UStG wird keine Umsatzsteuer berechnet.' Nach § 34a UStDV gilt fuer Kleinunternehmer ein reduzierter Pflichtangaben-Katalog. Quellen: https://www.lexware.de/wissen/buchhaltung-finanzen/kleinunternehmerregelung/ und https://selbststaendigkeit.de/buchhaltung-fuer-gruender/kleinunternehmerregelung-19-ustg-formulierung/

**Folge fuer Norns:** Mandanten-Flag 'Kleinunternehmer': USt-Spalten ausblenden, Steuerbetrag 0, Pflichttext als konfigurierbaren Baustein mit obigem Default-Wortlaut rendern.

### Differenzbesteuerung § 25a: exakter Pflichtwortlaut nach § 14a Abs. 6 UStG

Bei Differenzbesteuerung muss die Rechnung je nach Ware exakt eine dieser Angaben tragen: 'Gebrauchtgegenstaende/Sonderregelung', 'Kunstgegenstaende/Sonderregelung' oder 'Sammlungsstuecke und Antiquitaeten/Sonderregelung' (§ 14a Abs. 6 UStG, gesetzlich fixierter Wortlaut). Die Rechnung weist KEINE Umsatzsteuer und KEINEN Steuersatz aus (§ 14a Abs. 6 Satz 2); der Kaeufer hat keinen Vorsteuerabzug. Alle uebrigen § 14 Abs. 4-Angaben bleiben Pflicht, nur Steuerbetrag und Steuersatz entfallen. Fuer Reiseleistungen gilt analog 'Sonderregelung fuer Reisebueros'. Quellen: https://www.gesetze-im-internet.de/ustg_1980/__14a.html und https://onlinebilanz.de/differenzbesteuerung-rechnung-schreiben/

**Folge fuer Norns:** Pro Position oder pro Beleg einen Besteuerungsmodus (Regel, Kleinunternehmer, Differenz § 25a) fuehren; im § 25a-Modus Steuerzeilen unterdruecken und den passenden der drei Wortlaute automatisch waehlen (Warenkategorie am Artikel).

### Weitere § 14a-Sonderhinweise (Gutschrift, Reverse Charge)

§ 14a UStG verlangt zusaetzlich: die Angabe 'Gutschrift' bei Selbstabrechnung, die Angabe 'Steuerschuldnerschaft des Leistungsempfaengers' bei Reverse Charge (§ 13b, auch grenzueberschreitend, dann mit USt-IdNr beider Parteien). Quelle: https://www.gesetze-im-internet.de/ustg_1980/__14a.html

**Folge fuer Norns:** Diese Hinweistexte als feste, nicht frei editierbare Textbausteine hinterlegen, da der Wortlaut gesetzlich vorgegeben ist.

### DIN 5008 Layout-Masse (Basis der Lexware-Vorlagen)

DIN 5008 Form B (Standard fuer Briefkopf-Layouts): Briefkopf 45 mm hoch; Zusatz- und Vermerkzone (Absenderzeile fuers Fenster) ab 45 mm von oben, 25 mm von links, 17,7 mm hoch, 80 mm breit; Anschriftzone ab 62,7 mm von oben, 27,3 mm hoch, 80 mm breit (Form A: Briefkopf 27 mm, Zusatzzone ab 27 mm, Anschrift ab 44,7 mm). Infoblock rechts ab 125 mm von links (Form B ab 50 mm von oben), Breite max. 75 mm, empfohlen 65 mm. Falzmarken Form A bei 87 und 192 mm, Form B bei 105 und 210 mm; Lochmarke bei 148,5 mm. Seitenraender links 25 mm, rechts 20 mm. Quelle: https://leonrenner.com/din-5008-geschaeftsbrief/

**Folge fuer Norns:** PDF-Vorlage auf Form B auslegen (Adresse sitzt im Fensterumschlag DL), Infoblock rechts mit Rechnungsnummer, Kundennummer, Datum, Ansprechpartner; Falzmarken bei 105/210 mm optional einzeichnen.

### Lexware Office Layout-Konventionen (Referenz fuer eigenes Design)

Lexware Office bietet 5 vordefinierte Basislayouts; Absenderadresse optional als Zeile im Adressfeld ('Absenderadresse im Adressfeld drucken'); Falzmarken zuschaltbar; Seitenzahlen in 3 Positionen (Fusszeile mittig, Fusszeile rechts, Inhaltsbereich); 6 Fusszeilen-Layouts mit bis zu 2 Bankverbindungen, Firmenzusaetzen (Handelsregisternummer, Geschaeftsfuehrung) und Firmenadresse; Logo max. 2 MB JPEG/PNG; alternativ komplettes Briefpapier als PDF-Upload, wobei Seite 1 fuer die erste Belegseite und Seite 2 fuer Folgeseiten dient; freie Textfelder sind NICHT platzierbar. Steuernummer bzw. USt-IdNr und Bankdaten stehen konventionell in der Fusszeile. Quellen: https://help.lexware.de/de-form/articles/548055-wie-bearbeite-ich-mein-drucklayout und https://help.lexware.de/de-form/articles/548153-rechnungsvorlage-firmenlogo-und-briefpapier-anpassen

**Folge fuer Norns:** Eigene PDF-Vorlage an diesem Muster orientieren: Kopf mit Logo, Absenderzeile ueber der Anschrift, Infoblock rechts, Positionstabelle, Summenblock mit Nettosumme, USt je Satz, Bruttosumme, danach Zahlungstext, Fusszeile dreispaltig (Firma und Register, Steuer-IDs, Bank mit IBAN/BIC), Seitenzahl 'Seite x von y'.

### Zahlungsziel-Wording (Konvention)

Uebliche Formulierungen: 'Zahlbar innerhalb von 14 Tagen ohne Abzug', 'Zahlbar innerhalb von 10 Tagen unter Abzug von 3 % Skonto oder innerhalb von 30 Tagen ohne Abzug', 'Zahlbar sofort ohne Abzug'. Empfohlen wird ein kalendermaessig bestimmtes Datum ('Bitte ueberweisen Sie den Betrag bis zum 15.03.2026'), weil nur dann Verzug ohne Mahnung eintritt; ohne Vereinbarung greift die 30-Tage-Regel. Quellen: https://www.rechnung.de/ratgeber/rechnung-erstellen/zahlungsziel/ und https://paywise.de/wissen/zahlungsbedingungen-formulierung-schneller-zum-zahlungseingang/

**Folge fuer Norns:** Zahlungsbedingung als Template mit Platzhaltern (Tage, konkretes Faelligkeitsdatum, Skonto) rendern; Default 'Zahlbar innerhalb von 14 Tagen ohne Abzug bis zum {Datum}.'

### E-Rechnungspflicht 2026: Stand und Zeitplan (Wachstumschancengesetz)

Seit 1.1.2025 muessen ALLE inlaendischen B2B-Unternehmer E-Rechnungen (EN 16931) empfangen koennen - auch Kleinunternehmer. Ausstellung 2026: noch Uebergangsfrist, Papier und einfache PDF sind bis 31.12.2026 mit Zustimmung des Empfaengers zulaessig. Ab 1.1.2027 muessen Unternehmen mit Vorjahresumsatz ueber 800.000 Euro B2B-E-Rechnungen ausstellen; kleinere Unternehmen und EDI-Verfahren haben Frist bis Ende 2027. Ab 1.1.2028 gilt die Ausstellungspflicht fuer alle inlaendischen B2B-Umsaetze. Konforme Formate: XRechnung (reines XML) und ZUGFeRD ab Version 2.0.1 (hybrid PDF/A-3 plus XML), ausgenommen die Profile MINIMUM und BASIC-WL; auch Factur-X und Peppol BIS. Ausnahmen dauerhaft: Kleinbetragsrechnungen bis 250 Euro, Fahrausweise, B2C, bestimmte steuerfreie Umsaetze. Quellen: https://www.haufe.de/steuern/gesetzgebung-politik/elektronische-rechnung-wird-pflicht-e-rechnung-im-ueberblick_168_605558.html sowie https://www.datev.de/web/de/berufsgruppenuebergreifend/themen-im-fokus/e-rechnung-mit-datev/gesetzliche-regelungen und https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/steuerrecht/steuermeldungen/e-rechnungen-5864496

**Folge fuer Norns:** Jetzt ZUGFeRD-Ausgabe (Profil EN 16931) einbauen: ein Artefakt bedient Mensch (PDF) und Maschine (eingebettetes XML), erfuellt ab 2027/2028 die Pflicht und ist 2026 bereits als E-Rechnung guueltig - Zustimmungsproblematik entfaellt, da E-Rechnungen seit 2025 keine Empfaengerzustimmung mehr brauchen.

### Kleinunternehmer und E-Rechnung: dauerhaft von Ausstellungspflicht befreit

Kleinunternehmer nach § 19 UStG sind durch das JStG 2024 dauerhaft von der Pflicht befreit, E-Rechnungen auszustellen (duerfen es freiwillig); die Empfangspflicht seit 1.1.2025 gilt aber auch fuer sie. Quelle: https://www.e-rechnung.tools/ratgeber/e-rechnungspflicht

**Folge fuer Norns:** Im Kleinunternehmer-Modus E-Rechnung optional anbieten, nicht erzwingen; Empfang (Import) von XRechnung/ZUGFeRD trotzdem unterstuetzen.

### Was ein kleines Haendler-POS 2026 konkret koennen sollte

Aus der Rechtslage folgt fuer ein POS: a) Bons bis 250 Euro bleiben Kleinbetragsrechnungen ohne E-Rechnungszwang; b) fuer B2B-Kunden ueber 250 Euro muss auf Wunsch eine vollwertige Rechnung mit allen § 14-Angaben erzeugbar sein, ab 2027/2028 als E-Rechnung (XRechnung oder ZUGFeRD ab Profil EN 16931); c) der Haendler muss E-Rechnungen von Lieferanten empfangen koennen; d) bei Gebrauchtwarenhaendlern (§ 25a) darf der Beleg keine USt ausweisen und braucht den Sonderregelung-Wortlaut. Quellen: https://www.e-rechnung.tools/ratgeber/e-rechnungspflicht und https://www.haufe.de/steuern/gesetzgebung-politik/elektronische-rechnung-wird-pflicht-e-rechnung-im-ueberblick_168_605558.html

**Folge fuer Norns:** POS-Flow: Kassenbon per Default; Button 'Rechnung fuer Firmenkunden' erfasst Empfaengerdaten plus dessen E-Mail und Leitweg-/Routing-Referenz optional, erzeugt PDF mit eingebettetem ZUGFeRD-XML; Besteuerungsmodus je Mandant und Artikel.

### Lexware Public API: vorhanden, aber fuer ein POS nicht der Standardweg

Lexware Office hat eine REST Public API (Basis https://api.lexware.io, API-Key als Bearer, Limit 2 Requests pro Sekunde, 429 bei Ueberschreitung). Der Invoices-Endpunkt kann Rechnungen anlegen (Default-Status draft, optional direkt open), abrufen und als PDF rendern; E-Rechnungsprofil pro Beleg waehlbar: NONE, EN16931 (ZUGFeRD) oder XRechnung; der Files-Endpunkt liefert XRechnung als XML oder PDF, ZUGFeRD nur als PDF (XML eingebettet). Einschraenkungen: nur EUR, per API nur deutschsprachige Belege, Nummernkreis kommt aus den Lexware-Einstellungen, kein Layout-Einfluss per API, keine Abschlagsrechnungen. Quellen: https://developers.lexware.io/docs/ und https://developers.lexware.io/cookbooks/invoices/ und https://www.lexware.de/funktionen/public-api/

**Folge fuer Norns:** Integration nur anbieten, wenn der Haendler ohnehin Lexware Office nutzt (dann Belege per API pushen, Buchhaltung inklusive). Standardroute fuer das eigene Produkt: eigenes PDF plus ZUGFeRD-XML selbst erzeugen (etablierte Open-Source-Bibliotheken wie Mustangproject fuer EN 16931), da API-Limits (2 rps, EUR, kein Layout, fremder Nummernkreis) ein POS einschraenken; Lexware/DATEV-Export dann als Zusatzfeature.


## Werkzeuge aus der Gemeinde (GitHub, Stand 2026)

- **Mustangproject — reference ZUGFeRD/Factur-X/XRechnung library and validator (Java, CLI-callable)**  
  Apache-2.0, 452 stars, last push 2026-08-18 (near-daily activity). Maintained under the official ZUGFeRD GitHub org, it generates AND validates Factur-X/ZUGFeRD/XRechnung including Schematron checks, and ships a standalone CLI jar. No Node or Rust library in this list does full EN16931 Schematron va  
  Use it as the validation gate: shell out to the Mustang CLI (java -jar Mustang-CLI.jar --action validate) from a Fastify job or CI step to verify every invoice the POS emits. Optionally also use it fo

- **node-zugferd — native Node/TypeScript ZUGFeRD/Factur-X generation with PDF/A-3 embedding**  
  MIT, 70 stars, last push 2026-07-31, active TypeScript project with typed profile schemas (MINIMUM to EXTENDED, XRechnung) that generates the CII XML and embeds it into PDF/A-3. Known gap: it does not run official Schematron validation itself.  
  Best fit for direct in-process invoice generation inside the Fastify backend, paired with Mustang as the external validator. Cleanest JS-native option found for 2025-2026.

- **e-invoice-eu — EN16931 multi-format generator (Factur-X, ZUGFeRD, UBL, CII, XRechnung) for Node**  
  WTFPL license (LICENSE file confirmed), 211 stars, last push 2026-07-27, npm packages @e-invoice-eu/core and @e-invoice-eu/cli at v3.2.x published days before this research. Generates from JSON or spreadsheet mappings, usable as library, CLI, Docker service or REST API.  
  Alternative to node-zugferd when the dealer later needs XRechnung (UBL) for B2G or the 2027-2028 German B2B e-invoicing phase-in; one dependency covers all output formats.

- **escpos crate (fabienbellanger/escpos-rs) — ESC/POS receipt printing from the Tauri Rust side**  
  MIT (LICENSE file confirmed), 109 stars, last push 2026-05-26. Implements text formatting, cut, barcodes, QR codes and raster images with built-in USB (native and usbprint.sys on Windows), network, serial and file drivers — covering both macOS and Windows targets.  
  Put receipt printing in a Tauri 2 command using this crate; it removes any OS print dialog and prints directly to Epson-class receipt printers. The Tauri-specific plugins found (tauri-plugin-thermopri

- **printers crate (talesluna/rust-printers) — CUPS (macOS) and winspool (Windows) raw job submission**  
  MIT, 102 stars, last push 2026-08-18 (actively maintained). One API to enumerate system printers and send raw byte jobs via CUPS on macOS/Linux and winspool on Windows.  
  Use for label printers (price tags, storage labels) installed as system printers: render the label (ZPL, EPL or rasterized PDF bytes) and hand it to the queue from the same Tauri command layer — the m

- **node-thermal-printer (Klemen1337) — mature Node ESC/POS/Star library for the Fastify side**  
  MIT, 912 stars, last push 2026-08-18 — the most-starred and most-alive Node thermal printing library (Epson, Star, Tanca, Custom, Brother; network and USB interfaces).  
  Choose this if printing should live server-side in Fastify (shared LAN printer for several POS terminals) rather than in the Tauri client; keeps print logic next to the transaction record.

- **receiptline — receipt markdown with ESC/POS output and SVG preview**  
  Apache-2.0, 769 stars, last push 2026-07-31. OFSC standard that compiles a compact receipt markup into ESC/POS, StarPRNT or SVG/PNG.  
  Template receipts once, render the SVG in the React UI as a live preview (customer display, reprint dialog) and send the identical template to the printer — eliminates preview/print drift.

- **ReceiptPrinterEncoder (NielsLeenheer) — printer-agnostic ESC/POS and StarPRNT command encoder**  
  MIT, 331 stars, last push 2026-03-01. Pure encoder (no transport) with a large printer capability database; works in Node and in the browser (pairs with the author's WebUSB/WebSerial libs).  
  Use when you want to keep transport in Rust (escpos crate or printers crate as dumb byte pipe) but build the receipt layout in TypeScript shared between React and Fastify.

- **fiskaltrust middleware — the only actively maintained open-source KassenSichV plus DSFinV-K implementation**  
  EUPL-1.2, 17 stars, last push 2026-08-18 (daily commits). Production middleware covering TSE integration (Swissbit hardware, Swissbit Cloud, Deutsche Fiskal and more) and automatic DSFinV-K export generation, exposed over a local REST/gRPC interface.  
  Two uses: run it locally next to the POS as the fiscalization layer (Fastify talks to its REST endpoint), or mine it as the reference for correct DSFinV-K field mapping and TSE process-data formatting

- **fiskaly SDK state — all official wrappers archived, target SIGN DE V2 REST directly**  
  fiskaly-sdk-node (MIT, 7 stars) and fiskaly-kassensichv-client-node were archived in 2020; no maintained 2025-2026 Node wrapper for the current SIGN DE V2 API exists. Relevant since a fiskaly MSA (11 EUR per Kasse) is already in place for this project.  
  Do not build on the archived SDKs. Write a thin typed Fastify client against the SIGN DE V2 REST API (JWT auth, retry on 401/5xx — the exact behaviors the old SDK provided) plus the DSFinV-K API for e

- **python-dsfinvk (pretix) — production-tested DSFinV-K export writer to port or crib from**  
  Apache-2.0, 7 stars, last push 2024-08. Small but written by the pretix team and used by pretixPOS in production; models every DSFinV-K table/field and writes the CSV plus index.xml bundle.  
  The cleanest open blueprint for a Node/TypeScript DSFinV-K exporter from Postgres: mirror its record classes and column definitions rather than reverse-engineering the 100-plus-page spec.

- **opencore dsfinvk-java plus gdpdu-java — the only open-source DSFinV-K validation approach; the official Prüftool stays closed**  
  Both Apache-2.0; dsfinvk-java 7 stars (last push 2023-01), gdpdu-java 5 stars (archived 2022). gdpdu-java was explicitly written to validate DSFinV-K exports via the GoBD/GDPdU index.xml. No newer open-source alternative to the tax administration's non-public Prüftool surfaced anywhere.  
  Wrap these as a CI validation step for generated exports (stale but the format is frozen at DSFinV-K 2.3, so staleness is tolerable); additionally validate index.xml against the official GoBD XSD, whi

- **fiskaltrust interface-doc — best free documentation of DSFinV-K generation and TSE operation modes**  
  20 stars, last push 2026-02-26. Tops the GitHub topics kassensichv and dsfinv-k; contains procedural docs on DSFinV-K generation, Swissbit and cloud TSE operation modes, and receipt case mappings.  
  Read before designing the Postgres transaction schema — its receipt-case and business-transaction-type tables map one-to-one onto what DSFinV-K and the TSE process data expect, preventing costly schem

- **python-tse (bwurst) — open Swissbit hardware TSE protocol implementation**  
  LGPL-3.0, 25 stars, last push 2026-08-02 — still actively maintained. Talks to the Swissbit USB TSE without the vendor blob, documenting the raw file-system command protocol.  
  Keep as the fallback path and protocol documentation if the shop ever wants an offline hardware TSE instead of (or beside) fiskaly cloud signing — the protocol knowledge ports to a Rust implementation

- **erpnext_tse (Rocket-Quack) — the notable find from GitHub topics; Reddit yields nothing usable**  
  GPL-3.0, 8 stars, last push 2026-04-28. A current, working end-to-end KassenSichV signing integration for ERPNext POS. Meanwhile r/kassensysteme and r/selbststaendig produced no substantive threads on POS self-development or DSFinV-K in searches — the German discussion lives in the Frappe forum and   
  Use `erpnext_tse` as a compact real-world reference for TSE transaction lifecycle (start/update/finish, Kassenbeleg-V1 process data, QR receipt line) when wiring signing into the checkout flow; GPL me
