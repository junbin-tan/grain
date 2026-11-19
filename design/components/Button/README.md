# Button

Buttons trigger one action; use one `gr-btn--primary` or `gr-btn--accent` per view.

- **Primary** (`gr-btn--primary`, ink fill): the main action in a panel, e.g. *Start recording*, *Save*.
- **Accent** (`gr-btn--accent`, malt fill, dark `on-malt` text): reserved for **Enhance notes**, the one moment Grain writes for you. At most one per screen.
- **Secondary** (`gr-btn--secondary`): alternatives, e.g. *Export*, *Cancel*. Bounded by `line-strong` (3:1).
- **Ghost** (`gr-btn--ghost`): toolbar and inline actions.
- **Danger** (`gr-btn--danger`): *Delete meeting*, *Remove model*. Always confirm.
- `gr-btn--sm` for dense toolbars. `disabled` lowers opacity; keep a tooltip saying why.

Labels are verbs in sentence case, no exclamation marks, and never "Generate with AI". The consumer provides the label, an optional 16px Lucide icon (before the label) and the handler.
