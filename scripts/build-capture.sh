#!/usr/bin/env bash
# Compiles the Swift capture helper into a Tauri sidecar binary.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
ARCH="${TRIPLE%%-*}"; [ "$ARCH" = "aarch64" ] && ARCH=arm64
OUT="$ROOT/src-tauri/binaries/grain-capture-$TRIPLE"
mkdir -p "$ROOT/src-tauri/binaries"
swiftc -O -target "$ARCH-apple-macos13.0" \
  -framework AVFoundation -framework ScreenCaptureKit -framework CoreMedia -framework CoreGraphics \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$ROOT/native/macos/grain-capture/Info.plist" \
  "$ROOT/native/macos/grain-capture/main.swift" -o "$OUT"
echo "built $OUT"
