# Grain

**A private AI notepad for meetings.** Grain records, transcribes and writes up your meetings on your Mac: no bot, no account, no cloud. This system is the brand and interface language for the macOS app, its website and its README.

Three ideas shape every decision here:

1. **It stays on your Mac.** The brand feels like paper and a desk, not a server or a data centre. Warm, physical, quiet.
2. **Every claim has a source.** A note is only as good as the moment it came from. Citations are a first-class visual element, not a footnote.
3. **Two voices, kept apart.** "Me" (your microphone) and "Them" (the call audio) are always distinguishable, and your own notes are never overwritten.

---

## The logo

### The kernel

The mark is a **grain kernel drawn with seven bars of a voice waveform**. Read one way it's sound; read the other way it's a seed. The single **amber bar** at its centre is *the cited moment*: the one instant in a meeting that a decision or action item points back to. It's the grain of truth the whole product is built around.

- **Seven bars, rounded ends.** The rounded caps echo `radius-pill` and keep the mark soft at 16px.
- **Tilted 26°.** It leans forward, like a kernel resting on a table or a pen mid-stroke. Never rotate it further or set it upright.
- **One amber bar, always the centre one.** Never move the accent, add a second, or recolour other bars.

### The wordmark

Lowercase **grain** in Inter Display SemiBold with tight tracking (−0.035em). The tittle of the *i* is a small amber kernel at the same 26° tilt, so the wordmark carries the cited moment on its own when the mark isn't present. The letterforms are outlined in the asset files: don't retype the wordmark in a font.

### Lockups and files (see **Assets → Logos** and **Assets → Icon**)

| File | Use |
|---|---|
| `grain-lockup.svg` / `.png` | Default: mark + wordmark on `paper` or any light ground |
| `grain-lockup-reverse.svg` | On `paper` (dark theme), `ink` or photography darker than 50% |
| `grain-mark.svg` / `.png` | Mark alone: favicons, avatars, the menu-bar item, loading |
| `grain-mark-reverse.svg` | Mark alone on dark grounds |
| `grain-mark-mono-ink.svg`, `-mono-paper.svg` | One-colour use: embossing, fax-grade print, the macOS menu-bar template image |
| `grain-wordmark.svg`, `-reverse.svg` | Wordmark alone, where the mark already appears nearby (e.g. the app icon is in view) |
| `grain-app-icon.svg`, `-1024…16.png` | macOS app icon: soil squircle, paper bars, malt centre bar |

**Clear space:** keep at least the height of the *i*'s tittle-to-baseline (about one x-height) clear on every side of the lockup. **Minimum size:** lockup 72px wide on screen, mark 16px, app icon 16px (verified at 16, 32, 64).

**Don't:** stretch or skew it, put the full-colour mark on `malt` or on busy photography, outline the bars, add gradients or glows, animate the bars as a generic equaliser (if it animates at all, only the amber bar pulses, at recording start), or set "Grain" with a capital G in the logo. In running text, write **Grain**.

---

## Colour

The palette is **unbleached paper, dark soil, and malt amber**: harvest colours, not tech colours. There are no blues or purples, and no gradients.

| Role | Token | Light | Dark |
|---|---|---|---|
| Ground | `paper` | #F6F1E7 husk | #15120E soil |
| Sheet / card | `paper-raised` | #FFFCF6 | #1E1A15 |
| Inset / sidebar | `paper-sunken` | #ECE5D7 | #0E0C09 |
| Text | `ink` | #1E1A15 | #F3ECDF |
| Secondary text | `ink-muted` | #5C5348 | #B4A994 |
| Brand accent (fill) | `malt` | #C8862E | #E0A04A |
| Accent as text | `malt-ink` | #8A5410 | #E9B46A |
| Verified | `sprout` | #3D7148 | #86BE91 |
| Unverified / destructive | `clay` | #A24419 | #E9875F |
| Recording dot | `rec` | #D0432C | #EF6B58 |

**Rules that name tokens:**

- Spend `malt` sparingly. It marks *the cited moment* (a highlighted transcript line, a citation chip, the live waveform, the primary action), and its scarcity is what makes it read. Most screens are `paper`, `paper-raised`, `ink` and `ink-muted`.
- `malt` is a fill. When amber must be read as text or a line, use `malt-ink`. On a `malt` fill, text is always `on-malt` (dark), never white.
- **Speakers:** `speaker-me` is `ink`; `speaker-them` is `malt-ink`. They differ in lightness as well as hue, so they stay distinct for colour-blind users and in greyscale.
- **Trust states** use `sprout` (found in transcript, on-device) and `clay` (not found, removed by the checker). Always pair the colour with a word and an icon, never colour alone.
- `rec` is only ever the recording dot. General errors use `clay`.
- Dividers use `line`; anything you can click or type into is bounded by `line-strong` (3:1).

All text pairs above meet WCAG AA (4.5:1) in both themes. `ink-subtle` (light) is 3.4:1: use it for icons and large labels only.

---

## Typography

- **Inter** is the interface face: controls, lists, settings, the transcript and *your own* notepad. Plain and neutral, because your notes are yours.
- **Newsreader** (serif) is the reading face for *enhanced notes* and display moments. It signals "this was written up for you" and makes long summaries comfortable to read.
- **JetBrains Mono** is for timestamps, citations, timers and model sizes: anything that's a precise reference to a point in the recording.

The split is deliberate: **sans for what you typed or what was said, serif for what Grain wrote, mono for where it came from.** Styles: `display`, `title`, `note-heading`, `note-body`, `heading`, `body`, `body-strong`, `label`, `caption`, `timestamp`. All three families are free Google Fonts; bundle them in the app so it never fetches fonts at runtime (offline is a promise).

---

## Layout and shape

- **Spacing** runs on a 4px base: `space-1` (4) through `space-12` (48). The notepad sheet gets `space-8` padding; cards use `space-4`.
- **Radius:** `radius-sm` 6 for chips and inputs, `radius-md` 10 for buttons and rows, `radius-lg` 16 for cards and the sheet, `radius-pill` for the recording pill and toggles (the mark's rounded bars).
- **Depth:** borders, not shadows. Cards on `paper` sit on a `line` hairline. `shadow-raised` is reserved for things that float above the window: popovers, the recording pill, dialogs.
- **Texture:** none. The brand is called Grain, but don't add film-grain noise overlays to the UI. The name already does that work.

---

## Iconography

Use **Lucide** (or SF Symbols in native surfaces) at 1.75px stroke, 16 or 20px, in `ink-muted`, with `ink` on hover or active. Round caps and joins, to match the mark. Core icons: `mic` (Me), `audio-lines` (Them), `circle-check` (verified), `circle-dashed` (not found), `lock` (on-device). Don't use `sparkles` for AI: the Enhance action uses the mark itself. Citations are a mono number in a chip, not an icon. Never use emoji in the interface.

---

## Voice

Calm, exact and honest about uncertainty. Grain is a careful note-taker, not a hype machine.

- **Say where it happened.** "Priya will send the revised SOW by Friday (14:32)", not "Action items generated!"
- **Admit gaps plainly.** "Not found in transcript", not "AI couldn't determine…" or "Oops!"
- **Name the place, not the magic.** "Transcribed on this Mac", "Running Qwen3-4B locally". Don't say "powered by AI" or use ✨ sparkles.
- **No exclamation marks** in product UI. Sentence case everywhere except speaker labels (ME / THEM).
- **Privacy is a fact, not a slogan.** "Nothing leaves this Mac" only appears where it's literally true (the network is off), and the offline badge proves it.

| Instead of | Write |
|---|---|
| ✨ Generate AI summary | Enhance notes |
| Your data is safe with us | Stored on this Mac only |
| Something went wrong! | Couldn't load Parakeet v3. The model file is missing. Re-download it? |
| Speaker 2 | Them |

---

## Components

CSS-only components in `components/bundle.css`, prefixed `gr-`: **Button**, **CitationChip**, **SpeakerLabel**, **ActionItem**, **RecordingPill**, **VerifyBadge**. Each has guidelines and a live preview. The consumer provides the text, icons (Lucide SVGs) and click handlers; the classes provide every colour, size and state from the tokens.

---

## Status and open questions

- **The name.** grain.com is an existing meeting-recording product. This system is built so the mark and palette carry the identity even if the wordmark changes. Retyping the wordmark in the same style keeps the mark and the tittle idea intact.
- Fonts are Google-hosted in previews; ship them inside the app bundle.
- Not designed yet: multi-speaker colours for remote participants (today all are "Them"), calendar and meeting-detection surfaces, marketing site layouts.
