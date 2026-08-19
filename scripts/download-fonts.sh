#!/usr/bin/env bash
# scripts/download-fonts.sh
#
# Fetches the three open-source font families into apps/tauri-pos/public/fonts/.
# Run once on a fresh checkout (or whenever a weight changes):
#
#   pnpm fonts:download     # alias from root package.json
#
# Sources (self-hostable woff2, SIL OFL / Apache 2.0):
#   • Cormorant Garamond — fontsource mirror (origin CatharsisFonts/Cormorant, OFL)
#   • Inter              — fontsource mirror (origin rsms/inter, OFL)
#   • JetBrains Mono     — fontsource mirror (origin JetBrains/JetBrainsMono, Apache 2.0)
#
# The fontsource "latin" subset INCLUDES the German umlauts (ä ö ü ß Ä Ö Ü) and
# the euro sign — verified via fontTools cmap inspection. That is why the basic
# "latin" files are used (not "latin-ext"); they already cover every glyph the
# cashier UI needs and stay ~20-24 KB per weight.
#
# All files are committed to the repo so CI + the Tauri bundle stay deterministic
# even if the upstream CDN changes. To force a refresh, delete the target
# directory and rerun.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${REPO_ROOT}/apps/tauri-pos/public/fonts"
mkdir -p "${TARGET}"
BASE="https://cdn.jsdelivr.net/fontsource/fonts"

echo "→ fonts target: ${TARGET}"

pull() {
  local pkg=$1 weight=$2 style=$3 out=$4
  local url="${BASE}/${pkg}@latest/latin-${weight}-${style}.woff2"
  if [ -f "${TARGET}/${out}" ]; then
    echo "  [skip]  ${out}"
    return
  fi
  echo "  [fetch] ${out}"
  curl -fsSL --retry 3 -o "${TARGET}/${out}" "${url}"
}

# Cormorant Garamond — display (weights 300/400/italic/500/600/700)
pull cormorant-garamond 300 normal CormorantGaramond-Light.woff2
pull cormorant-garamond 400 normal CormorantGaramond-Regular.woff2
pull cormorant-garamond 400 italic CormorantGaramond-Italic.woff2
pull cormorant-garamond 500 normal CormorantGaramond-Medium.woff2
pull cormorant-garamond 600 normal CormorantGaramond-SemiBold.woff2
pull cormorant-garamond 700 normal CormorantGaramond-Bold.woff2

# Inter — body (400/500/600/700)
pull inter 400 normal Inter-Regular.woff2
pull inter 500 normal Inter-Medium.woff2
pull inter 600 normal Inter-SemiBold.woff2
pull inter 700 normal Inter-Bold.woff2

# JetBrains Mono — numerals (400/500/600)
pull jetbrains-mono 400 normal JetBrainsMono-Regular.woff2
pull jetbrains-mono 500 normal JetBrainsMono-Medium.woff2
pull jetbrains-mono 600 normal JetBrainsMono-SemiBold.woff2

echo "✓ Fonts fetched into ${TARGET}"
echo "  Commit them so CI + Tauri bundles stay deterministic."
