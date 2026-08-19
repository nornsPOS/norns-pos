# ENTWICKLUNG.md — Arbeiten an Norns POS

Dieses Dokument ist der Einstieg für jede Entwicklerin und jeden Entwickler,
der diesen Baum kalt übernimmt. Es beschreibt, was das Projekt ist, wo alles
liegt, welche Grundsätze hier durchgesetzt werden und wie man baut, prüft und
ausliefert. Die Gestaltungsregeln stehen in
[`docs/DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md).

---

## 1. Was das Projekt ist

**Norns POS** ist eine schlanke, steuerlich ernsthafte Kasse für deutsche
Betriebe, die mit wertvollen Gütern handeln — Juweliere, Edelmetall, Nachlässe.
Jeder fiskalische Weg (TSE, DSFinV-K 2.4, DATEV, Kassenbericht) ist
Produktionscode: **die Fiskalkette wird nicht gebrochen.**

1. **Nur die Kasse.** Kein Webshop, kein Kanalvertrieb, keine Cloud-Pflicht.
   Reste des früheren, größeren Systems werden entfernt, nicht versteckt —
   der Auszug steht in
   [`docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md`](AUSGEZOGEN-NICHTS-IST-VERLOREN.md).
2. Belege werden über **fiskaly** (Cloud-TSE) signiert; für vollständig
   netzlose Betriebe ist die **Swissbit-USB-TSE** der zweite Weg.
3. Der Kern darf **nicht voraussetzen**, dass der Händler Edelmetall führt:
   Kurse und Waage sind je Betrieb schaltbare Module. Das Steuerrecht
   (§ 25a UStG, Ankaufbeleg, GwG-Identitätspflicht) ist Kern und gilt für
   jeden Gebrauchtwarenhandel.
4. Der Schwerpunkt ist **steuerliche Korrektheit**: die Formate für Prüfer
   und Steuerberater exakt richtig, aus derselben Quelle wie die Belege.

Stack: pnpm + Turborepo, durchgehend striktes TypeScript. Die Kasse ist eine
Tauri-Anwendung (Rust-Rumpf, React/Vite-Fläche) mit einem eingebetteten
Postgres 17 und einem mitreisenden Node-Motor.

## 2. Die Karte

| Pfad | Inhalt |
|---|---|
| `apps/tauri-pos` | Die Kasse (Tauri + React + Vite) — das Produkt. Bringt Postgres 17 und den Motor mit. |
| `apps/api-cloud` | Der Fastify-Motor. Beim Kunden läuft er ALS mitgelieferter Kindprozess, nie als ferner Server. |
| `apps/api-cloud/sidecar` | Der gebündelte Motor, den die Kasse wirklich startet. Eine byte-identische Zweitkopie reist unter `apps/tauri-pos/src-tauri/resources/sidecar/`. |
| `packages/db` | Drizzle-Schema + Wanderungen. Vor einem Repo-Typecheck zuerst bauen. |
| `packages/api-client` | Der typisierte Klient über dem Motor. |
| `packages/ui-kit` | Marken, Bauteile und Stilblätter der Kasse. |
| `packages/domain`, `packages/auth-pin`, `packages/appointments`, `packages/inventory-lock`, `packages/audit`, `packages/i18n-de`, `packages/email`, `packages/config` | Geteilte Fachlichkeit. `i18n-de` ist das deutsche Vokabular der Kasse. |

## 3. Harte Grundsätze (der Inhaber setzt sie durch)

**(a) Kein Maschinentext erreicht je einen Menschen.** Kein Unterstrich, kein
`SCREAMING_SNAKE`, kein rohes Englisch in irgendeinem sichtbaren Text. Jeder
Backend-Code läuft durch eine VOLLSTÄNDIGE deutsche Zuordnung
(`packages/i18n-de`); Unbekanntes wird zu einem deutschen Wort, nie zum
rohen Schlüssel.

**(b) Ehrlichkeit.** Eine gezeigte Zahl ist eine echte Zahl von einem echten
Endpunkt — oder ein sauberer deutscher Leer-, Sperr- oder Fehlerzustand.
Niemals einen Wert erfinden, niemals eine rohe Antwort rendern.

**(c) Der Repo-Typecheck bleibt grün**, einschließlich `apps/tauri-pos`:
`pnpm typecheck` mit Ausgang 0, an jedem Prüfpunkt.

**(d) Kein „fertig" ohne Beweis.** Ein Commit-Hash, die wörtliche
Befehlsausgabe und eine Live-Prüfung. Ein grüner Exit-Code allein beweist
nichts; nach jeder Änderung das geänderte Artefakt selbst wieder lesen.

**(e) Wächter werden erfüllt, nie umgangen.** Die Prüfsätze mit Namen wie
`*-waechter` und `*-wache` schützen Architekturentscheidungen. Wird einer
rot, ist der Weg die **Registrierung mit Begründung** an der Stelle, die der
Wächter dafür vorsieht — niemals das Abschalten. Ein neuer Wächter wird
rot-grün geführt: erst beweisen, dass er den Fehler fängt, dann erfüllen.

**(f) Grabsteine statt stiller Löschung.** Wer etwas entfernt, schreibt an
die Stelle, WAS dort stand, WARUM es ging und das Datum. Gemessen wird die
VERWENDUNG, nie die Erwähnung, bevor etwas geht.

## 4. Der Motor und seine zwei Kopien

Die Quelle des Motors ist `apps/api-cloud/sidecar/norns-sidecar.mjs` plus der
Quellbaum von `apps/api-cloud`. Die Kasse startet aber das **gebündelte**
`start.mjs`. Deshalb gilt nach JEDER Änderung an Motorquelle oder Sidecar:

```bash
node scripts/buendle-motor.mjs
```

Das schreibt `apps/tauri-pos/src-tauri/resources/sidecar/start.mjs` neu.
Eine Quelländerung ohne Neubündelung erreicht das Produkt nie.

## 5. Wanderungen (Migrationen)

Zwei Welten, eine Wahrheit:

- **Entwicklung und Prüfsätze** fahren die volle Kette
  `packages/db/migrations/0001…` gegen Wegwerf-Container.
- **Ausgelieferte Kassen** bekommen beim Erststart den Schema-Auszug
  `erststart/schema.sql` + die Saat `erststart/referenz.sql`, danach die
  NACHZÜGLER-Liste (in `norns-sidecar.mjs`), die bei JEDEM Start idempotent
  nachgezogen wird (Buchführung in der Tabelle `norns_nachzuegler`, nach
  Dateiname).

Eine neue Wanderung, die auch BESTEHENDE Kassen erreichen muss, braucht
darum VIER Schritte: die Datei in `packages/db/migrations/`, den Eintrag in
der NACHZÜGLER-Liste **beider** Sidecar-Kopien, die Dateikopie in **beide**
`erststart/nachzuegler/`-Ordner, und die Neubündelung. Der Prüfsatz
`nachzuegler-liegen-im-buendel` macht Vergessenes rot.

Der Schema-Auszug ist ein gepflegter Schnappschuss. Wer ihn ändert, beweist
den Erststart danach mit einem frischen Datenverzeichnis (die Kasse meldet
`NORNS_BEREIT`), nicht mit einem Blick auf die Datei.

## 6. Geheimnisse

Jede App beschreibt ihre Umgebung in einer `.env.example`. Echte Werte leben
NUR in gitignorierten `.env`-Dateien und im Schlüsselbund des
Betriebssystems. **Niemals einen echten Wert committen.** Der Rust-Rumpf
reicht dem Motor eine geschlossene Liste von Geheimnissen durch
(`src-tauri/src/tresor.rs`) — was dort nicht steht, erreicht den Motor nicht.

## 7. Bauen, prüfen, ausliefern

```bash
pnpm typecheck                 # das Tor: muss an jedem Pruefpunkt gruen sein
pnpm --filter @norns/db build  # zuerst, wenn das Schema angefasst wurde
cd apps/api-cloud  && npx vitest run   # Motor-Batterie (Verbund gegen echtes Postgres)
cd apps/tauri-pos  && npx vitest run   # Kassen-Batterie samt Waechtern
cd packages/ui-kit && npx vitest run   # Bauteil-Batterie
```

Die Batterien **je Paket einzeln** fahren — gemeinsam gestartet kollidieren
die Verbund-Suiten an geteilten Behältern, und eine rote Zahl aus einem
kollidierten Lauf beweist nichts.

Die Kasse bauen: `cd apps/tauri-pos && pnpm tauri build`. Ein offizielles
Release braucht zusätzlich den Signaturschlüssel des Aktualisierers
(`TAURI_SIGNING_PRIVATE_KEY`) — das ist der Auslöser des Inhabers.

Eine Wegwerf-Kasse für Design und Prüfung: den gebündelten Motor mit einem
frischen `NORNS_DATENORT` starten (er druckt `NORNS_BEREIT {port}`), dann
`VITE_API_BASE_URL=http://127.0.0.1:<port> npx vite --port 1420`
(Port 1420 steht in der CORS-Erlaubnisliste).

## 8. Rote Linien der Fiskalik

- Ein abgeschlossener Beleg wird nie verändert — Korrektur heißt Storno
  oder Rückgabe als NEUER, referenzierter Beleg (DSFinV-K Tz. 4.2).
- `finalized_at`, Belegnummern und die TSE-Signaturkette sind unantastbar;
  die Wächter der Fiskaltabellen kennen jeden erlaubten Weg namentlich.
- Kundendaten werden anonymisiert, nie gelöscht, solange § 147 AO sie hält
  (`erase_customer()`, [`docs/GDPR-ERASURE-SPEC.md`](GDPR-ERASURE-SPEC.md)).
- Steuerfragen, die nur der Steuerberater entscheiden darf, stehen gesammelt
  in `apps/tauri-pos/src/lib/steuerberater-fragen.ts` — dort eintragen,
  nicht raten.
