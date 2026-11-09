#!/usr/bin/env bash
# Copyright 2026 MolBioCraft Contributors
# SPDX-License-Identifier: CC-BY-NC-4.0
#
# Regenerates the WOFF2 UI font subsets referenced by src/App.css from the OFL-licensed TTF
# masters in src/assets/fonts. Requires fontTools with brotli:  pip install fonttools brotli
#
# Faces (D0077, D0078):
# - Google Sans, the UI face: upright and italic, instanced to the wght axis (400-700) with
#   opsz pinned at 18 and GRAD at 0, then subset.
# - Google Sans Code, the mono face: upright and italic, wght 300-800, subset.
# - Space Grotesk, the display face, and Poppins.
#
# Coverage: Basic Latin + Latin-1 + Latin Extended A/B (+ Additional), spacing modifiers,
# combining marks, Greek (α, β, Δ ... used in scientific labels), general punctuation,
# super/subscripts, currency, letterlike symbols (Å, ℃), number forms, arrows, math operators,
# misc technical (⌘ ⌥ ⌃), box drawing, geometric shapes, misc symbols/dingbats, ligatures.
# Glyphs outside this set, or missing from a face, fall back to the platform font stack.
#
# Every subset keeps all its name records (--name-IDs='*'), so the copyright (name ID 0) and
# the licence description and URL (name IDs 13 and 14) travel inside each WOFF2.
set -euo pipefail
cd "$(dirname "$0")/../src/assets/fonts"

UNICODES="U+0000-024F,U+02B0-02FF,U+0300-036F,U+0370-03FF,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2150-218F,U+2190-21FF,U+2200-22FF,U+2300-23FF,U+2500-25FF,U+2600-27BF,U+27F0-27FF,U+2B00-2BFF,U+FB00-FB06"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

subset() { # <master> <output>
  pyftsubset "$1" \
    --unicodes="$UNICODES" \
    --layout-features='*' \
    --name-IDs='*' \
    --flavor=woff2 \
    --output-file="$2"
  echo "subset: $2 ($(wc -c <"$2" | tr -d ' ') bytes)"
}

for f in google-sans/GoogleSans-{,Italic-}VariableFont.ttf; do
  base="$(basename "${f%.ttf}")"
  fonttools varLib.instancer "$f" opsz=18 GRAD=0 --output="$work/$base.ttf"
  subset "$work/$base.ttf" "${f%.ttf}.subset.woff2"
done

for f in \
  google-sans-code/GoogleSansCode-{,Italic-}VariableFont_wght.ttf \
  space-grotesk/SpaceGrotesk-VariableFont_wght.ttf \
  poppins/Poppins-{Regular,Medium,SemiBold,Bold,ExtraBold}.ttf; do
  subset "$f" "${f%.ttf}.subset.woff2"
done
