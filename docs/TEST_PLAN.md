# Test plan and results

Machine: Apple M4 Pro, 24 GB, macOS 26.6.2, Metal. Date: 19 November 2026. All results below were produced by commands in this repository; nothing is estimated.

## How to run

| Suite | Command | What it covers |
|---|---|---|
| Frontend types / lint / unit | `npm run typecheck && npm run lint && npm test` | TS strict, ESLint, formatting helpers (`src/lib/format.test.ts`) |
| Frontend build | `npm run build` | Production bundle |
| Rust unit tests | `cd src-tauri && cargo test --lib` | 30 tests (below) |
| Rust lint | `cargo clippy --lib` | |
| **GUI end to end (every feature, real UI)** | `scripts/e2e-gui.sh` | Launches the release app with `GRAIN_E2E=1`; the in-app runner (`src/e2e/runner.ts`) clicks, types and uses shortcuts through 38 steps, measures frame drops, then crashes the app mid-recording and verifies recovery on relaunch |
| Backend end to end (real models, real capture) | `src-tauri/target/release/examples/e2e run <dir> <report.json>` | Capture → ASR → notes → search → Ask → export, with error-rate measurement |
| Offline end to end | `scripts/offline.sh src-tauri/target/release/examples/e2e run …` | The same, with all non-loopback network access denied |
| Packaging | `npx tauri build` | `.app` + `.dmg` |
| UI audit | `scripts/screenshot.sh <data_dir> '<route json>' out.png` | Screenshots of the real app on any screen |

## Latest results

| Check | Result |
|---|---|
| `tsc -b --noEmit` | 0 errors |
| `eslint src` | 0 problems |
| `vitest` | 5 / 5 passed |
| `vite build` | OK |
| `cargo test --lib` | **30 / 30 passed** |
| **GUI end to end (release build)** | **38 / 38 passed**, 0 orphaned capture helpers after the crash ([gui-e2e.json](test-results/gui-e2e.json)) |
| `cargo clippy --lib` | 0 errors, 5 style warnings (complex type, argument count, `chunks_exact` suggestions) |
| `tauri build` | `Grain.app` 37 MB, `Grain_0.1.0_aarch64.dmg` 13 MB; bundled app launched and rendered |
| E2E online | Passed ([e2e-online.json](test-results/e2e-online.json), before the fixes listed below) |
| **E2E offline** | **Passed** ([e2e-offline.json](test-results/e2e-offline.json)); `huggingface.co` unreachable (`000`) |

### Rust unit tests

db: meeting lifecycle and cascade delete (segments, notes, marks, FTS rows) · English and Chinese search including 2-character CJK terms · enhanced versions never touch My notes · segment edits keep the original · built-in templates read-only.
audio: cut lands in the pause · turn-gap preference · chunk plan covers everything without overlap · silence has no speech · echo detection (English and Chinese) · truncated PCM after a crash still reads.
asr: language-hint policy (incl. CJK + English) · sentence segmentation from word timings (incl. CJK joining).
notes: verification removes unsupported owners and deadlines, merges duplicates, flags uncited items · your notes count as evidence · Markdown has timestamp sources and flags · claim support (English and Chinese).
models: required catalogue entries have SHA-256 and size · quant variants (F32 excluded, unknown quant falls back) · GGUF import rejects non-GGUF, copies into the models folder, deletes without touching the original · recommendations by language and RAM all resolve to real models. db: model upsert updates quant and path · regenerating notes keeps done action items.
local: finds Handy/Hugging Face blobs by SHA-256 name, Ollama blobs, LM Studio files by header (ignores vision projectors and unrelated files) · GGUF header parsing (skips arrays) · APFS clone survives deleting the original.
chat: keyword extraction · date ranges (yesterday, this week) · plain-text excerpts. llm: think-tag stripping. export: link stripping.

## GUI end-to-end (release app, real UI)

What the 38 steps cover: onboarding (all 8 steps, real model verification, audio test with real system audio) · Settings (microphone Off, custom template create/edit, every section) · Record from home · typing title and notes while recording · live transcript · mark moment · pause (speech while paused not recorded) / resume · stop · Enhance notes · timestamp source link → transcript · tick an action item · regenerate with a custom template and view version history · edit enhanced notes (persists) · correct a transcript line (persists, original kept) · Ask panel with source cards that navigate · ⌘K search (keyword, filters, by meaning, Enter) · Ask Grain page (cited answer, refusal with no sources, history, delete) · Action items page (done filter, assigned to me) · export Markdown/JSON/WAV (files verified) · re-transcribe · delete audio only · Models (search by language, show all, choose quant, download, cancel, resume, auto-activate, Use, delete with confirmation, add a .gguf file, **use the copy Handy already downloaded with no download (SHA-256 verified, APFS clone, Handy's original untouched after deleting Grain's copy)**, list LM Studio's models, other tabs) · keyboard shortcuts ⌘N ⌘1–3 ⌘[ ⌘, ⌘J · delete a meeting · **crash mid-recording → relaunch → interrupted meeting recovered → audio transcribed**.

### Smoothness (requestAnimationFrame gaps; 16 ms = 60 fps)

| While… | Frames | Max gap | Frames > 50 ms | Frames > 100 ms |
|---|---|---|---|---|
| Typing notes during recording + live transcription | 552 | 39 ms | 0 | 0 |
| Downloading a model | 322 | 31 ms | 0 | 0 |
| Generating enhanced notes | 570 | 28 ms | 0 | 0 |

| Latency | Measured |
|---|---|
| Record click → recording | 0.35 s |
| Live transcript after speech ends | 2.2 s |
| Stop → transcript ready | 0.1 s |
| Enhance click → notes on screen | 5.9 s |
| Ask (meeting panel / Ask Grain page) | 1.3 s / 0.8 s |
| ⌘K search results | 0.15 s |
| Screen switches (Meetings, Ask, Models, Settings) | 30–33 ms |

### Problems the GUI test found, and the fixes

| Problem | Fix |
|---|---|
| Enhance showed no progress when pressed from My notes (the staged progress lived on another tab) | Switches to Enhanced immediately and shows the stages |
| Regenerating notes reset action items you had ticked off | Done status carries over to matching items |
| Meeting title saved only on blur, so it was lost on a crash while typing | Title autosaves while typing |
| Deleting the active speech model left no model selected (Transcribe disabled) | Falls back to another installed model of the same kind |
| Download rows jumped to "Installed" when a download started, losing the chosen size; after cancelling, "Resume" became a fresh "Download" | Rows stay in place until installed; size choice persists; Resume offered for the paused quant |
| Verifying a multi-GB model showed an empty bar and hashed on the async runtime | Hashing on a blocking thread with progress |
| UI hitches (6 frames > 50 ms, max 179 ms) when the LLM/embedding models loaded on the GPU | Models preload after a recording ends and when a meeting with a transcript opens: enhance 11.3 s → 5.9 s, 1 hitch left |
| Live transcript 1.5 s polling | 1 s polling |

## Audio tests

| Test | Result | Evidence |
|---|---|---|
| System audio recording (ScreenCaptureKit) | **Pass**: 8.5 s captured (rerun: 8.5 s); transcript WER **0.0** vs the spoken sentence | e2e `capture` |
| Pause / resume | **Pass**: a sentence spoken while paused does not appear (`pausedSpeechLeaked: false`) | e2e `capture` |
| Live transcription in the GUI | **Pass**: the sentence spoken during recording appeared in the live panel, labelled "Them" | `docs/screenshots/03b-meeting-recording.png` |
| Helper stops when control channel closes | **Pass**: exits cleanly with a "stopped" summary | manual run, see UI_REFERENCE_AUDIT round 3 |
| Interrupted recording recovery | **Pass** (unit): truncated PCM readable; on launch `recording` meetings become `interrupted` with audio kept | `audio::pcm_roundtrip…`, `capture::recover` |
| Microphone recording | **Not run**: no microphone permission in the test environment | KNOWN_LIMITATIONS |
| Combined mic + system | **Partially**: two-track alignment, echo removal and Me/Them labelling tested with two synthetic aligned tracks; not with live mic capture | e2e `meetingTranscript` |
| Permission denial | **Pass**: without screen permission the helper reports `permission` instead of blocking; the UI shows a toast with Open Settings | round 3 fix |
| Audio device changes, long recordings, screen lock | **Not run** on hardware | KNOWN_LIMITATIONS |

## Transcription tests

Audio is macOS TTS (`say`), so accents and conditions are idealised. Error rate = word-level for space-delimited scripts, character-level for CJK; case and punctuation ignored. "Script-normalised" maps Traditional to Simplified characters before scoring.

| Clip | Model | Error | Speed |
|---|---|---|---|
| English | Parakeet Unified EN | 0.0% | 74× real time |
| English + white noise (~15 dB SNR) | Parakeet Unified EN | 0.0% | 90× |
| English | Qwen3-ASR 0.6B | 0.0% | 9× (includes first load) |
| Mandarin | Qwen3-ASR 0.6B | 0.0% | 42× |
| Cantonese | Qwen3-ASR 0.6B | 26.9% raw → **0.0%** script-normalised | 36× |
| Malay | Qwen3-ASR 0.6B | 0.0% | 27× |
| Indonesian | Qwen3-ASR 0.6B | 0.0% | 31× |
| Japanese | Qwen3-ASR 0.6B | 3.6% | 37× |
| Korean | Qwen3-ASR 0.6B | 0.0% | 24× |
| English + Mandarin, sentence-level switching | Qwen3-ASR 0.6B | **52.4% before → 4.8% after** the language-hint fix | 33× |
| English + Malay switching | Qwen3-ASR 0.6B | 0.0% | 30× |
| English-only speech with en+zh preferences | Qwen3-ASR 0.6B | 0.0% (not translated) | 32× |
| Silence (5 s) | both | Gated before the model; no text | – |
| Two-track 8-turn meeting | Parakeet Unified EN | 23.5% over the concatenated transcript; most of the difference is formatting ("forty dollars" → "$40") and one merged turn | 0.8 s for 59 s of audio |
| Model switching | Parakeet ↔ Qwen3-ASR in one process | Pass (engine reloads on path change) | |
| Missing model | Unit and UI | Clear error "No speech model selected / not installed" with a link to Models; audio kept | |

## AI note tests (Qwen3-4B-Instruct-2507, fixture meeting with known facts)

| Expectation | Result |
|---|---|
| Identifies decisions ("ship beta Friday"; "keep $40, revisit in January") | **Pass**: both decisions, each cited |
| Doesn't treat status updates as decisions ("QA passed") | **Pass** after the prompt fix (the long-meeting run before it listed it as a decision) |
| Extracts action items | **Pass**: Priya release notes, update pricing page, revisit pricing (3/3 commitments) |
| Preserves names | **Pass**: Priya, Northwind, Atlas |
| Doesn't invent deadlines | **Pass**: only "by Thursday" (said in the meeting); unit test proves invented ones are removed |
| Placeholder owners ("Someone (unspecified)") | Seen in the first run; now removed by verification (unit test) |
| Suggestion vs commitment | Referral programme marked "suggested, not agreed" (single pass) or listed as a follow-up |
| Incorporates your notes | Notes topics (ship date, Northwind pricing) covered; notes count as evidence (unit test) |
| Incomplete transcript | Open questions keep "annual discount" undecided |
| Source references | Every decision and action carries `[mm:ss](#t=…)` links that open the transcript at that moment |
| Long meeting (map-reduce) | **Pass**: 54 segments at a forced 4k context → 2 windows → merged notes, 29.4 s |
| Latency | 12.4 s for a 1-minute meeting, including 4.3 s model load |

## Model downloads in the GUI

| Test | Result |
|---|---|
| Download from the Models page at a non-default quant (Canary 180M Flash, Q4_K_M, 139 MB) | Progress "41% of 139 MB · 15 MB/s", cancel button, SHA-256 verified, installed, **became the active speech model** |
| Switch quant (Q4_K_M → Q5_K_M) | New file installed, old file deleted, registry updated. Found and fixed: the quant column wasn't updated on re-install |
| Transcribe with the GUI-downloaded Q5_K_M file | "Thanks for joining. Agreed. Let's ship on Friday. Pria will write the release notes by Thursday." (one name misspelt) |

## Search and Ask Grain

| Test | Result |
|---|---|
| FTS keyword ("Northwind") | 10 hits with highlighted snippets |
| Semantic index | 9 chunks embedded with Qwen3-Embedding-0.6B |
| "What did we decide about the beta launch?" | Correct; cites [1][2]; 4.1 s |
| "What did the customer say about pricing?" | Correct (Northwind: $40/seat too high); 3.5 s |
| "What action items are there?" | All items with owners, deadline and suggestion flag; 5.1 s |
| "What is the budget for the office party?" (not in any meeting) | "I couldn't find that in your meetings." with **no sources**; 1.8 s |

## Privacy / offline test

The requirement is to disconnect the internet and repeat the workflow. A physical disconnect wasn't possible in an automated session, so the run used `sandbox-exec` with `(deny network*)` except loopback, which is stricter than unplugging because only Grain's process tree is affected. Verified under the sandbox: create meeting ✓, record (system audio) ✓, transcribe ✓, enhance notes ✓, search (FTS + semantic) ✓, Ask Grain ✓, export Markdown + WAV ✓. Opening the GUI offline wasn't separately run; the GUI makes no network requests (CSP limits it to IPC).

## Bugs found by testing and fixed

1. Merged multi-sentence segments → sentence-level pieces from word timestamps, plus turn-gap chunking.
2. Mandarin translated into English in mixed speech → CJK language hint.
3. Placeholder owners and status-as-decision in notes → verifier rule and prompt fix.
4. Ask over-cited and showed sources on refusals → tighter prompt; only cited sources attached.
5. Orphaned capture helper when permission was pending → watchdog-first start-up, permission preflight, 10 s timeout.
6. Double start in development → start-up lock and guarded bootstrap.
7. UI: list markers, title clipping, snippets, focus rings, raw Markdown excerpts (see UI_REFERENCE_AUDIT).
