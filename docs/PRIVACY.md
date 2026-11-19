# Privacy and security

## Network behaviour

Grain makes outbound network requests in exactly one place: `models.rs`, when **you** press Download (or Resume) for a model. Those requests go to `https://huggingface.co/<repo>/resolve/<pinned revision>/<file>`, following Hugging Face's CDN redirect. They carry no account, cookies or meeting data; the User-Agent is `Grain/0.1 (model downloader)`.

Everything else is local:

| Component | Network |
|---|---|
| UI (WKWebView) | CSP `connect-src ipc: http://ipc.localhost` and `default-src 'self'`; no remote scripts, fonts or images; links in notes never open |
| Capture helper | None |
| transcribe.cpp | In-process; none |
| llama-server | Bound to `127.0.0.1` on a random port, with a random 40-character API key read from a `0600` file (deleted after start-up, so not visible in `ps`), started with `--offline` (no model fetching), `--no-webui`, `--no-mmproj`; stopped after 10 minutes idle and on quit |
| Telemetry / analytics / updates / crash reporting | None included |

**Verified:** `scripts/offline.sh` runs a process in a macOS `sandbox-exec` profile that denies all network access except loopback. Under it, `curl https://huggingface.co` fails ("Couldn't connect"). The full end-to-end harness ran under it: record system audio, transcribe, enhance notes (single pass and map-reduce), semantic index, search, Ask Grain (4 questions), and export Markdown/WAV. All passed ([test-results/e2e-offline.json](test-results/e2e-offline.json), `"huggingfaceReachable": "000"`). The GUI wasn't separately run under the sandbox; it uses the same backend code.

## Looking for models other apps downloaded

To avoid downloading a model twice, Grain looks for model files in other apps' standard folders on this Mac: the Hugging Face cache (Handy, `huggingface-cli`), Ollama, LM Studio, llama.cpp's cache, Jan, GPT4All, `/Users/Shared`, and any folders you add. This is local and read-only: directory listings, file sizes, and the first few KB of GGUF headers. A file is only *used* after you choose it, and only after its SHA-256 matches the catalogue. Grain shares it through an APFS clone (or uses it in place on another disk) and never modifies, moves or deletes the other app's file. Deleting the model in Grain removes only Grain's clone. You can turn this off in Settings › Privacy & data ("Find models other apps downloaded"). Other macOS accounts' home folders are private and are not read; use `/Users/Shared` to share models between accounts.

## Storage

Everything lives in one folder, shown in Settings › Privacy & data with Show in Finder: `~/Library/Application Support/computer.grain.app/` (directories `0700`).

| Path | Contents |
|---|---|
| `grain.db` | Meetings, notes (all versions), transcript segments (original and corrected), action items, marks, templates, settings, chats, search index, embeddings |
| `recordings/<meeting>/mic.pcm`, `system.pcm` | Raw 16 kHz mono audio |
| `models/<role>/<id>/*.gguf` | Downloaded models |

There is no cloud backup. The database is **not** encrypted by Grain. Use FileVault for encryption at rest (SQLCipher is a known limitation).

## Retention and deletion

| Action | What is removed |
|---|---|
| Delete meeting | DB rows (cascade: recordings, segments, notes, actions, marks, chats, embeddings, search rows) **and** the meeting's audio folder |
| Delete audio only | `mic.pcm`/`system.pcm`; transcript and notes kept; recordings marked `deleted` |
| "Keep audio after transcription" off | Audio deleted automatically once a transcript has been saved |
| Delete a model | Its folder, including partial downloads; any setting pointing to it is cleared |
| Delete all meetings | Every meeting (as above), all chats, custom templates; `VACUUM` |
| Delete everything | The above plus all models |

Exports are written only to the path you choose in the system save dialog, and the backend rejects relative paths.

## Recording consent

- Recording only starts from an explicit action (Record button, ⌘R, or the onboarding "Start my first meeting" followed by Record).
- While recording, there's a red pulsing indicator in the dock, the title row and the sidebar, plus `● mm:ss` in the macOS menu bar. macOS also shows its own microphone and screen-capture indicators.
- Closing the window while recording keeps recording, with the menu bar showing it and offering Stop recording.
- The Record button carries a consent line. Settings › Privacy explains that laws differ (some places require all-party consent). Grain doesn't detect meetings or start automatically.

## Security notes

- Subprocesses are spawned with explicit argument vectors (no shell). Device IDs sent to the helper are validated (no newlines).
- Model files are checked against pinned SHA-256 hashes before use, and partial or corrupt files are never loaded.
- Tauri capabilities grant only core window APIs and the dialog plugin (save/open/message). No filesystem or shell permissions are granted to the webview.
