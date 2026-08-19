# Architektur-Manifest — von einem Händler zu vielen

**Stand: 26.07.2026.** Jede Zahl hier ist an der Produktion gemessen, nicht
geschätzt. Wo etwas Absicht und noch nicht Wirklichkeit ist, steht es
ausdrücklich als **ZIEL**.

> Ein Dokument, das Wünsche wie Zustände beschreibt, ist gefährlicher als
> keines: wer es in zwei Monaten liest, baut auf einer Erfindung weiter.

---

## Die vier Entscheidungen

### 1 · Eine Datenbank je Händler — GEBAUT ✅

Nicht eine geteilte Datenbank mit `tenant_id` in jeder Tabelle.

**Warum, obwohl es weniger skaliert:** Bei geteilten Tabellen genügt EIN
vergessenes `WHERE tenant_id = …`, und ein Händler sieht die Umsätze eines
anderen. Das ist das häufigste Datenleck der SaaS-Branche, und es ist ein
Anwendungsfehler — also einer, den kein Test sicher ausschliesst.

Bei einer Datenbank je Händler steht die Wand in Postgres. Ein Fehler im Code
kann sie nicht öffnen; die Rolle `t002_app` bekommt auf `warehouse14` schlicht
keine Verbindung.

**Gemessen am 26.07.2026:** der Isolationswächter prüft alle Paare in BEIDE
Richtungen und meldet „dicht". Rot/grün vorgeführt: ein Testbenutzer mit
Zugriff auf zwei Datenbanken → ROT; zurückgebaut → grün.

⚠️ Und ein Fund aus genau diesem Beweis: die ersten beiden Zusagen prüften die
ANZAHL der erreichbaren Datenbanken, nicht deren IDENTITÄT. Ein Händler, der
auf die falsche EINZELNE Datenbank zeigt — das Register `norns_control` —
galt als dicht. Dritte Zusage ergänzt.

**Der Preis, ehrlich:** mehr Verbindungen, mehr Sicherungen, mehr Wanderungen.
Siehe Punkt 2, der genau das auffängt.

**Der Gewinn im Verkaufsgespräch:** „Ihre Steuerdaten liegen in einer eigenen
Datenbank, und die Trennung ist nicht programmiert, sondern erzwungen."

---

### 2 · Ein Server, dynamische Verbindungen je Händler — ZIEL

**Heute:** `apps/api-cloud/src/plugins/db.ts:117` öffnet beim Start EINE
Verbindung aus `DATABASE_URL`. Es gibt keine Ableitung des Mandanten aus
Adresse, Kopfzeile oder Anmeldung. Ein Prozesssatz je Händler wäre die einzige
Bauform, die der Quelltext heute trägt.

**Ziel:** ein Serverprozess, der beim Eintreffen einer Anfrage den Mandanten
auflöst (`t002.api.norns.de` → `t002`) und den passenden Verbindungspool
nimmt.

⚠️ **DIE BEDINGUNG, OHNE DIE DIESER SCHRITT DIE WAND EINREISST:** jeder Pool
verbindet sich mit der ROLLE DIESES HÄNDLERS (`t002_app`) — niemals mit einer
Rolle, die alle Datenbanken sieht.

Dann bleibt die Wand, wo sie hingehört. Löst der Resolver falsch auf und
schickt Ahmeds Anfrage an Romans Pool, weist Postgres sie ab. Verbände sich
dagegen ein zentraler Benutzer mit allem, hätten wir die Wand mit eigener Hand
abgerissen und nur ihre Form behalten.

**Was das an Kapazität ändert:** bei einem Prozesssatz je Händler kostet jeder
17 Verbindungen (api-Pool 10 + worker 5 + SSE 1 + Sperre 1, aus `config/env.ts`
und `job-runner.ts` abgelesen). Bei 297 nutzbaren von 300 sind das **17
Händler**. Mit geteilten Pools in einem Prozess fällt diese Rechnung weg — die
Grenze rückt weit nach hinten.

**Gemessen, damit die Grössenordnung stimmt:** ein Mandantenstapel verbraucht
229 MB, die Maschine hat 19,5 GB frei bei einer Last von 0,09. **Nicht die
Maschine ist die Grenze, sondern die Verbindungen.**

---

### 3 · Ein Bau der Kasse für alle — ZIEL

**Heute, gemessen:**

```
apps/tauri-pos/src/main.tsx:48
  const apiBaseUrl = env.VITE_API_BASE_URL ?? 'https://api.warehouse14.de'

tauri.conf.json (Sicherheit → csp)
  connect-src 'self' https://api.warehouse14.de …
```

Die Serveradresse wird zur BAUZEIT eingesetzt, und der Einstellungsbildschirm
zeigt sie `readOnly`. Jeder Händler bräuchte damit einen eigenen, signierten,
einzeln verteilten Bau.

**Die CSP ist dabei die härtere Wand.** Selbst eine zur Laufzeit einstellbare
Adresse nützt nichts, wenn die Sicherheitsregel nur `api.warehouse14.de`
erlaubt.

**Die Lösung ist EIN Zeichen, kein Umbau:**

```
connect-src 'self' https://*.norns.de wss://*.norns.de
```

CSP kennt Platzhalter für Unterdomänen. Ein Bau, jeder künftige Händler
erreichbar, ohne die Anwendung anzufassen.

⚠️ **Ausdrücklich NICHT: die CSP zur Laufzeit ändern.** Das ist in Tauri 2
brüchig, und schlimmer: ein Mechanismus, der Sicherheitsregeln dynamisch
umschreibt, ist genau das, was ein Angreifer sucht. Der Platzhalter bleibt
statisch und auf eine Domäne begrenzt, die uns allein gehört.

**Der Rest ist klein:** beim ersten Start fragt die Kasse nach einem
Aktivierungscode, holt sich dazu ihren Servernamen und merkt ihn. Das ist eine
Bildschirmmaske und ein Nachschlagen.

---

### 4 · Unterdomänen statt Einzelbauten — ZIEL

```
t001 → api.warehouse14.de     (Bestandsinstallation, Ausnahme)
t002 → t002.api.norns.de      shop:  t002.shop.norns.de
t003 → t003.api.norns.de      shop:  t003.shop.norns.de
```

Das Register führt `api_hostname` und `shop_hostname` bereits je Mandant
(`norns_control.tenants`, 30 Spalten). Der Web-Shop wird EINMAL gebaut und
liest den Mandanten aus dem Namen.

⚠️ **Romans Eintrag steht heute auf `api.warehouse14.de`** — der Domäne des
KUNDEN, nicht unserer. Als Bestandsfall bleibt das so; jeder Neue kommt unter
`norns.de`. Sonst hinge unsere Plattform an Domänen, die uns nicht gehören.

---

## Die automatische Aufnahme — ZIEL

**Heute:** `infrastructure/norns/mandant-anlegen.sh` legt drei Rollen und eine
Datenbank an, entzieht PUBLIC das Verbindungsrecht und führt den Beweis in
beide Richtungen. Sein eigener Schlusstext nennt vier weitere Schritte, die ein
Mensch tun muss — und die compose-Vorlage, die er dort voraussetzt, **gibt es
im Verzeichnisbaum nicht**.

**Ziel:** Stripe meldet die erfolgreiche Zahlung → der Server legt Rollen,
Datenbank, Wanderungen, Registereintrag und Unterdomäne an → der Händler
bekommt eine E-Mail mit seinem Aktivierungscode.

⚠️ **Aber NICHT durch Aufrufen des Bash-Skripts aus dem Webprozess.** Das wäre
eine Einschleusungsfläche, wie sie im Lehrbuch steht. Das Skript ist im Kern
SQL; dieses SQL gehört als Transaktion in den Server, und das Skript bleibt für
die Hand.

---

## Die deutschen Pflichten, je Händler

| | Was | Wer |
|---|---|---|
| **§ 146a AO** | eigene TSE je Betrieb, nicht teilbar | Händler, wir richten ein |
| **§ 146a Abs. 4** | Meldung der Kasse ans Finanzamt | Händler |
| **§ 19 vs. Regel** | Steuermodus MIT Datum — sonst kein Verkauf | Händler nennt, wir setzen |
| **§ 25a / § 25c** | Differenz- und Anlagegoldbesteuerung | wir, je Händler geschaltet |
| **DSFinV-K** | Kassenabschluss-Export | gebaut |
| **DATEV** | Kontenrahmen, Berater-, Mandantennummer | je Händler einzustellen |
| **Art. 28 DSGVO** | Auftragsverarbeitungsvertrag | einmal je Händler |
| **§ 5 DDG** | Impressum des Händlers im Shop | Händler liefert |

⚠️ **Der Steuermodus ist der einzige, der den Verkauf ANHÄLT**, wenn er fehlt.
Am 26.07.2026 gebaut: `lib/steuermodus.ts`. Ein Kleinunternehmer, der
Umsatzsteuer ausweist, schuldet sie nach § 14c Abs. 2 UStG, ohne sie
eingenommen zu haben. Deshalb wird hier nichts vermutet.

---

## Der Geldweg — GEBAUT ✅

Der Händler hat ein EIGENES Stripe-Konto. Die Zahlung wird AUF seinem Konto
eröffnet (Kopfzeile `Stripe-Account`), Stripe zahlt unmittelbar an ihn aus, wir
entnehmen eine Vermittlungsgebühr.

**Darum braucht Norns keine BaFin-Erlaubnis.** Wer für fremde Rechnung Gelder
entgegennimmt und weiterleitet, erbringt einen Zahlungsdienst nach ZAG.

⚠️ Zwei Angaben tragen das, und sie sind unantastbar:
`fees_collector: 'stripe'` und `losses_collector: 'stripe'`. Stünde dort
`application`, hafteten wir für die Verluste des Händlers — und aus der
Vermittlung würde ein erlaubnispflichtiges Geschäft.

**Stand 26.07.2026:** Plattform `acct_1TxARr…` (DE, EUR, Connect offen,
Accounts v2 freigeschaltet). Erster Händler `acct_1TxYbN…` voll freigeschaltet,
Provision 0,5 %. Webhook mit Umfang `connect` auf
`https://api.warehouse14.de/api/webhooks/stripe`, vier Ereignisse.

⚠️ **Und trotzdem fliesst kein Geld darüber.** Die Kartenzahlung im Laden geht
über ein ZVT-Terminal und berührt Stripe nie. Bis der kartenpräsente Weg
(Stripe Terminal) in der Kasse gebaut ist, trägt das Konto nur den Web-Shop.

⚠️ **Der Webhook liest `event.account` NICHT.** Bei einem Händler folgenlos.
Beim zweiten kommen beide Ströme an derselben Adresse an, und der Code sucht
die Zahlung in genau einer Datenbank. Die des anderen findet er nicht — und
verwirft sie STILL. Bezahlte Ware, nicht ausgeliefert, kein Fehler nirgends.
**Das gehört vor den zweiten Händler behoben.**

---

## Die Reihenfolge

**Erst Roman ganz.** Kasse, Shop, Buchhaltung, DATEV, Terminal — an einem
Händler von Anfang bis Ende. Erst dann weiss man, was man verkauft, statt was
man zu verkaufen glaubt.

**Dann der eine Bau für alle.** CSP-Platzhalter, einstellbare Adresse,
Mandanten-Auflösung, compose-Vorlage. Danach ist ein neuer Händler ein Befehl.

**Dann die automatische Aufnahme.** Zahlung → Datenbank → Unterdomäne → E-Mail.

**Android zuletzt.** Die Kasse spricht heute Drucker, Waage und TSE über Rust
auf dem Schreibtisch (`tauri.conf.json`: app, dmg, nsis, deb, appimage — kein
Android). Auf Android ändert sich das alles: Bluetooth-Drucker, kein `lpr`,
andere TSE-Anbindung. Das ist eine zweite Plattform, keine Bauziel-Zeile.

> **Warum zuletzt:** eine zweite Plattform zu bauen, bevor EIN System von Ende
> zu Ende trägt, heisst zweimal dasselbe zu raten.

---

## Was heute WIRKLICH steht

| | |
|---|---|
| Mandantenwand | ✅ gebaut, in beide Richtungen bewiesen |
| Mandantenregister | ✅ `norns_control.tenants`, 30 Spalten |
| Wächter im Zeitplan | ✅ 7 Takte, **keiner ohne Weg zum Menschen** |
| Hash-Kette | ✅ 0 Brüche, Prüfer durch Manipulation belegt |
| Stripe Connect | ✅ Plattform + erster Händler freigeschaltet |
| Steuermodus § 19 | ✅ gebaut und live |
| DSFinV-K, DATEV, § 25a, § 25c | ✅ gebaut |
| Mandanten-Auflösung im Server | ⛔ ZIEL |
| Ein Bau der Kasse für alle | ⛔ ZIEL |
| Automatische Aufnahme | ⛔ ZIEL |
| Kartenzahlung über Stripe | ⛔ ZIEL |
| Android | ⛔ ZIEL, zuletzt |
