#!/usr/bin/env bash
# Builds a self-contained (static, Metal-embedded) llama-server sidecar for Tauri.
# Pinned to a llama.cpp tag so builds are reproducible.
set -euo pipefail
TAG="${LLAMA_CPP_TAG:-v1.0.0}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${LLAMA_CPP_WORK:-$ROOT/.build/llama.cpp}"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
OUT="$ROOT/src-tauri/binaries/llama-server-$TRIPLE"

if [ ! -d "$WORK/.git" ]; then
  git clone --depth 1 --branch "$TAG" https://github.com/ggml-org/llama.cpp.git "$WORK"
fi
rm -rf "$WORK/build/tools/ui"  # never embed a web UI; Grain talks to llama-server over loopback only
cmake -S "$WORK" -B "$WORK/build" -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
  -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
  -DLLAMA_BUILD_SERVER=ON -DLLAMA_BUILD_UI=OFF -DLLAMA_USE_PREBUILT_UI=OFF -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0
cmake --build "$WORK/build" --target llama-server -j "$(sysctl -n hw.ncpu)"
cp "$WORK/build/bin/llama-server" "$OUT"
echo "built $OUT"
if otool -L "$OUT" | tail -n +2 | grep -v -E '/System/|/usr/lib/'; then echo "unexpected non-system dylib"; exit 1; fi
