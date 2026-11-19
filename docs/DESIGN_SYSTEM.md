# Design system

The source of truth is [design/README.md](../design/README.md): logo, colour, type, layout, iconography, voice and the `gr-` components. Its tokens ([design/tokens.css](../design/tokens.css), [tokens.json](../design/tokens.json)), logos and app icon live in [design/](../design/). This page only covers how the app uses them.

**Rule: no raw hex in components.** Every colour is a token. If a new shade seems necessary, add it to `design/tokens.json` and `tokens.css` first.

## Wiring

- [src/styles.css](../src/styles.css) imports `design/tokens.css` into `@layer base` and [src/components.css](../src/components.css) (a copy of `design/components/bundle.css` without its Google Fonts import) into `@layer components`, so Tailwind utilities can still override either.
- `@theme inline` maps every token to a Tailwind colour (`bg-paper-raised`, `text-ink-muted`, `text-malt-ink`, `bg-sprout-tint`, `text-speaker-them` …). Dark mode follows the OS through `tokens.css`; no component needs `dark:` variants.
- Tailwind's `rounded-sm` / `rounded-md` / `rounded-lg` resolve to the token radii (6 / 10 / 16).
- Fonts are bundled with `@fontsource-variable/{inter,newsreader,jetbrains-mono}`. Nothing is fetched at runtime.
- Type styles from `tokens.css` are plain classes: `display`, `title`, `heading`, `label`, `caption`, `timestamp`, `note-body`, `note-heading`.

## Components ([src/components/ui.tsx](../src/components/ui.tsx))

| Design system | App |
|---|---|
| Button (`gr-btn`) | `Button` with `variant` primary, accent, secondary, ghost or danger, and `size` sm or md. `accent` is only for **Enhance notes** / Regenerate. |
| CitationChip (`gr-cite`) | `CitationChip`; Ask Grain answer numbers; timestamp links in the editor (`.ProseMirror a`) |
| SpeakerLabel (`gr-speaker`, `gr-line`) | `SpeakerLabel`; transcript lines; `gr-line--cited` on the line a citation jumps to |
| VerifyBadge (`gr-verify`) | `VerifyBadge` (found, missing, local); sidebar "Stored on this Mac" |
| ActionItem (`gr-action`) | `ActionRow` in [EnhancedView.tsx](../src/components/EnhancedView.tsx), also used by the Action items page |
| RecordingPill (`gr-rec`) | The recording dock in [MeetingPage.tsx](../src/pages/MeetingPage.tsx); `LevelBars` draws its 7-bar waveform for Me and Them |
| Kernel mark | `GrainMark` (inline SVG, `currentColor` bars with a malt centre; `mono` on malt fills). Replaces sparkles for Enhance. |
| Lockup | Onboarding welcome, `grain-lockup.svg` / `-reverse.svg` by colour scheme |

App-only primitives keep the same tokens: `IconButton`, `Badge` (neutral, sprout, clay), `Banner` (neutral, sprout, clay), `Toggle` (ink when on), `Select`, `Menu`, `Modal`, `EmptyState`, `Progress`, `Spinner`, `Kbd`, `RecDot`, `RecordButton`.

## Token use in the app

- `rec` is only the recording dot. Errors, warnings, unverified claims and destructive actions use `clay`.
- Selected filters, chips and radios use an `ink` fill. Success and on-device states use `sprout`.
- Hover is `paper-sunken`. In the sidebar, which already sits on `paper-sunken`, hover is `line/50` and selected is `line`.
- Only floating things get `shadow-raised`: menus, dialogs, toasts, the search palette and the dock.

## App icon

`npx tauri icon design/assets/Icon/grain-app-icon-1024.png`, then delete the generated `src-tauri/icons/android` and `src-tauri/icons/ios` folders.

## Motion

| Name | Spec | Use |
|---|---|---|
| `rise` | 160 ms, cubic-bezier(.2,.8,.2,1), 6 px up + fade | Popovers, dock state changes, toasts |
| `fade` | 140 ms ease-out | Overlays, side panel |
| `pulse-rec` / `gr-pulse` | 1.6 s ease-in-out loop | Recording dot only, off under reduced motion |
| `shimmer` | 1.4 s linear | Skeleton lines while notes are generated |

## Accessibility

Real `<button>` elements with `aria-label` on icon buttons; tabs use `role=tab`/`aria-selected`; toggles use `role=switch`; toasts are `aria-live`; dialogs close on Esc; focus rings use `--focus`; colour is never the only signal (badges carry words and icons).
