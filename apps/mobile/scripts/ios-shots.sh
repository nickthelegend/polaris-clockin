#!/usr/bin/env bash
# Runs the autopilot build on the iOS simulator and screenshots each step.
#   bash scripts/ios-shots.sh <udid> <outdir>
set -euo pipefail
UDID=${1:?udid}; OUT=${2:?outdir}
BUNDLE=app.polarispay.clockin
TMP=$(mktemp -d /private/tmp/polaris-shots.XXXX)
mkdir -p "$OUT"
xcrun simctl terminate "$UDID" "$BUNDLE" 2>/dev/null || true
DATA=$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data)
rm -f "$DATA/Documents/autopilot.txt"
xcrun simctl launch "$UDID" "$BUNDLE" >/dev/null
seen=""
for i in $(seq 1 600); do
  sleep 0.5
  F="$DATA/Documents/autopilot.txt"
  [ -f "$F" ] || continue
  while read -r line; do
    case "$line" in
      *" SHOT "*)
        tag=$(echo "$line" | awk '{print $3"-"$4}')
        if ! grep -qx "$tag" <<<"$seen"; then
          seen="$seen"$'\n'"$tag"
          xcrun simctl io "$UDID" screenshot "$TMP/$tag.png" >/dev/null 2>&1 && cp "$TMP/$tag.png" "$OUT/$tag.png"
          echo "shot $tag"
        fi;;
    esac
  done < "$F"
  if grep -qE " (DONE|ABORT)" "$F"; then break; fi
done
cp "$DATA/Documents/autopilot.txt" "$OUT/autopilot-log.txt"
grep -E "OK|FAIL|ABORT|DONE" "$OUT/autopilot-log.txt" | tail -40
