#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# laeufer-bereitstellen.sh — den Läufer neben die Anwendung legen.
#
# ── WAS DER LÄUFER IST ──────────────────────────────────────────────────────
#
# Eine umbenannte `node`-Binärdatei, sonst nichts. Der Motor von Norns POS ist
# ein Node-Skript (`resources/sidecar/start.mjs`, von Sitzung A gebündelt), und
# ein Skript kann sich nicht selbst starten. Tauri legt über `externalBin` eine
# Datei neben die Anwendung; die Datei ist dieses node.
#
# ── WARUM SIE NICHT IM VERZEICHNIS LIEGT ────────────────────────────────────
#
# Rund 80 MB je Plattform. Ein Verzeichnis, in das man drei davon eincheckt,
# ist bei jedem Klon 240 MB schwerer, und die Datei ändert sich nur, wenn Node
# eine neue Fassung bekommt. Sie wird deshalb HERGESTELLT, nicht aufbewahrt —
# hier für die eigene Maschine, auf dem Bauläufer aus dem amtlichen Node-Archiv.
#
# Tauri hängt an den Namen die Zielkennung an und erwartet sie GENAU so:
#     norns-sidecar-aarch64-apple-darwin
#     norns-sidecar-x86_64-pc-windows-msvc.exe
# Fehlt sie, bricht schon der Bau ab („resource path doesn't exist"), und das
# ist gut: lieber der Bau als der Händler.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ZIEL="$(cd "$(dirname "$0")/.." && pwd)/apps/tauri-pos/src-tauri/binaries"
mkdir -p "$ZIEL"

KENNUNG="$(rustc -vV | sed -n 's/^host: //p')"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "❌ node nicht gefunden — für den Läufer wird es gebraucht."; exit 1; }

ENDUNG=""
case "$KENNUNG" in *windows*) ENDUNG=".exe";; esac
cp "$NODE" "$ZIEL/norns-sidecar-${KENNUNG}${ENDUNG}"
chmod +x "$ZIEL/norns-sidecar-${KENNUNG}${ENDUNG}"

echo "✓ Läufer bereit: norns-sidecar-${KENNUNG}${ENDUNG}"
echo "  aus: $NODE ($("$NODE" --version))"
