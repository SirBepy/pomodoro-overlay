# Kit v2: Built-in Sections + Drill-in Navigation + Design System

**Date:** 2026-05-02
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** Replace kit v1's flat schema-renderer with a drill-in settings UI that ships built-in sections (Theme, About, Reset) and a real design system. Migrate `pomodoro-overlay` to consume v2. `claude_usage_in_taskbar` migration is out of scope (Phase 2, separate spec).

## Goal

Make the kit a settings **product**, not just a renderer. The kit ships a polished, dark-default settings page with drill-in navigation, themable CSS, and ready-made sections every desktop app needs (Theme picker, About / Updates, Reset). Apps describe their own sections via the existing schema; everything else comes for free.

## Context

### Why now

Kit v1 (shipped earlier today, commits `54a0af7` through `a12da92`) renders a flat list of sections from a schema. Pomodoro adopted it and proved the auto-update + atomic-settings pipeline works end-to-end (v0.2.0 → v0.2.1 update verified). But the v1 settings page is visually bare and provides nothing app-specific apps would otherwise hand-roll: no version display, no log copy, no theme picker, no reset, no developer credit.

User feedback after dogfooding: *"the settings looks rly ugly, i dont exactly understand what we gained"*. The plumbing wins are real (auto-update, schema-driven fields, atomic IO, single-source-of-truth bug fixes), but the user-facing UI regressed vs pomodoro's hand-rolled design.

Plan D fixes the regression by making the kit ship a complete settings experience.

### Locked-in decisions from brainstorming

- **Drill-in navigation** (not single column, not sidebar tabs, not card grid). Settings root is a list of nav-rows; tapping enters a sub-page with a back arrow.
- **Centered titles** on every page (root and sub-pages).
- **About sub-page** under the System category includes a 5-tap easter-egg on the version that reveals "Copy debug logs".
- **Multi-button danger zone** (kit ships Reset; apps can add their own danger actions like "Log out").
- **Developer info** block in About (YouTube/GitHub links) with sensible kit defaults; apps can override or add.
- **Canonical look:** kit ships a real design system (typography scale, spacing scale, light/dark/system theme via CSS variables, Phosphor icons).
- **Built-ins to ship:** About / Updates, Theme, Logs (gated behind debug unlock inside About), Reset.

## Architecture

### Drill-in stack

The settings page is a single Tauri window hosting a state machine: a stack of "pages". The root page is the section list. Tapping a nav-row pushes a child page; tapping the back arrow pops. Animation = CSS `transform: translateX(...)` with 200ms ease-out.

Implementation: a TS state object `{ stack: Page[] }` where each `Page` has an id + render function. Lit-html re-renders the topmost page on every state change. No separate router library — too much for what's needed.

```
[ Root ] -> [ Times ] -> ...
[ Root ] -> [ Theme ]
[ Root ] -> [ About ] -> [ debug-unlocked About ]
[ Root ] -> [ Reset confirmation modal ]
```

### renderSettingsPage v2 API

Backwards-incompatible (bumps kit minor). New options:

```ts
export interface RenderOptions {
  schema: SettingsSchema;             // existing — app-defined sections
  systemInline?: Field[];             // app rows that appear inline in the System category
  dangerActions?: DangerAction[];     // app-defined danger buttons (Reset is always there)
  about?: AboutConfig;                // overrides kit's About defaults
  theme?: ThemeConfig;                // optional theme system tweaks
  loadCommand?: string;               // existing
  saveCommand?: string;               // existing
  savedEvent?: string;                // existing
  onSaved?: (settings: Record<string, unknown>) => void;  // existing
  closeOnSave?: boolean;              // existing
}

export interface DangerAction {
  label: string;
  /** Tauri command invoked on confirmed click. */
  command: string;
  /** Optional confirmation prompt body. Defaults to "Are you sure?" */
  confirmBody?: string;
}

export interface AboutConfig {
  /** Defaults to the value of `productName` from tauri.conf.json (read at runtime via Tauri API). */
  appName?: string;
  /** Defaults to running version (read via `getVersion()` from `@tauri-apps/api/app`). */
  appVersion?: string;
  developer?: DeveloperInfo;
}

export interface DeveloperInfo {
  /** Defaults to "SirBepy". */
  name?: string;
  /** Default link map merged with overrides; setting a key to null hides it. */
  links?: {
    github?: string | null;     // default "https://github.com/SirBepy"
    youtube?: string | null;    // default "https://youtube.com/@SirBepy"
    website?: string | null;
    twitter?: string | null;
    [custom: string]: string | null | undefined;
  };
}

export interface ThemeConfig {
  /** Default "system". */
  default?: "light" | "dark" | "system";
}
```

### Rendered structure

```
Settings (root)
├── [App categories — one per schema section]
│   For pomodoro: Times, Position & Size, Visibility, Sound, Behavior
│   Each is a nav-row → sub-page renders that section's fields with the existing v1 field-kind renderers.
├── System (kit-defined category)
│   ├── Theme  → drill-in to ThemePage
│   ├── ...systemInline rows from app (rendered with v1 field-kind renderers, inline like a sub-page)
│   └── About  → drill-in to AboutPage
└── Danger zone (kit-defined category)
    ├── Reset all settings  (kit-shipped, confirms then wipes settings.json + reloads window)
    └── ...dangerActions from app
```

### Sub-pages

**Theme page:** three radio cards (Light / Dark / System) with visual swatches. Click applies immediately + persists via reserved settings key `__kit_theme`. Theme value reapplied on every settings load + on system theme change (via `matchMedia`).

**About page:** vertical stack:
1. Hero block (centered): app name (h2), version (clickable for easter-egg), up-to-date status (small text)
2. Auto-update select: never / on startup / immediate (persists in `__kit_auto_update` reserved key). Behavior:
   - `never`: skip the call to `checkAndPromptUpdate` on app startup entirely
   - `onStartup`: call `checkAndPromptUpdate` once on app load (current v1 default behavior — prompts user before installing)
   - `immediate`: call `check()` on startup; if an update is available, skip the user prompt and call `downloadAndInstall()` immediately (matching claude_usage's `immediate` mode)
   The kit ships a `runAutoUpdateCheck()` helper that dispatches to the right behavior based on the persisted setting. Apps call this once on startup instead of `checkAndPromptUpdate` directly.
3. Last checked timestamp (read from app state — kit caches the last `check()` call's timestamp in memory)
4. "↻ Check for updates now" button (calls existing kit updater check, prompt mode)
5. Copy debug logs button — hidden until 5x version tap. Calls Tauri command `kit_copy_logs` that the kit's Rust crate ships (see "Logs Tauri command" below).

**Sub-page for app-defined section:** identical to v1's field rendering, just hosted inside the drill-in shell. Each field uses the existing v1 renderers (number/integer/range/select/toggle/text/file/custom).

**Reset confirmation modal:** centered modal asking "This will reset all settings to defaults. Continue?" with Cancel / Reset buttons. On confirm: kit calls Tauri command `kit_reset_settings` (registered by `with_kit_commands`), which deletes `<app-data>/settings.json`. Kit then emits `settings-reset` Tauri event and closes the settings window. Host app's main window listens for `settings-reset` and re-reads settings (which now returns `T::default()` since the file is gone). For pomodoro: existing `settings-updated` event handler will be extended to also handle `settings-reset` with the same re-read logic.

### Reserved settings keys

The kit needs to persist its own state in the same settings.json:
- `__kit_theme: "light" | "dark" | "system"`
- `__kit_auto_update: "never" | "onStartup" | "immediate"`

Kit reads/writes via the existing `get_settings` / `save_settings` commands. Apps' settings types must include these keys. Convention: apps add a `KitSettings` substruct to their `Settings` struct via `#[serde(flatten)]` or treat them as untyped extras (serde already preserves unknown fields with `#[serde(default)]` + extras pattern).

To avoid forcing every app to add explicit fields for every kit-reserved key, the kit ships a `KitSettings` Rust struct as part of `tauri_kit_settings` and exposes a helper:

```rust
#[derive(Serialize, Deserialize, Default, Clone)]
pub struct KitSettings {
    #[serde(rename = "__kit_theme", default = "default_theme")]
    pub theme: String,                          // "light" | "dark" | "system"
    #[serde(rename = "__kit_auto_update", default = "default_auto_update")]
    pub auto_update: String,                    // "never" | "onStartup" | "immediate"
}
```

Apps include this in their settings struct via `#[serde(flatten)] kit: KitSettings`. The kit handles defaults + serialization; apps don't need to think about it.

### Easter-egg debug unlock

Pure frontend state. When user taps the version element in About 5 times within 3 seconds, set `debugUnlocked = true` in the page's local state. Re-render reveals the Copy logs button. Resets when user navigates back to root or closes the window. Not persisted — intentional, makes it an easter egg, not a setting.

### Theme system

CSS variables on `<html data-theme="...">`. The kit's `styles.css` defines:

```css
:root, [data-theme="light"] {
  --bg: #ffffff;
  --bg-alt: #f5f5f5;
  --text: #1a1a1a;
  --text-dim: #666;
  --accent: #2a5fb4;
  --danger: #d32f2f;
  --border: #e0e0e0;
}
[data-theme="dark"] {
  --bg: #1a1a1a;
  --bg-alt: #222;
  --text: #eaeaea;
  --text-dim: #888;
  --accent: #4a90e2;
  --danger: #ff6666;
  --border: #2a2a2a;
}
@media (prefers-color-scheme: dark) {
  :root[data-theme="system"] { /* same as dark */ }
}
@media (prefers-color-scheme: light) {
  :root[data-theme="system"] { /* same as light */ }
}
```

On settings page load, kit reads `__kit_theme` and sets the attribute. On theme change, sets the attribute + persists.

App layouts that aren't the kit settings page (e.g. pomodoro's main overlay) are unaffected — `data-theme` only governs elements inside `.kit-settings` because the variables are scoped via cascade. Apps that want global theming can lift the variables to `:root`.

### Logs Tauri command

Kit's `tauri_kit_settings` crate exposes a function `with_kit_commands(builder) -> Builder` that registers `kit_copy_logs` (and any future kit commands). Apps **explicitly** call it in their `main.rs` builder chain. Apps that want to override the command's behavior simply omit the call and register their own `kit_copy_logs` handler — Tauri rejects duplicate command names at registration time, so this is enforced.

Default `kit_copy_logs` impl: returns the contents of `<app-data>/app.log` if it exists, else "no logs available". Frontend writes the returned string to clipboard via `@tauri-apps/plugin-clipboard-manager`.

Pomodoro for v0.3 (this spec's release) does not yet write logs; the button copies the placeholder. Future work: kit can ship a `tauri-plugin-log` re-export so apps trivially get logging.

### Visual design

Typography:
- Page title (`h2` in headers): 16px, system-ui, 600 weight, centered
- Section header (uppercase label above each category): 9px, 1px letter-spacing, `--text-dim` color
- Row label: 12px regular
- Row value (right-aligned): 11px, slightly muted

Spacing scale: 4 / 8 / 12 / 16 / 20 / 24 px. Padding: rows are `9px 12px`, section headers `8px 12px`.

Buttons:
- Primary: `--accent` background, white text, 6px radius
- Secondary: `--bg-alt` background, `--text` color, 1px `--border` outline
- Danger: `#3a1a1a` background, `#6a2a2a` border, `--danger` text — full-width inside Danger zone

Phosphor icons (`https://unpkg.com/@phosphor-icons/web`) in:
- Settings header (gear icon)
- Sub-page back arrow (use `‹` glyph rather than icon for simplicity — Phosphor mid-arrow is over-styled for this)
- Developer info link block (`ph ph-github-logo`, `ph ph-youtube-logo`, etc.)

## Components & file layout

```
sirbepy_tauri_kit/
  frontend/
    settings/
      schema.ts          # unchanged from v1
      styles.css         # rewritten — full design system
      renderer.ts        # rewritten — drill-in stack engine + page wiring
      pages/
        root.ts          # Settings root (section list + danger zone)
        section.ts       # Sub-page rendering one schema section
        theme.ts         # Theme picker page
        about.ts         # About page (with easter-egg)
        reset-modal.ts   # Reset confirmation modal
      stack.ts           # Drill-in stack state machine + slide animation
      window.ts          # unchanged from v1
    updater/
      check.ts           # unchanged from v1 (kept for backwards compat — apps can still call directly if they don't use the kit settings page)
  tauri/
    settings/
      src/
        store.rs         # unchanged from v1
        paths.rs         # unchanged from v1
        commands.rs      # NEW — `copy_logs` command + reset helper
        kit_settings.rs  # NEW — KitSettings struct + flatten helpers
        lib.rs           # exports above
        error.rs         # unchanged
    updater/             # unchanged from v1
```

| Unit | Owns | Used by | Depends on |
|---|---|---|---|
| `stack.ts` | Drill-in page state, slide animation | renderer | none |
| `pages/root.ts` | Section list, nav-rows, danger zone listing | stack | schema, kit config |
| `pages/section.ts` | Renders one schema section's fields | stack | v1 field renderers |
| `pages/theme.ts` | Theme picker UI + theme application | stack | settings invoke |
| `pages/about.ts` | Hero block, easter-egg, updater status, dev links | stack | updater check.ts, copy_logs invoke |
| `pages/reset-modal.ts` | Confirmation modal + reset action | stack | settings invoke |
| `kit_settings.rs` | KitSettings serde struct + flatten helper | apps | serde |
| `commands.rs` | Tauri commands for logs / reset | apps | store.rs, paths.rs |

Each page module exports a `render(stack, ctx) -> TemplateResult` function. The renderer's job is just to manage the stack + delegate to the active page's render.

## Error handling

- **Theme value invalid:** unknown value falls back to "system"
- **Auto-update value invalid:** unknown value falls back to "immediate"
- **Logs command unavailable:** Copy logs button writes "logs unavailable on this app" to clipboard instead of failing
- **Reset confirmation accidentally dismissed:** no-op (closing the modal cancels)
- **Stack underflow:** back arrow on root is a no-op (already there)
- **Theme application during page load:** apply before first paint to avoid FOUC (read setting synchronously from a hidden initial-script if needed; v1 acceptable to flash for one frame and accept the trade-off)

## Testing

**Frontend (vitest + JSDOM):**
- `stack.test.ts` — push/pop/replace, slide class application
- `pages/root.test.ts` — section list rendered from schema, nav-rows clickable, danger actions populated, kit-shipped Reset always last
- `pages/about.test.ts` — version tap counter, 5-tap unlock toggles button visibility, version reset on navigation
- `pages/theme.test.ts` — selecting a card persists + applies `data-theme`
- `pages/reset-modal.test.ts` — confirm calls reset command, cancel does nothing
- Integration smoke (`renderer.test.ts`): renderSettingsPage with full v2 options renders root + each sub-page reachable

**Rust (cargo test):**
- `kit_settings.rs` — `KitSettings::default()`, `serde flatten` round-trips with extra app fields, `__kit_theme` and `__kit_auto_update` keys preserved
- `commands.rs` — `copy_logs` returns file contents when present, error string when missing

**Manual (post-merge):**
- Pomodoro: open settings, navigate every section, change theme, change auto-update, easter-egg unlock, copy logs (placeholder OK), reset settings, log out (n/a — pomodoro has no log out)
- Visual regression: dark-mode default looks reasonable; light mode legible; system mode follows OS

## Acceptance

- [ ] Kit v2 renders drill-in pages (root + each section + Theme + About + Reset modal)
- [ ] Theme picker works in 3 modes; setting persists; CSS vars apply correctly
- [ ] About page shows version, auto-update select, last-checked timestamp, check button, hidden logs button
- [ ] 5-tap version easter-egg reveals copy logs button; resets on back-nav
- [ ] Danger zone lists Reset (kit) + app-defined items in order
- [ ] Developer info block renders kit defaults + accepts overrides
- [ ] Pomodoro adopts v2; existing settings.json round-trips intact (no field loss); reserved kit keys added with sensible defaults
- [ ] Visual quality: pomodoro settings UI is no worse than its pre-kit-v1 design (subjective, user judgment)
- [ ] All vitest + cargo tests pass
- [ ] Pomodoro releases as v0.3.0 (first kit-v2-consuming release) via existing CI; auto-update from v0.2.x → v0.3.0 verified end-to-end

## Migration plan summary

Two phases (separate implementation plans):

**Plan E: kit v2 build-out**
- New stack engine + 5 pages
- New styles.css design system
- New Rust commands + KitSettings struct
- Kit tests
- Bump kit to v2 (e.g. tag commit, no published versioning required since consumers use submodule)

**Plan F: pomodoro adopts kit v2**
- Pull submodule
- Pomodoro `Settings` struct flattens `KitSettings`
- Update `renderSettingsPage` call to pass `systemInline`, `dangerActions: []`, `about`, `theme`
- Move "autostart" out of Behavior schema section into `systemInline`
- Verify drag-resize + corner persistence still work (settings.json shape preserved)
- Bump pomodoro to 0.3.0
- Watch CI ship; verify update from 0.2.1 → 0.3.0

## Out of scope

- claude_usage_in_taskbar adoption (Phase 2, separate spec — same deferral as kit v1)
- Custom theming beyond light/dark/system (no per-section colors, no user-configurable accent)
- Logging infrastructure beyond placeholder (a real `tauri-plugin-log` integration is future work)
- Animations beyond simple horizontal slide
- i18n
- Keyboard navigation (arrow keys for stack, Esc to back) — nice-to-have, defer
- Settings search / filter
- Multi-window settings (kit assumes one settings window per app)
- Mobile / non-desktop layouts
