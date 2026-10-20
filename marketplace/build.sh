#!/usr/bin/env bash
# Re-render marketplace/gallery-0N.png (1920x960) from marketplace/src/*.html with headless Chromium.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-chromium}"
for n in 01 02 03; do
  "$CHROME" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1920,960 --screenshot="$PWD/gallery-$n.png" "file://$PWD/src/gallery-$n.html" >/dev/null 2>&1
done
identify gallery-0*.png
