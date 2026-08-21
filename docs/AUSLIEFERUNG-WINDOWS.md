# Windows-Auslieferung — was ein Kundenrechner können muss, und was die Kasse selbst löst

**Stand 21.08.2026.** Basels Auftrag: Kunden haben gemischte, teils alte
Rechner; die Einrichtung muss von selbst gutgehen.

## Was der Rechner mitbringen muss (die ehrliche Untergrenze)

| Baustein | Untergrenze | Warum |
|---|---|---|
| Windows | 10 (1809) oder 11, **64-bit** | WebView2 und der Updater verlangen es; 32-bit-Windows ist 2026 praktisch verschwunden |
| Prozessor | x64 mit SSE4.2 (alles ab ~2009) | der eingebettete Node-20-Läufer und Postgres 17 setzen es voraus |
| Platte | 1 GB frei | Programm + eingebetteter Datenbestand |
| Netz | NICHT nötig im Betrieb | die Kasse läuft ohne; Netz braucht nur Kurse, Kartenleser, Aktualisierung |

Windows 7 und 8 laufen NICHT — dort gibt es kein WebView2. Das steht hier,
damit es am Telefon in einem Satz beantwortet ist.

## Was der Installer selbst löst (seit 21.08.2026)

* **WebView2 liegt als Starter im Installer** (`embedBootstrapper`). Fehlt
  es auf dem Rechner (unaktualisierte Win-10-Maschinen), richtet der
  Installer es ein; ist es da (jedes Win 11, jedes gepflegte Win 10), tut er
  nichts. Vorher galt die Tauri-Vorgabe: der Starter wurde BEIM
  INSTALLIEREN aus dem Netz geladen, und ein Laden ohne stabiles Netz sah
  einen kryptischen Abbruch.
* **Kein Adminkonto nötig** (`installMode: currentUser`).
* **Der ganze Motor reist mit**: Node-Läufer, Postgres, Wanderungen — es
  wird nichts nachgeladen und nichts vorausgesetzt.

## Erstinstallation VÖLLIG ohne Netz

Der eingebettete Starter lädt die WebView2-Laufzeit nach, wenn sie fehlt —
dafür braucht ER Netz. Für den seltenen Fall „alter Rechner UND gar kein
Netz": einmalig von einem anderen Rechner den **WebView2 Evergreen
Standalone Installer** (Microsoft, ~130 MB) auf einen Stick legen, dort
ausführen, dann Norns installieren. Wir betten ihn bewusst NICHT ein: er
läge sonst in JEDEM künftigen Update, denn der Updater trägt den ganzen
Installer.

## Drucker unter Windows — warum es ohne Treiberchaos geht

ESC/POS-Bondrucker brauchen KEINEN Herstellertreiber: Windows bindet
USB-Drucker selbst (`usbprint.sys`), und die Kasse schickt ihre Bytes ROH
an die Warteschlange (`win_print.rs`). Erkannt wird am USB-Bus (`nusb`),
nicht über die Druckerliste — ein frisch eingesteckter Drucker erscheint,
BEVOR er eine Warteschlange hat, und die Kasse legt sie auf Knopfdruck an.

## Was BEWUSST nicht versprochen wird

* Kein Windows on ARM (kein Kundenfall; der Bau kennt nur x64).
* Kein „Kernel-Zugriff" auf Waagen: seriell ist seriell — die Kasse findet
  die Waage selbst (SICS-Suche), aber sie erfindet keinen Treiber.
