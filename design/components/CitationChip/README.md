# CitationChip

A CitationChip links a claim in the enhanced notes, or an Ask Grain answer, to the transcript moment it came from.

- Markup: `<button class="gr-cite">1 <span class="gr-cite__time">14:32</span></button>`. The number is the source index; the timestamp is optional in dense text.
- Clicking it scrolls the transcript to that line and applies `gr-line--cited` to it.
- `malt-tint` ground with `malt-ink` text (4.9:1 light, 7.2:1 dark); hover inverts to a `malt` fill.
- Place it directly after the claim, before punctuation. Multiple sources sit side by side with `space-1` between them.
- Never show a chip for a claim with no source. Use VerifyBadge `missing` instead.
