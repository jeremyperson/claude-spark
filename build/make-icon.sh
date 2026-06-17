#!/bin/bash
# Build build/icon.icns (and icon.png) from build/icon.svg.
# Requires: rsvg-convert + iconutil (macOS).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SVG="$DIR/icon.svg"
ICONSET="$DIR/icon.iconset"

rm -rf "$ICONSET"; mkdir -p "$ICONSET"

gen() { rsvg-convert -w "$1" -h "$1" "$SVG" -o "$2"; }

gen 16   "$ICONSET/icon_16x16.png"
gen 32   "$ICONSET/icon_16x16@2x.png"
gen 32   "$ICONSET/icon_32x32.png"
gen 64   "$ICONSET/icon_32x32@2x.png"
gen 128  "$ICONSET/icon_128x128.png"
gen 256  "$ICONSET/icon_128x128@2x.png"
gen 256  "$ICONSET/icon_256x256.png"
gen 512  "$ICONSET/icon_256x256@2x.png"
gen 512  "$ICONSET/icon_512x512.png"
gen 1024 "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$DIR/icon.icns"
gen 1024 "$DIR/icon.png"
rm -rf "$ICONSET"
echo "built: $DIR/icon.icns + icon.png"
