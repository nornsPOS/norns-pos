<!--
  Verfahrensdokumentation für das Kassensystem (GoBD Rz. 151-155).
  Zur Vorlage bei einer Kassen-Nachschau (§146b AO). Vom Steuerberater prüfen
  und freigeben lassen; danach als PDF auf einem vorbereiteten USB-Stick
  bereithalten. Erstellt 2026-07-13, Stand des Systems auf dem Prüfungstag ist
  maßgeblich.
-->

# Verfahrensdokumentation — Kassensystem Warehouse 14

Diese Dokumentation beschreibt, wie das Kassensystem Belege erzeugt, fiskalisch sichert und für die Finanzverwaltung bereitstellt. Sie ist für eine unangekündigte Kassen-Nachschau nach §146b AO gedacht und erfüllt die Anforderung der GoBD an eine nachvollziehbare, prüfbare Verfahrensbeschreibung. **Vor Verwendung durch den Steuerberater prüfen und freigeben lassen.**

## 1. System und Rechtsrahmen

- **Kassensystem:** Warehouse 14 POS (Desktop-Kasse, ein Standort). Ein zentraler Server (Cloud-Backend) hält die fiskalischen Aufzeichnungen; die Kasse ist der Client.
- **TSE:** zertifizierte Technische Sicherheitseinrichtung über Fiskaly SIGN DE (Cloud-TSE), Signaturalgorithmus `ecdsa-plain-SHA256`. Jeder aufzeichnungspflichtige Vorgang (Verkauf UND Ankauf) wird TSE-signiert (KassenSichV §146a).
- **Format der digitalen Schnittstelle:** DSFinV-K (DFKA-Taxonomie-Kern) zur Datenträgerüberlassung; zusätzlich DATEV EXTF (Buchungsstapel) und der tägliche Kassenbericht.
- **Aufbewahrung:** alle fiskalischen Aufzeichnungen 10 Jahre, unveränderbar (GoBD §147 AO).

## 2. Belegausgabe (§146a Abs. 2 AO)

- Jeder Verkauf erzeugt einen Kassenbeleg mit Shop-Name und Anschrift, USt-IdNr., Beleg-Nummer, Datum/Uhrzeit (Berliner Zeit), Positionen mit USt-Satz, Summen, Zahlart und dem vollständigen TSE-Block (Signaturzähler, Transaktionsnummer, Signatur, QR-Code).
- Jeder Ankauf erzeugt einen **Ankaufbeleg**: er weist keine Umsatzsteuer aus (der Ankauf von einer Privatperson ist kein steuerbarer Umsatz; die Besteuerung erfolgt beim Wiederverkauf unter §25a UStG Differenzbesteuerung), nennt den Verkäufer, führt die Auszahlung und ebenfalls den vollständigen TSE-Block. Der Ankaufbeleg ist über die Kasse jederzeit nachdruckbar.
- Der Beleg wird nie mit einer leeren oder erfundenen USt-IdNr. gedruckt: fehlt die USt-IdNr. des Ladens in den Einstellungen, sperrt das System den Druck mit einem Hinweis.

## 3. Unveränderbarkeit und Vollständigkeit (GoBD)

- **Einzelaufzeichnung:** jeder Vorgang wird einzeln als Transaktion gespeichert, nicht verdichtet.
- **Manipulationssicherheit:** die Buchungskette (`ledger_events`) trägt je Zeile einen SHA-256-Hash über die Vorzeile (Hash-Chain). Der Trigger, der die Hashes berechnet, gehört einer eigenen Datenbankrolle und kann von der Anwendung nicht geändert oder umgangen werden. Ein Prüfwerkzeug (`verify_ledger_chain`) meldet den ersten Bruch der Kette.
- **Kein Löschen fiskalischer Daten:** die Anwendungsrolle der Datenbank hat auf `transactions`, `ledger_events`, `audit_log`, `tse_transactions` und `tse_signatures` **kein Löschrecht**. TSE-Signaturzeilen sind zusätzlich per Trigger gegen Änderung und Löschung gesperrt.
- **Storno:** eine Korrektur erfolgt ausschließlich als eigener Storno-Vorgang (mit eigener TSE-Signatur), nie durch Änderung des Originals.

## 4. Tagesabschluss (Z-Bon)

- Der Kassensturz erfolgt je Geschäftstag genau einmal; der abgeschlossene Tag (`FINALIZED`) ist die Grundlage der Exporte. Ein zweiter Abschluss desselben Tages wird verhindert.
- Der Berliner Geschäftstag ist maßgeblich (ein Verkauf kurz nach Mitternacht zählt zum korrekten Tag).

## 5. Datenträgerüberlassung bei der Kassen-Nachschau (§146b AO)

Auf Verlangen des Prüfers stellt das System die Kassendaten **auf Knopfdruck** bereit. In der Kasse unter **Steuer-Export**:

1. **DSFinV-K** je Tagesabschluss als ZIP-Paket (Belege, Positionen, USt, Zahlungen, TSE, index.xml). Auf den vom Prüfer mitgebrachten USB-Stick speichern.
2. **DATEV** (EXTF Buchungsstapel) je Tag als CSV.
3. **Kassenbericht** (KassenSichV) je Tag als CSV.
4. Diese Verfahrensdokumentation als PDF.

Der Zugriff auf die Exporte ist auf Inhaber und Steuerberater beschränkt und mit einer PIN-Bestätigung (Step-up) gesichert.

**Hinweis zum Umfang:** der DSFinV-K-Export ist ein getreuer **Kern-Export** (DFKA-Taxonomie), kein zertifizierter. Vor einer echten Prüfung mit dem amtlichen DSFinV-K-Prüftool und dem Steuerberater abgleichen. Der vollständige GDPdU/GoBD-Betriebsprüfungs-Datenträger ist ein separates, umfangreicheres Format.

## 6. Checkliste für den Prüfungstag

- [ ] Kasse ist eingeschaltet und angemeldet.
- [ ] USB-Stick des Prüfers bereit; unter Steuer-Export den benötigten Zeitraum tageweise als DSFinV-K speichern (bei einem längeren Zeitraum jeden Tag einzeln, bis ein Zeitraum-Export verfügbar ist).
- [ ] Diese Verfahrensdokumentation als PDF beilegen.
- [ ] Bei Fragen zur TSE: Fiskaly-Zertifikat und Zertifikatsstatus liegen im System (Steuer-Export zeigt je Tag „alles signiert" oder die Lücke).
- [ ] Steuerberater informieren.

## 7. Offene Punkte (vor der Freigabe mit dem Steuerberater klären)

- Bestätigung der DSFinV-K-Feldbelegung (`GV_TYP`, `BON_TYP`, DATEV-Spaltenpositionen) gegen die verbindliche amtliche Spezifikation (siehe `docs/fiscal-export-review-2026-07-08.md`, Punkte B1 bis B4).
- Ein **Zeitraum-Export** (mehrere Tage in einem Bündel) statt tageweise, sowie der vollständige GoBD/GDPdU-Datenträger, sind als Erweiterung vorgesehen.
- Ob §10 GwG (Identifizierung) und §15 (PEP) über das jetzige Maß hinaus serverseitig hart erzwungen werden müssen (aktuell im Client durchgesetzt und protokolliert).
