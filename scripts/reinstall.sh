#!/usr/bin/env bash
# Rebuilds Grain from this checkout and replaces /Applications/Grain.app with it. User data is untouched.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP=/Applications/Grain.app
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
cd "$ROOT"

# Quitting mid-recording would cut the meeting short.
if pgrep -f "$APP/Contents/MacOS/grain-capture" >/dev/null; then
  echo "Grain is recording. Stop the meeting first." >&2; exit 1
fi

[ -d node_modules ] || npm install
./scripts/build-capture.sh
[ -x "src-tauri/binaries/llama-server-$TRIPLE" ] || ./scripts/build-llama-server.sh
npx tauri build --bundles app
NEW="$ROOT/src-tauri/target/release/bundle/macos/Grain.app"

if pgrep -f "$APP/Contents/MacOS/" >/dev/null; then
  osascript -e 'tell application id "computer.grain.app" to quit' || true
  for _ in $(seq 20); do pgrep -f "$APP/Contents/MacOS/" >/dev/null || break; sleep 0.5; done
  pkill -f "$APP/Contents/MacOS/" || true
  sleep 1
fi

rm -rf "$APP"
ditto "$NEW" "$APP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true
open "$APP"
echo "installed $APP ($(git rev-parse --short HEAD)$(git diff --quiet || echo ', with uncommitted changes'))"
