# SpeakerLabel

SpeakerLabel marks who spoke a transcript line: **ME** (your microphone) or **THEM** (the call audio).

- `gr-speaker--me` uses `speaker-me` (ink); `gr-speaker--them` uses `speaker-them` (malt-ink). They differ in lightness, not just hue.
- Always uppercase via the `label` style, with the leading pill tick echoing the mark's bars.
- `gr-line` lays out a transcript line: a 64px meta column (label + mono timestamp) and the text. `gr-line--cited` highlights the line a citation points to.
- When remote speaker separation ships, extra speakers get numbered labels (THEM 1, THEM 2) before they get new colours.
