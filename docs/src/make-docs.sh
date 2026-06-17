#!/bin/bash
# Regenerate the README marketing images from the SVG sources.
# Requires rsvg-convert (brew install librsvg).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$(dirname "$DIR")"

rsvg-convert -w 1280 -h 440 "$DIR/hero.svg"   -o "$OUT/hero.png"
rsvg-convert -w 1280 -h 280 "$DIR/states.svg" -o "$OUT/states.png"
rsvg-convert -w 1280 -h 360 "$DIR/typing.svg" -o "$OUT/typing.png"
rsvg-convert -w 200  -h 200 "$OUT/../build/icon.svg" -o "$OUT/logo.png"
echo "rebuilt docs images in $OUT"
