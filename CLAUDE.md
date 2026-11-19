# Grain: project rules

## Design system (mandatory for all UI work)

Every screen, component, icon, string and asset follows the Grain design system in [design/](design/). Read [design/README.md](design/README.md) before building or changing UI, and the matching `design/components/*/README.md` before touching a component. [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) explains how the app wires it up.

- **Tokens only.** Colours, radii, spacing, shadows and fonts come from `design/tokens.css` through the Tailwind names in `src/styles.css` (`bg-paper-raised`, `text-ink-muted`, `text-malt-ink`, `bg-sprout-tint`, `text-clay`, `rounded-md` …). No raw hex, `rgb()`, `white`/`black` or Tailwind palette colours in components. A new shade goes into `design/tokens.json` and `design/tokens.css` first.
- **Use the existing components** in `src/components/ui.tsx` (`Button`, `CitationChip`, `SpeakerLabel`, `VerifyBadge`, `GrainMark`, `Badge`, `Banner` …) and the `gr-` classes, never a look-alike.
- **Colour rules:** `malt` is spent sparingly (cited moment, citation chips, live waveform, the one Enhance action). `rec` is only the recording dot. Errors, warnings and unverified claims use `clay`. Verified and on-device states use `sprout`. Speakers: Me = `speaker-me`, Them = `speaker-them`.
- **Type:** Inter for UI and the user's own notes, Newsreader for what Grain wrote and for titles, JetBrains Mono for timestamps, citations, timers and sizes. Use the type classes (`display`, `title`, `heading`, `label`, `caption`, `timestamp`, `note-body`, `note-heading`).
- **Shape and depth:** borders, not shadows. `shadow-raised` only on things that float (menus, dialogs, toasts, palette, dock).
- **Icons:** Lucide at 1.75 stroke. Never `Sparkles` or emoji; Enhance uses `GrainMark`. Me = `Mic`, Them = `AudioLines`.
- **Voice:** sentence case, no exclamation marks, no "powered by AI". Say where things happened ("Transcribed on this Mac", "Not found in transcript").
- **Offline:** fonts and assets are bundled. Never load anything (fonts, images, scripts) from the network at runtime.
- **Logo and icon:** use the files in `design/assets/`, never redraw or retype them. App icon: `npx tauri icon design/assets/Icon/grain-app-icon-1024.png`, then delete `src-tauri/icons/android` and `src-tauri/icons/ios`.
- `src/components.css` is a copy of `design/components/bundle.css` minus its Google Fonts import and `body` rule. When the bundle changes, update the copy too.

`src/design.test.ts` enforces the mechanical parts of these rules and runs with `npm test`. Fix the code, not the test, unless the design system itself changed.
