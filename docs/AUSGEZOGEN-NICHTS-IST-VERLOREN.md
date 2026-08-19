# Was aus der Kasse ausgezogen ist, und wie es zurückkommt

Stand 01.08.2026.

Am 01.08.2026 sind mehrere Flächen aus Norns POS ausgezogen. **Keine einzige
Zeile ist verloren.** Diese Datei ist das Verzeichnis dazu: was ging, warum,
wo es liegt, und unter welcher Bedingung es zurückkehrt.

Sie existiert, weil Basel es ausdrücklich verlangt hat:

> „بس عشان ما تحذف كل شي بس نغير مفهوم التسجيل والتوثيق"
> (nur damit du nicht alles löschst, wir ändern nur das Konzept der
> Registrierung und Beglaubigung)

Der Auszug ist kein Verzicht auf die Sache. Er ist der Verzicht auf eine
**sichtbare Tür, hinter der auf einer Kasse ohne Netz niemand steht**. Genau
das ist die Regel, die allen Entscheidungen unten zugrunde liegt.

---

## Die Regel

Norns POS läuft vollständig offline. Der Server reist als Kindprozess mit; die
einzigen zwei Löcher in der Wand sind die TSE-Wolke und der Kursdienst für
Edelmetalle.

Der Rust-Rumpf reicht dem Motor eine **geschlossene Liste von vier
Geheimnissen** durch, `src-tauri/src/tresor.rs:57`:

```rust
const GEHEIMNISSE: [&str; 4] = [
    "AUTH_SECRET",
    "NORNS_PII_KEY",
    "KYC_IMAGE_ENCRYPTION_KEY",
    "NORNS_DB_PASSWORT",
];
```

Dazu `NORNS_DATENORT` und `NORNS_GERAETE_KENNUNG` als Umgebung.

**Jeder Zugang, der nicht auf dieser Liste steht, kann den Motor nicht
erreichen.** Das ist der technische Grund für fast jeden Auszug unten. Wer
eine dieser Flächen zurückholen will, muss zuerst diesen Weg öffnen, nicht die
Fläche wiederherstellen.

---

## Das Verzeichnis

Jede Zeile ist geprüft: der Befehl daneben holt die Datei wirklich zurück.

### 1. Google-Anmeldung — kommt zurück, als Händleridentität über norns.de

<!--
  Nachtrag 05.08.2026. Vorher trug diese Tabelle die vollen Pfade ab apps/, je
  einmal in der Spalte Datei und noch einmal ausgeschrieben im git-Befehl. Das
  war falsch: ein voll verankerter Pfad in docs/ liest sich als Zusage, dort
  liege eine Datei. Beide sind mit dcc1972 ausgezogen, an HEAD steht dort
  nichts, und die Wache scripts/check-doku-quellverweise.mjs meldete die zwei
  Zeilen zu Recht als tote Quellverweise. Abschnitt 1 war dabei der einzige
  Ausreisser, die Abschnitte 2 bis 4 schreiben den Pfad laengst ab
  apps/tauri-pos/src/ und den Befehl einmal unter der Tabelle. Jetzt ist auch
  Abschnitt 1 in dieser Form. Am 05.08.2026 nachgemessen, beide Befehle liefern
  Inhalt: 319 und 124 Zeilen, genau die Zahlen in der Spalte daneben.
-->

| Datei | Zeilen | Vorgänger |
|---|---|---|
| `screens/GoogleLogin.tsx` | 319 | `dcc1972^` |
| `lib/google-login.ts` | 124 | `dcc1972^` |

Also `git show <vorgänger>:apps/tauri-pos/src/<pfad>`.

**Warum sie ging:** in der heutigen Fassung führte sie ins Leere. `App.tsx`
reichte `onUseGoogle` bewusst nicht durch, die Gerätesperre versprach trotzdem
dreimal „Google", und ihr Knopf rief in Wahrheit `onSignOut`.

**Wie sie zurückkommt, und das ist ein ANDERES Konzept:** nicht als Anmeldung
der Kasse ans Netz, sondern als **Identität des Händlers bei Norns**. Der
Händler hat ein Konto auf `norns.de`, lädt dort die App, aktiviert sie dort,
und Google Workspace ist der Weg, wie er sich bei Norns ausweist. Die Kasse
selbst bleibt offline; sie trägt danach nur noch das Ergebnis der Aktivierung.

Das ist ausdrücklich **später**. Diese Datei hält nur fest, dass die Absicht
existiert und der Quelltext bereitliegt.

### 2. Sprachassistent — kommt zurück, wenn es einen Weg für Zugangsdaten gibt

| Datei | Zeilen |
|---|---|
| die Überlagerung des Sprachassistenten (app/chrome) | 578 |
| die Kacheln des Sprachassistenten (app/chrome) | 799 |
| der Kachel-Speicher des Sprachassistenten | 243 |
| `app/chrome/useRealtimeSession.ts` | 675 |
| `app/chrome/usePrimeMicPermission.ts` | 47 |
| `app/chrome/useAudioDevices.ts` | 65 |
| der Namens-Prüfsatz des Sprachassistenten | 87 |

Alle sieben: `git show af2c3be^:apps/tauri-pos/src/<pfad>`

**Warum er ging:** er braucht `OPENAI_API_KEY` im Motor. Der steht nicht auf
der Viererliste. Es gibt heute keinen Weg, ihn hineinzugeben.

**Bedingung für die Rückkehr:** ein Weg, Zugangsdaten des Händlers sicher an
den Motor zu reichen. Sobald der steht (er wird ohnehin für die Wolken-TSE
gebraucht), ist der Assistent eine Einstellung, keine Neuentwicklung.

### 3. Kanäle: eBay, WhatsApp, Anfragen

| Datei | Zeilen |
|---|---|
| `screens/secondary/Ebay.tsx` | 710 |
| `screens/secondary/WhatsApp.tsx` | 1393 |
| `screens/secondary/Anfragen.tsx` | 375 |

Alle drei: `git show d1dc57e^:apps/tauri-pos/src/<pfad>`

**Warum sie gingen, je einzeln:**

- **Anfragen**: der Gmail-Abholer wohnt in `apps/worker/src/lib/gmail.ts`. Der  ⟵ mit `apps/worker` geloescht am 14.08.2026 (Trennung von warehouse14)
  Arbeiter reist nicht mit; der Beipack trägt nur `start.mjs`. Es kommt nie
  ein Ticket an.
- **WhatsApp**: der Eingang kommt als Webhook von Meta. Eine Kasse ohne Tunnel
  bekommt keinen. Senden braucht `WHATSAPP_ACCESS_TOKEN` aus der Umgebung.
- **eBay**: braucht `EBAY_API_TOKEN`. **Und es log**: `lib/ebay-client.ts:56`
  gibt bei leerem Zugang `{ ended: true, mock: true }` zurück, und
  `routes/transactions-finalize.ts:919` dreht daraufhin die Ware im eigenen
  Bestand von ONLINE auf BEENDET, ohne dass eBay je gefragt wurde.

**Bedingung für die Rückkehr:** derselbe Weg für Zugangsdaten wie beim
Assistenten, PLUS ein mitreisender Arbeiterprozess für alles, was pollt. Der
eBay-Zweig in `ebay-client.ts:56` muss vorher repariert werden, unabhängig von
Norns: für jeden Mandanten ohne Zugang ist er eine stille Falschbuchung.

### 4. Wolken-Flächen: Schaufenster, Web-SEO, Google-Kalender

Achtung, diese fünf verteilen sich auf ZWEI Einträge. Der Vorgänger ist je
Datei ein anderer; ein falscher Commit gibt keinen Fehler, sondern nichts.

| Datei | Zeilen | Vorgänger |
|---|---|---|
| `screens/schaufenster/Schaufenster.tsx` | 267 | `dcc1972^` |
| `screens/werkstatt/GoogleKalenderCard.tsx` | 634 | `dcc1972^` |
| `screens/werkstatt/TerminDialog.tsx` | 377 | `dcc1972^` |
| `screens/werkstatt/KalenderSurface.tsx` | 27 | `dcc1972^` |
| `screens/lager/WebSeoPanel.tsx` | 637 | `458678d^` |

Also `git show <vorgänger>:apps/tauri-pos/src/<pfad>`.

Jeder Befehl in dieser Datei ist am 01.08.2026 einzeln ausgeführt und hat
Inhalt geliefert. Wer die Liste erweitert, führt seinen Befehl vorher aus.

**Warum sie gingen:** sie bedienten einen Webshop und einen fremden Kalender.
Norns POS ist die Kasse am Tresen; in dieser Kopie liegt kein Shop
(`apps/` trägt api-cloud, mobile, tauri-pos, worker).

**Ausdrücklich KEINE Rückkehr geplant** für Schaufenster und Web-SEO. Der
Terminweg dagegen bleibt und wird ausgebaut, aber **intern**: `screens/termine/`
ist der eigene Weg dieser Kasse, und Basel hat ein „sehr weit entwickeltes
internes Terminsystem" verlangt. `TerminDialog.tsx` (377 Zeilen) ist beim
Ausbau lesenswert, auch wenn er am Google-Kalender hing.

---

## Was ABSICHTLICH stehengeblieben ist

Nicht alles, was den alten Namen trägt, darf weg. Die Begründung im Einzelnen
steht in `apps/tauri-pos/src/lib/marke.ts`; hier die Kurzfassung:

- **Fünf `sqlite:warehouse14.db`** und **sechs Einstellungsschlüssel
  `warehouse14.*`**. Ein Speicherschlüssel ist kein Text, sondern eine
  ADRESSE. Wer ihn umbenennt, zeigt auf ein leeres Fach: das Logo des Händlers
  wäre weg, die Gerätekonfiguration wäre weg, und im Ausgangskorb lägen
  unversandte fiskale Vorgänge, die niemand mehr findet.
- **Das alte Etikettenschema `w14://`** im LESER. Gedruckt wird `norns://`,
  gelesen werden beide, dauerhaft. Jedes Etikett, das vor dem 01.08.2026
  geklebt wurde, trägt das alte Schema. Ein Wächter hält das fest
  (`lib/scan-resolve.test.ts`, Satz „liest AUCH das alte Schema").

---

## Die Regel für alle künftigen Auszüge

1. **Messen, nicht vermuten.** Vor jedem Auszug der Beweis, dass die Fläche
   nicht kann: welcher Zugang fehlt, in welcher Datei und Zeile steht die
   geschlossene Liste, welcher Prozess fehlt.
2. **Eintragen.** Jede ausgezogene Datei kommt in dieses Verzeichnis, mit dem
   Befehl, der sie zurückholt, und mit der Bedingung für die Rückkehr.
3. **Wächter mitnehmen.** Ein Wächter, der auf eine gelöschte Datei zeigt,
   wird STILL grün. Siehe `lib/fenster-wache.test.ts`, Satz „nennt nur
   Dateien, die es wirklich gibt".
