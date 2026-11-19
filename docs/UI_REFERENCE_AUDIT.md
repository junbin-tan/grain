# UI reference audit

## Mobbin research (via the Mobbin MCP connector, 19 Nov 2026)

**Granola is not in Mobbin's library.** Searches for "Granola meeting notes screen" and "Granola AI notepad onboarding" returned other apps only. The closest verified references were:

| Reference (Mobbin) | What it shows | Pattern used in Grain |
|---|---|---|
| [Amie: meeting notes](https://mobbin.com/screens/c660e4c0-f122-428b-949d-8980d57b4527) | Icon rail + "Today" list, centred ~640 px document, large title, label/value metadata rows, underline tabs "Private notes / Summary / Transcript", transcript rows of timestamp + coloured speaker + text, a floating chat input at bottom centre | The overall meeting page: centred column, tabs, transcript row anatomy, bottom-centre floating controls |
| [Amie: empty state](https://mobbin.com/screens/d759e530-bcf3-4f7f-b06a-48d09e6f592f) | Centred empty state with a short list of what happens next | Home and Enhanced empty states |
| [Notion AI meeting notes](https://mobbin.com/screens/f893ebcb-9ca5-46c1-90fd-8941a21602af) | Inline meeting block: Notes/Transcript pills, waveform, Pause/Stop, the line "By starting, you confirm everyone being transcribed has consented" | Recording dock with level bars, pause/stop, and a consent line under Record |
| [Notion: meeting doc + sidebar](https://mobbin.com/screens/a1cd6f83-aac0-4df6-9297-3cc36fb6de4d) | Warm grey sidebar with "Upcoming events / Today / Yesterday", large title, Summary/Notes/Transcript tabs | Sidebar tone and grouping by day |
| [Heidi: transcribing](https://mobbin.com/screens/74fd3e6d-c80f-4a55-b92d-54a89f722a43) | Timer + mic name + level bars + "Stop transcribing"; bottom "Ask Heidi…" bar; "Review your note before use" warning | Dock levels and device tooltip; review warnings on enhanced notes |
| [Manus: recording](https://mobbin.com/screens/0a45f7cc-5b5d-4b92-9cf8-a2cd23839360) | Waveform, timer, Finish button, "By starting, you confirm you have consent from all parties" | Consent copy |
| [Otter: transcript + AI chat](https://mobbin.com/screens/01981d27-dce2-4dce-a344-3cb6185da831) | Transcript with speaker avatars, right-hand AI chat panel | Right-hand "Ask Grain" panel in the meeting |
| [Perplexity: notes skill](https://mobbin.com/screens/b723dad3-9dbd-413e-8729-eec1569a3b05) | Unassigned owners shown explicitly, open questions kept open, items traced to quotes | "No owner stated", "Suggested, not agreed", source chips |
| [Twenty: AI model settings](https://mobbin.com/screens/e5487bf5-41e5-4b52-971b-1dde01a5228a) | Searchable model table with provider column | Model table search; Handy's own source was the main reference |

Granola's own UI facts used here come only from its public website (see [PRODUCT_RESEARCH.md](PRODUCT_RESEARCH.md)). No Mobbin screenshots of Granola were available or invented.

## Element mapping

| Element | Reference behaviour | Grain implementation |
|---|---|---|
| Sidebar | Granola/Notion: compact nav, recent meetings, warm neutral | 232 px warm-grey sidebar: New note (⌘N), Search (⌘K), Meetings, Ask Grain, Action items, recent meetings, Models/Settings, "On-device · no cloud" badge, recording pill with timer |
| Main editor | Granola "My notes" plain notepad | TipTap Markdown editor, autosave, focused while recording, never overwritten by AI |
| Enhanced notes | Granola "Enhanced"; Amie "Summary" | Separate versioned document: sections, decisions, action items with owner/deadline badges, timestamp chips linking to the transcript, verification warnings, Regenerate by template |
| Recording status | Persistent indicator; Notion/Heidi waveform + pause/stop | Floating dock (timer, mic and system level bars, mark, pause, live transcript, Stop), red pulse in the sidebar and title row, timer in the menu bar |
| AI actions | Granola "Generate notes"; Amie chat bar | "Enhance notes" (⌘E) in the dock with staged progress ("Reading… Writing… Checking facts…"); Ask panel (⌘J) |
| Model settings | Handy model table | Tabs per role, Installed / Recommended / All, A–F grade, speed dots, size, licence, RAM warning, inline progress/cancel/resume, inline delete confirmation |

## Visual audit rounds

Screenshots of the real app (`tauri dev`) were captured with `scripts/screenshot.sh`, which launches a separate instance on its own data folder and screen.

### Round 1
| Finding | Fix |
|---|---|
| Bullets missing in notes (Tailwind's reset removes `list-style`) | Restored disc/decimal markers in `.ProseMirror` |
| Long titles clipped in a single-line input | Auto-growing textarea title |
| Native select showed a doubled chevron | `select.bare` with a custom chevron |
| Dock said "View enhanced notes" while already on that tab | Context-aware: shows "Regenerate" on the Enhanced tab |

### Round 2
| Finding | Fix |
|---|---|
| Search snippets too short (FTS trigram snippet length counts trigrams) | Snippet window raised from 24 to 64 tokens |
| Boxy focus outline inside composed inputs | Outline removed for text fields; the field border shows focus (buttons keep focus rings) |
| Source excerpts in Ask showed raw Markdown (`## Summary`) | Excerpts converted to plain text |
| Language lists showed raw codes (af, am…) | `Intl.DisplayNames` fallback |
| Transcript header cramped in the 360 px side panel | Header wraps; singular/plural "line(s)" |

### Round 3 (behavioural, found while capturing the recording screen)
| Finding | Fix |
|---|---|
| A capture helper launched from the app without Screen Recording permission blocked on a permission prompt and outlived its parent (orphaned process) | Helper starts its stdin/parent watchdog first, checks permission before using ScreenCaptureKit (reports `permission` instead of blocking), and times out after 10 s |
| React StrictMode in development ran the startup effect twice; two concurrent starts both spawned helpers | Capture slot is locked for the whole start-up; the bootstrap effect is guarded |

## Fidelity assessment

Grain matches the observable Granola pattern: a quiet, document-first notepad; a chronological library; bot-free recording with a persistent indicator; one-click enhancement; separate My notes / Enhanced views; and chat across meetings. All branding, the icon (an original grain-seed mark), colours and copy are Grain's own. Not reproduced: a calendar-driven "Coming up" list (no calendar integration), and Granola's exact typography and styling of AI versus user text. Granola doesn't document that styling publicly; Grain renders AI-written body text a shade lighter than the user's own notes.
