# Fiskal-Export Review (api-cloud), 2026-07-08

Adversarielle Prüfung der Export-Bausteine, die ein Betriebsprüfer / das Finanzamt
konsumiert: DSFinV-K (KassenSichV §146a), DATEV (Buchungsstapel), Kassenbericht
und das An-/Verkaufsbuch (GwG §10 / §38 GewO).

**Methodik:** 5 Prüf-Dimensionen (find), jede Feststellung danach durch 3
unabhängige Widerleger geprüft (refute). Nur mehrheitlich bestätigte
Feststellungen sind hier gelistet. Zwei interne Konsistenzfehler wurden mit
Unit-Test behoben; alle formatspezifischen Punkte bleiben zur Freigabe durch die
Steuerberatung offen.

Betroffene Dateien: `apps/api-cloud/src/lib/dsfinvk-export.ts`,
`apps/api-cloud/src/lib/datev-export.ts`,
`apps/api-cloud/src/lib/kassenbericht-export.ts`,
`apps/api-cloud/src/routes/closing-export.ts`,
`apps/api-cloud/src/routes/registers.ts`.

> **Deploy-Sperre:** Die beiden behobenen Punkte sind NUR auf dem Branch committet,
> NICHT deployt. Vor dem Ausrollen auf den Produktiv-Server braucht es die
> steuerliche Freigabe und einen Integrationslauf gegen echte Abschlüsse.

---

## A · Behoben (interne Konsistenz, Unit-getestet, Branch-only)

Diese zwei brauchten keine externe Spec: die richtige Referenz steht bereits im
eigenen Code. Beide mit neuem Unit-Test, 217 api-cloud Unit-Tests grün.

### A1 · HOCH · DSFinV-K `bon_ust` fasste einen gemischten Bon auf einen Steuersatz zusammen
`dsfinvk-export.ts` · `buildBonUst` · Commit `5a2fcd8`

- **War:** Eine Bonkopf-USt-Zeile pro Bon, geschlüsselt auf den einen Bon-Steuercode
  (`tax_treatment_code`). Ein gemischter Bon (z. B. eine 19-%-Position plus eine
  nach §25c steuerfreie Anlagegold-Position) verbuchte den GESAMTEN
  Brutto/Netto/USt unter einem USt-Schlüssel. Der steuerfreie Umsatz erschien so
  als 19-%-Umsatz, und `bon_ust` widersprach der (korrekten) positionsweisen
  `bon_pos_ust`, die das DSFinV-K-Prüftool gegeneinander abgleicht.
- **Beleg der Richtigkeit im Code selbst:** `buildBonPosUst` und der DATEV-Pfad
  `toDatevRows` splitten einen gemischten Bon bereits nach der Positions-Behandlung.
- **Jetzt:** Gruppierung je Bon nach `ustKey(line.appliedTaxTreatmentCode)`, Summen
  in ganzen Cent (kein Float, neue Helfer `eurToCents`/`centsToDec`), eine Zeile je
  (Bon, USt-Schlüssel). Einzel-Steuersatz-Bon unverändert.
- **Test:** gemischter Bon liefert zwei Zeilen (Schlüssel 1 = 119,00/100,00/19,00 und
  Schlüssel 5 = 500,00/500,00/0,00), keine Sammelzeile 619,00 mehr.

### A2 · HOCH · DATEV Belegdatum nahm das UTC-Datum statt des Berliner Geschäftstags
`closing-export.ts` · `toDatevRow` · Commit `36d36e7`

- **War:** Der Export wählt die Umsätze über
  `berlin_business_day(finalized_at) = closing.business_day` (Mitternacht Berlin,
  DST-korrekt, `packages/db/migrations/0002_helpers.sql`), leitete das Belegdatum
  aber aus `new Date(finalized_at).toISOString().slice(0,10)` (UTC-Datum) ab. Ein
  Verkauf kurz nach Mitternacht Berliner Zeit (z. B. 00:30 MESZ = 22:30 UTC am
  Vortag) landete korrekt im heutigen Abschluss, wurde in DATEV aber auf GESTERN
  gebucht.
- **Jetzt:** Helfer `berlinDate()` formatiert `finalized_at` per Intl in
  Europe/Berlin und spiegelt so `berlin_business_day()` exakt. Tagesverkäufe
  unverändert.
- **Test:** Tagesverkauf unverändert; Sommer 22:30 UTC ergibt den Berliner Folgetag;
  Winter 23:30 UTC ist DST-korrekt.

---

## B · Bestätigt, aber bewusst OFFEN (Freigabe Steuerberatung nötig)

Nicht angefasst: hier entscheidet die verbindliche DATEV- bzw. DSFinV-K-Spezifikation,
nicht ein Modell-Konsens. Jeder Punkt mit Ist-Wert, behauptetem Soll-Wert und der
betroffenen Feldstelle.

### B1 · HOCH · DATEV EXTF-Kopfzeile: Sachkontenlänge im falschen Feld
`datev-export.ts` · `DATEV_EXTF_HEADER`

- **Ist:** `EXTF;700;21;Buchungsstapel;9;;;;;;;;;;4;;;;;;;EUR;...`. Die `4` liegt in
  Feld 15.
- **Behauptetes Soll:** Feld 14 ist die Sachkontenlänge; die `4` gehört in Feld 14,
  Feld 15 (Datum von) bleibt leer. Also ein Semikolon weniger zwischen der `9`
  (Feld 5) und der `4`.
- **Prüffrage an die Steuerberatung:** Ist im EXTF-Header (Format 700, Kategorie 21)
  Feld 14 die Sachkontenlänge und Feld 15 das Datum-von?

### B2 · MITTEL · DATEV Buchungstext in der falschen Spalte
`datev-export.ts` · `DATEV_COLUMNS`

- **Ist:** Spaltenreihenfolge endet `... Belegfeld1, Buchungstext`. Buchungstext ist
  Datenspalte 12, direkt nach Belegfeld1 (11). Belegfeld2 und Skonto fehlen.
- **Behauptetes Soll:** Feste Buchungsstapel-Reihenfolge 11 = Belegfeld1,
  12 = Belegfeld2, 13 = Skonto, 14 = Buchungstext. Vorschlag: leeres Belegfeld2 (12)
  und leeres Skonto (13) ergänzen, Buchungstext auf 14.
- **Prüffrage:** Erwartet der DATEV-Import den Buchungstext in Spalte 14?

### B3 · MITTEL · DSFinV-K `GV_TYP` 'Einkauf' ist kein gültiger Enum-Wert
`dsfinvk-export.ts` · `gvTyp`

- **Ist:** `direction === 'ANKAUF' ? 'Einkauf' : 'Umsatz'`. Jede Ankauf-Position
  trägt `GV_TYP = 'Einkauf'`.
- **Problem:** `GV_TYP` ist eine geschlossene DSFinV-K-Aufzählung (Umsatz,
  Auszahlung, Pfand, Rabatt, ...); 'Einkauf' ist NICHT enthalten.
- **Prüffrage:** Welcher `GV_TYP` bildet einen Ankauf/Auszahlung korrekt ab (z. B.
  'Auszahlung')? Vorzeichen der Position mit der Steuerberatung bestätigen.

### B4 · MITTEL · DSFinV-K `BON_TYP` 'Beleg-Storno' ist kein gültiger Enum-Wert
`dsfinvk-export.ts` · `bonTyp`

- **Ist:** `r.isStorno ? 'Beleg-Storno' : 'Beleg'`.
- **Problem:** `BON_TYP` ist eine geschlossene Aufzählung (Beleg, AVTransfer,
  AVBestellung, ...); 'Beleg-Storno' ist NICHT enthalten. Ein Storno wird über die
  negierten Beträge (und ggf. `bon_referenzen`) abgebildet, nicht über einen
  eigenen `BON_TYP`.
- **Prüffrage:** `BON_TYP = 'Beleg'` auch für Storno-Belege?

### B5 · HOCH · Export ohne Prüfung auf `state = 'FINALIZED'`. BEHOBEN (branch-only, Integrationstest grün)
`closing-export.ts` · alle drei Export-Routen

- **War:** Die Routen luden den Abschluss per `id` und prüften nur die Existenz; das
  SELECT las `state` nicht. Ein noch offener Abschluss (`COUNTING`) konnte so als
  legaler DATEV/DSFinV-K/Kassenbericht exportiert werden, also ein unvollständiges,
  nicht-finales Artefakt als Tagesbuch. Empirisch bestätigt (COUNTING-Abschluss ist
  für die App-Rolle sichtbar, keine RLS auf `daily_closings`), der Kopfkommentar
  rahmt die Routen aber als legale Steuer-Exporte über einen FINALIZED-Tag.
- **Jetzt:** Alle drei Routen lesen jetzt `state` mit und werfen einen sauberen 409
  (`ClosingNotFinalizedError`, deutsche Meldung), wenn der Abschluss nicht FINALIZED
  ist. Die Info-Route `GET /:id` bleibt für die Vorschau eines offenen Abschlusses
  verfügbar (dort ist der offene Zustand ausdrücklich vorgesehen). Kein
  Policy-Konflikt: ein legaler Export verlangt einen finalisierten Tag. Integrationstest
  in `fiscal-export.test.ts` (COUNTING-Abschluss über alle drei Routen = 409 CONFLICT,
  die FINALIZED-Exporte bleiben grün, 24/24). typecheck grün.

---

## C · Geprüft und entkräftet (keine Fehler)

Von den Widerlegern mehrheitlich als KEIN Fehler bestätigt:

- `registers.ts` CSV-Formel-Injektion: der Schutz greift bzw. die Felder sind nicht
  betroffen (0 von 3 bestätigten den Fehler).
- `registers.ts` fehlende Ausstellungsbehörde: entkräftet.
- `registers.ts` fehlendes UTF-8-BOM: entkräftet.

---

## D · Anhang: Finalize-Money-Pfad (`transaction-math.ts`), geprüft und im Kern solide

Der Serverseitige Geld-Validator `validateTransactionMath` (er speist die Beträge,
die dann exportiert werden) ist im Kern korrekt: `Money` (Decimal, kein Float),
volle Abstimmung Netto + USt = Brutto je Position UND je Kopf, Summenprüfung der
Positionen gegen den Kopf, Summenprüfung der Zahlungen gegen den Kopf. Zwei Punkte
zur Kenntnis (beide REPORT-ONLY, keine autonome Korrektur):

### D1 · Vorzeichen-Disziplin nur auf Kopf-Ebene, nicht je Position. BEHOBEN (branch-only, Unit-getestet)
- **War:** Der App-Validator prüfte das Vorzeichen nur an `totalEur`. Die DB-Constraint
  `transactions_sign_discipline` (`0009_transactions.sql`) prüft Kopf
  total/subtotal/vat, aber `transaction_items` hat NUR
  `line_subtotal + line_vat = line_total` (keine Positions-Vorzeichenprüfung). Ein
  Nicht-Storno-Vorgang konnte also eine negative Position tragen, die sich am Kopf
  wieder zu einem nicht-negativen Betrag summiert; weder Validator noch DB fingen
  das. Der Docstring des Validators behauptete Vorzeichen-Disziplin für "every header
  & line money", was nicht zutraf.
- **Jetzt:** `validateTransactionMath` prüft das Vorzeichen jetzt auch je Position,
  spiegelbildlich zum Kopf und zum Docstring (Nicht-Storno, jede Position >= 0;
  Storno, jede Position <= 0). V1 kennt kein Rabatt-/Negativpositions-Konzept, also
  weist die Prüfung nur anomale Eingaben ab. Sicherheitsnetz bestätigt: die
  Finalize-Integrationstests (15/15) mit echten positiven Positionen bleiben grün,
  der dedizierte Storno-Pfad (`transactions-storno.ts`) umgeht den Validator ohnehin
  (baut die negierten Daten direkt). +4 Unit-Tests (`transaction-math.test.ts`:
  Nicht-Storno mit negativer Position abgelehnt, Storno mit positiver Position
  abgelehnt, beide gültigen Fälle akzeptiert). typecheck grün.

### D2 · §25a-Marge wird serverseitig nicht rechnerisch validiert
- **Ist:** Für eine `MARGIN_25A`-Position prüft der Validator nur, dass `marginEur`
  und `acquisitionCostEurSnapshot` gemeinsam gesetzt sind, NICHT dass die USt =
  19 % der Marge und die Marge = Verkauf minus Einstand ist. Der Docstring nennt das
  als bewusste Phase-1.5-Vertagung.
- **Bewertung:** Bekannte Lücke; eine echte Marge-USt-Prüfung ist eine
  Verhaltensänderung des Finalize-Pfads und braucht die exakte §25a-Formel von der
  Steuerberatung. REPORT-ONLY.

---

## E · Mutations-Integrität (finalize / return / Z-Abschluss)

Zweite Prüfung (find→refute, je Feststellung 3 Widerleger) über die Geld- und
Bestands-Mutationen. Drei bestätigte Feststellungen.

### E1 · HOCH · Return: Produkt-Flip ohne Nullung der Reservierungshülle, BEHOBEN (`10a8fac`, branch-only)
- **War:** `POST /api/transactions/:id/return` setzte das Produkt SOLD → AVAILABLE
  mit nur `sold_at = NULL`, die Reservierungshülle blieb gefüllt. Ein WEB-Verkauf
  behält diese Hülle auf der SOLD-Zeile, also verletzte der Flip die CHECK
  `products_available_no_reservation` (`0006_products.sql`) und der GANZE Return
  rollte zurück. Jeder Web-Verkaufs-Return schlug fehl.
- **Jetzt:** Der Flip nullt alle fünf Reservierungsspalten (wie der kanonische
  `release()` in `inventory-lock`). Storno flippt keine Produkte (Phase 2), dort
  kein Pendant. typecheck grün; Integrationstest braucht die DB.

### E2 · HOCH · Doppelter Z-Bon möglich (Race). BEHOBEN (Migration `0079`, branch-only, DB-getestet)
- **War:** `POST /api/closings/finalize` macht check-then-insert (nicht-sperrender
  Existenz-SELECT, dann INSERT). Der einzige Schutz `UNIQUE (business_day, shop_id)`
  (`0011_closing.sql`) griff NICHT, weil `shop_id` in V1 immer NULL ist und
  Postgres NULLS DISTINCT zwei `(tag, NULL)` als verschieden behandelt. Zwei
  gleichzeitige (oder vom Offline-Outbox erneut gespielte) Abschlüsse für denselben
  Tag committeten also BEIDE, es entstanden zwei unveränderliche FINALIZED Z-Bons, und
  DSFinV-K/DATEV/Kassenbericht zählten den Tag doppelt. Empirisch am Live-Schema
  bestätigt (PG 17.10, `pg_get_constraintdef` zeigt reines `UNIQUE (business_day, shop_id)`
  ohne NULLS NOT DISTINCT, kein partieller Index vorhanden).
- **Jetzt:** Migration `0079_daily_closings_single_z_bon.sql` legt einen PARTIELLEN
  Unique-Index `daily_closings_business_day_null_shop_uq ON daily_closings (business_day) WHERE shop_id IS NULL`
  an. Zusammen mit dem bestehenden `(business_day, shop_id)` ist damit genau ein
  Abschluss pro Tag garantiert, im Einzel-Shop- (NULL) wie im späteren Mehr-Shop-Fall.
  Der Finalize-Catch wandelt den resultierenden 23505 bereits in einen sauberen 409
  (der Index-Name ist jetzt zusätzlich explizit erfasst). Der Index steht auch im
  Drizzle-Schema (`dailyClosings.ts`) für Schema-Konsistenz. Die Migration prüft als
  **Vorbedingung** in einem DO-Block, dass KEINE doppelten `(business_day, NULL)`-Zeilen
  existieren, und bricht sonst mit einer klaren Meldung ab (statt den Schutz still zu
  überspringen). Migrations-Set: der `_journal.json` ist bewusst leer, `migrate.sh`
  wendet `NNNN_*.sql` in Reihenfolge an und verfolgt sie in `_w14_schema_migrations`,
  also ist die NEUE nummerierte Datei der korrekte, sichere Weg (mein früherer
  `drizzle-kit`-Vorbehalt galt für dieses Repo nicht). RED/GREEN-Migrationstest in
  `packages/db/tests/migrations/0079_*.test.ts` (bei 0078 rutschen beide durch, bei 0079
  wird die zweite abgewiesen, ein anderer Tag geht weiter), 4/4 grün; `db` build + api-cloud
  typecheck grün.
- **Anwendung (Basel):** vor dem Deploy `migrate.sh` mit dem Migrator-Credential laufen
  lassen; falls die Vorbedingung greift, zuerst evtl. vorhandene Doppel-Abschlüsse klären.

### E3 · MITTEL · Z-Snapshot-Race (Transaktion fällt aus dem Abschluss). BEHOBEN (branch-only, DB-getestet)
- **War:** Der Abschluss-Snapshot und der State-Flip waren nicht gegen einen
  gleichzeitig laufenden Transaktions-Finalize serialisiert; der C-3-Trigger
  (`0013_security_hardening.sql`) sieht einen noch nicht committeten Abschluss nicht.
  Eine Transaktion konnte in einen gerade finalisierten Tag committen und aus dem
  Z-Snapshot herausfallen (Beleg im Bestand, aber nicht im Z-Bon des Tages).
- **Jetzt:** Beide Pfade serialisieren über einen Advisory-Xact-Lock auf den
  Geschäftstag mit SHARED/EXCLUSIVE-Trennung, KEINE Migration (Laufzeit-Lock):
  der Verkauf-Finalize (`transactions-finalize.ts`) nimmt
  `pg_advisory_xact_lock_shared(1146, (berlin_business_day(now())::date - DATE '1970-01-01')::int)`,
  der Z-Abschluss (`closings-finalize.ts`) nimmt den EXKLUSIVEN Lock auf denselben
  Schlüssel VOR jedem Aggregat. Shared-Locks kollidieren nicht untereinander, also
  blockieren sich gleichzeitige Verkäufe NICHT (nur ein zusätzlicher billiger
  Lock-Aufruf pro Beleg); nur der einmal-tägliche Abschluss wartet auf die in-flight
  Verkäufe und schliesst dann neue für seine Dauer aus, sieht also einen konsistenten
  Snapshot. Der Int-Paar-Schlüsselraum ist getrennt vom Einzel-bigint der
  Termin-Slots (kein Zusammenstoss). Kein zweiter Lock je Transaktion, also keine
  Ordering-Deadlock-Gefahr. Test `e3_z_snapshot_advisory_lock.test.ts` 3/3 grün
  (Schlüssel = Tage-seit-Epoche; exklusiv kollidiert mit gehaltenem shared, shared+shared
  nicht; frei nach COMMIT); Regressionslauf finalize 15/15 + fiscal-export 23/23 grün;
  api-cloud typecheck grün.
- **Hinweis (Basel):** die Änderung liegt auf dem heissesten Schreibpfad (jeder Beleg
  nimmt jetzt einen billigen Shared-Lock). Bitte im Review kurz das Perf-Profil bestätigen;
  Shared-Locks serialisieren nichts, der Aufwand ist ein zusätzlicher Lock-Aufruf.

---

## F · Web-Zahlung: Stripe-Webhook und Storefront-Checkout

Dritte Prüfung (find→refute, je Feststellung 3 Widerleger) über den Web-Geldpfad.
Zwei bestätigte HOCH-Feststellungen (F1, F2); F3 kam beim Umsetzen des Fixes ans
Licht, als der Integrationstest den Konvertierungspfad zum ersten Mal wirklich durchlief.

### F1 · HOCH · Checkout-Betrag mit Float-Division, jeder Cent-Betrag scheitert. BEHOBEN (`ad5e568`, branch-only)
- **War:** `storefront-cart.ts` baute den Betrag als
  `${amountCents / 100}.${amountCents % 100, zweistellig}`. `amountCents / 100` ist
  FLOAT-Division, also ergab jeder nicht-ganze-Euro-Betrag einen kaputten String:
  4999 Cent wurde zu "49.99" (Float) plus ".99" gleich "49.99.99". Die Spalte
  `payment_intents.amount_eur` ist NUMERIC(18,2) und lehnt das ab, der INSERT warf,
  und JEDER Checkout mit Cent-Betrag (der Normalfall) schlug fehl.
- **Jetzt:** `Math.floor(amountCents / 100)` für den Euro-Teil an beiden Stellen
  (INSERT und Antwort). 4999 wird "49.99", 5000 wird "50.00", 5 wird "0.05".
  Durch Auswertung des Templates verifiziert. typecheck grün; Integrationstest
  braucht die DB.

### F2 · HOCH · Webhook verschluckt Stripe-Retry, Geld kassiert, Bestellung nie erfüllt. BEHOBEN (branch-only, Integrationstest grün)
- **War:** `storefront-webhook.ts` schrieb die Dedup-Zeile in `webhook_events`
  (Zeile 174) als eigenständige, sofort committende Anweisung, die Verarbeitung
  lief in einer SEPARATEN Transaktion (Zeile 238). Warf die Verarbeitung
  transient (Reservierung abgelaufen, Deadlock, Verbindungsabbruch), rollte die
  Transaktion zurück, die Dedup-Zeile blieb aber. Beim Stripe-Retry traf der
  INSERT den Unique-Index, und der Catch gab bedingungslos 200 `{idempotent:true}`
  zurück, OHNE `processed_at` zu prüfen. Ergebnis: Stripe hat das Geld kassiert, die
  Bestellung wird nie erfüllt, die Reservierung bleibt hängen und wird später vom
  Cart-Sweeper freigegeben und weiterverkauft. Kein Reconciliation-Worker existiert
  (im Kommentar als künftige Phase 1.5 bezeichnet).
- **Jetzt:** Im Unique-Konflikt-Zweig lädt der Handler jetzt `processed_at` nach. Ist
  es gesetzt, war die vorige Zustellung fertig, also echte Dublette, ACK ohne erneute
  Arbeit. Ist es NULL (vorige Zustellung brach mitten in der Verarbeitung ab),
  verarbeitet der Handler das Event NEU statt es zu verschlucken. Die inneren
  Idempotenz-Wächter (`pi.status='SUCCEEDED'`, Cart CONVERTED, bedingtes `finalize`)
  machen die Neu-Verarbeitung sicher, auch bei Nebenläufigkeit: der bedingte
  `finalize` (`WHERE status='RESERVED'`) serialisiert konkurrierende Zustellungen
  über die Zeilensperre, die zweite rollt zurück. Integrationstest in
  `day20-stripe-real.test.ts` deckt beide Zweige ab (unerledigte vorige Zustellung
  verarbeitet neu und bucht, erledigte nicht). typecheck grün, Integrationstest lokal grün.

### F3 · HOCH · Jede Web-Konvertierung 500te am `device_status`-Enum. BEHOBEN (branch-only, Integrationstest grün)
- **War:** Beim Buchen einer Web-Bestellung fragte `storefront-webhook.ts` das
  Aktiv-Gerät mit `WHERE status = 'ACTIVE'` ab. Das `device_status`-Enum ist aber
  kleingeschrieben (`'active','revoked','expired'`); der Großbuchstaben-Wert warf
  `invalid input value for enum device_status` und liess die GESAMTE
  `payment_intent.succeeded`-Konvertierung 500en. Jede Web-Bestellung wäre nach
  Live-Gang lautlos gescheitert (Geld kassiert, keine Buchung, Reservierung hängt).
  Bislang latent, weil die Storefront noch nicht live ist; erst dieser
  Integrationstest hat den Pfad wirklich durchlaufen und den Fehler freigelegt.
- **Jetzt:** `WHERE status = 'active'::device_status`, wie der mTLS-Guard
  (`plugins/mtls.ts`) es macht. Die zuvor rote Konvertierungs-Prüfung läuft grün.
- Nebenbefund (Test-Drift, behoben): der day20-Seed-Helfer setzte am Produkt nur
  `listed_on_storefront`, nicht `is_published_to_web`, den heute gültigen
  Kaufbarkeits-Schalter (Audit H1). Ohne den Schalter gab Add-to-Cart 409, also lief
  der ganze Konvertierungspfad nie an. Helfer an das day19-Muster angeglichen.

REFUTED (0/3, korrekt kein Fehler): Out-of-order-Event ohne PI-Zeile,
fehlender Betrags-/Währungs-Abgleich im Webhook. Ein Punkt unbestätigt (Refuter
lief in das Session-Limit): `storefront-reserve.ts` Hold und Cart-Flip nicht in
einer Transaktion. Verdient einen gezielten zweiten Blick.

---

## G · Sicherheit: eingehende Webhooks und Storefront-Auth

Vierte Prüfung (find→refute, je Feststellung 3 Widerleger) über die öffentlich
erreichbaren, unauthentifizierten Endpunkte. Zwei bestätigte Feststellungen.

### G1 · HOCH · Storefront Google-OAuth Konto-Übernahme. BEHOBEN (`1a8b526`, branch-only)
- **War:** Der Google-Callback verknüpfte eine verifizierte Google-Identität mit
  JEDEM vorhandenen E-Mail-Konto (Blind-Index) und setzte es per COALESCE auf
  verifiziert, OHNE zu prüfen, ob dieses Konto selbst verifiziert war. Da die
  Passwort-Registrierung ein nutzbares Passwort ohne E-Mail-Verifizierung anlegt
  (`email_verified_at` bleibt NULL), gilt: (1) Angreifer registriert die E-Mail des
  Opfers mit eigenem Passwort; (2) Opfer meldet sich später mit Google an, der
  Callback merged Google auf die Angreifer-Zeile und gibt dem Opfer dort eine
  Session; (3) das Angreifer-Passwort wurde nie gelöscht und der Sign-in prüft nie
  auf Verifizierung, also behält der Angreifer dauerhaften Zugriff auf Bestellungen,
  Warenkorb, Termine und PII des Opfers. Klassischer Federated-Merge-Takeover.
- **Jetzt (verified-email-wins):** Beim Verknüpfen von Google mit einem NICHT bereits
  verifizierten Konto wird `password_hash` in derselben UPDATE auf NULL gesetzt, das
  ungeprüfte Passwort also verworfen. `verifyPassword` liefert bei NULL-Hash false
  (auth-pin try/catch), das alte Passwort scheitert danach sauber am Sign-in; ein
  echter Nutzer ist nicht betroffen (er hat sich gerade per Google authentifiziert).
  Die CHECK (`password_hash IS NOT NULL OR google_sub IS NOT NULL`) bleibt erfüllt,
  weil `google_sub` in derselben Anweisung gesetzt wird. typecheck grün;
  Integrationstest plus Security-Review vor Deploy.
- **Zusatz (REPORT-ONLY):** Es gibt gar keinen E-Mail-Verifizierungs-Flow für die
  Passwort-Registrierung. Das ist die Wurzel; ein echter Verifizierungs-Schritt
  (Double-Opt-in) sollte nachgezogen werden.

### G2 · MITTEL · Rate-Limit umgehbar über `trustProxy: true`. REPORT-ONLY
- **Ist:** `app.ts` setzt `trustProxy: true`, also leitet Fastify `req.ip` aus dem
  vom Client vollständig kontrollierbaren, linken `X-Forwarded-For`-Eintrag ab. Der
  Rate-Limit-Key (`plugins/rate-limit.ts`) nutzt nur `req.ip`, also kann ein
  Angreifer den Header rotieren und die einzige Flut-/Brute-Force-Grenze umgehen.
- **Empfohlener Fix:** `trustProxy` auf den konkreten Proxy setzen (Hop-Zahl oder
  cloudflared-CIDR) statt `true`, ODER den keyGenerator auf einen validierten
  `CF-Connecting-IP`-Header umstellen. NICHT autonom umgesetzt: hängt von der echten
  Proxy-Topologie ab; ein falscher Wert bricht die `req.ip`-Auflösung.

REFUTED (0/3): User-Enumeration-Timing beim Sign-in, unauth Sign-up nur global
rate-limitiert, Lockout-DoS.

---

## H · Hintergrund-Jobs (Sweeper, Cleanup, Export, Monitore)

Fünfte Prüfung (find→refute, je Feststellung 3 Widerleger) über die unbeaufsichtigten
Cron-Jobs. Vier bestätigte Feststellungen.

### H1 · HOCH · Cart-Sweeper gibt bezahlten Bestand frei (asynchrone Zahlung). BEHOBEN (branch-only, Integrationstest grün)
- **War:** Async-Zahlarten (SEPA, Klarna, iDEAL, giropay) sind im Checkout Standard,
  SEPA bleibt tagelang bei Stripe im Status `processing`. Reservierungs-TTL und
  Checkout-Fenster waren aber fest auf 15 Minuten, und das `payment_intent_status`-Enum
  hat kein `processing`. Nach 16 Minuten gab `storefront-cart-sweeper.ts` die
  reservierten (bezahlbaren) Artikel allein nach `checkout_expires_at < now()` frei
  (RESERVED→AVAILABLE), setzte den Warenkorb ABANDONED und den laufenden PaymentIntent
  EXPIRED. Der Artikel wurde weiterverkauft; Tage später kam `succeeded`, der Webhook
  warf (Warenkorb ABANDONED statt CHECKOUT) und der F2-Idempotenz-Schluck verhinderte
  jede Erholung. Geld kassiert, Bestand weiterverkauft, keine Buchung. Lautlos.
- **Jetzt:** Ein neuer `payment_intent.processing`-Handler im Webhook verlängert bei
  Beginn der async-Abwicklung SOWOHL `checkout_expires_at` (Warenkorb) ALS AUCH
  `reservation_expires_at` (alle RESERVED-Produkte der Session) auf ein
  settlement-sicheres Fenster (Konstante `ASYNC_SETTLEMENT_INTERVAL`, Standard 14 Tage).
  Cart-Sweeper und Reaper greifen nur auf wirklich abgelaufene Fenster zu, also lassen
  sie einen abwickelnden async-Kauf in Ruhe, bis Stripe das Endergebnis meldet
  (`succeeded` bucht, `payment_failed`/`canceled` gibt sofort frei). Karten-Checkouts
  erhalten kein `processing`-Event und behalten den schnellen 15-Minuten-Sweep. KEIN
  neuer Enum-Wert, KEINE Migration nötig (der Halt steckt allein in den verlängerten
  Fenstern). Weder Sweeper noch Reaper mussten geändert werden. Integrationstest in
  `day20` prüft, dass `processing` beide Fenster über 13 Tage hinausschiebt und
  Warenkorb (CHECKOUT), Reservierung (RESERVED) und PaymentIntent (PENDING) unangetastet
  lässt. typecheck grün, Integrationstest lokal grün.
- **Restrisiko (REPORT-ONLY):** Trifft `processing` erst NACH dem 15-Minuten-Sweep ein
  (sehr seltene, stark verzögerte Zustellung), ist der Artikel schon frei. Stripe feuert
  `processing` normalerweise binnen Sekunden nach der Autorisierung, also praktisch
  vernachlässigbar. Der Doppel-Schutz (Sweeper gleicht selbst aktiv gegen Stripe ab)
  bräuchte einen Stripe-Client im Worker, der nicht existiert, und bleibt offen.
- **Produkt-Entscheidung (Basel):** 14 Tage ein Einzelstück (Unikat) für eine
  vielleicht-Zahlung zu halten ist ein realer Verfügbarkeits-Preis. Alternativen: das
  Fenster kürzen (Konstante), oder online nur Karten-Zahlung anbieten (async-Zahlarten
  aus `DEFAULT_PAYMENT_METHOD_TYPES` nehmen, SEPA in DE ist aber stark). Bewusst als
  tunbare Konstante gebaut, nicht einseitig entschieden.

### H2 · HOCH · Reservierungs-Reaper resellt denselben In-Flight-Artikel. BEHOBEN (durch H1, branch-only)
- **War:** `packages/inventory-lock/autoReleaseExpired.ts` setzt jedes RESERVED-Produkt
  nach `reservation_expires_at < now()` auf AVAILABLE, ohne Zahlungs-/Warenkorb-Bezug,
  ein zweiter, unabhängiger Pfad mit demselben Ergebnis wie H1.
- **Jetzt:** Durch H1 mitbehoben. Der `processing`-Handler verlängert
  `reservation_expires_at` derselben Session, also lässt der generische Reaper den
  abwickelnden Artikel liegen, bis Stripe das Endergebnis meldet. Kein separater
  Codepfad und keine Änderung am Reaper nötig, der Schutz sitzt korrekt an der
  Reservierung.

### H3 · HOCH · TSE-Zertifikats-Monitor verstummt nach Erneuerung. BEHOBEN (branch-only, Unit-getestet)
- **War:** `tse-cert-checker.ts` setzte `last_alert_tier` nie zurück, wenn das
  Zertifikat erneuert wurde (`cert_valid_to` springt vor). Das eskalations-basierte
  Alarm-Gate blieb auf der höchsten je erreichten Stufe verrastet (bis 'expired') und
  warnte vor dem NÄCHSTEN Ablauf nicht mehr. Ein Monitor, der stumm bleibt, ist
  gefährlich: das TSE-Zertifikat kann unbemerkt ablaufen (Kassen-Ausfall).
- **Jetzt:** Der Job liest jetzt zusätzlich das gespeicherte `cert_valid_to` mit und
  erkennt eine Erneuerung daran, dass die neue Gültigkeit STRIKT später ist. Bei
  erkannter Erneuerung wird die Alarm-Leiter auf null zurückgesetzt (und der Reset
  auch auf dem Nicht-Alarm-Pfad in die DB geschrieben, sonst bliebe der veraltete Wert
  stehen), also ist der Monitor für den nächsten Ablauf-Zyklus wieder scharf. Ein
  unverändertes Zertifikat gilt NICHT als Erneuerung (kein Fehlalarm-Reset). +3 Unit-Tests
  (Erneuerung alarmiert erneut trotz zuvor 'expired', Erneuerung auf gesundes Zertifikat
  setzt still zurück, unverändertes Zertifikat löst keinen Reset aus). typecheck grün,
  Unit-Tests grün (11/11 in `tse-cert-checker.test.ts`). Kein Migrations-Bedarf
  (`last_alert_tier` und `cert_valid_to` existieren bereits).

### H4 · MITTEL · Job-Runner erzwang das Timeout nicht. BEHOBEN (`d4b0276`, branch-only)
- **War:** Das Pro-Versuch-Timeout rief nur `controller.abort()`; es rennt `def.run()`
  nie. `abort()` unterbricht kein bereits awaited Promise, also hing ein Job, der
  `signal` ignoriert (eine lange DB-Abfrage kann das nicht beobachten), ewig. Weder
  `clearTimeout` noch die pg-Advisory-Lock-Freigabe in den finally-Blöcken liefen, der
  Job blieb über jeden künftigen Tick verkeilt.
- **Jetzt:** `Promise.race([def.run(...), abortRejection])`, damit der Runner auch dann
  terminiert (TIMEOUT, Timer weg, Lock frei), wenn der Job das Signal nie beobachtet.
  typecheck grün; runner-resilience-Integrationstest braucht die DB.

REFUTED (0/3): GDPR-KYC-Purge meldet SUCCESS ohne Actor, tse-archive kein Auto-Recover,
anomaly-watchdog UTC-Tag. Unbestätigt (1/3): dsfinvk-daily-export ohne Catch-up für
einen verpassten Tag. Verdient einen zweiten Blick.

---

## I · Terminbuchung (nachträgliche gezielte Prüfung)

Fokus-Review der Buchungs-Nebenläufigkeit. Beide Buchungspfade sind sauber: der
öffentliche Storefront-Pfad serialisiert per `pg_advisory_xact_lock` auf den
Slot-Zeitpunkt plus Re-Check, der Admin-Pfad stützt sich auf den DB-EXCLUDE
`appointments_no_staff_overlap` (Migration `0069`, korrektes Status-Prädikat, storniert/
No-Show/verschoben zählen NICHT als Konflikt). Eine Feststellung.

### I1 · MITTEL · Verschieben auf eine überlappende Zeit scheitert immer. BEHOBEN (Migration `0080`, branch-only, DB-getestet)
- **War:** Der Reschedule (`routes/appointments.ts`) MUSS den Klon einfügen, bevor er
  das Original auf RESCHEDULED setzen kann (die CHECK `appointments_rescheduled_has_link`
  braucht die Klon-id zuerst). Der EXCLUDE aus `0069` war IMMEDIATE, also kollidierte
  der Klon-INSERT mit dem noch aktiven Original, sobald die neue Zeit die alte
  überlappte (z. B. 10:00 auf 10:30 verschieben, gleiche Kraft), und jeder
  Zeit-nahe Reschedule schlug mit 23P01 fehl. Das Verschieben um einen kleinen
  Betrag, der häufigste Fall, war unmöglich.
- **Jetzt:** Migration `0080` legt den Constraint als DEFERRABLE INITIALLY IMMEDIATE
  neu an (Standardverhalten unverändert, Buchungs-Konflikte greifen weiter sofort und
  werden als 409 gefangen). Nur die Reschedule-Transaktion setzt
  `SET CONSTRAINTS appointments_no_staff_overlap DEFERRED`, also läuft IHRE Prüfung
  erst beim COMMIT, wenn das Original schon RESCHEDULED (aus der Menge) ist. Eine echte
  Überlappung mit einem ANDEREN aktiven Termin wirft weiterhin 23P01 beim COMMIT und
  wird zum 409. Ein reines UNIQUE/EXCLUDE lässt sich nicht per `ALTER CONSTRAINT`
  deferrable machen (nur FK), daher drop + re-add; die Bestandsdaten erfüllen das
  Prädikat, also ist das Neu-Anlegen sicher. RED/GREEN-Migrationstest
  `0080_*.test.ts` (5/5 grün: bei 0079 wird der überlappende Klon abgewiesen und der
  Constraint ist nicht deferrable; bei 0080 committet der aufgeschobene Reschedule, ein
  echter Fremd-Konflikt scheitert beim COMMIT, eine normale Doppelbuchung scheitert
  weiter sofort). `db` build + api-cloud typecheck grün.

---

## Nächste Schritte für die Freigabe

1. Steuerberatung prüft B1 bis B4 gegen die verbindliche DATEV-/DSFinV-K-Spezifikation.
2. B5 ist GELÖST (branch-only, Integrationstest grün): der Export verlangt jetzt
   `state = 'FINALIZED'` (409 sonst), die Info-Route bleibt für die Vorschau.
3. D1 ist GELÖST (branch-only, Unit-getestet): Positions-Vorzeichen-Disziplin im
   Validator. D2 (§25a-Marge rechnerisch prüfen) bleibt die BEWUSSTE Phase-1.5-Vertagung
   (der DB-CHECK erzwingt nur die Paar-Präsenz), kein Fehler; erst mit dem
   Marge-Klassifizierer nachziehen.
4. E2 und E3 sind GELÖST (branch-only, DB-getestet): E2 = partieller Unique-Index
   gegen den doppelten Z-Bon (Migration `0079`, `migrate.sh` vor dem Deploy nötig);
   E3 = SHARED/EXCLUSIVE-Advisory-Lock auf den Geschäftstag gegen den Z-Snapshot-Race
   (keine Migration). Basel bestätigt beim Review kurz das Perf-Profil des Shared-Locks
   auf dem Verkauf-Pfad (er serialisiert nichts).
5. F2, F3, H1 und H2 sind GELÖST (branch-only, Integrationstest `day20` lokal grün):
   der Async-Zahlungs-Lebenszyklus (Webhook-Idempotenz mit `processed_at`-Neuverarbeitung,
   `payment_intent.processing`-Handler, verlängerte Checkout- und Reservierungs-Fenster,
   plus der `device_status`-Enum-500er). Offen ist NUR noch die Produkt-Entscheidung zum
   14-Tage-Halte-Fenster bei Einzelstücken (siehe H1) und Basels Sign-off, dann Deploy.
6. H3 (TSE-Monitor-Reset) ist GELÖST (branch-only, Unit-getestet). Offen bleibt G2
   (`trustProxy`, braucht die echte Proxy-Topologie) plus ein
   E-Mail-Verifizierungs-Flow für die Passwort-Registrierung.
7. Freigabe von A1, A2, B5, D1, E1, E2, E3, F1, F2, F3, G1 (Security-Review), H1, H2, H3,
   H4 und I1, dann Deploy über den üblichen Server-Weg. Basel führt den Integrationstest,
   `migrate.sh` (0079 + 0080) und den Deploy aus.
8. Nebenbefund (nicht in diesem Fix): der Sign-in-Lockout-Integrationstest in
   `day19-storefront.test.ts` ("5 wrong attempts") schlägt fehl, auch ohne diese
   Änderungen (per Stash bewiesen). Gehört nicht zum Zahlungs-Fix, separat prüfen.
