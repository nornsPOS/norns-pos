# Anfrage an Steuerberater / Geldwäsche-Beauftragten

## warehouse14 — Konfiguration der Compliance-Parameter (GwG · KassenSichV · UStG)

**Absender:** warehouse14 (Roman Grützner), Schorndorf
**Datum:** 07.06.2026
**Betreff:** Bestätigung der gesetzlichen Schwellenwerte und Verfahren vor Inbetriebnahme unseres Kassen- und Warenwirtschaftssystems

---

### Hintergrund

`warehouse14` ist unser neues Kassen- und Warenwirtschaftssystem für den **An- und Verkauf von Edelmetallen, Münzen, Schmuck, Uhren und Antiquitäten** (Ladengeschäft Schorndorf + Online). Das System ist nach **GoBD, KassenSichV** (TSE über Fiskaly), **GwG** und **DSGVO** ausgelegt; die fiskalisch relevanten Beträge werden zentnergenau geführt und über eine zertifizierte TSE signiert.

Vor der Inbetriebnahme bitten wir Sie, die folgenden **gesetzlich getriebenen Parameter** zu bestätigen bzw. festzulegen, damit das System rechtskonform konfiguriert ist. Zu jedem Punkt nennen wir unseren **aktuellen Stand** und die **konkrete Entscheidung**, die wir von Ihnen benötigen. Die kritischen Punkte sind **1 (b), 2 (a)+(b) und 4**.

---

### 1. Identifizierungs-Schwellenwert (§ 10 GwG)

**Aktueller Stand / unser Verständnis:** Für **Edelmetalle** greift die Identifizierungs-/Sorgfaltspflicht bereits ab **2.000 € (bar)**; für die übrigen hochwertigen Güter i. S. d. § 1 Abs. 10 GwG (Schmuck, Uhren, Antiquitäten, Sammlermünzen) gilt die Schwelle von **10.000 €**. Das System hat derzeit **einen** konfigurierbaren Schwellenwert (Standard **2.000 €**) und **erzwingt** die KYC-Erfassung serverseitig, sobald ein Einzelvorgang die Schwelle erreicht.

**Bitte um Entscheidung:**
- **(a)** Bestätigen Sie **2.000 €** für Edelmetalle.
- **(b) (kritisch)** Sollen wir **warengruppenabhängig** unterscheiden — **2.000 €** für Edelmetalle, **10.000 €** für Schmuck/Uhren/Antiquitäten/Sammlermünzen? Falls ja: nach welcher **Zuordnung** zählt ein Artikel als „Edelmetall" (z. B. Barren/Anlagemünzen vs. Sammlermünzen)?
- **(c)** Gilt der Schwellenwert je Vorgang **sowohl für Ankauf als auch für Verkauf** in gleicher Höhe?

### 2. Zusammenhängende Transaktionen / „Smurfing" (§ 10 Abs. 3 Nr. 2 GwG)

**Aktueller Stand:** Die Sorgfaltspflicht greift auch, wenn mehrere Vorgänge je **unter** der Schwelle bleiben, in der **Summe** aber die Schwelle erreichen und Anhaltspunkte für einen Zusammenhang bestehen. Unser System **erkennt** dieses Muster (Summe der Ankäufe eines Kunden in einem rollierenden Zeitfenster), **dokumentiert** es und **weist den Mitarbeiter aktiv darauf hin**. Eine **harte Sperre** des Einzelvorgangs erfolgt in diesem Aggregat-Fall derzeit **nicht** (beim Einzelvorgang ≥ Schwelle hingegen schon).

**Bitte um Entscheidung:**
- **(a) Konkrete Parameter für unsere Risikoanalyse:** **Zeitfenster** (z. B. 30 / 90 / 180 Tage?), **Mindestanzahl** der Vorgänge, und **Summenschwelle** (= 2.000 €?). Welche Werte sollen wir hinterlegen?
- **(b) (kritisch) Verfahrensweise:** Soll das System bei Erreichen der **Summen-Schwelle** die Auszahlung **hart blockieren**, bis die Identifizierung erfasst ist — oder genügt **Erkennen + Dokumentieren + ggf. Verdachtsmeldung**?

### 3. Verdachtsmeldung (§ 43 GwG) — betragsunabhängig

**Unser Verständnis:** Die Meldepflicht an die FIU besteht **unabhängig vom Betrag** und der Zahlungsart (also auch **unter** 2.000 €).

**Bitte um Bestätigung / Vorgabe:**
- **(a)** Bestätigen Sie den betragsunabhängigen Charakter der Meldepflicht.
- **(b)** Soll bei **jedem Ankauf** — unabhängig vom Betrag — eine **Identifizierung des Verkäufers** erfolgen (unsere bisherige, konservative Politik, auch zur Vermeidung der Hehlerei nach § 259 StGB), oder erst **ab 2.000 €** bzw. im Verdachtsfall?
- **(c)** Wer ist **Geldwäsche-Beauftragter**, und wie soll der Melde-Workflow technisch unterstützt werden (Vorbefüllung der Meldung, Fristen)?

### 4. Steuerliche Behandlung / Differenzbesteuerung (§ 25a, § 25c UStG)

**Aktueller Stand:** Das System ordnet jedem Artikel eine **Steuerbehandlung** über eine **feste Tabelle** zu (deterministisch, **kein** KI-Verfahren, nur durch Admin änderbar): u. a. **Differenzbesteuerung (§ 25a)** für Gebraucht-/Sammlerware, **Regelbesteuerung (19 %)**, sowie **Anlagegold (§ 25c, steuerfrei)**. Roh-Edelmetalle sind von § 25a ausgenommen.

**Bitte um Bestätigung der Zuordnungsmatrix:**
- Welche Warengruppen → **§ 25a Differenzbesteuerung**, welche → **Regelbesteuerung 19 %**, welche → **§ 25c Anlagegold (steuerfrei)**?
- Behandlung von **Sammlermünzen** und **Silbermünzen** (Sonderregelungen / Einfuhr)?

### 5. Exporte für Finanzbuchhaltung & Betriebsprüfung

**Aktueller Stand:** Das System exportiert **DATEV** (EXTF / Buchungsstapel) und den täglichen **Kassenbericht**. Die Einzelaufzeichnungen werden **GoBD-konform unveränderbar** (kryptografische Hash-Kette) sowie über die zertifizierte **TSE / KassenSichV** (§ 146a AO) aufgezeichnet; ein **DSFinV-K-Export** (DFKA-Taxonomie, für Kassen-Nachschau / Z3-Datenträgerüberlassung) steht als lokaler Download bereit. *(Hinweis: der frühere Begriff „GDPdU" wurde 2015 durch „GoBD" abgelöst und wird daher nicht mehr verwendet.)*

**Bitte um Vorgabe:**
- **DATEV:** Kontenrahmen (**SKR03 / SKR04?**), **Berater-/Mandantennummer**, Sach-/Gegenkonten für An-/Verkauf, Kasse und Differenzbesteuerung.
- Gewünschtes **Export-Intervall** (täglich / monatlich) und Übermittlungsweg.
- Genügen die o. g. Formate für Ihre Buchführung und eine etwaige **Kassen-Nachschau / Betriebsprüfung**?

### 6. Aufbewahrung & DSGVO

**Aktueller Stand:** Belege/Kassendaten **10 Jahre** (GoBD / AO); KYC-/Ausweisdaten nach GwG, danach Löschung.

**Bitte um Bestätigung:** Aufbewahrungsfristen für **KYC-/Ausweiskopien** (§ 8 GwG — i. d. R. **5 Jahre**) gegenüber steuerlichen Belegen (**10 Jahre**), sowie der korrekte Zeitpunkt der **DSGVO-Löschung**.

---

Gerne stellen wir Ihnen die konkreten **Eingabemasken / einen Testzugang** bereit oder besprechen die Punkte in einem kurzen Termin.

Mit freundlichen Grüßen
**Roman Grützner — warehouse14**, Schorndorf
