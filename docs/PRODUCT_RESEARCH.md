# Product research

Research date: 18–19 November 2026. Sources: Granola's public website and help centre, Handy's source code (cjpais/Handy @ `aca8985`), transcribe.cpp (@ `adfc502`), Hugging Face model cards, and Mobbin (see [UI_REFERENCE_AUDIT.md](UI_REFERENCE_AUDIT.md)).

Grain does not use or claim knowledge of Granola's proprietary code or internal architecture. Granola's installed app was **not** opened, decompiled or inspected. Everything below about Granola comes from its public pages.

## 1. Granola (reference A)

### Directly observed (public pages)

| Area | Observation | Source |
|---|---|---|
| Positioning | "AI notepad for back-to-back meetings". Sections: Notepad, Chat, Mobile & Watch, MCP | granola.ai |
| Platforms | macOS, Windows, iOS, Android | granola.ai |
| Capture | "Uses your computer audio, so doesn't invite a bot"; works with "Zoom, Meet, Teams, you name it" | granola.ai, /security |
| Start | Manual start; "won't auto-join or auto-record anything". Transcribes only when you open a note for the meeting. "➕ New Note" for unscheduled calls | /security, help centre (calendars) |
| Transcription | Real time on desktop; post-meeting on mobile from cached audio | /security |
| Calendar | Google and Microsoft only; "Coming up" list (5 by default); hides declined events and out-of-office time; recurring meetings linked | help centre (calendars) |
| Notes | UI labels "My notes" and "Enhanced"; a "Transcribing → Generate notes → Enhancing notes" flow | granola.ai |
| Templates | "Customized note templates" and "Recipes" on all plans | /pricing |
| Chat | "Ask anything" input; "AI chat within and across meetings" | granola.ai, /pricing |
| Privacy | Stores transcript and notes, **not audio**. Uses third-party transcription (Deepgram, Assembly) and LLMs (OpenAI, Anthropic). Data in US-hosted AWS | /security |
| Pricing | Basic $0 (30-day history); Business $14; Enterprise $35 per user per month | /pricing |

### Inferred (not verified)

- The core interaction: a plain notepad during the call, then one action that merges your notes with the transcript. This is inferred from the "My notes / Enhanced" labels and the enhancement flow.
- The home screen is a chronological meeting list with upcoming events at the top. This is inferred from the "Coming up" help article.
- Granola's public pages do **not** describe keyboard shortcuts, onboarding steps, sidebar layout, or how AI-written text is styled differently from user text. We did not read login-gated help pages. Grain's choices in these areas are its own design decisions.

### What Grain takes, and what it changes

- **Keeps:** bot-free capture of mic plus system audio, a manual start, a plain notepad first, one-click enhancement, the separate "My notes" and "Enhanced notes" views, templates, chat across meetings, and a chronological library.
- **Changes:** all inference is local (Granola uses cloud ASR and LLMs). Grain keeps audio by default with an option to delete it (Granola keeps none). There is no calendar integration (see limitations). Every AI claim carries timestamp sources and passes a verification step.

## 2. Handy (reference B)

Handy is an open-source (MIT) local dictation app built with Tauri 2 + React + Rust. Grain reuses its **model catalogue** (`catalog.json`, copied verbatim with attribution) and follows several of its patterns.

| Topic | What Handy does (from source) | What Grain does |
|---|---|---|
| Runtime | All models run through `transcribe-cpp` 0.4.2 (GGUF on ggml): Metal on Apple Silicon, CPU-only on Intel Macs, Vulkan on Windows/Linux | Same crate and the same per-target feature split |
| Isolation | Engine runs in a child-process "worker" so GPU faults or `GGML_ASSERT` aborts don't kill the app; falls back to CPU | ASR runs in-process on a dedicated thread (simpler). Capture is a separate process, so audio survives an ASR crash. See limitations |
| Catalogue | Pinned HF repo and revision, per-quant SHA-256 and size, licence, languages, capabilities (streaming, translate, language detection, timestamps), FLEURS error per language, speed on a reference laptop | Bundled verbatim. The UI shows A–F grades and 1–4 speed dots, as Handy does |
| Downloads | hf-hub fork with cancellable, resumable `.partial` files and a mirror | Own ~150-line downloader: HTTP Range resume, streaming SHA-256, free-space check, cancel |
| Model UI | Radio for the active model, download mark, inline progress, cancel X, trash with inline "Delete X?" confirmation, legend explaining grades | Same interaction model ([ModelsPage.tsx](../src/pages/ModelsPage.tsx)) |
| Long audio | Chunking at Silero-VAD pauses, 30–40 s target | Energy-based pause chunking (≤28 s, cuts preferred at ≥1 s turn gaps) |
| Languages | Preferred languages, language detection model, Chinese script conversion | Preferred languages used as hints. Mixed CJK+English hints the CJK language (measured, see TEST_PLAN) |

**Screenshot note.** The brief mentions an attached Handy model-selector screenshot. No such image was present in the attachments folder, so the model UI follows Handy's source code ([`src/components/settings/models/`](https://github.com/cjpais/Handy)) instead.

## 3. transcribe.cpp evaluation

- **Licence:** MIT, with vendored ggml (MIT).
- **Bindings:** Rust (`transcribe-cpp` on crates.io; builds the C++ from source with CMake), plus Swift, Python and TypeScript.
- **Families:** 20 (Parakeet incl. Unified English and Ultra, Qwen3-ASR 0.6B and 1.7B, Whisper tiny–large-v3-turbo, Canary incl. 1B v2, SenseVoice, Moonshine, Voxtral, Granite and more), plus Silero VAD, Sortformer diarisation and VoxLingua107 language ID.
- **Capabilities vary by model** (from the catalogue):

| Model | Streaming | Timestamps | Language detection | Translate | Languages |
|---|---|---|---|---|---|
| Parakeet Unified EN 0.6B | yes | token | – | – | en |
| Parakeet TDT 0.6B v2 | – | token | – | – | en |
| Parakeet Ultra | – | token | yes | – | 25 (European) |
| Qwen3-ASR 0.6B / 1.7B | – | **none** | yes | – | 30 incl. zh, yue, ms, id, ja, ko |
| Whisper small / medium | – | segment | yes | yes | 99 |
| Canary 1B v2 | – | – | – | yes | 25 |

- **Decision:** use transcribe.cpp for every ASR family. One engine, one GGUF format, and Metal acceleration. whisper.cpp was not needed because transcribe.cpp covers Whisper too.
- **Constraint found:** transcribe.cpp and llama.cpp each vendor ggml, so they cannot be statically linked into one binary (duplicate symbols). The LLM therefore runs as a separate `llama-server` process (see ARCHITECTURE).

## 4. LLM selection

Candidates were checked on Hugging Face (19 Nov 2026). Selection criteria: Apache-2.0, proven llama.cpp support, and fits in 8–24 GB of unified memory.

| Model | Q4_K_M size | Notes | Role in Grain |
|---|---|---|---|
| Qwen3-4B-Instruct-2507 | 2.5 GB | Non-thinking, 256k context, strong instruction following | **Default** (tested) |
| Qwen3.5-4B | 2.7 GB | Newer, 201 languages; thinking by default (Grain turns it off) | Option (not yet evaluated) |
| Qwen3-1.7B | 1.1 GB | Hybrid thinking | Option for 8 GB Macs |
| Qwen3-8B | 5.0 GB | Higher quality, slower | Option for 24 GB+ |
| Qwen3-Embedding-0.6B (Q8_0) | 0.64 GB | Multilingual embeddings, last-token pooling | Semantic search (tested) |

Ollama is not required; Grain bundles its own `llama-server`.

## 5. Naming risk

Mobbin lists an existing meeting-recording product called **Grain** (grain.com). This repository was already named Grain, so the name is kept, but it is a trademark and confusion risk that should be resolved before any public release.
