#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release-build.sh — ein Auslieferungsbau von NORNS POS, der NIRGENDWO
# hinzeigt ausser auf seinen eigenen Motor.
#
# ── DIE UMKEHRUNG (30.07.2026) ───────────────────────────────────────────────
#
# In Warehouse14 tat dieses Skript das Gegenteil: es ERZWANG
# `VITE_API_BASE_URL=https://api.warehouse14.de` und prüfte danach, dass die
# Anschrift wirklich im Bündel steht. Für eine Kasse, die eine ferne
# Schnittstelle fragt, ist das genau richtig.
#
# Norns POS bringt seinen Server MIT. Er läuft als Kindprozess auf demselben
# Gerät und meldet seine Anschrift beim Start (src-tauri/src/motor.rs). Eine
# eingebackene Anschrift überstimmt diese Meldung, und dann klopft die Kasse an
# eine Tür im Internet, während ihr eigener Server zwei Zentimeter weiter
# wartet. Ohne Netz kommt niemand an der Anmeldung vorbei.
#
# Deshalb steht die Prüfung hier auf dem KOPF: das Bündel darf keine fremde
# Anschrift enthalten. Was in Warehouse14 ein Fehlschlag war, ist hier der
# Beweis, und umgekehrt.
#
# Gebrauch:  bash apps/tauri-pos/scripts/release-build.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Die Schale schlägt jede .env-Datei bei Vite. Eine LEERE Vorgabe stellt
# sicher, dass auch eine vergessene `.env.local` nichts einbackt.
export VITE_API_BASE_URL=""

POS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_OUT="$HOME/Desktop/Norns-builds"
mkdir -p "$DESKTOP_OUT"
cd "$POS_DIR"

echo "✓ Norns-Auslieferungsbau: VITE_API_BASE_URL ist leer (der Motor meldet die Anschrift)"

echo "=== tauri build ==="
pnpm build:tauri 2>&1 | tail -4

# ── Der umgekehrte Wächter ──────────────────────────────────────────────────
#
# Nicht „steht die Anschrift drin", sondern „steht KEINE fremde drin". Wer
# eine `.env`-Datei zurücksetzt oder das Skript umschreibt, wird hier rot,
# und zwar BEVOR das Bündel einen Laden erreicht.
DIST_JS=$(find dist -name "*.js" -path "*assets*" 2>/dev/null | head -1)
if [ -n "$DIST_JS" ]; then
  fremd=$(grep -aoc "warehouse14.de" "$DIST_JS" || true)
  fremd=${fremd:-0}
  echo "  Bündelprüfung:"
  echo "    fremde Anschriften (warehouse14.de) : $fremd (erwartet 0)"
  if [ "$fremd" -eq 0 ]; then
    echo "  ✅ BESTANDEN — das Bündel zeigt auf keinen fremden Server."
  else
    echo "  ❌ DURCHGEFALLEN — eine fremde Anschrift ist eingebacken."
    echo "     Norns POS spricht ausschliesslich mit dem Motor im Gerät."
    exit 1
  fi
else
  echo "  ⚠ Kein dist-Bündel gefunden — die Prüfung konnte nicht laufen."
  exit 1
fi

APP=$(find src-tauri/target/release/bundle/macos -name "*.app" 2>/dev/null | head -1)
DMG=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
[ -n "$APP" ] && cp -R "$APP" "$DESKTOP_OUT/" && echo "  → $DESKTOP_OUT/$(basename "$APP")"
[ -n "$DMG" ] && cp "$DMG" "$DESKTOP_OUT/" && echo "  → $DESKTOP_OUT/$(basename "$DMG")"
echo "✓ Norns-Auslieferungsbau fertig."
