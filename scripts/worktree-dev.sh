#!/usr/bin/env bash
# Runs `tauri dev` for this worktree's branch beside any other running copy:
# - its own Vite port (first free one from 1421), so the main checkout keeps 1420
# - its own data folder, so branch migrations and test meetings never touch your real Grain data.
#   Models are cloned in from your real data folder (copy-on-write, no extra disk) so you skip re-downloading.
#   scripts/worktree-dev.sh              (run inside the worktree)
#   GRAIN_WT_FRESH=1 scripts/worktree-dev.sh   (wipe this branch's data folder first)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
BRANCH="$(git branch --show-current)"
SLUG="$(printf '%s' "${BRANCH:-detached}" | tr -c 'A-Za-z0-9._-' '-')"
REAL="$HOME/Library/Application Support/computer.grain.app"
DATA="$HOME/Library/Application Support/computer.grain.app-worktrees/$SLUG"

[ "${GRAIN_WT_FRESH:-}" = 1 ] && rm -rf "$DATA"
mkdir -p "$DATA"
if [ -d "$REAL/models" ] && [ ! -e "$DATA/models" ]; then
  cp -c -R "$REAL/models" "$DATA/models" 2>/dev/null || { rm -rf "$DATA/models"; cp -R "$REAL/models" "$DATA/models"; }
fi

PORT=1421
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done

echo "branch: $BRANCH  port: $PORT  data: $DATA"
export GRAIN_DATA_DIR="$DATA"
exec npx tauri dev --config "{\"build\":{\"devUrl\":\"http://127.0.0.1:$PORT\",\"beforeDevCommand\":\"npm run dev -- --port $PORT\"}}"
