# Hier wohnt der Motor

Dieser Ordner reist als `bundle.resources` mit ins Erzeugnis. Was hier liegt,
liegt beim Händler auf der Platte; was fehlt, fehlt ihm auch.

## Was hineingehört

    start.mjs                      der gebündelte Dienst (ESM, NICHT cjs)
    erststart/schema.sql           das Schema der Datenbank
    erststart/referenz.sql         die Referenzsaat (Steuerarten, Feingehalte …)
    erststart/nachzuegler/*.sql    Wanderungen, die jünger sind als der Auszug
    node_modules/embedded-postgres/
    node_modules/@embedded-postgres/<plattform>/
    node_modules/pg/ samt Abhängigkeiten

## Wie `start.mjs` entsteht

    npx esbuild apps/api-cloud/sidecar/norns-sidecar.mjs \
      --bundle --platform=node --format=esm \
      --outfile=apps/tauri-pos/src-tauri/resources/sidecar/start.mjs \
      --external:embedded-postgres --external:pg

**ESM, nicht cjs.** Der Dienst rechnet seine Pfade aus `import.meta.url`, und
esbuild verstümmelt das beim Umschreiben nach cjs. Das ist keine Vorliebe,
sondern eine gemessene Eigenschaft (Sitzung A, 30.07.2026).

## Warum nichts davon eingecheckt ist

Die Postgres-Binärdateien allein sind entpackt rund 109 MB je Plattform, dazu
der Läufer mit rund 80 MB. Ein Verzeichnis, in das man das legt, ist bei jedem
Klon eine Viertelgigabyte schwerer, und keine dieser Dateien schreibt ein
Mensch. Sie werden HERGESTELLT: `start.mjs` mit dem Befehl oben, der Läufer mit
`werkzeug/laeufer-bereitstellen.sh`, die node-Ordner mit einem `npm install`
in `apps/api-cloud/sidecar/` auf der Zielplattform.

## Der Vertrag zum Rumpf

Der Rumpf (`src-tauri/src/motor.rs`) startet den Läufer neben der Anwendung mit
`start.mjs` als einzigem Argument und wartet auf **genau eine** Zeile auf
stdout:

    NORNS_BEREIT {"port":51533,"datenort":"…"}

Bricht der Dienst ab, schreibt er seinen Grund auf stderr mit dem Wort
`ABBRUCH:` darin, und der Rumpf zeigt diesen Satz dem Händler. Wort und Marke
sind Vertrag: wer sie ändert, lässt den Händler still auf den Satz über die
Wartezeit zurückfallen.

## ⚠️ `fiskal/` gehört dazu, seit dem 02.08.2026

    fiskal/dsfinvk-2.4/index.xml
    fiskal/dsfinvk-2.4/gdpdu-01-09-2004.dtd

Diese zwei Dateien werden zur LAUFZEIT gelesen, also bündelt esbuild sie
NICHT mit. Gemessen am gebauten Mac-Paket vom 02.08.: es enthielt keine
einzige `index.xml`. Der Prüfer hätte im Laden gestanden, der Händler hätte
den Knopf für die Kassennachschau gedrückt, und der Export wäre abgebrochen.

Sie kommen hierher mit:

    node apps/api-cloud/scripts/kopiere-fiskaldateien.mjs

Der Wächter `die-norm-reist-mit.test.ts` wird rot, wenn sie fehlen oder vom
Baum abweichen.
