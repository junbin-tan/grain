# Model compatibility

There are three categories, kept separate on purpose:

- **Already downloaded by another app:** found automatically and used without downloading (see ARCHITECTURE › Model download design). Verified on this Mac: Handy's Parakeet Unified English and Qwen3-ASR 1.7B (Hugging Face cache) were matched by SHA-256 and cloned in; LM Studio's Gemma 4 12B (Q4_0, 7 GB) was detected from its GGUF header as a language model and answered a prompt in Grain's bundled llama.cpp.
- **Quantisations:** every speech model can be downloaded in any published quant except F32 (typically Q4_K_M, Q5_K_M, Q6_K, Q8_0 and F16; BF16 for some). Q8_0 is the default.
- **Custom files:** any transcribe.cpp GGUF (speech) or llama.cpp GGUF (notes and embeddings) can be added with "Add model file…". Grain checks the GGUF header and copies the file; whether it runs is only known when it's first used.
- **Supported:** listed in Grain's catalogue and loadable by the bundled runtime. That's every `role: asr` entry in transcribe.cpp's catalogue (the Handy copy, schema 2, transcribe.cpp 0.4), plus the five llama.cpp models in `catalog/llm.json`.
- **Implemented:** the code path is exercised by Grain (download → verify → load → infer). This is the same path for every model of a runtime.
- **Tested:** run on real audio or text in Grain's end-to-end harness on this machine (Apple M4 Pro, 24 GB, macOS 26.6, Metal), with results in [test-results/](test-results/).

## Speech-to-text (transcribe.cpp)

| Model | Size (default quant) | Languages | Timestamps | Licence | Status |
|---|---|---|---|---|---|
| Parakeet Unified English 0.6B | 731 MB Q8_0 | en | token | CC-BY-4.0 | **Tested** |
| Qwen3-ASR 0.6B | 850 MB Q8_0 | 30 incl. zh, yue, ms, id, ja, ko | none (chunk-level) | Apache-2.0 | **Tested** |
| Qwen3-ASR 1.7B | 2.2 GB | 30 | none | Apache-2.0 | Supported (recommended for Asian languages on 16 GB+) |
| Canary 180M Flash | 139 MB Q4_K_M / 159 MB Q5_K_M (218 MB Q8_0 default) | en, de, es, fr | none | CC-BY-4.0 | **Tested** via the GUI: downloaded at Q4_K_M, switched to Q5_K_M (old file removed), auto-activated, transcribes correctly |
| Parakeet TDT 0.6B v2 | 730 MB | en | token | CC-BY-4.0 | Supported |
| Parakeet Ultra | 740 MB | 25 European | token | CC-BY-4.0 | Supported |
| Whisper small / medium / large-v3-turbo | 270 MB / 832 MB / 886 MB | 99–100 | segment | Apache-2.0 | Supported |
| Canary 1B v2 | 1.1 GB | 25 | none | CC-BY-4.0 | Supported |
| SenseVoice, Moonshine, Voxtral, Granite, Cohere, GigaAM, Fun-ASR, Nemotron, … | – | various | various | various (some non-commercial) | Supported ("Show all models"; non-curated ones marked Experimental) |

### Measured on this Mac (synthetic `say` speech, short clips; see TEST_PLAN for caveats)

| Clip | Parakeet Unified EN | Qwen3-ASR 0.6B |
|---|---|---|
| English | 0.0% WER, 74× real time | 0.0%, 9× (first load) |
| English + 15 dB white noise | 0.0%, 90× | 0.0%, 35× |
| Mandarin | – | 0.0% CER, 42× |
| Cantonese (Traditional reference) | – | 26.9% raw / **0.0% script-normalised** (outputs Simplified characters), 36× |
| Malay | – | 0.0%, 27× |
| Indonesian | – | 0.0%, 31× |
| Japanese | – | 3.6% CER (四→市), 37× |
| Korean | – | 0.0% (spacing-insensitive), 24× |
| English + Mandarin code-switch | – | 4.8% (both languages kept as spoken) |
| English + Malay code-switch | – | 0.0% |
| English-only speech with en+zh hint | – | 0.0% (stays English) |
| Real system-audio capture (ScreenCaptureKit) → Parakeet | 0.0% WER | – |

Published per-language FLEURS error rates from transcribe.cpp are shown as grades in the model manager. They are **not** Grain measurements. Examples: Qwen3-ASR 1.7B Malay 10.4%, Cantonese 6.1%; Whisper large-v3-turbo Cantonese 34.6%.

**Language-hint policy (measured, not assumed):** with an English hint, or English auto-detected, Qwen3-ASR translated Mandarin sentences into English. With a Chinese hint, Qwen3-ASR 1.7B translated short English-only chunks into Chinese (seen in real meetings). So for English plus zh/yue/ja/ko with a model that detects language, Grain auto-detects first. If the result has no CJK, it retries with the CJK hint and keeps that result only if it kept most of the English words and has a real CJK phrase. Models that can't detect language get the CJK hint. Retried chunks cost two passes.

## Language models (llama.cpp `llama-server`, Metal, bundled build tag v1.0.0)

| Model | File | Context used | Status |
|---|---|---|---|
| Qwen3-4B-Instruct-2507 | Q4_K_M, 2.5 GB | 16k (8k under 16 GB RAM) | **Tested**: notes 12.4 s for a 1-minute meeting; map-reduce over 54 segments at 4k context 29.4 s; Ask answers 1.8–5.1 s |
| Qwen3-Embedding-0.6B | Q8_0, 639 MB | 8k, last-token pooling | **Tested**: semantic index (9–10 chunks) and retrieval |
| Qwen3.5-4B | Q4_K_M, 2.7 GB | 16k, thinking off | Supported, not evaluated |
| Qwen3-1.7B | Q4_K_M, 1.1 GB | 8k, thinking off | Supported, not evaluated |
| Qwen3-8B | Q4_K_M, 5.0 GB | 16k, thinking off | Supported, not evaluated |

Measured cold load: Qwen3-4B 4.3 s, embeddings 0.6–0.9 s (from `llm-status` events). Peak memory was **not** measured; the catalogue's `minRamGb` values are conservative estimates used for warnings.

## Hardware

| Platform | Status |
|---|---|
| macOS 14+ on Apple Silicon | Supported and tested (M4 Pro). Metal for ASR and LLM |
| macOS on Intel | Builds without Metal for transcribe.cpp (CPU, per Handy's guidance); not tested; much slower |
| Windows / Linux | Not supported: no capture helper yet. Rust core, ASR and LLM runtimes are cross-platform by design |
