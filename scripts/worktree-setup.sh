#!/usr/bin/env bash
# Prepares a fresh git worktree so `scripts/worktree-dev.sh` runs right away.
# Clones the gitignored build inputs from the main checkout with APFS copy-on-write (`cp -c`):
# fast, and no extra disk use until the files change.
#   scripts/worktree-setup.sh            (run inside the new worktree)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd -P)"
MAIN="$(git -C "$HERE" worktree list --porcelain | sed -n '1s/^worktree //p')"
[ "$HERE" = "$MAIN" ] && { echo "Run this inside a worktree, not the main checkout ($MAIN)."; exit 1; }

clone() { # clone <relative path> if the main checkout has it and the worktree does not
  [ -e "$MAIN/$1" ] || { echo "skip $1 (not in main checkout)"; return; }
  [ -e "$HERE/$1" ] && { echo "keep $1 (already present)"; return; }
  mkdir -p "$(dirname "$HERE/$1")"
  cp -c -R "$MAIN/$1" "$HERE/$1" 2>/dev/null || { rm -rf "$HERE/$1"; cp -R "$MAIN/$1" "$HERE/$1"; }
  echo "cloned $1"
}

clone node_modules
clone src-tauri/target/debug   # warm Rust cache: deps stay fresh, only the grain crate rebuilds
for b in "$MAIN"/src-tauri/binaries/*-apple-darwin; do
  [ -e "$b" ] && clone "src-tauri/binaries/$(basename "$b")"
done
# Sidecars missing in main too: build them here (slow, needs Xcode + cmake).
ls "$HERE"/src-tauri/binaries/*-apple-darwin >/dev/null 2>&1 || (cd "$HERE" && npm run sidecars)
echo "Worktree ready: $HERE"
