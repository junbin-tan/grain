# Grain: product write-up

## One line

**A private AI notepad for meetings that runs entirely on your Mac.** Grain records, transcribes and writes up your meetings with no bot, no account and no cloud.

## The problem

Cloud meeting notepads send your audio or transcript to other companies' servers for transcription and summaries. Many people can't or won't allow that: anyone under NDA, lawyers, healthcare workers, founders, recruiters, and people at regulated companies. Bot-based recorders add a second problem, because a visible "recorder" joins the call.

## Who it's for

People on Apple Silicon Macs who spend their day in calls and want good meeting notes without the meeting leaving their machine. That includes privacy-sensitive professionals, people who already run local models (Ollama or LM Studio users), and multilingual teams.

## How it works

1. **Press Record.** Grain captures your microphone ("Me") and your computer's audio ("Them") directly. It works with Zoom, Meet, Teams or any other call app, and no bot joins.
2. **Type rough notes** in a plain notepad while you talk. Grain transcribes live as you go.
3. **Enhance notes.** A local language model combines your notes with the transcript. You get a summary, topics, decisions, action items with owners and deadlines, open questions and follow-ups.
4. **Every claim links to the moment it was said.** Click a citation to jump to the transcript line. Grain flags anything it can't find in the transcript, and removes owners or deadlines that nobody said.
5. **Search and ask across every meeting.** Ask Grain answers with numbered citations, and tells you when something isn't there.

## Features

| Feature | What it means |
|---|---|
| **Stays on your Mac** | Transcription and writing both run on this Mac. There's no account and no telemetry. After the one-time model download it works with the internet off. |
| **Every claim has a source** | Decisions and action items carry timestamp citations. A checking step marks each claim as found or not found in the transcript. |
| **Your notes stay yours** | "My notes" is never overwritten. Enhanced notes are a separate document that you can edit, and older versions are kept. |
| **No meeting bot** | Mic and system audio are captured directly, on separate Me and Them tracks. |
| **Choose your models** | 70+ open speech models (Parakeet, Whisper, Qwen3-ASR, Canary and more), with accuracy grades per language, speed, size and licence. Grain reuses models you already downloaded with Ollama, LM Studio, Handy and similar apps, so nothing is downloaded twice. |
| **Multilingual** | Many languages, including meetings that mix Chinese, Japanese or Korean with English. |
| **Templates** | Seven built in: General meeting, One-to-one, Product discussion, Customer discovery, Project update, Interview, Technical meeting. You can add your own. |
| **Search** | Full-text search across every meeting, plus optional semantic search with a local embedding model. |
| **Export and delete** | Markdown, plain text, JSON, PDF and WAV. Delete only the audio, a single meeting, or everything. |
| **Light and dark** | Light, dark and system appearance. |

## Privacy, in facts

- Grain makes one kind of outbound request: downloading a model from Hugging Face, and only when you press Download. No account, cookies or meeting data are sent with it.
- The local language model runs on `127.0.0.1` with a random key, in offline mode.
- The full workflow was tested in a macOS sandbox that blocks all network access: record, transcribe, write notes, search, ask and export.
- Everything is stored in one folder on your Mac. Audio can be deleted automatically once a transcript is saved.
- Recording starts only when you press Record. A recording indicator shows in the app and the menu bar, alongside macOS's own indicators.

## How Grain differs from cloud notepads

| | Grain | Typical cloud notepad |
|---|---|---|
| Transcription | On your Mac | Third-party cloud service |
| Notes and chat | Local model on your Mac | Cloud AI provider |
| Account | None | Required |
| Works offline | Yes, after model download | No |
| Audio | Kept on your Mac, or deleted if you choose | Usually not kept, or kept on their servers |
| Claims checked against the transcript | Yes, with citations | Varies |
| Source code | Open source (MIT) | Closed |

## Requirements

- Mac with Apple Silicon
- macOS 14 or later
- Disk space for models (a speech model plus a ~2.5 GB language model for the default setup)

## Current limits

- Mac only.
- No calendar integration or automatic meeting detection. You start each recording.
- No speaker names. Everyone on the far side of the call is "Them".
- Live transcription works in short chunks with a few seconds' delay. It is not word-by-word streaming.
- The Mac build is ad-hoc signed. If macOS blocks the first launch, dismiss the alert and choose **Open Anyway** in **System Settings → Privacy & Security**.

## Built on

Grain is MIT-licensed and open source. It builds on transcribe.cpp, Handy's model catalogue, llama.cpp, Tauri and TipTap. Each model has its own licence, shown in the app.

## Brand notes for the site

- **Look:** unbleached paper, dark soil and malt amber. No blues, purples or gradients. Borders, not shadows.
- **Type:** Newsreader for what Grain wrote and for titles, Inter for interface text, JetBrains Mono for timestamps and citations.
- **Logo:** a grain kernel drawn as seven bars of a voice waveform. The amber centre bar is *the cited moment*. Files are in `design/assets/`.
- **Voice:** calm, exact, honest about uncertainty. Sentence case, no exclamation marks, no "powered by AI", no sparkles. Say where things happen ("Transcribed on this Mac").
- **Screenshots:** `docs/screenshots/` covers onboarding, recording, enhanced notes, transcript, Ask Grain, search, models, settings, export and action items.
