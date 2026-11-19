# Implementation plan and status

| Phase | Scope | Status |
|---|---|---|
| 0 Research & design | Granola and Handy research, Mobbin, dependency and licence checks, architecture, design system | Done: [PRODUCT_RESEARCH](PRODUCT_RESEARCH.md), [UI_REFERENCE_AUDIT](UI_REFERENCE_AUDIT.md), [ARCHITECTURE](ARCHITECTURE.md), [DESIGN_SYSTEM](DESIGN_SYSTEM.md) |
| 1 Desktop foundation | Tauri app, layout, navigation, SQLite, meetings, note editor, settings, library | Done |
| 2 Real audio recording | Mic + system capture, controls, permissions, persistence, recovery | Done. Verified with real system audio (ScreenCaptureKit). Mic capture path is built but not exercised automatically (needs a TCC grant; see TEST_PLAN) |
| 3 Local transcription | transcribe.cpp adapter, download manager, transcript storage and UI | Done. Real audio → transcript passed before the catalogue was expanded |
| 4 Local AI notes | llama-server runtime, model install, structured notes, actions, verification, versions | Done |
| 5 Search & intelligence | FTS5, history, Ask Grain with sources, semantic retrieval | Done |
| 6 Catalogue expansion | All transcribe.cpp families via Handy's catalogue; hardware- and language-aware recommendations | Catalogue and recommendations done. Tested families: Parakeet, Qwen3-ASR (see MODEL_COMPATIBILITY) |
| 7 Polish | Visual audit (3 rounds), onboarding, shortcuts, empty/error states, loading, export, accessibility basics | Done |
| 8 Packaging | `.app` + `.dmg`, build scripts, sidecars | Done (ad-hoc signed). Developer ID signing and notarisation need an Apple account; see below |

## Signing and notarisation (manual)

```bash
# 1. Sign the sidecars and app with a Developer ID (hardened runtime):
export APPLE_SIGNING_IDENTITY="Developer ID Application: <Name> (<TEAMID>)"
npx tauri build        # Tauri signs the bundle and externalBin when APPLE_SIGNING_IDENTITY is set
# 2. Notarise:
xcrun notarytool submit src-tauri/target/release/bundle/dmg/Grain_0.1.0_aarch64.dmg --apple-id <id> --team-id <TEAMID> --password <app-specific> --wait
xcrun stapler staple src-tauri/target/release/bundle/dmg/Grain_0.1.0_aarch64.dmg
```

The hardened runtime needs `com.apple.security.device.audio-input` (already in `Entitlements.plist`). Screen-capture permission is granted by the user in System Settings and has no entitlement.

## Next steps (ordered)

1. Microphone-path automated test on a machine with a mic grant, plus a recorded multi-speaker test set.
2. ASR worker process (Handy-style) so a native abort can't close the window.
3. Silero VAD for chunking and silence gating in noisy rooms.
4. Native streaming for streaming-capable models.
5. Calendar integration (EventKit, local) for "Coming up" and auto-titles.
6. Optional SQLCipher encryption at rest.
7. Windows: a WASAPI loopback helper behind the same stdin/stdout protocol.
