# Known limitations

These are stated plainly. Nothing below is hidden behind a fake button: features that don't exist have no UI.

## Not implemented

| Requirement | Status | Closest alternative in Grain |
|---|---|---|
| Calendar / upcoming meetings / meeting detection | Not implemented | Manual Record (Granola also requires a manual start); auto-titled from the notes |
| Optional SQLCipher database encryption | Not implemented | macOS FileVault; data folder is `0700` |
| Native streaming ASR | Not implemented | Live mode transcribes chunks cut at pauses (a few seconds' delay). Labelled "Live (chunked)", not streaming |
| Speaker diarisation within a channel | Not implemented | Me (mic) / Them (system) / Room labels only. Several remote speakers share "Them". No names are inferred |
| Audio playback in the app | Not implemented | Export WAV; timestamps link to transcript lines |
| Windows / Linux capture | Not implemented | Architecture keeps capture behind a stdin/stdout protocol so a WASAPI helper can be added |
| Signed and notarised build | Not done (needs an Apple Developer ID) | Ad-hoc signed `.app`/`.dmg`; see IMPLEMENTATION_PLAN for the commands |
| Grain-written meeting folders/tags | Not implemented | A `folder` column exists in the schema; there's no UI for it yet |
| Automatic updates | Not included (by design: no background network) | – |

## Tested less than the requirements ask

- **Microphone capture** was not exercised by the automated tests. The test process had no microphone permission, and requesting it would pop a system dialog. System-audio capture (ScreenCaptureKit) was tested end to end. The mic path (AVCaptureSession → same converter and writer) has the same code shape but is unverified; please run the onboarding audio test.
- **Real human speech, accents, crosstalk and long real meetings** were not tested. All accuracy numbers come from macOS synthetic voices and are optimistic.
- **Mid-sentence code-switching** (Singlish-style mixing within a sentence) was not tested; only sentence-level switching was.
- **Long recordings:** map-reduce was tested by forcing a small context (54 segments, 4k context), not on a multi-hour recording. Multi-hour capture stability was not soak-tested.
- **Device switching, screen lock and sleep** during recording were not tested on hardware. The code handles device disconnect by falling back to the default mic, and ScreenCaptureKit errors are reported.
- **Closing the window while recording** (the window hides and recording continues) is implemented but was not exercised.
- The GUI end-to-end runner drives the UI with DOM events inside the webview (Tauri's WebDriver isn't available on macOS). It exercises the real UI code and backend, but not macOS-level input such as real mouse and trackpad, IME composition for CJK typing, or VoiceOver.
- **PDF export** uses the system print dialog ("Save as PDF") and was not automated.
- **Models other than Parakeet Unified EN, Qwen3-ASR 0.6B, Qwen3-4B-Instruct-2507 and Qwen3-Embedding-0.6B** are supported but untested in Grain.
- Peak memory use was not measured.

## Behavioural limits

- **Finding other apps' models:** catalogue models are recognised in LM Studio/Jan/GPT4All/shared folders only if the file keeps its original name and exact size (Hugging Face and Ollama copies are matched by hash regardless of name). Handy in portable mode keeps its cache next to the app, so add that folder under Settings › Privacy & data. Other macOS accounts' home folders can't be read; share models via `/Users/Shared`.
- **Echo:** on speakers without headphones, the mic hears the call. Grain drops mic lines that repeat a system line, but partial overlaps can remain. Headphones give the cleanest "Me/Them" split.
- **Owners:** "Me" can be assigned as owner when the user said the line, even if it wasn't phrased as an explicit "I'll". Owners and deadlines must appear in the cited lines or your notes, or they're removed and the removal is reported.
- **Ask Grain retrieval** is keyword plus (optional) semantic, up to 12 sources. Questions needing exhaustive aggregation across many meetings ("every blocker this quarter") may miss items.
- **"Me" in prose:** summaries sometimes say "updated by Me" instead of "you", despite the prompt asking for "you".
- **Cantonese output** from Qwen3-ASR is in Simplified characters; there's no Traditional-script conversion yet.
- **ASR runs in-process.** A native abort inside transcribe.cpp would close the window. Capture is a separate process, so audio survives and the meeting is recovered as "interrupted" on relaunch. Handy isolates its engine in a worker process; Grain doesn't yet.
- **Chunking** uses an energy-based pause detector. Constant loud background noise can make cuts less clean (Silero VAD is the planned upgrade).
- **Storage:** raw PCM is ~115 MB per hour per track (two tracks ≈ 230 MB/h). Turn off "Keep audio" to delete audio after transcription.
- **Name:** another meeting product is called Grain (grain.com). The name should be reviewed before any public release.
- **Handy screenshot:** the brief's attached model-selector screenshot was not present; the model manager follows Handy's open-source UI code instead.
