#!/usr/bin/env bash
# UI audit helper: launch a separate Grain instance on a given screen and capture its window.
#   scripts/screenshot.sh <data_dir> <route-json> <out.png>
# Needs `npm run dev` (or `tauri dev`) serving the frontend on :1420, and Screen Recording
# permission for the terminal. Uses its own data dir, so it never touches your real Grain data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WINID="${WINID:-/tmp/grain-scratch/winid}"
GRAIN_DATA_DIR="$1" GRAIN_ROUTE="$2" "$ROOT/src-tauri/target/debug/grain" >/dev/null 2>&1 &
PID=$!
sleep "${WAIT:-5}"
WID="$("$WINID" "$PID" | head -1)"
screencapture -x -o -l "$WID" "$3"
kill "$PID"
