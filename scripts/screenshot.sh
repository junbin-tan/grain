#!/usr/bin/env bash
# UI audit helper: launch a separate Grain instance on a given screen and capture its window.
#   scripts/screenshot.sh <data_dir> <route-json> <out.png>
# Needs `npm run dev` (or `tauri dev`) serving the frontend on :1420, and Screen Recording
# permission for the terminal. Uses its own data dir, so it never touches your real Grain data.
# WINID: path to a helper that prints the window id for a pid. It must be a file you own
# (no /tmp default: another account could plant one there).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WINID="${WINID:?set WINID to your window-id helper}"
[ -O "$WINID" ] && [ -x "$WINID" ] || { echo "WINID must be an executable you own: $WINID" >&2; exit 1; }
GRAIN_DATA_DIR="$1" GRAIN_ROUTE="$2" "$ROOT/src-tauri/target/debug/grain" >/dev/null 2>&1 &
PID=$!
sleep "${WAIT:-5}"
WID="$("$WINID" "$PID" | head -1)"
screencapture -x -o -l "$WID" "$3"
kill "$PID"
