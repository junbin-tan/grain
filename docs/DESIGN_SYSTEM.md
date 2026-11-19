# Design system

The source of truth is the `@theme` block in [src/styles.css](../src/styles.css). The principles: a document first and chrome second; warm paper, not a SaaS dashboard; one accent colour; recording is always unmistakable.

## Colour

| Token | Value | Use |
|---|---|---|
| `paper` | `#fbfaf7` | App and document background |
| `sidebar` | `#f4f2ec` | Sidebar |
| `raised` | `#ffffff` | Cards, popovers, inputs |
| `wash` | `#efece4` | Hover, chips, user chat bubbles |
| `line` / `line-strong` | `#e7e3da` / `#d8d3c7` | Hairlines / control borders |
| `ink` / `ink-2` / `ink-3` | `#1f2420` / `#555a53` / `#8b8f87` | Text: primary / secondary / tertiary |
| `accent` / `accent-soft` | `#3f5a36` / `#e6ecdd` | Olive (from the icon): active state, success, citations, "Me" speaker |
| `rec` / `rec-soft` | `#e0483a` / `#fbe5e2` | Recording only: dot, Stop, recording pill |
| `warn` / `warn-soft` | `#a86a12` / `#f8ecd6` | Unverified AI claims, missing models, interruptions |
| "Them" speaker | `#5b4a7a` on `#ece7f3` | Remote-side speaker chip and system level meter |

AI-written body text in Enhanced notes is `#3a403a`, one step lighter than the user's own words (`ink`).

## Typography

- **UI and notes:** system sans (`-apple-system`/SF Pro, then PingFang SC, Hiragino Sans and Apple SD Gothic Neo for CJK). UI text is 13–14 px; notes are 15.5 px with 1.65 line height.
- **Titles:** system serif (`ui-serif`, New York): page titles 26–34 px, semibold, −0.01em tracking. The one expressive typographic element.
- **Metadata:** 11.5–12.5 px, `ink-3`, tabular numbers for times and sizes.

## Spacing and layout

- 4 px base grid. Controls are 28/32/40 px tall (sm/md/lg).
- Window: 52 px title-bar band (draggable, traffic lights at 16,20); 232 px sidebar.
- Document column: max 720 px (meeting), 760 px (lists), 860 px (models), centred.
- Side panel: 360 px (live transcript / Ask Grain).
- Radii: 7–8 px controls, 10–12 px cards, 14 px dialogs, full for pills.

## Components ([src/components/ui.tsx](../src/components/ui.tsx))

Button (primary = ink, secondary, ghost, danger, rec), IconButton, Badge (neutral, accent, rec, warn), Toggle, Select, Menu/MenuItem, Modal, Banner, EmptyState, Progress, Spinner, Kbd, LevelBars. Feature components: Editor (TipTap + Markdown), Dock (the recording pill), TranscriptView, EnhancedView, AskPanel, SearchPalette, ExportDialog, Toasts.

## Motion

| Name | Spec | Use |
|---|---|---|
| `rise` | 160 ms, cubic-bezier(.2,.8,.2,1), 6 px up + fade | Popovers, dock state changes, toasts |
| `fade` | 140 ms ease-out | Overlays, side panel |
| `pulse-rec` | 1.6 s ease-in-out loop | Recording dot (stops while paused) |
| `shimmer` | 1.4 s linear | Skeleton lines while notes are generated |
| Level bars | 100 ms height transition, 10 Hz updates | Mic/system meters |

## Accessibility

Real `<button>` elements with `aria-label` on icon buttons; tabs use `role=tab`/`aria-selected`; toggles use `role=switch`; toasts are `aria-live`; dialogs close on Esc; focus rings on buttons; colour is never the only signal (badges carry text). Keyboard shortcuts are listed in Settings › Keyboard shortcuts.
