# Shared Tauri Kit + Pomodoro Versioning - Design

**Date:** 2026-05-01
**Status:** Approved (brainstorming), pending implementation plan
**Scope:** Bootstrap a shared `sirbepy_tauri_kit` repo and migrate `pomodoro-overlay` onto it. `claude_usage_in_taskbar` adoption is Phase 2 (out of scope here).

## Goal

Stop hand-rolling settings UIs and release plumbing per Tauri app. Establish one shared codebase (`sirbepy_tauri_kit`) that owns:

- A schema-driven settings page (lit-html + TS)
- A generic Rust settings store (JSON in app-data dir)
- Auto-updater wiring (Tauri updater plugin + GitHub releases endpoint pattern)
- A canonical release CI workflow

Bring `pomodoro-overlay` onto the kit. Use the experience to harden the kit before claude_usage adoption.

## Context

### Current state

**`claude_usage_in_taskbar`** has the mature setup:
- Multi-platform CI (`.github/workflows/tauri-release.yml`): win/mac/linux matrix, signed updater artifacts, generates `latest.json`
- Version source-of-truth = `package.json`; CI syncs into `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
- Tag pattern `tauri-v$VERSION`
- `tauri-plugin-updater` configured with GitHub releases endpoint
- Settings UI: lit-html SPA in main window, router (`src/router.ts`), sidemenu nav, multi-subview pattern (`src/views/settings/subviews/{visuals,themes,notifications}`)
- Rust settings backend: `src-tauri/src/settings/{store.rs,overrides.rs,paths.rs}`, `ipc/settings.rs` exposes get/save commands

**`pomodoro-overlay`** is rudimentary:
- Win-only CI (`.github/workflows/release.yml`)
- No updater plugin
- Version source-of-truth = `tauri.conf.json` (0.1.3); `package.json` matches; `Cargo.toml` drifted to 0.1.0 (CI does sync it on release, but the local file is stale)
- Tag pattern `v$VERSION` (inconsistent with claude_usage)
- Settings UI: `src/settings.html` + `src/settings.js`, vanilla JS, opens in a separate Tauri window
- Settings backend: in-tree, ad-hoc

### Why now

User wants two things:
1. Better versioning for pomodoro (auto-update, version drift fixed)
2. Long-term: shared settings infrastructure across all his Tauri apps so a single bug fix or new feature reaches every app

Decisions reached during brainstorming:
- **2-3 Tauri apps in pipeline (12 mo).** At this scale, package-release ceremony costs more than it saves. Hybrid: shared *code* via git submodule, no published packages.
- **Frontend stack: lit-html + TS.** Match claude_usage. Pomodoro migrates from vanilla JS.
- **Auto-updater: yes, full updater for pomodoro.** Multi-platform builds: no (Windows-only stays).
- **Settings UI shape: per-app choice.** Pomodoro keeps separate-window. Kit must support both separate-window and embedded-route hosts.
- **Sharing mechanism: git submodule** at `vendor/tauri_kit/` in each consumer.

## Architecture

### Repo: `sirbepy_tauri_kit`

```
sirbepy_tauri_kit/
  frontend/
    settings/
      renderer.ts       # renderSettingsPage(root, { schema, onSaved })
      schema.ts         # SettingsSchema type, defineSchema(), field kinds
      styles.css        # canonical settings CSS
      window.ts         # openSettingsWindow() Tauri WebviewWindow.new wrapper
    updater/
      check.ts          # checkAndPromptUpdate()
  tauri/
    settings/           # cargo crate `tauri_kit_settings`
      Cargo.toml
      src/
        store.rs        # SettingsStore<T>: load/save JSON, atomic write
        commands.rs     # get_settings<T> / save_settings<T> tauri commands
        paths.rs        # app-data dir helper
        lib.rs
    updater/            # cargo crate `tauri_kit_updater`
      Cargo.toml
      src/lib.rs        # plugin registration helper
  templates/
    new-app/            # starter scaffold (post-Phase-1)
  README.md
  CHANGELOG.md
```

Frontend pieces are plain TS source; consumer Vite resolves them through the submodule path. Rust pieces are real cargo crates inside the kit, consumed via `path = "..."` cargo deps - never published to crates.io.

**Pomodoro frontend build:** pomodoro currently ships raw JS/HTML with no build step (`tauri.conf.json.build.frontendDist` points at `../src` directly). Consuming the kit's TS source requires a Vite + TypeScript pipeline. Add `vite`, `typescript`, `lit-html`, `@tauri-apps/api` as dev/runtime deps to `package.json`; add `vite.config.ts` + `tsconfig.json` matching claude_usage's; switch `frontendDist` to `../dist` and add `beforeDevCommand`/`beforeBuildCommand` hooks to invoke Vite. Pomodoro's existing `app.js`, `style.css`, `index.html`, etc. become Vite-managed entries (rename `app.js` to `app.ts` opportunistically, or keep .js while adding TS support — both work).

### Settings schema API (frontend)

App declares schema as data; kit renders. No bespoke HTML per app.

```ts
// app: src/settings/schema.ts
import { defineSchema } from "../../vendor/tauri_kit/frontend/settings/schema";

export const settingsSchema = defineSchema({
  sections: [
    {
      title: "Times (minutes)",
      fields: [
        { key: "work_minutes", kind: "number", label: "Pomodoro", min: 1, max: 180 },
        { key: "short_break_minutes", kind: "number", label: "Short break", min: 1, max: 60 },
        { key: "long_break_minutes", kind: "number", label: "Long break", min: 1, max: 120 },
        { key: "sessions_before_long_break", kind: "integer", label: "Sessions before long break", min: 1, max: 10 },
      ],
    },
    {
      title: "Position & Size",
      fields: [
        { key: "corner", kind: "select", label: "Corner", options: [
          { value: "tl", label: "Top Left" }, { value: "tr", label: "Top Right" },
          { value: "bl", label: "Bottom Left" }, { value: "br", label: "Bottom Right" },
        ]},
        { key: "always_on_top", kind: "toggle", label: "Always on top" },
        { key: "return_to_corner_seconds", kind: "integer", label: "Return to corner after (s, 0=never)", min: 0, max: 3600 },
      ],
    },
    // Visibility, Sound, Behavior sections...
  ],
});
```

**Field kinds (v1):** `number`, `integer`, `range`, `select`, `toggle`, `text`, `file`.

**`file` kind** has a `pickerCommand: string` field naming a Tauri command the app exposes (e.g. `pick_sound_file`) that returns the selected path. Kit calls `invoke(pickerCommand)` on click. App keeps the picker logic; kit just wires the button.

**Custom escape hatch:** `{ kind: "custom", render: (value, onChange) => TemplateResult }`. App-specific UI bits (e.g. sound preview button) stay in app code via custom kind. Kit doesn't grow special cases.

**Validation:** `min`/`max`/`step` for numeric fields; kit clamps and shows inline error. No deep validation framework v1.

**Renderer entrypoint:**

```ts
import { renderSettingsPage } from "../../vendor/tauri_kit/frontend/settings/renderer";
import { settingsSchema } from "./schema";

renderSettingsPage(document.body, {
  schema: settingsSchema,
  onSaved: () => emit("settings-updated"),
});
```

Renderer responsibilities: load via `get_settings`, populate, dirty-tracking, Save/Cancel buttons, save via `save_settings`, emit user-supplied `onSaved`, close window.

### Settings store (Rust)

Generic over the app's settings struct. Kit owns IO; app owns the type.

```rust
// app: src-tauri/src/settings.rs
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct AppSettings {
  pub work_minutes: u32,
  pub corner: String,
  pub sound_enabled: bool,
  pub volume: f32,
  pub sound_path: Option<String>,
  // ...
}
```

```rust
// app: src-tauri/src/main.rs
use tauri_kit_settings::{SettingsStore, register_commands};

fn main() {
  tauri::Builder::default()
    .plugin(register_commands::<AppSettings>("settings.json"))
    .manage(SettingsStore::<AppSettings>::new("settings.json"))
    .invoke_handler(tauri::generate_handler![pick_sound_file /* app-specific */])
    .run(tauri::generate_context!())
    .expect("error while running app");
}
```

**Kit provides:**
- `SettingsStore<T>` - load/save to `<app-data>/<filename>`, atomic write (tmp + rename), default if missing.
- `get_settings<T>` / `save_settings<T>` Tauri commands wired by `register_commands::<T>(filename)`.
- `tauri_kit_settings::paths::app_data_dir()` helper.

App keeps app-specific commands (pickers etc.) in its own handler list. Kit doesn't try to own those.

### Settings window spawn (frontend)

Pomodoro stays separate-window. Kit ships:

```ts
import { openSettingsWindow } from "../../vendor/tauri_kit/frontend/settings/window";

await openSettingsWindow({
  url: "settings.html",
  width: 480, height: 720,
  title: "Settings",
});
```

Wraps `WebviewWindow.new` with: focus existing if already open, center on screen, default decorations. App provides its own `settings.html` shell (~10 lines: import schema, call `renderSettingsPage`).

For embedded-route consumers (claude_usage in Phase 2): skip `openSettingsWindow`, mount `renderSettingsPage` into a route's container element directly. Same renderer, different host.

### Updater + release CI

**Pomodoro changes:**
- Add `tauri-plugin-updater` dependency to `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`:
  - `bundle.createUpdaterArtifacts: true`
  - `plugins.updater` block: `active: true`, `dialog: true`, endpoint `https://github.com/SirBepy/pomodoro-overlay/releases/latest/download/latest.json`, freshly generated `pubkey`
- Generate fresh updater keypair: `tauri signer generate -w ~/.tauri/pomodoro_updater.key`
  - Store private key + password as repo secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
  - Pubkey embedded in `tauri.conf.json`
- Replace `.github/workflows/release.yml` with a fork of claude_usage's `tauri-release.yml`, scoped to Windows-only matrix
  - Inherits the `latest.json` generation logic, just with one platform entry
- Switch version source-of-truth to `package.json` (matches claude_usage). CI syncs into `tauri.conf.json` and `Cargo.toml`. Local `Cargo.toml` updated to current version (currently 0.1.3) on first commit so it stops drifting.
- Tag pattern: change to `tauri-v$VERSION` for cross-app consistency
- App startup wires `tauri_kit_updater` plugin + frontend calls `checkAndPromptUpdate()` on main window load

**Per-app updater keys (not shared across apps):** different `identifier`s, fresh key per app limits blast radius if one ever leaks.

**Multi-platform builds (mac/linux):** out of scope.

### Migration order

**Phase 1 (this spec) - bootstrap kit + migrate pomodoro-overlay:**

1. Create `sirbepy_tauri_kit` GitHub repo with the layout above. Empty stub files committed.
2. Add submodule in pomodoro-overlay: `git submodule add <kit-repo> vendor/tauri_kit`
3. Add Vite + TypeScript build pipeline to pomodoro (see Pomodoro frontend build note above). Existing files keep working through Vite's static-asset handling.
4. Build `tauri/settings/` crate; pomodoro consumes via cargo path-dep, replacing its current ad-hoc settings code. Behavior preserved (same JSON file shape, same `<app-data>/settings.json` location).
5. Build `frontend/settings/{schema,renderer,styles,window}.ts` driven by pomodoro's existing 5 sections (Times / Position / Visibility / Sound / Behavior). All current fields representable in the v1 field kinds + one `custom` for the sound preview/reset row.
6. Pomodoro deletes `src/settings.html` + `src/settings.js`, replaces with thin `settings.html` shell that imports schema + calls `renderSettingsPage`.
7. Add `tauri-plugin-updater` + `tauri_kit_updater` wiring; generate keypair + add repo secrets.
8. Replace `release.yml` with the new workflow. Sync local `Cargo.toml` version. Switch tag pattern.
9. Bump pomodoro to `0.2.0` as the first kit-consuming release. Tag, build, verify updater handshake against the published `latest.json`.

**Phase 2 (separate spec, deferred) - claude_usage_in_taskbar adoption:**

claude_usage already has its own settings UI baked into its router/sidemenu structure. Migration is bigger surgery (multi-subview support, per-project notif overrides, theme system live there). Defer until kit is hardened by pomodoro use. When done: claude_usage uses kit's `renderSettingsPage` mounted into its existing route, not `openSettingsWindow`.

**Out of scope here:**
- Multi-platform pomodoro builds (mac/linux)
- Migrating claude_usage to the kit
- Theme system, sound packs, any other claude_usage-specific features
- `templates/new-app/` scaffold (build after Phase 1 proves the shape)
- Settings schema migrations / versioned schema (defer until needed)
- Internationalization

## Components & boundaries

| Unit | Owns | Used by | Depends on |
|---|---|---|---|
| `frontend/settings/schema.ts` | Schema type + `defineSchema` helper | App schemas | none |
| `frontend/settings/renderer.ts` | Form rendering, dirty tracking, save flow | App settings entrypoint | `schema.ts`, Tauri `invoke`, lit-html |
| `frontend/settings/window.ts` | Spawn settings WebviewWindow | App tray/menu code | Tauri window API |
| `frontend/updater/check.ts` | Check + prompt + install update | App startup | `tauri-plugin-updater` JS API |
| `tauri/settings` crate | Generic JSON store + commands | App `main.rs` | `serde`, `serde_json`, `tauri`, `dirs` |
| `tauri/updater` crate | Plugin registration helper | App `main.rs` | `tauri-plugin-updater` |

Each kit unit testable in isolation. Frontend units have unit tests in the kit repo (`vitest`). Rust crates have `#[cfg(test)]` tests with `tempfile` for the store.

## Error handling

- **Settings load:** if file missing or unparseable, return `T::default()` and log warning. Never crash on startup over corrupt settings.
- **Settings save:** atomic write (tmp + rename); on rename failure, keep tmp file and surface error to UI ("could not save settings, your changes are in `<path>.tmp`").
- **Updater check fail:** swallow + log. Never block app startup. Frontend optionally surfaces "Update check failed" non-blocking toast.
- **File picker cancel:** kit's `file` kind treats null/empty return as no-op (existing path retained).

## Testing

**Kit repo:**
- `vitest` for frontend units. Cover schema builder, renderer mounting + value round-trip (JSDOM), dirty tracking, save flow with mocked `invoke`.
- `cargo test` for Rust crates. Cover store load (missing file → default, valid file → parsed, corrupt file → default + log), atomic save, default propagation.

**Pomodoro post-migration:**
- Manual: every settings field round-trips through save/reload (compare `<app-data>/com.sirbepy.pomodoro-overlay/settings.json` before/after).
- Manual: updater handshake works against a real `latest.json` published from a CI release.
- Verify version sync: bump `package.json` to `0.2.0`, push to main, CI tags `tauri-v0.2.0`, builds, generates `latest.json`, app at `0.1.x` prompts for update.

## Acceptance

- [ ] `sirbepy_tauri_kit` repo exists, layout matches spec, smoke tests passing
- [ ] Pomodoro `vendor/tauri_kit/` submodule wired
- [ ] Pomodoro settings file format unchanged (no data loss for existing users on upgrade)
- [ ] Pomodoro settings UI visually matches or improves on current; all current fields present
- [ ] Pomodoro `Cargo.toml` version no longer drifts; matches `package.json`
- [ ] Pomodoro CI workflow forked from claude_usage's, scoped to windows
- [ ] First kit-consuming release `tauri-v0.2.0` tagged + published
- [ ] `latest.json` published in release; app at older version prompts for update on launch
- [ ] No regression: pomodoro overlay still operates as a tray-anchored timer with the same hover/fade/corner behavior

## Non-goals / explicit deferrals

- Multi-platform pomodoro
- claude_usage migration
- Published npm/cargo packages
- Settings schema versioning + migrations
- Theme system, sound packs
- i18n
