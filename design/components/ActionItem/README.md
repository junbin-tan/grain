# ActionItem

ActionItem is one task in the enhanced notes, with its owner, deadline and source.

- The text uses `note-body` (Newsreader 16/26); the meta row uses `caption` with the owner in semibold ink.
- Every item ends with at least one CitationChip. An owner or deadline the checker couldn't find in the transcript is struck through with `gr-action__struck` and gets a `missing` VerifyBadge. It is never silently kept.
- Items are separated by `line` hairlines, not cards. The checkbox is bounded by `line-strong` and fills with `ink` when done.
- The consumer provides the text, owner, due date, citations and the toggle handler.
