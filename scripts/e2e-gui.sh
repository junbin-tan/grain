#!/usr/bin/env bash
# GUI end-to-end test: launches the real Grain app with GRAIN_E2E=1 so the in-app runner
# (src/e2e/runner.ts) drives every screen. Phase 1 ends with a deliberate crash during a
# recording; phase 2 relaunches and verifies recovery.
#   scripts/e2e-gui.sh [grain-binary] [models-cache]
# Default binary: the release bundle. Uses a fresh data folder; your real Grain data is untouched.
# Models already in the cache are "downloaded" through onboarding by verifying the files (SHA-256),
# so only the Whisper Base download test uses the network.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${1:-$ROOT/src-tauri/target/release/bundle/macos/Grain.app/Contents/MacOS/grain}"
CACHE="${2:-$HOME/Library/Caches/grain-e2e/models}"
RUN="$(mktemp -d /tmp/grain-gui-e2e.XXXX)"
mkdir -p "$RUN/data/models" "$RUN/export"
for role in asr llm embed; do
  [ -d "$CACHE/$role" ] && cp -c -R "$CACHE/$role" "$RUN/data/models/" 2>/dev/null || cp -R "$CACHE/$role" "$RUN/data/models/"
done
rm -rf "$RUN/data/models/asr/whisper-base"   # must be downloaded for real
IMPORT="$(ls "$CACHE"/asr/canary-180m-flash/*.gguf /tmp/grain-shots/models/asr/canary-180m-flash/*.gguf 2>/dev/null | head -1)"
export GRAIN_E2E=1 GRAIN_DATA_DIR="$RUN/data" GRAIN_E2E_EXPORT_DIR="$RUN/export" GRAIN_E2E_IMPORT_FILE="$IMPORT"

run_phase() {
  GRAIN_E2E_PHASE="$1" GRAIN_E2E_REPORT="$RUN/phase$1.json" "$BIN" >"$RUN/phase$1.log" 2>&1 &
  local pid=$! t=0
  while kill -0 "$pid" 2>/dev/null; do sleep 2; t=$((t+2)); [ $t -gt 1500 ] && { echo "phase $1 timed out"; kill "$pid"; }; done
  wait "$pid"; echo "phase $1 exited with $?"
}
run_phase 1
sleep 3
ORPHANS=$(pgrep -f "grain-capture record --out $RUN/data" | wc -l | tr -d ' ')
echo "capture helpers still running after the crash: $ORPHANS"
run_phase 2
python3 -I - "$RUN" "$ORPHANS" "$ROOT/docs/test-results/gui-e2e.json" <<'PY'
import json, sys
run, orphans, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
r = {"phase1": json.load(open(f"{run}/phase1.json")), "phase2": json.load(open(f"{run}/phase2.json")), "orphanHelpersAfterCrash": orphans}
json.dump(r, open(out, "w"), indent=2)
steps = r["phase1"]["results"] + r["phase2"]["results"]
for s in steps:
    print(("PASS" if s["ok"] else "FAIL"), f'{s["ms"]:>7} ms', s["name"], "" if s["ok"] else "— " + s["error"])
print(f'{sum(s["ok"] for s in steps)}/{len(steps)} passed; orphaned helpers after crash: {orphans}')
print("metrics:", json.dumps(r["phase1"]["metrics"]))
PY
