# Design system

The source of truth is the `@theme` block in [src/styles.css](../src/styles.css). The principles: a document first and chrome second; warm paper, not a SaaS dashboard; one accent colour; recording is always unmistakable.

**Rule: no raw hex in components.** Every colour is a token. If a new shade seems necessary, add a token here first.

## Logo

One grain seed in `paper` on a flat `accent` tile. The seed's crease is a single rounded slot that doubles as a voice-level bar. There is no gradient, the mark has one shape and one line, and it stays legible at 16 px. The geometry is shared by [scripts/make-icon.swift](../scripts/make-icon.swift) (app icon) and `Mark` in [Onboarding.tsx](../src/pages/Onboarding.tsx). To regenerate: `swift scripts/make-icon.swift /tmp/icon.png && npx tauri icon /tmp/icon.png`, then delete the generated `icons/android` and `icons/ios` folders.

## Colour

| Token | Value | Use |
|---|---|---|
| `paper` | `#fbfaf7` | App and document background |
| `sidebar` | `#f4f2ec` | Sidebar |
| `raised` | `#ffffff` | Cards, popovers, inputs |
| `wash` | `#efece4` | Hover, chips, user chat bubbles |
| `line` / `line-strong` | `#e7e3da` / `#d8d3c7` | Hairlines / control borders |
| `ink` / `ink-2` / `ink-3` | `#1f2420` / `#555a53` / `#8b8f87` | Text: primary / secondary / tertiary |
| `ink-ai` | `#3a403a` | AI-written body text in Enhanced notes, one step lighter than the user's own words |

Tones come in trios: **solid** (dots, icons, fills), **soft** (backgrounds) and **ink** (text on the soft background, AA contrast). Text on a soft background always uses the matching `-ink`, never the solid colour.

| Tone | solid / soft / ink | Use |
|---|---|---|
| `accent` | `#3f5a36` / `#e6ecdd` / `#2f4428` | Brand olive, exactly the icon tile. Selected state, success, toggles, progress, citations, "Me" speaker |
| `rec` | `#e0483a` / `#fbe5e2` / `#9b2f24` | Recording only: the dot, Stop, recording badge and pill |
| `warn` | `#a86a12` / `#f8ecd6` / `#7a4d0c` | Unverified AI claims, missing models, interruptions, C/D model grades |
| `them` | `#5b4a7a` / `#ece7f3` / (solid) | Remote-side speaker chip and system level meter |
| `highlight` | `#f3e6b5` | Search hits, jumped-to transcript line |

Hover and pressed shades derive from the token with opacity (`hover:bg-ink/88`, `hover:bg-rec/20`) instead of new hex values. The sidebar uses `wash` for hover and `line` for selected.

## Typography

- **UI and notes:** system sans (`-apple-system`/SF Pro, then PingFang SC, Hiragino Sans and Apple SD Gothic Neo for CJK). UI text is 13–14 px; notes are 15.5 px with 1.65 line height.
- **Titles:** system serif (`ui-serif`, New York): page titles 26–34 px, semibold, −0.01em tracking. The one expressive typographic element.
- **Metadata:** 11.5–12.5 px, `ink-3`, tabular numbers for times and sizes.

## Spacing and layout

- 4 px base grid. Controls are 28/32/40 px tall (sm/md/lg).
- Window: 52 px title-bar band (draggable, traffic lights at 16,20); 232 px sidebar.
- Document column: max 720 px (meeting), 760 px (lists), 860 px (models), centred.
- Side panel: 360 px (live transcript / Ask Grain).
- Radii: **actions are pills** (`Button`, `IconButton`, chips, send) and **surfaces are rounded rectangles** (7–8 px inputs and menu rows, 10–12 px cards, 14 px dialogs).

## Components ([src/components/ui.tsx](../src/components/ui.tsx))

Button (primary = ink, secondary, ghost, danger, rec), **RecordButton**, **RecDot**, IconButton, Badge (neutral, accent, rec, warn), Toggle, Select, Menu/MenuItem, Modal, Banner, EmptyState, Progress, Spinner, Kbd, LevelBars. Feature components: Editor (TipTap + Markdown), Dock (the recording pill), TranscriptView, EnhancedView, AskPanel, SearchPalette, ExportDialog, Toasts.

### Buttons

| Variant | Look | Use |
|---|---|---|
| `primary` | ink pill, white text | The one main action in a view |
| `secondary` | white pill, `line-strong` border | Other actions |
| `ghost` | text only, `wash` on hover | Low-emphasis and toolbar actions |
| `danger` | solid `rec` | Destructive confirms |
| `rec` | `rec-soft` with `rec-ink` text and a red square | **Stop** only |
| `RecordButton` | any variant with `RecDot` before the label | **Every control that starts capture**: Home "Record", Dock "Start recording", "Resume recording" |

The red dot means "this records". It only appears on RecordButton, the live recording indicators (`RecDot pulse`) and Stop.

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
